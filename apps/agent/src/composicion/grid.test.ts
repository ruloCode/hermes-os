import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GROOVE_PATTERNS,
  beatsPerBar,
  clickWindowSec,
  detectClicks,
  estimateTempo,
  fromGrid,
  metricWeight,
  newTema,
  secPerStep,
  splitCycles,
  stepsPerBar,
  stepsPerBeat,
  tapTempo,
  toGrid,
  trackEvents,
  type GridSpec,
  type TemaSection,
  type TemaTrack,
  type TrackEvent,
} from "@hermes/shared";

/**
 * La REJILLA de la máquina de temas: tiempo ↔ compás/paso (con swing y
 * anacrusa), pesos métricos, tempo por tap y estimado, lo que suena en la
 * pista (acordes, bajo, groove, clic, cuenta de entrada), el corte de una
 * grabación continua en vueltas y la calibración de latencia por loopback.
 * Todo sintético: ritmos inventados y clics generados.
 */

/** PRNG con semilla (mulberry32): el jitter de los tests es reproducible. */
function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const near = (a: number, b: number, tol: number, msg?: string): void =>
  assert.ok(Math.abs(a - b) <= tol, msg ?? `${a} no está a ±${tol} de ${b}`);

describe("compases y pasos", () => {
  it("4/4 = 4 pulsos de 4 pasos; 3/4 = 3 de 4; 6/8 = 2 pulsos de 6", () => {
    assert.deepEqual([beatsPerBar("4/4"), stepsPerBeat("4/4"), stepsPerBar("4/4")], [4, 4, 16]);
    assert.deepEqual([beatsPerBar("3/4"), stepsPerBeat("3/4"), stepsPerBar("3/4")], [3, 4, 12]);
    assert.deepEqual([beatsPerBar("6/8"), stepsPerBeat("6/8"), stepsPerBar("6/8")], [2, 6, 12]);
    near(secPerStep(120, "4/4"), 0.125, 1e-12);
  });
});

describe("metricWeight", () => {
  it("4/4: el 1 manda, el 3 le sigue, 2 y 4 son tiempos, corcheas y semicorcheas", () => {
    const w = Array.from({ length: 16 }, (_, s) => metricWeight(s, "4/4"));
    assert.deepEqual(w, [4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0]);
  });

  it("3/4: el 1 y dos tiempos iguales", () => {
    const w = Array.from({ length: 12 }, (_, s) => metricWeight(s, "3/4"));
    assert.deepEqual(w, [4, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 0]);
  });

  it("6/8: dos pulsos (0 y 6) y corcheas", () => {
    const w = Array.from({ length: 12 }, (_, s) => metricWeight(s, "6/8"));
    assert.deepEqual(w, [4, 0, 1, 0, 1, 0, 3, 0, 1, 0, 1, 0]);
  });

  it("pliega pasos fuera del compás (la anacrusa trae pasos negativos)", () => {
    assert.equal(metricWeight(-2, "4/4"), 1); // paso 14 del compás anterior
    assert.equal(metricWeight(16, "4/4"), 4);
  });
});

