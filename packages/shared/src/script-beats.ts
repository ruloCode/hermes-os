/**
 * Guion → BEATS: la unidad real de grabación.
 *
 * Los guiones del Estudio (escritos a mano o generados por Hermes) mezclan tres
 * capas en el mismo markdown:
 *
 *   [0-3s] **[DEMO: la mano abierta moviendo el cursor]**   ← qué tiene que VERSE
 *   «Esto no es CGI. Estoy moviendo el cursor con la mano.»  ← lo que se DICE
 *   (cara a cámara, energía)                                 ← cómo se dice
 *
 * Frente a la cámara solo importa la línea del medio. Este parser separa las
 * tres para que el modo grabación muestre ÚNICAMENTE las frases a decir y deje
 * el detalle de la toma al lado, nunca encima.
 *
 * Es puro y tolerante con lo que no encaje: si el guion no usa comillas
 * angulares (p. ej. un post de LinkedIn, donde el guion ES el texto final),
 * cada párrafo se vuelve un beat y el párrafo entero es "lo que se dice".
 */
import type { ContentPiece, ContentTake } from "./types.js";

export interface ScriptBeat {
  /** Etiqueta ESTABLE que enlaza el beat con su toma real ("[0-3s]", "Hook"). */
  label: string;
  /** Rango declarado en el guion, sin corchetes ("0-3s"); null si no lo trae. */
  time: string | null;
  /** Título de sección (## …) en formatos largos. */
  heading: string | null;
  /** Frases literales a cámara — lo ÚNICO que se lee en el teleprompter. */
  say: string[];
  /** Qué tiene que verse: [DEMO: …], [PANTALLA: …], [B-ROLL: …]. */
  cues: string[];
  /** Indicaciones de actuación: (cara a cámara, energía). */
  directions: string[];
  /** Palabras a decir (solo `say`). */
  words: number;
  /** Segundos del rango declarado; null si el guion no lo dice. */
  seconds: number | null;
  /** Cierra con llamada a la acción (se marca en el checklist). */
  isCta: boolean;
  kind: "hook" | "beat";
  /**
   * Rango de líneas [inicio, fin] del bloque en script_md (para reescribirlo
   * al aplicar una variante). null = el hook de la pieza (vive en su campo).
   */
  lines: [number, number] | null;
}

export interface ParsedScript {
  /** Línea `**Formato:**` — cómo se graba la pieza. */
  format: string | null;
  beats: ScriptBeat[];
  /** `**Notas de grabación:**` — recordatorios de set, no se dicen. */
  notes: string[];
  /** Palabras habladas en todo el guion. */
  words: number;
  /** Segundos declarados (suma de rangos); null si el guion no los trae. */
  seconds: number | null;
}

/** `[0-3s]` · `[0:00–0:15]` al inicio de línea: abre un beat. */
const TIME_RE = /^\[\s*(\d[^\]]*?)\s*\]\s*/;
const HEADING_RE = /^#{1,6}\s+(.+)$/;
/** `**Formato:** vertical 30s · TikTok` */
const FORMAT_RE = /^\*\*\s*formato\s*:?\s*\*\*\s*:?\s*/i;
/** `**Notas de grabación:** luz de frente…` (también `**Nota:**`) */
const NOTE_RE = /^\*\*\s*(notas?[^*]*?)\s*\*\*\s*:?\s*/i;
/** `**[DEMO: …]**` — cue en negrita, con o sin palabra clave conocida. */
const BOLD_CUE_RE = /\*\*\s*\[([^\]]+)\]\s*\*\*/g;
/** `[PANTALLA: …]` sin negrita — solo si arranca con palabra clave de set. */
const CUE_RE = /\[\s*((?:demo|pantalla|screen|b-?roll|card|caption|cue|corte|zoom)[^\]]*)\]/gi;
/** `(cara a cámara, energía)` en línea propia. */
const DIRECTION_RE = /^\(([^)]+)\)$/;
/** Frase a cámara: comillas angulares (convención de los guiones) o curvas. */
const QUOTE_RE = /[«“]([^»”]*)(?:[»”]|$)/g;
/**
 * Verbos de cierre típicos del dueño. La ÚNICA copia: stageGates (content.ts)
 * evalúa con esto el cierre real del guion — verificado contra los 15 guiones
 * del vault el 2026-08-10 (auditoría en docs/mejoras-flujo-contenido.md).
 */
