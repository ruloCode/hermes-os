import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  POINT_DWELL_MS,
  POINT_GRACE_MS,
  POINT_HIT_RADIUS,
  POINT_RELEASE_MS,
  POSE,
  PointingMachine,
  armExtended,
  elbowAngleDeg,
  pickTarget,
  pointingRay,
  puppetFrame,
  raisedHandTarget,
  handRaised,
  raySphereHit,
  salaArcPositions,
  syntheticBody,
  worldToScene,
  type PointTarget,
  type Vec3,
} from "@hermes/shared";

/**
 * Señalar: el brazo extendido se detecta, el rayo hombro→muñeca acierta al
 * agente correcto de los cinco del arco, y la máquina de dwell respeta los
 * dos umbrales (0,7 s para elegir · 1,5 s con el brazo abajo para soltar).
 */

const ORIGIN = { x: 0, y: 0, z: 1.9 };

/** Los cinco agentes como esferas de acierto, igual que en el mundo three.js. */
function targets(): PointTarget[] {
  const slots = salaArcPositions(5, { radius: 4.4, spreadDeg: 96 });
  return slots.map((s, i) => ({ key: `a${i}`, center: { x: s.x, y: 1.0, z: s.z }, radius: POINT_HIT_RADIUS }));
}

/**
 * Cuerpo sintético con el brazo derecho apuntando EXACTAMENTE a un punto de
 * la escena: invierte worldToScene para expresar la dirección en coords de
 * imagen (aimX, aimY con z fijo en -0.8).
 */
function bodyAimingAt(target: Vec3) {
  const base = syntheticBody();
  const shoulder = worldToScene(base[POSE.RIGHT_SHOULDER], { origin: ORIGIN });
  const d = { x: target.x - shoulder.x, y: target.y - shoulder.y, z: target.z - shoulder.z };
  // escena (dx,dy,dz) ← imagen (-ax, ay, az): ax = -dx·k, ay = dy·k, con az = dz·k = -0.8
  const k = -0.8 / d.z;
  return syntheticBody({ raise: "right", aimX: -d.x * k, aimY: d.y * k });
}

describe("armExtended / pointingRay", () => {
  it("brazos abajo: ningún brazo señala", () => {
    const f = puppetFrame(syntheticBody(), { origin: ORIGIN });
    assert.equal(armExtended(f, "left"), false);
    assert.equal(armExtended(f, "right"), false);
    assert.equal(pointingRay(f), null);
  });

  it("brazo derecho extendido al frente: rayo desde el hombro derecho hacia −z", () => {
    const f = puppetFrame(syntheticBody({ raise: "right" }), { origin: ORIGIN });
    assert.equal(armExtended(f, "right"), true);
    assert.equal(armExtended(f, "left"), false);
    const ray = pointingRay(f);
    assert.ok(ray);
    assert.equal(ray.side, "right");
    assert.deepEqual(ray.origin, f.points[POSE.RIGHT_SHOULDER]);
    assert.ok(ray.dir.z < -0.5, "apunta hacia los agentes");
    assert.ok(Math.abs(Math.hypot(ray.dir.x, ray.dir.y, ray.dir.z) - 1) < 1e-9, "unitario");
  });

  it("un codo doblado (<150°) no cuenta como señalar", () => {
    const body = syntheticBody({ raise: "right" });
    // Doblar el codo: muñeca de vuelta hacia el hombro.
    const s = body[POSE.RIGHT_SHOULDER];
    const e = body[POSE.RIGHT_ELBOW];
    body[POSE.RIGHT_WRIST] = { x: s.x, y: e.y - 0.25, z: e.z + 0.1, visibility: 0.99 };
    const f = puppetFrame(body, { origin: ORIGIN });
    assert.ok(elbowAngleDeg(f.points[POSE.RIGHT_SHOULDER], f.points[POSE.RIGHT_ELBOW], f.points[POSE.RIGHT_WRIST]) < 150);
    assert.equal(armExtended(f, "right"), false);
  });

  it("brazo horizontal a la altura del pecho SÍ señala (los agentes están a esa altura)", () => {
    const f = puppetFrame(syntheticBody({ raise: "right", aimY: -0.05 }), { origin: ORIGIN });
    assert.equal(armExtended(f, "right"), true);
  });

  it("si el modelo no ve la muñeca, no hay rayo", () => {
    const body = syntheticBody({ raise: "right" });
    body[POSE.RIGHT_WRIST].visibility = 0.1;
    assert.equal(pointingRay(puppetFrame(body, { origin: ORIGIN })), null);
  });
});