describe("toGrid / fromGrid", () => {
  const g: GridSpec = { bpm: 96, meter: "4/4", downbeatSec: 1.25 };

  it("ida y vuelta exacta en todos los pasos, anacrusa incluida", () => {
    for (let s = -20; s <= 40; s++) {
      const q = toGrid(fromGrid(s, g), g);
      assert.equal(q.absStep, s);
      near(q.offSec, 0, 1e-9);
      assert.equal((q.bar - 1) * 16 + q.stepInBar, s);
      assert.ok(q.stepInBar >= 0 && q.stepInBar < 16);
    }
  });

  it("la anacrusa es compás 0: dos semicorcheas antes del 1 = compás 0, paso 14", () => {
    const q = toGrid(g.downbeatSec - 2 * secPerStep(96, "4/4"), g);
    assert.deepEqual([q.bar, q.stepInBar, q.absStep], [0, 14, -2]);
    const q2 = toGrid(g.downbeatSec - 17 * secPerStep(96, "4/4"), g);
    assert.deepEqual([q2.bar, q2.stepInBar], [-1, 15]);
  });

  it("el desvío tiene signo: + = tarde", () => {
    const q = toGrid(fromGrid(5, g) + 0.012, g);
    assert.equal(q.absStep, 5);
    near(q.offSec, 0.012, 1e-9);
    const q2 = toGrid(fromGrid(5, g) - 0.03, g);
    assert.equal(q2.absStep, 5);
    near(q2.offSec, -0.03, 1e-9);
  });

  it("swing: las semicorcheas impares se retrasan swing·paso; las pares no se mueven", () => {
    const sw: GridSpec = { ...g, swing: 0.5 };
    const sps = secPerStep(96, "4/4");
    near(fromGrid(1, sw) - fromGrid(0, sw), 1.5 * sps, 1e-12);
    near(fromGrid(2, sw) - fromGrid(0, sw), 2 * sps, 1e-12);
    near(fromGrid(-1, sw), g.downbeatSec - 0.5 * sps, 1e-12);
    // Ida y vuelta con swing y un ataque que recto caería en el paso 2.
    for (let s = -8; s <= 24; s++) assert.equal(toGrid(fromGrid(s, sw), sw).absStep, s);
    const t = g.downbeatSec + 1.8 * sps; // recto: paso 2; con swing el 1 está en 1,5
    assert.equal(toGrid(t, sw).absStep, 2);
    assert.equal(toGrid(g.downbeatSec + 1.6 * sps, sw).absStep, 1);
  });

  it("6/8 cuenta 12 pasos por compás con el bpm en negras con puntillo", () => {
    const g68: GridSpec = { bpm: 60, meter: "6/8", downbeatSec: 0 };
    const q = toGrid(1.0, g68); // un pulso = 1 s = 6 pasos
    assert.deepEqual([q.bar, q.stepInBar], [1, 6]);
    assert.equal(toGrid(2.0, g68).bar, 2);
  });
});

describe("tapTempo", () => {
  it("null con menos de dos golpes", () => {
    assert.equal(tapTempo([]), null);
    assert.equal(tapTempo([1000]), null);
  });

  it("120 bpm con jitter de ±15 ms", () => {
    const r = rng(7);
    const taps = Array.from({ length: 8 }, (_, i) => 1000 + i * 500 + (r() * 30 - 15));
    const bpm = tapTempo(taps);
    assert.ok(bpm != null);
    near(bpm, 120, 2);
  });

  it("un hueco de más de 2 s reinicia: lo de antes no cuenta", () => {
    const before = [0, 600, 1200, 1800, 2400]; // 100 bpm
    const after = [5000, 5500, 6000, 6500]; // 120 bpm
    assert.equal(tapTempo([...before, ...after]), 120);
    assert.equal(tapTempo([...before, 5000]), null); // un solo golpe tras el reinicio
  });

  it("usa solo los últimos 8 intervalos", () => {
    const slow = Array.from({ length: 10 }, (_, i) => i * 400); // 150 bpm
    const fast = Array.from({ length: 9 }, (_, i) => 3600 + (i + 1) * 500); // 120 bpm
    assert.equal(tapTempo([...slow, ...fast]), 120);
  });
});

