/**
 * Letras sobre el MOLDE de un pasaje (Agent SDK, patrón variants: un turno +
 * una tool acotada) y la canción que nace de una sesión.
 *
 * El molde es MEDIDA (sílabas, acentos, final, melismas, y en cada posición
 * la vocal del tarareo y su peso métrico), no autoría: cada versión es una
 * sugerencia con su ÁNGULO y el porqué de cada línea, y nada entra a una
 * canción sin clic humano.
 *
 * Si el pasaje es una TOMA de un tema (o se pide con `temaId`), la INTENCIÓN
 * del tema encabeza el prompt y manda sobre todo lo demás: de qué habla, qué
 * transmite, la sección, la tonalidad, el groove y los acordes por compás.
 *
 * Cada versión recibe un ángulo EXPLÍCITO (lyric-angles.ts): pedir "5
 * versiones" da cinco variaciones de la misma idea; asignar el ángulo las
 * separa. Con más de 5 versiones van DOS llamadas en paralelo con ángulos
 * disjuntos.
 *
 * Después de generar, cada línea se mide con lineFit; si alguna se pasa o se
 * queda corta por ≥2 sílabas, o trae ≥2 malacentos (tónicas en posición débil
 * y corta), hay UNA ronda de reparación solo de esas líneas (no un bucle: el
 * modelo no se corrige a sí mismo hasta el infinito, el humano decide).
 */
import { randomUUID } from "node:crypto";
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  LYRIC_ANGLES,
  keyLabel,
  lineFit,
  moldSlots,
  phraseMold,
  phraseSignature,
  pickAngles,
  reconcileLyricBoard,
  stripChords,
  type ChordBar,
  type ComposeSession,
  type Genre,
  type LineFit,
  type LyricAngle,
  type LyricBoard,
  type LyricLine,
  type LyricRequest,
  type LyricVersion,
  type MelismaMode,
  type Phrase,
  type PhraseMold,
  type PassageAnalysis,
  type NotebookEntry,
  type SectionKind,
  type Song,
  type SongSection,
  type Tema,
  type TemaSection,
} from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { env } from "../env.js";
import { emit } from "../events.js";
import { OWNER, ownerBlurb } from "../owner.js";
import {
  hasLyrics,
  isSafeId,
  patchLyrics,
  patchSession,
  readAnalysis,
  readBoard,
  readLyrics,
  readSession,
  readTema,
  updateBoard,
} from "./store.js";
import { clock } from "./transcribe.js";

export class LyricsError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 409 | 500 = 400,
  ) {
    super(message);
  }
}

const uid = (p: string) => `${p}-${randomUUID().slice(0, 8)}`;

/** Tope de versiones por pedido (contrato: LyricRequest.count 1..8). */
export const MAX_LYRIC_VERSIONS = 8;
/** Más de esto en una sola llamada y el modelo empieza a repetirse: se parte en dos tandas. */
/**
 * Llamadas simultáneas al modelo. UNA versión por llamada (medido en un coro
 * real: 4 versiones en una sola llamada tardaban 7–11 min; una versión sola,
 * ~50 s). En paralelo el total queda cerca de una llamada, y cada versión ve
 * SOLO su ángulo — sin las otras a la vista, no se copian la estructura. El
 * tope cuida la memoria: cada llamada es un proceso del CLI.
 */
const MAX_PARALLEL = 4;
/** Rondas de reparación contra el verificador. */
const REPAIR_ROUNDS = 2;

const stopped = () => new LyricsError("generación detenida", 409);

/**
 * Corre tareas con a lo sumo `limit` a la vez, conservando el orden de los
 * resultados. Con `signal` abortada, ningún worker toma una tarea NUEVA (las
 * que no llegaron a empezar salen rechazadas con "generación detenida"): antes
 * Detener mataba las llamadas en vuelo y la cola seguía abriendo procesos del
 * CLI con el resto.
 */
export async function pooled<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  signal?: AbortSignal,
): Promise<PromiseSettledResult<T>[]> {
  const out: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length && !signal?.aborted) {
      const i = next++;
      try {
        out[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        out[i] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  for (let i = 0; i < tasks.length; i++) if (!out[i]) out[i] = { status: "rejected", reason: stopped() };
  return out;
}

// ─────────────────────────── Molde → texto para el prompt ───────────────────────────

const ENDING_HINT: Record<PhraseMold["ending"], string> = {
  aguda: "aguda (la última sílaba es la tónica: amor, está, corazón)",
  llana: "llana (la tónica es la penúltima: casa, tiempo, quiero)",
  esdrujula: "esdrújula (la tónica es la antepenúltima: música, lágrima)",
};

/**
 * Lo que se cantó en cada POSICIÓN del molde (misma expansión que phraseMold:
 * al silabizar, cada nota de un melisma es una posición que repite su sílaba).
 */
export function slotTexts(ph: Phrase, mode: MelismaMode): string[] {
  const out: string[] = [];
  for (const s of ph.syllables) {
    const text = s.text.trim().toLowerCase();
    if (mode === "silabizar" && s.melisma && s.noteIdx.length >= 2) {
      const n = s.parts && s.parts.length >= 2 ? s.parts.length : s.noteIdx.length;
      for (let k = 0; k < n; k++) out.push(text);
    } else out.push(text);
  }
  return out;
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));

/**
 * La línea de fonemas por posición: `1:na(a·fuerte·2t) 2:na 3:UH~(u·melisma 3)`.
 * Se anota solo lo que pesa (tiempo fuerte, nota larga, melisma); una posición
 * débil y corta va sola. "t" = tiempos (con rejilla), "s" = segundos (sin ella).
 */
export function phonemeLine(ph: Phrase, mold: PhraseMold, mode: MelismaMode): string | null {
  const slots = mold.slots;
  if (!slots?.length) return null;
  const texts = slotTexts(ph, mode);
  const n = Math.min(slots.length, mold.syllables);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const sl = slots[i];
    const raw = (texts.length === slots.length ? texts[i] : "") || sl.vowel || "·";
    const melisma = (sl.melismaNotes ?? 0) >= 2;
    const strong = (sl.weight ?? 0) >= 3;
    const beats = sl.len16 != null ? sl.len16 / 4 : null;
    const notes: string[] = [];
    if (sl.vowel) notes.push(sl.vowel === "m" ? "boca cerrada" : sl.vowel);
    if (strong) notes.push("fuerte");
    if (beats != null && beats >= 1) notes.push(`${fmtNum(beats)}t`);
    else if (beats == null && sl.long) notes.push(`${fmtNum(Math.round(sl.dur * 10) / 10)}s`);
    if (melisma) notes.push(`melisma ${sl.melismaNotes}`);
    const weighty = strong || melisma || sl.long || (beats != null && beats >= 1);
    const label = melisma ? `${raw.toUpperCase()}~` : raw;
    out.push(`${i + 1}:${label}${weighty && notes.length ? `(${notes.join("·")})` : ""}`);
  }
  return out.join(" ");
}

