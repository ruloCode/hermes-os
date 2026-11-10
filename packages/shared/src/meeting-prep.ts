/**
 * v6 «Núcleo» · Preparación de junta (openspec/changes/v6-nucleo/specs/juntas).
 *
 * La hoja que se lee UN minuto antes de entrar: objetivo, hasta tres preguntas,
 * lo que el dueño prometió, pendientes abiertos y riesgos. Aquí vive todo lo
 * que NO necesita modelo ni disco:
 *
 *  - qué quedó abierto y qué prometió el dueño, leído de las actas y las tareas;
 *  - la regla dura del paquete, `validatePrep`: un punto redactado por el modelo
 *    solo se muestra si cita una fuente que EXISTE entre las que se le dieron;
 *  - a qué proyecto corresponde un evento del calendario (o a ninguno);
 *  - la huella de las fuentes: con un acta nueva, la hoja de hoy se rehace;
 *  - el bloque que recibe el copiloto en vivo y el estado de la tarjeta web.
 *
 * Lo consume el agente (meetings/prep.ts), la web (tarjeta de inicio) y el
 * teléfono (por el JSON de `/meetings/prep*`): por eso la forma `MeetingPrep`
 * está versionada y documentada en las notas de la spec.
 */
import { guessLang } from "./english-class.js";

// ── Forma de la hoja ───────────────────────────────────────────────────

/** De dónde puede salir un punto: un acta, una tarea, la nota del proyecto o el evento. */
export type PrepSourceKind = "meeting" | "task" | "note" | "event";

export interface PrepSource {
  kind: PrepSourceKind;
  /** Id del acta, id de la tarea, id del evento, o "nota" para la nota del proyecto. */
  ref: string;
  /** Día (AAAA-MM-DD) del acta o del evento; las tareas y la nota no llevan. */
  date?: string;
  /** Texto corto para mostrar junto al punto: título del acta, de la tarea o del evento. */
  label: string;
}

export interface PrepPoint {
  text: string;
  source: PrepSource;
  /** Una línea más de contexto (el `one_liner` del accionable). */
  detail?: string;
}

/**
 * ready = hoja completa · no-history = el proyecto no tiene actas ni tareas (no
 * se llamó al modelo) · draft-failed = hay pendientes y promesas, pero la
 * redacción (objetivo, preguntas, riesgos, apertura) falló.
 */
export type PrepStatus = "ready" | "no-history" | "draft-failed";

export interface MeetingPrep {
  version: 1;
  project: string;
  projectName?: string;
  /** Día local (AAAA-MM-DD) para el que vale la hoja. */
  day: string;
  generatedAt: string;
  /** Huella de las fuentes con que se armó (ver `prepFingerprint`). */
  fingerprint: string;
  status: PrepStatus;
  /** Motivo en palabras cuando `status` no es `ready`. */
  note?: string;
  /** Idioma en que se habla en las reuniones del proyecto: preguntas y apertura van en él. */
  language: "es" | "en";
  event?: { title: string; startsAt: string };
  objective: PrepPoint | null;
  questions: PrepPoint[];
  pending: PrepPoint[];
  promises: PrepPoint[];
  decisions: PrepPoint[];
  risks: PrepPoint[];
  opener: PrepPoint | null;
  /** Todas las fuentes que se le dieron al modelo (y las únicas citables). */
  sources: PrepSource[];
  /** Puntos que el modelo redactó y se descartaron por no citar una fuente válida. */
  dropped: number;
}

export const PREP_MAX_QUESTIONS = 3;
export const PREP_MAX_RISKS = 3;
export const PREP_MAX_PENDING = 8;
export const PREP_MAX_PROMISES = 6;
export const PREP_MAX_DECISIONS = 5;
const POINT_MAX_CHARS = 320;
const QUOTE_MAX_CHARS = 220;

/** La clave con que el modelo cita una fuente: `meeting:<id>`, `task:<id>`, `note:nota`, `event:<id>`. */
export function prepSourceKey(s: Pick<PrepSource, "kind" | "ref">): string {
  return `${s.kind}:${s.ref}`;
}

export const PREP_NOTE_REF = "nota";

// ── Entradas (lo que el agente lee del vault y de la tabla de tareas) ───

export interface PrepActionableInput {
  idx: number;
  title: string;
  one_liner?: string;
  /** Estado de triage; ausente = nunca se decidió (sigue abierto). */
  status?: string | null;
}

