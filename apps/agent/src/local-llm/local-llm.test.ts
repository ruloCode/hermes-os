import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, splitSse, ToolCallAccumulator, trimHistory } from "./stream.js";

test("splitSse devuelve los eventos completos y guarda el pedazo abierto", () => {
  const { data, rest } = splitSse('data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b"');
  assert.deepEqual(data, ['{"a":1}', "[DONE]"]);
  assert.equal(rest, 'data: {"b"');
  // El resto, completado en el siguiente chunk, sale entero.
  assert.deepEqual(splitSse(`${rest}:2}\n\n`).data, ['{"b":2}']);
});

test("splitSse tolera CRLF y líneas que no son data", () => {
  const { data } = splitSse(": keep-alive\r\n\r\ndata: x\r\n\r\n");
  assert.deepEqual(data, ["x"]);
});

test("las tool calls partidas por index se arman en orden", () => {
  const acc = new ToolCallAccumulator();
  acc.add([{ index: 0, id: "c1", function: { name: "read_file", arguments: '{"pa' } }]);
  acc.add([{ index: 1, id: "c2", function: { name: "list_projects", arguments: "" } }]);
  acc.add([{ index: 0, function: { arguments: 'th":"a.ts"}' } }]);
  assert.deepEqual(acc.calls(), [
    { id: "c1", name: "read_file", arguments: '{"path":"a.ts"}' },
    { id: "c2", name: "list_projects", arguments: "" },
  ]);
});

test("una tool call sin id recibe uno estable y una sin nombre se descarta", () => {
  const acc = new ToolCallAccumulator();
  acc.add([{ index: 0, function: { name: "capture_idea", arguments: "{}" } }]);
  acc.add([{ index: 1, function: { arguments: "{}" } }]);
  assert.deepEqual(acc.calls(), [{ id: "call_0", name: "capture_idea", arguments: "{}" }]);
});

test("parseArgs: JSON roto o no-objeto = sin argumentos", () => {
  assert.deepEqual(parseArgs('{"q":"x"}'), { q: "x" });
  assert.deepEqual(parseArgs('{"q":'), {});
  assert.deepEqual(parseArgs("[1]"), {});
  assert.deepEqual(parseArgs(""), {});
});

test("trimHistory guarda lo más reciente y arranca en un turno del usuario", () => {
  const msgs = [
    { role: "user", content: "a".repeat(50) },
    { role: "assistant", content: "b".repeat(50) },
    { role: "user", content: "c".repeat(10) },
    { role: "assistant", content: "d".repeat(10) },
    { role: "user", content: "último" },
  ];
  const out = trimHistory(msgs, 80);
  // Cabrían "b…" (50) + 3 cortos, pero el historial no puede abrir con el asistente.
  assert.deepEqual(
    out.map((m) => m.content[0]),
    ["c", "d", "ú"],
  );
});

test("trimHistory: el último mensaje entra siempre, recortado si es enorme", () => {
  const out = trimHistory([{ role: "user", content: `inicio${"x".repeat(100)}fin` }], 20);
  assert.equal(out.length, 1);
  assert.equal(out[0].content.length, 20);
  assert.ok(out[0].content.endsWith("fin"));
});

test("trimHistory descarta mensajes vacíos y roles desconocidos", () => {
  const out = trimHistory(
    [
      { role: "system", content: "no" },
      { role: "user", content: "hola" },
      { role: "assistant", content: "  " },
    ],
    100,
  );
  assert.deepEqual(out, [{ role: "user", content: "hola" }]);
});
