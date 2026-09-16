import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * El perfil se prueba contra un archivo REAL en un directorio temporal, no
 * contra un mock del filesystem: lo que queremos verificar es justamente el
 * comportamiento en disco (escritura atómica, cache por mtime, topes).
 * HERMES_PROFILE_PATH se fija ANTES de importar el módulo.
 */

let dir: string;
let profile: typeof import("./profile.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-profile-"));
  process.env.HERMES_PROFILE_PATH = join(dir, "USER.md");
  profile = await import("./profile.js");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  for (const e of await profile.profileEntries()) await profile.removeProfileEntry(e);
});

describe("perfil: escritura", () => {
  it("guarda y lee una entrada", async () => {
    const r = await profile.addProfileEntry("Trabaja en Bogotá, timezone America/Bogota");
    assert.equal(r.ok, true);
    assert.deepEqual(await profile.profileEntries(), ["Trabaja en Bogotá, timezone America/Bogota"]);
  });

  it("normaliza el guion de lista y los espacios de más", async () => {
    await profile.addProfileEntry("-   Prefiere   pnpm  ");
    assert.deepEqual(await profile.profileEntries(), ["Prefiere pnpm"]);
  });

  it("el bloque del prompt solo existe si hay entradas", async () => {
    assert.equal(await profile.profilePromptBlock(), "");
    await profile.addProfileEntry("Prefiere respuestas concisas");
    assert.match(await profile.profilePromptBlock(), /Prefiere respuestas concisas/);
  });
});

describe("perfil: no duplicar", () => {
  it("rechaza una entrada casi igual y dice qué hacer", async () => {
    await profile.addProfileEntry("Prefiere pnpm sobre npm");
    const dup = await profile.addProfileEntry("Prefiere pnpm siempre");
    assert.equal(dup.ok, false);
    assert.match(dup.message, /replace/);
    assert.equal((await profile.profileEntries()).length, 1);
  });

  it("ignora acentos y mayúsculas al comparar", async () => {
    await profile.addProfileEntry("Codigo en espanol");
    const dup = await profile.addProfileEntry("CÓDIGO EN ESPAÑOL, siempre");
    assert.equal(dup.ok, false);
  });

  it("replace sí actualiza en sitio, sin crecer", async () => {
    await profile.addProfileEntry("Usa Linear para tareas");
    const r = await profile.replaceProfileEntry("Linear", "Usa Linear y el vault para tareas");
    assert.equal(r.ok, true);
    assert.deepEqual(await profile.profileEntries(), ["Usa Linear y el vault para tareas"]);
  });

  it("replace sobre algo inexistente no escribe nada", async () => {
    await profile.addProfileEntry("Una entrada");
    const r = await profile.replaceProfileEntry("no existe", "otra cosa");
    assert.equal(r.ok, false);
    assert.deepEqual(await profile.profileEntries(), ["Una entrada"]);
  });
});

/** Vocabulario sin parecidos: el tope se prueba con entradas genuinamente distintas. */
const VOCAB = ["alfa", "bravo", "charlie", "delta", "eco", "foxtrot", "golf", "hotel", "india", "julieta"];

describe("perfil: el tope es la feature", () => {
  it("falla al pasarse en vez de truncar o auto-compactar", async () => {
    // Llenamos hasta el borde con entradas distintas entre sí.
    let i = 0;
    for (;;) {
      const r = await profile.addProfileEntry(`${VOCAB[i % VOCAB.length]}${i} ${VOCAB[(i * 7) % VOCAB.length]}${i} ${VOCAB[(i * 13) % VOCAB.length]}${i}`);
      if (!r.ok) {
        assert.match(r.message, /NO se guardó/);
        assert.match(r.message, new RegExp(String(profile.PROFILE_MAX_CHARS)));
        break;
      }
      i += 1;
      assert.ok(i < 100, "debería haberse llenado mucho antes");
    }
    const used = (await profile.profileEntries()).reduce((n, e) => n + e.length + 3, 0);
    assert.ok(used <= profile.PROFILE_MAX_CHARS, "nunca se pasa del tope");
  });

  it("avisa al 80% para que el agente consolide antes de chocar", async () => {
    const relleno = "x".repeat(180);
    let warned = false;
    for (let i = 0; i < 20; i += 1) {
      const r = await profile.addProfileEntry(`palabra${i}unica ${relleno}${i}`);
      if (!r.ok) break;
      if (/capacidad/.test(r.message)) warned = true;
    }
    assert.equal(warned, true, "debe advertir antes de llenarse");
  });

  it("tras liberar espacio, vuelve a aceptar", async () => {
    const relleno = "y".repeat(200);
    const metidas: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const e = `token${i}propio ${relleno}${i}`;
      const r = await profile.addProfileEntry(e);
      if (!r.ok) break;
      metidas.push(e);
    }
    await profile.removeProfileEntry(metidas[0]);
    const r = await profile.addProfileEntry(`irrepetible ${relleno}999`);
    assert.equal(r.ok, true, "con espacio libre debe entrar");
  });
});
