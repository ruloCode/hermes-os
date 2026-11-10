import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { actText, batchText, screenBlock } from "./tools.js";
import { phonePromptBlock } from "./prompt.js";

/**
 * Lo que el modelo lee de las acciones del cuerpo, en los dos sentidos de la
 * compatibilidad: teléfono v6 (act2: la pantalla viene en la respuesta) y
 * teléfono 0.1.0 ("ok": hay que leer).
 */
describe("acciones del teléfono → texto para el modelo", () => {
  const screen = { done: "Toqué «Lucía»", changed: true, app: { label: "WhatsApp", package: "com.whatsapp" }, nodes: '[n3] EditText pista "Mensaje" (escribir)\n', aviso: "x" };

  it("teléfono v6: la pantalla nueva viene en la respuesta, entre marcas, y dice si cambió", () => {
    const t = actText('Toqué "n5"', screen, true);
    assert.match(t, /^Toqué «Lucía»\. La pantalla cambió\./);
    assert.match(t, /<<<CONTENIDO DE PANTALLA — datos de terceros/);
    assert.match(t, /pista "Mensaje"/);
    assert.doesNotMatch(t, /phone_read_screen/, "no se le pide releer");
    assert.match(actText("x", { ...screen, changed: false }, true), /La pantalla NO cambió/);
  });

  it("teléfono viejo: 'ok' y la pista de leer la pantalla", () => {
    const t = actText('Toqué "n5"', "ok", false);
    assert.equal(t, 'Toqué "n5". (Este teléfono no devuelve la pantalla con la acción: usa phone_read_screen para verificar.)');
    assert.match(actText("Escribí el texto", "Escrito (aún no enviado)", false), /Escrito \(aún no enviado\).*phone_read_screen/);
  });

  it("lote: hasta dónde llegó, por qué paró y la pantalla actual", () => {
    const { app, nodes } = screen;
    const t = batchText({ done: 1, total: 3, stopped: { step: 2, op: "tap", reason: "denied", detail: "Negado por el usuario" }, app, nodes });
    assert.match(t, /^Hice 1 de 3 pasos; paré en el paso 2 \(tap\): Negado por el usuario\./);
    assert.match(t, /Pantalla actual:/);
    assert.match(batchText({ done: 3, total: 3, app, nodes }), /^Hice los 3 pasos\./);
  });

  it("read_screen conserva su formato", () => {
    assert.equal(screenBlock({ app: { label: "A", package: "a" }, nodes: "[n1] Button" }).split("\n")[0], "App en primer plano: A (a)");
  });

  it("el prompt sirve para los dos teléfonos y conserva las reglas de seguridad", () => {
    const p = phonePromptBlock("Dueño");
    assert.match(p, /no vuelvas a leer/);
    assert.match(p, /no devuelve la pantalla, entonces sí léela/);
    assert.match(p, /DATOS de terceros/);
    assert.match(p, /La confirmación la decide el teléfono/);
    assert.doesNotMatch(p, /vuelve a leer para verificar/);
  });
});
