import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AmbientPlanner,
  CHAT_LINES,
  CHAT_PAIR_COOLDOWN,
  CHAT_PERSON_COOLDOWN,
  chatScript,
  reactionLine,
  type AmbientPoi,
  type AmbientPosition,
} from "@hermes/shared";

const slot = (x: number, z: number) => ({ x, z, facing: 0 });
const POIS: AmbientPoi[] = [
  { id: "barra", floor: 1, activity: "coffee", slots: [slot(0, 0), slot(1, 0), slot(2, 0)] },
  { id: "ventana", floor: 0, activity: "window", slots: [slot(0, 0)] },
  { id: "sofa", floor: 1, activity: "sit", slots: [slot(10, 10), slot(11, 10)] },
  { id: "pingpong", floor: 2, activity: "pingpong", slots: [slot(0, 0), slot(1, 0)], together: true },
];

/** Planner con gente ya instalada en lugares concretos (sin pasar por el azar de `place`). */
function staged(seed: number, at: [string, string, number][]) {
  const p = new AmbientPlanner(POIS, seed);
  const pos = new Map<string, AmbientPosition>();
  for (const [id, poi, s] of at) {
    p.add(id, 0, 0);
    const person = p.people.get(id)!;
    const target = POIS.find((x) => x.id === poi)!;
    Object.assign(person, { phase: target.together ? "waiting" : "staying", poi, slot: s, since: 0, until: 1000, floor: target.floor, chatReadyAt: 0 });
    pos.set(id, { x: target.slots[s].x, z: target.slots[s].z, floor: target.floor });
  }
  return { p, pos };
}

/** Revisa cada 0,5 s hasta que arranque una charla (o se acabe el tiempo). */
function untilChat(p: AmbientPlanner, pos: Map<string, AmbientPosition>, from: number, to: number) {
  for (let t = from; t < to; t += 0.5) {
    const c = p.proposeChats(pos, t, () => 8);
    if (c.length) return { chats: c, t };
  }
  return null;
}

describe("charlas: el guion", () => {
  it("las frases fijas no llevan un solo número ni dato", () => {
    for (const [id, text] of Object.entries(CHAT_LINES)) assert.ok(!/\d/.test(text), `${id}: "${text}"`);
  });

  it("una frase con dato solo existe si el dato viene en el contexto, y lo repite tal cual", () => {
    for (let seed = 0; seed < 300; seed++) {
      const bare = chatScript({ place: "walk", floor: 0 }, 2, seed);
      assert.ok(bare.every((t) => t.kind === "fixed"), "sin contexto no hay datos");
      const full = chatScript({ place: "coffee", floor: 1, time: "18:05", tempC: 14.6, working: 3, doneNick: "Lince" }, 2, seed);
      for (const t of full.filter((x) => x.kind === "data")) {
        const nums = t.text.match(/\d+(:\d+)?/g) ?? [];
        for (const n of nums) assert.ok(["18:05", "15", "3"].includes(n), `número inventado "${n}" en "${t.text}"`);
      }
    }
  });

  it("tiene de 2 a 5 turnos, empieza el primero y en un trío hablan los tres", () => {
    for (let seed = 0; seed < 200; seed++) {
      const two = chatScript({ place: "coffee", floor: 1 }, 2, seed);
      assert.ok(two.length >= 2 && two.length <= 5, `${two.length} turnos`);
      assert.equal(two[0].speaker, 0);
      assert.ok(two.every((t) => t.speaker < 2));
      const three = chatScript({ place: "window", floor: 0 }, 3, seed);
      assert.deepEqual(new Set(three.map((t) => t.speaker)), new Set([0, 1, 2]));
    }
  });

  it("las fijas traen su id para la voz pregrabada; las reacciones también", () => {
    for (const t of chatScript({ place: "sit", floor: 1, cat: true }, 2, 4)) if (t.kind === "fixed") assert.equal(CHAT_LINES[t.line!], t.text);
    assert.ok(CHAT_LINES[reactionLine("done", 1).line!]);
    assert.ok(CHAT_LINES[reactionLine("dance", 2).line!]);
  });

  it("es determinista con la semilla", () => {
    assert.deepEqual(chatScript({ place: "coffee", floor: 1, time: "10:00" }, 3, 9), chatScript({ place: "coffee", floor: 1, time: "10:00" }, 3, 9));
  });
});