describe("estimateTempo", () => {
  /** Un tarareo sintético: ataques en tiempos, corcheas y alguna semicorchea, con ~15 % omitidos. */
  const hum = (bpm: number, seed: number, jitter: number): number[] => {
    const r = rng(seed);
    const sps = 60 / bpm / 4;
    const on: number[] = [];
    for (let bar = 0; bar < 8; bar++)
      for (const s of [0, 2, 4, 6, 7, 10, 12, 14])
        if (r() < 0.85) on.push(0.4 + (bar * 16 + s) * sps + (r() * 2 - 1) * jitter);
    return on;
  };

  it("96 bpm con ataques a ±20 ms: el tempo sale a ±1 y la confianza es alta", () => {
    for (const seed of [1, 2, 3]) {
      const e = estimateTempo(hum(96, seed, 0.02));
      assert.ok(e);
      near(e.bpm, 96, 1);
      assert.ok(e.confidence > 0.3, `confianza ${e.confidence}`);
    }
  });

  it("no confunde 96 con 72 ni con 128 (el peso de los tiempos decide)", () => {
    const quarters = Array.from({ length: 16 }, (_, i) => 0.3 + i * 0.625);
    const e = estimateTempo(quarters);
    assert.ok(e);
    near(e.bpm, 96, 0.5);
    for (const bpm of [72, 85, 110, 128]) near(estimateTempo(hum(bpm, 4, 0.015))?.bpm ?? 0, bpm, 1);
  });

  it("ataques al azar: confianza honesta (baja)", () => {
    for (const seed of [1, 2, 3]) {
      const r = rng(seed);
      const e = estimateTempo(Array.from({ length: 50 }, () => r() * 20));
      assert.ok(e == null || e.confidence < 0.15, `confianza ${e?.confidence}`);
    }
  });

  it("null sin con qué (menos de 4 ataques)", () => {
    assert.equal(estimateTempo([0, 0.5, 1]), null);
    assert.equal(estimateTempo([]), null);
  });
});

describe("trackEvents", () => {
  const tema = newTema({ id: "t", title: "Prueba", now: "2026-01-01T00:00:00Z" });
  const track = (over: Partial<TemaTrack> = {}): TemaTrack => ({ ...tema.track, bpm: 120, groove: "dembow", ...over });
  const section: TemaSection = tema.track.sections[0]; // Am F C G, un acorde por compás
  const sps = secPerStep(120, "4/4");
  const at = (evs: TrackEvent[], kind: TrackEvent["kind"]): number[] =>
    evs.filter((e) => e.kind === kind).map((e) => Math.round(e.t / sps));

  it("dembow: bombo en los 4 tiempos, caja en el 3+3+2 (pasos 3, 6, 11, 14)", () => {
    const evs = trackEvents(track(), section, 0, 16);
    assert.deepEqual(at(evs, "kick"), GROOVE_PATTERNS.dembow.kick);
    assert.deepEqual(at(evs, "snare"), [3, 6, 11, 14]);
    assert.deepEqual(at(evs, "hat"), GROOVE_PATTERNS.dembow.hat);
    const clicks = evs.filter((e) => e.kind === "click");
    assert.deepEqual(clicks.map((e) => Math.round(e.t / sps)), [0, 4, 8, 12]);
    assert.deepEqual(clicks.map((e) => !!e.accent), [true, false, false, false]);
  });

  it("acorde en posición cerrada ~Do4 con su bajo en la fundamental, sostenido hasta el siguiente", () => {
    const evs = trackEvents(track(), section, 0, 32);
    const chords = evs.filter((e) => e.kind === "chord");
    assert.equal(chords.length, 2);
    assert.deepEqual(chords[0].midi, [57, 60, 64]); // La3 Do4 Mi4
    assert.deepEqual(chords[1].midi, [57, 60, 65]); // Fa: La3 Do4 Fa4
    for (const c of chords) {
      const m = c.midi as number[];
      assert.ok(Math.max(...m) - Math.min(...m) < 12, "cerrado: dentro de una octava");
      assert.ok(m.every((x) => x >= 55 && x <= 66));
    }
    near(chords[0].dur, 16 * sps, 1e-9);
    const bass = evs.filter((e) => e.kind === "bass");
    assert.deepEqual(bass.map((b) => b.midi), [[45], [41]]); // La2, Fa2
  });

  it("el loop se repite por módulo: el compás 5 vuelve a La menor", () => {
    const evs = trackEvents(track(), section, 64, 65);
    const c = evs.find((e) => e.kind === "chord");
    assert.ok(c);
    assert.deepEqual(c.midi, [57, 60, 64]);
    near(c.t, 64 * sps, 1e-9);
  });

  it("dos acordes en el compás: el segundo entra en su tiempo y acorta al primero", () => {
    const s2: TemaSection = { ...section, loop: [{ chords: [{ symbol: "Am", beat: 0 }, { symbol: "G", beat: 2 }] }] };
    const evs = trackEvents(track(), s2, 0, 16);
    const chords = evs.filter((e) => e.kind === "chord");
    assert.deepEqual(chords.map((c) => Math.round(c.t / sps)), [0, 8]);
    near(chords[0].dur, 8 * sps, 1e-9);
    near(chords[1].dur, 8 * sps, 1e-9); // vuelve a Am al compás siguiente
  });

  it("cuenta de entrada (pasos negativos) = solo clic, con acento en el 1", () => {
    const evs = trackEvents(track(), section, -16, 0);
    assert.ok(evs.every((e) => e.kind === "click"));
    assert.equal(evs.length, 4);
    near(evs[0].t, -16 * sps, 1e-9);
    assert.deepEqual(evs.map((e) => !!e.accent), [true, false, false, false]);
  });

  it("las opciones apagan capas; groove «clic» o compás que no es 4/4 = solo clic", () => {
    const noMetro = trackEvents(track(), section, 0, 16, { metronome: false });
    assert.equal(noMetro.filter((e) => e.kind === "click").length, 0);
    const onlyChords = trackEvents(track({ groove: "clic" }), section, 0, 16, { metronome: false, groove: false });
    assert.deepEqual(Array.from(new Set(onlyChords.map((e) => e.kind))).sort(), ["bass", "chord"]);
    const clicGroove = trackEvents(track({ groove: "clic" }), section, 0, 16, { metronome: false });
    assert.equal(clicGroove.filter((e) => e.kind === "click").length, 4);
    const waltz = trackEvents(track({ meter: "3/4" }), section, 0, 12);
    assert.equal(waltz.filter((e) => e.kind === "kick" || e.kind === "snare").length, 0);
    assert.equal(waltz.filter((e) => e.kind === "click").length, 3);
  });

  it("ventanas consecutivas no repiten ni pierden eventos", () => {
    const whole = trackEvents(track(), section, -16, 64);
    const parts = [
      ...trackEvents(track(), section, -16, 5),
      ...trackEvents(track(), section, 5, 37),
      ...trackEvents(track(), section, 37, 64),
    ];
    assert.equal(parts.length, whole.length);
    assert.deepEqual(parts.map((e) => [e.kind, e.t.toFixed(6)]), whole.map((e) => [e.kind, e.t.toFixed(6)]));
  });

  it("los eventos salen ordenados por tiempo", () => {
    const evs = trackEvents(track(), section, -16, 64);
    for (let i = 1; i < evs.length; i++) assert.ok(evs[i].t >= evs[i - 1].t);
  });
});

