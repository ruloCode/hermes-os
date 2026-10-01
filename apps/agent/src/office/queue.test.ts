import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QUEUE_KEEP_FINISHED, clampMax, nextToStart, pruneFinished, queueCounts, reconcileRunning, validateNewItems, type QueueItem } from "@hermes/shared";

const item = (id: string, status: QueueItem["status"], extra: Partial<QueueItem> = {}): QueueItem => ({
  id,
  title: id,
  prompt: "haz algo",
  project: "general",
  source: "manual",
  status,
  createdAt: `2026-09-30T10:00:${id.padStart(2, "0")}Z`,
  ...extra,
});

describe("cola de la oficina", () => {
  it("arranca en orden de llegada sin pasar del tope", () => {
    const st = { max: 2, items: [item("1", "running"), item("2", "queued"), item("3", "queued")] };
    assert.deepEqual(nextToStart(st).map((i) => i.id), ["2"]);
    assert.deepEqual(nextToStart({ ...st, max: 1 }), []);
    assert.deepEqual(nextToStart({ ...st, max: 3 }).map((i) => i.id), ["2", "3"]);
  });

  it("el tope va de 1 a 3 aunque pidan otra cosa", () => {
    assert.equal(clampMax(0), 1);
    assert.equal(clampMax(9), 3);
    assert.equal(clampMax("2"), 2);
    assert.equal(clampMax("x"), 1);
  });

  it("no entra lo vacío ni un issue de Linear que ya está en la cola", () => {
    const st = { max: 1, items: [item("1", "queued", { linearId: "RUL-1" })] };
    const { ok, rejected } = validateNewItems(st, [
      { title: "", prompt: "x" },
      { title: "Sin prompt", prompt: "" },
      { title: "Repetido", prompt: "", linearId: "RUL-1" },
      { title: "Bien", prompt: "haz esto" },
      { title: "Issue nuevo", prompt: "", linearId: "RUL-2" },
    ]);
    assert.deepEqual(ok.map((o) => o.title), ["Bien", "Issue nuevo"]);
    assert.equal(ok[0].project, "general");
    assert.equal(rejected.length, 3);
  });

  it("en curso solo con un run vivo: si el run terminó o desapareció, lo dice", () => {
    const items = [item("1", "running", { runId: "a" }), item("2", "running", { runId: "b" }), item("3", "running", { runId: "c" }), item("4", "queued")];
    const status: Record<string, "running" | "done" | "error"> = { a: "running", b: "done" };
    const changed = reconcileRunning(items, (id) => status[id], "2026-09-30T11:00:00Z");
    assert.deepEqual(changed.map((i) => [i.id, i.status]), [["2", "done"], ["3", "error"]]);
    assert.match(items[2].error ?? "", /reinició/);
    assert.deepEqual(queueCounts(items), { queued: 1, running: 1, done: 1, error: 1, canceled: 0 });
  });

  it("guarda las vivas y solo las últimas terminadas", () => {
    const old = Array.from({ length: QUEUE_KEEP_FINISHED + 5 }, (_, i) => item(String(i + 10), "done", { finishedAt: `2026-09-30T10:${String(i).padStart(2, "0")}:00Z` }));
    const kept = pruneFinished([item("1", "queued"), ...old]);
    assert.equal(kept.length, QUEUE_KEEP_FINISHED + 1);
    assert.ok(kept.some((i) => i.id === "1"));
    assert.ok(!kept.some((i) => i.id === "10"), "la más vieja se va");
  });
});
