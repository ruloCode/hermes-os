/**
 * Gimnasio de articulación: contratos del plan del día, la racha, el puntaje,
 * el store en disco y lo que se le manda al modelo.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeRound,
  dailyPlan,
  detectWeakPhrases,
  GYM_TOPICS,
  referenceOf,
  sanitizeGenerated,
  topicsFor,
  type GymScenario,
  guessLang,
  gymReference,
  wordCount,
  GYM_HABITS,
  GYM_SCENARIOS,
  gymDayCounts,
  gymScore,
  gymStreak,
  gymTrainedDays,
  habitAverages,
  mentionsName,
  stripWrappingQuotes,
  withReference,
  planProgress,
  weakestHabit,
  type GymHabit,
  type GymRep,
} from "@hermes/shared";
import { readReps } from "./store.js";
import { buildGymSystemPrompt, buildGymUserPrompt, cleanFeedback } from "./analyze.js";
import { buildGenerateSystemPrompt, buildGenerateUserPrompt } from "./generate.js";

const all = (n: number) => Object.fromEntries(GYM_HABITS.map((h) => [h.key, n])) as Record<GymHabit, number>;

function rep(over: Partial<GymRep> = {}): GymRep {
  return {
    id: "x",
    date: "2026-10-14",
    scenarioId: GYM_SCENARIOS[0].id,
    lang: "es",
    attempt: 1,
    transcript: "Propongo mover la entrega al viernes.",
    durationSec: 20,
    words: 6,
    wpm: 18,
    fillers: 0,
    weak: [],
    feedback: { scores: all(3), notes: all(0) as never, better: "", tip: "" },
    score: 50,
    createdAt: "",
    ...over,
  };
}

describe("dailyPlan", () => {
  it("dos en español y dos en inglés, alternados", () => {
    assert.deepEqual(
      dailyPlan("2026-10-14").map((s) => s.lang),
      ["es", "en", "es", "en"],
    );
  });
  it("es determinista por fecha", () => {
    assert.deepEqual(
      dailyPlan("2026-10-14").map((s) => s.id),
      dailyPlan("2026-10-14").map((s) => s.id),
    );
  });
  it("nunca dos del mismo tipo en el mismo idioma el mismo día", () => {
    for (let d = 1; d <= 28; d++) {
      const plan = dailyPlan(`2026-02-${String(d).padStart(2, "0")}`);
      for (const lang of ["es", "en"] as const) {
        const kinds = plan.filter((s) => s.lang === lang).map((s) => s.kind);
        assert.equal(new Set(kinds).size, kinds.length, `día ${d} ${lang}: ${kinds.join(",")}`);
      }
    }
  });
  it("rota: en dos semanas sale todo el catálogo de cada idioma", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 14; d++) for (const s of dailyPlan(`2026-03-${String(d).padStart(2, "0")}`)) seen.add(s.id);
    assert.equal(seen.size, GYM_SCENARIOS.length);
  });
  it("un día no repite el plan del anterior", () => {
    const a = dailyPlan("2026-10-14").map((s) => s.id);
    const b = dailyPlan("2026-10-15").map((s) => s.id);
    assert.equal(a.filter((id) => b.includes(id)).length, 0);
  });
});

describe("gymScore", () => {
  it("1 en todo = 0, 5 en todo = 100, 3 = 50", () => {
    assert.equal(gymScore(all(1)), 0);
    assert.equal(gymScore(all(5)), 100);
    assert.equal(gymScore(all(3)), 50);
  });
  it("valores fuera de rango se acotan", () => {
    assert.equal(gymScore(all(9)), 100);
    assert.equal(gymScore({} as Record<GymHabit, number>), 0);
  });
});

describe("racha", () => {
  it("un día cuenta solo con español Y inglés", () => {
    assert.equal(gymDayCounts([{ lang: "es" }, { lang: "es" }]), false);
    assert.equal(gymDayCounts([{ lang: "es" }, { lang: "en" }]), true);
  });
  it("cuenta días seguidos; si hoy aún no entrenas, cuenta desde ayer", () => {
    const reps = [
      { date: "2026-10-12", lang: "es" as const },
      { date: "2026-10-12", lang: "en" as const },
      { date: "2026-10-13", lang: "es" as const },
      { date: "2026-10-13", lang: "en" as const },
    ];
    assert.equal(gymStreak(reps, "2026-10-14"), 2);
    assert.equal(gymStreak([...reps, { date: "2026-10-14", lang: "es" }], "2026-10-14"), 2);
    assert.equal(
      gymStreak([...reps, { date: "2026-10-14", lang: "es" }, { date: "2026-10-14", lang: "en" }], "2026-10-14"),
      3,
    );
  });
  it("un hueco la corta", () => {
    const reps = [
      { date: "2026-10-10", lang: "es" as const },
      { date: "2026-10-10", lang: "en" as const },
      { date: "2026-10-13", lang: "es" as const },
      { date: "2026-10-13", lang: "en" as const },
    ];
    assert.equal(gymStreak(reps, "2026-10-14"), 1);
    assert.equal(gymStreak(reps, "2026-10-16"), 0);
  });
});

describe("progreso", () => {
  it("planProgress se queda con el mejor intento de cada escenario", () => {
    const plan = dailyPlan("2026-10-14");
    const p = planProgress(plan, [
      rep({ scenarioId: plan[0].id, score: 40 }),
      rep({ scenarioId: plan[0].id, score: 70, attempt: 2 }),
    ]);
    assert.equal(p[0].best?.score, 70);
    assert.equal(p[0].attempts, 2);
    assert.equal(p[1].best, null);
  });
  it("sin datos no hay promedio (null, no cero)", () => {
    assert.equal(habitAverages([]).punto, null);
    assert.equal(weakestHabit([]), null);
  });
  it("weakestHabit encuentra el más flojo y filtra por idioma", () => {
    const flojo = { ...all(4), conviccion: 2 };
    const reps = [rep({ feedback: { scores: flojo, notes: all(0) as never, better: "", tip: "" } })];
    assert.equal(weakestHabit(reps), "conviccion");
    assert.equal(habitAverages(reps, "en").punto, null);
    assert.equal(habitAverages(reps, "es").conviccion, 2);
  });
});

describe("store", () => {
  it("una línea a medias no tumba la lectura", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gym-"));
    const file = join(dir, "reps.jsonl");
    await writeFile(file, `${JSON.stringify(rep({ id: "a" }))}\n{"id":"b","dat\n${JSON.stringify(rep({ id: "c" }))}\n`);
    assert.deepEqual(
      (await readReps(file)).map((r) => r.id),
      ["a", "c"],
    );
  });
  it("sin archivo = sin repeticiones", async () => {
    assert.deepEqual(await readReps(join(tmpdir(), "no-existe-gym.jsonl")), []);
  });
});

describe("prompt del análisis", () => {
  const scenario = GYM_SCENARIOS.find((s) => s.lang === "en")!;
  it("lleva el escenario, la respuesta, las señales y el idioma", () => {
    const p = buildGymUserPrompt({
      scenario,
      transcript: "I just wanted to say that maybe we could wait.",
      durationSec: 12,
      wpm: 50,
      fillers: 0,
      weak: ["I just wanted to say"],
    });
    assert.match(p, /en inglés/);
    assert.match(p, /maybe we could wait/);
    assert.match(p, /«I just wanted to say»/);
    assert.ok(p.includes(scenario.prompt));
  });
  it("el reintento compara con el intento anterior", () => {
    const p = buildGymUserPrompt({
      scenario,
      transcript: "Let's wait one week.",
      durationSec: 5,
      wpm: 48,
      fillers: 0,
      weak: [],
      previous: rep({ score: 35, feedback: { scores: all(2), notes: all(0) as never, better: "", tip: "Empieza por la postura" } }),
    });
    assert.match(p, /Intento anterior \(35\/100\)/);
    assert.match(p, /Empieza por la postura/);
  });
  it("el system prompt pide los cinco hábitos y prohíbe inventar datos", () => {
    const sys = buildGymSystemPrompt("");
    for (const h of GYM_HABITS) assert.ok(sys.includes(h.key));
    assert.match(sys, /NUNCA corchetes/);
  });
});

describe("respuestas de referencia", () => {
  for (const sc of GYM_SCENARIOS) {
    it(`${sc.id}: existe, en su idioma, corta y sin señales débiles`, () => {
      const ref = gymReference(sc.id);
      assert.ok(ref, "sin referencia");
      assert.ok(ref.steps.length >= 2 && ref.steps.length <= 4, "2-4 pasos");
      assert.equal(guessLang(ref.example), sc.lang);
      assert.ok(wordCount(ref.example) <= 70, `${wordCount(ref.example)} palabras`);
      assert.deepEqual(detectWeakPhrases(ref.example).map((h) => h.match), []);
      assert.doesNotMatch(ref.example, /[[\]]/, "completa, sin [huecos]");
    });
  }
});

const gen = (id: string, lang: "es" | "en"): GymScenario => ({
  id,
  lang,
  kind: "explicar",
  situation: "x",
  prompt: "x",
  focus: "punto",
  targetSec: 30,
  source: "generated",
  reference: { steps: ["a", "b"], example: "x" },
});

describe("composeRound", () => {
  it("usa primero los temas nuevos, en orden es/en/es/en", () => {
    const pool = [gen("g1", "en"), gen("g2", "es"), gen("g3", "es"), gen("g4", "en")];
    assert.deepEqual(
      composeRound(pool, new Set())?.map((x) => x.id),
      ["g2", "g1", "g3", "g4"],
    );
  });
  it("sin temas nuevos completa con el catálogo que no se ha usado", () => {
    const used = new Set(GYM_SCENARIOS.slice(0, 3).map((x) => x.id));
    const r = composeRound([], used)!;
    assert.deepEqual(r.map((x) => x.lang), ["es", "en", "es", "en"]);
    assert.ok(r.every((x) => !used.has(x.id)));
    assert.equal(new Set(r.map((x) => x.id)).size, 4);
  });
  it("null cuando ya no queda nada de un idioma", () => {
    const used = new Set(GYM_SCENARIOS.filter((x) => x.lang === "en").map((x) => x.id));
    assert.equal(composeRound([gen("g1", "es")], used), null);
  });
});

describe("sanitizeGenerated", () => {
  let n = 0;
  const run = (drafts: object[]) =>
    sanitizeGenerated(drafts, () => `gen-${++n}`, (t) => detectWeakPhrases(t), (t) => guessLang(t));
  const ok = {
    lang: "en",
    kind: "pregunta-dificil",
    situation: "A skeptical CTO is watching your agent demo.",
    prompt: "\"Why would I trust this with my customers?\"",
    focus: "conviccion",
    targetSec: 90,
    steps: ["Answer directly", "How you control it"],
    example: "Because it only answers from your documents and hands off when it isn't sure. Every answer is logged, so we measure the error rate weekly.",
  };
  it("acepta uno bien formado, acota la duración y lo marca como generado", () => {
    const [s] = run([ok]);
    assert.equal(s.targetSec, 60);
    assert.equal(s.source, "generated");
    assert.equal(referenceOf(s)?.steps.length, 2);
  });
  it("descarta idioma cruzado, tipo inventado, pasos de más y referencias con señales débiles", () => {
    assert.equal(run([{ ...ok, lang: "es" }]).length, 0);
    assert.equal(run([{ ...ok, kind: "monologo" }]).length, 0);
    assert.equal(run([{ ...ok, steps: ["a", "b", "c", "d", "e"] }]).length, 0);
    assert.equal(run([{ ...ok, example: `${ok.example} I think maybe we could also add evals.` }]).length, 0);
    assert.equal(run([{ ...ok, situation: 42 }]).length, 0);
    assert.equal(run([{ ...ok, example: "We measure [error rate] every week and fix what fails." }]).length, 0);
  });
  it("un foco desconocido cae a «el punto primero» en vez de tirar el tema", () => {
    assert.equal(run([{ ...ok, focus: "carisma" }])[0].focus, "punto");
  });
});

describe("temas de las rondas generadas", () => {
  it("rotan: tandas seguidas no repiten temas hasta dar la vuelta", () => {
    const seen = new Set<string>();
    for (let b = 0; b < GYM_TOPICS.length / 4; b++) for (const t of topicsFor(b)) seen.add(t);
    assert.equal(seen.size, GYM_TOPICS.length);
  });
  it("el prompt pide el orden de idiomas, los temas y lo que no repetir", () => {
    const p = buildGenerateUserPrompt({
      topics: topicsFor(0),
      about: "",
      projects: ["Proyecto X — en curso"],
      avoid: ["\"¿Y eso para qué sirve?\""],
    });
    assert.match(p, /es, en, es, en/);
    assert.ok(p.includes(topicsFor(0)[0]));
    assert.match(p, /Proyecto X/);
    assert.match(p, /no repitas/);
    assert.match(buildGenerateSystemPrompt(), /INGENIERÍA DE AGENTES/);
  });
});

describe("lo que viaja al teléfono", () => {
  it("cada escenario del catálogo sale con su referencia; el generado conserva la suya", () => {
    for (const sc of dailyPlan("2026-10-15")) {
      assert.equal(sc.reference, undefined, "el catálogo no la trae en el dato");
      assert.deepEqual(withReference(sc).reference, gymReference(sc.id));
    }
    const g = gen("g1", "es");
    assert.equal(withReference(g).reference, g.reference);
  });
  it("días completos: acumulados, nunca bajan por faltar y solo cuentan con español Y inglés", () => {
    const reps = [
      rep({ date: "2026-10-01", lang: "es" }),
      rep({ date: "2026-10-01", lang: "en" }),
      rep({ date: "2026-10-05", lang: "es" }), // solo español: no cuenta
      rep({ date: "2026-10-09", lang: "en" }),
      rep({ date: "2026-10-09", lang: "es" }),
      rep({ date: "2026-10-09", lang: "es" }),
    ];
    assert.equal(gymTrainedDays(reps), 2);
    assert.equal(gymStreak(reps, "2026-10-15"), 0, "la racha sí se cae");
    assert.equal(gymTrainedDays([]), 0);
  });
});

describe("«Dilo así» sin comillas envolventes", () => {
  it("quita el par que envuelve todo el texto", () => {
    assert.equal(stripWrappingQuotes('"Cerramos el trimestre 12 % abajo."'), "Cerramos el trimestre 12 % abajo.");
    assert.equal(stripWrappingQuotes("«Propongo moverlo al viernes.»"), "Propongo moverlo al viernes.");
    assert.equal(stripWrappingQuotes("“Let's close: option B.”"), "Let's close: option B.");
  });
  it("no toca comillas internas ni un texto que no está envuelto", () => {
    assert.equal(stripWrappingQuotes('"A" y luego "B"'), '"A" y luego "B"');
    assert.equal(stripWrappingQuotes("Le dije «no» y seguimos."), "Le dije «no» y seguimos.");
  });
  it("cleanFeedback limpia solo el better", () => {
    const f = { ...rep().feedback, better: '"Hola."', tip: '"igual"' };
    assert.equal(cleanFeedback(f).better, "Hola.");
    assert.equal(cleanFeedback(f).tip, '"igual"');
  });
});

describe("temas en segunda persona", () => {
  it("mentionsName: palabra completa, sin mayúsculas, y una lista vacía no nombra a nadie", () => {
    assert.ok(mentionsName("Alex presenta el agente a un CTO.", ["Alex"]));
    assert.ok(mentionsName("on a call, ALEX shows the demo", ["alex"]));
    assert.ok(!mentionsName("Alexandra presenta el agente.", ["Alex"]));
    assert.ok(!mentionsName("Presentas el agente a un CTO.", []));
  });
  it("sanitizeGenerated descarta el tema que nombra al dueño", () => {
    const draft = {
      lang: "es",
      kind: "explicar",
      situation: "Alex presenta a un CTO escéptico el agente que construyó.",
      prompt: "«¿Cómo sé que funciona antes de que hable con mis clientes?»",
      focus: "punto",
      targetSec: 35,
      steps: ["El punto", "El número"],
      example: "Antes de salir, el agente pasa un set de 80 casos reales y necesita acertar el 90 %. Esa suite corre en cada cambio de prompt.",
    };
    const run = (names: string[]) =>
      sanitizeGenerated([draft], () => "g", (t) => detectWeakPhrases(t), (t) => guessLang(t), names);
    assert.equal(run(["Alex"]).length, 0);
    assert.equal(run([]).length, 1);
  });
  it("el prompt pide segunda persona y nunca el nombre", () => {
    assert.match(buildGenerateSystemPrompt(), /SEGUNDA persona/);
  });
});
