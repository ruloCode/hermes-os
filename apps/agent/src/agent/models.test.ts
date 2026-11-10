import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { FEATURES, TIER_MODELS, catalogView, featureEnvKey, knownModels, modelFor, tierModel, tierOf, type Feature } from "./models.js";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

test("sin variables, cada función recibe el modelo de su nivel", () => {
  for (const feature of Object.keys(FEATURES) as Feature[]) {
    const got = modelFor(feature, {});
    assert.equal(got.model, TIER_MODELS[FEATURES[feature].tier].id, feature);
    assert.equal(got.source, "catalog");
  }
});

test("el chat va al nivel equilibrado y no al modelo por defecto del CLI", () => {
  assert.equal(modelFor("chat", {}).model, TIER_MODELS.balanced.id);
});

test("la variable heredada de la función gana sobre el catálogo", () => {
  const got = modelFor("gym.analyze", { HERMES_GYM_MODEL: "opus" });
  assert.equal(got.model, "opus");
  assert.equal(got.source, "env");
});

test("HERMES_MODEL sigue moviendo chat y tareas, y nada más", () => {
  const env = { HERMES_MODEL: "claude-fable-5-2" };
  assert.equal(modelFor("chat", env).model, "claude-fable-5-2");
  assert.equal(modelFor("task", env).model, "claude-fable-5-2");
  assert.equal(modelFor("copilot.fast", env).model, TIER_MODELS.fast.id);
});

test("HERMES_MODEL_<FUNCION> cambia una función sin variable heredada", () => {
  assert.equal(featureEnvKey("meetings.prep"), "MEETINGS_PREP");
  assert.equal(modelFor("meetings.prep", { HERMES_MODEL_MEETINGS_PREP: "haiku" }).model, "haiku");
});

test("la variable heredada gana sobre HERMES_MODEL_<FUNCION>", () => {
  const got = modelFor("copilot.fast", { HERMES_COPILOT_MODEL: "sonnet", HERMES_MODEL_COPILOT_FAST: "opus" });
  assert.equal(got.model, "sonnet");
});

test("cambiar un nivel mueve todas sus funciones sin variable propia", () => {
  const env = { HERMES_MODEL_TIER_BALANCED: "claude-opus-5-5", HERMES_GYM_MODEL: "haiku" };
  assert.equal(tierModel("balanced", env), "claude-opus-5-5");
  assert.equal(modelFor("chat", env).model, "claude-opus-5-5");
  assert.equal(modelFor("tutor", env).model, "claude-opus-5-5");
  assert.equal(modelFor("gym.analyze", env).model, "haiku");
  assert.equal(modelFor("copilot.fast", env).model, TIER_MODELS.fast.id);
});

test("una variable vacía o con espacios no cuenta como elegida", () => {
  assert.equal(modelFor("chat", { HERMES_MODEL: "  " }).source, "catalog");
});

test("el esfuerzo sale del catálogo y HERMES_EFFORT_<FUNCION> lo cambia solo con un valor válido", () => {
  assert.equal(modelFor("meetings.ingest", {}).effort, "medium");
  assert.equal(modelFor("meetings.ingest", { HERMES_EFFORT_MEETINGS_INGEST: "HIGH" }).effort, "high");
  assert.equal(modelFor("meetings.ingest", { HERMES_EFFORT_MEETINGS_INGEST: "turbo" }).effort, "medium");
  assert.equal(modelFor("chat", {}).effort, undefined);
});

test("la capa rápida de juntas no razona: la latencia manda", () => {
  assert.equal(modelFor("copilot.fast", {}).thinking, "off");
});

test("tierOf reconoce ids, alias y modelos anteriores", () => {
  assert.equal(tierOf("claude-haiku-5-5"), "fast");
  assert.equal(tierOf("sonnet"), "balanced");
  assert.equal(tierOf("claude-opus-4-8"), "deep");
  assert.equal(tierOf("claude-fable-5-1"), "frontier");
  assert.equal(tierOf("gpt-x"), null);
});

test("knownModels incluye los cuatro vigentes, los alias y los congelados de tareas viejas", () => {
  const known = knownModels();
  for (const m of Object.values(TIER_MODELS)) assert.ok(known.includes(m.id), m.id);
  assert.ok(known.includes("sonnet"));
  assert.ok(known.includes("claude-haiku-4-5"));
  assert.equal(new Set(known).size, known.length, "sin repetidos");
});

test("catalogView trae una fila por función con su etiqueta", () => {
  const view = catalogView({});
  assert.equal(view.length, Object.keys(FEATURES).length);
  assert.ok(view.every((row) => row.label && row.model));
});

test("ningún id de modelo vive fuera del catálogo", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = relative(SRC, file);
    if (rel === join("agent", "models.ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const [i, line] of text.split("\n").entries()) {
      if (/["'`]claude-(haiku|sonnet|opus|fable|mythos)[a-z0-9-]*["'`]/.test(line)) offenders.push(`${rel}:${i + 1}`);
    }
  }
  assert.deepEqual(offenders, [], "ids de modelo escritos a mano; usa modelFor() o knownModels()");
});
