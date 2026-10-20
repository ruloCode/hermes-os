/**
 * Copiloto de REUNIÓN DE EQUIPO EN VIVO: el modo "equipo" de la junta en
 * vivo. Reemplaza al FastCopilotController (que solo sopla cuando te
 * preguntan a ti) por dos flujos pensados para la reunión donde casi nadie
 * te pregunta directo y el tema puede ser nuevo:
 *
 * - aportar: detecta VENTANAS (te nombran, piden opinión al grupo, se decide
 *   algo, alguien plantea un problema, una pregunta en el aire, o llevas rato
 *   callado) y propone UNA intervención con su ángulo — trade-off, riesgo,
 *   alcance, precedente, siguiente paso, medición, pregunta, o el "puente"
 *   honesto cuando el tema es nuevo. Pool de motores en cola: lo que empieza
 *   termina y queda en el historial; de lo que espera, gana lo más reciente. A mano: "Aportar", "Pregunta" y "¿De qué hablan?".
 * - entender: cada ~8 s de conversación ajena, los términos o conceptos que
 *   acaban de salir, en una línea. Motor en COLA y sin streaming (corre en
 *   paralelo con el aporte y la UI tiene un solo carril de streaming).
 *
 * Contexto: cada motor es UNA sesión persistente que ya recuerda lo anterior,
 * así que a cada mensaje solo va lo NUEVO; si la sesión se reinicia (epoch
 * nuevo) va la conversación entera hasta un tope.
 */
import {
  articulationRules,
  CONTRIBUTION_ANGLES,
  detectOpening,
  OPENING_WHY,
  wordCount,
  type LiveHelpIntent,
  type LiveSuggestionKind,
  type LiveSuggestionLang,
  type OpeningKind,
} from "@hermes/shared";
import {
  detectQuestion,
  lastQuestion,
  lazyRequest,
  type FastCopilot,
  type FastEngine,
} from "./live-copilot.js";
import type { NormalizedTurn } from "./live-stt.js";
import { meetingContextBlocks, type MeetingContext } from "./meeting-context.js";
import { OWNER } from "../owner.js";

/** Prefijo de ids del motor de conceptos (live.ts los emite sin streaming). */
export const CONCEPT_ID_PREFIX = "concept-";

// Piso entre un aporte (automático o pedido a mano) y el siguiente automático,
// según qué abrió la ventana. Una pregunta nueva casi siempre merece su propia
// respuesta (en una junta real "¿en qué estado estamos?" llegó 5 s después de
// otra pregunta y con 12 s parejos se perdió: era el mejor momento para el dato
// de la reunión anterior). Una decisión o un problema suelen ser la misma
// discusión: más espacio. Que te nombren salta el piso. Con el pool (dos
// motores en cola) una pregunta encadenada ya no corta a la anterior, así que
// el piso de pregunta/opinión solo evita el doble disparo de una misma frase.
const WINDOW_FLOOR_MS: Record<WhyKey, number> = {
  named: 0,
  question: 1_500,
  opinion: 1_500,
  decision: 10_000,
  problem: 10_000,
  quiet: 12_000,
};
// "Llevas rato sin intervenir": caracteres ajenos desde tu última frase.
const QUIET_CHARS = 900;
const QUIET_MIN_INTERVAL_MS = 75_000;
// Conceptos: se agrupa lo ajeno hasta este silencio del motor o este tamaño.
const CONCEPT_MERGE_MS = 8_000;
const CONCEPT_MAX_CHARS = 900;
const CONCEPT_MIN_WORDS = 8;
const EARLY_MIN_CHARS = 15;
const FULL_CONTEXT_TURNS = 120;
const FULL_CONTEXT_CHARS = 14_000;

export type WhyKey = OpeningKind | "question" | "quiet";

interface LogLine {
  label: string;
  self: boolean;
  text: string;
}

interface Cursor {
  at: number;
  epoch: number;
}

export interface TeamCopilotDeps {
  /** Nombre visible de un label del STT ("A" → "Carlos" o "Hablante 1"). */
  nameOf(label: string): string;
  /** Cómo te llaman en la reunión (nombre del dueño + alias): "te nombraron". */
  ownerNames: string[];
  /** Se abrió una ventana automática (el runtime despierta al loop estratégico). */
  onWindow?(): void;
  /** Overrides para tests (ms / chars). */
  floors?: Partial<Record<WhyKey, number>>;
  conceptMergeMs?: number;
  quietChars?: number;
}

export class TeamCopilotController implements FastCopilot {
  private readonly log: LogLine[] = [];
  private readonly cursors = new Map<FastEngine, Cursor>();
  private readonly countedKeys = new Set<string>();
  private readonly firedKeys = new Set<string>();
  private lastAutoAt = 0;
  private lastQuietAt = 0;
  private charsSinceSelf = 0;
  private conceptChars = 0;
  private conceptTimer: NodeJS.Timeout | null = null;
  private seq = 0;
  private destroyed = false;

