/**
 * Resumen de una sesión de composición (Agent SDK, patrón ingest: un turno +
 * una tool acotada que captura el resultado estructurado).
 *
 * Lo que más importa del resumen son las LÍNEAS DE LETRA: literales, con su
 * momento. Alimentan la detección de pasajes (cierran las omisiones del audio:
 * una frase cantada sin evento, sin relleno ni repetición) y la canción que se
 * crea desde la sesión. Por eso se validan contra la transcripción: una línea
 * que no aparece ahí se descarta — el modelo no escribe letra aquí.
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ComposeSession, SessionSummary, TranscriptWord } from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";
import { OWNER, ownerBlurb } from "../owner.js";
import { clock, transcriptLines } from "./transcribe.js";

/** Tope de transcripción en el prompt (~2 h de sesión caben). */
const MAX_TRANSCRIPT_CHARS = 120_000;

const SYSTEM_PROMPT = `# Hermes — Resumen de una sesión de composición

Lees la transcripción (con tiempos y voces) de una sesión en la que ${OWNER}${ownerBlurb("Composición")} y otras personas componen una canción: hablan, prueban melodías, cantan, repiten frases, deciden.

Reglas (no negociables):
- **Las líneas de letra son LITERALES.** Copia EXACTAMENTE lo que dice la transcripción (misma palabra, mismo orden). Nada inventado, nada corregido, nada completado. Si una línea se cantó varias veces, anótala UNA vez con su primer momento (t=).
- Una línea de letra es algo que CANTARON o dictaron como parte de la canción — no la conversación sobre ella. Los rellenos cantados ("na na", "dun dun", "uh uh") también cuentan si son parte de la melodía.
- \`at\` es el segundo (t=) de la línea de la transcripción donde aparece. \`speaker\` es el id tal cual (speaker_0…).
- \`section\`: solo si lo dijeron o es evidente por lo que hablan ("esto es el coro"). Si no, omítelo.
- \`structure\`, \`decisions\` y \`pending\`: frases cortas en español, fieles a lo que se habló (un esquema de rima acordado, "el coro tiene que ser chicle", "falta el puente").
- \`workingTitle\` SOLO si nombraron la canción. \`theme\`: de qué va la canción, en una o dos frases, según lo que se habló — no según lo que te parezca.
- Sin nombres propios de las personas en theme/structure/decisions: di "una voz", "el productor", etc.

Responde SIEMPRE llamando a la tool record_session_summary UNA sola vez.`;

type Captured = Omit<SessionSummary, "generatedAt">;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * ¿La línea está literalmente en la transcripción cerca de `at`? Acepta si
 * es subcadena normalizada de la ventana, o si ≥85 % de sus palabras están
 * ahí (Scribe parte y junta palabras distinto entre pasadas). Devuelve el
 * momento real (inicio de la primera palabra que calza) o null.
 */
export function verifyLiteral(
  text: string,
  at: number,
  words: TranscriptWord[],
): { at: number } | null {
  const tokens = norm(text).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  const tryWindow = (lo: number, hi: number): { at: number } | null => {
    const win = words.filter((w) => w.type === "word" && w.end >= lo && w.start <= hi);
    if (!win.length) return null;
    const normWords = win.map((w) => norm(w.text));
    const joined = normWords.join(" ");
    const needle = tokens.join(" ");
    let ok = joined.includes(needle);
    if (!ok) {
      const bag = new Map<string, number>();
      for (const w of normWords.flatMap((x) => x.split(" "))) bag.set(w, (bag.get(w) ?? 0) + 1);
      let hit = 0;
      for (const t of tokens) {
        const n = bag.get(t) ?? 0;
        if (n > 0) {
          hit++;
          bag.set(t, n - 1);
        }
      }
      ok = hit / tokens.length >= 0.85;
    }
    if (!ok) return null;
    const first = win.find((w) => norm(w.text).split(" ")[0] === tokens[0]);
    return { at: first ? first.start : win[0].start };
  };
  return tryWindow(at - 20, at + 40) ?? tryWindow(-Infinity, Infinity);
}

