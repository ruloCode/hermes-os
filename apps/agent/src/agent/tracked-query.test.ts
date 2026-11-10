import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseCallEntry, percentile, summarizeCalls, type CallEntry } from "@hermes/shared";
import { flushCalls, readCallsOfDay, recordCall, usageSummary } from "../usage-ledger.js";
import { resolveOptions, totalsOf, turnDelta } from "./tracked-query.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

function entry(over: Partial<CallEntry> = {}): CallEntry {
  return {
    ts: "2026-11-10T15:00:00.000Z",
    feature: "chat",
    model: "claude-sonnet-5-5",
    models: ["claude-sonnet-5-5"],
    input: 100,
    output: 50,
    cacheRead: 900,
    cacheWrite: 0,
    costUsd: 0.01,
    ms: 2000,
    ttftMs: 800,
    turns: 1,
    status: "ok",
    ...over,
  };
}

// ── Opciones que viajan al SDK ──────────────────────────────────────────

test("sin env explícito el hijo recibe el entorno saneado, no el del agente", () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "secreto-de-prueba";
  try {
    const env = resolveOptions("content.edit", {}).env as Record<string, string>;
    assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, undefined);
    assert.ok(env.PATH, "PATH sí pasa: el CLI lo necesita");
  } finally {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  }
});

test("un env explícito se respeta tal cual", () => {
  const env = { SOLO: "esto" };
  assert.equal(resolveOptions("chat", { env }).env, env);
});

test("sin modelo lo pone el catálogo; con modelo manda quien llama", () => {
  assert.equal(resolveOptions("copilot.fast", {}).model, "claude-haiku-5-5");
  assert.equal(resolveOptions("copilot.fast", { model: "sonnet" }).model, "sonnet");
  assert.equal(resolveOptions("chat", { model: undefined }).model, "claude-sonnet-5-5");
});

test("el razonamiento del catálogo no pisa lo que ya eligió el sitio", () => {
  assert.deepEqual(resolveOptions("copilot.fast", {}).thinking, { type: "disabled" });
  assert.deepEqual(resolveOptions("copilot.fast", { thinking: { type: "adaptive" } }).thinking, { type: "adaptive" });
  assert.equal(resolveOptions("copilot.fast", { maxThinkingTokens: 2000 }).thinking, undefined);
  assert.equal(resolveOptions("chat", {}).thinking, undefined, "el chat deja el razonamiento del modelo");
});

test("el esfuerzo del catálogo entra solo si el sitio no dijo nada", () => {
  assert.equal(resolveOptions("meetings.ingest", {}).effort, "medium");
  assert.equal(resolveOptions("meetings.ingest", { effort: "low" }).effort, "low");
});

// ── Acumulado de la sesión → gasto del turno ────────────────────────────

test("totalsOf suma los modelos y elige como principal el que más salida produjo", () => {
  const t = totalsOf(
    {
      "claude-haiku-5-5": { inputTokens: 10, outputTokens: 5, cacheReadInputTokens: 100, cacheCreationInputTokens: 20, costUSD: 0.001 },
      "claude-sonnet-5-5": { inputTokens: 30, outputTokens: 400, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.02 },
    },
    0.021,
  );
  assert.deepEqual(t.totals, { input: 40, output: 405, cacheRead: 100, cacheWrite: 20, cost: 0.021 });
  assert.equal(t.primary, "claude-sonnet-5-5");
  assert.deepEqual(t.models.sort(), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});

test("totalsOf sin modelUsage no inventa nada", () => {
  const t = totalsOf(undefined, undefined);
  assert.deepEqual(t.totals, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
  assert.equal(t.primary, null);
});

test("en una sesión persistente el turno es la diferencia contra el resultado anterior", () => {
  // Valores reales de la sonda (haiku, tres turnos): modelUsage y costo son acumulados.
  const t1 = { input: 2, output: 4, cacheRead: 0, cacheWrite: 10374, cost: 0.00129895 };
  const t2 = { input: 4, output: 8, cacheRead: 9787, cacheWrite: 10998, cost: 0.00147702 };
  const d = turnDelta(t2, t1);
  assert.equal(d.input, 2);
  assert.equal(d.output, 4);
  assert.equal(d.cacheRead, 9787);
  assert.equal(d.cacheWrite, 624);
  assert.ok(Math.abs(d.cost - 0.00017807) < 1e-9);
});

test("si el acumulado baja (sesión nueva) se toma el valor tal cual, nunca un negativo", () => {
  const d = turnDelta({ input: 5, output: 3, cacheRead: 0, cacheWrite: 10, cost: 0.001 }, { input: 500, output: 300, cacheRead: 900, cacheWrite: 800, cost: 0.5 });
  assert.deepEqual(d, { input: 5, output: 3, cacheRead: 0, cacheWrite: 10, cost: 0.001 });
});

// ── Registro en disco ───────────────────────────────────────────────────

test("lo registrado se lee del día local correcto y sobrevive a líneas rotas", async () => {
  process.env.HERMES_USAGE_DIR = mkdtempSync(join(tmpdir(), "hermes-usage-"));
  try {
    const noon = new Date(2026, 10, 10, 12, 0, 0);
    recordCall(entry({ ts: noon.toISOString(), feature: "chat" }));
    recordCall(entry({ ts: noon.toISOString(), feature: "copilot.fast", model: "claude-haiku-5-5", costUsd: null }));
    await flushCalls();
    const calls = await readCallsOfDay("2026-11-10");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((c) => c.feature), ["chat", "copilot.fast"]);
    assert.equal(calls[1].costUsd, null, "un costo no informado no se vuelve cero");
    assert.deepEqual(await readCallsOfDay("2026-11-09"), []);
  } finally {
    delete process.env.HERMES_USAGE_DIR;
  }
});

test("sin registro el resumen sale vacío y dice que no hay desde cuándo", async () => {
  process.env.HERMES_USAGE_DIR = mkdtempSync(join(tmpdir(), "hermes-usage-"));
  try {
    const s = await usageSummary(7);
    assert.equal(s.since, null);
    assert.equal(s.total.calls, 0);
    assert.deepEqual(s.byFeature, []);
  } finally {
    delete process.env.HERMES_USAGE_DIR;
  }
});

// ── Agregados (puro) ────────────────────────────────────────────────────

test("parseCallEntry descarta lo que no es una llamada y limpia números raros", () => {
  assert.equal(parseCallEntry("no es json"), null);
  assert.equal(parseCallEntry(JSON.stringify({ feature: "chat" })), null, "sin fecha");
  assert.equal(parseCallEntry(JSON.stringify({ ts: "ayer", feature: "chat" })), null, "fecha ilegible");
  const e = parseCallEntry(JSON.stringify({ ts: "2026-11-10T15:00:00Z", feature: "chat", input: -5, output: "12", status: "raro" }));
  assert.ok(e);
  assert.equal(e.input, 0);
  assert.equal(e.output, 12);
  assert.equal(e.status, "ok");
  assert.equal(e.costUsd, null);
});

test("percentile: rango más cercano, y null sin muestras", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([300], 95), 300);
  assert.equal(percentile([100, 200, 300, 400], 50), 200);
  assert.equal(percentile([100, 200, 300, 400], 95), 400);
});