export interface PrepMeetingInput {
  id: string;
  /** ISO o AAAA-MM-DD. */
  fecha: string;
  title: string;
  summary: string;
  /** Párrafos `**Nombre:** texto`, como los guarda el acta. */
  transcript?: string;
  /** Etiqueta del proveedor de STT del hablante marcado «soy yo» en la junta en vivo (coach). */
  selfSpeaker?: string;
  /**
   * Palabras por etiqueta, en el orden del coach (`coach.metrics.bySpeaker`). La
   * transcripción no guarda etiquetas sino «Hablante N» por orden de aparición:
   * con esto se sabe cuál «Hablante N» es el dueño (ver `selfSpeakerName`).
   */
  speakerWords?: Record<string, number>;
  actionables: PrepActionableInput[];
}

export interface PrepTaskInput {
  id: number | string;
  title: string;
  status: string;
  /** Si la tarea nació de un accionable, su acta e índice (para no listarla dos veces). */
  meetingId?: string | null;
  meetingIdx?: number | null;
}

export interface PrepEventInput {
  id: string;
  title: string;
  /** ISO del inicio. */
  start: string;
  end?: string | null;
  allDay?: boolean;
}

export interface PrepInputs {
  /** De la más reciente a la más vieja. */
  meetings: PrepMeetingInput[];
  tasks: PrepTaskInput[];
  /** «Tareas Pendientes» de la nota del proyecto. */
  noteTasks: string[];
  /** La nota tiene contenido que el modelo va a leer (se vuelve citable). */
  hasNote: boolean;
  /** Nombre del dueño y sus alias: así se sabe qué frases son SUYAS. */
  ownerNames: string[];
  event?: PrepEventInput | null;
}

export interface PrepFacts {
  sources: PrepSource[];
  pending: PrepPoint[];
  promises: PrepPoint[];
  decisions: PrepPoint[];
  /** false = ni actas ni tareas: no hay de qué preparar (no se llama al modelo). */
  hasHistory: boolean;
  language: "es" | "en";
}

// ── Texto ──────────────────────────────────────────────────────────────

// Límites de palabra que entienden tildes y eñes (`\b` de JS es solo ASCII:
// "mañana" o "envío" quedarían partidas).
const B = "(?<![\\p{L}\\p{N}])";
const E = "(?![\\p{L}\\p{N}])";
const word = (alternatives: string, flags = "iu"): RegExp => new RegExp(`${B}(?:${alternatives})${E}`, flags);

/** Minúsculas y sin puntuación, CONSERVANDO tildes: «confirmo» (yo) no es «confirmó» (él). */
function lowerClean(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Para comparar títulos: sin tildes, sin puntuación, minúsculas. */
function fold(text: string): string {
  return lowerClean(text.normalize("NFD").replace(/[̀-ͯ]/g, ""));
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function dayOf(fecha: string): string {
  return fecha.slice(0, 10);
}

/** Frases de un párrafo. Corta en punto/interrogación/exclamación seguidos de mayúscula, y en saltos de línea. */
export function prepSentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?…])\s+(?=[\p{Lu}¿¡"“(])/u))
    .map((s) => s.replace(/^[\s\-*•]+/, "").trim())
    .filter(Boolean);
}

/** Cláusulas: las actas encadenan compromisos con punto y coma («X hace A; Y hace B»). */
function clauses(text: string): string[] {
  return prepSentences(text).flatMap((s) => s.split(/\s*;\s+/)).map((s) => s.trim()).filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Pendientes abiertos ────────────────────────────────────────────────

const CLOSED = new Set(["done", "dismissed"]);

// Palabras que no distinguen una tarea de otra.
const STOP = new Set(
  "para con del las los una uno unos unas que por como sobre entre desde hasta este esta estos estas ese esa the and for with from into that this".split(" "),
);
// «1 min» y «1 minuto», «60 s»: abreviaturas que las actas usan indistintamente.
const SYNONYM: Record<string, string> = { min: "minuto", minutos: "minuto", seg: "segundo", segundos: "segundo" };

function taskTokens(text: string): Set<string> {
  return new Set(
    fold(text.replace(/\[\[[^\]]*\]\]|\([^)]*\)/g, " ")) // fuera wikilinks y paréntesis: son referencias, no la tarea
      .split(" ")
      .map((t) => SYNONYM[t] ?? t)
      .filter((t) => t.length >= 3 && !STOP.has(t)),
  );
}

/**
 * ¿Dos títulos son la misma tarea? Por solapamiento de términos (no por
 * prefijo: las actas reescriben «Grabar el video de 1 min…» con otras
 * palabras en cada junta). Mismo criterio que la dedup del perfil (USER.md).
 */
export function sameTask(a: string, b: string): boolean {
  const ta = taskTokens(a);
  const tb = taskTokens(b);
  if (!ta.size || !tb.size) return fold(a) === fold(b);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared >= 2 && shared / Math.min(ta.size, tb.size) >= 0.75;
}

