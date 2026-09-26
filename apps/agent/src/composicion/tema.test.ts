import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TEMA_STAGES,
  TemaValidationError,
  montageSlots,
  newTema,
  temaGates,
  validateTema,
  type Tema,
  type TemaCandidate,
} from "@hermes/shared";

/**
 * El TEMA como contrato: nace sano (un coro de 8 compases con un loop de 4 de
 * su tonalidad), la validación rechaza lo que rompería el audio o el análisis
 * con un motivo en español, lo que falta por etapa se calcula sobre el
 * material real y el montaje propone la ★ sin decidir por el humano. Datos
 * inventados.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const base = (): Tema => newTema({ id: "tema-1", title: "Prueba", now: NOW });
const symbols = (t: Tema): string[] => t.track.sections[0].loop.map((b) => b.chords[0].symbol);
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Candidato mínimo; `take` distingue tomas (sesión `toma-<take>`, pasaje P01). */
function cand({ take, ...p }: Partial<TemaCandidate> & { take?: string }): TemaCandidate {
  return {
    memo: { sessionId: `toma-${take ?? "1"}`, passageId: "P01" },
    kind: "toma",
    label: "Toma",
    sectionId: "coro-1",
    favorite: false,
    status: "listo",
    onGrid: true,
    recordedAt: NOW,
    lyrics: { versions: 0, mine: 0 },
    ...p,
  };
}

describe("newTema", () => {
  it("nace con un coro de 8 compases y el loop i–VI–III–VII en La menor por defecto", () => {
    const t = base();
    assert.equal(t.stage, "intencion");
    assert.deepEqual(t.track.key, { tonic: 9, mode: "minor" });
    assert.equal(t.track.bpm, 90);
    assert.equal(t.track.groove, "clic");
    assert.equal(t.track.meter, "4/4");
    assert.equal(t.track.sections.length, 1);
    const s = t.track.sections[0];
    assert.deepEqual([s.kind, s.label, s.bars, s.loop.length], ["coro", "Coro", 8, 4]);
    assert.deepEqual(symbols(t), ["Am", "F", "C", "G"]);
    assert.deepEqual(t.intent, { about: "", convey: "", genre: "otro" });
    assert.deepEqual(t.montage, []);
  });

  it("en mayor usa I–V–vi–IV, y deletrea por tonalidad (Re menor dice Bb)", () => {
    assert.deepEqual(symbols(newTema({ id: "a", title: "", now: NOW, key: { tonic: 0, mode: "major" } })), [
      "C",
      "G",
      "Am",
      "F",
    ]);
    assert.deepEqual(symbols(newTema({ id: "b", title: "", now: NOW, key: { tonic: 2, mode: "minor" } })), [
      "Dm",
      "Bb",
      "F",
      "C",
    ]);
  });

  it("toma la tonalidad medida y el bpm estimado (acotado a 40..220) con su origen", () => {
    const t = newTema({
      id: "c",
      title: "",
      now: NOW,
      key: { tonic: 7, mode: "major" },
      bpm: 250,
      keySource: "medida",
      bpmSource: "estimado",
      origin: { sessionId: "s", passageId: "P03" },
    });
    assert.equal(t.track.bpm, 220);
    assert.equal(t.track.keySource, "medida");
    assert.equal(t.track.bpmSource, "estimado");
    assert.deepEqual(t.origin, { sessionId: "s", passageId: "P03" });
  });

  it("siempre pasa su propia validación", () => {
    for (let tonic = 0; tonic < 12; tonic++)
      for (const mode of ["major", "minor"] as const) {
        const t = newTema({ id: "x", title: "x", now: NOW, key: { tonic, mode } });
        assert.deepEqual(validateTema(clone(t)), t);
      }
  });
});