  constructor(
    private readonly helpEngine: FastEngine,
    /** null = sin glosario (el aporte sigue funcionando). */
    private readonly conceptEngine: FastEngine | null,
    private readonly deps: TeamCopilotDeps,
  ) {}

  onTurn(turn: NormalizedTurn, selfSpeaker: string | undefined): void {
    if (this.destroyed) return;
    const text = turn.text.trim();
    if (!text) return;
    const isSelf = !!selfSpeaker && turn.speaker === selfSpeaker;

    if (turn.final && !this.countedKeys.has(turn.key)) {
      this.countedKeys.add(turn.key);
      this.log.push({ label: turn.speaker, self: isSelf, text });
      if (isSelf) {
        this.charsSinceSelf = 0; // hablaste: la cuenta de "rato callado" vuelve a cero
      } else {
        this.charsSinceSelf += text.length;
        this.queueConcepts(text);
      }
    }
    if (isSelf || this.firedKeys.has(turn.key)) return;

    // end_of_turn crudo (aún sin puntuación) con pinta de pregunta: gana
    // ~300-800 ms sobre el final formateado.
    if (!turn.final) {
      if (turn.endOfTurn && text.length >= EARLY_MIN_CHARS && detectQuestion(text).hit)
        this.auto(turn.key, detectOpening(text, this.deps.ownerNames) ?? "question", text.slice(-200));
      return;
    }

    const opening = detectOpening(text, this.deps.ownerNames);
    if (text.includes("?")) {
      this.auto(turn.key, opening ?? "question", lastQuestion(text) ?? text.slice(-200));
      return;
    }
    if (opening) {
      this.auto(turn.key, opening, text.slice(-240));
      return;
    }
    const quietChars = this.deps.quietChars ?? QUIET_CHARS;
    if (this.charsSinceSelf >= quietChars && Date.now() - this.lastQuietAt >= QUIET_MIN_INTERVAL_MS)
      this.auto(turn.key, "quiet", null);
  }

  /** A mano: full/scaffold = qué aportar · question = una pregunta · explain = de qué hablan. */
  triggerNow(reason?: string, intent?: LiveHelpIntent): void {
    if (this.destroyed) return;
    this.lastAutoAt = Date.now(); // lo pedido a mano cuenta: nada automático encima
    this.seq += 1;
    const id = `team-${this.seq}`;
    if (intent === "explain") {
      this.helpEngine.generate(
        lazyRequest(
          { id, trigger: reason ?? "¿de qué están hablando?", manual: true, kind: "entender" },
          (engine) => `${this.contextFor(engine)}\n\nTAREA: ENTENDER`,
          this.helpEngine,
        ),
      );
      return;
    }
    const question = intent === "question";
    this.helpEngine.generate(
      lazyRequest(
        {
          id,
          trigger: reason ?? (question ? "pediste una pregunta" : "pediste qué aportar"),
          manual: true,
          kind: question ? "preguntar" : "aportar",
        },
        (engine) =>
          `${this.contextFor(engine)}\n\nMOMENTO: ${OWNER} pidió apoyo AHORA para este momento exacto.\nTAREA: ${question ? "PREGUNTA" : "APORTAR"}`,
        this.helpEngine,
      ),
    );
  }

  destroy(): void {
    this.destroyed = true;
    if (this.conceptTimer) clearTimeout(this.conceptTimer);
    this.conceptTimer = null;
    this.helpEngine.destroy();
    this.conceptEngine?.destroy();
  }

  private auto(key: string, why: WhyKey, focus: string | null): void {
    const now = Date.now();
    const floor = this.deps.floors?.[why] ?? WINDOW_FLOOR_MS[why];
    if (now - this.lastAutoAt < floor) return;
    this.firedKeys.add(key);
    this.lastAutoAt = now;
    this.charsSinceSelf = 0; // un aporte propuesto también reinicia "rato callado"
    if (why === "quiet") this.lastQuietAt = now;
    this.deps.onWindow?.();
    this.seq += 1;
    const momento = `${OPENING_WHY[why]}${focus ? ` — «${focus.trim()}»` : ""}`;
    this.helpEngine.generate(
      lazyRequest(
        { id: `team-${this.seq}`, trigger: OPENING_WHY[why], manual: false, kind: "aportar" },
        (engine) => `${this.contextFor(engine)}\n\nMOMENTO: ${momento}.\nTAREA: APORTAR`,
        this.helpEngine,
      ),
    );
  }