function isOpen(status: string | null | undefined): boolean {
  return !CLOSED.has(String(status ?? "").toLowerCase());
}

function meetingSource(m: PrepMeetingInput): PrepSource {
  return { kind: "meeting", ref: m.id, date: dayOf(m.fecha), label: m.title.trim() || m.id };
}

const NOTE_SOURCE: PrepSource = { kind: "note", ref: PREP_NOTE_REF, label: "Nota del proyecto" };

/**
 * Lo que sigue abierto, de lo más reciente a lo más viejo: accionables de las
 * actas que no se cerraron ni se ignoraron, tareas del proyecto en curso o por
 * hacer, y las «Tareas Pendientes» de la nota. Una tarea que nació de un
 * accionable ya listado no se repite (ni una de la nota con el mismo título).
 */
export function openPending(input: Pick<PrepInputs, "meetings" | "tasks" | "noteTasks">, max = PREP_MAX_PENDING): PrepPoint[] {
  const out: PrepPoint[] = [];
  const seenTitles: string[] = [];
  const seenActionables = new Set<string>();
  const known = (title: string): boolean => seenTitles.some((t) => sameTask(t, title));
  const push = (point: PrepPoint): void => {
    if (!fold(point.text) || known(point.text)) return; // la más reciente gana: se recorre de nueva a vieja
    seenTitles.push(point.text);
    out.push(point);
  };

  for (const m of input.meetings) {
    for (const a of m.actionables) {
      seenActionables.add(`${m.id}#${a.idx}`);
      if (!a.title.trim() || !isOpen(a.status)) {
        // Cerrado: su título tampoco debe volver a entrar por la tabla de tareas.
        if (a.title.trim()) seenTitles.push(a.title);
        continue;
      }
      push({
        text: clip(a.title, POINT_MAX_CHARS),
        source: meetingSource(m),
        ...(a.one_liner?.trim() ? { detail: clip(a.one_liner, POINT_MAX_CHARS) } : {}),
      });
    }
  }
  for (const t of input.tasks) {
    if (!isOpen(t.status) || !t.title.trim()) continue;
    if (t.meetingId && seenActionables.has(`${t.meetingId}#${t.meetingIdx ?? -1}`)) continue;
    push({
      text: clip(t.title, POINT_MAX_CHARS),
      source: { kind: "task", ref: String(t.id), label: clip(t.title, 80) },
    });
  }
  for (const title of input.noteTasks) {
    if (!title.trim()) continue;
    push({ text: clip(title, POINT_MAX_CHARS), source: NOTE_SOURCE });
  }
  return out.slice(0, max);
}

// ── Promesas del dueño ─────────────────────────────────────────────────
//
// Dos evidencias, las dos conservadoras (mejor callar una promesa que
// atribuirle una que no hizo):
//  1. SU voz en la transcripción (el hablante marcado «soy yo», o un hablante
//     con su nombre) diciendo un compromiso en primera persona.
//  2. El resumen del acta nombrándolo con un verbo de compromiso
//     («<dueño> quedó de avisar…», «<dueño> debe enviar…»).
// Los accionables del acta NO cuentan como promesa por sí solos: el ingest no
// guarda responsable, y un pendiente del equipo no es una promesa suya.

const DELIVERY =
  "(?:envi|mand|pas|compart|entreg|revis|confirm|avis|prepar|sub|termin|agend|document|escrib|actualiz|correg|arregl|investig|valid|cotiz|program|send|shar|deliver|review|prepare|finish|schedul|follow|writ|fix|updat|check|look into|get back)\\p{L}*";

