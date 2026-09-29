import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PadEdges, STICK_DEADZONE, padLabel, pickGamepad, radialDeadzone, readPad, type GamepadLike } from "@hermes/shared";

/** Un Xbox Wireless Controller en reposo (mapping standard: 17 botones, 4 ejes). */
function xbox(over: { axes?: number[]; pressed?: number[]; values?: Record<number, number> } = {}): GamepadLike {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = over.values?.[i] ?? (over.pressed?.includes(i) ? 1 : 0);
    return { pressed: over.pressed?.includes(i) ?? false, value };
  });
  return {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)",
    mapping: "standard",
    connected: true,
    axes: over.axes ?? [0.04, -0.06, 0.05, 0.03],
    buttons,
  };
}

describe("gamepad: sticks", () => {
  it("la deriva del stick en reposo no mueve nada", () => {
    const s = readPad(xbox());
    assert.deepEqual(s.move, { x: 0, y: 0 });
    assert.deepEqual(s.look, { x: 0, y: 0 });
  });

  it("zona muerta radial re-escalada: arranca en 0 y llega a 1 sin salto", () => {
    assert.deepEqual(radialDeadzone(STICK_DEADZONE * 0.99, 0), { x: 0, y: 0 });
    const just = radialDeadzone(STICK_DEADZONE + 0.01, 0);
    assert.ok(just.x > 0 && just.x < 0.05, String(just.x));
    const full = radialDeadzone(0, -1);
    assert.ok(Math.abs(full.y + 1) < 1e-9);
    const diag = radialDeadzone(0.9, 0.9);
    assert.ok(Math.hypot(diag.x, diag.y) <= 1 + 1e-9);
  });

  it("stick izquierdo arriba = adelante (y negativa), derecho a la derecha", () => {
    const s = readPad(xbox({ axes: [0, -1, 1, 0] }));
    assert.ok(s.move.y < -0.99);
    assert.ok(s.look.x > 0.99);
  });
});

describe("gamepad: botones", () => {
  it("nombra los botones del mapeo estándar", () => {
    const s = readPad(xbox({ pressed: [0, 3, 8, 9, 12, 15] }));
    assert.deepEqual([...s.held].sort(), ["A", "MENU", "RIGHT", "UP", "VIEW", "Y"]);
  });

  it("los gatillos cuentan desde TRIGGER_ON y exponen su valor analógico", () => {
    const soft = readPad(xbox({ values: { 7: 0.2 } }));
    assert.equal(soft.held.has("RT"), false);
    assert.equal(soft.rt, 0.2);
    const hard = readPad(xbox({ values: { 7: 0.8 } }));
    assert.equal(hard.held.has("RT"), true);
  });

  it("una pulsación se reporta una sola vez mientras siga apretada", () => {
    const e = new PadEdges();
    assert.deepEqual(e.update(readPad(xbox({ pressed: [0] }))), ["A"]);
    assert.deepEqual(e.update(readPad(xbox({ pressed: [0] }))), []);
    assert.deepEqual(e.update(readPad(xbox())), []);
    assert.deepEqual(e.update(readPad(xbox({ pressed: [0, 1] }))), ["A", "B"]);
    assert.deepEqual(e.update(null), []);
  });
});

describe("gamepad: identidad", () => {
  it("padLabel limpia lo que agrega Chrome y Firefox", () => {
    assert.equal(padLabel("Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)"), "Xbox Wireless Controller");
    assert.equal(padLabel("045e-02fd-Xbox Wireless Controller"), "Xbox Wireless Controller");
    assert.equal(padLabel(""), "Control");
  });

  it("pickGamepad prefiere el conectado con mapeo estándar", () => {
    const other = { ...xbox(), id: "Otro", mapping: "" };
    assert.equal(pickGamepad([null, other, xbox()])?.mapping, "standard");
    assert.equal(pickGamepad([null, { ...xbox(), connected: false }]), null);
  });
});
