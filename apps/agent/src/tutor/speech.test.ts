/** Modo voz: lo que se dice en voz alta (sin rutas ni markdown) y el corte en frases del stream. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SentenceSplitter, speakableText } from "@hermes/shared";

describe("speakableText", () => {
  it("calla rutas y código, dice los nombres sueltos", () => {
    assert.equal(
      speakableText("El BFF (`Front/app/api/chat/route.ts:126`) llama a `streamV0` con el token."),
      "El BFF llama a streamV0 con el token.",
    );
  });
  it("quita markdown, viñetas y tablas", () => {
    const t = speakableText("## Panorama\n- **Front**: la UI\n| a | b |\nListo → sigue");
    assert.equal(t, "Panorama Front: la UI Listo a sigue");
  });
});

describe("SentenceSplitter", () => {
  it("entrega cada frase apenas cierra y guarda el resto", () => {
    const s = new SentenceSplitter(5);
    assert.deepEqual(s.push("Déjame revisarlo en el SDK. El agen"), ["Déjame revisarlo en el SDK."]);
    assert.deepEqual(s.push("te guarda en Postgres"), []);
    assert.deepEqual(s.push(". ¿Seguimos?"), ["El agente guarda en Postgres."]);
    assert.deepEqual(s.flush(), ["¿Seguimos?"]);
  });
  it("no corta en un número decimal ni en un nombre de archivo", () => {
    const s = new SentenceSplitter(5);
    assert.deepEqual(s.push("Usa la versión 1.5 de route.ts para todo esto. Fin"), [
      "Usa la versión 1.5 de route.ts para todo esto.",
    ]);
  });
  it("una frase muy corta se junta con la siguiente", () => {
    const s = new SentenceSplitter(24);
    assert.deepEqual(s.push("Sí. El front nunca habla directo con el agente. "), [
      "Sí. El front nunca habla directo con el agente.",
    ]);
  });
});