/** Compromiso explícito: basta por sí solo. */
const FIRST_STRONG = word(
  "me comprometo a|yo me encargo|me encargo de|quedo de|quedo en|queda de mi parte|corre por mi cuenta|eso lo hago yo|yo lo hago|lo hago yo|i ll take care|i will take care|i commit to|that s on me|leave it (?:to|with) me|i ll handle|i will handle|i ll own",
);
/** «te lo envío», «les comparto»: presente con destinatario = promesa de entrega. */
const FIRST_PRESENT = word("(?:te|les|le|se l[oa]s?)\\s+(?:l[oa]s?\\s+)?(?:env[ií]o|mando|paso|comparto|confirmo|aviso|entrego|escribo)");
/** «voy a enviar…», «I'll send…»: solo cuenta con un cuándo o un a quién (si no, es narrar lo que hace). */
const FIRST_FUTURE = new RegExp(
  `${B}(?:voy a|i ll|i will|i m going to|i am going to)\\s+(?:\\p{L}+\\s+){0,2}?${DELIVERY}`,
  "iu",
);
const WHEN = word(
  "mañana|hoy|esta (?:tarde|noche|semana)|este (?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo|mes)|el (?:lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)|la pr[oó]xima|pr[oó]xima semana|antes de|para el|al terminar|apenas|despu[eé]s de (?:la|esta) (?:reuni[oó]n|llamada|junta)|tomorrow|today|tonight|this (?:week|afternoon|evening)|next week|by (?:monday|tuesday|wednesday|thursday|friday|eod|tomorrow)|after (?:this|the) (?:call|meeting)|right after",
);
const WHOM = new RegExp(`${B}(?:te|les|le|se l[oa]s?|you|them)${E}|(?:ar|er|ir)(?:te|les|le|selo|sela|telo|tela)s?${E}`, "iu");
/** «voy a compartir pantalla» no es una promesa. */
const NOT_A_PROMISE = word("pantalla|screen|c[aá]mara|camera|micr[oó]fono|mic");

/** ¿Esta frase, dicha por el dueño, es un compromiso? */
export function isFirstPersonPromise(sentence: string): boolean {
  const t = lowerClean(sentence);
  if (t.split(" ").length < 4 || NOT_A_PROMISE.test(t)) return false;
  if (FIRST_STRONG.test(t) || FIRST_PRESENT.test(t)) return true;
  return FIRST_FUTURE.test(t) && (WHEN.test(t) || WHOM.test(t));
}

const THIRD_VERBS =
  "qued[oó] (?:de|en)|queda (?:de|en)|debe|deber[aá]|tiene que|se comprometi[oó] a|se compromete a|va a|se encarga(?:r[aá])? de|enviar[aá]|env[ií]a|mandar[aá]|manda|entregar[aá]|entrega|compartir[aá]|preparar[aá]|prepara|revisar[aá]|confirmar[aá]|avisar[aá]|avisa|subir[aá]|sube|documentar[aá]|documenta|ajustar[aá]|ajusta|corregir[aá]|corrige|desplegar[aá]|despliega|agendar[aá]|agenda|har[aá]|will|agreed to|committed to|needs to|has to";
const NEGATION = word("no|nunca|ni|tampoco|not|never");

/** ¿La cláusula del resumen dice que el dueño (por su nombre) quedó de hacer algo? */
export function isOwnerCommitment(clause: string, ownerNames: readonly string[]): boolean {
  const t = lowerClean(clause);
  for (const raw of ownerNames) {
    const name = lowerClean(raw);
    if (name.length < 2) continue;
    const n = escapeRe(name);
    // «pendiente que <dueño> envíe…»
    if (new RegExp(`${B}pendiente (?:de )?que ${n}${E}`, "iu").test(t)) return true;
    const m = new RegExp(`${B}${n}\\s+((?:\\p{L}+\\s+){0,2}?)(?:${THIRD_VERBS})${E}`, "iu").exec(t);
    // «<dueño> NO rehace…» / «<dueño> ya no debe…» no son compromisos.
    if (m && !NEGATION.test(m[1] ?? "")) return true;
  }
  return false;
}

/** Los turnos de la transcripción `**Nombre:** texto`. */
export function transcriptTurns(transcript: string): { speaker: string; text: string }[] {
  const out: { speaker: string; text: string }[] = [];
  const re = /\*\*([^*\n]{1,60}):\*\*\s*([^]*?)(?=\n\s*\*\*[^*\n]{1,60}:\*\*|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(transcript))) {
    const text = m[2].trim();
    if (text) out.push({ speaker: m[1].trim(), text });
  }
  return out;
}

/**
 * ¿Cuál hablante de la transcripción es el «soy yo» de la junta en vivo?
 *
 * El acta guarda la etiqueta del proveedor («B») pero la transcripción dice
 * «Hablante 1»: el número es el orden de aparición, que es también el orden de
 * las llaves del coach. Se toma ese candidato y se COMPRUEBA con el conteo de
 * palabras (medido sobre el mismo texto, coincide casi exacto). Si no cuadra
 * —un acta re-transcrita desde el audio del teléfono trae otras etiquetas— se
 * acepta solo un hablante cuyo conteo sea el único que coincide; si no, null:
 * no se le atribuye a nadie.
 */