test("el resumen ordena por costo y calcula la parte de la entrada que vino de caché", () => {
  const s = summarizeCalls(
    [
      entry({ feature: "chat", costUsd: 0.5, input: 100, cacheRead: 900, cacheWrite: 0 }),
      entry({ feature: "chat", costUsd: 0.3, input: 1000, cacheRead: 0, cacheWrite: 0 }),
      entry({ feature: "copilot.fast", model: "claude-haiku-5-5", models: ["claude-haiku-5-5"], costUsd: 0.01 }),
    ],
    7,
  );
  assert.deepEqual(s.byFeature.map((f) => f.feature), ["chat", "copilot.fast"]);
  const chat = s.byFeature[0];
  assert.equal(chat.calls, 2);
  assert.equal(chat.costUsd, 0.8);
  assert.equal(chat.cacheRatio, 900 / 2000);
  assert.deepEqual(s.byModel.map((m) => m.model), ["claude-sonnet-5-5", "claude-haiku-5-5"]);
  assert.equal(s.total.calls, 3);
});

test("una función que no informa costo muestra null, no cero", () => {
  const s = summarizeCalls([entry({ costUsd: null }), entry({ costUsd: null })], 7);
  assert.equal(s.byFeature[0].costUsd, null);
  assert.equal(s.total.costUsd, null);
});

test("la latencia se mide solo sobre lo que terminó bien; los errores se cuentan aparte", () => {
  const s = summarizeCalls([entry({ ms: 1000, ttftMs: 400 }), entry({ ms: 3000, ttftMs: 600 }), entry({ ms: 50, ttftMs: null, status: "aborted" }), entry({ ms: 80, ttftMs: null, status: "error" })], 7);
  const chat = s.byFeature[0];
  assert.equal(chat.p50Ms, 1000);
  assert.equal(chat.p95Ms, 3000);
  assert.equal(chat.p50TtftMs, 400);
  assert.equal(chat.errors, 1);
  assert.equal(chat.calls, 4);
});

test("por día: solo los días con llamadas, en orden, y `since` es el primero", () => {
  const d1 = new Date(2026, 10, 8, 10).toISOString();
  const d2 = new Date(2026, 10, 10, 10).toISOString();
  const s = summarizeCalls([entry({ ts: d2 }), entry({ ts: d1 }), entry({ ts: d2 })], 7);
  assert.deepEqual(s.byDay.map((d) => [d.day, d.calls]), [
    ["2026-11-08", 1],
    ["2026-11-10", 2],
  ]);
  assert.equal(s.since, "2026-11-08");
});

test("los modelos de una función van del más usado al menos", () => {
  const s = summarizeCalls([entry({ model: "claude-opus-5-5" }), entry({ model: "claude-sonnet-5-5" }), entry({ model: "claude-sonnet-5-5" })], 7);
  assert.deepEqual(s.byFeature[0].models, ["claude-sonnet-5-5", "claude-opus-5-5"]);
});

// ── La regla que sostiene todo lo anterior ──────────────────────────────

test("nadie llama a query() del SDK por fuera de trackedQuery", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === join("agent", "tracked-query.ts")) continue;
    const text = readFileSync(file, "utf8");
    const importsQuery = /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*"@anthropic-ai\/claude-agent-sdk"/.test(text);
    if (importsQuery) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], "estos archivos importan query() del SDK: usa trackedQuery(feature, …)");
});