  private queueConcepts(text: string): void {
    if (!this.conceptEngine) return;
    this.conceptChars += text.length;
    if (this.conceptChars >= CONCEPT_MAX_CHARS) {
      this.flushConcepts();
      return;
    }
    if (!this.conceptTimer)
      this.conceptTimer = setTimeout(
        () => this.flushConcepts(),
        this.deps.conceptMergeMs ?? CONCEPT_MERGE_MS,
      );
  }

  private flushConcepts(): void {
    if (this.conceptTimer) clearTimeout(this.conceptTimer);
    this.conceptTimer = null;
    const chars = this.conceptChars;
    this.conceptChars = 0;
    if (!this.conceptEngine || this.destroyed || chars === 0) return;
    const ctx = this.contextFor(this.conceptEngine);
    if (wordCount(ctx) < CONCEPT_MIN_WORDS) return;
    this.seq += 1;
    this.conceptEngine.generate({
      id: `${CONCEPT_ID_PREFIX}${this.seq}`,
      trigger: "concepto nuevo",
      manual: false,
      kind: "entender",
      prompt: `${ctx}\n\nTAREA: CONCEPTOS de las líneas nuevas.`,
    });
  }

  /** La conversación entera si la sesión del motor es nueva; si no, solo lo que aún no vio. */
  private contextFor(engine: FastEngine): string {
    const epoch = engine.epoch?.() ?? 0;
    const cur = this.cursors.get(engine);
    const fresh = !cur || cur.epoch !== epoch;
    const from = fresh ? Math.max(0, this.log.length - FULL_CONTEXT_TURNS) : cur.at;
    this.cursors.set(engine, { at: this.log.length, epoch });
    const lines = this.log
      .slice(from)
      .map((l) => `${l.self ? `${OWNER} (yo)` : this.deps.nameOf(l.label)}: ${l.text}`);
    if (!lines.length) return fresh ? "(La reunión aún no empieza.)" : "(Sin líneas nuevas.)";
    let body = lines.join("\n");
    if (body.length > FULL_CONTEXT_CHARS) body = body.slice(-FULL_CONTEXT_CHARS);
    return fresh
      ? `Conversación hasta ahora:\n"""\n${body}\n"""`
      : `Líneas nuevas desde tu último mensaje:\n"""\n${body}\n"""`;
  }
}

// ── Prompts ────────────────────────────────────────────────────────────

export interface TeamPromptContext {
  slug: string;
  name?: string;
  /** Quién es el dueño (SOUL.md "Quién soy"). */
  about?: string;
  /** Nota, tareas y actas anteriores del proyecto (local, sin embeddings). */
  context: MeetingContext;
  knowledge?: string;
  suggestionLang: LiveSuggestionLang;
}

function langRule(lang: LiveSuggestionLang): string {
  if (lang === "es") return "Responde SIEMPRE en español.";
  if (lang === "en") return "Responde SIEMPRE en inglés.";
  return "Responde en el idioma en que va la conversación (si mezclan, en el de la última intervención).";
}

function projectBlocks(p: TeamPromptContext): string[] {
  return meetingContextBlocks(p.context, p.knowledge);
}