export const CTA_RE =
  /\bcta\b|suscr[ií]|s[ií]gue|seguir|coment|comparte|guarda esto|link en|escr[ií]beme|te leo/i;

const countWords = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Quita marcas de énfasis y viñetas: el teleprompter se lee, no se renderiza. */
function clean(text: string): string {
  return text
    .replace(/\*\*/g, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "0-3s" → 3 · "0:00–0:15" → 15 · "3-12s" → 9. null si no es un rango. */
export function rangeSeconds(time: string | null): number | null {
  if (!time) return null;
  const toSec = (s: string): number | null => {
    const mmss = s.match(/^(\d+):(\d{1,2})/);
    if (mmss) return Number(mmss[1]) * 60 + Number(mmss[2]);
    const n = s.match(/^(\d+(?:[.,]\d+)?)/);
    return n ? Number(n[1].replace(",", ".")) : null;
  };
  const parts = time
    .split(/[–—-]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const from = toSec(parts[0]);
  const to = toSec(parts[parts.length - 1]);
  if (from == null || to == null || to <= from) return null;
  return to - from;
}

/** Estimación de lectura en voz alta (≈145 palabras/min hablando a cámara). */
export function spokenSeconds(words: number): number {
  return Math.round((words / 145) * 60);
}

interface Draft {
  time: string | null;
  heading: string | null;
  say: string[];
  cues: string[];
  directions: string[];
  /** Rango de líneas del bloque en el fuente (para reescribirlo). */
  start: number;
  last: number;
}

const blank = (at: number): Draft => ({
  time: null,
  heading: null,
  say: [],
  cues: [],
  directions: [],
  start: at,
  last: at,
});

export function parseScript(md: string | null | undefined): ParsedScript {
  const source = md ?? "";
  const lines = source.split("\n");
  const beats: ScriptBeat[] = [];
  const notes: string[] = [];
  let format: string | null = null;
  let draft: Draft | null = null;
  /** Comilla abierta que sigue en la línea siguiente (diálogo multilínea). */
  let openQuote = false;

  // Dos decisiones globales que cambian cómo se lee el resto:
  //  - sin comillas angulares el guion ES el texto (post de LinkedIn),
  //  - sin marcas de tiempo ni secciones, cada párrafo es un beat.
  const usesQuotes = /[«»“”]/.test(source);
  const structured = lines.some((l) => TIME_RE.test(l.trim()) || HEADING_RE.test(l.trim()));

  const flush = () => {
    if (!draft) return;
    if (draft.say.length || draft.cues.length || draft.heading) beats.push(finish(draft, beats.length));
    draft = null;
  };
  let idx = -1;
  const ensure = (): Draft => {
    draft ??= blank(idx);
    draft.last = idx;
    return draft;
  };

  for (const raw of lines) {
    idx += 1;
    const line = raw.trim();

    if (!line) {
      // Una línea en blanco cierra cualquier frase abierta y, en guiones sin
      // estructura, separa beats (un párrafo = un bloque que se dice de corrido).
      openQuote = false;
      if (!structured) flush();
      continue;
    }

    if (openQuote) {
      const closed = /[»”]/.test(line);
      const text = clean(line.replace(/[»”]/g, ""));
      const target = ensure();
      const prev = target.say.pop();
      if (text || prev) target.say.push(`${prev ?? ""} ${text}`.trim());
      openQuote = !closed;
      continue;
    }

    if (FORMAT_RE.test(line)) {
      format = clean(line.replace(FORMAT_RE, ""));
      continue;
    }
    if (NOTE_RE.test(line)) {
      const body = clean(line.replace(NOTE_RE, ""));
      if (body) notes.push(body);
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flush();
      const title = clean(heading[1]);
      // "Hook (0:00–0:15)" → el rango vive en el título; se extrae al beat.
      const withTime = title.match(/^(.*?)\s*\(([^)]*\d[^)]*)\)\s*$/);
      const d = ensure();
      d.heading = withTime ? clean(withTime[1]) : title;
      d.time = withTime ? withTime[2].trim() : null;
      continue;
    }

    let rest = line;
    const time = rest.match(TIME_RE);
    if (time) {
      flush();
      ensure().time = time[1];
      rest = rest.replace(TIME_RE, "");
    }

    // 1) Los cues salen primero: un [PANTALLA: …] puede vivir DENTRO de la
    //    frase y no debe leerse en voz alta, pero sí verse en el detalle.
    const target = ensure();
    rest = rest.replace(BOLD_CUE_RE, (_m, body: string) => {
      target.cues.push(clean(body));
      return " ";
    });
    rest = rest.replace(CUE_RE, (_m, body: string) => {
      target.cues.push(clean(body));
      return " ";
    });
    rest = rest.trim();
    if (!rest) continue;

    // 2) Indicación de actuación en línea propia.
    const direction = rest.match(DIRECTION_RE);
    if (direction) {
      target.directions.push(clean(direction[1]));
      continue;
    }

    // 3) Lo que se dice.
    if (usesQuotes) {
      let outside = "";
      let last = 0;
      QUOTE_RE.lastIndex = 0;
      for (let m = QUOTE_RE.exec(rest); m; m = QUOTE_RE.exec(rest)) {
        outside += rest.slice(last, m.index);
        last = m.index + m[0].length;
        const said = clean(m[1]);
        if (said) target.say.push(said);
        // Comilla que abre y no cierra: la frase continúa abajo.
        if (!/[»”]$/.test(m[0])) openQuote = true;
      }
      outside += rest.slice(last);
      const aside = clean(outside);
      // Prosa suelta en un guion con comillas = acotación, no diálogo.
      if (aside && aside.length > 2) target.directions.push(aside);
    } else {
      const said = clean(rest);
      if (said) target.say.push(said);
    }
  }
  flush();

  const words = beats.reduce((n, b) => n + b.words, 0);
  const declared = beats.reduce<number | null>(
    (acc, b) => (b.seconds == null ? acc : (acc ?? 0) + b.seconds),
    null,
  );
  return { format, beats, notes, words, seconds: declared };
}

/** "Hook" queda reservado al hook de la pieza: una sección así se desambigua. */
function beatLabel(d: Draft, index: number): string {
  if (d.time) return `[${d.time}]`;
  if (!d.heading) return `Bloque ${index + 1}`;
  return norm(d.heading) === "hook" ? `Guion · ${d.heading}` : d.heading;
}

function finish(d: Draft, index: number): ScriptBeat {
  const say = d.say.filter(Boolean);
  const text = say.join(" ");
  return {
    label: beatLabel(d, index),
    time: d.time,
    heading: d.heading,
    say,
    cues: d.cues.filter(Boolean),
    directions: d.directions.filter(Boolean),
    words: countWords(text),
    seconds: rangeSeconds(d.time),
    isCta: CTA_RE.test(text),
    kind: "beat",
    lines: [d.start, d.last],
  };
}

/**
 * Los beats de la pieza EN ORDEN DE GRABACIÓN: el hook primero (es la frase
 * que decide el video y va como su propio ítem del checklist) y luego el guion.
 */
export function pieceBeats(piece: ContentPiece): ScriptBeat[] {
  const parsed = parseScript(piece.script_md);
  const hook = piece.hook?.trim();
  if (!hook) return parsed.beats;
  return [
    {
      label: "Hook",
      time: null,
      heading: "Hook",
      say: [hook],
      cues: [],
      directions: [],
      words: countWords(hook),
      seconds: null,
      isCta: false,
      kind: "hook",
      lines: null,
    },
    ...parsed.beats,
  ];
}

/**
 * La toma REAL de un beat: el estado del checklist no es un checkbox suelto,
 * es un `ContentTake` de la pieza (mismo dato que ven el tab Tomas, los
 * criterios de la etapa y el espejo del vault).
 */
export function takeForBeat(piece: ContentPiece, beat: ScriptBeat): ContentTake | null {
  const label = norm(beat.label);
  const exact = piece.takes.find((t) => norm(t.label) === label);
  if (exact) return exact;
  // El plan generado por Hermes etiqueta "Bloque 2 — hook + demo": si menciona
  // el rango del beat, es la misma toma.
  if (beat.time) {
    const t = norm(beat.time);
    const byTime = piece.takes.find((x) => norm(x.label).includes(t));
    if (byTime) return byTime;
  }
  return null;
}

export type BeatState = ContentTake["verdict"] | "pendiente";

export function beatState(piece: ContentPiece, beat: ScriptBeat): BeatState {
  return takeForBeat(piece, beat)?.verdict ?? "pendiente";
}

/** Cuántos beats tienen toma buena — el avance real de la sesión de grabación. */
export function recordedCount(piece: ContentPiece, beats: ScriptBeat[]): number {
  return beats.filter((b) => beatState(piece, b) === "buena").length;
}

/**
 * Reescribe LO QUE SE DICE de un beat dentro de script_md (aplicar una
 * variante). El bloque se re-emite en forma canónica: misma marca de tiempo /
 * sección, mismos cues y acotaciones — solo cambia la frase. Puro: devuelve
 * el markdown nuevo (el que llama persiste con patchPiece).
 *
 * El hook de la pieza (beat.lines === null) NO pasa por aquí: vive en su
 * campo y se aplica con `{ hook: text }`.
 */
export function replaceBeatText(
  scriptMd: string | null | undefined,
  beat: ScriptBeat,
  newText: string,
): string | null {
  const source = scriptMd ?? "";
  if (!beat.lines) return null;
  const lines = source.split("\n");
  const [start, end] = beat.lines;
  if (start < 0 || end >= lines.length || start > end) return null;

  const usesQuotes = /[«»“”]/.test(source);
  const text = newText.trim();
  const block: string[] = [];

  if (beat.heading) {
    block.push(`## ${beat.heading}${beat.time ? ` (${beat.time})` : ""}`);
  } else if (beat.time) {
    // Estilo de los guiones reales: el primer cue acompaña la marca de tiempo.
    block.push(`[${beat.time}]${beat.cues.length ? ` **[${beat.cues[0]}]**` : ""}`);
  }
  if (usesQuotes) {
    block.push(`«${text}»`);
  } else {
    // Post/carrusel: el guion ES el texto — la variante entra tal cual.
    block.push(...text.split("\n"));
  }
  const restCues = beat.heading ? beat.cues : beat.cues.slice(1);
  for (const cue of restCues) block.push(`**[${cue}]**`);
  for (const d of beat.directions) block.push(`(${d})`);
  // Beat sin cabecera (post): sin marca que emitir, el bloque es solo el texto.

  lines.splice(start, end - start + 1, ...block);
  return lines.join("\n");
}

/**
 * Las tomas de la pieza con el veredicto del beat aplicado (puro — el que
 * llama persiste con patchPiece). Repetir el MISMO veredicto borra la toma:
 * deshacer sin menús, que es lo que se necesita con la cámara encendida.
 */
export function withBeatVerdict(
  piece: ContentPiece,
  beat: ScriptBeat,
  verdict: ContentTake["verdict"],
): ContentTake[] {
  const existing = takeForBeat(piece, beat);
  if (!existing)
    return [
      ...piece.takes,
      {
        id: Math.random().toString(36).slice(2, 9),
        label: beat.label,
        range: null,
        verdict,
        note: beat.say[0]?.slice(0, 120) ?? beat.cues[0] ?? null,
      },
    ];
  if (existing.verdict === verdict) return piece.takes.filter((t) => t.id !== existing.id);
  return piece.takes.map((t) => (t.id === existing.id ? { ...t, verdict } : t));
}