export function selfSpeakerName(
  turns: readonly { speaker: string; text: string }[],
  selfSpeaker: string | undefined,
  speakerWords: Record<string, number> | undefined,
): string | null {
  const target = selfSpeaker ? speakerWords?.[selfSpeaker] : undefined;
  if (!selfSpeaker || !speakerWords || !target || target <= 0) return null;
  const spoken = new Map<string, number>();
  for (const t of turns) spoken.set(t.speaker, (spoken.get(t.speaker) ?? 0) + t.text.trim().split(/\s+/).length);
  const near = (n: number | undefined, tolerance: number): boolean =>
    n !== undefined && Math.abs(n - target) <= Math.max(3, target * tolerance);
  const order = Object.keys(speakerWords).filter((k) => k !== "UNKNOWN");
  const candidate = `Hablante ${order.indexOf(selfSpeaker) + 1}`;
  if (near(spoken.get(candidate), 0.05)) return candidate;
  const matches = [...spoken.entries()].filter(([, n]) => near(n, 0.02));
  return matches.length === 1 ? matches[0][0] : null;
}

function isOwnerName(speaker: string, ownerNames: readonly string[]): boolean {
  const s = fold(speaker);
  return ownerNames.some((n) => {
    const name = fold(n);
    return name.length >= 2 && new RegExp(`${B}${escapeRe(name)}${E}`, "iu").test(s);
  });
}

/**
 * Lo que el dueño prometió, con el acta y la fecha de cada cosa. Sin «soy yo»
 * en la junta y sin su nombre en el resumen, de esa acta no se afirma nada.
 */
export function ownerPromises(
  input: Pick<PrepInputs, "meetings" | "ownerNames">,
  max = PREP_MAX_PROMISES,
): PrepPoint[] {
  const out: PrepPoint[] = [];
  const seen = new Set<string>();
  const push = (text: string, m: PrepMeetingInput): void => {
    const key = fold(text).slice(0, 80);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ text: clip(text, QUOTE_MAX_CHARS), source: meetingSource(m) });
  };
  for (const m of input.meetings) {
    // 1 · El resumen lo nombra: es la versión ya destilada, va primero.
    for (const c of clauses(m.summary)) {
      if (isOwnerCommitment(c, input.ownerNames)) push(c, m);
    }
    // 2 · Su propia voz.
    const turns = transcriptTurns(m.transcript ?? "");
    const self = selfSpeakerName(turns, m.selfSpeaker, m.speakerWords);
    for (const turn of turns) {
      if (turn.speaker !== self && !isOwnerName(turn.speaker, input.ownerNames)) continue;
      for (const s of prepSentences(turn.text)) {
        if (isFirstPersonPromise(s)) push(s, m);
      }
    }
  }
  return out.slice(0, max);
}

// ── Decisiones recientes ───────────────────────────────────────────────

const DECISION = word(
  "se decidi[oó]|se acord[oó]|acordaron|decidieron|se defini[oó]|se aprob[oó]|qued[oó] (?:definido|acordado|decidido|aprobado)|decisi[oó]n(?:es)?|acuerdos?|decided|agreed",
);

/** «No hubo decisiones», «sin acuerdos»: mencionan la palabra para decir que NO hubo. */
const NO_DECISION = word(
  "no hubo (?:\\p{L}+ )?(?:decisiones|acuerdos)|ni (?:decisiones|acuerdos)|sin (?:decisiones|acuerdos)|no se (?:decidi[oó]|acord[oó]|tom[oó] ninguna)|ninguna decisi[oó]n|no decisions|nothing was (?:decided|agreed)",
);

/** Frases de los resúmenes que registran una decisión. */
export function recentDecisions(input: Pick<PrepInputs, "meetings">, max = PREP_MAX_DECISIONS): PrepPoint[] {
  const out: PrepPoint[] = [];
  const seen = new Set<string>();
  for (const m of input.meetings) {
    for (const s of prepSentences(m.summary)) {
      const t = lowerClean(s);
      if (!DECISION.test(t) || NO_DECISION.test(t)) continue;
      const key = fold(s).slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: clip(s, QUOTE_MAX_CHARS), source: meetingSource(m) });
    }
  }
  return out.slice(0, max);
}

// ── Datos sin modelo ───────────────────────────────────────────────────

/** Idioma en que se habla en las reuniones (de la transcripción más reciente; por defecto español). */
export function prepLanguage(meetings: readonly PrepMeetingInput[]): "es" | "en" {
  const latest = meetings.find((m) => (m.transcript ?? "").trim().length > 200);
  if (!latest) return "es";
  const sample = transcriptTurns(latest.transcript ?? "")
    .map((t) => t.text)
    .join(" ")
    .slice(0, 4_000);
  return sample ? guessLang(sample) : "es";
}

