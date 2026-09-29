import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DESK_SIZE,
  POD_MAX_DESKS,
  assignSeats,
  buildOfficeLayout,
  deskToWorld,
  podDeskCount,
  type OfficeDesk,
} from "@hermes/shared";

const PROJECTS = Array.from({ length: 12 }, (_, i) => ({ slug: `p${i}`, name: `Proyecto ${i}` }));

/** Huella de un escritorio con su silla (la silla sale 0,9 m por su lado). */
function footprint(d: OfficeDesk) {
  const corners = [
    deskToWorld(d, { x: -DESK_SIZE.width / 2, z: -DESK_SIZE.depth / 2 }),
    deskToWorld(d, { x: DESK_SIZE.width / 2, z: 1.3 }),
  ];
  return {
    minX: Math.min(corners[0].x, corners[1].x) + 1e-6,
    maxX: Math.max(corners[0].x, corners[1].x) - 1e-6,
    minZ: Math.min(corners[0].z, corners[1].z) + 1e-6,
    maxZ: Math.max(corners[0].z, corners[1].z) - 1e-6,
  };
}

function overlaps(a: ReturnType<typeof footprint>, b: ReturnType<typeof footprint>) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
}

describe("buildOfficeLayout", () => {
  it("un pod por proyecto, con el general primero y sin repetir", () => {
    const l = buildOfficeLayout([{ slug: "general", name: "x" }, ...PROJECTS, { slug: "p1", name: "dup" }]);
    assert.equal(l.pods.length, 13);
    assert.equal(l.pods[0].project, "general");
    assert.deepEqual(new Set(l.pods.map((p) => p.project)).size, 13);
  });

  it("ningún escritorio (con su silla) se encima con otro, aun con todos los pods llenos", () => {
    const full = Object.fromEntries(PROJECTS.map((p) => [p.slug, 99]));
    const l = buildOfficeLayout(PROJECTS, { ...full, general: 99 });
    assert.equal(l.desks.length, 13 * POD_MAX_DESKS);
    const f = l.desks.map(footprint);
    for (let i = 0; i < f.length; i++)
      for (let j = i + 1; j < f.length; j++) assert.ok(!overlaps(f[i], f[j]), `${l.desks[i].id} ↔ ${l.desks[j].id}`);
  });

  it("es determinista y los ids son estables", () => {
    assert.deepEqual(buildOfficeLayout(PROJECTS, { p3: 2 }), buildOfficeLayout(PROJECTS, { p3: 2 }));
    assert.equal(buildOfficeLayout(PROJECTS).pods[1].desks[0].id, "desk:p0:0");
  });

  it("agregar un proyecto al final no mueve a los anteriores", () => {
    const a = buildOfficeLayout(PROJECTS);
    const b = buildOfficeLayout([...PROJECTS, { slug: "nuevo", name: "Nuevo" }]);
    for (const d of a.desks) {
      const same = b.desks.find((x) => x.id === d.id);
      assert.deepEqual(same, d);
    }
  });

  it("un pod crece de dos en dos sin mover sus escritorios anteriores", () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(podDeskCount), [2, 2, 4, 4, 4, 4, 4]);
    const small = buildOfficeLayout(PROJECTS, { p0: 1 });
    const big = buildOfficeLayout(PROJECTS, { p0: 3 });
    const pod = (l: typeof small) => l.pods.find((p) => p.project === "p0")!.desks;
    assert.equal(pod(small).length, 2);
    assert.equal(pod(big).length, 4);
    assert.deepEqual(pod(big).slice(0, 2), pod(small));
  });

  it("el piso contiene todos los escritorios", () => {
    const l = buildOfficeLayout(PROJECTS);
    for (const d of l.desks) {
      assert.ok(d.x > l.floor.minX && d.x < l.floor.maxX, d.id);
      assert.ok(d.z > l.floor.minZ && d.z < l.floor.maxZ, d.id);
    }
  });
});

describe("assignSeats", () => {
  const layout = buildOfficeLayout(PROJECTS, { p0: 3 });

  it("cada uno a su pod, en orden, nunca dos en el mismo escritorio", () => {
    const { seats, unseated } = assignSeats(
      [
        { id: "a", project: "p0" },
        { id: "b", project: "p0" },
        { id: "c", project: "p1" },
      ],
      layout.desks,
    );
    assert.equal(seats.get("a"), "desk:p0:0");
    assert.equal(seats.get("b"), "desk:p0:1");
    assert.equal(seats.get("c"), "desk:p1:0");
    assert.deepEqual(unseated, []);
    assert.equal(new Set(seats.values()).size, seats.size);
  });

  it("es pegajoso: quien ya tenía escritorio se queda aunque llegue después", () => {
    const prev = new Map([["b", "desk:p0:0"]]);
    const { seats } = assignSeats(
      [
        { id: "a", project: "p0" },
        { id: "b", project: "p0" },
      ],
      layout.desks,
      prev,
    );
    assert.equal(seats.get("b"), "desk:p0:0");
    assert.equal(seats.get("a"), "desk:p0:1");
  });

  it("quien continúa una conversación hereda el escritorio del anterior", () => {
    const prev = new Map([["r1", "desk:p0:1"]]);
    const { seats } = assignSeats([{ id: "r2", project: "p0", continues: "r1" }], layout.desks, prev);
    assert.equal(seats.get("r2"), "desk:p0:1");
  });

  it("proyecto sin pod → general; pod lleno → general y luego cualquiera", () => {
    const { seats } = assignSeats([{ id: "x", project: "desconocido" }], layout.desks);
    assert.equal(seats.get("x"), "desk:general:0");
    // p0 lleno (4) + general (2) = 6 escritorios para 7 personajes.
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `w${i}`, project: "p0" }));
    const r = assignSeats(many, buildOfficeLayout([{ slug: "p0", name: "P0" }], { p0: 7 }).desks);
    assert.equal(r.seats.size, 6);
    assert.deepEqual(r.unseated, ["w6"]);
    assert.ok([...r.seats.values()].some((d) => d.startsWith("desk:general:")));
  });
});
