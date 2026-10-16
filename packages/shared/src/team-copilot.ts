/**
 * Reunión de equipo EN VIVO (modo "equipo" de la junta en vivo): lógica pura
 * que comparten el agente y el dashboard. Sin timers ni red.
 *
 * El problema que resuelve no es "responder cuando me preguntan" (eso ya lo
 * hacía la capa rápida) sino lo que pasa en una reunión de equipo: casi nadie
 * te pregunta a ti, el tema puede ser nuevo y la ventana para aportar se
 * cierra en segundos. De aquí salen:
 *
 * - qué cuenta como VENTANA para aportar (detectOpening: te nombran, piden
 *   opinión al grupo, se está decidiendo algo, alguien plantea un problema);
 * - cómo se lee un aporte (ángulo + frase) y un concepto (término — línea);
 * - el repaso al cerrar: qué ventanas hubo, en cuáles hablaste (dato del
 *   transcript, no opinión del modelo) y qué conceptos quedan para estudiar.
 */
import type { LiveSegment, LiveSuggestion } from "./types.js";

/** Key del modo en COACH_MODES y en el snapshot. */
export const TEAM_COACH_MODE = "equipo";

/**
 * Ángulos de un aporte con criterio. Un senior no sabe más de todo: nombra el
 * trade-off, ve el riesgo, acota el alcance, conecta con lo que ya existe,
 * propone el siguiente paso o pregunta cómo se va a medir. "Responde" es la
 * respuesta directa cuando la pregunta era para ti; "Puente" es el aporte
 * honesto cuando el tema es nuevo (criterio sin fingir experiencia).
 */
export const CONTRIBUTION_ANGLES = [
  "Responde",
  "Trade-off",
  "Riesgo",
  "Alcance",
  "Precedente",
  "Siguiente paso",
  "Medición",
  "Pregunta",
  "Puente",
] as const;
export type ContributionAngle = (typeof CONTRIBUTION_ANGLES)[number];

/** Minúsculas sin tildes ni signos: para comparar etiquetas y términos. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ANGLE_BY_KEY = new Map<string, ContributionAngle>(
  CONTRIBUTION_ANGLES.map((a) => [foldText(a).replace(/\s/g, ""), a]),
);
// Variantes que el modelo escribe a veces.
ANGLE_BY_KEY.set("tradeoffs", "Trade-off");
ANGLE_BY_KEY.set("siguientepasos", "Siguiente paso");
ANGLE_BY_KEY.set("respuesta", "Responde");
ANGLE_BY_KEY.set("puentehonesto", "Puente");
ANGLE_BY_KEY.set("medicion", "Medición");

function angleOf(label: string): ContributionAngle | undefined {
  return ANGLE_BY_KEY.get(foldText(label).replace(/\s/g, ""));
}

const QUOTES = /^[\s"'“”«»‘’`*]+|[\s"'“”«»‘’`*]+$/g;
const unquote = (t: string) => t.replace(QUOTES, "").trim();

/**
 * Lee un aporte del modelo: primera línea = ángulo, el resto = la frase.
 * Acepta también "Riesgo: frase" en una sola línea. "—" o vacío = silencio.
 * Sin ángulo reconocible la frase se conserva entera (mejor una tarjeta sin
 * etiqueta que perder lo que dijo).
 */
