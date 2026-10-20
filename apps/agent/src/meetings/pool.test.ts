/**
 * Pool de motores de la capa rápida: lo que empieza a escribirse termina, una
 * pregunta nueva va al motor libre, y de lo que espera solo sigue lo último
 * (lo pedido a mano no lo desplaza un automático). Motores falsos manuales:
 * el test decide cuándo termina cada respuesta.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FastEnginePool,
  lazyRequest,
  type FastCopilotEvent,
  type FastEngine,
  type FastGenRequest,
} from "./live-copilot.js";

class ManualEngine implements FastEngine {
  readonly sent: { id: string; prompt: string }[] = [];
  constructor(private readonly sink: (ev: FastCopilotEvent) => void) {}
  generate(req: FastGenRequest): void {
    this.sent.push({ id: req.id, prompt: req.promptFor ? req.promptFor(this) : req.prompt });
    this.sink({ type: "start", id: req.id, trigger: req.trigger, kind: req.kind });
  }
  finish(id: string, text = "ok"): void {
    this.sink({ type: "done", id, text, trigger: "", manual: false, elapsedMs: 1 });
  }
  destroy(): void {}
}

function setup(size = 2) {
  const engines: ManualEngine[] = [];
  const events: FastCopilotEvent[] = [];
  const pool = new FastEnginePool(
    (sink) => {
      const e = new ManualEngine(sink);
      engines.push(e);
      return e;
    },
    (ev) => events.push(ev),
    { size },
  );
  const req = (id: string, manual = false): FastGenRequest => ({ id, trigger: id, manual, prompt: id });
  const of = (type: string) => events.filter((e) => e.type === type).map((e) => ("id" in e ? e.id : ""));
  return { pool, engines, events, req, of };
}

describe("FastEnginePool", () => {
  it("dos preguntas seguidas: cada una a su motor, ninguna se corta", () => {
    const { pool, engines, req, of } = setup();
    pool.generate(req("A"));
    pool.generate(req("B"));
    assert.deepEqual(engines.map((e) => e.sent.map((x) => x.id)), [["A"], ["B"]]);
    assert.deepEqual(of("aborted"), []);
  });

  it("con todos ocupados espera, y sale apenas se libera un motor", () => {
    const { pool, engines, req, of } = setup();
    pool.generate(req("A"));
    pool.generate(req("B"));
    pool.generate(req("C"));
    assert.deepEqual(of("start"), ["A", "B", "C"], "la que espera también se anuncia");
    engines[0].finish("A");
    assert.deepEqual(engines[0].sent.map((x) => x.id), ["A", "C"]);
    assert.deepEqual(of("start"), ["A", "B", "C"], "sin start duplicado al despacharla");
  });

  it("de lo que espera solo sigue lo último; lo pedido a mano no lo saca un automático", () => {
    const { pool, engines, req, of } = setup();
    pool.generate(req("A"));
    pool.generate(req("B"));
    pool.generate(req("C"));
    pool.generate(req("D"));
    assert.deepEqual(of("aborted"), ["C"], "C esperaba y llegó D");
    pool.generate(req("M", true));
    assert.deepEqual(of("aborted"), ["C", "D"], "lo manual desplaza al automático que esperaba");
    pool.generate(req("E"));
    assert.deepEqual(of("aborted"), ["C", "D"], "el automático no desplaza lo manual: no entra");
    assert.ok(!of("start").includes("E"));
    engines[1].finish("B");
    assert.deepEqual(engines[1].sent.map((x) => x.id), ["B", "M"]);
  });

  it("el prompt se arma para el motor que lo envía (contexto incremental por sesión)", () => {
    const { pool, engines } = setup();
    const seen = new Map<FastEngine, number>();
    const build = (engine: FastEngine) => {
      const n = (seen.get(engine) ?? 0) + 1;
      seen.set(engine, n);
      return `motor ${engines.indexOf(engine as ManualEngine)} · mensaje ${n}`;
    };
    pool.generate(lazyRequest({ id: "A", trigger: "", manual: false }, build, pool));
    pool.generate(lazyRequest({ id: "B", trigger: "", manual: false }, build, pool));
    pool.generate(lazyRequest({ id: "C", trigger: "", manual: false }, build, pool));
    assert.equal(seen.size, 2, "C aún no se armó: espera motor");
    engines[1].finish("B");
    assert.deepEqual(
      engines.map((e) => e.sent.map((x) => x.prompt)),
      [["motor 0 · mensaje 1"], ["motor 1 · mensaje 1", "motor 1 · mensaje 2"]],
    );
  });
});
