import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OFFICE_NICKNAMES, assignNicknames } from "@hermes/shared";

describe("assignNicknames", () => {
  it("mismo id, mismo apodo; nunca dos vivos con el mismo", () => {
    const ws = Array.from({ length: 12 }, (_, i) => ({ id: `run-${i}` }));
    const a = assignNicknames(ws);
    const b = assignNicknames(ws);
    assert.deepEqual([...a], [...b]);
    assert.equal(new Set(a.values()).size, ws.length);
  });

  it("pegajoso: quien ya tenía apodo lo conserva aunque lleguen otros", () => {
    const first = assignNicknames([{ id: "a" }]);
    const next = assignNicknames([{ id: "z" }, { id: "a" }], first);
    assert.equal(next.get("a"), first.get("a"));
  });

  it("la sesión que continúa otra hereda su apodo", () => {
    const first = assignNicknames([{ id: "run-1" }]);
    const next = assignNicknames([{ id: "run-2", continues: "run-1" }], first);
    assert.equal(next.get("run-2"), first.get("run-1"));
  });

  it("si se acaba la lista, numera en vez de repetir", () => {
    const ws = Array.from({ length: OFFICE_NICKNAMES.length + 3 }, (_, i) => ({ id: `w${i}` }));
    const names = [...assignNicknames(ws).values()];
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.some((n) => / \d+$/.test(n)));
  });
});