export function describeMold(ph: Phrase, mold: PhraseMold, mode: MelismaMode): string {
  const parts = [`${mold.syllables} sílabas cantadas`, `final ${ENDING_HINT[mold.ending]}`];
  if (mold.stresses.length)
    parts.push(`acentos de la melodía en las sílabas ${mold.stresses.join(", ")}`);
  for (const m of mold.melismas) {
    parts.push(
      mode === "respetar"
        ? `MELISMA en la sílaba ${m.pos} (${m.notes} notas, ${m.dur.toFixed(1)} s): esa sílaba se estira sobre la corrida — pide vocal abierta a/o/e en la sílaba ${m.pos}`
        : `corrida de ${m.notes} notas desde la sílaba ${m.pos}: cada nota lleva su propia sílaba (ya contadas)`,
    );
  }
  if (mold.long.length) parts.push(`notas largas en ${mold.long.join(", ")} (mejor vocal abierta)`);
  if (mold.rhyme) parts.push(`rima ${mold.rhyme}`);
  const phon = phonemeLine(ph, mold, mode);
  return `[frase ${ph.idx}] ${clock(ph.start)}–${clock(ph.end)} · se cantó: «${ph.text}» · molde: ${parts.join(" · ")}${
    phon ? `\n   fonemas por posición: ${phon}` : ""
  }`;
}

/** Distancia (en sílabas) entre lo posible de la línea y lo que pide el molde. */
export function syllableGap(fit: LineFit): number {
  const [lo, hi] = fit.range ?? [fit.syllables, fit.syllables];
  if (fit.target < lo) return lo - fit.target;
  if (fit.target > hi) return fit.target - hi;
  return 0;
}

/**
 * Eco que ya no se acepta en una frase de TARAREO (≥ 2 posiciones con vocal):
 * medido en un coro real, el modelo escribía líneas que calzaban perfecto en
 * sílabas y final pero con 0–16 % de eco sobre "uh uh / dun dun" — justo lo
 * que la junta pidió conservar ("lo que la gente tararea y recuerda").
 */
export const LOW_ECHO = 0.35;

const lowEcho = (fit: LineFit): boolean =>
  !!fit.echo && fit.echo.perSlot.length >= 2 && fit.echo.score < LOW_ECHO;

/**
 * Una línea necesita reparación: no cabe en el molde (aunque sea por UNA sílaba —
 * "el molde manda"), trae ≥2 malacentos o pierde el eco del tarareo.
 */
export function needsRepair(fit: LineFit): boolean {
  return syllableGap(fit) >= 1 || (fit.misaccents?.length ?? 0) >= 2 || lowEcho(fit);
}