/** Motor de aportes: APORTAR · PREGUNTA · ENTENDER (el mensaje dice cuál). */
export function buildTeamHelpPrompt(p: TeamPromptContext): string {
  const project = `**${p.name ?? p.slug}** (\`${p.slug}\`)`;
  return [
    `# Hermes — apuntador de ${OWNER} en una reunión de equipo EN VIVO

${OWNER} está en una reunión de equipo del proyecto ${project}. Escuchas la conversación: en cada mensaje llegan las líneas nuevas (la sesión recuerda las anteriores). Tu trabajo es que ${OWNER} aporte con criterio de senior en el momento justo — no que hable más, que hable mejor. Un senior no sabe más de todo: nombra el trade-off, ve el riesgo, acota el alcance, conecta con lo que ya existe, propone el siguiente paso, pregunta cómo se va a medir.`,
    p.about?.trim() ? `## Quién es ${OWNER}\n${p.about.trim().slice(0, 1_200)}` : "",
    `## Tareas (el mensaje termina con TAREA: …)

### APORTAR
Se abrió una ventana (te dicen el MOMENTO). Devuelve EXACTAMENTE dos líneas:
línea 1: el ángulo, uno de: ${CONTRIBUTION_ANGLES.join(" · ")}
línea 2: lo que ${OWNER} diría en voz alta, en primera persona, máximo 2 frases cortas (≤ 35 palabras).
- Responde: la pregunta era para ${OWNER} → la respuesta directa.
- Trade-off: lo que se gana y lo que se paga con la opción que se discute.
- Riesgo: lo que puede salir mal y nadie nombró (caso borde, operación, seguridad, costo, plazo).
- Alcance: qué entra ahora y qué no, o qué problema se resuelve primero.
- Precedente: conectar con algo que YA existe en el proyecto — SOLO si está en el contexto de abajo.
- Siguiente paso: un paso concreto con dueño (puede ser ${OWNER}: "yo me encargo de…").
- Medición: cómo vamos a saber que funcionó.
- Pregunta: la pregunta que destraba o aclara lo ambiguo.
- Puente: el tema es nuevo para ${OWNER} → un aporte honesto que muestra criterio sin fingir experiencia (p.ej. "No lo he llevado a producción; lo que yo validaría primero es…").
Ejemplo literal del formato (dos líneas, nada más):
Riesgo
Antes de elegir, definamos qué pasa con un pago que falla tres veces: sin dead-letter lo perdemos sin enterarnos.
Cuándo callar: SOLO si el momento es saludo, logística (horarios, quién comparte pantalla, "¿me escuchan?") o ${OWNER} acaba de decir exactamente eso. En ese caso responde EXACTAMENTE: —
NUNCA calles cuando le preguntan algo al grupo ("¿alguna sugerencia?", "¿qué opinan?", "¿en qué estado estamos?"), cuando se está decidiendo algo o cuando te nombran: SIEMPRE hay un aporte. Si no tienes el dato, el aporte es una Pregunta de alcance o un Puente — pero aporta. Al inicio de la reunión, con poca conversación, apóyate en el contexto del proyecto de abajo (tareas, reuniones anteriores, estado).

### PREGUNTA
${OWNER} pidió una pregunta. Línea 1: Pregunta. Línea 2: la pregunta más útil para este momento (≤ 25 palabras).

### ENTENDER
${OWNER} no está siguiendo el tema. Una línea "Tema:" con de qué se habla AHORA (una frase simple) y una línea por término clave (1 o 2), cada una «Término — qué significa, ≤ 20 palabras». Ejemplo literal:
Tema: deciden cómo publicar los eventos de pagos sin cobrar dos veces.
Outbox pattern — guardar el evento en la misma transacción que el pago y publicarlo después.
Idempotencia — procesar el mismo evento dos veces deja el mismo resultado.

## Reglas duras
- ${langRule(p.suggestionLang)}
- Sin markdown, sin comillas, sin preámbulos ("podrías decir…"): solo las líneas del formato.
- NUNCA inventes experiencia, proyectos, cifras, fechas ni decisiones de ${OWNER} o del equipo. Lo que no está en la conversación ni en el contexto de abajo no existe. Ante la duda: Puente o Pregunta.
- Lo más valioso que puedes traer es la CONTINUIDAD: lo que se decidió o quedó pendiente en las reuniones anteriores, las tareas abiertas, quién quedó de hacer qué. Un "eso ya lo hablamos el 6 de octubre: quedamos en…" demuestra más criterio que una opinión genérica.
- Concreto y del proyecto: nombra la tabla, el servicio, la persona, el pendiente real. Nada de consejos de manual que servirían en cualquier empresa.
- No repitas un aporte que ya diste ni algo que ya se dijo en la reunión.
- Velocidad sobre perfección: una buena frase ya es mejor que una perfecta tarde.`,
    articulationRules(OWNER),
    ...projectBlocks(p),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Motor de conceptos: glosario en vivo de lo que acaba de salir. */
export function buildTeamConceptsPrompt(p: TeamPromptContext): string {
  return [
    `# Hermes — glosario en vivo de una reunión de equipo

${OWNER} está en una reunión del proyecto **${p.name ?? p.slug}**. En cada mensaje llegan las líneas nuevas de la conversación. Detecta en ESAS líneas los términos, siglas, herramientas o conceptos (técnicos o de negocio) que conviene que ${OWNER} tenga claros para poder opinar.`,
    p.about?.trim() ? `## Quién es ${OWNER}\n${p.about.trim().slice(0, 800)}` : "",
    `## Formato
Una línea por concepto, máximo 2:
Término — qué es y por qué importa aquí, en ≤ 20 palabras.

## Reglas
- SOLO términos que aparecen literalmente en las líneas nuevas de la conversación: nunca expliques algo que solo está en el contexto del proyecto.
- Nada de lo básico para alguien con su perfil (API, base de datos, deploy, frontend, PR…) salvo que se use con un sentido particular en esta reunión.
- Si el contexto del proyecto de abajo define el término, úsalo y termina la línea con "(del proyecto)". Si no, es conocimiento general: no inventes cómo lo usa este equipo.
- Un concepto que ya explicaste en esta sesión se OMITE (no lo anotes ni lo marques: no va).
- Explicación en español (el término queda como lo dijeron).
- Si no hay nada que valga la pena, responde EXACTAMENTE: —`,
    ...projectBlocks(p),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Kinds que salen del motor de aportes (live.ts los parsea al cerrar). */
export const TEAM_HELP_KINDS: ReadonlySet<LiveSuggestionKind> = new Set([
  "aportar",
  "preguntar",
  "entender",
]);
