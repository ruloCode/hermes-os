import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fileFocusStore,
  ingestSessions,
  ingestUsage,
  mergeSessions,
  mondayOf,
  pendingCheckins,
  summarize,
  summaryLine,
  validateSessions,
  validateUsage,
  type FocusSessionRecord,
} from "./store.js";

/**
 * Contrato del foco en el agente: lo que sube el teléfono es idempotente por
 * id, el hábito se marca UNA vez con la fecha de la sesión (no la de subida),
 * nada se deshace, QA nunca toca hábitos reales y lo malformado se rechaza.
 */

const raw = (o: Record<string, unknown> = {}) => ({
  id: "s1",
  purpose: "Capítulo 3",
  planned_min: 25,
  focused_min: 25,
  counted_min: 25,
  started_at: "2026-10-13T14:00:00Z",
  ended_at: "2026-10-13T14:25:00Z",
  date: "2026-10-13",
  status: "completed",
  habit_id: 7,
  habit_name: "Leer",
  earns_habit: true,
  plants: true,
  source: "tap",
  rule_hits: [{ rule_id: "r1", rule_name: "Redes en foco", at: "2026-10-13T14:10:00Z", choice: "volver" }],
  ...o,
});

const tempStore = async () => fileFocusStore(await mkdtemp(join(tmpdir(), "focus-")));

describe("foco · validación", () => {
  it("acepta una sesión bien formada y rechaza la que no", () => {
    const { items, rejected } = validateSessions([raw(), { id: "x" }, raw({ status: "muerta" }), raw({ date: "13/10/2026" })]);
    assert.equal(items.length, 1);
    assert.equal(rejected.length, 3);
    assert.equal(items[0].rule_hits[0].rule_id, "r1", "la regla que disparó la hoja viaja con la sesión");
  });

  it("el uso es minutos por paquete y nada más", () => {
    const d = validateUsage("2026-10-13", { complete: true, apps: [{ package: "com.instagram.android", label: "Instagram", minutes: 34 }, { package: "x" }, { titulo: "lo que miré" }] });
    assert.deepEqual(d, { date: "2026-10-13", complete: true, apps: [{ package: "com.instagram.android", label: "Instagram", minutes: 34 }] });
    assert.equal(validateUsage("ayer", {}), null);
  });
});

describe("foco · idempotencia", () => {
  it("reenviar la misma sesión no duplica; un cambio (decidir contar) la actualiza", () => {
    const [a] = validateSessions([raw({ status: "ended_early", counted: null, counted_min: 0, earns_habit: false, plants: false })]).items;
    const first = mergeSessions([], [a], "t1");
    assert.deepEqual(first.results, [{ id: "s1", status: "saved" }]);
    assert.deepEqual(mergeSessions(first.next, [a], "t2").results, [{ id: "s1", status: "unchanged" }]);
    const [b] = validateSessions([raw({ status: "ended_early", counted: true, counted_min: 14 })]).items;
    const upd = mergeSessions(first.next, [b], "t3");
    assert.deepEqual(upd.results, [{ id: "s1", status: "updated" }]);
    assert.equal(upd.next.length, 1);
    assert.equal(upd.next[0].received_at, "t1", "conserva cuándo llegó primero");
  });
});

describe("foco · check-in del hábito", () => {
  it("marca UNA vez, con la fecha de la sesión", async () => {
    const store = await tempStore();
    const calls: [number, string][] = [];
    const checkin = async (id: number, date: string) => (calls.push([id, date]), true);
    const { items } = validateSessions([raw()]);
    const r1 = await ingestSessions(store, items, checkin);
    assert.deepEqual(r1.checked.map((c) => c.date), ["2026-10-13"]);
    assert.equal(r1.results[0].habit_checked, true, "el teléfono se entera de que quedó marcado");
    await ingestSessions(store, items, checkin);
    await ingestSessions(store, validateSessions([raw({ purpose: "otro texto" })]).items, checkin);
    assert.deepEqual(calls, [[7, "2026-10-13"]], "reintentos y ediciones no vuelven a marcar");
  });

  it("si el check-in falla, se reintenta en la próxima subida", async () => {
    const store = await tempStore();
    let ok = false;
    const checkin = async () => ok;
    const { items } = validateSessions([raw()]);
    const failed = await ingestSessions(store, items, checkin);
    assert.equal(failed.checked.length, 0);
    assert.equal(failed.results[0].habit_checked, false, "sin marcar, el teléfono no dice ✓ y reintenta");
    ok = true;
    assert.equal((await ingestSessions(store, items, checkin)).checked.length, 1);
  });

  it("QA nunca toca los hábitos reales y sin ganar no se marca", () => {
    const base = mergeSessions([], validateSessions([raw({ id: "q", source: "qa" }), raw({ id: "n", earns_habit: false }), raw({ id: "y" })]).items).next;
    assert.deepEqual(pendingCheckins(base).map((s) => s.id), ["y"]);
  });
});

describe("foco · uso por día", () => {
  it("un día completo no lo pisa uno incompleto", async () => {
    const store = await tempStore();
    await ingestUsage(store, { date: "2026-10-13", complete: true, apps: [{ package: "ig", label: null, minutes: 40 }] });
    assert.equal((await ingestUsage(store, { date: "2026-10-13", complete: false, apps: [] })).status, "kept");
    assert.equal((await store.load()).usage["2026-10-13"].apps[0].minutes, 40);
  });
});

describe("foco · resumen", () => {
  const rec = (o: Partial<FocusSessionRecord>): FocusSessionRecord => ({
    ...(validateSessions([raw()]).items[0]),
    habit_checked: true,
    received_at: "t",
    ...o,
  });

  it("la semana va de lunes a domingo", () => {
    assert.equal(mondayOf("2026-10-14"), "2026-10-12");
    assert.equal(mondayOf("2026-10-12"), "2026-10-12");
    assert.equal(mondayOf("2026-10-18"), "2026-10-12");
  });

  it("suma solo lo que cuenta y no inventa días de hábito", () => {
    const sessions = [
      rec({ id: "a", date: "2026-10-12", counted_min: 25 }),
      rec({ id: "b", date: "2026-10-14", counted_min: 0, status: "ended_early", plants: false, rule_hits: [] }),
      rec({ id: "c", date: "2026-10-05", counted_min: 45 }),
    ];
    const s = summarize({ sessions, usage: {} }, "2026-10-14", null);
    assert.deepEqual(s.week.by_day, [25, 0, 0, 0, 0, 0, 0]);
    assert.equal(s.week.sessions, 1);
    assert.equal(s.total.focus_min, 70);
    assert.equal(s.total.plants, 2);
    assert.equal(s.habit_days, null);
    assert.deepEqual(s.rules_hit, [{ rule_id: "r1", rule_name: "Redes en foco", times: 1, back: 1 }]);
    assert.doesNotMatch(summaryLine(s), /perdid|desperdici|solo |apenas/i, "sin culpa");
  });
});