/** ¿La reparación es mejor? Primero el calce de sílabas, luego los malacentos, luego el eco, luego el puntaje. */
export function repairImproves(next: LineFit, prev: LineFit): boolean {
  const a = [
    syllableGap(next),
    next.misaccents?.length ?? 0,
    -(next.echo?.score ?? 0),
    -next.score,
  ];
  const b = [
    syllableGap(prev),
    prev.misaccents?.length ?? 0,
    -(prev.echo?.score ?? 0),
    -prev.score,
  ];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

// ─────────────────────────── Contexto ───────────────────────────

const GENRE_LABEL: Record<Genre, string> = {
  rnb: "R&B",
  dancehall: "dancehall",
  reggaeton: "reggaetón",
  "pop-urbano": "pop urbano",
  otro: "otro (sin género fijo)",
};

/** "c1 Am · c2 F · c3 C→G(t3)": el loop compás por compás (t = tiempo, 1-based). */
export function chordsByBar(loop: ChordBar[]): string {
  return loop
    .map((bar, i) => {
      const chords = bar.chords.map((c, k) =>
        k === 0 && c.beat === 0 ? c.symbol : `${c.symbol}(t${c.beat + 1})`,
      );
      return `c${i + 1} ${chords.join("→")}`;
    })
    .join(" · ");
}

/**
 * El bloque del TEMA: la intención manda. Para una toma, la pista es la
 * rejilla con la que SE GRABÓ (tonalidad, bpm y loop de ese momento); el
 * groove sale del tema. Sin toma, la pista actual del tema.
 */
export function temaContext(opts: {
  tema: Tema;
  section?: TemaSection;
  take?: ComposeSession["take"];
  grid?: PassageAnalysis["grid"];
}): string {
  const { tema, section, take } = opts;
  const it = tema.intent;
  const tr = tema.track;
  const key = take?.grid.key ?? tr.key;
  const bpm = take?.grid.bpm ?? tr.bpm;
  const meter = take?.grid.meter ?? tr.meter;
  const swing = take?.grid.swing ?? tr.swing;
  const loop = take?.grid.loop ?? section?.loop;
  const bars = take?.grid.bars ?? section?.bars;
  const lines = [
    `## LA INTENCIÓN MANDA — tema «${tema.title}»`,
    "Todo lo demás de este pedido (la sesión, las referencias, la canción) se subordina a esto. Una línea que calza con el molde pero traiciona la intención no sirve.",
    `- De qué habla: ${it.about.trim() || "(sin escribir todavía)"}`,
    `- Qué transmite: ${it.convey.trim() || "(sin escribir todavía)"}`,
  ];
  if (it.pov?.trim()) lines.push(`- Quién le habla a quién: ${it.pov.trim()}`);
  if (it.avoid?.trim()) lines.push(`- Qué evitar (no negociable): ${it.avoid.trim()}`);
  if (it.anchors?.length)
    lines.push(
      `- Palabras o imágenes ancla (úsalas o gira alrededor de ellas): ${it.anchors.join(", ")}`,
    );
  lines.push(`- Género: ${GENRE_LABEL[it.genre] ?? it.genre}`);
  if (section)
    lines.push(
      `- Sección: ${section.label} (${section.kind})${section.intent?.trim() ? ` — lo que tiene que pasar aquí: ${section.intent.trim()}` : ""}`,
    );
  lines.push(
    `- Pista: ${keyLabel(key, "latin")} · ${Math.round(bpm * 10) / 10} bpm · ${meter} · groove ${tr.groove}${swing ? ` · swing ${swing}` : ""}${take ? " (la rejilla con la que se grabó la toma)" : ""}`,
  );
  if (loop?.length)
    lines.push(
      `- Acordes por compás (loop de ${loop.length}${bars ? `, se repite en ${bars} compases` : ""}): ${chordsByBar(loop)}`,
    );
  else if (!section)
    for (const sec of tr.sections)
      lines.push(`- ${sec.label} (${sec.bars} compases): ${chordsByBar(sec.loop)}`);
  const gp = opts.grid?.phrases ?? [];
  if (gp.length && loop?.length) {
    const entries = gp.map((p) => {
      const bar = loop[(((p.startBar - 1) % loop.length) + loop.length) % loop.length];
      return `frase ${p.idx} → compás ${p.startBar}${p.pickup16 ? ` (anacrusa de ${p.pickup16}/16)` : ""} sobre ${bar?.chords[0]?.symbol ?? "?"}`;
    });
    lines.push(`- Dónde entra cada frase: ${entries.join(" · ")}`);
  }
  return lines.join("\n");
}

function songContext(
  song: Song,
  refs: { title: string; by?: string; kind: string; takeaway: string; excerpt?: string }[],
): string {
  const lyrics = song.sections
    .filter((s) => s.lyrics.trim())
    .map((s) => `${s.label}:\n${s.lyrics.split("\n").map(stripChords).join("\n")}`)
    .join("\n\n");
  return `## Canción destino: «${song.title}»
- Tonalidad ${keyLabel(song.key, "latin")} · ${song.tempo} bpm · ${song.meter}${song.mood.length ? ` · ${song.mood.join(", ")}` : ""}
- Semilla (lo que no se negocia): ${song.seed || "(sin semilla)"}
${lyrics ? `\nLetra que ya existe (no la repitas; lo nuevo tiene que convivir con esto):\n"""\n${lyrics.slice(0, 4000)}\n"""` : ""}
${
  refs.length
    ? `\nReferencias ENLAZADAS a la canción — toma su ADN (imágenes, giros, actitud, forma de rimar), JAMÁS copies una línea:\n${refs
        .map(
          (r) =>
            `- ${r.title}${r.by ? ` (${r.by})` : ""} [${r.kind}]: ${r.takeaway}${r.excerpt ? ` — «${r.excerpt.slice(0, 160)}»` : ""}`,
        )
        .join("\n")}`
    : ""
}`;
}

function sessionContext(s: ComposeSession): string {
  if (!s.summary) return "";
  const sm = s.summary;
  return `## La sesión «${s.title}»
- De qué va: ${sm.theme || "(sin tema claro)"}
${
  sm.lines.length
    ? `- Líneas que ELLOS escribieron (su vocabulario y sus imágenes mandan; úsalas como material, no las repitas tal cual salvo que calcen):\n${sm.lines
        .slice(0, 40)
        .map((l) => `  · ${l.text}`)
        .join("\n")}`
    : ""
}
${sm.decisions.length ? `- Decisiones tomadas (respétalas):\n${sm.decisions.map((d) => `  · ${d.text}`).join("\n")}` : ""}`;
}

const SYSTEM_PROMPT = `# Hermes — Coautor de letras sobre un molde melódico

Escribes VERSIONES de letra para una melodía que ${OWNER}${ownerBlurb("Composición")} y su equipo ya cantaron. La melodía se midió: cada frase trae su MOLDE (sílabas, acentos, final, melismas y, cuando hay tarareo, qué vocal y qué peso tiene cada posición). Tu letra tiene que poder cantarse SOBRE esa melodía sin mover una nota.

Reglas (no negociables):
- **La intención manda.** Si el pedido trae un bloque «LA INTENCIÓN MANDA», de qué habla, qué transmite, a quién le habla y qué evitar pesan más que cualquier otra cosa (sesión, referencias, canción). Una línea que calza perfecto pero dice otra cosa no sirve.
- **El molde manda en la forma.** Cuenta sílabas como se cantan en español: las vocales entre palabras se unen (sinalefa) cuando se cantan juntas; una sílaba en melisma cuenta UNA. El final (agudo/llano/esdrújulo) tiene que coincidir: la última tónica de la línea cae donde la melodía la pone.
- **Eco fonético (traducir el tarareo, no reemplazarlo).** La línea «fonemas por posición» dice lo que se tarareó en cada sílaba. Una frase de TARAREO ("uh uh uh", "na na", "dun dun") es el gancho que el equipo ya ama: tu letra debe CONSERVAR sus vocales en la mayoría de las posiciones, sobre todo las LARGAS o FUERTES (anotadas entre paréntesis) — la misma vocal, o al menos su clase (abiertas a/e/o, cerradas i/u). Ejemplos: «uh uh uh uh» → «tú, tú, tú, tú» / «nunca, nunca» / «tu luz, tu luz»; «na na na» → «nada, nada»; «dun dun dun» → «un, un, un» / «tun tun tun» / «nunca nunca». TRADUCIR no es devolver el tarareo: la mayoría de las sílabas de cada línea deben ser PALABRAS (un «uh» o «dun» suelto como respuesta de pregón se vale; una línea hecha de rellenos, no). En las posiciones cortas y débiles la vocal es libre. Una línea con buena métrica pero sin eco sobre un tarareo NO cumple el pedido.
- **Tónica en tiempo fuerte.** La sílaba tónica de cada palabra importante cae en una posición marcada «fuerte» o en un acento de la melodía; una tónica en posición débil y corta se oye mal acentuada (malacento).
- **Melisma**: la sílaba estirada lleva vocal ABIERTA (a, o, e) o la misma que se tarareó — "amooor" se canta, "sííí" se aprieta.
- **Cada versión tiene su ÁNGULO asignado** (te lo doy en el pedido, con su id). Escríbela DESDE ese ángulo, no desde otro: el ángulo es lo que hace que dos versiones no se parezcan.
- **Nada de clichés de relleno** (corazón/dolor/amor/sin ti rimados por inercia). Imágenes concretas, español natural, el registro de la sesión.
- \`why\` por línea: una frase corta con el porqué (qué imagen, por qué calza con el acento, el eco o el melisma). Es lo que el humano lee para decidir.
- Referencias: toma su ADN, nunca copies una línea ajena. Las líneas que escribió el equipo sí puedes reutilizarlas si calzan (dilo en el why).
- Solo escribes las frases pedidas. Las BLOQUEADAS ya están escritas: úsalas como contexto (rima, continuidad), no las reescribas.
- Solo la letra: sin acordes, sin marcas de tiempo, sin comillas.

Responde SIEMPRE llamando a la tool indicada UNA sola vez.`;

// ─────────────────────────── Generación ───────────────────────────

interface RawVersion {
  angle: string;
  lines: { phrase: number; text: string; why?: string }[];
}

type ValidLyricRequest = Required<Pick<LyricRequest, "count" | "melismaMode">> & LyricRequest;

function validateRequest(req: LyricRequest, phrases: Phrase[]): ValidLyricRequest {
  const count = Number(req.count ?? 3);
  if (!Number.isInteger(count) || count < 1 || count > MAX_LYRIC_VERSIONS)
    throw new LyricsError(`count debe ser un entero de 1 a ${MAX_LYRIC_VERSIONS}`);
  const mode = req.melismaMode ?? "respetar";
  if (mode !== "respetar" && mode !== "silabizar") throw new LyricsError("melismaMode inválido");
  const idx = new Set(phrases.map((p) => p.idx));
  const ints = (xs: unknown, what: string) => {
    if (xs === undefined) return undefined;
    if (!Array.isArray(xs) || xs.some((x) => !Number.isInteger(x) || !idx.has(x as number)))
      throw new LyricsError(`${what}: índices de frase inválidos`);
    return xs as number[];
  };
  const str = (v: unknown, max: number, what: string) => {
    if (v === undefined || v === null || v === "") return undefined;
    if (typeof v !== "string") throw new LyricsError(`${what} debe ser texto`);
    return v.trim().slice(0, max);
  };
  const temaId = str(req.temaId, 96, "temaId");
  if (temaId && !isSafeId(temaId)) throw new LyricsError("temaId inválido");
  return {
    count,
    melismaMode: mode,
    brief: str(req.brief, 2000, "brief"),
    persona: str(req.persona, 1000, "persona"),
    rhyme: str(req.rhyme, 16, "rhyme"),
    songId: str(req.songId, 80, "songId"),
    ...(temaId ? { temaId } : {}),
    locked: ints(req.locked, "locked"),
    onlyPhrases: ints(req.onlyPhrases, "onlyPhrases"),
  };
}

/** Un turno del SDK con UNA tool que captura sus argumentos. Inyectable para las pruebas. */
export type LyricToolRunner = <T>(
  toolName: string,
  description: string,
  shape: Parameters<typeof tool>[2],
  prompt: string,
  signal: AbortSignal | undefined,
) => Promise<T | null>;

async function runToolSdk<T>(
  toolName: string,
  description: string,
  shape: Parameters<typeof tool>[2],
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<T | null> {
  let captured: T | null = null;
  const recordTool = tool(toolName, description, shape, async (args) => {
    captured = args as T;
    return { content: [{ type: "text" as const, text: "Registrado." }] };
  });
  // Una señal YA abortada no dispara "abort": sin esta guarda, el turno corría entero.
  if (signal?.aborted) throw stopped();
  const server = createSdkMcpServer({ name: "letras", version: "0.1.0", tools: [recordTool] });
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) abort.abort();
  try {
    const q = query({
      prompt,
      options: {
        cwd: process.cwd(),
        systemPrompt: SYSTEM_PROMPT,
        model: env.COMPOSICION_LYRICS_MODEL,
        effort: env.COMPOSICION_LYRICS_EFFORT,
        ...(env.COMPOSICION_LYRICS_THINKING === "off"
          ? { thinking: { type: "disabled" as const } }
          : {}),
        maxTurns: 6,
        settingSources: [],
        env: childEnv(),
        mcpServers: { letras: server },
        allowedTools: [`mcp__letras__${toolName}`],
        permissionMode: "default",
        abortController: abort,
      },
    });
    try {
      for await (const message of q) void message;
    } catch (err) {
      if (!captured) throw err;
      console.warn(
        `[composicion] letras rescatadas pese al error del SDK: ${String(err).slice(0, 160)}`,
      );
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw stopped();
  return captured;
}

let runTool: LyricToolRunner = runToolSdk;

/** Cada llamada al modelo pasa por aquí: con la señal abortada no se abre ni un turno más. */
const callTool: LyricToolRunner = (toolName, description, shape, prompt, signal) =>
  signal?.aborted ? Promise.reject(stopped()) : runTool(toolName, description, shape, prompt, signal);

/** Para las pruebas: cambia el turno del SDK por un stub (sin argumento, vuelve al real). */
export function setLyricToolRunner(fn?: LyricToolRunner): void {
  runTool = fn ?? runToolSdk;
}

/** El molde de cada frase con sus `slots` (si phraseMold todavía no los trae, se calculan aparte). */
function moldWithSlots(ph: Phrase, mode: MelismaMode): PhraseMold {
  const mold = phraseMold(ph, mode);
  if (!mold.slots) {
    try {
      mold.slots = moldSlots(ph, mode);
    } catch {
      // Sin slots, el molde sigue sirviendo: sílabas, acentos, final y melismas.
    }
  }
  return mold;
}

/** Ids de los ángulos que ya existen en el tablero (las versiones guardan el label). */
export function usedAngleIds(board: LyricBoard): string[] {
  const ids = new Set<string>();
  for (const v of board.versions) {
    const a = LYRIC_ANGLES.find((x) => x.label === v.angle || x.id === v.angle);
    if (a) ids.add(a.id);
  }
  return [...ids];
}

/** Parte los ángulos en tandas: una sola hasta 5; dos disjuntas (mitad y mitad) arriba de 5. */
/** Una llamada por ángulo (ver MAX_PARALLEL). */
export function angleBatches(angles: LyricAngle[]): LyricAngle[][] {
  return angles.map((a) => [a]);
}

/** Asigna a cada versión devuelta su ángulo de la tanda: por id/label si el modelo lo dijo, si no por orden. */
function assignAngles(
  raw: RawVersion[],
  batch: LyricAngle[],
): { angle: LyricAngle; v: RawVersion }[] {
  const free = [...batch];
  const out: { angle: LyricAngle; v: RawVersion }[] = [];
  const pending: RawVersion[] = [];
  for (const v of raw.slice(0, batch.length)) {
    const said = (v.angle ?? "").trim().toLowerCase();
    const i = free.findIndex((a) => a.id === said || a.label.toLowerCase() === said);
    if (i >= 0) out.push({ angle: free.splice(i, 1)[0], v });
    else pending.push(v);
  }
  for (const v of pending) if (free.length) out.push({ angle: free.shift()!, v });
  return out.sort((a, b) => batch.indexOf(a.angle) - batch.indexOf(b.angle));
}

/**
 * El tema del pedido: el de la toma (si el pasaje es una toma) o el `temaId`
 * pedido. Una toma cuyo tema se borró sigue sirviendo sin contexto de tema.
 */
async function resolveTema(
  session: ComposeSession,
  passageId: string,
  temaId: string | undefined,
): Promise<{ tema: Tema; section?: TemaSection } | null> {
  if (session.take) {
    if (temaId && temaId !== session.take.temaId)
      throw new LyricsError("temaId no es el tema de esta toma");
    const tema = await readTema(session.take.temaId);
    if (!tema) return null;
    return { tema, section: tema.track.sections.find((s) => s.id === session.take!.sectionId) };
  }
  if (!temaId) return null;
  const tema = await readTema(temaId);
  if (!tema) throw new LyricsError("el tema no existe", 404);
  const section = tema.track.sections.find((s) =>
    s.refs?.some((r) => r.sessionId === session.id && r.passageId === passageId),
  );
  return { tema, ...(section ? { section } : {}) };
}

const VERSIONS_SHAPE = {
  versions: z
    .array(
      z.object({
        angle: z.string().describe("El id del ángulo asignado a esta versión (p.ej. «imagen»)."),
        lines: z.array(
          z.object({
            phrase: z.number().int().describe("Número de la frase (el de [frase N])."),
            text: z.string().describe("La línea, tal como se canta."),
            why: z.string().describe("Por qué esta línea: imagen, acento, eco o melisma."),
          }),
        ),
      }),
    )
    .min(1)
    .max(MAX_LYRIC_VERSIONS),
};

/**
 * Genera `count` versiones nuevas y las AGREGA al tablero de letras del pasaje
 * (las anteriores no se pisan). Síncrono (~30-90 s); `signal` = el request.
 */
export async function generateLyrics(
  sessionId: string,
  passageId: string,
  rawReq: LyricRequest,
  signal?: AbortSignal,
): Promise<LyricBoard> {
  const session = await readSession(sessionId);
  if (!session) throw new LyricsError("sesión no encontrada", 404);
  const passage = session.passages.find((p) => p.id === passageId);
  if (!passage) throw new LyricsError("pasaje no encontrado", 404);
  const analysis = await readAnalysis(sessionId, passageId);
  if (!analysis) throw new LyricsError("el pasaje todavía no tiene análisis (melodía)", 409);
  if (!analysis.phrases.length) throw new LyricsError("el pasaje no tiene frases medibles", 409);
  const req = validateRequest(rawReq, analysis.phrases);
  const mode = req.melismaMode;
  // El tablero leído contra las frases de ESTE análisis: lo escrito sobre otras
  // frases (stale) no entra como bloqueado ni como contexto de su índice.
  const sig = phraseSignature(analysis);
  const board = await readLyrics(sessionId, passageId);
  reconcileLyricBoard(board, sig);

  const molds = new Map(analysis.phrases.map((ph) => [ph.idx, moldWithSlots(ph, mode)]));
  const locked = new Set(req.locked ?? board.locked);
  const targets = analysis.phrases
    .map((p) => p.idx)
    .filter((i) => !locked.has(i) && (!req.onlyPhrases?.length || req.onlyPhrases.includes(i)));
  if (!targets.length)
    throw new LyricsError("no hay frases para escribir (todas bloqueadas o fuera de onlyPhrases)");

  const temaInfo = await resolveTema(session, passageId, req.temaId);
  const temaBlock = temaInfo
    ? temaContext({
        tema: temaInfo.tema,
        section: temaInfo.section,
        take: session.take,
        grid: analysis.grid,
      })
    : "";

  let songBlock = "";
  if (req.songId) {
    const b = await readBoard();
    const song = b?.songs.find((s) => s.id === req.songId);
    if (!song) throw new LyricsError("la canción destino no existe en el tablero", 404);
    const refs = (b?.refs ?? []).filter((r) => song.refIds.includes(r.id));
    songBlock = songContext(song, refs);
  }
  const mine = new Map(board.mine.filter((m) => !m.stale).map((m) => [m.phrase, m.text]));
  const phraseLines = analysis.phrases
    .map((ph) => {
      const base = describeMold(ph, molds.get(ph.idx)!, mode);
      if (locked.has(ph.idx))
        return `${base}\n   BLOQUEADA — ya escrita: «${mine.get(ph.idx) ?? "(sin texto)"}»`;
      return targets.includes(ph.idx) ? `${base}\n   → ESCRIBIR` : `${base}\n   (no se pide ahora)`;
    })
    .join("\n");

  // Ángulos EXPLÍCITOS: nuevos para este pasaje, primero los naturales del género.
  const angles = pickAngles(req.count, usedAngleIds(board), temaInfo?.tema.intent.genre);
  const batches = angleBatches(angles);

  const basePrompt = `${temaBlock ? `${temaBlock}\n\n` : ""}Pasaje ${passage.label} (${clock(passage.start)}–${clock(passage.end)} de ${session.take ? "la toma" : "la sesión"}), tipo ${passage.kind}.
Modo de melisma: ${mode === "respetar" ? "RESPETAR (una sílaba estirada sobre la corrida)" : "SILABIZAR (cada nota de la corrida lleva su sílaba)"}.
${req.rhyme ? `Esquema de rima pedido: ${req.rhyme} (sobre las frases en orden).` : ""}
${req.persona ? `Voz/persona: ${req.persona}` : ""}
${req.brief ? `Indicación de ${OWNER}: ${req.brief}` : ""}

${sessionContext(session)}
${songBlock}

## Frases (el molde de cada una)
${phraseLines}`;

  const promptFor = (batch: LyricAngle[]) => `${basePrompt}

## Versiones a escribir — UNA por ángulo, en este orden
${batch.map((a, i) => `${i + 1}. «${a.label}» (id: ${a.id}) — ${a.brief}`).join("\n")}

Escribe ${batch.length} versión(es): cada una DESDE su ángulo, con una línea por cada frase marcada → ESCRIBIR (frases ${targets.join(", ")}) y su why. En \`angle\` va el id asignado. Llama a record_lyric_versions.`;

  emit({
    private: true,
    kind: "tool_call",
    taskId: `composicion-${sessionId}`,
    toolName: "composicion_letras",
    detail: `${req.count} versiones para ${passage.label}`,
  });
  // Una llamada por versión, en paralelo (MAX_PARALLEL): si una falla, las otras sirven.
  const settled = await pooled(
    batches.map(
      (batch) => () =>
        callTool<{ versions: RawVersion[] }>(
          "record_lyric_versions",
          "Registra las versiones de letra. Llámala UNA sola vez.",
          VERSIONS_SHAPE,
          promptFor(batch),
          signal,
        ),
    ),
    MAX_PARALLEL,
    signal,
  );
  if (signal?.aborted) throw stopped();
  const assigned: { angle: LyricAngle; v: RawVersion }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled")
      assigned.push(...assignAngles(r.value?.versions ?? [], batches[i]));
    else console.warn(`[composicion] una tanda de letras falló: ${String(r.reason).slice(0, 160)}`);
  });
  if (!assigned.length) {
    const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed) throw failed.reason;
    throw new LyricsError("el modelo no registró versiones", 500);
  }

  // Medida contra el molde (la misma función que usa el dashboard en vivo).
  const measure = (phrase: number, text: string): LineFit =>
    lineFit(text, molds.get(phrase)!, mode);
  const drafts = assigned.map(({ angle, v }) => {
    const seen = new Set<number>();
    const lines: LyricLine[] = [];
    for (const l of v.lines ?? []) {
      const text = l.text?.replace(/\s+/g, " ").trim();
      if (!text || !targets.includes(l.phrase) || seen.has(l.phrase)) continue;
      seen.add(l.phrase);
      lines.push({
        phrase: l.phrase,
        text,
        ...(l.why?.trim() ? { why: l.why.trim() } : {}),
        fit: measure(l.phrase, text),
      });
    }
    return { angle: angle.label, lines: lines.sort((a, b) => a.phrase - b.phrase) };
  });

  // UNA ronda de reparación, en paralelo POR VERSIÓN (cada llamada ve solo su
  // versión: así el eco no empuja a todas a la misma plantilla).
  const describeBroken = ({ vi, line }: { vi: number; line: LyricLine }) => {
    const ph = analysis.phrases.find((p) => p.idx === line.phrase)!;
    const f = line.fit;
    const why: string[] = [];
    if (syllableGap(f) >= 2)
      why.push(`mide ${f.syllables} sílabas (rango ${f.range[0]}–${f.range[1]}), pide ${f.target}`);
    // La lectura sílaba por sílaba: sin razonamiento extendido, el modelo no
    // cuenta bien; viendo cómo se contó, sabe exactamente dónde sobra o falta.
    if (f.reading?.length)
      why.push(`así se cuenta hoy: ${f.reading.join("-")} (${f.reading.length})`);
    if ((f.misaccents?.length ?? 0) >= 2)
      why.push(
        `malacentos: ${f.misaccents!.map((m) => `«${m.syl}» en la posición ${m.pos}`).join(", ")} caen en tiempo débil y corto`,
      );
    if (lowEcho(f)) {
      const want = f
        .echo!.perSlot.map(
          (p) => `${p.pos}:${p.want}${p.got && p.got !== p.want ? `(tienes ${p.got})` : ""}`,
        )
        .join(" ");
      why.push(
        `eco ${Math.round(f.echo!.score * 100)} %: el tarareo pedía estas vocales por posición → ${want}; conserva la mayoría, sobre todo las largas`,
      );
    }
    if (f.hint) why.push(f.hint);
    return `- versión ${vi}, ${describeMold(ph, molds.get(line.phrase)!, mode)}
   actual: «${line.text}» → ${why.join(" · ")}`;
  };
  // Hasta REPAIR_ROUNDS rondas: el verificador (lineFit) manda y cada ronda solo
  // toca lo que sigue fallando. Sin razonamiento extendido, una sola ronda no
  // alcanzaba (líneas de 13/10 sílabas sobrevivían).
  for (let round = 0; round < REPAIR_ROUNDS && !signal?.aborted; round++) {
    const broken = drafts.flatMap((d, vi) =>
      d.lines.filter((l) => needsRepair(l.fit)).map((l) => ({ vi, line: l })),
    );
    const byVersion = new Map<number, { vi: number; line: LyricLine }[]>();
    for (const b of broken) byVersion.set(b.vi, [...(byVersion.get(b.vi) ?? []), b]);
    if (!byVersion.size) break;
    {
      const tasks = [...byVersion.entries()].map(([vi, items]) => async () => {
        const repairPrompt = `Estas líneas de la versión ${vi} (ángulo «${drafts[vi].angle}») no calzan con su molde (no calzan en sílabas, tienen 2 o más tónicas en posición débil, o perdieron las vocales del tarareo). Reescríbelas manteniendo el ÁNGULO de la versión, sus imágenes propias, la idea de la línea y el conteo de sílabas.

${items.map(describeBroken).join("\n")}

Llama a record_repairs con una línea por cada una (version = ${vi}).`;
        return callTool<{
          repairs: { version: number; phrase: number; text: string; why?: string }[];
        }>(
          "record_repairs",
          "Registra las líneas reparadas. Llámala UNA sola vez.",
          {
            repairs: z.array(
              z.object({
                version: z.number().int().describe("El número de versión indicado."),
                phrase: z.number().int(),
                text: z.string(),
                why: z.string().optional(),
              }),
            ),
          },
          repairPrompt,
          signal,
        );
      });
      const results = await pooled(tasks, MAX_PARALLEL, signal);
      if (signal?.aborted) throw stopped();
      for (const r of results) {
        if (r.status === "rejected") {
          if (r.reason instanceof LyricsError && r.reason.status === 409) throw r.reason;
          console.warn(
            `[composicion] reparación de letras falló (se guardan las originales): ${String(r.reason).slice(0, 160)}`,
          );
          continue;
        }
        for (const rp of r.value?.repairs ?? []) {
          const d = drafts[rp.version];
          const line = d?.lines.find((l) => l.phrase === rp.phrase);
          const text = rp.text?.replace(/\s+/g, " ").trim();
          if (!line || !text) continue;
          const fit = measure(rp.phrase, text);
          // Solo si mejora: una reparación que empeora no reemplaza nada.
          if (repairImproves(fit, line.fit)) {
            line.text = text;
            line.fit = fit;
            if (rp.why?.trim()) line.why = rp.why.trim();
          }
        }
      }
    }
  }

  const now = new Date().toISOString();
  const fresh: LyricVersion[] = drafts
    .filter((d) => d.lines.length)
    .map((d) => ({
      id: uid("v"),
      angle: d.angle,
      lines: d.lines,
      createdAt: now,
      ...(req.brief ? { brief: req.brief } : {}),
      melismaMode: mode,
    }));
  if (!fresh.length) throw new LyricsError("las versiones llegaron vacías", 500);
  // Solo se AGREGAN versiones. brief/persona/rima/bloqueos/modo son del humano
  // y se guardan por PUT: reescribirlos con los del pedido revertía lo que
  // cambió mientras el modelo escribía (30-90 s). Si un re-análisis movió las
  // frases mientras tanto, las nuevas se escribieron sobre las viejas: stale.
  const nowAnalysis = await readAnalysis(sessionId, passageId);
  const nowSig = nowAnalysis ? phraseSignature(nowAnalysis) : sig;
  const saved = await patchLyrics(sessionId, passageId, (b) => {
    reconcileLyricBoard(b, nowSig);
    const stale = nowSig !== sig;
    b.versions = [...b.versions, ...fresh.map((v) => (stale ? { ...v, stale: true } : v))];
  });
  emit({
    private: true,
    kind: "task_done",
    taskId: `composicion-${sessionId}`,
    detail: `${fresh.length} versión(es) de letra para ${passage.label}`,
  });
  return saved;
}