export async function summarizeSession(
  session: ComposeSession,
  words: TranscriptWord[],
  signal?: AbortSignal,
): Promise<SessionSummary> {
  const lines = transcriptLines(words);
  const names = new Map(session.speakers.map((s) => [s.id, s.name]));
  let text = lines
    .map(
      (l) =>
        `[t=${l.start.toFixed(1)} | ${clock(l.start)} | ${l.speaker}${names.get(l.speaker) ? ` (${names.get(l.speaker)})` : ""}] ${l.text}`,
    )
    .join("\n");
  if (text.length > MAX_TRANSCRIPT_CHARS) text = text.slice(0, MAX_TRANSCRIPT_CHARS) + "\n[…transcripción recortada]";

  let captured: Captured | null = null;
  const recordTool = tool(
    "record_session_summary",
    "Registra el resumen de la sesión de composición. Llámala UNA sola vez.",
    {
      workingTitle: z.string().optional().describe("Título de trabajo, SOLO si lo dijeron."),
      theme: z.string().describe("De qué va la canción, 1-2 frases, fiel a lo hablado."),
      lines: z
        .array(
          z.object({
            text: z.string().describe("La línea LITERAL de la transcripción."),
            at: z.number().describe("Segundo t= donde aparece por primera vez."),
            speaker: z.string().optional().describe("Id de la voz (speaker_0…)."),
            section: z.string().optional().describe("Sección, solo si se dijo o es evidente."),
          }),
        )
        .describe("Líneas de letra cantadas o dictadas, en orden de aparición."),
      structure: z
        .array(z.object({ section: z.string(), idea: z.string(), at: z.number().optional() }))
        .describe("Ideas de estructura (intro, verso, coro…)."),
      decisions: z.array(z.object({ text: z.string(), at: z.number().optional() })),
      pending: z.array(z.object({ text: z.string(), at: z.number().optional() })),
    },
    async (args) => {
      captured = args;
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({ name: "composicion", version: "0.1.0", tools: [recordTool] });

  const abort = new AbortController();
  const onAbort = () => abort.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const q = query({
      prompt: `Sesión: **${session.title}** (${clock(session.durationSec ?? 0)} de grabación).
Voces: ${session.speakers.map((s) => `${s.id} = ${s.name}`).join(", ") || "sin diarización"}.

Transcripción (una línea por turno; [canta]/[risas] son eventos de audio):
"""
${text}
"""

Arma el resumen y llama a record_session_summary.`,
      options: {
        cwd: process.cwd(),
        systemPrompt: SYSTEM_PROMPT,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 8,
        settingSources: [],
        env: childEnv(),
        mcpServers: { composicion: server },
        allowedTools: ["mcp__composicion__record_session_summary"],
        permissionMode: "default",
        abortController: abort,
      },
    });
    // El SDK LANZA desde el iterador cuando el result es de error (maxTurns):
    // si la tool ya se llamó, el resumen es válido igual.
    try {
      for await (const message of q) void message;
    } catch (err) {
      if (!captured) throw err;
      console.warn(`[composicion] resumen rescatado pese al error del SDK: ${String(err).slice(0, 160)}`);
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  if (signal?.aborted) throw new Error("detenido");
  if (!captured) throw new Error("el modelo no llamó record_session_summary");
  return finalizeSummary(captured, words);
}

/** Valida lo literal y ordena. Lo que no está en la transcripción se descarta. */
export function finalizeSummary(c: Captured, words: TranscriptWord[]): SessionSummary {
  const lines: SessionSummary["lines"] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const l of c.lines ?? []) {
    const t = l.text?.trim();
    if (!t) continue;
    const ok = verifyLiteral(t, Number(l.at) || 0, words);
    if (!ok) {
      dropped++;
      continue;
    }
    const key = norm(t);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      text: t,
      at: Math.round(ok.at * 100) / 100,
      ...(l.speaker ? { speaker: l.speaker } : {}),
      ...(l.section?.trim() ? { section: l.section.trim() } : {}),
    });
  }
  if (dropped) console.warn(`[composicion] resumen: ${dropped} línea(s) descartada(s) por no ser literales`);
  lines.sort((a, b) => a.at - b.at);
  const clean = <T extends { text: string }>(xs: T[] | undefined) => (xs ?? []).filter((x) => x.text?.trim());
  return {
    ...(c.workingTitle?.trim() ? { workingTitle: c.workingTitle.trim() } : {}),
    theme: (c.theme ?? "").trim(),
    lines,
    structure: (c.structure ?? []).filter((s) => s.section?.trim() && s.idea?.trim()),
    decisions: clean(c.decisions),
    pending: clean(c.pending),
    generatedAt: new Date().toISOString(),
  };
}
