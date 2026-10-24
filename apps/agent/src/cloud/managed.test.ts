/**
 * Agentes en la nube creados desde el teléfono: los sitios que puede alcanzar
 * salen como hostnames limpios y su prompt dice qué puede revisar.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cloudHosts, cloudSystem } from "./managed.js";

describe("cloudHosts", () => {
  it("limpia esquema, ruta y puerto y agrega el www del dominio", () => {
    assert.deepEqual(cloudHosts(["https://Rulocode.com/blog?x=1", "careways.co:443"]), [
      "rulocode.com", "www.rulocode.com", "careways.co", "www.careways.co",
    ]);
  });

  it("no agrega www a un subdominio ni repite", () => {
    assert.deepEqual(cloudHosts(["app.careways.co", "app.careways.co/"]), ["app.careways.co"]);
  });

  it("descarta IPs, localhost y nombres de una sola etiqueta", () => {
    assert.deepEqual(cloudHosts(["10.0.0.1", "localhost", "intranet", "mac.local", ""]), []);
  });
});

describe("cloudSystem", () => {
  it("con sitios, los nombra y prohíbe inventar cifras", () => {
    const s = cloudSystem("Cuidador", "Revisa que el sitio responda.", ["careways.co"]);
    assert.match(s, /You are Cuidador/);
    assert.match(s, /Revisa que el sitio responda\./);
    assert.match(s, /careways\.co/);
    assert.match(s, /Never invent a number/);
  });

  it("sin sitios, dice que no tiene internet", () => {
    assert.match(cloudSystem("X", "Algo.", []), /no internet access/);
  });
});