describe("charlas: el planificador", () => {
  it("dos personas juntas en la barra se ponen a conversar, y el lugar da el tema", () => {
    const { p, pos } = staged(3, [
      ["a", "barra", 0],
      ["b", "barra", 1],
    ]);
    const r = untilChat(p, pos, 0, 30);
    assert.ok(r, "nunca conversaron");
    assert.deepEqual([...r.chats[0].members].sort(), ["a", "b"]);
    assert.equal(r.chats[0].place, "coffee");
    assert.equal(p.chatOf("a")?.id, r.chats[0].id);
  });

  it("nunca entre pisos ni a más de CHAT_RADIUS", () => {
    const { p, pos } = staged(5, [
      ["a", "barra", 0],
      ["b", "ventana", 0], // otro piso, mismas x/z
      ["c", "sofa", 0], // mismo piso, lejos
    ]);
    assert.equal(untilChat(p, pos, 0, 60), null);
  });

  it("quien espera pareja para un juego de a dos no se distrae conversando", () => {
    const { p, pos } = staged(7, [
      ["a", "pingpong", 0],
      ["b", "pingpong", 1],
    ]);
    assert.equal(untilChat(p, pos, 0, 60), null);
  });

  it("conversando nadie se va, y al terminar hay enfriamiento por persona y por pareja", () => {
    const { p, pos } = staged(11, [
      ["a", "barra", 0],
      ["b", "barra", 1],
    ]);
    for (const id of ["a", "b"]) p.people.get(id)!.until = 2; // la estadía se acabaría ya
    const r = untilChat(p, pos, 0, 30)!;
    assert.ok(r);
    p.tick(r.t + 3);
    assert.equal(p.people.get("a")!.phase, "staying", "se fue a mitad de la charla");
    const end = r.chats[0].until;
    p.proposeChats(pos, end + 0.1);
    assert.equal(p.chatOf("a"), null, "la charla no terminó");
    assert.ok(p.people.get("a")!.chatReadyAt >= end + CHAT_PERSON_COOLDOWN - 0.2);
    // Pasado el enfriamiento personal, la misma pareja todavía no repite.
    for (const id of ["a", "b"]) Object.assign(p.people.get(id)!, { phase: "staying", until: 9999 });
    assert.equal(untilChat(p, pos, end + CHAT_PERSON_COOLDOWN + 1, end + CHAT_PAIR_COOLDOWN - 1), null);
  });

  it("como mucho tres por charla, y cada quien en una sola", () => {
    const { p, pos } = staged(13, [
      ["a", "barra", 0],
      ["b", "barra", 1],
      ["c", "barra", 2],
    ]);
    for (let t = 0; t < 40; t += 0.5) {
      p.proposeChats(pos, t, () => 8);
      for (const c of p.chats) assert.ok(c.members.length <= 3);
      const all = p.chats.flatMap((c) => c.members);
      assert.equal(new Set(all).size, all.length);
    }
  });

  it("alguien ocupado (saludando al dueño) no arranca charla", () => {
    const { p, pos } = staged(17, [
      ["a", "barra", 0],
      ["b", "barra", 1],
    ]);
    pos.set("a", { ...pos.get("a")!, busy: true });
    assert.equal(untilChat(p, pos, 0, 40), null);
  });

  it("si el dueño toma el lugar (un minijuego), la charla de ahí termina", () => {
    const { p, pos } = staged(19, [
      ["a", "barra", 0],
      ["b", "barra", 1],
    ]);
    const r = untilChat(p, pos, 0, 30)!;
    p.reserve("barra", r.t + 1);
    assert.equal(p.chats.length, 0);
  });
});