/** PUT del tablero de letras: lo que el humano arma (Tu versión, bloqueos, brief). */
export async function updateLyricBoard(
  sessionId: string,
  passageId: string,
  input: Record<string, unknown>,
): Promise<LyricBoard> {
  const session = await readSession(sessionId);
  if (!session?.passages.some((p) => p.id === passageId))
    throw new LyricsError("pasaje no encontrado", 404);
  if (input.phrasesSig !== undefined && input.phrasesSig !== null && typeof input.phrasesSig !== "string")
    throw new LyricsError("phrasesSig debe ser texto (la firma de frases que viste)");
  const analysis = await readAnalysis(sessionId, passageId);
  const sig = analysis ? phraseSignature(analysis) : undefined;
  // El cliente escribió sobre OTRAS frases (las vio antes de un re-análisis):
  // lo suyo se guarda, pero como de un análisis anterior.
  const clientStale = typeof input.phrasesSig === "string" && sig !== undefined && input.phrasesSig !== sig;
  const patch: Partial<LyricBoard> = {};
  if (input.mine !== undefined) {
    if (!Array.isArray(input.mine)) throw new LyricsError("mine debe ser una lista");
    patch.mine = input.mine.map((m) => {
      const x = m as Record<string, unknown>;
      if (!Number.isInteger(x.phrase) || typeof x.text !== "string")
        throw new LyricsError("cada línea de mine necesita phrase y text");
      if (x.stale !== undefined && typeof x.stale !== "boolean") throw new LyricsError("stale debe ser true/false");
      return {
        phrase: x.phrase as number,
        text: x.text.slice(0, 400),
        ...(typeof x.from === "string" ? { from: x.from } : {}),
        ...(x.stale === true || clientStale ? { stale: true } : {}),
      };
    });
  }
  if (input.locked !== undefined && !clientStale) {
    if (!Array.isArray(input.locked) || input.locked.some((x) => !Number.isInteger(x)))
      throw new LyricsError("locked debe ser una lista de enteros");
    patch.locked = input.locked as number[];
  }
  for (const k of ["brief", "persona", "rhyme"] as const) {
    if (input[k] === undefined) continue;
    if (input[k] !== null && typeof input[k] !== "string")
      throw new LyricsError(`${k} debe ser texto`);
    patch[k] = (input[k] as string | null)?.slice(0, 2000) || undefined;
  }
  if (input.melismaMode !== undefined) {
    if (input.melismaMode !== "respetar" && input.melismaMode !== "silabizar")
      throw new LyricsError("melismaMode inválido");
    patch.melismaMode = input.melismaMode;
  }
  return patchLyrics(sessionId, passageId, (b) => {
    if (sig !== undefined) reconcileLyricBoard(b, sig);
    Object.assign(b, patch);
    for (const k of ["brief", "persona", "rhyme"] as const)
      if (k in patch && patch[k] === undefined) delete b[k];
  });
}

