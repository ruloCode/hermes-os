import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cameraToRoom,
  dominantYaw,
  EscenarioState,
  LinkMetric,
  parseDotenv,
  parseRoom,
  pearson,
  RU_DEFAULT_POS,
  setDotenvKey,
  stageGeometry,
  trimSensing,
  type RuSensing,
} from "@hermes/shared";

/** Un mensaje del servidor con el RSSI de cada nodo y su contador de tramas. */
function msg(rssi: Record<number, number>, seq: number, extra: Partial<RuSensing> = {}): RuSensing {
  return {
    source: "esp32",
    room: "absent",
    room_confidence: 1,
    motion_band_power: 0,
    node_features: [1, 2, 3].map((id) => ({
      node_id: id,
      stale: false,
      frame_rate_hz: 40,
      rssi_dbm: rssi[id] ?? -50,
      motion_band_power: 0,
      motion_level: null,
    })),
    nodes: [1, 2, 3].map((id) => ({ node_id: id, rssi_dbm: rssi[id] ?? -50, seq })),
    ...extra,
  };
}

/** Ruido determinista pequeño (±0,5 dB) para que la línea base tenga varianza real. */
const jitter = (i: number) => (((i * 7919) % 11) - 5) / 10;

describe("recorte del mensaje del servidor", () => {
  it("saca sala, rasgos por nodo y contador de tramas", () => {
    const s = trimSensing({
      type: "sensing_update",
      source: "simulated",
      room_inference: { classification: "present_moving", confidence: 0.8 },
      features: { motion_band_power: 6 },
      node_features: [{ node_id: 2, stale: false, frame_rate_hz: 30, rssi_dbm: -61, features: { motion_band_power: 4 } }],
      nodes: [{ node_id: 2, rssi_dbm: -61, sync: { csi_fps_samples: 99 } }],
      amplitude: new Array(500).fill(0),
    });
    assert.ok(s);
    assert.equal(s.room, "present_moving");
    assert.equal(s.source, "simulated");
    assert.equal(s.node_features[0].motion_band_power, 4);
    assert.equal(s.nodes[0].seq, 99);
    assert.equal("amplitude" in s, false, "lo que la UI no usa no viaja");
  });

  it("sin room_inference cae a classification.motion_level", () => {
    const s = trimSensing({ classification: { motion_level: "present_still" }, node_features: [] });
    assert.equal(s?.room, "present_still");
  });

  it("un mensaje que no es de sensado devuelve null", () => {
    assert.equal(trimSensing({ type: "hello" }), null);
    assert.equal(trimSensing(null), null);
  });
});

describe("docker/.env", () => {
  it("reescribe una clave sin tocar las demás y agrega la que falta", () => {
    const base = "RUVIEW_API_TOKEN=abc\nCSI_SOURCE=simulated\n";
    const a = setDotenvKey(base, "CSI_SOURCE", "esp32");
    assert.deepEqual(parseDotenv(a), { RUVIEW_API_TOKEN: "abc", CSI_SOURCE: "esp32" });
    const b = setDotenvKey("RUVIEW_API_TOKEN=abc\n", "CSI_SOURCE", "esp32");
    assert.deepEqual(parseDotenv(b), { RUVIEW_API_TOKEN: "abc", CSI_SOURCE: "esp32" });
  });

  it("ignora comentarios y quita comillas", () => {
    assert.deepEqual(parseDotenv('# nada\nA="x y"\n  B = 2 '), { A: "x y", B: "2" });
  });
});

