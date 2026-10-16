/**
 * Tutor de proyecto y contexto de juntas: contratos de la lógica pura (límite
 * de carpetas del tutor, digest de la nota y limpieza del "Estado Actual").
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { insideAllowed } from "./tutor.js";
import { cleanEstado, noteDigest } from "../meetings/meeting-context.js";

const ws = {
  cwd: "/w/acme",
  repos: [{ name: "Front", root: "/w/acme/Front", graph: "acme" }],
  vaultDir: "/vault/projects/acme",
};

describe("insideAllowed", () => {
  it("deja leer los repos, el cwd y el vault del proyecto (también rutas relativas)", () => {
    assert.equal(insideAllowed("/w/acme/Front/app/page.tsx", ws), true);
    assert.equal(insideAllowed("Front/app/page.tsx", ws), true);
    assert.equal(insideAllowed("/vault/projects/acme/reuniones/x.md", ws), true);
  });
  it("niega todo lo de afuera, incluso con ../ o un prefijo parecido", () => {
    assert.equal(insideAllowed("/Users/x/.ssh/id_rsa", ws), false);
    assert.equal(insideAllowed("../../etc/passwd", ws), false);
    assert.equal(insideAllowed("/w/acme-otro/secreto.ts", ws), false);
    assert.equal(insideAllowed("/vault/projects/otro-cliente/nota.md", ws), false);
  });
});

describe("contexto del proyecto (meeting-context)", () => {
  it("noteDigest corta en Estado Actual y quita callouts y frontmatter", () => {
    const raw = `---\nestado: activo\n---\n# P\n\n## Objetivo\nChat industrial.\n> [!note] bitácora\n> ruido\n\n## 📊 Estado Actual\nno va`;
    const d = noteDigest(raw);
    assert.match(d, /Chat industrial/);
    assert.doesNotMatch(d, /bitácora|ruido|no va|estado: activo/);
  });
  it("cleanEstado quita la sintaxis de callouts y conserva el texto", () => {
    const e = cleanEstado("> [!note] Hermes · 2026-07-07\n> > Rama creada y subida.\n> Ruta corregida.");
    assert.equal(e, "Rama creada y subida.\nRuta corregida.");
  });
});
