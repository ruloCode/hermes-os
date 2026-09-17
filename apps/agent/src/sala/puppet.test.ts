import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  POSE,
  PUPPET_BONES,
  PUPPET_HEAD,
  PUPPET_POINT_COUNT,
  PuppetSmoother,
  parseSalaConfig,
  puppetFrame,
  salaArcPositions,
  syntheticBody,
  worldToScene,
  SalaValidationError,
} from "@hermes/shared";

/**
 * Marioneta de la Sala 3D: contratos de comportamiento sobre landmarks
 * sintéticos (sin cámara, sin three.js). Lo que se prueba es lo que el demo
 * necesita que sea verdad: el brazo que levantas sube del lado correcto de la
 * pantalla, lo que el modelo no ve no se dibuja, y el suavizado no inventa
 * saltos.
 */

describe("worldToScene", () => {
  it("rota 180° sobre z (no espeja): x e y se invierten, z se conserva", () => {
    const p = worldToScene({ x: 0.3, y: -0.4, z: -0.2 }, { origin: { x: 0, y: 0, z: 0 }, hipHeight: 0 });
    assert.deepEqual(p, { x: -0.3, y: 0.4, z: -0.2 });
  });

  it("las caderas caen en el origen del avatar a la altura de cadera", () => {
    const p = worldToScene({ x: 0, y: 0, z: 0 }, { origin: { x: 0, y: 0, z: 1 }, hipHeight: 0.95 });
    assert.deepEqual(p, { x: 0, y: 0.95, z: 1 });
  });

  it("conserva distancias (movimiento rígido): el rayo de señalar no se deforma", () => {
    const a = { x: 0.1, y: -0.2, z: 0.3 };
    const b = { x: -0.4, y: 0.5, z: -0.1 };
    const d0 = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const A = worldToScene(a);
    const B = worldToScene(b);
    const d1 = Math.hypot(A.x - B.x, A.y - B.y, A.z - B.z);
    assert.ok(Math.abs(d0 - d1) < 1e-12);
  });
});

describe("puppetFrame", () => {
  it("devuelve 34 puntos y la cabeza virtual en la media de las orejas", () => {
    const f = puppetFrame(syntheticBody());
    assert.equal(f.points.length, PUPPET_POINT_COUNT);
    assert.equal(f.visible.length, PUPPET_POINT_COUNT);
    assert.equal(f.visible[PUPPET_HEAD], true);
    const l = f.points[POSE.LEFT_EAR];
    const r = f.points[POSE.RIGHT_EAR];
    assert.ok(Math.abs(f.points[PUPPET_HEAD].x - (l.x + r.x) / 2) < 1e-9);
    assert.ok(f.points[PUPPET_HEAD].y > f.points[POSE.LEFT_SHOULDER].y, "la cabeza queda sobre los hombros");
  });

  it("levantar el brazo DERECHO sube la muñeca derecha del lado derecho de la pantalla (x > 0)", () => {
    const f = puppetFrame(syntheticBody({ raise: "right" }));
    const wrist = f.points[POSE.RIGHT_WRIST];
    const shoulder = f.points[POSE.RIGHT_SHOULDER];
    assert.ok(wrist.y > shoulder.y, "muñeca por encima del hombro");
    assert.ok(wrist.x > 0, "brazo derecho del usuario → lado derecho de la pantalla (vista de espaldas)");
    assert.ok(wrist.z < shoulder.z, "apunta hacia los agentes (−z)");
    // El izquierdo sigue abajo.
    assert.ok(f.points[POSE.LEFT_WRIST].y < f.points[POSE.LEFT_SHOULDER].y);
  });

  it("oculta la cara y lo que el modelo no ve (piernas con visibilidad baja)", () => {
    const f = puppetFrame(syntheticBody());
    for (let i = 0; i <= 10; i++) assert.equal(f.visible[i], false, `cara ${i} oculta`);
    assert.equal(f.visible[POSE.LEFT_KNEE], false);
    assert.equal(f.visible[POSE.RIGHT_ANKLE], false);
    assert.equal(f.visible[POSE.LEFT_SHOULDER], true);
    assert.equal(f.visible[POSE.RIGHT_WRIST], true);
  });

  it("sin orejas visibles usa la nariz para la cabeza; sin nada, la cabeza se oculta", () => {
    const body = syntheticBody();
    body[POSE.LEFT_EAR].visibility = 0.1;
    body[POSE.RIGHT_EAR].visibility = 0.1;
    const f = puppetFrame(body);
    assert.equal(f.visible[PUPPET_HEAD], true);
    assert.ok(f.points[PUPPET_HEAD].z > f.points[POSE.NOSE].z, "el centro queda detrás de la nariz");
    body[POSE.NOSE].visibility = 0.1;
    assert.equal(puppetFrame(body).visible[PUPPET_HEAD], false);
  });

  it("los huesos solo referencian puntos válidos y ninguno de la cara", () => {
    for (const [a, b] of PUPPET_BONES) {
      assert.ok(a >= 11 && a < PUPPET_POINT_COUNT, `hueso ${a}-${b}`);
      assert.ok(b >= 11 && b < PUPPET_POINT_COUNT, `hueso ${a}-${b}`);
      assert.notEqual(a, b);
    }
  });
});