describe("métrica por enlace", () => {
  /** 40 s de sala quieta (calienta la línea base móvil), mensajes cada 50 ms. */
  function warm(m: LinkMetric) {
    let t = 0;
    let seq = 0;
    for (; t < 40_000; t += 50) {
      seq++;
      m.onSensing(msg({ 1: -50 + jitter(seq), 2: -55 + jitter(seq + 3), 3: -60 + jitter(seq + 5) }, seq), t);
      if (t % 250 === 0) m.tick(t);
    }
    return { t, seq };
  }

  it("una sala quieta no enciende ningún enlace", () => {
    const m = new LinkMetric();
    warm(m);
    assert.deepEqual(m.activeLinks(), []);
    for (const id of [1, 2, 3] as const) assert.ok(m.nodes[id].d < 0.15, `enlace ${id} d=${m.nodes[id].d}`);
  });

  it("alguien cruzando el enlace 2 lo enciende a él y solo a él", () => {
    const m = new LinkMetric();
    let { t, seq } = warm(m);
    const end = t + 3000;
    for (; t < end; t += 50) {
      seq++;
      const swing = seq % 2 ? -48 : -64; // el cuerpo hace bailar el RSSI del enlace 2
      m.onSensing(msg({ 1: -50 + jitter(seq), 2: swing, 3: -60 + jitter(seq + 5) }, seq), t);
      if (t % 250 === 0) m.tick(t);
    }
    assert.deepEqual(m.activeLinks(), [2]);
    assert.equal(m.nodes[2].dbg?.ref, "móvil", "sin calibrar se compara contra la línea base móvil");
  });

  it("una trama repetida (mismo contador) no cuenta como lectura nueva", () => {
    const m = new LinkMetric();
    m.onSensing(msg({ 1: -50 }, 7), 0);
    m.onSensing(msg({ 1: -70 }, 7), 50);
    assert.equal(m.nodes[1].rssi.length, 1);
    assert.equal(m.nodes[1].rssiNow, -70, "el valor vigente sí se actualiza");
  });

  it("calibrar guarda una referencia de sala vacía por nodo", () => {
    const m = new LinkMetric();
    let seq = 0;
    m.startCalibration(0, 10_000);
    for (let t = 0; t <= 12_000; t += 50) {
      seq++;
      m.onSensing(msg({ 1: -50 + jitter(seq), 2: -55, 3: -60 }, seq), t);
      if (t % 250 === 0) m.tick(t, new Date(2026, 9, 6, 9, 5));
    }
    assert.equal(m.calib, null);
    assert.ok(m.ref?.nodes[1], "nodo 1 con referencia");
    assert.ok(Math.abs((m.ref?.nodes[1]?.mean ?? 0) + 50) < 1);
  });

  it("la sensibilidad se acota y va en pasos de 0,25", () => {
    const m = new LinkMetric();
    assert.equal(m.setSensitivity(9), 2);
    assert.equal(m.setSensitivity(0.1), 0.5);
    assert.equal(m.setSensitivity(1.1), 1);
  });

  it("sin mensajes por 3 s deja de estar en vivo", () => {
    const m = new LinkMetric();
    m.onSensing(msg({}, 1), 1000);
    assert.equal(m.live(2000), true);
    assert.equal(m.live(4500), false);
  });
});

describe("tarima", () => {
  it("con la sala de fábrica, el enlace al nodo del escenario cruza la tarima", () => {
    const g = stageGeometry(RU_DEFAULT_POS);
    assert.ok(g[3].w > 0.5, `w=${g[3].w}`);
    assert.ok(g[3].mid && g[3].mid.z < -3.6);
  });

  it("un nodo lejos de la tarima no la mide", () => {
    const pos = structuredClone(RU_DEFAULT_POS);
    pos.T = { x: 0, y: 0.8, z: 5 };
    pos["1"] = { x: 4, y: 0.05, z: 6 };
    assert.equal(stageGeometry(pos)[1].w, 0);
  });
});