describe("validateTema", () => {
  const rejects = (mut: (t: Tema & Record<string, unknown>) => void, re: RegExp): void => {
    const t = clone(base()) as Tema & Record<string, unknown>;
    mut(t);
    assert.throws(
      () => validateTema(t),
      (e: unknown) => e instanceof TemaValidationError && re.test((e as Error).message),
    );
  };

  it("rechaza tónica 12 (o no entera)", () => {
    rejects((t) => (t.track.key.tonic = 12), /tónica/);
    rejects((t) => (t.track.key.tonic = 2.5), /tónica/);
  });

  it("rechaza bpm 300 y 39", () => {
    rejects((t) => (t.track.bpm = 300), /bpm/);
    rejects((t) => (t.track.bpm = 39), /bpm/);
  });

  it("rechaza un acorde que parseChord no entiende («Xm9#»)", () => {
    rejects((t) => (t.track.sections[0].loop[1].chords[0].symbol = "Xm9#"), /Xm9#/);
  });

  it("rechaza acordes fuera del compás, desordenados o más de 2 por compás", () => {
    rejects((t) => (t.track.sections[0].loop[0].chords[0].beat = 4), /fuera del compás/);
    rejects(
      (t) => (t.track.sections[0].loop[0].chords = [{ symbol: "Am", beat: 2 }, { symbol: "G", beat: 1 }]),
      /orden/,
    );
    rejects(
      (t) =>
        (t.track.sections[0].loop[0].chords = [
          { symbol: "Am", beat: 0 },
          { symbol: "G", beat: 1 },
          { symbol: "F", beat: 2 },
        ]),
      /1 o 2 acordes/,
    );
    // En 6/8 solo hay 2 pulsos: el tiempo 2 ya no existe.
    rejects((t) => {
      t.track.meter = "6/8";
      t.track.sections[0].loop[0].chords[0].beat = 2;
    }, /fuera del compás/);
  });

  it("rechaza loops de 0 o 17 compases y secciones de 65", () => {
    rejects((t) => (t.track.sections[0].loop = []), /1 a 16/);
    rejects((t) => (t.track.sections[0].loop = Array.from({ length: 17 }, () => ({ chords: [{ symbol: "C", beat: 0 }] }))), /1 a 16/);
    rejects((t) => (t.track.sections[0].bars = 65), /1 a 64/);
    rejects((t) => (t.track.sections[0].bars = 0), /1 a 64/);
  });

  it("rechaza compás, groove, género, etapa y clase de sección desconocidos", () => {
    rejects((t) => ((t.track as { meter: string }).meter = "5/4"), /compás/);
    rejects((t) => ((t.track as { groove: string }).groove = "salsa"), /groove/);
    rejects((t) => ((t.intent as { genre: string }).genre = "jazz"), /género/);
    rejects((t) => ((t as { stage: string }).stage = "mezcla"), /etapa/);
    rejects((t) => ((t.track.sections[0] as { kind: string }).kind = "estribillo"), /clase de sección/);
  });

  it("rechaza secciones repetidas o una pista sin secciones, y swing fuera de 0..0,5", () => {
    rejects((t) => t.track.sections.push(clone(t.track.sections[0])), /repetido/);
    rejects((t) => (t.track.sections = []), /al menos una sección/);
    rejects((t) => (t.track.swing = 0.7), /swing/);
  });

  it("devuelve una copia limpia: sin campos desconocidos y sin partes de secciones borradas", () => {
    const t = clone(base()) as Tema & Record<string, unknown>;
    t.extra = "basura";
    t.montage = [
      { sectionId: "ya-no-existe", keep: true },
      { sectionId: "coro-1", semitones: 2 },
      { sectionId: "coro-1", memo: { sessionId: "s", passageId: "P01" }, lyric: { kind: "mine" } },
    ];
    const v = validateTema(t);
    assert.equal((v as unknown as Record<string, unknown>).extra, undefined);
    assert.deepEqual(v.montage, [{ sectionId: "coro-1", memo: { sessionId: "s", passageId: "P01" }, lyric: { kind: "mine" } }]);
  });

  it("acepta acordes latinos y con extensiones que parseChord entiende", () => {
    const t = clone(base());
    t.track.sections[0].loop[0].chords = [
      { symbol: "Lam", beat: 0 },
      { symbol: "F#m7", beat: 2 },
    ];
    t.track.sections[0].loop[1].chords = [{ symbol: "Bbmaj7", beat: 0 }];
    assert.equal(validateTema(t).track.sections[0].loop[0].chords[1].symbol, "F#m7");
  });
});

describe("temaGates", () => {
  const gateOf = (t: Tema, c: TemaCandidate[], stage: string) => temaGates(t, c).find((g) => g.stage === stage)!;

  it("una por etapa, en orden", () => {
    assert.deepEqual(
      temaGates(base(), []).map((g) => g.stage),
      [...TEMA_STAGES],
    );
  });

  it("un tema recién nacido: tiene pista (el loop) y le falta todo lo demás", () => {
    const gates = temaGates(base(), []);
    const by = Object.fromEntries(gates.map((g) => [g.stage, g]));
    assert.deepEqual(by.intencion.missing, ["De qué habla", "Qué quiere transmitir"]);
    assert.equal(by.pista.done, true);
    assert.deepEqual(by.grabar.missing, ["Una toma de «Coro»"]);
    assert.equal(by.analisis.done, false);
    assert.equal(by.letra.done, false);
    assert.deepEqual(by.montaje.missing, ["Elegir la parte de «Coro»"]);
  });

  it("se cumplen con material real: intención escrita, toma lista en la rejilla, letra y parte elegida", () => {
    const t = base();
    t.intent.about = "una despedida";
    t.intent.convey = "alivio";
    const c = cand({ lyrics: { versions: 0, mine: 2 } });
    t.montage = [{ sectionId: "coro-1", memo: c.memo }];
    assert.ok(temaGates(t, [c]).every((g) => g.done && !g.missing.length));
  });

  it("el espacio en blanco no cuenta como intención escrita", () => {
    const t = base();
    t.intent.about = "   ";
    t.intent.convey = "algo";
    assert.deepEqual(gateOf(t, [], "intencion").missing, ["De qué habla"]);
  });

  it("grabar se mide por sección", () => {
    const t = base();
    t.track.sections.push({ ...clone(t.track.sections[0]), id: "verso-1", kind: "verso", label: "Verso" });
    assert.deepEqual(gateOf(t, [cand({})], "grabar").missing, ["Una toma de «Verso»"]);
  });

  it("análisis: con la toma aún procesando dice que espere; sin rejilla o fallida no cuenta", () => {
    const t = base();
    assert.match(gateOf(t, [cand({ status: "procesando" })], "analisis").missing[0], /Esperar/);
    assert.equal(gateOf(t, [cand({ onGrid: false })], "analisis").done, false);
    assert.match(gateOf(t, [cand({ status: "error" })], "analisis").missing[0], /fallaron/);
    assert.equal(gateOf(t, [cand({})], "analisis").done, true);
  });

  it("montaje: la ★ propuesta no cuenta como elegida (la elección es humana)", () => {
    const t = base();
    assert.equal(gateOf(t, [cand({ favorite: true })], "montaje").done, false);
  });
});

describe("montageSlots", () => {
  it("sin elección propone la ★ (lista antes que en proceso) y si no hay, la última lista", () => {
    const t = base();
    const older = cand({ take: "a", recordedAt: "2026-01-01T10:00:00Z" });
    const newer = cand({ take: "b", recordedAt: "2026-01-01T11:00:00Z" });
    const failed = cand({ take: "c", recordedAt: "2026-01-01T12:00:00Z", status: "error" });
    assert.equal(montageSlots(t, [older, newer, failed])[0].candidate, newer);

    const favBusy = cand({ take: "d", favorite: true, status: "procesando", recordedAt: "2026-01-01T13:00:00Z" });
    const favReady = cand({ take: "e", favorite: true, recordedAt: "2026-01-01T09:00:00Z" });
    assert.equal(montageSlots(t, [older, newer, favBusy, favReady])[0].candidate, favReady);
    assert.equal(montageSlots(t, [older, favBusy])[0].candidate, favBusy);
    const [slot] = montageSlots(t, []);
    assert.equal(slot.candidate, null);
    assert.equal(slot.pick, null);
  });

  it("la elección manda; una parte de otro tema da candidate null", () => {
    const t = base();
    const a = cand({ take: "a", favorite: true });
    const b = cand({ take: "b" });
    t.montage = [{ sectionId: "coro-1", memo: b.memo, keep: true }];
    const [slot] = montageSlots(t, [a, b]);
    assert.equal(slot.candidate, b);
    assert.equal(slot.pick?.keep, true);
    t.montage = [{ sectionId: "coro-1", memo: { sessionId: "otro-tema", passageId: "P01" } }];
    assert.equal(montageSlots(t, [a, b])[0].candidate, null);
  });

  it("una fila por sección, en el orden de la pista", () => {
    const t = base();
    t.track.sections.unshift({ ...clone(t.track.sections[0]), id: "verso-1", kind: "verso", label: "Verso" });
    assert.deepEqual(
      montageSlots(t, []).map((s) => s.section.id),
      ["verso-1", "coro-1"],
    );
  });
});
