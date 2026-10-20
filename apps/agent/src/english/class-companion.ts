/**
 * Compañera de clase de inglés EN VIVO: el modo "clase-ingles" de la junta en
 * vivo. Reemplaza al FastCopilotController (que sopla respuestas de junta)
 * por tres flujos pensados para APRENDER, no para que Hermes hable por ti:
 *
 * - corregir: cuando terminas de hablar (tus finales agrupados hasta 6 s de
 *   silencio, o hasta que la profe responde), UN error que valga la pena:
 *   «lo que dijiste → cómo se dice | regla». Motor en COLA, sin interrumpir:
 *   la corrección de hace 5 s sigue sirviendo aunque ya dijiste otra cosa.
 * - andamio: la profe te preguntó algo → 2-3 palabras clave + el arranque de
 *   una frase que terminas tú. Motor interrumpible (la pregunta nueva gana).
 * - explicar / frase completa: SOLO a mano ("¿Qué dijo?" / "Dame la frase").
 *
 * Antes de marcar "soy yo" no hay correcciones (no sabemos qué voz es la tuya)
 * pero el andamio funciona igual: la profe es la que pregunta.
 */
import {
  ARTICULATION_RULE_PREFIX,
  correctable,
  detectWeakPhrases,
  LEVEL_UP_PREFIX,
  type AutoHelpMode,
  type LiveHelpIntent,
  type LiveSuggestionKind,
} from "@hermes/shared";
import {
  detectQuestion,
  lastQuestion,
  lazyRequest,
  type FastCopilot,
  type FastEngine,
} from "../meetings/live-copilot.js";
import type { NormalizedTurn } from "../meetings/live-stt.js";
import { OWNER, ownerBlurb } from "../owner.js";

const SELF_MERGE_MS = 6_000; // tus finales separados por menos de esto son UNA intervención
// Entre dos ayudas AUTOMÁTICAS. La misma pregunta nunca se repite (se deduplica
// por texto), así que esto solo frena ráfagas de preguntas distintas.
const HELP_MIN_INTERVAL_MS = 1_200;
const EARLY_MIN_CHARS = 15;
const SELF_MAX_CHARS = 700;
// Contexto: cada motor es UNA sesión persistente que ya recuerda lo anterior,
// así que a cada mensaje solo va lo NUEVO. Al (re)arrancar la sesión va la
// conversación entera hasta este tope.
const FULL_CONTEXT_TURNS = 120;
const FULL_CONTEXT_CHARS = 14_000;

/** Prefijo de ids del motor de correcciones (live.ts las emite sin streaming). */
export const CORRECTION_ID_PREFIX = "corr-";

// ── Prompts ────────────────────────────────────────────────────────────

/**
 * Lo que la compañera sabe de ti (SOUL.md "Quién soy" + el contexto de práctica):
 * con esto la frase usa tus datos reales en vez de llenarse de [huecos].
 */
export interface CompanionKnowledge {
  recurring: string[];
  /** Quién es el dueño (SOUL.md). */
  about?: string;
  /** Últimas sesiones, drills y vocabulario por repasar. */
  practice?: string;
}

function knowledgeBlocks(k: CompanionKnowledge): string[] {
  return [
    k.about?.trim() ? `## Sobre ${OWNER} (datos reales, úsalos)\n${k.about.trim().slice(0, 1_800)}` : "",
    k.practice?.trim() ? `## Su práctica de inglés hasta hoy\n${k.practice.trim().slice(0, 900)}` : "",
    recurringBlock(k.recurring),
  ];
}

function recurringBlock(recurring: string[]): string {
  return recurring.length
    ? `## Errores que ${OWNER} ya repite (prioriza estos)\n${recurring.map((e) => `- ${e}`).join("\n")}`
    : "";
}

/**
 * Dónde está hablando: la clase real por Meet (profesora humana) o la
 * práctica por voz con la tutora de IA (Practicar ahora). Mismos flujos,
 * otro contexto en el prompt.
 */