describe("splitCycles", () => {
  it("una toma por vuelta completa, con pre-roll y cola; el primer tiempo relativo a la toma", () => {
    const cycles = splitCycles({ totalSec: 10, downbeatSec: 1, loopSec: 2, preRollSec: 0.5, tailSec: 0.3 });
    assert.deepEqual(
      cycles.map((c) => [c.cycle, c.startSec, round(c.endSec), c.downbeatSec]),
      [
        [1, 0.5, 3.3, 0.5],
        [2, 2.5, 5.3, 0.5],
        [3, 4.5, 7.3, 0.5],
        [4, 6.5, 9.3, 0.5],
      ],
    );
  });

  it("la última vuelta cortada por la latencia (≤ 250 ms) cuenta; una a medias no", () => {
    const c1 = splitCycles({ totalSec: 8.8, downbeatSec: 1, loopSec: 2, preRollSec: 0.5, tailSec: 0.3 });
    assert.equal(c1.length, 4);
    assert.equal(c1[3].endSec, 8.8);
    const c2 = splitCycles({ totalSec: 8, downbeatSec: 1, loopSec: 2, preRollSec: 0.5, tailSec: 0.3 });
    assert.equal(c2.length, 3);
  });

  it("el pre-roll no pasa del inicio de la grabación", () => {
    const [c] = splitCycles({ totalSec: 3, downbeatSec: 0.2, loopSec: 2, preRollSec: 0.5, tailSec: 0 });
    assert.equal(c.startSec, 0);
    near(c.downbeatSec, 0.2, 1e-12);
  });

  it("sin loop o sin audio no hay tomas", () => {
    assert.deepEqual(splitCycles({ totalSec: 0, downbeatSec: 0, loopSec: 2, preRollSec: 0, tailSec: 0 }), []);
    assert.deepEqual(splitCycles({ totalSec: 5, downbeatSec: 0, loopSec: 0, preRollSec: 0, tailSec: 0 }), []);
  });
});