/** Todo lo que sale de las actas y las tareas, sin modelo: fuentes citables, pendientes, promesas y decisiones. */
export function collectPrepFacts(input: PrepInputs): PrepFacts {
  const pending = openPending(input);
  const promises = ownerPromises(input);
  const decisions = recentDecisions(input);
  const sources: PrepSource[] = input.meetings.map(meetingSource);
  const seen = new Set(sources.map(prepSourceKey));
  for (const p of pending) {
    const key = prepSourceKey(p.source);
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(p.source);
  }
  if (input.hasNote && !seen.has(prepSourceKey(NOTE_SOURCE))) sources.push(NOTE_SOURCE);
  if (input.event) {
    sources.push({
      kind: "event",
      ref: input.event.id,
      date: dayOf(input.event.start),
      label: input.event.title.trim() || "Evento del calendario",
    });
  }
  const openTasks = input.tasks.some((t) => isOpen(t.status) && t.title.trim());
  return {
    sources,
    pending,
    promises,
    decisions,
    hasHistory: input.meetings.length > 0 || openTasks || input.noteTasks.some((t) => t.trim()),
    language: prepLanguage(input.meetings),
  };
}

// ── Validación de fuentes (la regla dura) ──────────────────────────────

/** Lo que redacta el modelo: cada punto con la clave de la fuente que cita. */
export interface PrepDraftPoint {
  text?: string | null;
  source?: string | null;
}

export interface PrepDraft {
  objective?: PrepDraftPoint | null;
  questions?: PrepDraftPoint[] | null;
  risks?: PrepDraftPoint[] | null;
  opener?: PrepDraftPoint | null;
}

export interface ValidatedDraft {
  objective: PrepPoint | null;
  questions: PrepPoint[];
  risks: PrepPoint[];
  opener: PrepPoint | null;
  /** Cuántos puntos se descartaron (sin fuente, fuente inventada o sin texto). */
  dropped: number;
}

/**
 * Resuelve la cita del modelo contra las fuentes que SE LE DIERON. Acepta la
 * clave exacta (`meeting:<id>`), con comillas o corchetes alrededor, y la
 * referencia sola si es inequívoca. Cualquier otra cosa es una fuente inventada.
 */
