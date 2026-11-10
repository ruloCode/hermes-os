// Contratos de las rutas /usage/* (specs/gasto: «Resumen de gasto por función»).
// Se monta la ruta real sobre un Hono vacío y el registro vive en una carpeta
// temporal: jamás toca ~/.hermes-os/usage.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";
import { Hono } from "hono";
import { lastDays, localDay, type CallEntry, type UsageSummary } from "@hermes/shared";
import { TIER_MODELS } from "../agent/models.js";
import {
  USAGE_CALLS_MAX,
  USAGE_DAYS_MAX,
  describeModels,
  latestCalls,
  mountUsageRoutes,
  parseDay,
  parseDays,
  parseLimit,
  tiersView,
} from "../usage-routes.js";

const app = new Hono();
mountUsageRoutes(app);

const TODAY = localDay(new Date());
const SONNET = TIER_MODELS.balanced.id;
const HAIKU = TIER_MODELS.fast.id;

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hermes-usage-routes-"));
  process.env.HERMES_USAGE_DIR = dir;
});

/** Mediodía local de un día AAAA-MM-DD (+ minutos), en ISO: cae en ese día en cualquier zona. */
function at(day: string, minutes = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, 12, minutes).toISOString();
}

function entry(over: Partial<CallEntry> = {}): CallEntry {
  return {
    ts: at(TODAY),
    feature: "chat",
    model: SONNET,
    models: [SONNET],
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

function seed(day: string, entries: CallEntry[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `calls-${day}.jsonl`), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

async function get<T = Record<string, unknown>>(path: string): Promise<T> {
  const res = await app.request(path);
  assert.equal(res.status, 200, "las rutas de gasto responden 200 y dicen el motivo en el cuerpo");
  return (await res.json()) as T;
}

// ── Validación de parámetros ────────────────────────────────────────────

test("days: ausente es 7; de 1 a 90 pasa; lo demás es un error dicho, no un recorte", () => {
  assert.deepEqual(parseDays(undefined), { ok: true, value: 7 });
  assert.deepEqual(parseDays(""), { ok: true, value: 7 });
  assert.deepEqual(parseDays("1"), { ok: true, value: 1 });
  assert.deepEqual(parseDays(String(USAGE_DAYS_MAX)), { ok: true, value: USAGE_DAYS_MAX });
  for (const bad of ["0", "91", "400", "-3", "7.5", "siete", "7d", "1e1", " "]) {
    const r = parseDays(bad);
    assert.equal(r.ok, false, `«${bad}» no es un periodo válido`);
    if (!r.ok) assert.match(r.error, /days/);
  }
});

test("day: ausente es hoy; exige AAAA-MM-DD de una fecha que exista", () => {
  assert.deepEqual(parseDay(undefined, "2026-11-10"), { ok: true, value: "2026-11-10" });
  assert.deepEqual(parseDay("2026-02-28"), { ok: true, value: "2026-02-28" });
  assert.deepEqual(parseDay("2028-02-29"), { ok: true, value: "2028-02-29" }, "bisiesto");
  for (const bad of ["2026-02-30", "2026-13-01", "2026-00-10", "10-11-2026", "2026/11/10", "hoy", "2026-11-10T00:00", "../../etc/passwd", "2026-1-5"]) {
    const r = parseDay(bad);
    assert.equal(r.ok, false, `«${bad}» no es un día válido`);
    if (!r.ok) assert.match(r.error, /day/);
  }
});

test("limit: ausente es 200; de 1 al tope pasa; fuera de rango es error", () => {
  assert.deepEqual(parseLimit(undefined), { ok: true, value: 200 });
  assert.deepEqual(parseLimit(String(USAGE_CALLS_MAX)), { ok: true, value: USAGE_CALLS_MAX });
  for (const bad of ["0", String(USAGE_CALLS_MAX + 1), "todas", "-1", "2.5"]) assert.equal(parseLimit(bad).ok, false, bad);
});

test("un parámetro inválido responde ok:false con el motivo, sin leer el disco", async () => {
  for (const path of ["/usage/summary?days=0", "/usage/summary?days=abc", "/usage/summary?days=91"]) {
    const body = await get<{ ok: boolean; error?: string; summary?: unknown }>(path);
    assert.equal(body.ok, false, path);
    assert.match(body.error ?? "", /days/);
    assert.equal(body.summary, undefined);
  }
  for (const path of ["/usage/calls?day=2026-02-30", "/usage/calls?day=ayer", "/usage/calls?limit=0", `/usage/calls?limit=${USAGE_CALLS_MAX + 1}`]) {
    const body = await get<{ ok: boolean; error?: string; calls?: unknown }>(path);
    assert.equal(body.ok, false, path);
    assert.ok(body.error);
    assert.equal(body.calls, undefined);
  }
});

// ── Scenario: Semana con datos ──────────────────────────────────────────

test("semana con datos: las funciones salen por costo y cada una dice cuánto de su entrada vino de caché", async () => {
  const [d2, d1] = lastDays(TODAY, 3); // anteayer, ayer
  seed(d2, [entry({ ts: at(d2), feature: "copilot.fast", model: HAIKU, models: [HAIKU], costUsd: 0.002, input: 200, cacheRead: 0, cacheWrite: 800 })]);
  seed(d1, [
    entry({ ts: at(d1), feature: "meetings.ingest", costUsd: 0.4, input: 5000, cacheRead: 5000, cacheWrite: 0 }),
    entry({ ts: at(d1, 5), feature: "chat", costUsd: 0.05 }),
  ]);
  seed(TODAY, [entry({ feature: "chat", costUsd: 0.03 })]);

  const body = await get<{ ok: boolean; summary: UsageSummary; since: string | null; models: Record<string, { tier: string | null; label: string | null }> }>("/usage/summary?days=7");
  assert.equal(body.ok, true);
  assert.equal(body.summary.days, 7);
  assert.deepEqual(
    body.summary.byFeature.map((f) => f.feature),
    ["meetings.ingest", "chat", "copilot.fast"],
    "la más cara primero",
  );
  const [ingest, chat, fast] = body.summary.byFeature;
  assert.equal(ingest.cacheRatio, 0.5);
  assert.equal(chat.cacheRatio, 0.9);
  assert.equal(fast.cacheRatio, 0, "todo escrito, nada leído: 0 real, no «sin dato»");
  assert.equal(chat.calls, 2);
  assert.deepEqual(chat.models, [SONNET]);
  assert.equal(body.since, d2, "primer día con registro en disco");
  assert.deepEqual(body.summary.byDay.map((d) => d.day), [d2, d1, TODAY]);
  // El panel no conoce el catálogo: cada modelo del resumen llega con su nivel y su nombre.
  assert.deepEqual(body.models[SONNET], { tier: "balanced", label: TIER_MODELS.balanced.label });
  assert.deepEqual(body.models[HAIKU], { tier: "fast", label: TIER_MODELS.fast.label });
});

test("since mira el disco, no la ventana: un registro viejo se anuncia aunque el periodo salga vacío", async () => {
  const old = lastDays(TODAY, 40)[0];
  seed(old, [entry({ ts: at(old) })]);
  const body = await get<{ ok: boolean; summary: UsageSummary; since: string | null }>("/usage/summary?days=7");
  assert.equal(body.ok, true);
  assert.equal(body.summary.total.calls, 0);
  assert.equal(body.summary.since, null, "dentro de la ventana no hay nada");
  assert.equal(body.since, old, "pero se mide desde antes");
});

// ── Scenario: Sin registro ──────────────────────────────────────────────

test("sin registro: responde vacío con since null y sin ceros que parezcan datos", async () => {
  const body = await get<{ ok: boolean; summary: UsageSummary; since: string | null; models: Record<string, unknown> }>("/usage/summary");
  assert.equal(body.ok, true);
  assert.equal(body.since, null);
  assert.equal(body.summary.days, 7, "sin ?days= el periodo es de 7 días");
  assert.deepEqual(body.summary.byFeature, []);
  assert.deepEqual(body.summary.byModel, []);
  assert.deepEqual(body.summary.byDay, []);
  assert.equal(body.summary.total.calls, 0);
  assert.equal(body.summary.total.costUsd, null, "sin llamadas no hay costo: null, no 0");
  assert.equal(body.summary.total.cacheRatio, null);
  assert.equal(body.summary.total.p95Ms, null);
  assert.deepEqual(body.models, {});
});

// ── Llamadas de un día ──────────────────────────────────────────────────

test("calls: las del día pedido, la más reciente primero, con tope y total real", async () => {
  seed(TODAY, [entry({ ts: at(TODAY, 1), ref: "a" }), entry({ ts: at(TODAY, 30), ref: "c" }), entry({ ts: at(TODAY, 10), ref: "b" })]);
  const yesterday = lastDays(TODAY, 2)[0];
  seed(yesterday, [entry({ ts: at(yesterday), ref: "ayer" })]);

  const all = await get<{ ok: boolean; day: string; calls: CallEntry[]; total: number; truncated: boolean }>("/usage/calls");
  assert.equal(all.ok, true);
  assert.equal(all.day, TODAY, "sin ?day= es hoy");
  assert.deepEqual(all.calls.map((c) => c.ref), ["c", "b", "a"]);
  assert.equal(all.truncated, false);

  const two = await get<{ calls: CallEntry[]; total: number; truncated: boolean }>("/usage/calls?limit=2");
  assert.deepEqual(two.calls.map((c) => c.ref), ["c", "b"], "el tope deja las más recientes");
  assert.equal(two.total, 3, "el total es el del día, no el de la página");
  assert.equal(two.truncated, true);

  const prev = await get<{ day: string; calls: CallEntry[] }>(`/usage/calls?day=${yesterday}`);
  assert.equal(prev.day, yesterday);
  assert.deepEqual(prev.calls.map((c) => c.ref), ["ayer"]);
});

test("calls: un día sin archivo responde vacío, no un error", async () => {
  const body = await get<{ ok: boolean; calls: CallEntry[]; total: number }>("/usage/calls?day=2020-01-01");
  assert.equal(body.ok, true);
  assert.deepEqual(body.calls, []);
  assert.equal(body.total, 0);
});

test("latestCalls no reordena el arreglo que recibe", () => {
  const input = [entry({ ts: at(TODAY, 1) }), entry({ ts: at(TODAY, 9) })];
  const before = input.map((e) => e.ts);
  latestCalls(input, 1);
  assert.deepEqual(input.map((e) => e.ts), before);
});

// ── Catálogo ────────────────────────────────────────────────────────────

test("models: cada función con etiqueta, nivel, modelo y origen; cada nivel con su precio de lista", async () => {
  const body = await get<{
    ok: boolean;
    features: { feature: string; label: string; tier: string; model: string; source: string }[];
    tiers: { tier: string; id: string; label: string; inputUsd: number; outputUsd: number; active: string; source: string }[];
  }>("/usage/models");
  assert.equal(body.ok, true);
  const chat = body.features.find((f) => f.feature === "chat");
  assert.ok(chat, "el chat está en el catálogo");
  assert.ok(chat.label && chat.model && chat.tier);
  assert.ok(["catalog", "env"].includes(chat.source));
  assert.ok(body.features.every((f) => f.label && f.model), "ninguna función sin etiqueta o sin modelo");
  assert.deepEqual(body.tiers.map((t) => t.tier), ["fast", "balanced", "deep", "frontier"]);
  for (const t of body.tiers) {
    assert.ok(t.inputUsd > 0 && t.outputUsd > t.inputUsd, `precio de lista de ${t.tier}`);
    assert.ok(t.active);
  }
});

test("tiersView dice cuándo un nivel está cambiado por variable (el precio de lista deja de describirlo)", () => {
  const plain = tiersView({});
  assert.ok(plain.every((t) => t.source === "catalog" && t.active === t.id));
  const swapped = tiersView({ HERMES_MODEL_TIER_FAST: "otro-modelo" });
  const fast = swapped.find((t) => t.tier === "fast");
  assert.equal(fast?.active, "otro-modelo");
  assert.equal(fast?.source, "env");
  assert.equal(swapped.find((t) => t.tier === "deep")?.source, "catalog");
});

test("describeModels: nombre solo para el modelo de lista; un modelo anterior conserva el nivel sin heredar el nombre", () => {
  const info = describeModels([SONNET, "claude-opus-4-8", "modelo-raro"]);
  assert.deepEqual(info[SONNET], { tier: "balanced", label: TIER_MODELS.balanced.label });
  assert.deepEqual(info["claude-opus-4-8"], { tier: "deep", label: null });
  assert.deepEqual(info["modelo-raro"], { tier: null, label: null });
});