/**
 * El tablero de letras visto contra el análisis VIGENTE (GET de la ruta). Si
 * un re-análisis movió las frases y nadie lo alineó todavía, se alinea y se
 * persiste (mine/versions → stale, locked suelto). Un tablero sin firma se
 * devuelve tal cual: la adopta en su próxima escritura.
 */
export async function readLyricsAligned(sessionId: string, passageId: string): Promise<LyricBoard> {
  const board = await readLyrics(sessionId, passageId);
  const analysis = await readAnalysis(sessionId, passageId);
  if (!analysis || board.phrasesSig === undefined) return board;
  const sig = phraseSignature(analysis);
  if (board.phrasesSig === sig || !(await hasLyrics(sessionId, passageId))) return board;
  return patchLyrics(sessionId, passageId, (b) => void reconcileLyricBoard(b, sig));
}

/** Corrección humana del molde de una frase (manda sobre lo medido). */
export function validateOverride(raw: unknown): Phrase["override"] | null {
  if (raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw))
    throw new LyricsError("override debe ser un objeto o null");
  const o = raw as Record<string, unknown>;
  const out: NonNullable<Phrase["override"]> = {};
  if (o.syllables !== undefined) {
    if (
      !Number.isInteger(o.syllables) ||
      (o.syllables as number) < 1 ||
      (o.syllables as number) > 64
    )
      throw new LyricsError("syllables debe ser un entero de 1 a 64");
    out.syllables = o.syllables as number;
  }
  if (o.ending !== undefined) {
    if (!["aguda", "llana", "esdrujula"].includes(o.ending as string))
      throw new LyricsError("ending inválido");
    out.ending = o.ending as PhraseMold["ending"];
  }
  if (o.rhyme !== undefined) {
    if (typeof o.rhyme !== "string" || o.rhyme.length > 3)
      throw new LyricsError("rhyme: una letra (A, B…)");
    if (o.rhyme) out.rhyme = o.rhyme.toUpperCase();
  }
  return Object.keys(out).length ? out : null;
}

