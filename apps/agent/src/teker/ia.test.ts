/**
 * TeKer IA: lo que parece dato de un paciente no sale de la Mac, y el texto del
 * stream SSE se junta entero.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { patientDataIn, sseContent } from "./ia.js";

describe("patientDataIn", () => {
  it("detecta correo, celular y documento", () => {
    assert.equal(patientDataIn("citas de ana@gmail.com"), "un correo");
    assert.equal(patientDataIn("el paciente del 310 555 1234"), "un teléfono");
    assert.equal(patientDataIn("cédula 1.020.345.678"), "un número de documento");
    assert.equal(patientDataIn("historia de 1020345678"), "un número de documento");
  });

  it("deja pasar preguntas de cifras con años, fechas y conteos", () => {
    assert.equal(patientDataIn("¿Cuántas citas se cancelaron esta semana en Emssanar?"), null);
    assert.equal(patientDataIn("inasistencias de octubre 2026, más de 95 citas"), null);
    assert.equal(patientDataIn("agendadas el 2026-10-24 y el 24/10/2026"), null);
  });
});

describe("sseContent", () => {
  it("concatena los deltas y para en [DONE]", () => {
    const raw = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}',
      'data: {"choices":[{"delta":{"content":"**Citas** "}}]}',
      "",
      'data: {"choices":[{"delta":{"content":"95."}}]}',
      ": comentario",
      "data: [DONE]",
    ].join("\n");
    assert.equal(sseContent(raw), "**Citas** 95.");
  });

  it("acepta una respuesta sin streaming en una sola línea data", () => {
    assert.equal(sseContent('data: {"choices":[{"message":{"content":"hola"}}]}'), "hola");
  });

  it("ignora líneas partidas", () => {
    assert.equal(sseContent('data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"choi'), "a");
  });
});

describe("chat de TeKer IA en Equipo", () => {
  it("desarrollo solo si se pide con todas las letras", async () => {
    const { wantsDev } = await import("./chat.js");
    assert.equal(wantsDev("¿cuántas citas hay en teker_ia_dev?"), true);
    assert.equal(wantsDev("dev: citas de ayer"), true);
    assert.equal(wantsDev("¿cuántas citas se agendaron ayer en desarrollo de software?"), false);
  });

  it("el contexto lleva solo los turnos que salieron bien", async () => {
    const { historyOf } = await import("./chat.js");
    const at = "2026-10-25T00:00:00Z";
    const h = historyOf([
      { id: "1", role: "user", text: "citas ayer", at },
      { id: "2", role: "agent", text: "95", at },
      { id: "3", role: "user", text: "¿y hoy?", at },
      { id: "4", role: "agent", text: "TeKer IA no respondió", at, failed: true },
    ]);
    assert.deepEqual(h, [
      { role: "user", content: "citas ayer" },
      { role: "assistant", content: "95" },
    ]);
  });
});
