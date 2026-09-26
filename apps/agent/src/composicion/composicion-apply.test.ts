import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ComposicionValidationError, applyToSong, type Song } from "@hermes/shared";

/**
 * FASE E — aplicar a una canción: puro, sin mutar, con una sola entrada de
 * historial y sin tocar lo que no se aplicó. Canción INVENTADA: el repo es
 * público.
 */

const NOW = "2026-09-24T15:00:00.000Z";

function song(): Song {
  return {
    id: "c1",
    title: "Canción de prueba",
    stage: "letra",
    key: { tonic: 9, mode: "minor" }, // La menor
    tempo: 92,
    meter: "4/4",
    mood: [],
    seed: "una semilla inventada",
    sections: [
      {
        id: "s1",
        kind: "verso",
        label: "Verso 1",
        lyrics: "línea uno\n\nlínea dos",
        chords: ["Am", "F"],
        bars: 4,
      },
      { id: "s2", kind: "coro", label: "Coro", lyrics: "coro viejo", chords: ["C", "G"], bars: 4 },
    ],
    refIds: [],
    versions: [{ id: "v0", at: "2026-09-20T10:00:00.000Z", note: "creada", scope: "estructura" }],
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
  };
}

/** Ids deterministas para las pruebas: sec-1, v-2… */
function ids() {
  let n = 0;
  return (p: string) => `${p}-${++n}`;
}

const link = { sessionId: "toma-1", passageId: "P01", semitones: 0 };

