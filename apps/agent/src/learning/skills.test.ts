import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Los estándares de autoría se prueban como CONTRATO: una skill que los
 * incumple no debe llegar al disco. No son cosméticos — una description
 * larga se trunca en el índice del system prompt y la skill nunca se activa.
 */

let dir: string;
let skills: typeof import("./skills.js");

const BODY = `## Cuándo usarla
Cuando toque publicar una pieza del Estudio de punta a punta.

## Procedimiento
1. Verifica que el guion esté aprobado.
2. Revisa que existan tomas con veredicto bueno.
3. Lanza el run de edición.

## Verificación
El master existe en exports/ y la pieza quedó en estado programado.`;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-skills-"));
  process.env.HERMES_PLUGIN_PATH = join(dir, "plugin");
  skills = await import("./skills.js");
  await skills.ensurePlugin();
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const s of await skills.listSkills()) await skills.deleteSkill(s.name);
});

describe("crear skills", () => {
  it("guarda una skill válida y la devuelve en la lista", async () => {
    const r = await skills.createSkill({ name: "publicar-pieza", description: "Publicar una pieza del Estudio.", body: BODY });
    assert.equal(r.ok, true, r.message);
    const list = await skills.listSkills();
    assert.equal(list.length, 1);
    assert.equal(list[0].name, "publicar-pieza");
    assert.equal(list[0].createdBy, "agent");
  });

  it("el cuerpo sobrevive el viaje a disco sin mutar", async () => {
    await skills.createSkill({ name: "ida-y-vuelta", description: "Prueba de ida y vuelta.", body: BODY });
    const doc = await skills.getSkill("ida-y-vuelta");
    assert.equal(doc?.body, BODY);
  });

  it("no deja crear dos veces la misma", async () => {
    await skills.createSkill({ name: "repetida", description: "Primera versión.", body: BODY });
    const dup = await skills.createSkill({ name: "repetida", description: "Segunda versión.", body: BODY });
    assert.equal(dup.ok, false);
    assert.match(dup.message, /patch/);
  });
});

describe("estándares de autoría", () => {
  const malos: [string, Parameters<typeof skills.createSkill>[0], RegExp][] = [
    ["nombre con mayúsculas y espacios", { name: "Publicar Pieza", description: "Algo.", body: BODY }, /Nombre inválido/],
    ["description vacía", { name: "sin-desc", description: "", body: BODY }, /Falta description/],
    ["description que se pasa del tope", { name: "desc-larga", description: "x".repeat(130), body: BODY }, /trunca/],
    ["adjetivos de marketing", { name: "marketing", description: "Una herramienta potente para todo.", body: BODY }, /marketing/],
    ["cuerpo demasiado corto", { name: "corta", description: "Muy corta.", body: "hola" }, /demasiado corto/],
    ["sin Cuándo usarla", { name: "sin-cuando", description: "Sin la sección.", body: "## Procedimiento\n1. paso\n\n## Verificación\nlisto, y esto es suficientemente largo para pasar el mínimo." }, /Cuándo usarla/],
    ["sin Verificación", { name: "sin-verif", description: "Sin verificación.", body: "## Cuándo usarla\nsiempre\n\n## Procedimiento\n1. paso, y esto es suficientemente largo para pasar el mínimo de caracteres." }, /Verificación/],
  ];

  for (const [caso, input, expected] of malos) {
    it(`rechaza: ${caso}`, async () => {
      const r = await skills.createSkill(input);
      assert.equal(r.ok, false);
      assert.match(r.message, expected);
      assert.equal((await skills.listSkills()).length, 0, "no debe escribir nada al disco");
    });
  }

  it("acepta una description justo en el límite", async () => {
    const desc = `${"a".repeat(skills.DESCRIPTION_MAX - 1)}.`;
    const r = await skills.createSkill({ name: "al-limite", description: desc, body: BODY });
    assert.equal(r.ok, true, r.message);
  });
});

describe("patch", () => {
  it("reemplaza el fragmento y sube la versión", async () => {
    await skills.createSkill({ name: "mejorable", description: "Se puede mejorar.", body: BODY });
    const before = await skills.getSkill("mejorable");
    const r = await skills.patchSkill({ name: "mejorable", find: "3. Lanza el run de edición.", replace: "3. Lanza el run de edición y espera el master." });
    assert.equal(r.ok, true, r.message);
    const after = await skills.getSkill("mejorable");
    assert.match(after!.body, /espera el master/);
    assert.notEqual(after!.version, before!.version);
  });

  it("sin coincidencia no escribe nada", async () => {
    await skills.createSkill({ name: "intacta", description: "No debe cambiar.", body: BODY });
    const r = await skills.patchSkill({ name: "intacta", find: "texto que no existe", replace: "otra cosa" });
    assert.equal(r.ok, false);
    assert.equal((await skills.getSkill("intacta"))!.body, BODY);
  });

  it("rechaza un patch que dejaría la skill inválida", async () => {
    await skills.createSkill({ name: "protegida", description: "No se puede romper.", body: BODY });
    const r = await skills.patchSkill({ name: "protegida", find: "## Verificación", replace: "## Otra cosa" });
    assert.equal(r.ok, false);
    assert.match(r.message, /inválida/);
    assert.match((await skills.getSkill("protegida"))!.body, /## Verificación/);
  });
});

describe("archivar", () => {
  it("archivar la saca de la lista pero se puede restaurar", async () => {
    await skills.createSkill({ name: "vieja", description: "Ya no se usa.", body: BODY });
    const r = await skills.archiveSkill("vieja");
    assert.equal(r.ok, true, r.message);
    assert.equal((await skills.listSkills()).length, 0);
    const archivedDir = r.message.match(/\.archive\/([^\s)]+)/)?.[1];
    assert.ok(archivedDir, "el mensaje debe decir dónde quedó");
    const back = await skills.restoreSkill(archivedDir!);
    assert.equal(back.ok, true, back.message);
    const doc = await skills.getSkill("vieja");
    assert.equal(doc?.body, BODY, "vuelve idéntica");
  });
});
