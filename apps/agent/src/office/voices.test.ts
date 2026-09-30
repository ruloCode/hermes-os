import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assignOfficeVoices,
  describeOfficeTeam,
  parseSalaConfig,
  resolveOfficeTarget,
  type OfficeVoice,
  type OfficeWorker,
} from "@hermes/shared";

function worker(id: string, extra: Partial<OfficeWorker> = {}): OfficeWorker {
  return {
    id,
    source: "run",
    project: "hermes-os",
    name: `Agente ${id}`,
    status: "working",
    task: { name: `Tarea de ${id}`, summary: "" },
    startedAt: "2026-09-30T15:00:00.000Z",
    lastEventAt: "2026-09-30T15:00:00.000Z",
    toolCalls: 0,
    failStreak: 0,
    machine: "mac",
    lines: [],
    ...extra,
  };
}

const LABELS = ["Ivan", "Nevada", "Show"];
const POOL: OfficeVoice[] = [
  { key: "paisa", name: "Iván", label: "Ivan" },
  { key: "nevada", name: "Nevada", label: "Nevada" },
  { key: "show", name: "Show", label: "Show" },
];
const names = (slug: string) => ({ "hermes-os": "Hermes OS", "video-edit": "Video Edit" })[slug] ?? slug;

describe("assignOfficeVoices", () => {
  it("reparte en orden de llegada y es pegajoso", () => {
    const a = assignOfficeVoices(new Map(), [worker("a"), worker("b")], LABELS);
    assert.deepEqual([...a], [["a", "Ivan"], ["b", "Nevada"]]);
    // Llega uno nuevo ANTES en la lista: los que ya tenían voz no la pierden.
    const b = assignOfficeVoices(a, [worker("c"), worker("a"), worker("b")], LABELS);
    assert.equal(b.get("a"), "Ivan");
    assert.equal(b.get("b"), "Nevada");
    assert.equal(b.get("c"), "Show");
  });

  it("sin voces libres el personaje queda sin voz, y la que se libera se reusa", () => {
    const full = assignOfficeVoices(new Map(), [worker("a"), worker("b"), worker("c"), worker("d")], LABELS);
    assert.equal(full.has("d"), false);
    const after = assignOfficeVoices(full, [worker("b"), worker("c"), worker("d")], LABELS);
    assert.equal(after.get("d"), "Ivan");
    assert.equal(after.has("a"), false);
  });

  it("una sesión continuada hereda la voz de la que continúa", () => {
    const first = assignOfficeVoices(new Map(), [worker("a"), worker("b")], LABELS);
    // Mientras conviven un instante, la voz pasa al run nuevo.
    const both = assignOfficeVoices(first, [worker("a", { status: "done" }), worker("b"), worker("a2", { continues: "a" })], LABELS);
    assert.equal(both.get("a2"), "Ivan");
    assert.equal(both.has("a"), false);
    // Y cuando el viejo ya se fue, también.
    const gone = assignOfficeVoices(first, [worker("b"), worker("a2", { continues: "a" })], LABELS);
    assert.equal(gone.get("a2"), "Ivan");
  });

  it("ignora etiquetas que ya no están en el elenco", () => {
    const out = assignOfficeVoices(new Map([["a", "Care"]]), [worker("a")], LABELS);
    assert.equal(out.get("a"), "Ivan");
  });
});

describe("resolveOfficeTarget", () => {
  const ws = [worker("a"), worker("b", { project: "video-edit", task: { name: "Corre los tests", summary: "" } })];
  const voices = new Map([
    ["a", "Ivan"],
    ["b", "Nevada"],
  ]);

  it("por el nombre de la voz, con o sin tilde", () => {
    for (const who of ["Iván", "ivan", "IVAN"]) {
      const r = resolveOfficeTarget(who, ws, voices, POOL, names);
      assert.ok("worker" in r && r.worker.id === "a", who);
    }
  });

  it("por el proyecto o la tarea", () => {
    const r = resolveOfficeTarget("video edit", ws, voices, POOL, names);
    assert.ok("worker" in r && r.worker.id === "b");
    const t = resolveOfficeTarget("tests", ws, voices, POOL, names);
    assert.ok("worker" in t && t.worker.id === "b");
  });

  it("una voz sin agente asignado lo dice en vez de elegir a otro", () => {
    const r = resolveOfficeTarget("Show", ws, voices, POOL, names);
    assert.ok("error" in r && /no tiene un agente/.test(r.error));
  });

  it("ambiguo devuelve las opciones para repreguntar", () => {
    const r = resolveOfficeTarget("hermes", [worker("a"), worker("c")], voices, POOL, names);
    assert.ok("error" in r && r.options.length === 2);
  });
});

describe("describeOfficeTeam", () => {
  it("solo datos reales: voz, proyecto, estado, tarea y lo que hace", () => {
    const text = describeOfficeTeam(
      [worker("a", { tool: { name: "Edit", target: "src/x.ts" } }), worker("b", { status: "done", lastText: "Todo pasa." })],
      new Map([["a", "Ivan"]]),
      POOL,
      names,
    );
    assert.match(text, /Iván \(voz <Ivan>\) · proyecto Hermes OS · trabajando · tarea: «Tarea de a» · ahora: Edit src\/x.ts/);
    assert.match(text, /sin voz · proyecto Hermes OS · terminó · tarea: «Tarea de b» · resultado: Todo pasa\./);
  });

  it("oficina vacía lo dice", () => {
    assert.match(describeOfficeTeam([], new Map(), POOL, names), /vacía/);
  });
});

describe("sala.json office", () => {
  const agent = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
    key,
    name,
    project: "hermes-os",
    color: "#d97757",
    head: "sphere",
    build: "slim",
    height: 1.7,
    voice: { voice_id: `v-${key}`, language: "es", prompt: "Hablas corto.", first_message: "Hola.", tools: [] },
    ...extra,
  });

  it("acepta voces apagadas en la sala (en la oficina solo prestan la voz)", () => {
    const c = parseSalaConfig({
      agents: [agent("hermes-sala", "Hermes"), agent("nevada", "Nevada", { enabled: false })],
      office: { members: ["hermes-sala", "nevada"], default: "hermes-sala" },
    });
    assert.deepEqual(c.office?.members, ["hermes-sala", "nevada"]);
  });

  it("rechaza etiquetas repetidas y miembros que no existen", () => {
    assert.throws(() => parseSalaConfig({ agents: [agent("a", "Iván"), agent("b", "Ivan")], office: { members: ["a", "b"] } }), /repetida/);
    assert.throws(() => parseSalaConfig({ agents: [agent("a", "Iván")], office: { members: ["x"] } }), /no es un agente/);
  });
});
