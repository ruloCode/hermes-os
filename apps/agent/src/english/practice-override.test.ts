import assert from "node:assert/strict";
import { test } from "node:test";
import { activeOverride } from "./store.js";

const NOW = Date.parse("2026-11-06T13:30:00Z");

test("el override manda mientras no vence", () => {
  const raw = JSON.stringify({ context: "MOCK INTERVIEW", until: "2026-11-06T15:00:00Z" });
  assert.equal(activeOverride(raw, NOW), "MOCK INTERVIEW");
});

test("vencido, sin fecha, vacío o roto → vuelve el contexto normal", () => {
  assert.equal(activeOverride(JSON.stringify({ context: "x", until: "2026-11-06T13:00:00Z" }), NOW), null);
  assert.equal(activeOverride(JSON.stringify({ context: "x" }), NOW), null);
  assert.equal(activeOverride(JSON.stringify({ context: "  ", until: "2026-12-01T00:00:00Z" }), NOW), null);
  assert.equal(activeOverride("{no es json", NOW), null);
});