describe("raySphereHit / pickTarget", () => {
  it("acierta de frente y devuelve la distancia a la superficie", () => {
    const t = raySphereHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -5 }, 1);
    assert.ok(t !== null && Math.abs(t - 4) < 1e-9);
  });

  it("no acierta si pasa de lado ni si la esfera está detrás", () => {
    assert.equal(raySphereHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 2, y: 0, z: -5 }, 1), null);
    assert.equal(raySphereHit({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 5 }, 1), null);
  });

  it("señalando a cada uno de los cinco agentes del arco se elige ESE y no el vecino", () => {
    const tg = targets();
    for (const t of tg) {
      const f = puppetFrame(bodyAimingAt(t.center), { origin: ORIGIN });
      assert.equal(pickTarget(pointingRay(f), tg), t.key, `apuntando a ${t.key}`);
    }
  });

  it("con DOS agentes, apuntar 15° desviado sigue eligiendo al correcto (zona de 22°)", () => {
    const two = targets().filter((_, i) => i === 0 || i === 4);
    const t = two[1].center;
    // Desvía el objetivo ~15° en horizontal alrededor del hombro (radio ~6 m → ~1.6 m).
    const off = { x: t.x - 1.6, y: t.y + 0.6, z: t.z };
    const f = puppetFrame(bodyAimingAt(off), { origin: ORIGIN });
    assert.equal(pickTarget(pointingRay(f), two), two[1].key);
    // Pero apuntando al frente (a ~33° de cada uno, fuera de la zona de 22°) → nadie.
    const far = { x: 0, y: t.y, z: t.z };
    assert.equal(pickTarget(pointingRay(puppetFrame(bodyAimingAt(far), { origin: ORIGIN })), two), null);
  });

  it("apuntando entre dos agentes (o al cielo) no se elige a nadie", () => {
    const tg = targets();
    const mid = { x: (tg[0].center.x + tg[1].center.x) / 2, y: 1.0, z: (tg[0].center.z + tg[1].center.z) / 2 };
    assert.equal(pickTarget(pointingRay(puppetFrame(bodyAimingAt(mid), { origin: ORIGIN })), tg), null);
    const sky = puppetFrame(syntheticBody({ raise: "right", aimX: 0, aimY: 2.5 }), { origin: ORIGIN });
    assert.equal(pickTarget(pointingRay(sky), tg), null);
  });
});

