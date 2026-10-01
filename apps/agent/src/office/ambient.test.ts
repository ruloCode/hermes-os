import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AMBIENT_PARTNER_WAIT,
  AmbientPlanner,
  ambientPopulation,
  mulberry32,
  type AmbientOrder,
  type AmbientPoi,
} from "@hermes/shared";

const slot = (x: number, z: number) => ({ x, z, facing: 0 });

const POIS: AmbientPoi[] = [
  { id: "cafe", floor: 1, activity: "coffee", slots: [slot(1, 1)] },
  { id: "agua", floor: 1, activity: "water", slots: [slot(1, 3)] },
  { id: "sofa", floor: 1, activity: "sit", slots: [slot(5, 5), slot(5, 6)] },
  { id: "ventana-1", floor: 0, activity: "window", slots: [slot(2, 0)] },
  { id: "pizarra", floor: 0, activity: "board", slots: [slot(4, 0)] },
  { id: "pingpong", floor: 2, activity: "pingpong", slots: [slot(0, 8), slot(4, 8)], together: true },
  { id: "luces", floor: 2, activity: "lights", slots: [slot(6, 6)] },
  { id: "vista", floor: 2, activity: "view", slots: [slot(8, 0)] },
];

/**
 * Simula `seconds` segundos: cada orden llega a su lugar tras un viaje de 3 a
 * 9 s. Llama a `each` en cada paso.
 */
function simulate(people: number, seconds: number, seed: number, each?: (p: AmbientPlanner, now: number) => void) {
  const planner = new AmbientPlanner(POIS, seed);
  const travel = mulberry32(seed + 1);
  const arrivals = new Map<string, number>();
  const orders: AmbientOrder[] = [];
  for (let i = 0; i < people; i++) {
    planner.add(`p${i}`, 0, 0);
    planner.place(`p${i}`, 0);
  }
  for (let now = 0; now <= seconds; now += 0.5) {
    for (const o of planner.tick(now)) {
      orders.push(o);
      arrivals.set(o.id, now + 3 + travel() * 6);
    }
    for (const [id, at] of arrivals) {
      if (at > now) continue;
      arrivals.delete(id);
      planner.arrived(id, now);
    }
    each?.(planner, now);
  }
  return { planner, orders };
}

describe("ambientPopulation", () => {
  it("9 con la oficina vacía y baja con las sesiones vivas, sin pasar de 6", () => {
    assert.equal(ambientPopulation(0), 9);
    assert.ok(ambientPopulation(4) < ambientPopulation(0));
    assert.equal(ambientPopulation(10), 6);
    assert.equal(ambientPopulation(50), 6);
  });
});

