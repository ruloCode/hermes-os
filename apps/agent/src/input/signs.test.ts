import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIGN_COOLDOWN_MS,
  SIGN_GRACE_MS,
  SignClassifier,
  SignDetector,
  defaultSignsConfig,
  fingerShape,
  isReservedShape,
  normalizeLandmarks,
  vectorDistance,
  type FingerShape,
  type SignLandmark,
} from "@hermes/shared";

/**
 * Señas con manos SINTÉTICAS: una mano se fabrica a partir de qué dedos van
 * extendidos (misma topología de 21 puntos que MediaPipe), y sobre ella se
 * prueban forma, invariancias del vector canónico, clasificación y el
 * detector de sostén. Contratos de comportamiento, no snapshots.
 */

const ASPECT = 16 / 9;

/** Mano con la muñeca en (cx,cy), palma de tamaño `size` apuntando "arriba". */
function makeHand(shape: FingerShape, opts: { cx?: number; cy?: number; size?: number; angle?: number; mirror?: boolean } = {}): SignLandmark[] {
  const { cx = 0.5, cy = 0.75, size = 0.2, angle = 0, mirror = false } = opts;
  // Puntos en "espacio de palma": x en unidades de ancho, y hacia arriba (negativo).
  const pts: { x: number; y: number }[] = new Array(21);
  pts[0] = { x: 0, y: 0 };
  // Nudillos (MCP) de índice→meñique, de izquierda a derecha.
  const mcpX = [-0.35, -0.12, 0.12, 0.35];
  const fingers: [number, boolean][] = [
    [5, shape.index],
    [9, shape.middle],
    [13, shape.ring],
    [17, shape.pinky],
  ];
  fingers.forEach(([mcp, up], i) => {
    const x = mcpX[i];
    pts[mcp] = { x, y: -1 };
    if (up) {
      pts[mcp + 1] = { x, y: -1.4 };
      pts[mcp + 2] = { x, y: -1.75 };
      pts[mcp + 3] = { x, y: -2.05 };
    } else {
      // Plegado: PIP un poco arriba, punta de vuelta hacia la palma.
      pts[mcp + 1] = { x, y: -1.15 };
      pts[mcp + 2] = { x: x * 0.9, y: -0.9 };
      pts[mcp + 3] = { x: x * 0.8, y: -0.65 };
    }
  });
  // Pulgar: extendido = lejos hacia la izquierda; plegado = cruzado sobre la palma.
  pts[1] = { x: -0.3, y: -0.25 };
  pts[2] = { x: -0.55, y: -0.5 };
  if (shape.thumb) {
    pts[3] = { x: -0.85, y: -0.75 };
    pts[4] = { x: -1.1, y: -0.95 };
  } else {
    pts[3] = { x: -0.3, y: -0.8 };
    pts[4] = { x: 0.0, y: -0.9 };
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return pts.map((p) => {
    const x = (mirror ? -p.x : p.x) * size;
    const y = p.y * size;
    return { x: cx + (x * c - y * s) / ASPECT, y: cy + (x * s + y * c), z: 0 };
  });
}

const SHAKA: FingerShape = { thumb: true, index: false, middle: false, ring: false, pinky: true };
const ILY: FingerShape = { thumb: true, index: true, middle: false, ring: false, pinky: true };
const OPEN: FingerShape = { thumb: true, index: true, middle: true, ring: true, pinky: true };
const FIST: FingerShape = { thumb: false, index: false, middle: false, ring: false, pinky: false };
const POINT: FingerShape = { thumb: false, index: true, middle: false, ring: false, pinky: false };
const THREE: FingerShape = { thumb: false, index: true, middle: true, ring: true, pinky: false };

describe("señas: forma de dedos", () => {
  it("lee la forma de una mano sintética", () => {
    assert.deepEqual(fingerShape(makeHand(SHAKA), ASPECT), SHAKA);
    assert.deepEqual(fingerShape(makeHand(ILY), ASPECT), ILY);
    assert.deepEqual(fingerShape(makeHand(FIST), ASPECT), FIST);
    assert.deepEqual(fingerShape(makeHand(OPEN), ASPECT), OPEN);
  });

  it("la forma no depende del ángulo, del tamaño ni de la lateralidad", () => {
    for (const angle of [0, 0.6, -0.9, 2.5]) {
      assert.deepEqual(fingerShape(makeHand(ILY, { angle, size: 0.12 }), ASPECT), ILY);
      assert.deepEqual(fingerShape(makeHand(SHAKA, { angle, mirror: true }), ASPECT), SHAKA);
    }
  });

  it("reserva las formas del cursor, la pinza, el scroll y el puño", () => {
    assert.equal(isReservedShape(FIST), true);
    assert.equal(isReservedShape(OPEN), true);
    assert.equal(isReservedShape({ ...OPEN, thumb: false }), true);
    assert.equal(isReservedShape(POINT), false); // 🤫 índice solo, pulgar plegado
    assert.equal(isReservedShape({ ...POINT, thumb: true }), true); // "L"
    assert.equal(isReservedShape({ ...POINT, middle: true }), true); // scroll
    assert.equal(isReservedShape(SHAKA), false);
    assert.equal(isReservedShape(ILY), false);
    assert.equal(isReservedShape(THREE), false);
  });
});

describe("señas: vector canónico", () => {
  it("tiene 42 componentes", () => {
    assert.equal(normalizeLandmarks(makeHand(ILY), ASPECT).length, 42);
  });

  it("es invariante a traslación, escala, rotación y espejo", () => {
    const base = normalizeLandmarks(makeHand(ILY), ASPECT);
    const variants = [
      makeHand(ILY, { cx: 0.2, cy: 0.4 }),
      makeHand(ILY, { size: 0.08 }),
      makeHand(ILY, { angle: 0.7 }),
      makeHand(ILY, { angle: -1.2, size: 0.3, cx: 0.7 }),
      makeHand(ILY, { mirror: true }),
      makeHand(ILY, { mirror: true, angle: 0.4 }),
    ];
    for (const v of variants) {
      assert.ok(vectorDistance(base, normalizeLandmarks(v, ASPECT)) < 0.02);
    }
  });

  it("separa formas distintas", () => {
    const a = normalizeLandmarks(makeHand(ILY), ASPECT);
    const b = normalizeLandmarks(makeHand(SHAKA), ASPECT);
    const c = normalizeLandmarks(makeHand(THREE), ASPECT);
    assert.ok(vectorDistance(a, b) > 0.2);
    assert.ok(vectorDistance(a, c) > 0.2);
  });
});

describe("señas: clasificador", () => {
  it("reconoce las de fábrica por forma sin muestras", () => {
    const clf = new SignClassifier(defaultSignsConfig().signs);
    assert.equal(clf.classify(makeHand(SHAKA), ASPECT)?.id, "shaka");
    assert.equal(clf.classify(makeHand(ILY), ASPECT)?.id, "ily");
    assert.equal(clf.classify(makeHand(ILY, { mirror: true, angle: 0.5 }), ASPECT)?.id, "ily");
  });

  it("nunca reconoce una forma reservada, ni con muestras entrenadas", () => {
    const L: FingerShape = { ...POINT, thumb: true };
    const samples = [normalizeLandmarks(makeHand(L), ASPECT)];
    const clf = new SignClassifier([
      { id: "ele", name: "ele", samples, action: null, holdMs: 500, enabled: true, builtin: false },
    ]);
    assert.equal(clf.classify(makeHand(L), ASPECT), null);
    assert.equal(clf.classify(makeHand(OPEN), ASPECT), null);
    assert.equal(clf.classify(makeHand(FIST), ASPECT), null);
  });

  it("🤫 (índice solo, pulgar plegado) es la seña de silencio", () => {
    const clf = new SignClassifier(defaultSignsConfig().signs);
    assert.equal(clf.classify(makeHand(POINT), ASPECT)?.id, "shh");
  });

  it("una seña entrenada se reconoce con variaciones y manda sobre la forma", () => {
    const samples = [0, 0.3, -0.4].map((angle) => normalizeLandmarks(makeHand(THREE, { angle }), ASPECT));
    const clf = new SignClassifier([
      ...defaultSignsConfig().signs,
      { id: "tres", name: "tres", samples, action: "mute", holdMs: 500, enabled: true, builtin: false },
    ]);
    const m = clf.classify(makeHand(THREE, { angle: 0.15, size: 0.1, mirror: true }), ASPECT);
    assert.equal(m?.id, "tres");
    assert.equal(m?.via, "samples");
    // Las de forma siguen vivas al lado de las entrenadas.
    assert.equal(clf.classify(makeHand(SHAKA), ASPECT)?.id, "shaka");
  });

  it("ignora las señas apagadas", () => {
    const signs = defaultSignsConfig().signs.map((s) => (s.id === "shaka" ? { ...s, enabled: false } : s));
    const clf = new SignClassifier(signs);
    assert.equal(clf.classify(makeHand(SHAKA), ASPECT), null);
  });
});

describe("señas: detector de sostén", () => {
  it("dispara UNA vez al cumplir el sostén y no repite mientras se mantiene", () => {
    const d = new SignDetector();
    assert.equal(d.update("shaka", 600, 0).fired, null);
    const mid = d.update("shaka", 600, 300);
    assert.equal(mid.fired, null);
    assert.ok(mid.progress > 0.4 && mid.progress < 0.6);
    assert.equal(d.update("shaka", 600, 600).fired, "shaka");
    assert.equal(d.update("shaka", 600, 900).fired, null);
    assert.equal(d.update("shaka", 600, 5000).fired, null);
  });

  it("soltar y volver a hacer la seña rearma (tras el cooldown)", () => {
    const d = new SignDetector();
    d.update("shaka", 600, 0);
    assert.equal(d.update("shaka", 600, 600).fired, "shaka");
    // Soltada más allá de la gracia.
    d.update(null, 600, 600 + SIGN_GRACE_MS + 10);
    const t0 = 600 + SIGN_COOLDOWN_MS + 50;
    d.update("shaka", 600, t0);
    assert.equal(d.update("shaka", 600, t0 + 599).fired, null);
    assert.equal(d.update("shaka", 600, t0 + 600).fired, "shaka");
  });

  it("un parpadeo del tracking dentro de la gracia no reinicia la carga", () => {
    const d = new SignDetector();
    d.update("ily", 600, 0);
    d.update("ily", 600, 300);
    d.update(null, 600, 340); // frame perdido
    d.update(null, 600, 380);
    const r = d.update("ily", 600, 600);
    assert.equal(r.fired, "ily");
  });

  it("cambiar de seña reinicia la carga", () => {
    const d = new SignDetector();
    d.update("ily", 600, 0);
    d.update("ily", 600, 500);
    const r = d.update("shaka", 600, 550);
    assert.equal(r.candidate, "shaka");
    assert.ok(r.progress < 0.1);
    assert.equal(d.update("shaka", 600, 1100).fired, null);
    assert.equal(d.update("shaka", 600, 1150).fired, "shaka");
  });
});

describe("señas: store", () => {
  let dir: string;
  let store: typeof import("./signs-store.js");

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "hermes-signs-"));
    process.env.HERMES_SIGNS_PATH = join(dir, "gesture-signs.json");
    store = await import("./signs-store.js");
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("sin archivo devuelve las de fábrica", async () => {
    const c = await store.readSignsConfig();
    assert.deepEqual(c.signs.map((s) => s.id), ["shaka", "ily", "shh", "tres-pulgar"]);
  });

  it("guarda y relee un config válido, incluidos comandos ⌘K", async () => {
    const c = defaultSignsConfig();
    c.signs.push({
      id: "mia",
      name: "Mi seña",
      samples: [new Array(42).fill(0.1)],
      action: "command:modo-grabacion",
      holdMs: 800,
      enabled: true,
      builtin: false,
    });
    await store.writeSignsConfig(c);
    const back = await store.readSignsConfig();
    assert.equal(back.signs.length, 5);
    assert.equal(back.signs[4].action, "command:modo-grabacion");
  });

  it("rechaza acciones fuera del catálogo y vectores malformados", async () => {
    const bad = defaultSignsConfig();
    bad.signs[0].action = "keytap:cmd+q";
    await assert.rejects(() => store.writeSignsConfig(bad), store.SignsValidationError);
    const bad2 = defaultSignsConfig();
    bad2.signs.push({ id: "x", name: "x", samples: [[1, 2, 3]], action: null, holdMs: 600, enabled: true, builtin: false });
    await assert.rejects(() => store.writeSignsConfig(bad2), /42 números/);
    const bad3 = defaultSignsConfig();
    bad3.signs[0].holdMs = 50;
    await assert.rejects(() => store.writeSignsConfig(bad3), /holdMs/);
    // Lo anterior no tocó el archivo bueno.
    assert.equal((await store.readSignsConfig()).signs.length, 5);
  });
});
