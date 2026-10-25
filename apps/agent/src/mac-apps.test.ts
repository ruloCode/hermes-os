import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanAppQuery, isStrongMatch, matchApp, type MacApp } from "./mac-apps.js";
import { parseVolume } from "./mac.js";

/**
 * "Abre X en la Mac" llega dicho por voz (desde el teléfono o las gafas):
 * con artículos, con "en el computador" pegado y con nombres en español de
 * las apps del sistema. El contrato: se abre la app correcta o NINGUNA.
 */

const app = (name: string, dir = "/Applications"): MacApp => ({ name, path: `${dir}/${name}.app` });

const CATALOG: MacApp[] = [
  app("Spotify"),
  app("Google Chrome"),
  app("Brave Browser"),
  app("WhatsApp"),
  app("Microsoft Teams"),
  app("Microsoft Word"),
  app("zoom.us"),
  app("Cursor"),
  app("Calculator", "/System/Applications"),
  app("System Settings", "/System/Applications"),
  app("Music", "/System/Applications"),
  app("Notes", "/System/Applications"),
  app("App Store", "/System/Applications"),
  app("Activity Monitor", "/System/Applications/Utilities"),
  app("Terminal", "/System/Applications/Utilities"),
];

const name = (q: string) => matchApp(q, CATALOG)?.app.name ?? null;

describe("mac: limpiar lo dicho", () => {
  it("quita verbo, artículos y el 'en la mac' del final", () => {
    assert.equal(cleanAppQuery("Abre el Spotify en la Mac"), "spotify");
    assert.equal(cleanAppQuery("abre la app de WhatsApp en el computador"), "whatsapp");
    assert.equal(cleanAppQuery("la calculadora en el PC"), "calculadora");
  });

  it("no se come 'app' cuando es parte del nombre", () => {
    assert.equal(cleanAppQuery("abre la app store"), "app store");
  });
});

describe("mac: elegir la app", () => {
  it("nombre exacto, sin importar mayúsculas ni tildes", () => {
    assert.equal(name("spotify"), "Spotify");
    assert.equal(name("WHATSAPP"), "WhatsApp");
  });

  it("una palabra del nombre basta (chrome ⊂ Google Chrome, teams ⊂ Microsoft Teams)", () => {
    assert.equal(name("chrome"), "Google Chrome");
    assert.equal(name("teams"), "Microsoft Teams");
    assert.equal(name("zoom"), "zoom.us");
  });

  it("los nombres en español de las apps del sistema", () => {
    assert.equal(name("la calculadora"), "Calculator");
    assert.equal(name("ajustes"), "System Settings");
    assert.equal(name("configuración"), "System Settings");
    assert.equal(name("música"), "Music");
    assert.equal(name("monitor de actividad"), "Activity Monitor");
  });

  it("un prefijo de 3+ letras sirve, pero es match débil", () => {
    const m = matchApp("spoti", CATALOG);
    assert.equal(m?.app.name, "Spotify");
    assert.equal(isStrongMatch(m!), false);
    assert.equal(isStrongMatch(matchApp("spotify", CATALOG)!), true);
    assert.equal(matchApp("sp", CATALOG), null);
  });

  it("lo que no está instalado no se parece a nada: null, no una app cualquiera", () => {
    assert.equal(name("linkedin"), null);
    assert.equal(name("photoshop"), null);
    assert.equal(name(""), null);
  });

  it("'microsoft' solo es ambiguo y gana el nombre más corto, de forma estable", () => {
    assert.equal(name("microsoft"), "Microsoft Word");
  });
});

describe("mac: volumen de Spotify", () => {
  it("número, acotado a 0-100", () => {
    assert.equal(parseVolume("40", 70), 40);
    assert.equal(parseVolume("150", 70), 100);
  });

  it("sube y baja de a 15 sin salirse del rango", () => {
    assert.equal(parseVolume("sube", 70), 85);
    assert.equal(parseVolume("baja", 10), 0);
    assert.equal(parseVolume("más", 95), 100);
  });

  it("lo que no se entiende es null (la voz dice que no entendió)", () => {
    assert.equal(parseVolume("fuerte", 50), null);
    assert.equal(parseVolume(undefined, 50), null);
  });
});