// ─────────────────────────── Canción desde la sesión ───────────────────────────

const KIND_WORDS: [RegExp, SectionKind][] = [
  [/intro/i, "intro"],
  [/pre/i, "pre"],
  [/coro|estribillo|hook|chorus/i, "coro"],
  [/puente|bridge/i, "puente"],
  [/final|outro|cierre/i, "final"],
  [/instrumental|solo/i, "instrumental"],
  [/verso|estrofa|verse/i, "verso"],
];

function kindOf(label: string): SectionKind {
  return KIND_WORDS.find(([re]) => re.test(label))?.[1] ?? "verso";
}

/** Orden musical de las secciones (el resumen las nombra en el orden en que se HABLARON). */
const KIND_ORDER: SectionKind[] = [
  "intro",
  "verso",
  "pre",
  "coro",
  "puente",
  "instrumental",
  "final",
];
const KIND_LABEL: Record<SectionKind, string> = {
  intro: "Intro",
  verso: "Verso",
  pre: "Pre-coro",
  coro: "Coro",
  puente: "Puente",
  instrumental: "Instrumental",
  final: "Final",
};

/** Para deduplicar líneas: al componer se ITERA la misma frase muchas veces. */
const normLine = (t: string) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Crea la canción en el tablero desde el resumen: título de trabajo, tonalidad
 * medida de la sesión, semilla = el tema, secciones desde la estructura (en
 * orden musical, una por tipo) con SUS líneas literales, sin repetir: al
 * componer se itera la misma frase diez veces y la canción la quiere una vez.
 * Las líneas que el resumen no ubicó en ninguna sección NO se inventan un
 * lugar: van al Cuaderno como versos sueltos de esta canción. Idempotente: si
 * la sesión ya tiene canción, la devuelve.
 */
