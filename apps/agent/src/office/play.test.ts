import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACHIEVEMENTS, addPlay, emptyDay, loadDay, newAchievements } from "@hermes/shared";

describe("lo que el dueño hace en la oficina", () => {
  it("cuenta acciones, asientos distintos y pisos sin repetir", () => {
    let d = emptyDay("2026-10-01");
    d = addPlay(d, "sit", "sofa#0");
    d = addPlay(d, "sit", "sofa#0");
    d = addPlay(d, "sit", "sillon#0");
    d = addPlay(d, "floor", 1);
    d = addPlay(d, "floor", 1);
    d = addPlay(d, "floor", 0);
    assert.equal(d.sit, 3);
    assert.deepEqual(d.seats, ["sofa#0", "sillon#0"]);
    assert.deepEqual(d.floors, [0, 1]);
  });

  it("un logro sale solo cuando se cumple y no se repite", () => {
    let d = emptyDay("2026-10-01");
    assert.deepEqual(newAchievements(d), []);
    d = addPlay(d, "coffee");
    assert.deepEqual(newAchievements(d).map((a) => a.id), ["primer-cafe"]);
    d = { ...d, unlocked: ["primer-cafe"] };
    assert.deepEqual(newAchievements(d), []);
    for (const f of [0, 1, 2]) d = addPlay(d, "floor", f);
    assert.deepEqual(newAchievements(d).map((a) => a.id), ["pisos"]);
  });

  it("un día viejo no se arrastra y lo roto se completa", () => {
    assert.equal(loadDay({ day: "2026-09-30", coffee: 9 }, "2026-10-01").coffee, 0);
    const d = loadDay({ day: "2026-10-01", coffee: 2, seats: "no", unlocked: ["primer-cafe"] }, "2026-10-01");
    assert.equal(d.coffee, 2);
    assert.deepEqual(d.seats, []);
    assert.deepEqual(d.unlocked, ["primer-cafe"]);
    assert.equal(loadDay(null, "2026-10-01").coffee, 0);
  });

  it("cada logro tiene id único y se puede ganar", () => {
    assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
    const full = { ...emptyDay("x"), coffee: 3, water: 3, pet: 1, greet: 5, dance: 1, gift: 1, focus: 1, floors: [0, 1, 2], seats: ["a", "b", "c", "d", "e"] };
    assert.equal(newAchievements(full).length, ACHIEVEMENTS.length);
  });
});
