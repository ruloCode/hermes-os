/**
 * Fixtures SINTÉTICOS de la MESA DE MONTAJE para /dev/temas (se registran
 * sobre los mapas de ./mock al importarse). Todo inventado aquí — el repo es
 * público: textos genéricos, voces de senos.
 *
 *  - «Montaje de prueba» (La menor, 92 bpm): tres secciones que cubren los
 *    tres estados de un hueco. Verso = parte ELEGIDA (Toma 1 ★ con «Tu versión»
 *    y dos versiones, más una Toma 2 y un pasaje de Sesiones sin rejilla);
 *    Pre-coro = ★ PROPUESTA sin elegir; Coro = VACÍO (sin tomas).
 *  - «Idea en Sol» (Sol mayor, 100 bpm) gana una toma ★ en su Coro: aparece
 *    en "De todos" con otra tonalidad y otro tempo.
 */
import { newTema, type ChordBar, type Key, type TakeMeta, type Tema, type TemaSection } from "@hermes/shared";
import { extraCandidates, makeTake, takes, temas, version } from "./mock";

const A_MINOR: Key = { tonic: 9, mode: "minor" };
const G_MAJOR: Key = { tonic: 7, mode: "major" };
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const bar = (...symbols: string[]): ChordBar => ({
  chords: symbols.map((symbol, i) => ({ symbol, beat: i === 0 ? 0 : 2 })),
});

const SECTIONS: TemaSection[] = [
  { id: "verso-d", kind: "verso", label: "Verso", bars: 8, loop: [bar("Am"), bar("Em"), bar("F"), bar("G")] },
  { id: "pre-d", kind: "pre", label: "Pre-coro", bars: 4, loop: [bar("Dm"), bar("F"), bar("G"), bar("E")] },
  { id: "coro-d", kind: "coro", label: "Coro", bars: 8, loop: [bar("F"), bar("G"), bar("Am"), bar("G", "E")] },
];

const temaD: Tema = (() => {
  const t = newTema({ id: "tema-demo-montaje", title: "Montaje de prueba", now: iso(8), key: A_MINOR, bpm: 92 });
  return {
    ...t,
    updatedAt: iso(2),
    stage: "montaje",
    intent: {
      about: "Una ciudad que se apaga de a poco y alguien que decide quedarse despierto.",
      convey: "Calma con pulso: la noche como aliada.",
      pov: "yo → la ciudad",
      anchors: ["farol", "azotea"],
      genre: "rnb",
    },
    track: { ...t.track, groove: "dembow", bpmSource: "tap", sections: SECTIONS },
    montage: [{ sectionId: "verso-d", memo: { sessionId: "toma-d-verso-1", passageId: "P01" }, lyric: { kind: "mine" } }],
  };
})();
temas.set(temaD.id, temaD);

function meta(temaId: string, section: TemaSection, n: number, favorite: boolean, key = A_MINOR, bpm = 92): TakeMeta {
  return {
    temaId,
    sectionId: section.id,
    n,
    grid: { bpm, meter: "4/4", key, downbeatSec: 0.6, loop: section.loop, bars: 4 },
    latency: { ms: 0, source: "manual" },
    monitor: "audifonos",
    stt: false,
    hint: "na na uh uh dun / na na na oh uh",
    favorite,
  };
}

// Verso: la parte elegida, con letra, más una alternativa.
{
  const v1 = makeTake("toma-d-verso-1", temaD.id, meta(temaD.id, SECTIONS[0], 1, true), 0);
  v1.board.versions = [
    version(v1.analysis, "imagen concreta", ["prende el farol de la esquina", "nadie sube a la azotea"], ["el farol como ancla", "cierra abierto sobre el melisma"], "respetar"),
    version(v1.analysis, "confesión", ["no quiero dormir", "la ciudad se queda conmigo"], ["directo", "la vocal larga en «conmigo»"], "respetar"),
  ];
  v1.board.mine = [
    { phrase: 0, text: "prende el farol", from: v1.board.versions[0].id },
    { phrase: 1, text: "y la ciudad se queda conmigo" },
  ];
  takes.set(v1.session.id, v1);
  const v2 = makeTake("toma-d-verso-2", temaD.id, meta(temaD.id, SECTIONS[0], 2, false), 0, 2);
  v2.board.versions = [version(v2.analysis, "diálogo", ["¿me escuchas, calle?", "yo sigo aquí contigo"], ["pregunta que abre", "responde y cierra"], "respetar")];
  takes.set(v2.session.id, v2);
}

// Pre-coro: una ★ que se PROPONE (nadie la eligió todavía).
{
  const p1 = makeTake("toma-d-pre-1", temaD.id, meta(temaD.id, SECTIONS[1], 1, true), 0, -2);
  p1.board.versions = [version(p1.analysis, "pregón pregunta-respuesta", ["¿quién apaga?", "yo no, yo no"], ["pregunta corta", "respuesta que se canta de vuelta"], "respetar")];
  p1.board.mine = [{ phrase: 0, text: "¿quién apaga?" }];
  takes.set(p1.session.id, p1);
}

// Un pasaje de Sesiones llevado al Verso: sin rejilla (en el ensamble suena solo la pista).
extraCandidates.set(temaD.id, [
  {
    memo: { sessionId: "sesion-demo", passageId: "P01" },
    kind: "pasaje",
    label: "P01 · Sesión de prueba",
    sectionId: "verso-d",
    favorite: false,
    status: "listo",
    onGrid: false,
    recordedAt: iso(60 * 5),
    durationSec: 12,
    syllables: 10,
    melismas: 2,
    lyrics: { versions: 0, mine: 0 },
  },
]);

// «Idea en Sol»: una toma ★ para "De todos" (otra tonalidad, otro tempo).
{
  const b = temas.get("tema-demo-2");
  if (b) {
    const coro = b.track.sections[0];
    const g1 = makeTake("toma-b-coro-1", b.id, meta(b.id, coro, 1, true, G_MAJOR, 100), 0, -2);
    g1.board.mine = [
      { phrase: 0, text: "sube la marea" },
      { phrase: 1, text: "y nadie me dice que no" },
    ];
    takes.set(g1.session.id, g1);
  }
}
