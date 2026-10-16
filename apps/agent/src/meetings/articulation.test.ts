/**
 * Articulación: contratos del detector de arranques débiles (shared), de la
 * métrica del coach y de las reglas de disparo del motor "Dilo más claro".
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectWeakPhrases, rewriteWorthy, type LiveSegment } from "@hermes/shared";
import { ArticulationCoach, POLISH_ID_PREFIX } from "./live-articulation.js";
import { computeCoachMetrics } from "./live-coach.js";
import type { FastEngine, FastGenRequest } from "./live-copilot.js";
import type { NormalizedTurn } from "./live-stt.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const kinds = (t: string) => detectWeakPhrases(t).map((h) => h.kind);

describe("detectWeakPhrases", () => {
  it("las frases del anuncio, en inglés", () => {
    assert.deepEqual(kinds("Good morning everyone, I just wanted to apologize"), ["permiso"]);
    assert.deepEqual(kinds("Sorry for taking a minute of your time"), ["disculpa"]);
    assert.deepEqual(kinds("I totally understand where you're coming from, but the date stays"), ["borra"]);
    assert.deepEqual(kinds("So obviously, as you can see from the deck"), ["relleno", "relleno"]);
    assert.deepEqual(kinds("I think maybe we could ship on Friday"), ["duda"]);
  });
  it("las mismas en español", () => {
    assert.deepEqual(kinds("Solo quería comentar una cosa del despliegue"), ["permiso"]);
    assert.deepEqual(kinds("Perdón por quitarles tiempo"), ["disculpa"]);
    assert.deepEqual(kinds("Entiendo perfectamente lo que dices, pero la fecha no se mueve"), ["borra"]);
    assert.deepEqual(kinds("Obviamente, como pueden ver en la gráfica"), ["relleno", "relleno"]);
    assert.deepEqual(kinds("Creo que tal vez podríamos esperar"), ["duda"]);
    assert.deepEqual(kinds("No sé si sea buena idea"), ["duda"]);
  });
  it("lo dicho con el punto primero no tiene señales", () => {
    assert.deepEqual(kinds("Propongo mover la entrega al viernes: así probamos con datos reales."), []);
    assert.deepEqual(kinds("Let's ship on Friday; the load test is already green."), []);
    // "pero" sin borrar nada no cuenta
    assert.deepEqual(kinds("Funciona, pero falta medir la latencia."), []);
  });
  it("filtra por idioma (la clase solo cuenta inglés)", () => {
    const mixed = "Solo quería decir que I think maybe we should wait";
    assert.deepEqual(
      detectWeakPhrases(mixed, "en").map((h) => h.kind),
      ["duda"],
    );
    assert.equal(detectWeakPhrases(mixed).length, 2);
  });
  it("respeta el orden de aparición y devuelve el fragmento tal cual", () => {
    const hits = detectWeakPhrases("Sorry to interrupt, I just wanted to say something");
    assert.deepEqual(
      hits.map((h) => [h.kind, h.match]),
      [
        ["disculpa", "Sorry to"],
        ["permiso", "I just wanted to say"],
      ],
    );
  });
});

describe("rewriteWorthy", () => {
  it("corto no amerita, aunque tenga señal", () => {
    assert.equal(rewriteWorthy("Perdón por eso"), false);
  });
  it("con señal y largo suficiente, sí", () => {
    assert.equal(rewriteWorthy("Solo quería comentar que el despliegue del viernes quedó pendiente"), true);
  });
  it("limpio y corto no gasta una llamada", () => {
    assert.equal(rewriteWorthy("Propongo mover la entrega al viernes para probar con datos reales."), false);
  });
  it("largo sin señales sí (el punto pudo quedar enterrado)", () => {
    assert.equal(rewriteWorthy(Array.from({ length: 50 }, (_, i) => `palabra${i}`).join(" ")), true);
  });
});

describe("computeCoachMetrics · arranques débiles", () => {
  const seg = (speaker: string, text: string, final = true): LiveSegment =>
    ({ id: text, speaker, text, startMs: 0, endMs: 1_000, final }) as LiveSegment;
  it("cuenta por hablante, solo finales", () => {
    const m = computeCoachMetrics(
      [
        seg("A", "Solo quería decir que creo que tal vez sí"),
        seg("A", "Obviamente funciona", false),
        seg("B", "Hagámoslo el viernes."),
      ],
      "A",
      2_000,
    );
    assert.equal(m.bySpeaker.A.weak, 2);
    assert.equal(m.bySpeaker.B.weak, 0);
  });
  it("en clase solo cuenta señales en inglés", () => {
    const m = computeCoachMetrics([seg("A", "Perdón por eso, sorry for the delay")], "A", 1_000, {
      fillers: "en",
    });
    assert.equal(m.bySpeaker.A.weak, 1);
  });
});

class FakeEngine implements FastEngine {
  reqs: FastGenRequest[] = [];
  destroyed = false;
  generate(req: FastGenRequest): void {
    this.reqs.push(req);
  }
  destroy(): void {
    this.destroyed = true;
  }
}

let n = 0;
const turn = (speaker: string, text: string, final = true): NormalizedTurn =>
  ({ key: `k${++n}`, speaker, text, final, endOfTurn: final, startMs: 0, endMs: 0 }) as NormalizedTurn;

const WEAK = "Solo quería comentar que creo que tal vez deberíamos mover la fecha de la entrega";

describe("ArticulationCoach", () => {
  it("sin «soy yo» no corre", async () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => l, selfMergeMs: 10 });
    c.onTurn(turn("A", WEAK), undefined);
    await sleep(30);
    assert.equal(e.reqs.length, 0);
    c.destroy();
  });
  it("tu intervención se junta hasta que callas y sale con contexto y pistas", async () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => `Persona ${l}`, selfMergeMs: 20 });
    c.onTurn(turn("B", "¿Qué hacemos con la fecha?"), "A");
    c.onTurn(turn("A", "Solo quería comentar que creo que tal vez"), "A");
    c.onTurn(turn("A", "deberíamos mover la fecha de la entrega"), "A");
    assert.equal(e.reqs.length, 0); // aún hablando
    await sleep(50);
    assert.equal(e.reqs.length, 1);
    const r = e.reqs[0];
    assert.ok(r.id.startsWith(POLISH_ID_PREFIX));
    assert.equal(r.kind, "pulir");
    assert.match(r.prompt, /Persona B: ¿Qué hacemos con la fecha\?/);
    assert.match(r.prompt, /tal vez deberíamos mover/);
    assert.match(r.prompt, /Pide permiso/);
    assert.match(r.prompt, /en español/);
    c.destroy();
    assert.ok(e.destroyed);
  });
  it("que hable otro cierra tu intervención sin esperar el silencio", () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => l, selfMergeMs: 60_000 });
    c.onTurn(turn("A", WEAK), "A");
    c.onTurn(turn("B", "Ok, lo vemos."), "A");
    assert.equal(e.reqs.length, 1);
    c.destroy();
  });
  it("lo dicho claro y corto no se manda", () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => l });
    c.onTurn(turn("A", "Propongo moverla al viernes."), "A");
    c.onTurn(turn("B", "Va."), "A");
    assert.equal(e.reqs.length, 0);
    c.destroy();
  });
  it("respeta el intervalo entre reescrituras y ignora parciales", () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => l, minIntervalMs: 60_000 });
    c.onTurn(turn("A", WEAK, false), "A");
    c.onTurn(turn("B", "Ajá."), "A");
    assert.equal(e.reqs.length, 0);
    c.onTurn(turn("A", WEAK), "A");
    c.onTurn(turn("B", "Ajá."), "A");
    c.onTurn(turn("A", "I just wanted to say that maybe we could wait a week"), "A");
    c.onTurn(turn("B", "Sure."), "A");
    assert.equal(e.reqs.length, 1);
    c.destroy();
  });
  it("en inglés lo marca como inglés (la reescritura va en el mismo idioma)", () => {
    const e = new FakeEngine();
    const c = new ArticulationCoach(e, { nameOf: (l) => l });
    c.onTurn(turn("A", "Sorry to interrupt, I just wanted to say that maybe we could wait"), "A");
    c.onTurn(turn("B", "Go ahead."), "A");
    assert.match(e.reqs[0].prompt, /en inglés/);
    c.destroy();
  });
});