export async function createSongFromSession(sessionId: string): Promise<Song> {
  const session = await readSession(sessionId);
  if (!session) throw new LyricsError("sesión no encontrada", 404);
  const board = await readBoard();
  if (session.songId) {
    const existing = board?.songs.find((s) => s.id === session.songId);
    if (existing) return existing;
  }
  const sm = session.summary;
  if (!sm)
    throw new LyricsError("la sesión no tiene resumen todavía (etapa «Resumen de la sesión»)", 409);

  const now = new Date().toISOString();
  // Una sección por TIPO: el resumen dice "coro" cinco veces (cinco ideas del
  // mismo coro), no cinco coros. Las ideas se juntan en la intención.
  const byKind = new Map<SectionKind, SongSection>();
  const ensure = (label: string, idea?: string): SongSection => {
    const kind = kindOf(label);
    let sec = byKind.get(kind);
    if (!sec) {
      sec = { id: uid("sec"), kind, label: KIND_LABEL[kind], lyrics: "", chords: [], bars: 8 };
      byKind.set(kind, sec);
    }
    if (idea && !sec.intent?.includes(idea))
      sec.intent = sec.intent ? `${sec.intent} · ${idea}` : idea;
    return sec;
  };
  for (const st of sm.structure) ensure(st.section, st.idea);
  const seen = new Set<string>();
  const loose: NotebookEntry[] = [];
  for (const line of sm.lines) {
    const key = normLine(line.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!line.section?.trim()) {
      loose.push({ id: uid("n"), kind: "verso", text: line.text, at: now });
      continue;
    }
    const sec = ensure(line.section);
    sec.lyrics = sec.lyrics ? `${sec.lyrics}\n${line.text}` : line.text;
    // Melodía de referencia: el pasaje analizado donde se cantó la primera línea.
    if (!sec.memo) {
      const p = session.passages.find(
        (q) => q.status === "listo" && line.at >= q.start - 1 && line.at <= q.end + 1,
      );
      if (p) sec.memo = { sessionId, passageId: p.id, semitones: 0 };
    }
  }
  if (!byKind.size) ensure("Verso");
  const sections = [...byKind.values()].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind),
  );
  const inSections = [...byKind.values()].reduce(
    (n, sec) => n + sec.lyrics.split("\n").filter(Boolean).length,
    0,
  );

  const measured = session.key?.best.key;
  const notes: string[] = [];
  if (!measured) notes.push("tonalidad sin medir (Do mayor provisional)");
  notes.push("tempo sin medir (90 provisional)");
  const song: Song = {
    id: uid("s"),
    title: sm.workingTitle || session.title,
    stage: "letra",
    key: measured ?? { tonic: 0, mode: "major" },
    tempo: 90,
    meter: "4/4",
    mood: [],
    seed: sm.theme,
    sections,
    refIds: [],
    versions: [
      {
        id: uid("v"),
        at: now,
        note: `Creada desde la sesión «${session.title}»: ${inSections} líneas literales en secciones${loose.length ? ` · ${loose.length} sueltas al Cuaderno` : ""}${measured ? ` · tonalidad medida ${keyLabel(measured, "latin")} (aprox.)` : ""} · ${notes.join(" · ")}`,
        scope: "letra",
      },
    ],
    createdAt: now,
    updatedAt: now,
    sessionIds: [sessionId],
  };
  await updateBoard((b) => {
    b.songs = [song, ...b.songs];
    b.notebook = [...loose.map((n) => ({ ...n, songId: song.id })), ...b.notebook];
  });
  await patchSession(sessionId, (s) => void (s.songId = song.id));
  return song;
}