describe("PuppetSmoother", () => {
  it("converge a un cuerpo quieto y no inventa movimiento", () => {
    const s = new PuppetSmoother();
    const f = puppetFrame(syntheticBody());
    let out = s.update(f, 0);
    for (let t = 16; t < 2000; t += 16) out = s.update(f, t);
    const w = out.points[POSE.RIGHT_WRIST];
    const target = f.points[POSE.RIGHT_WRIST];
    assert.ok(Math.hypot(w.x - target.x, w.y - target.y, w.z - target.z) < 1e-3);
  });

  it("un punto que reaparece arranca en su posición nueva, sin volar desde la vieja", () => {
    const s = new PuppetSmoother();
    const a = puppetFrame(syntheticBody());
    for (let t = 0; t < 500; t += 16) s.update(a, t);
    // Desaparece la muñeca…
    const gone = { points: a.points, visible: a.visible.map((v, i) => (i === POSE.RIGHT_WRIST ? false : v)) };
    s.update(gone, 520);
    // …y vuelve LEJOS (brazo levantado): el primer frame ya está ahí.
    const b = puppetFrame(syntheticBody({ raise: "right" }));
    const out = s.update(b, 540);
    const w = out.points[POSE.RIGHT_WRIST];
    const target = b.points[POSE.RIGHT_WRIST];
    assert.ok(Math.hypot(w.x - target.x, w.y - target.y, w.z - target.z) < 1e-9);
  });

  it("sigue un movimiento rápido con poco retraso (One Euro adapta el corte a la velocidad)", () => {
    const s = new PuppetSmoother();
    let last = puppetFrame(syntheticBody());
    s.update(last, 0);
    // 30 frames a 60 fps barriendo de brazo abajo a brazo arriba.
    for (let k = 1; k <= 30; k++) {
      const body = syntheticBody({ raise: "right", aimY: -0.6 + (k / 30) * 1.0 });
      last = s.update(puppetFrame(body), k * 16.7);
    }
    const target = puppetFrame(syntheticBody({ raise: "right", aimY: 0.4 })).points[POSE.RIGHT_WRIST];
    const w = last.points[POSE.RIGHT_WRIST];
    assert.ok(Math.abs(w.y - target.y) < 0.12, `retraso vertical ${Math.abs(w.y - target.y).toFixed(3)} m`);
  });
});

describe("salaArcPositions", () => {
  it("reparte N figuras de izquierda a derecha, simétricas y mirando al frente", () => {
    const p = salaArcPositions(5, { radius: 4 });
    assert.equal(p.length, 5);
    for (let i = 1; i < p.length; i++) assert.ok(p[i].x > p[i - 1].x, "x creciente");
    assert.ok(Math.abs(p[0].x + p[4].x) < 1e-9, "simétrico");
    assert.ok(Math.abs(p[2].x) < 1e-9 && Math.abs(p[2].z + 4) < 1e-9, "el del medio al frente");
    for (const q of p) assert.ok(Math.abs(Math.hypot(q.x, q.z) - 4) < 1e-9, "todos a la misma distancia");
  });

  it("con una figura la deja al centro; con cero, nada", () => {
    assert.deepEqual(salaArcPositions(1, { radius: 3 }), [{ x: 0, z: -3, yaw: 0 }]);
    assert.deepEqual(salaArcPositions(0), []);
  });
});

describe("parseSalaConfig", () => {
  const base = {
    key: "nevada",
    name: "Nevada",
    project: "nevadatech",
    color: "#5B7FA6",
    head: "cube",
    height: 1.8,
    build: "wide",
    voice: {
      voice_id: "abc",
      language: "es",
      first_message: "Hola",
      prompt: "Eres Nevada",
      tools: ["get_project_status"],
    },
  };

  it("acepta un agente propio y uno reusado, normaliza el color y deja agent_id en null", () => {
    const cfg = parseSalaConfig({ agents: [base, { ...base, key: "hermes", voice: { reuse: "hermes" } }] });
    assert.equal(cfg.agents.length, 2);
    assert.equal(cfg.agents[0].color, "#5b7fa6");
    assert.equal((cfg.agents[0].voice as { agent_id: string | null }).agent_id, null);
    assert.equal(cfg.agents[1].voice.reuse, "hermes");
  });

  it("rechaza keys repetidas, la key 'tutor' sin reuse, cabezas desconocidas y alturas absurdas", () => {
    assert.throws(() => parseSalaConfig({ agents: [base, base] }), SalaValidationError);
    assert.throws(() => parseSalaConfig({ agents: [{ ...base, key: "tutor" }] }), /reuse/);
    assert.throws(() => parseSalaConfig({ agents: [{ ...base, head: "pyramid" }] }), /head/);
    assert.throws(() => parseSalaConfig({ agents: [{ ...base, height: 4 }] }), /height/);
    assert.throws(() => parseSalaConfig({ agents: [] }), /vacía/);
  });
});