describe("escenario 2D", () => {
  it("un estado nuevo se muestra solo si se sostiene más de 0,8 s", () => {
    const e = new EscenarioState();
    const moving = msg({}, 1, { room: "present_moving" });
    e.ingest(moving, 0);
    e.ingest(moving, 500);
    assert.equal(e.shown, "absent", "a los 0,5 s todavía no");
    e.ingest(moving, 900);
    assert.equal(e.shown, "present_moving");
  });

  it("un parpadeo de un instante no cambia lo que se muestra", () => {
    const e = new EscenarioState();
    e.ingest(msg({}, 1, { room: "present_still" }), 0);
    e.ingest(msg({}, 2, { room: "absent" }), 300);
    e.ingest(msg({}, 3, { room: "present_still" }), 1200);
    assert.equal(e.shown, "absent");
  });

  it("la silueta se inclina hacia el nodo con más perturbación", () => {
    const e = new EscenarioState();
    const d = msg({}, 1);
    d.node_features[1].motion_band_power = 10; // nodo 2, a la derecha
    e.ingest(d, 0);
    assert.ok(e.lean > 0);
  });

  it("una fuente que no es esp32 queda marcada", () => {
    const e = new EscenarioState();
    e.ingest(msg({}, 1, { source: "simulated" }), 0);
    assert.equal(e.sourceWarn, "simulated");
  });
});

describe("pearson", () => {
  it("1 para series iguales, null sin datos suficientes o sin varianza", () => {
    const p: [number, number][] = Array.from({ length: 60 }, (_, i) => [i, i * 2]);
    assert.ok(Math.abs((pearson(p) ?? 0) - 1) < 1e-9);
    assert.equal(pearson(p.slice(0, 10)), null);
    assert.equal(pearson(Array.from({ length: 60 }, () => [1, 1] as [number, number])), null);
  });
});

describe("cuarto (room.json)", () => {
  const base = {
    size: { w: 3.6, d: 4.2, h: 2.5 },
    nodes: { T: { x: 3, y: 0.7, z: 0.3 }, "1": { x: 0.5, y: 1.9, z: 1 }, "2": { x: 2, y: 1, z: 0.1 }, "3": { x: 1.4, y: 0.35, z: 3.3 } },
    zone: { x0: 1, x1: 3, z0: 0.6, z1: 1.7 },
    anchor: { x: 2.7, z: 1 },
  };

  it("acepta un cuarto válido con escaneo y cámara, y completa lo opcional", () => {
    const r = parseRoom({ ...base, scan: { file: "room.glb", yaw: 23, offset: { x: 1, y: 0.1, z: -2 } }, camera: { x: 2.8, y: 1.3, z: 0.2 } });
    assert.ok(r.ok);
    assert.equal(r.room.scan?.yaw, 23);
    assert.equal(r.room.scan?.scale, 1);
    assert.equal(r.room.camera?.hfov, 70, "FOV por defecto de una webcam 16:9");
    assert.equal(r.room.camera?.yaw, 180, "por defecto mira hacia −z: la cámara en el frente mirando al fondo");
  });

  it("dice exactamente qué falta", () => {
    const r = parseRoom({ ...base, nodes: { ...base.nodes, "2": { x: 1 } } });
    assert.equal(r.ok, false);
    assert.match(r.ok ? "" : r.error, /nodes\.2/);
    const z = parseRoom({ ...base, zone: { x0: 3, x1: 1, z0: 0, z1: 1 } });
    assert.equal(z.ok, false);
  });
});