describe("PointingMachine", () => {
  it("selecciona al cumplirse el dwell, no antes", () => {
    const m = new PointingMachine();
    let s = m.update("a1", true, 0);
    assert.equal(s.selected, null);
    s = m.update("a1", true, POINT_DWELL_MS - 1);
    assert.equal(s.selected, null);
    assert.ok(s.progress > 0.99 && s.progress < 1);
    s = m.update("a1", true, POINT_DWELL_MS);
    assert.equal(s.selected, "a1");
    assert.deepEqual(s.event, { kind: "select", key: "a1" });
    // Seguir apuntando al seleccionado no re-emite el evento.
    s = m.update("a1", true, POINT_DWELL_MS + 100);
    assert.equal(s.event, null);
    assert.equal(s.progress, 1);
  });

  it("cambiar de objetivo reinicia la carga; un parpadeo corto no", () => {
    const m = new PointingMachine();
    m.update("a1", true, 0);
    m.update("a1", true, 400);
    let s = m.update("a2", true, 500);
    assert.equal(s.aiming, "a2");
    assert.ok(s.progress < 0.01);
    // Parpadeo: se pierde el objetivo menos que la gracia → sigue cargando a2.
    s = m.update(null, true, 600);
    assert.equal(s.aiming, "a2");
    s = m.update("a2", true, 600 + POINT_GRACE_MS - 10);
    assert.equal(s.aiming, "a2");
    assert.ok(s.progress > 0.2, "la carga continuó desde 500");
    // Pérdida larga → se apaga.
    s = m.update(null, true, 2000);
    assert.equal(s.aiming, null);
    assert.equal(s.progress, 0);
  });

  it("seleccionado: bajar el brazo 1,5 s suelta; volver a subirlo antes lo conserva", () => {
    const m = new PointingMachine();
    m.update("a3", true, 0);
    m.update("a3", true, POINT_DWELL_MS);
    let s = m.update(null, false, 1000);
    assert.equal(s.selected, "a3");
    s = m.update(null, false, 1000 + POINT_RELEASE_MS - 50);
    assert.equal(s.selected, "a3", "aún no");
    s = m.update(null, true, 1000 + POINT_RELEASE_MS);
    assert.equal(s.selected, "a3", "brazo de vuelta arriba antes de soltar → se conserva");
    s = m.update(null, false, 5000);
    s = m.update(null, false, 5000 + POINT_RELEASE_MS);
    assert.equal(s.selected, null);
    assert.deepEqual(s.event, { kind: "release", key: "a3" });
  });

  it("señalar a otro agente estando seleccionado cambia la selección tras su dwell", () => {
    const m = new PointingMachine();
    m.update("a1", true, 0);
    m.update("a1", true, POINT_DWELL_MS);
    let s = m.update("a4", true, 2000);
    assert.equal(s.selected, "a1");
    assert.equal(s.aiming, "a4");
    s = m.update("a4", true, 2000 + POINT_DWELL_MS);
    assert.equal(s.selected, "a4");
    assert.deepEqual(s.event, { kind: "select", key: "a4" });
  });

  it("release() (Esc) suelta al instante y lo reporta", () => {
    const m = new PointingMachine();
    m.update("a2", true, 0);
    m.update("a2", true, POINT_DWELL_MS);
    const s = m.release(900);
    assert.equal(s.selected, null);
    assert.deepEqual(s.event, { kind: "release", key: "a2" });
    assert.equal(m.release(950).event, null);
  });
});

describe("raisedHandTarget (selección por mano, sin rayo)", () => {
  const two = targets().filter((_, i) => i === 0 || i === 4); // a0 izquierda · a4 derecha

  it("manos abajo: nadie y handUp=false", () => {
    const f = puppetFrame(syntheticBody(), { origin: ORIGIN });
    assert.deepEqual(raisedHandTarget(f, two), { target: null, handUp: false, side: null });
  });

  it("mano DERECHA arriba → agente de la derecha de la pantalla; IZQUIERDA → el de la izquierda", () => {
    const r = puppetFrame(syntheticBody({ raise: "right" }), { origin: ORIGIN });
    assert.equal(handRaised(r, "right"), true);
    assert.deepEqual(raisedHandTarget(r, two), { target: "a4", handUp: true, side: "right" });
    const l = puppetFrame(syntheticBody({ raise: "left" }), { origin: ORIGIN });
    assert.deepEqual(raisedHandTarget(l, two), { target: "a0", handUp: true, side: "left" });
  });

  it("no exige el codo recto ni apuntar: una mano doblada por encima del hombro cuenta", () => {
    const body = syntheticBody();
    const s = body[POSE.RIGHT_SHOULDER];
    body[POSE.RIGHT_ELBOW] = { x: s.x - 0.05, y: s.y - 0.05, z: -0.1, visibility: 0.99 };
    body[POSE.RIGHT_WRIST] = { x: s.x, y: s.y - 0.3, z: -0.15, visibility: 0.99 }; // y negativo = arriba
    const f = puppetFrame(body, { origin: ORIGIN });
    assert.equal(raisedHandTarget(f, two).target, "a4");
  });

  it("con las dos manos arriba manda la más alta; si el modelo no ve la muñeca, esa mano no cuenta", () => {
    const body = syntheticBody({ raise: "left" });
    const s = body[POSE.RIGHT_SHOULDER];
    body[POSE.RIGHT_WRIST] = { x: s.x, y: s.y - 0.6, z: -0.1, visibility: 0.99 }; // derecha MÁS alta
    assert.equal(raisedHandTarget(puppetFrame(body, { origin: ORIGIN }), two).target, "a4");
    body[POSE.RIGHT_WRIST].visibility = 0.1;
    assert.equal(raisedHandTarget(puppetFrame(body, { origin: ORIGIN }), two).target, "a0");
  });
});
