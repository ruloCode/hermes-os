/**
 * Plan de estudios de inglés: contratos de la ruta (qué se abre y cuándo), el
 * XP y la racha, el clasificador de errores reales, el quiz que sale de tus
 * sesiones y el cierre de la lección con la tutora.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyError,
  classTrend,
  detectWeakPhrases,
  LESSON_XP,
  PLAN_LESSONS,
  PLAN_UNITS,
  patternHits,
  planStreak,
  planView,
  planXp,
  quizItemsFor,
  REPEAT_XP,
  rightFirst,
  tutorLessonBlock,
  tutorLessonOpening,
  type PlanAttempt,
  type SessionErrorsLike,
} from "@hermes/shared";
import { notePracticeSaved, readAttempts } from "./plan-store.js";
import { buildDrillUserPrompt } from "./plan-drill.js";

const pass = (lessonId: string, date = "2026-10-20", score = 90): PlanAttempt => ({
  id: lessonId + date + score,
  lessonId,
  kind: PLAN_LESSONS.find((l) => l.id === lessonId)!.kind,
  date,
  score,
  passed: true,
  createdAt: `${date}T12:00:00.000Z`,
});

describe("temario", () => {
  it("cada unidad trae cinco lecciones, regla, ejemplos suficientes y ejercicios con objetivos", () => {
    assert.equal(PLAN_LESSONS.length, PLAN_UNITS.length * 5);
    for (const u of PLAN_UNITS) {
      assert.ok(u.rule.length >= 3, u.key);
      assert.ok(u.examples.length >= 4, `${u.key}: el quiz necesita respaldo`);
      for (const d of [...u.drills, u.test]) {
        assert.ok(d.targets.length >= 3, `${u.key}: objetivos`);
        assert.ok(d.targetSec >= 30 && d.targetSec <= 120);
      }
      for (const ex of u.examples) assert.notEqual(ex.wrong, ex.right);
    }
  });

  it("las frases modelo en inglés no traen señales débiles ni huecos (se dicen tal cual)", () => {
    for (const u of PLAN_UNITS)
      for (const m of u.models) {
        assert.equal(detectWeakPhrases(m, "en").length, 0, `${u.key}: «${m}»`);
        assert.ok(!/\[/.test(m), `${u.key}: «${m}» trae corchetes`);
      }
  });

  it("la lección de la tutora lleva el patrón, los errores reales y la orden de cerrar con end_practice_session", () => {
    const u = PLAN_UNITS[0];
    const block = tutorLessonBlock(u, [`"then I share" → "then I shared"`]);
    assert.match(block, /STUDY-PLAN LESSON/);
    assert.match(block, /then I shared/);
    assert.match(block, /end_practice_session/);
    assert.match(tutorLessonOpening(u), new RegExp(u.title));
  });
});

describe("ruta", () => {
  it("sin intentos: la primera lección es la actual, las demás cerradas salvo las pruebas", () => {
    const { units, current } = planView([]);
    assert.equal(current, "pasado-regla");
    assert.equal(units[0].lessons[0].status, "current");
    assert.equal(units[0].lessons[1].status, "locked");
    for (const u of units) assert.equal(u.lessons[4].status, "available", `${u.key}: la prueba siempre abierta`);
    assert.equal(units[1].lessons[0].status, "locked");
  });

  it("aprobar abre la siguiente; un intento reprobado no", () => {
    const failed: PlanAttempt = { ...pass("pasado-regla"), score: 40, passed: false };
    assert.equal(planView([failed]).current, "pasado-regla");
    const { units, current } = planView([pass("pasado-regla")]);
    assert.equal(current, "pasado-gym1");
    assert.equal(units[0].lessons[0].status, "done");
    assert.equal(units[0].done, 1);
  });

  it("pasar la prueba de una unidad la da por hecha entera (saltar aquí)", () => {
    const { units, current } = planView([pass("pasado-prueba")]);
    assert.ok(units[0].mastered);
    assert.equal(units[0].done, 5);
    assert.equal(units[0].lessons[0].status, "skipped");
    assert.equal(current, "tercera-s-regla");
  });

  it("todo hecho: no hay lección actual", () => {
    const { current, units } = planView(PLAN_UNITS.map((u) => pass(`${u.key}-prueba`)));
    assert.equal(current, null);
    assert.ok(units.every((u) => u.mastered));
  });
});

describe("XP y racha", () => {
  it("el primer aprobado vale su base; repetir aprobado vale REPEAT_XP; reprobar no suma", () => {
    const a = pass("pasado-regla", "2026-10-19");
    const b = { ...pass("pasado-regla", "2026-10-20"), createdAt: "2026-10-20T13:00:00.000Z" };
    const c: PlanAttempt = { ...pass("pasado-gym1", "2026-10-20", 30), passed: false };
    const xp = planXp([b, c, a]);
    assert.equal(xp.total, LESSON_XP.regla + REPEAT_XP);
    assert.equal(xp.byDate["2026-10-19"], LESSON_XP.regla);
    assert.equal(xp.byDate["2026-10-20"], REPEAT_XP);
  });

  it("la racha cuenta desde hoy, o desde ayer si hoy aún no hay lección", () => {
    const days = ["2026-10-17", "2026-10-18", "2026-10-19"].map((d) => pass("pasado-regla", d));
    assert.equal(planStreak(days, "2026-10-19"), 3);
    assert.equal(planStreak(days, "2026-10-20"), 3);
    assert.equal(planStreak(days, "2026-10-21"), 0);
    const failedToday: PlanAttempt = { ...pass("pasado-gym1", "2026-10-20"), passed: false };
    assert.equal(planStreak([...days, failedToday], "2026-10-20"), 3);
  });
});

describe("errores reales → patrón", () => {
  // Notas tal cual las escribió el corrector en clases y prácticas reales.
  const cases: [string, string | null][] = [
    ['pasado: "take" → "took"; objeto completado', "pasado"],
    ['"Pasado simple: "tell" en pasado es "told"', "pasado"],
    ['sujeto singular "task" requiere verbo singular "requires"', "tercera-s"],
    ['"police" es colectivo; "kill" → "kills" (tercera persona singular)', "tercera-s"],
    ['sujeto omitido "he"; necesita verbo con sujeto explícito', "sujeto"],
    ['sujeto duplicado innecesario "it\'s"; elimina "it\'s"', "sujeto"],
    ["con tareas/proyectos se usa on, no in", "preposiciones"],
    ['La preposición correcta para "rely" es "on".', "preposiciones"],
    ['"your" innecesario; "in" → "on"; artículo "the"', "preposiciones"],
    ['"El verbo "need" seguido de un pronombre objeto requiere "to" + infinitivo.', "estructura"],
    ['Inversión: auxiliar "had" va antes del sujeto "I"', "estructura"],
    ['"prefer" requiere "to" + verbo infinitivo', "estructura"],
    ['"confidence" es incontable; usa "much" no "many"', "articulos"],
    ['"kind/kinds" plural con "those"; "those kind" es coloquial', "articulos"],
    ['"grow" es verbo; "growth" es sustantivo; después de posesivo va sustantivo', "forma-palabra"],
    ['"accomplish attack" no es idiomático; "carry out an attack" es la frase correcta', "forma-palabra"],
    ['STT error; "overfitted" es el pasado de "overfit"', null],
    ['"for me, to me" repite; usa una forma sola', null],
  ];
  for (const [note, want] of cases)
    it(`«${note.slice(0, 50)}…» → ${want}`, () => {
      assert.equal(classifyError({ quote: "x", correction: "y", note_es: note }), want);
    });
});

const session = (id: number, date: string, source: string, notes: string[]): SessionErrorsLike => ({
  id,
  started_at: `${date}T21:00:00.000Z`,
  source,
  errors: notes.map((n, i) => ({ quote: `I say it wrong number ${id}${i}`, correction: `I said it right number ${id}${i}`, note_es: n })),
});

describe("cómo va en tus clases", () => {
  it("solo cuenta clases con errores anotados (sin anotaciones = sin datos, no cero)", () => {
    const t = classTrend([
      session(1, "2026-10-07", "class", []),
      session(2, "2026-10-09", "class", ["pasado simple", "pasado simple"]),
      session(3, "2026-10-14", "web", ["pasado simple"]),
      session(4, "2026-10-20", "class", ["artículo the obligatorio"]),
    ]);
    assert.deepEqual(
      t.pasado.map((p) => [p.sessionId, p.count]),
      [
        [2, 2],
        [4, 0],
      ],
    );
    assert.equal(t.entrevista.length, 0, "la entrevista no sale de errores sueltos");
  });
});

describe("quiz de la regla", () => {
  const unit = PLAN_UNITS.find((u) => u.key === "pasado")!;

  it("usa primero tus errores reales y rellena con el temario hasta 4", () => {
    const items = quizItemsFor(unit, [session(9, "2026-10-20", "class", ["pasado simple"])]);
    assert.equal(items.length, 4);
    assert.equal(items[0].source, "Clase · 20 oct");
    assert.equal(items[1].source, null);
  });

  it("con muchos errores reales no mete ejemplos y no repite la misma corrección", () => {
    const s = session(9, "2026-10-20", "class", Array(7).fill("pasado simple"));
    s.errors[1] = { ...s.errors[0] };
    const items = quizItemsFor(unit, [s]);
    assert.equal(items.length, 5);
    assert.ok(items.every((q) => q.source));
    assert.equal(new Set(items.map((q) => q.right)).size, items.length);
  });

  it("un error que mezcla dos reglas cuenta en las métricas pero no se pregunta", () => {
    const mixed = session(9, "2026-10-20", "class", ["Plural 'options' + pasado 'said'"]);
    assert.deepEqual(patternHits(mixed.errors[0]), ["pasado", "articulos"]);
    assert.equal(classifyError(mixed.errors[0]), "pasado");
    assert.ok(quizItemsFor(unit, [mixed]).every((q) => q.source == null));
  });

  it("el orden de las opciones es estable por pregunta", () => {
    const [q] = quizItemsFor(unit, []);
    assert.equal(rightFirst(q), rightFirst({ ...q }));
  });
});

describe("lección con la tutora", () => {
  async function files() {
    const dir = await mkdtemp(join(tmpdir(), "plan-"));
    return { attempts: join(dir, "a.jsonl"), pending: join(dir, "p.json") };
  }
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const practice = (over: Partial<Parameters<typeof notePracticeSaved>[0]> = {}) => ({
    id: 77,
    source: "web",
    duration_sec: 420,
    started_at: new Date(Date.now() - 8 * 60_000).toISOString(),
    errors: [
      { quote: "I check", correction: "I checked", note_es: "pasado simple" },
      { quote: "a", correction: "b", note_es: "artículo" },
    ],
    ...over,
  });

  it("una práctica de 3+ minutos cierra la lección abierta, con los errores de ESE patrón", async () => {
    const f = await files();
    await writeFile(f.pending, JSON.stringify({ lessonId: "pasado-tutora", since }));
    const a = await notePracticeSaved(practice(), f);
    assert.ok(a?.passed);
    assert.equal(a?.tutor?.patternErrors, 1);
    assert.equal(a?.tutor?.sessionId, 77);
    assert.equal((await readAttempts(f.attempts)).length, 1);
    // La marca se consume: otra práctica no vuelve a cerrar la lección.
    assert.equal(await notePracticeSaved(practice({ id: 78 }), f), null);
  });

  it("no cuenta: una clase real, una llamada corta, ni una sesión anterior a la lección", async () => {
    for (const over of [
      { source: "class" },
      { duration_sec: 90 },
      { started_at: new Date(Date.now() - 3 * 3600_000).toISOString() },
    ]) {
      const f = await files();
      await writeFile(f.pending, JSON.stringify({ lessonId: "pasado-tutora", since }));
      assert.equal(await notePracticeSaved(practice(over), f), null, JSON.stringify(over));
    }
  });

  it("sin lección abierta, una práctica normal no toca el plan", async () => {
    const f = await files();
    assert.equal(await notePracticeSaved(practice(), f), null);
  });
});

describe("evaluación del ejercicio", () => {
  it("el prompt lleva la regla, los objetivos, los errores reales y si es la prueba", () => {
    const unit = PLAN_UNITS[0];
    const p = buildDrillUserPrompt({
      unit,
      drill: unit.test,
      transcript: "We had a bug and I check the logs.",
      durationSec: 40,
      realErrors: [`"then I share" → "then I shared"`],
      isTest: true,
    });
    assert.match(p, /PRUEBA DE LA UNIDAD/);
    assert.match(p, /then I shared/);
    for (const t of unit.test.targets) assert.ok(p.includes(t));
  });
});