export type CompanionSetting = "class" | "tutor";

function settingLine(setting: CompanionSetting): string {
  return setting === "tutor"
    ? "está practicando conversación en inglés por voz con su tutora de IA"
    : "está en una clase 1 a 1 por videollamada con su profesora";
}

export function buildCorrectionSystemPrompt(
  knowledge: CompanionKnowledge | string[],
  setting: CompanionSetting = "class",
): string {
  const k = Array.isArray(knowledge) ? { recurring: knowledge } : knowledge;
  return [
    `# Hermes — corrector discreto de inglés hablado EN VIVO

${OWNER}${ownerBlurb("English", " (hispanohablante que practica inglés hablado)")} ${settingLine(setting)}. Esta conversación es UNA sola sesión: recuerdas todo lo que te llegó antes. En cada mensaje te llegan las líneas nuevas de la conversación y lo que ${OWNER} ACABA de decir (sale de un STT: puede traer errores de transcripción).

Tu ÚNICO trabajo: si hay UN error de gramática o vocabulario que valga la pena corregir, devolverlo en UNA línea con este formato exacto:
lo que dijo → cómo se dice | regla en español (máximo 12 palabras)

Ejemplo exacto (siempre las tres partes, en ese orden):
client want a agent → client wants an agent | tercera persona: want → wants; "an" antes de vocal

## Qué corregir, en orden
1. Gramática o vocabulario: solo errores que afectan la claridad o que están en su lista de errores repetidos. Nada de "sonaría más natural", salvo un calco evidente del español.
2. Articulación — SOLO si no hay error del punto 1: si arrancó pidiendo permiso ("I just wanted to…", "quick question"), se disculpó por hablar ("sorry to…"), usó un "but" que borra lo anterior ("I totally understand, but…", "yes, but"), certeza de relleno ("obviously", "as you can see"), duda en algo que sí piensa ("I think maybe", "I guess") o cerró una respuesta seria con "so yeah" / "and that's it", devuelve la versión directa y pon la regla empezando LITERALMENTE con "${ARTICULATION_RULE_PREFIX}". Ejemplo exacto:
I just wanted to say that maybe we could try it → Let's try it this week | ${ARTICULATION_RULE_PREFIX} el punto primero, sin pedir permiso
   En una charla casual ("I guess it was fine") no corrijas articulación: solo cuando está dando una opinión, una propuesta o explicando algo.

## Reglas
- En "lo que dijo" va el fragmento corto (3-10 palabras), copiado tal cual; en "cómo se dice", ese mismo fragmento corregido.
- Si dudas de si fue un error del STT (palabra rara, homófono, frase cortada), NO corrijas.
- Una sola corrección por mensaje: la más importante.
- Si no hay nada que valga la pena corregir, responde EXACTAMENTE: —
- Sin markdown, sin comillas, sin preámbulos.`,
    recurringBlock(k.recurring),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Cómo se arma una respuesta hablada que suena segura. Son las reglas de
 * articulación del repo (shared/articulation.ts) aterrizadas a inglés de
 * clase, más lo que la profesora corrigió en las clases reales: respuestas
 * de entrevista largas y sin foco, "so yeah" para cerrar, pasado que se
 * resbala a presente y sujeto omitido ("is important").
 */
function spokenEnglishRules(): string {
  return `## Cómo suena lo que le das (articulación — es el inglés que va a repetir en voz alta)
- El punto primero: la PRIMERA frase responde exactamente lo que le preguntaron; el ejemplo o el porqué va después.
- Pregunta de dos partes ("what was the problem and how did you solve it?"): una frase por parte, en ese orden. Nada más.
- Verbo firme y sujeto explícito siempre ("It was hard because…", nunca "Was hard because…"): "I built", "I'd go with", "I decided" — no "I think maybe", "I just wanted to", "sorry to", "obviously".
- Sin "but" que borre lo anterior: "I see your point, and that's why…".
- Lo que ya pasó, en pasado de principio a fin.
- Si no le ha pasado (entrevista: "tell me about a time you…"), honesto y directo: "I haven't been in that situation yet, but if it happened, I would…". Nunca inventes una experiencia.
- Cierre limpio: termina en la idea ("…and that's how I solved it."). Jamás "so yeah", "and that's it", "something like that".
- Registro: si la profesora está haciendo una entrevista simulada o una conversación profesional, inglés de entrevista (claro, formal sin ser rígido, sin "yeah", "gonna", "stuff"). En charla casual, natural y cálido.
- Concreto: un dato real (un número, una herramienta, un resultado) vale más que un adjetivo.
- Para ganar tiempo con clase (solo si le pidieron pensar algo difícil): "That's a good question — let me think about that for a second."`;
}

export function buildHelpSystemPrompt(
  knowledge: CompanionKnowledge | string[],
  setting: CompanionSetting = "class",
): string {
  const k = Array.isArray(knowledge) ? { recurring: knowledge } : knowledge;
  return [
    `# Hermes — apoyo de inglés hablado EN VIVO

${OWNER}${ownerBlurb("English", " (hispanohablante que practica inglés hablado)")} ${settingLine(setting)} (abajo "la profesora" es quien conversa con él). Lo ayudas a HABLAR ÉL MISMO y a subir de nivel: cada cosa que le das es inglés que va a decir en voz alta, así que tiene que sonar seguro y ser un poco mejor que el que él armaría solo. Esta conversación es UNA sola sesión: recuerdas todo lo que se ha dicho (cada mensaje trae solo las líneas nuevas), así que tus respuestas tienen que ser coherentes con TODA la conversación — lo que él ya contó, lo que la profesora ya preguntó, el tema o ejercicio en el que están. En cada mensaje llega UN modo:

- ANDAMIO — la profesora le hizo una pregunta. Responde exactamente dos líneas:
  Clave: 2-3 palabras o expresiones en inglés útiles para responder, cada una con su traducción entre paréntesis, separadas por " · " (al menos una un escalón arriba de lo básico: "trade-off", "on the roadmap", "it paid off")
  Arranca: el comienzo de una frase en inglés (5-9 palabras) que él completa, terminado en "…" — que arranque por el punto ("The hardest part was…", "I'd go with…", "What I did was…"), nunca con "I just wanted to" ni "I think maybe"
- EXPLICAR — no entendió lo último que dijo la profesora. En español simple, 1-2 frases: qué dijo o qué le preguntó (y si es un ejercicio, qué espera que haga). Luego una línea "Clave: palabra = significado" con la palabra o expresión que probablemente no entendió.
- FRASE — la respuesta para decir YA, en primera persona. Formato:
  Línea 1: lo que dice, 1-2 frases, MÁXIMO 25 palabras (la lee mientras habla).
  Línea 2 (opcional): "${LEVEL_UP_PREFIX} expresión = significado en español" — SOLO si la línea 1 usa una expresión un escalón arriba de lo básico que vale la pena que aprenda. Una sola.
  · Charla general (cómo estás, cómo te fue, qué opinas): respuesta natural, SIN huecos — "It's been a busy week, but a good one — I shipped a feature I'm proud of."
  · Datos concretos de su vida o su trabajo: úsalos si están en la conversación o en "Sobre ${OWNER}" (abajo) — son reales. Solo si no están en ninguno de los dos, hueco entre corchetes en español, máximo 2 — "I built [qué cosa] last year, and it cut our deploy time in half."
  · Coherente con lo que ya dijo en esta conversación: no lo contradigas ni repitas lo que ya contó. Nunca inventes datos.

Ejemplo de ANDAMIO para "What did you do last weekend?" (las dos líneas empiezan LITERALMENTE con "Clave:" y "Arranca:"):
Clave: went hiking (fui de caminata) · recharged (recargué energía)
Arranca: Last weekend I mostly…

Ejemplo de FRASE para "Tell me about a technically challenging problem you've solved." (la segunda línea empieza LITERALMENTE con "${LEVEL_UP_PREFIX}"):
Our app crashed under heavy load, so I moved the slow work to a background queue — and it stopped crashing.
${LEVEL_UP_PREFIX} under heavy load = con mucha carga

${spokenEnglishRules()}

## Reglas
- Sin markdown, sin comillas alrededor de todo, sin preámbulos.
- En ANDAMIO y en FRASE automática, si el momento no lo amerita (no era una pregunta para ${OWNER}, ya respondió, es una pregunta retórica o de trámite como "Sound good?", "Can you hear me?", "Ready?"), responde EXACTAMENTE: —
- Velocidad sobre perfección: llega a tiempo o no sirve.`,
    ...knowledgeBlocks(k),
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── Controller ─────────────────────────────────────────────────────────

export interface ClassCompanionDeps {
  /** Cómo se llama a quien conversa contigo en el contexto ("Profe" / "Tutora"). */
  otherName?: string;
  /** Override para tests (default 6 s). */
  selfMergeMs?: number;
  /**
   * Qué sale SOLO cuando te preguntan: la frase completa (default, lo que
   * Rulo pidió: "siempre voy a necesitar esa ayuda"), el andamio, o nada.
   * Se cambia en caliente con setAutoHelp.
   */
  autoHelp?: AutoHelpMode;
}

interface LogLine {
  self: boolean;
  text: string;
}

/** Hasta dónde vio la conversación cada motor (y en qué sesión). */
interface Cursor {
  at: number;
  epoch: number;
}

const normQ = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Última oración COMPLETA (termina en . ! ?) — la que ya se puede contestar. */
export function lastCompleteSentence(text: string): string | null {
  const parts = text.match(/[^.!?]+[.!?]+/g);
  if (!parts) return null;
  const s = parts[parts.length - 1].trim();
  return s.length >= 8 ? s : null;
}

/**
 * ¿Lo que dijo la otra persona te pide responder? Pregunta con "?" o una
 * orden de las que piden hablar ("Tell me about…", "Describe…").
 */
export function askOf(text: string): string | null {
  const q = lastQuestion(text);
  if (q) return q;
  const s = lastCompleteSentence(text);
  return s && detectQuestion(s.replace(/[.!]+$/, "")).hit ? s : null;
}

// Preguntas de trámite: confirmar audio, ritmo o si siguió la idea. Sale de
// la clase real del 16-oct ("Sound good?", "Can you hear me okay?", "Which
// one?"): cada una arrancaba una ayuda que el modelo terminaba en "—".
const TRIVIAL_ASK =
  /^(?:(?:okay|ok|so|and|all right|alright|wait)[,\s]+)*(?:sound good|sounds good|can you hear me(?:\s+(?:okay|ok|now|well|alright))*|did you hear me|do you hear me|you hear me|ready|are you ready|right|okay|ok|got it|make sense|does that make sense|you know|you see|what(?:'s| is) that|what|really|yes|no|which one|how do you spell (?:that|it)|is that (?:okay|ok|clear)|any questions|questions|you okay|all good)\s*[?.!]*$/i;

/** ¿La pregunta de la profe pide una respuesta de verdad, o es de trámite? */
export function worthAnswering(question: string): boolean {
  const q = question.trim();
  if (TRIVIAL_ASK.test(q)) return false;
  // Menos de tres palabras casi nunca es una pregunta para responder con una frase.
  return q.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length >= 3;
}

export class ClassCompanionController implements FastCopilot {
  private selfBuffer: string[] = [];
  private selfTimer: NodeJS.Timeout | null = null;
  private lastHelpAt = 0;
  private selfSpeaker: string | undefined;
  private readonly countedKeys = new Set<string>();
  /** Preguntas ya atendidas (la del streaming no se repite con el final). */
  private readonly answered = new Set<string>();
  private readonly log: LogLine[] = [];
  private readonly cursors = new Map<FastEngine, Cursor>();
  private seq = 0;
  private destroyed = false;
  private autoHelp: AutoHelpMode;

  constructor(
    private readonly correctEngine: FastEngine,
    private readonly helpEngine: FastEngine,
    private readonly deps: ClassCompanionDeps,
  ) {
    this.autoHelp = deps.autoHelp ?? "full";
  }

  setAutoHelp(mode: AutoHelpMode): void {
    this.autoHelp = mode;
  }

  onTurn(turn: NormalizedTurn, selfSpeaker: string | undefined): void {
    if (this.destroyed) return;
    this.selfSpeaker = selfSpeaker;
    const text = turn.text.trim();
    if (!text) return;
    const isSelf = !!selfSpeaker && turn.speaker === selfSpeaker;

    if (turn.final && !this.countedKeys.has(turn.key)) {
      this.countedKeys.add(turn.key);
      this.log.push({ self: isSelf, text });
      // Tu voz: se junta hasta que callas (o responde la profe) y va al corrector.
      if (isSelf) {
        this.selfBuffer.push(text);
        if (this.selfTimer) clearTimeout(this.selfTimer);
        this.selfTimer = setTimeout(() => this.flushSelf(), this.deps.selfMergeMs ?? SELF_MERGE_MS);
        return;
      }
      // La profe habló: tu intervención terminó.
      this.flushSelf();
    }
    if (isSelf) return;

    // Te preguntaron algo → la ayuda automática. Con el final o, antes, con
    // el end_of_turn crudo (gana ~300-800 ms sobre el final formateado).
    if (turn.final) {
      const ask = askOf(text);
      if (ask) this.autoAsk(ask, null);
    } else if (turn.endOfTurn && text.length >= EARLY_MIN_CHARS && detectQuestion(text).hit) {
      this.autoAsk(text.slice(-160), text);
    }
  }

  /**
   * Lo que la otra persona VA diciendo (texto en streaming, aún sin cerrar su
   * turno): apenas completa una pregunta, la ayuda arranca — no hay que
   * esperar a que termine de hablar.
   */
  onPartialOther(text: string): void {
    if (this.destroyed) return;
    const ask = askOf(text.trim());
    if (ask) this.autoAsk(ask, text.trim());
  }

  triggerNow(reason?: string, intent: LiveHelpIntent = "scaffold"): void {
    if (this.destroyed) return;
    this.help(intent, reason ?? null, null, true);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.selfTimer) clearTimeout(this.selfTimer);
    this.selfTimer = null;
    this.selfBuffer = [];
    this.correctEngine.destroy();
    this.helpEngine.destroy();
  }

  private autoAsk(question: string, inProgress: string | null): void {
    if (this.autoHelp === "off") return;
    if (!worthAnswering(lastCompleteSentence(question) ?? question)) return;
    const key = normQ(question);
    if (!key || this.answered.has(key)) return;
    if (Date.now() - this.lastHelpAt < HELP_MIN_INTERVAL_MS) return;
    this.answered.add(key);
    this.help(this.autoHelp === "full" ? "full" : "scaffold", question, inProgress, false);
  }

  /**
   * Contexto para un motor: la conversación entera si su sesión es nueva (o
   * se reinició), y si no, solo las líneas que aún no vio.
   */
  private contextFor(engine: FastEngine): string {
    const epoch = engine.epoch?.() ?? 0;
    const cur = this.cursors.get(engine);
    const fresh = !cur || cur.epoch !== epoch;
    const from = fresh ? Math.max(0, this.log.length - FULL_CONTEXT_TURNS) : cur.at;
    this.cursors.set(engine, { at: this.log.length, epoch });
    const lines = this.log.slice(from).map((l) => `${l.self ? "Yo" : (this.deps.otherName ?? "Profe")}: ${l.text}`);
    if (!lines.length) return fresh ? "(La conversación aún no empieza.)" : "(Sin líneas nuevas.)";
    let body = lines.join("\n");
    if (body.length > FULL_CONTEXT_CHARS) body = body.slice(-FULL_CONTEXT_CHARS);
    return fresh
      ? `Conversación hasta ahora:\n"""\n${body}\n"""`
      : `Líneas nuevas desde tu último mensaje:\n"""\n${body}\n"""`;
  }

  private flushSelf(): void {
    if (this.selfTimer) clearTimeout(this.selfTimer);
    this.selfTimer = null;
    const said = this.selfBuffer.join(" ").slice(-SELF_MAX_CHARS);
    this.selfBuffer = [];
    if (!correctable(said)) return; // corto o en español: nada que corregir
    this.seq += 1;
    // Señales de articulación que vio el detector: pista, no orden (la gramática va primero).
    const weak = detectWeakPhrases(said, "en");
    const hint = weak.length ? `\nSeñales de articulación: ${weak.map((h) => `«${h.match}»`).join(", ")}.` : "";
    const build = (engine: FastEngine) => `${this.contextFor(engine)}

Lo que ${OWNER} acaba de decir (corrige esto):
"""
${said}
"""${hint}

Corrección (o —):`;
    this.correctEngine.generate(
      lazyRequest(
        {
          id: `${CORRECTION_ID_PREFIX}${this.seq}`,
          // El trigger viaja de vuelta en el done: es el "lo que dijo" de respaldo.
          trigger: said.slice(-300),
          manual: false,
          kind: "corregir",
        },
        build,
        this.correctEngine,
      ),
    );
  }

  private lastOther(): string {
    for (let i = this.log.length - 1; i >= 0; i--) if (!this.log[i].self) return this.log[i].text;
    return "";
  }

  private help(
    intent: LiveHelpIntent,
    question: string | null,
    inProgress: string | null,
    manual: boolean,
  ): void {
    this.lastHelpAt = Date.now();
    this.seq += 1;
    const kind: LiveSuggestionKind =
      intent === "explain" ? "explicar" : intent === "full" ? "decir" : "andamio";
    const lastOther = inProgress ?? this.lastOther();
    const other = this.deps.otherName === "Tutora" ? "la tutora" : "la profesora";
    const mode =
      intent === "explain"
        ? `Modo: EXPLICAR. Lo último que dijo ${other}: "${lastOther || "(no se escuchó nada aún)"}"`
        : intent === "full"
          ? manual
            ? `Modo: FRASE. ${OWNER} pidió la respuesta completa para lo que le preguntaron${question ? `: "${question}"` : lastOther ? `: "${lastOther}"` : ""}.`
            : `Modo: FRASE (automática). ${other[0].toUpperCase()}${other.slice(1)} le pregunta: "${question ?? lastOther}". Dale la respuesta para decir YA (línea 1 de máximo 25 palabras, el punto primero, coherente con toda la conversación; "${LEVEL_UP_PREFIX}" opcional); si no era una pregunta para él, responde —.`
          : `Modo: ANDAMIO. Pregunta de ${other}: "${question ?? lastOther}"`;
    const trigger =
      intent === "explain" ? "¿Qué dijo?" : intent === "full" && manual ? "frase completa" : (question ?? lastOther).slice(0, 160);
    const live = inProgress ? `\n\n${other[0].toUpperCase()}${other.slice(1)} aún está hablando; lo que lleva dicho: "${inProgress.slice(-400)}"` : "";
    this.helpEngine.generate(
      lazyRequest(
        { id: `help-${this.seq}`, trigger, manual, kind },
        (engine) => `${this.contextFor(engine)}${live}\n\n${mode}`,
        this.helpEngine,
      ),
    );
  }
}
