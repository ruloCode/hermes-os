import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  activeNotices,
  describeNotice,
  EstacionConfigError,
  noticesForLines,
  parseMetroStatus,
  parsePlaces,
  placesNear,
  stationsWithPlaces,
} from "@hermes/shared";

/**
 * Los datos que el humano escribe a mano para el Tótem de estación
 * (novedades del servicio y lugares cerca de una estación). Lo que se prueba
 * es lo que evita mentir en pantalla: un archivo roto se rechaza con el
 * motivo, una novedad vencida no se muestra, y un lugar sin horario
 * publicado queda con horario nulo en vez de inventado.
 */

describe("parseMetroStatus", () => {
  it("acepta lista suelta o { notices } y completa severidad y campos opcionales", () => {
    const one = parseMetroStatus([{ line: "A", text: "Frecuencia reducida", delayMin: 8 }]);
    assert.deepEqual(one, [
      { line: "A", text: "Frecuencia reducida", severity: "demora", delayMin: 8, until: null, since: null, source: null },
    ]);
    const wrapped = parseMetroStatus({ notices: [{ text: "Horario extendido", source: "Cuenta oficial" }] });
    assert.equal(wrapped[0].severity, "info", "sin minutos de demora, es informativa");
    assert.equal(wrapped[0].line, "", "sin línea = todo el sistema");
    assert.equal(wrapped[0].delayMin, null);
    assert.deepEqual(parseMetroStatus({}), [], "sin la clave notices, no hay novedades");
  });

  it("rechaza un archivo roto con el motivo (nada de tragárselo en silencio)", () => {
    assert.throws(() => parseMetroStatus({ notices: {} }), EstacionConfigError);
    assert.throws(() => parseMetroStatus([{ text: "" }]), /text: texto vacío/);
    assert.throws(() => parseMetroStatus([{ text: "x", until: "mañana" }]), /fecha inválida/);
    assert.throws(() => parseMetroStatus([{ text: "x", severity: "grave" }]), /info\|demora\|suspension/);
    assert.throws(() => parseMetroStatus([{ text: "x", delayMin: -4 }]), /minutos fuera de rango/);
  });

  it("normaliza la fecha con espacio a ISO", () => {
    assert.equal(parseMetroStatus([{ text: "x", until: "2026-09-18 20:00" }])[0].until, "2026-09-18T20:00");
  });
});

describe("activeNotices", () => {
  const notices = parseMetroStatus([
    { text: "Vigente todo el día", until: "2026-09-18" },
    { text: "Ya terminó", until: "2026-09-18T06:00" },
    { text: "Empieza en la tarde", since: "2026-09-18T18:00" },
    { text: "Sin caducidad" },
  ]);

  it("una novedad con `until` a nivel de día vale hasta el final de ese día", () => {
    const now = activeNotices(notices, "2026-09-18T14:30").map((n) => n.text);
    assert.deepEqual(now, ["Vigente todo el día", "Sin caducidad"]);
  });

  it("respeta since y until con hora", () => {
    assert.deepEqual(
      activeNotices(notices, "2026-09-18T19:00").map((n) => n.text),
      ["Vigente todo el día", "Empieza en la tarde", "Sin caducidad"],
    );
    assert.deepEqual(
      activeNotices(notices, "2026-09-19T09:00").map((n) => n.text),
      ["Empieza en la tarde", "Sin caducidad"],
      "el día siguiente ya venció la primera",
    );
  });

  it("filtra por línea del plan y describe la novedad para la voz", () => {
    const list = parseMetroStatus([
      { line: "A", text: "Demora", delayMin: 8 },
      { line: "B", text: "Otra cosa" },
      { text: "Para todo el sistema" },
    ]);
    assert.deepEqual(noticesForLines(list, ["A", "K"]).map((n) => n.text), ["Demora", "Para todo el sistema"]);
    assert.equal(describeNotice(list[0]), "Línea A: Demora (unos 8 minutos de demora)");
    assert.equal(describeNotice(list[2]), "Para todo el sistema");
  });
});

describe("parsePlaces / placesNear", () => {
  const places = parsePlaces({
    places: [
      { name: "Museo", station: "Parque Berrío", walkMinutes: 4, hours: "Lun-sáb 9:40-17:30", source: "sitio oficial" },
      { name: "Plaza", station: "parque berrio", walk_minutes: 2 },
      { name: "Cancha", station: "Acevedo", minutos: 22, nota: "en el barrio de al lado" },
    ],
  });

  it("acepta los nombres de campo en español y deja en null lo que no se publicó", () => {
    assert.equal(places[1].hours, null, "sin horario publicado, horario nulo");
    assert.equal(places[1].source, null);
    assert.equal(places[1].walkMinutes, 2);
    assert.equal(places[2].note, "en el barrio de al lado");
  });

  it("agrupa por estación sin importar tildes ni mayúsculas, ordenando por cercanía", () => {
    assert.deepEqual(placesNear(places, "Parque Berrio").map((p) => p.name), ["Plaza", "Museo"]);
    assert.deepEqual(placesNear(places, "Estación Parque Berrío").map((p) => p.name), [], "el prefijo 'estación' lo resuelve el GTFS, no este filtro");
    assert.deepEqual(placesNear(places, "ACEVEDO").map((p) => p.name), ["Cancha"]);
    assert.deepEqual(placesNear(places, "Poblado"), []);
    // Los nombres se listan tal como se escribieron (dos grafías del mismo
    // nombre siguen siendo dos entradas: el archivo es del humano).
    assert.deepEqual(new Set(stationsWithPlaces(places)), new Set(["Acevedo", "Parque Berrío", "parque berrio"]));
  });

  it("rechaza lugares sin minutos a pie o sin nombre", () => {
    assert.throws(() => parsePlaces([{ name: "x", station: "y" }]), /walkMinutes/);
    assert.throws(() => parsePlaces([{ station: "y", walkMinutes: 1 }]), /name: texto vacío/);
    assert.throws(() => parsePlaces([{ name: "x", station: "y", walkMinutes: 999 }]), /walkMinutes/);
    assert.deepEqual(parsePlaces({}), []);
  });
});