const round = (x: number): number => Math.round(x * 1e6) / 1e6;

describe("detectClicks", () => {
  const SR = 48000;
  /** Clics de 3 ms (seno de 2 kHz con caída) + eco del cuarto + ruido de fondo. */
  function loopback(expected: number[], delaySec: number, opts: { drop?: number[] } = {}): Float32Array {
    const r = rng(11);
    const pcm = new Float32Array(Math.round((expected[expected.length - 1] + 1) * SR));
    for (let i = 0; i < pcm.length; i++) pcm[i] = (r() * 2 - 1) * 0.003;
    expected.forEach((e, k) => {
      if (opts.drop?.includes(k)) return;
      const on = Math.round((e + delaySec) * SR);
      for (let j = 0; j < 0.02 * SR; j++) {
        const t = j / SR;
        const v = 0.6 * Math.sin(2 * Math.PI * 2000 * t) * Math.exp(-t / 0.003);
        const echo = j >= 0.008 * SR ? 0.2 * Math.sin(2 * Math.PI * 2000 * (t - 0.008)) * Math.exp(-(t - 0.008) / 0.004) : 0;
        if (on + j < pcm.length) pcm[on + j] += v + echo;
      }
    });
    return pcm;
  }
  const expected = Array.from({ length: 8 }, (_, k) => 0.5 + k * 0.6);

  it("encuentra un retardo sintético de 23 ms (±1 ms) con dispersión mínima", () => {
    const res = detectClicks(loopback(expected, 0.023), SR, expected);
    assert.ok(res);
    near(res.delayMs, 23, 1);
    assert.ok(res.madMs < 1);
    assert.equal(res.found, 8);
  });

  it("sirve también a 16 kHz y con retardos grandes (Bluetooth ~200 ms)", () => {
    const sr = 16000;
    const pcm16 = loopback(expected, 0.2);
    const down = new Float32Array(Math.floor(pcm16.length / 3));
    for (let i = 0; i < down.length; i++) down[i] = pcm16[i * 3];
    const res = detectClicks(down, sr, expected);
    assert.ok(res);
    near(res.delayMs, 200, 1);
  });

  it("Bluetooth de 320 ms con clics a 1 s: engancha SU clic, no el anterior", () => {
    const spaced = Array.from({ length: 8 }, (_, k) => 0.5 + k * 1.0);
    const res = detectClicks(loopback(spaced, 0.32), SR, spaced);
    assert.ok(res, "con ±250 ms fijos no encontraba ninguno");
    near(res.delayMs, 320, 1);
    assert.equal(res.found, 8);
    assert.ok(res.madMs < 1);
  });

  it("la ventana es 0,45 × la separación mínima entre clics (tope 450 ms): nunca alcanza al vecino", () => {
    near(clickWindowSec([0.5, 1.5, 2.5]), 0.45, 1e-12);
    near(clickWindowSec([0.5, 1.1, 1.7]), 0.27, 1e-12);
    near(clickWindowSec([0.5, 0.7, 1.7]), 0.09, 1e-12);
    near(clickWindowSec([2]), 0.45, 1e-12, "un clic solo usa el tope");
    near(clickWindowSec([3, 1, 2]), 0.45, 1e-12, "el orden no importa");
  });

  it("null si no encontró ni la mitad de los clics", () => {
    const silent = new Float32Array(SR * 6);
    assert.equal(detectClicks(silent, SR, expected), null);
    const res = detectClicks(loopback(expected, 0.023, { drop: [0, 1, 2, 3, 4] }), SR, expected);
    assert.equal(res, null);
    const ok = detectClicks(loopback(expected, 0.023, { drop: [0, 1, 2] }), SR, expected);
    assert.equal(ok?.found, 5);
  });
});
