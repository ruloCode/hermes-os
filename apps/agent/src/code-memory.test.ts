import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cbmProject, searchTerms, topPackage } from "./code-memory.js";

/**
 * Lógica pura del proveedor de memoria de código. Son contratos, no fotos de
 * la salida actual: el slug tiene que coincidir con el que inventa el binario
 * (si divergen, cada consulta indexaría el repo de nuevo sin decirlo) y los
 * términos de búsqueda tienen que dejar fuera las palabras vacías (una
 * pregunta en español entera devuelve ruido: medido contra el repo real).
 */

describe("cbmProject", () => {
  it("deriva el slug que usa cbm: ruta sin barra inicial y guiones", () => {
    assert.equal(cbmProject("/Users/rulocode/dev/side/hermes-os"), "Users-rulocode-dev-side-hermes-os");
    assert.equal(cbmProject("/Users/rulocode/dev/video-edit"), "Users-rulocode-dev-video-edit");
  });

  it("colapsa espacios y puntos (rutas con nombre de carpeta humano)", () => {
    assert.equal(
      cbmProject("/Users/rulocode/Documents/Claude/Projects/Rulo Code/teker-app"),
      "Users-rulocode-Documents-Claude-Projects-Rulo-Code-teker-app",
    );
  });

  it("no deja guiones colgando cuando la ruta termina en separador", () => {
    assert.equal(cbmProject("/Users/rulocode/dev/side/zylen-web/"), "Users-rulocode-dev-side-zylen-web");
  });

  it("es estable: el mismo repo siempre da el mismo slug", () => {
    const r = "/Users/rulocode/dev/working/careways";
    assert.equal(cbmProject(r), cbmProject(r));
  });
});

describe("searchTerms", () => {
  it("saca las palabras vacías de una pregunta en español", () => {
    const t = searchTerms("¿cómo se detecta el doble aplauso de las luces?");
    assert.ok(t.includes("aplauso"), "el término con contenido sobrevive");
    assert.ok(!t.some((x) => ["cómo", "que", "las", "del"].includes(x.toLowerCase())));
  });

  it("preserva identificadores tal cual (el case importa para el código)", () => {
    assert.deepEqual(searchTerms("explica createClapDetector"), ["explica", "createClapDetector"]);
    assert.ok(searchTerms("dónde está update_profile").includes("update_profile"));
  });

  it("no repite términos ni pasa del tope", () => {
    const t = searchTerms("luces luces LUCES lights lights", 8);
    assert.deepEqual(t, ["luces", "lights"]);
    assert.ok(searchTerms("uno dos tres cuatro cinco seis siete ocho nueve diez", 3).length <= 3);
  });

  it("devuelve vacío cuando todo eran palabras vacías", () => {
    assert.deepEqual(searchTerms("¿qué es lo que hay que hacer?"), []);
  });
});

describe("topPackage", () => {
  it("abre apps/ y packages/ un nivel (el monorepo vive ahí)", () => {
    assert.equal(topPackage("apps/agent/src/index.ts"), "apps/agent");
    assert.equal(topPackage("apps/web/src/components/CodeGraph3D.tsx"), "apps/web");
    assert.equal(topPackage("packages/shared/src/types.ts"), "packages/shared");
  });

  it("para el resto basta la carpeta raíz", () => {
    assert.equal(topPackage("mobile/src/screens/SettingsScreen.tsx"), "mobile");
    assert.equal(topPackage("supabase/migrations/001_init.sql"), "supabase");
  });

  it("los archivos sueltos del repo son 'raíz', no un paquete inventado", () => {
    assert.equal(topPackage("CLAUDE.md"), "raíz");
    assert.equal(topPackage(null), "raíz");
    assert.equal(topPackage(undefined), "raíz");
  });
});