describe("applyToSong", () => {
  it('"debajo": agrega al final de la sección sin tocar su letra ni las otras secciones', () => {
    const before = song();
    const snapshot = structuredClone(before);
    const out = applyToSong(
      before,
      [
        {
          payload: { label: "Verso 1", lines: [" nueva a ", "", "nueva b"], link },
          target: { mode: "debajo", sectionId: "s1" },
        },
      ],
      { note: "Letra del tema", now: NOW, newId: ids() },
    );
    assert.deepEqual(before, snapshot, "no muta la canción original");
    assert.equal(out.sections[0].lyrics, "línea uno\n\nlínea dos\nnueva a\nnueva b");
    assert.deepEqual(out.sections[0].memo, link);
    assert.equal(out.sections[1], before.sections[1], "la otra sección es el MISMO objeto");
    assert.deepEqual(out.sessionIds, ["toma-1"]);
    assert.equal(out.updatedAt, NOW);
  });

  it('"reemplazar": pisa la letra (y la progresión y los compases si vienen)', () => {
    const out = applyToSong(
      song(),
      [
        {
          payload: { label: "Coro", lines: ["coro nuevo", "otra"], chords: ["Dm", "E"], bars: 8 },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      { note: "n", now: NOW, newId: ids() },
    );
    assert.equal(out.sections[1].lyrics, "coro nuevo\notra");
    assert.deepEqual(out.sections[1].chords, ["Dm", "E"]);
    assert.equal(out.sections[1].bars, 8);
    // Sin acordes en el payload, la progresión se conserva.
    const keep = applyToSong(
      song(),
      [
        {
          payload: { label: "Coro", lines: ["x"] },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      {
        note: "n",
        now: NOW,
        newId: ids(),
      },
    );
    assert.deepEqual(keep.sections[1].chords, ["C", "G"]);
    assert.equal(keep.sections[1].bars, 4);
  });

  it('"nueva": crea la sección tras su ancla (o al final) y varias tras la misma ancla quedan en orden', () => {
    const out = applyToSong(
      song(),
      [
        {
          payload: { label: "Pre", kind: "pre", lines: ["a"] },
          target: { mode: "nueva", afterSectionId: "s1" },
        },
        {
          payload: { label: "", kind: "puente", lines: ["b", "c", "d"] },
          target: { mode: "nueva", afterSectionId: "s1" },
        },
        {
          payload: { label: "Final", kind: "final", lines: ["e"], bars: 2 },
          target: { mode: "nueva" },
        },
      ],
      { note: "n", now: NOW, newId: ids() },
    );
    assert.deepEqual(
      out.sections.map((s) => s.id),
      ["s1", "sec-1", "sec-2", "s2", "sec-3"],
    );
    assert.equal(out.sections[1].kind, "pre");
    assert.equal(out.sections[2].label, "Puente", "sin etiqueta, el nombre de su clase");
    assert.equal(out.sections[2].bars, 6, "sin compases: 2 por línea, mínimo 4");
    assert.equal(out.sections[4].bars, 2);
    assert.deepEqual(out.sections[4].chords, []);
  });

  it("UNA entrada de historial para N secciones, de alcance letra", () => {
    const out = applyToSong(
      song(),
      [
        {
          payload: { label: "Verso 1", lines: ["x"] },
          target: { mode: "debajo", sectionId: "s1" },
        },
        {
          payload: { label: "Coro", lines: ["y"] },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      { note: "Tema «prueba» aplicado", now: NOW, newId: ids() },
    );
    assert.equal(out.versions.length, 2);
    assert.deepEqual(out.versions[1], {
      id: "v-1",
      at: NOW,
      note: "Tema «prueba» aplicado",
      scope: "letra",
    });
  });

  it("transpone los acordes (de sección e inline) a la tonalidad de la canción y calcula los semitonos del memo", () => {
    // Tema en Re menor → canción en La menor: −5 (el camino corto).
    const out = applyToSong(
      song(),
      [
        {
          payload: {
            label: "Coro",
            lines: ["[Dm]hola [Bb]mundo"],
            chords: ["Dm", "Bb", "F", "C", "raro"],
            link,
          },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      { note: "n", now: NOW, fromKey: { tonic: 2, mode: "minor" }, newId: ids() },
    );
    assert.deepEqual(out.sections[1].chords, ["Am", "F", "C", "G", "raro"]);
    assert.equal(out.sections[1].lyrics, "[Am]hola [F]mundo");
    assert.equal(out.sections[1].memo?.semitones, -5);
  });

  it("de la relativa mayor no se mueve nada (misma escala): los símbolos quedan como vinieron", () => {
    const out = applyToSong(
      song(),
      [
        {
          payload: {
            label: "Coro",
            lines: ["x"],
            chords: ["Lam", "Fa"],
            link: { ...link, semitones: 3 },
          },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      { note: "n", now: NOW, fromKey: { tonic: 0, mode: "major" }, newId: ids() },
    );
    assert.deepEqual(out.sections[1].chords, ["Lam", "Fa"]);
    assert.equal(out.sections[1].memo?.semitones, 0);
    // Sin tonalidad de origen, los semitonos del vínculo se respetan.
    const raw = applyToSong(
      song(),
      [
        {
          payload: { label: "Coro", lines: ["x"], link: { ...link, semitones: 3 } },
          target: { mode: "reemplazar", sectionId: "s2" },
        },
      ],
      { note: "n", now: NOW, newId: ids() },
    );
    assert.equal(raw.sections[1].memo?.semitones, 3);
  });

  it('"debajo" con acordes y compases: la sección crece', () => {
    const out = applyToSong(
      song(),
      [
        {
          payload: { label: "Verso 1", lines: ["x"], chords: ["G"], bars: 2 },
          target: { mode: "debajo", sectionId: "s1" },
        },
      ],
      { note: "n", now: NOW, newId: ids() },
    );
    assert.deepEqual(out.sections[0].chords, ["Am", "F", "G"]);
    assert.equal(out.sections[0].bars, 6);
  });

  it("una sección destino que no existe es un error; sin items la canción queda igual", () => {
    assert.throws(
      () =>
        applyToSong(
          song(),
          [
            {
              payload: { label: "x", lines: ["x"] },
              target: { mode: "debajo", sectionId: "nope" },
            },
          ],
          { note: "n", now: NOW, newId: ids() },
        ),
      ComposicionValidationError,
    );
    const s = song();
    assert.equal(applyToSong(s, [], { note: "n", now: NOW, newId: ids() }), s);
  });
});
