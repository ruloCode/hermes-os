/**
 * Sonda del catálogo de modelos: pregunta "ok" a cada modelo con la cuenta
 * con la que corre Hermes (suscripción del CLI) y dice cuáles responden,
 * cuánto tardan y qué id real contestó. Sirve para no fijar en el catálogo
 * (src/agent/models.ts) un modelo que esta cuenta no puede usar.
 *
 *   pnpm --filter @hermes/agent exec tsx scripts/probe-models.ts [modelo ...]
 *
 * Gasta unos pocos tokens por modelo. No toca Supabase ni el vault.
 */
import { query } from "@anthropic-ai/claude-agent-sdk";
import { childEnv } from "../src/agent/child-env.js";

const DEFAULT = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-2", "haiku", "sonnet", "opus"];

interface Probe {
  asked: string;
  ok: boolean;
  answered?: string;
  ttftMs?: number;
  totalMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  error?: string;
}

async function probe(model: string, extra: Record<string, unknown> = {}): Promise<Probe> {
  const t0 = Date.now();
  const out: Probe = { asked: model, ok: false };
  try {
    const q = query({
      prompt: "Responde solo con la palabra: ok",
      options: {
        model,
        maxTurns: 1,
        settingSources: [],
        tools: [],
        systemPrompt: "Eres una sonda. Responde exactamente lo que se te pide, sin nada más.",
        includePartialMessages: true,
        env: childEnv(),
        ...extra,
      } as never,
    });
    for await (const message of q) {
      const m = message as Record<string, any>;
      if (m.type === "stream_event" && out.ttftMs === undefined && m.event?.type === "content_block_delta") out.ttftMs = Date.now() - t0;
      if (m.type === "assistant" && m.message?.model) out.answered = m.message.model;
      if (m.type === "result") {
        out.totalMs = Date.now() - t0;
        out.ok = m.subtype === "success";
        out.costUsd = m.total_cost_usd;
        out.inputTokens = m.usage?.input_tokens;
        out.outputTokens = m.usage?.output_tokens;
        if (!out.ok) out.error = String(m.result ?? m.subtype).slice(0, 200);
        const models = Object.keys(m.modelUsage ?? {});
        if (models.length && !out.answered) out.answered = models.join(",");
      }
    }
  } catch (err) {
    out.totalMs = Date.now() - t0;
    out.error = String(err).slice(0, 240);
  }
  return out;
}

const asked = process.argv.slice(2);
const variants = asked.includes("--thinking");
const models = asked.filter((a) => !a.startsWith("--"));
const list = models.length ? models : DEFAULT;

const rows: Probe[] = [];
for (const model of list) {
  rows.push(await probe(model));
  if (variants) {
    rows.push({ ...(await probe(model, { thinking: { type: "disabled" } })), asked: `${model} · thinking disabled` });
    rows.push({ ...(await probe(model, { effort: "low" })), asked: `${model} · effort low` });
  }
}
for (const r of rows) {
  console.log(
    [
      r.ok ? "✓" : "✗",
      r.asked.padEnd(38),
      (r.answered ?? "—").padEnd(28),
      `ttft ${r.ttftMs ?? "—"} ms`.padEnd(14),
      `total ${r.totalMs ?? "—"} ms`.padEnd(16),
      `in ${r.inputTokens ?? "—"} out ${r.outputTokens ?? "—"}`.padEnd(18),
      r.costUsd !== undefined ? `$${r.costUsd.toFixed(5)}` : "",
      r.error ? `· ${r.error}` : "",
    ].join(" "),
  );
}
console.log(JSON.stringify(rows));