describe("AmbientPlanner", () => {
  it("es determinista: misma semilla, misma coreografía", () => {
    const a = simulate(5, 300, 42).orders.map((o) => `${o.id}>${o.poi.id}:${o.slot}`);
    const b = simulate(5, 300, 42).orders.map((o) => `${o.id}>${o.poi.id}:${o.slot}`);
    const c = simulate(5, 300, 43).orders.map((o) => `${o.id}>${o.poi.id}:${o.slot}`);
    assert.ok(a.length > 20, "en 5 minutos hay movimiento");
    assert.deepEqual(a, b);
    assert.notDeepEqual(a, c);
  });

  it("nunca hay más gente que puestos en un lugar (el sofá admite dos)", () => {
    simulate(6, 1800, 7, (planner) => {
      for (const poi of POIS) {
        const occ = planner.occupants(poi.id);
        assert.ok(occ.length <= poi.slots.length, `${poi.id} con ${occ.length}`);
        assert.equal(new Set(occ.map((o) => o.slot)).size, occ.length, `${poi.id}: dos en el mismo puesto`);
      }
    });
  });

  it("los juegos de a dos solo arrancan con los dos presentes", () => {
    let played = false;
    simulate(6, 1800, 11, (planner) => {
      const occ = planner.occupants("pingpong");
      if (occ.some((o) => o.phase === "staying")) {
        played = true;
        assert.equal(occ.length, 2);
        assert.ok(occ.every((o) => o.phase === "staying"), "uno juega y el otro no ha llegado");
      }
    });
    assert.ok(played, "en media hora alguien jugó ping-pong");
  });

  it("quien espera pareja se rinde si no llega", () => {
    // Solo hay café, ping-pong y una vista; p1 nunca llega a ninguna parte.
    const pois = POIS.filter((p) => ["cafe", "pingpong", "vista"].includes(p.id));
    for (const seed of [2, 3, 4]) {
      const planner = new AmbientPlanner(pois, seed);
      planner.add("p0", 0, 0);
      planner.add("p1", 0, 0);
      let arrive = -1;
      let waitedFrom = -1;
      let waits = 0;
      for (let now = 0; now < 900; now += 0.5) {
        for (const o of planner.tick(now)) if (o.id === "p0") arrive = now + 4;
        if (arrive >= 0 && arrive <= now) {
          planner.arrived("p0", now);
          arrive = -1;
        }
        const p0 = planner.people.get("p0")!;
        assert.ok(!(p0.poi === "pingpong" && p0.phase === "staying"), "jugó solo");
        if (p0.phase === "waiting" && waitedFrom < 0) {
          waitedFrom = now;
          waits++;
        }
        if (waitedFrom >= 0 && p0.phase !== "waiting") {
          assert.ok(now - waitedFrom <= AMBIENT_PARTNER_WAIT + 0.5, `esperó ${now - waitedFrom} s`);
          waitedFrom = -1;
        }
      }
      assert.ok(waits >= 1, `semilla ${seed}: nadie llegó a esperar pareja`);
      assert.equal(waitedFrom, -1, "sigue esperando para siempre");
    }
  });

  it("varía: nadie repite el mismo lugar seguido y todos pasan por más de un piso", () => {
    const floors = new Map<string, Set<number>>();
    const { orders } = simulate(5, 1800, 5);
    const last = new Map<string, string>();
    for (const o of orders) {
      assert.notEqual(last.get(o.id), o.poi.id, `${o.id} repite ${o.poi.id}`);
      last.set(o.id, o.poi.id);
      const s = floors.get(o.id) ?? new Set();
      s.add(o.poi.floor);
      floors.set(o.id, s);
    }
    for (const [id, s] of floors) assert.ok(s.size >= 2, `${id} solo visitó el piso ${[...s]}`);
  });

  it("al arrancar reparte a la gente en varios pisos y nunca en un juego de a dos", () => {
    const planner = new AmbientPlanner(POIS, 9);
    const placed = Array.from({ length: 6 }, (_, i) => {
      planner.add(`p${i}`, 0, 0);
      return planner.place(`p${i}`, 0);
    });
    assert.ok(placed.every(Boolean));
    assert.ok(new Set(placed.map((o) => o!.poi.floor)).size >= 2);
    assert.ok(placed.every((o) => !o!.poi.together));
  });

  it("un lugar sin camino se evita un rato", () => {
    const planner = new AmbientPlanner(POIS, 1);
    planner.add("p0", 0, 0);
    const [first] = planner.tick(0);
    planner.failed("p0", 1);
    for (let t = 2; t < 30; t += 1) for (const o of planner.tick(t)) assert.notEqual(o.poi.id, first.poi.id);
  });

  it("el dueño reserva un juego: quien estaba se aparta y nadie vuelve hasta liberarlo", () => {
    const planner = new AmbientPlanner([{ id: "dardos", floor: 2, activity: "darts", slots: [slot(1, 1)] }, ...POIS.filter((p) => !p.together)], 5);
    planner.add("a", 2, 0);
    const placed = planner.place("a", 0);
    // Se fuerza a "a" a estar en los dardos (place elige al azar).
    const a = planner.people.get("a")!;
    Object.assign(a, { phase: "staying", poi: "dardos", slot: 0, until: 999 });
    assert.ok(placed);
    assert.deepEqual(planner.reserve("dardos", 1), ["a"]);
    assert.equal(a.phase, "idle");
    for (let now = 1; now < 400; now += 1) {
      for (const o of planner.tick(now)) {
        assert.notEqual(o.poi.id, "dardos", "nadie elige el lugar reservado");
        planner.arrived(o.id, now + 0.5);
      }
    }
    assert.deepEqual(planner.reserve(null, 400), []);
    assert.deepEqual(planner.reserve("no-existe", 400), []);
  });
});