describe("alineación del escaneo", () => {
  /** Paredes de un cuarto rectangular giradas `deg` (normales hacia adentro, con área) + ruido de muebles. */
  function walls(deg: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let k = 0; k < 4; k++) {
      const a = ((deg + k * 90) * Math.PI) / 180;
      out.push([Math.cos(a), Math.sin(a), k % 2 ? 9 : 11]);
    }
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4; // muebles en cualquier ángulo, poca área
      out.push([Math.cos(a), Math.sin(a), 0.05]);
    }
    out.push([0.1, 0.05, 30]); // piso/techo: normal casi vertical, se ignora
    return out;
  }
  /** rotation.y de three: un vector a θ queda a θ − α. */
  const rotate = (deg: number, alpha: number) => ((deg - alpha + 540) % 90 + 90) % 90;

  for (const deg of [23, -31, 44, 0, 67]) {
    it(`un cuarto girado ${deg}° queda con las paredes en los ejes`, () => {
      const yaw = dominantYaw(walls(deg));
      const left = rotate(deg, yaw);
      assert.ok(Math.min(left, 90 - left) < 0.5, `queda a ${left}° de un eje (yaw=${yaw})`);
    });
  }

  it("sin paredes no inventa un giro", () => {
    const noise: [number, number, number][] = Array.from({ length: 50 }, (_, i) => [Math.cos(i * 1.7), Math.sin(i * 1.7), 1]);
    assert.equal(dominantYaw(noise), 0);
    assert.equal(dominantYaw([]), 0);
  });
});

describe("cámara maestra → cuarto", () => {
  // Cámara en el fondo (z=0.2) a 1,3 m mirando al frente (+z), FOV 70°, video 1280×720.
  const cam = { x: 2, y: 1.3, z: 0.2, yaw: 0, pitch: 0, hfov: 70 };
  const video = { width: 1280, height: 720 };
  const fx = 640 / Math.tan((35 * Math.PI) / 180);

  /** Cuerpo de frente a la cámara con la cadera en `hip` (coordenadas de la cámara: x derecha, y abajo, z lejos). */
  function body(hipCam: { x: number; y: number; z: number }) {
    const world = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
    world[11] = { x: 0.18, y: -0.5, z: 0, visibility: 1 }; // hombro izq. (a la derecha de la imagen)
    world[12] = { x: -0.18, y: -0.5, z: 0, visibility: 1 };
    world[23] = { x: 0.1, y: 0, z: 0, visibility: 1 };
    world[24] = { x: -0.1, y: 0, z: 0, visibility: 1 };
    const project = (p: { x: number; y: number; z: number }) => {
      const X = hipCam.x + p.x, Y = hipCam.y + p.y, Z = hipCam.z + p.z;
      return { x: (fx * X) / Z / 1280 + 0.5, y: (fx * Y) / Z / 720 + 0.5, z: 0, visibility: 1 };
    };
    return { world, image: world.map(project) };
  }

  it("ubica la cadera a la distancia y el ángulo correctos", () => {
    // 2,0 m al frente, 15° a la derecha de la cámara, cadera 0,4 m bajo la cámara
    const a = (15 * Math.PI) / 180;
    const hipCam = { x: Math.sin(a) * 2, y: 0.4, z: Math.cos(a) * 2 };
    const { world, image } = body(hipCam);
    const r = cameraToRoom(world, image, video, cam);
    assert.ok(r);
    const dist = Math.hypot(hipCam.x, hipCam.y, hipCam.z);
    assert.ok(Math.abs(r.distance - dist) < 0.1, `distancia ${r.distance.toFixed(2)} vs ${dist.toFixed(2)}`);
    // mirando a +z, la derecha de la cámara es −x en el cuarto
    assert.ok(Math.abs(r.hip.x - (cam.x - hipCam.x)) < 0.1, `x ${r.hip.x.toFixed(2)}`);
    assert.ok(Math.abs(r.hip.y - (cam.y - hipCam.y)) < 0.1, `y ${r.hip.y.toFixed(2)}`);
    assert.ok(Math.abs(r.hip.z - (cam.z + hipCam.z)) < 0.1, `z ${r.hip.z.toFixed(2)}`);
    // los hombros quedan ARRIBA de la cadera en el cuarto
    assert.ok(r.points[11].y > r.hip.y + 0.4);
  });

  it("sin hombros o caderas visibles no adivina", () => {
    const { world, image } = body({ x: 0, y: 0.3, z: 2 });
    image[23] = { ...image[23], visibility: 0.1 };
    assert.equal(cameraToRoom(world, image, video, cam), null);
  });
});
