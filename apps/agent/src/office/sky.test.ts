import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hourOf, luminance, skyAt, skyWeights } from "@hermes/shared";

describe("cielo de la oficina", () => {
  it("los pesos suman 1 a cualquier hora", () => {
    for (let m = 0; m < 24 * 60; m += 7) {
      const w = skyWeights(m / 60);
      assert.ok(Math.abs(w.day + w.dusk + w.night - 1) < 1e-9, `suma a las ${m / 60}`);
      for (const v of Object.values(w)) assert.ok(v >= 0 && v <= 1);
    }
  });

  it("mediodía es día, medianoche es noche y la puesta es atardecer", () => {
    assert.ok(skyWeights(12).day > 0.99);
    assert.ok(skyWeights(0).night > 0.99);
    assert.ok(skyWeights(3).night > 0.99);
    const sunset = skyWeights(18);
    assert.ok(sunset.dusk > sunset.day && sunset.dusk > sunset.night, "a las 18 manda el atardecer");
    assert.equal(skyAt(12).label, "día");
    assert.equal(skyAt(23).label, "noche");
    assert.equal(skyAt(18).label, "atardecer");
    assert.equal(skyAt(6).label, "amanecer");
  });

  it("el cruce entre día, atardecer y noche es continuo (sin saltos de un minuto a otro)", () => {
    let prev = skyWeights(0);
    for (let m = 1; m <= 24 * 60; m++) {
      const w = skyWeights(m / 60);
      for (const k of ["day", "dusk", "night"] as const) assert.ok(Math.abs(w[k] - prev[k]) < 0.03, `salto en ${k} a las ${m / 60}`);
      prev = w;
    }
  });

  it("el cruce dura: hay atardecer visible al menos 40 minutos", () => {
    let minutes = 0;
    for (let m = 16 * 60; m < 20 * 60; m++) if (skyWeights(m / 60).dusk > 0.5) minutes++;
    assert.ok(minutes >= 40, `atardecer de ${minutes} min`);
  });

  it("ningún color del cielo es casi negro, ni a medianoche", () => {
    for (let m = 0; m < 24 * 60; m += 5) {
      const s = skyAt(m / 60);
      assert.ok(luminance(s.zenith) > 0.015, `cénit ${s.zenith} a las ${m / 60}`);
      assert.ok(luminance(s.horizon) > 0.05, `horizonte ${s.horizon} a las ${m / 60}`);
    }
  });

  it("las luces de la ciudad se prenden al anochecer y se apagan de día", () => {
    assert.equal(skyAt(12).cityLights, 0);
    assert.equal(skyAt(23).cityLights, 1);
    assert.ok(skyAt(18.2).cityLights > 0.3);
  });

  it("el sol sale por el este (+x), se pone por el oeste y nunca baja del piso", () => {
    assert.ok(skyAt(8).sun.x > 0.3);
    assert.ok(skyAt(16).sun.x < -0.3);
    for (let h = 0; h < 24; h += 0.5) {
      const s = skyAt(h).sun;
      assert.ok(s.y > 0, `sol bajo el piso a las ${h}`);
      assert.ok(Math.abs(Math.hypot(s.x, s.y, s.z) - 1) < 1e-9);
    }
  });

  it("hourOf lee la hora local y la hora fuera de rango se normaliza", () => {
    assert.equal(hourOf(new Date(2026, 9, 1, 18, 30)), 18.5);
    assert.deepEqual(skyAt(36).weights, skyAt(12).weights);
    assert.deepEqual(skyAt(-1).weights, skyAt(23).weights);
  });
});
