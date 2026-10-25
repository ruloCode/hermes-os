/**
 * Audio de la junta/clase EN VIVO: qué micrófono se abre, cuándo se avisa que
 * tu mic no se oye, y la compuerta que evita tarjetas "cargando…" vacías.
 * Nació de la clase del 2026-10-16 (el transcript solo traía a la profe).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  audioHealth,
  audioReportLine,
  isVirtualMic,
  micDisplayName,
  pickMicDevice,
  type SourceEnergy,
} from "@hermes/shared";
import { hasReadableText, SuggestionStreamGate } from "./stream-gate.js";

const frames = (seconds: number, mic: number, tab: number, fromMs = 0): SourceEnergy[] =>
  Array.from({ length: seconds * 10 }, (_, i) => ({ ms: fromMs + i * 100, mic, tab }));

describe("elegir micrófono", () => {
  const mac = { deviceId: "mac", label: "Micrófono de MacBook Pro (Built-in)" };
  const teams = { deviceId: "teams", label: "Microsoft Teams Audio (Virtual)" };
  const zoom = { deviceId: "zoom", label: "ZoomAudioDevice (Virtual)" };

  it("reconoce los drivers virtuales de Teams y Zoom, no los mics físicos", () => {
    assert.equal(isVirtualMic(teams.label), true);
    assert.equal(isVirtualMic(zoom.label), true);
    assert.equal(isVirtualMic("BlackHole 2ch"), true);
    assert.equal(isVirtualMic(mac.label), false);
    assert.equal(isVirtualMic("AirPods Pro de Rulo"), false);
  });

  it("con un predeterminado físico deja decidir al sistema", () => {
    const devs = [{ deviceId: "default", label: `Predeterminado - ${mac.label}` }, mac, teams];
    assert.equal(pickMicDevice(devs), undefined);
  });

  it("si el predeterminado es virtual, abre el primer micrófono físico", () => {
    const devs = [{ deviceId: "default", label: `Predeterminado - ${teams.label}` }, teams, zoom, mac];
    assert.equal(pickMicDevice(devs), "mac");
  });

  it("el que eligió el dueño manda mientras siga conectado", () => {
    const devs = [{ deviceId: "default", label: `Predeterminado - ${mac.label}` }, mac, zoom];
    assert.equal(pickMicDevice(devs, "zoom"), "zoom");
    assert.equal(pickMicDevice(devs, "ya-no-existe"), undefined);
  });

  it("muestra el nombre sin el prefijo de alias de Chrome", () => {
    assert.equal(micDisplayName(`Predeterminado - ${mac.label}`), mac.label);
    assert.equal(micDisplayName("Default - AirPods"), "AirPods");
  });
});

describe("¿se oye tu mic?", () => {
  it("la profe suena 45 s y tu mic nunca pasa del ruido → aviso", () => {
    const h = audioHealth(frames(50, 0.002, 0.05));
    assert.equal(h.micSilent, true);
    assert.equal(h.micVoice, 0);
    assert.ok(h.tabVoice > 0.9);
  });

  it("con tu voz en la ventana no hay aviso", () => {
    const f = frames(50, 0.002, 0.05);
    f[300] = { ...f[300], mic: 0.05 };
    assert.equal(audioHealth(f).micSilent, false);
  });

  it("los primeros 45 s no alarman (ventana incompleta)", () => {
    assert.equal(audioHealth(frames(30, 0, 0.05)).micSilent, false);
  });

  it("los dos callados (pausa) no es mic mudo, salvo que el input esté muerto", () => {
    assert.equal(audioHealth(frames(50, 0.003, 0)).micSilent, false);
    assert.equal(audioHealth(frames(50, 0, 0)).micSilent, true); // driver virtual: silencio digital
  });

  it("la línea del transcript dice qué mic y cuánta voz entró", () => {
    const line = audioReportLine({ mic: "Micrófono de MacBook Pro", micVoice: 0.02, tabVoice: 0.41, silentWarned: true });
    assert.match(line, /«Micrófono de MacBook Pro»/);
    assert.match(line, /2 %/);
    assert.match(line, /41 %/);
    assert.match(line, /aviso de micrófono mudo/);
    assert.equal(audioReportLine(undefined), "");
  });
});

describe("compuerta del streaming de sugerencias", () => {
  it("un silencio del modelo («—») no abre ninguna tarjeta", () => {
    const g = new SuggestionStreamGate<string>();
    assert.deepEqual(g.start("a", "START"), []);
    assert.deepEqual(g.delta("a", "—"), []);
    assert.equal(g.done("a"), false); // nunca se mostró: no hay nada que cerrar
  });

  it("la tarjeta se abre con el primer texto legible, con todo lo acumulado", () => {
    const g = new SuggestionStreamGate<string>();
    g.start("a", "START");
    assert.deepEqual(g.delta("a", " "), []);
    assert.deepEqual(g.delta("a", "It's"), [
      { type: "start", start: "START" },
      { type: "delta", text: " It's" },
    ]);
    assert.deepEqual(g.delta("a", " been"), [{ type: "delta", text: " been" }]);
    assert.equal(g.done("a"), true);
  });

  it("interrumpida antes de mostrarse no avisa; después sí", () => {
    const g = new SuggestionStreamGate<string>();
    g.start("a", "A");
    assert.deepEqual(g.aborted("a"), []);
    g.start("b", "B");
    g.delta("b", "Clave: x");
    assert.deepEqual(g.aborted("b"), [{ type: "aborted" }]);
  });

  it("guiones, puntos y espacios no cuentan como texto", () => {
    assert.equal(hasReadableText("— "), false);
    assert.equal(hasReadableText("…"), false);
    assert.equal(hasReadableText("Ok"), true);
  });
});