export function resolvePrepSource(cited: string | null | undefined, sources: readonly PrepSource[]): PrepSource | null {
  const raw = String(cited ?? "")
    .trim()
    .replace(/^[\s"'`«\[(]+|[\s"'`»\])]+$/g, "");
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const exact = sources.find((s) => prepSourceKey(s).toLowerCase() === lower);
  if (exact) return exact;
  const byRef = sources.filter((s) => s.ref.toLowerCase() === lower);
  return byRef.length === 1 ? byRef[0] : null;
}

/**
 * Nada sin fuente: descarta los puntos que no citan una fuente de la lista (o
 * citan una que no existe) y reemplaza la cita por la fuente REAL — la fecha y
 * el título que se muestran nunca son los que copió el modelo.
 */
export function validatePrep(draft: PrepDraft | null | undefined, sources: readonly PrepSource[]): ValidatedDraft {
  let dropped = 0;
  const one = (p: PrepDraftPoint | null | undefined): PrepPoint | null => {
    if (!p) return null;
    const text = clip(String(p.text ?? ""), POINT_MAX_CHARS);
    const source = resolvePrepSource(p.source, sources);
    if (!text || !source) {
      dropped += 1;
      return null;
    }
    return { text, source };
  };
  const many = (list: PrepDraftPoint[] | null | undefined, max: number): PrepPoint[] => {
    const out: PrepPoint[] = [];
    const seen = new Set<string>();
    for (const p of Array.isArray(list) ? list : []) {
      const point = one(p);
      if (!point) continue;
      const key = fold(point.text);
      if (seen.has(key)) continue;
      seen.add(key);
      if (out.length < max) out.push(point);
    }
    return out;
  };
  return {
    objective: one(draft?.objective),
    questions: many(draft?.questions, PREP_MAX_QUESTIONS),
    risks: many(draft?.risks, PREP_MAX_RISKS),
    opener: one(draft?.opener),
    dropped,
  };
}

// ── Caché por proyecto, día y fuentes ──────────────────────────────────

/** FNV-1a de 32 bits (dos semillas → 16 hex). Sin `node:crypto`: este módulo también corre en el navegador. */
function hash16(text: string): string {
  const run = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  };
  return run(0x811c9dc5) + run(0x9747b28c);
}

/**
 * Huella de lo que alimentó la hoja: las fuentes (sin el evento, que cambia
 * solo por pasar la hora) y qué pendientes siguen abiertos. Un acta nueva o un
 * pendiente que se cierra la cambian; el orden no.
 */
export function prepFingerprint(facts: Pick<PrepFacts, "sources" | "pending">): string {
  const sources = facts.sources.filter((s) => s.kind !== "event").map(prepSourceKey).sort();
  const pending = facts.pending.map((p) => `${prepSourceKey(p.source)}|${fold(p.text)}`).sort();
  return hash16(JSON.stringify([sources, pending]));
}

/** Clave de caché: proyecto + día + huella de las fuentes. */
export function prepCacheKey(project: string, day: string, fingerprint: string): string {
  return `${project.toLowerCase()}|${day}|${fingerprint}`;
}

/** ¿La hoja guardada sigue valiendo para estas fuentes, hoy? */
export function prepIsFresh(
  stored: Pick<MeetingPrep, "project" | "day" | "fingerprint"> | null | undefined,
  project: string,
  day: string,
  fingerprint: string,
): boolean {
  return !!stored && prepCacheKey(stored.project, stored.day, stored.fingerprint) === prepCacheKey(project, day, fingerprint);
}

// ── Armar la hoja ──────────────────────────────────────────────────────

export const PREP_NO_HISTORY_NOTE = "Este proyecto no tiene actas ni tareas todavía: no hay historia de la cual preparar.";

export function assemblePrep(input: {
  project: string;
  projectName?: string;
  day: string;
  generatedAt: string;
  facts: PrepFacts;
  event?: PrepEventInput | null;
  /** Lo que redactó el modelo, YA validado. Ausente = no se llamó o falló. */
  draft?: ValidatedDraft | null;
  /** Motivo si la redacción falló. */
  draftError?: string;
}): MeetingPrep {
  const { facts, draft } = input;
  const status: PrepStatus = !facts.hasHistory ? "no-history" : draft ? "ready" : "draft-failed";
  const note =
    status === "no-history"
      ? PREP_NO_HISTORY_NOTE
      : status === "draft-failed"
        ? `La redacción falló${input.draftError ? ` (${clip(input.draftError, 160)})` : ""}: van los pendientes y las promesas, sin objetivo ni preguntas.`
        : undefined;
  return {
    version: 1,
    project: input.project,
    ...(input.projectName ? { projectName: input.projectName } : {}),
    day: input.day,
    generatedAt: input.generatedAt,
    fingerprint: prepFingerprint(facts),
    status,
    ...(note ? { note } : {}),
    language: facts.language,
    ...(input.event ? { event: { title: input.event.title, startsAt: input.event.start } } : {}),
    objective: draft?.objective ?? null,
    questions: draft?.questions ?? [],
    // Sin historia no hay puntos: ni siquiera los de la nota (hasHistory ya los contó).
    pending: facts.hasHistory ? facts.pending : [],
    promises: facts.hasHistory ? facts.promises : [],
    decisions: facts.hasHistory ? facts.decisions : [],
    risks: draft?.risks ?? [],
    opener: draft?.opener ?? null,
    sources: facts.sources,
    dropped: draft?.dropped ?? 0,
  };
}

// ── Evento del calendario → proyecto ───────────────────────────────────

export interface PrepProjectRef {
  slug: string;
  name?: string;
  aliases?: string[];
}

/** Un nombre de una sola palabra más corto que esto es demasiado genérico para atar un evento («dia», «app»). */
const MIN_NAME_CHARS = 4;

/**
 * ¿El título nombra un proyecto? Coincidencia por PALABRAS completas (o por
 * palabras seguidas que juntas forman el nombre: «Rulo Code Show» ↔
 * `rulocodeshow`). Gana el nombre más largo; si dos proyectos empatan, no se
 * asigna ninguno — mejor no ofrecer preparación que ofrecer la de otro cliente.
 */
export function matchEventProject(
  title: string,
  projects: readonly PrepProjectRef[],
): { project: string; matched: string } | null {
  const tokens = fold(title).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  // Todas las ventanas de 1 a 4 palabras seguidas, pegadas sin espacio.
  const windows = new Set<string>();
  for (let i = 0; i < tokens.length; i += 1) {
    let joined = "";
    for (let j = i; j < Math.min(tokens.length, i + 4); j += 1) {
      joined += tokens[j];
      windows.add(joined);
    }
  }
  let best: { project: string; matched: string; score: number } | null = null;
  let tie = false;
  for (const p of projects) {
    let top: { matched: string; score: number } | null = null;
    for (const cand of [p.slug, p.name ?? "", ...(p.aliases ?? [])]) {
      const compact = fold(cand.replace(/[-_]+/g, " ")).replace(/\s/g, "");
      if (compact.length < MIN_NAME_CHARS || !windows.has(compact)) continue;
      if (!top || compact.length > top.score) top = { matched: cand, score: compact.length };
    }
    if (!top) continue;
    if (!best || top.score > best.score) {
      best = { project: p.slug, ...top };
      tie = false;
    } else if (top.score === best.score && p.slug !== best.project) {
      tie = true;
    }
  }
  return best && !tie ? { project: best.project, matched: best.matched } : null;
}

export interface PickedEvent {
  event: PrepEventInput;
  project: string;
  /** El nombre o alias que apareció en el título. */
  matched: string;
}

/**
 * El próximo evento (en curso o que empieza dentro de `withinHours`) cuyo
 * título nombra un proyecto. Los de todo el día no cuentan: no son reuniones.
 */
export function pickEventProject(
  events: readonly PrepEventInput[],
  projects: readonly PrepProjectRef[],
  opts: { now: Date; withinHours?: number },
): PickedEvent | null {
  const now = opts.now.getTime();
  const horizon = now + (opts.withinHours ?? 12) * 3_600_000;
  const upcoming = events
    .filter((e) => !e.allDay)
    .map((e) => ({ e, start: Date.parse(e.start), end: e.end ? Date.parse(e.end) : NaN }))
    .filter(({ start, end }) => {
      if (!Number.isFinite(start) || start > horizon) return false;
      // Ya empezó: vale mientras no haya terminado (sin hora de fin, una hora).
      const until = Number.isFinite(end) ? end : start + 3_600_000;
      return until > now;
    })
    .sort((a, b) => a.start - b.start);
  for (const { e } of upcoming) {
    const hit = matchEventProject(e.title, projects);
    if (hit) return { event: e, project: hit.project, matched: hit.matched };
  }
  return null;
}

// ── Bloque para el copiloto en vivo ────────────────────────────────────

function withDate(p: PrepPoint): string {
  return p.source.date ? `${p.text} (${p.source.kind === "meeting" ? "acta del " : ""}${p.source.date})` : p.text;
}

/**
 * Lo que el copiloto debe saber de la preparación: objetivo, preguntas y
 * promesas (más riesgos). Vacío si la hoja no trae nada de eso — sin
 * preparación, el contexto del copiloto queda exactamente como estaba.
 */
export function prepContextBlock(prep: MeetingPrep | null | undefined, owner: string): string {
  if (!prep) return "";
  const parts: string[] = [];
  if (prep.objective) parts.push(`Objetivo de ${owner} para esta reunión: ${prep.objective.text}`);
  if (prep.questions.length) {
    parts.push(
      `Preguntas que ${owner} quiere hacer (cuando haya espacio, sóplale la que venga al caso; una que ya se respondió no se repite):\n${prep.questions.map((q) => `- ${q.text}`).join("\n")}`,
    );
  }
  if (prep.promises.length) {
    parts.push(
      `Lo que ${owner} prometió en reuniones anteriores (si alguien pregunta por eso, que responda con el estado real, sin evadir):\n${prep.promises.map((p) => `- ${withDate(p)}`).join("\n")}`,
    );
  }
  if (prep.risks.length) parts.push(`Riesgos a vigilar:\n${prep.risks.map((r) => `- ${r.text}`).join("\n")}`);
  if (!parts.length) return "";
  return `## Preparación de ${owner} para esta reunión (hoja de hoy)\n${parts.join("\n")}`;
}

// ── Tarjeta de inicio (web y teléfono) ─────────────────────────────────

export type PrepCardState = "loading" | "generating" | "error" | "offer" | "sheet";

/**
 * Qué muestra la sección «Preparación» de la tarjeta de inicio. Generar manda
 * sobre todo (se ve el avance aunque haya una hoja vieja o un error anterior);
 * sin hoja de hoy se ofrece «Preparar».
 */
export function prepCardState(s: {
  loading: boolean;
  generating: boolean;
  error?: string | null;
  prep: MeetingPrep | null | undefined;
}): PrepCardState {
  if (s.generating) return "generating";
  if (s.error) return "error";
  if (s.prep) return "sheet";
  if (s.loading) return "loading";
  return "offer";
}

/** «acta del 10 nov · Título» / «tarea · Título» / «nota del proyecto» / «calendario · Título». */
export function prepSourceText(s: PrepSource): string {
  const date = s.date ? prepShortDate(s.date) : "";
  switch (s.kind) {
    case "meeting":
      return `acta${date ? ` del ${date}` : ""} · ${s.label}`;
    case "task":
      return `tarea · ${s.label}`;
    case "event":
      return `calendario${date ? ` · ${date}` : ""} · ${s.label}`;
    default:
      return "nota del proyecto";
  }
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «2026-11-10» → «10 nov» (calendario puro: sin zonas horarias). */
export function prepShortDate(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  if (!m) return day;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]}`;
}