export function parseContribution(raw: string): { angle?: ContributionAngle; text: string } | null {
  const t = raw.trim();
  if (!t || /^[—–-]+$/.test(t)) return null;
  const lines = t.split("\n").map((l) => l.trim()).filter(Boolean);
  const first = lines[0].replace(/^[#>*\-\s]+/, "");
  const m = /^([^:·—\n]{2,24}?)\s*[:·—]\s*(.*)$/.exec(first);
  const head = m ? m[1] : first;
  const angle = angleOf(unquote(head));
  if (!angle) return { text: unquote(lines.join("\n")) };
  const rest = [m?.[2] ?? "", ...lines.slice(1)].filter((l) => l.trim()).join("\n");
  const text = unquote(rest);
  return text ? { angle, text } : null;
}

export interface TeamConcept {
  term: string;
  explanation: string;
}

/**
 * Lee los conceptos del motor de "entender": una línea por concepto,
 * «Término — explicación» (o con ":"), máximo `max`. "—" = nada nuevo.
 */
export function parseConcepts(raw: string, max = 2): TeamConcept[] {
  const out: TeamConcept[] = [];
  for (const line of raw.split("\n")) {
    const l = line.trim().replace(/^[-*•\d.)\s]+/, "");
    if (!l || /^[—–-]+$/.test(l)) continue;
    const m = /^(.{2,60}?)\s+[—–]\s+(.+)$/.exec(l) ?? /^([^:]{2,60}):\s+(.+)$/.exec(l);
    if (!m) continue;
    const term = unquote(m[1]);
    // El modelo a veces anota en vez de omitir ("(ya explicado, no repitas)"):
    // una nota así nunca es parte de la explicación.
    const explanation = unquote(m[2].replace(/\s*\((?:ya |no )[^)]*\)/gi, ""));
    if (!term || explanation.length < 8) continue;
    out.push({ term, explanation });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * ¿El término se DIJO? `saidFolded` = lo dicho, ya pasado por foldText. Basta
 * su primera palabra con sustancia: "Outbox pattern" cuenta si dijeron
 * "outbox". El modelo a veces explica algo que solo está en el contexto del
 * proyecto, y eso es ruido en plena reunión.
 */
export function conceptMentioned(term: string, saidFolded: string): boolean {
  const t = foldText(term);
  if (!t) return false;
  if (saidFolded.includes(t)) return true;
  const head = t.split(" ").find((w) => w.length >= 4) ?? t.split(" ")[0];
  return head.length >= 3 && new RegExp(`\\b${head}`).test(saidFolded);
}

/** Clave para no explicar dos veces el mismo concepto en una reunión. */
export const conceptKey = (term: string) => foldText(term);

/** Texto de la tarjeta de un concepto (el parser del front lo separa por " — "). */
export const conceptText = (c: TeamConcept) => `${c.term} — ${c.explanation}`;

// ── Ventanas para aportar ──────────────────────────────────────────────

/**
 * Por qué este momento es una ventana: te nombraron · piden opinión al grupo ·
 * se está decidiendo algo · alguien plantea un problema.
 */
export type OpeningKind = "named" | "opinion" | "decision" | "problem";

// Sobre texto plegado (sin tildes, minúsculas): las regex no llevan acentos.
const OPINION =
  /\b(que (opinan|piensan|creen|les parece|dicen)|que opinas|que piensas|que te parece|como lo ven|como ven|alguien (tiene|quiere|mas|sabe|ve)|algun comentario|algun aporte|what do you (all |guys )?think|any (thoughts|ideas|questions|concerns|objections|input)|thoughts|does anyone|anyone (have|else|want)|how do you (all )?feel)\b/;
// Sueltas solo cuentan en pregunta: "¿ideas?" pide opinión, "tengo ideas" no.
const OPINION_WEAK = /\b(comentarios|ideas|sugerencias|propuestas|aportes|thoughts|opinions|input)\b/;
const DECISION =
  /\b(entonces (hacemos|vamos|quedamos|definimos|decidimos|arrancamos)|quedamos en|hay que (decidir|definir|elegir)|tenemos que (decidir|definir|elegir|priorizar)|vamos con|propongo|mi propuesta|la propuesta es|la idea es|el plan es|lets go with|let s go with|we (need|have) to (decide|choose|pick)|the plan is|i propose|my proposal|should we|shall we)\b/;
const PROBLEM =
  /\b(el problema (es|que|con)|no sabemos|no esta claro|estamos bloqueados|nos bloquea|el riesgo|me preocupa|no funciona|se cayo|esta fallando|the (problem|issue|risk|blocker) is|we re (blocked|stuck)|were (blocked|stuck)|not sure (how|if|whether)|i m worried|im worried)\b/;

/**
 * ¿Este turno de OTRA persona abre una ventana para aportar? `names` son las
 * formas en que te llaman (nombre del dueño, apodo); con cualquiera como
 * palabra suelta gana "named". Es local y barata a propósito: un falso
 * positivo cuesta un turno corto del modelo, que responde "—" si no amerita.
 */
export function detectOpening(text: string, names: string[] = []): OpeningKind | null {
  const t = foldText(text);
  if (!t) return null;
  for (const n of names) {
    const k = foldText(n);
    if (k.length >= 3 && new RegExp(`\\b${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t))
      return "named";
  }
  if (OPINION.test(t) || (text.includes("?") && OPINION_WEAK.test(t))) return "opinion";
  if (DECISION.test(t)) return "decision";
  if (PROBLEM.test(t)) return "problem";
  return null;
}

/** Frase corta de por qué es ventana (va en el `why` de la tarjeta). */
export const OPENING_WHY: Record<OpeningKind | "question" | "quiet", string> = {
  named: "te nombraron",
  opinion: "pidieron opinión al grupo",
  decision: "se está decidiendo algo",
  problem: "plantearon un problema",
  question: "hicieron una pregunta",
  quiet: "llevas rato sin intervenir",
};

// ── Repaso al cerrar ───────────────────────────────────────────────────

/**
 * Tomaste la ventana si EMPEZASTE a hablar dentro de este margen después de que
 * se abrió (leer la tarjeta y decidir toma unos segundos). Más largo que esto
 * ya no es "aprovechar el momento": en una reunión movida casi todos hablan en
 * cualquier minuto y la métrica diría que sí siempre.
 */
export const WINDOW_GRACE_MS = 20_000;
/** Tolerancia hacia atrás: la tarjeta llega ~2 s después de la frase que abrió la ventana. */
const WINDOW_LEAD_MS = 2_000;

export interface TeamWindow {
  atMs: number;
  angle?: string;
  text: string;
  why: string;
  /** Hablaste dentro del margen · null = no se sabe (no marcaste cuál voz es la tuya). */
  spoke: boolean | null;
}

/**
 * Las ventanas reales de la reunión = los aportes que el copiloto sopló SOLO
 * (no los pedidos a mano: esos los abriste tú). Si hablaste después de cada
 * una sale del transcript, no del modelo.
 */
export function teamWindows(
  suggestions: LiveSuggestion[],
  segments: LiveSegment[],
  selfSpeaker: string | undefined | null,
  graceMs = WINDOW_GRACE_MS,
): TeamWindow[] {
  const mine = selfSpeaker
    ? segments.filter((s) => s.final && s.speaker === selfSpeaker && s.text.trim())
    : [];
  return suggestions
    .filter((s) => s.kind === "aportar" && !s.manual)
    .map((s) => ({
      atMs: s.atMs,
      angle: s.angle,
      text: s.text,
      why: s.why,
      spoke: selfSpeaker
        ? mine.some(
            (seg) => seg.startMs >= s.atMs - WINDOW_LEAD_MS && seg.startMs <= s.atMs + graceMs,
          )
        : null,
    }));
}

function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Sección "## Repaso" del acta: ventanas (con si hablaste o no) y conceptos
 * para estudiar. "" si no hubo nada — sin fuente, sin sección.
 */
export function teamReviewMarkdown(
  suggestions: LiveSuggestion[],
  segments: LiveSegment[],
  selfSpeaker: string | undefined | null,
): string {
  const windows = teamWindows(suggestions, segments, selfSpeaker);
  const seen = new Set<string>();
  const concepts: TeamConcept[] = [];
  for (const s of suggestions) {
    if (s.kind !== "entender") continue;
    for (const c of parseConcepts(s.text, 3)) {
      if (/^tema$/i.test(c.term)) continue; // la línea "Tema:" de "¿De qué hablan?"
      const k = conceptKey(c.term);
      if (seen.has(k)) continue;
      seen.add(k);
      concepts.push(c);
    }
  }
  if (!windows.length && !concepts.length) return "";
  const parts = ["## Repaso"];
  if (windows.length) {
    const taken = windows.filter((w) => w.spoke).length;
    const known = windows.some((w) => w.spoke !== null);
    parts.push(
      `### Ventanas para aportar (${windows.length}${known ? ` · hablaste en ${taken}` : ""})`,
      windows
        .map((w) => {
          const mark = w.spoke === null ? "" : w.spoke ? " · ✓ hablaste" : " · ○ no hablaste";
          return `- **${clock(w.atMs)}${w.angle ? ` · ${w.angle}` : ""}** — ${w.text.replace(/\n/g, " ")} _(${w.why})_${mark}`;
        })
        .join("\n"),
    );
    if (!known)
      parts.push("_No se marcó cuál voz era la tuya: no se sabe en cuáles hablaste._");
  }
  if (concepts.length) {
    parts.push(
      "### Para estudiar",
      concepts.map((c) => `- **${c.term}** — ${c.explanation}`).join("\n"),
    );
  }
  return `${parts.join("\n\n")}\n\n`;
}

// ── Loop estratégico en texto (sesión persistente, sin tools) ─────────

export type StrategicKind = "decir" | "preguntar" | "dato" | "rumbo";
const STRATEGIC_KINDS = new Set<StrategicKind>(["decir", "preguntar", "dato", "rumbo"]);

/**
 * Lee la salida del loop estratégico: una línea por sugerencia,
 * «tipo | sugerencia | por qué» (máximo `max`). "—" = nada que soplar. Antes
 * era una tool del Agent SDK: cada corrida lanzaba un CLI, gastaba una vuelta
 * en cargar la tool y otra en un mensaje final que nadie leía (11-16 s). En
 * texto, sobre una sesión que ya vive, llega en ~2-3 s.
 */
export function parseStrategic(
  raw: string,
  max = 3,
): { kind: StrategicKind; text: string; why: string }[] {
  const out: { kind: StrategicKind; text: string; why: string }[] = [];
  for (const line of raw.split("\n")) {
    const parts = line
      .replace(/^[-*•\d.)\s]+/, "")
      .split("|")
      .map((p) => unquote(p));
    if (parts.length < 2) continue;
    const kind = foldText(parts[0]) as StrategicKind;
    if (!STRATEGIC_KINDS.has(kind) || !parts[1]) continue;
    out.push({ kind, text: parts[1], why: parts.slice(2).join(" | ") });
    if (out.length >= max) break;
  }
  return out;
}
