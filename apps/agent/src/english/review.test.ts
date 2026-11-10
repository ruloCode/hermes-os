/**
 * Repaso diario de inglés: un test por cada Scenario de
 * openspec/changes/v6-nucleo/specs/ingles/spec.md, más los contratos de
 * `checkTyped`, del set estable del día y del JSON que leen la web y el teléfono.
 * El servicio corre con dobles: carpeta temporal, sesiones de mentira y un
 * check-in que solo cuenta (nunca el hábito real ni Supabase).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAnswer,
  buildDaySet,
  cardsFromErrors,
  checkTyped,
  chooseOptions,
  decodeReveal,
  discardReason,
  distractorFor,
  effectiveCardState,
  emptyReviewState,
  leitnerNext,
  reviewPayload,
  reviewStreak,
  shiftDay,
  todayReview,
  withDaySet,
  type ReviewCard,
  type ReviewSessionLike,
  type ReviewState,
} from "@hermes/shared";
import { createReviewService } from "./review.js";

const TODAY = "2026-11-10";

function session(id: number, day: string, errors: ReviewSessionLike["errors"], source = "class"): ReviewSessionLike {
  // 21:30 UTC = 16:30 en Bogotá: mismo día de calendario.
  return { id, started_at: `${day}T21:30:00.000Z`, source, errors };
}

/** Doce errores limpios de inglés, cada uno distinto. */
function manyErrors(n: number): ReviewSessionLike["errors"] {
  const base = [
    ["the code have", "the code has", 'sujeto singular "code" requiere verbo singular "has"'],
    ["someone who listen first", "someone who listens first", 'tercera persona: "listen" → "listens"'],
    ["I prefer be specific", "I prefer to be specific", '"prefer" requiere "to" + verbo infinitivo'],
    ["too many confidence", "too much confidence", '"confidence" es incontable; usa "much"'],
    ["rely for", "rely on", 'La preposición correcta para "rely" es "on".'],
    ["information on internet", "information on the internet", 'artículo "the" necesario antes de "internet"'],
    ["my manager wants", "my manager wanted", "Cuando hablas de eventos pasados, el verbo debe estar en pasado simple."],
    ["I think is enough", "I think it is enough", 'sujeto omitido "it"; necesita sujeto explícito'],
    ["avoid spend", "avoid spending", '"avoid" requiere gerundio, no infinitivo'],
    ["the whole response have", "the whole response has", 'tercera persona singular: "response" → "has"'],
    ["typical fat food", "typical fried food", '"fat food" no existe; "fried food" = comida frita'],
    ["I think different", "I think differently", '"think" requiere adverbio; "differently" es adverbio'],
  ];
  return base.slice(0, n).map(([quote, correction, note_es]) => ({ quote, correction, note_es }));
}

function service(sessions: ReviewSessionLike[], opts: { now?: string } = {}) {
  let nowIso = opts.now ?? `${TODAY}T15:00:00.000Z`;
  const checkins: string[] = [];
  return mkdtemp(join(tmpdir(), "hermes-review-")).then((dir) => ({
    dir,
    checkins,
    setNow: (iso: string) => (nowIso = iso),
    svc: createReviewService({
      dir,
      loadSessions: async () => sessions,
      checkin: async (day) => void checkins.push(day),
      now: () => new Date(nowIso),
    }),
  }));
}

/** Respuesta correcta de una tarjeta, leída de su `reveal` como lo haría el teléfono. */
const rightAnswer = (c: { kind: string; reveal: string }) => decodeReveal(c.reveal).better;

describe("Requirement: Repaso diario con los errores propios", () => {
  it("Scenario: Hay errores registrados → primero las vencidas, completa con nuevas hasta 8", () => {
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(12))]);
    assert.equal(cards.length, 12);
    // Dos tarjetas ya vistas: una vencida hace 3 días, otra hace 1; una tercera aún no toca.
    const [a, b, c] = cards;
    const state: ReviewState = {
      ...emptyReviewState(),
      cards: {
        [a.id]: { box: 1, due: shiftDay(TODAY, -1), right: 1, wrong: 0, lastAnsweredAt: "2026-11-06T15:00:00Z" },
        [b.id]: { box: 2, due: shiftDay(TODAY, -3), right: 2, wrong: 0, lastAnsweredAt: "2026-11-02T15:00:00Z" },
        [c.id]: { box: 3, due: shiftDay(TODAY, 5), right: 3, wrong: 0, lastAnsweredAt: "2026-11-02T15:00:00Z" },
      },
    };
    const set = buildDaySet(cards, state, TODAY);
    assert.equal(set.length, 8);
    assert.deepEqual(set.slice(0, 2).map((i) => i.id), [b.id, a.id], "vencidas primero, la más atrasada antes");
    assert.ok(!set.some((i) => i.id === c.id), "la que no vence no entra");
    const fresh = set.slice(2).map((i) => i.id);
    assert.ok(fresh.every((id) => !state.cards[id]), "el resto son nuevas");
  });

  it("las nuevas se intercalan por patrón, empezando por el que más se repite", () => {
    const third = [
      { quote: "the code have", correction: "the code has", note_es: "tercera persona" },
      { quote: "she work here", correction: "she works here", note_es: "tercera persona" },
      { quote: "it run fast", correction: "it runs fast", note_es: "tercera persona" },
    ];
    const past = [{ quote: "yesterday I go", correction: "yesterday I went", note_es: "pasado simple" }];
    const { cards } = cardsFromErrors([session(1, "2026-11-01", [...third, ...past])]);
    const set = buildDaySet(cards, emptyReviewState(), TODAY);
    const pats = set.map((i) => cards.find((c) => c.id === i.id)!.pattern);
    assert.deepEqual(pats, ["tercera-s", "pasado", "tercera-s", "tercera-s"]);
  });

  it("Scenario: Sin errores registrados → no hay repaso (la UI lo explica)", async () => {
    const { svc } = await service([session(1, "2026-11-01", [])]);
    const review = await svc.today();
    assert.equal(review.total, 0);
    assert.equal(review.totalCards, 0);
    assert.deepEqual(review.cards, []);
    assert.equal(review.complete, false, "un repaso vacío no cuenta como completo (ni para la racha)");
  });

  it("Scenario: Error ambiguo → sin versión correcta o igual a lo dicho no es tarjeta", () => {
    assert.equal(discardReason({ quote: "I go there", correction: "" }), "sin-correccion");
    assert.equal(discardReason({ quote: "I go there yesterday", correction: "I go there yesterday." }), "igual");
    assert.equal(discardReason({ quote: "I Go There", correction: "i go there" }), "igual");
    // Recorte de un pedazo que ya estaba bien dicho.
    assert.equal(
      discardReason({ quote: "I found a critical bug in production where users couldn't add", correction: "users couldn't add" }),
      "igual",
    );
    // Articulación ("Directo: …"), repeticiones y errores del STT no son errores de inglés.
    assert.equal(discardReason({ quote: "I guess it could get messy fast", correction: "It could get messy fast", note_es: "Directo: no necesitas «I guess»" }), "articulacion");
    assert.equal(discardReason({ quote: "That, that, that's the", correction: "That's the", note_es: "repetición innecesaria; di una sola vez" }), "articulacion");
    assert.equal(discardReason({ quote: "the new card", correction: "the new car", note_es: '"card" es STT; debería ser "car"' }), "stt");
    assert.equal(discardReason({ quote: "x".repeat(120), correction: "a short fix" }), "largo");
    const { cards, discarded } = cardsFromErrors([
      session(1, "2026-11-01", [
        { quote: "I go there", correction: "" },
        { quote: "it is fine", correction: "It is fine." },
        { quote: "the code have", correction: "the code has", note_es: "tercera persona" },
      ]),
    ]);
    assert.equal(cards.length, 1);
    assert.equal(discarded.length, 2);
  });

  it("Scenario: Mismo error dos veces → una tarjeta que cuenta las dos apariciones", () => {
    const e = { quote: "I need that you tell me the plans", correction: "I need you to tell me the plans", note_es: "need + objeto + to" };
    const { cards } = cardsFromErrors([
      session(5, "2026-07-17", [e], "web"),
      // La segunda vez con otra puntuación y mayúsculas: sigue siendo el mismo error.
      session(14, "2026-10-07", [{ ...e, quote: "I need that you tell me the plans.", correction: "I need you to tell me the plans." }], "web"),
    ]);
    assert.equal(cards.length, 1);
    const [c] = cards;
    assert.equal(c.seen, 2);
    assert.equal(c.firstSeen, "2026-07-17");
    assert.equal(c.lastSeen, "2026-10-07");
    assert.equal(c.source.sessionId, 14, "la fuente es la aparición más reciente");
    // Huella estable: el mismo par da el mismo id en cualquier orden.
    const again = cardsFromErrors([session(14, "2026-10-07", [e]), session(5, "2026-07-17", [e])]);
    assert.equal(again.cards[0].id, c.id);
  });
});

describe("Requirement: Repetición espaciada", () => {
  const at = `${TODAY}T15:00:00.000Z`;

  it("Scenario: Acierto en la caja de 3 días → vuelve a los 7", () => {
    const next = leitnerNext({ box: 1, due: TODAY, right: 1, wrong: 0 }, true, TODAY, at);
    assert.equal(next.box, 2);
    assert.equal(next.due, shiftDay(TODAY, 7));
    // Una nueva que se acierta pasa a la caja de 3 días.
    assert.equal(leitnerNext(null, true, TODAY, at).due, shiftDay(TODAY, 3));
  });

  it("Scenario: Fallo → vuelve mañana (primera caja)", () => {
    const next = leitnerNext({ box: 3, due: TODAY, right: 3, wrong: 0 }, false, TODAY, at);
    assert.equal(next.box, 0);
    assert.equal(next.due, shiftDay(TODAY, 1));
    assert.equal(next.wrong, 1);
  });

  it("Scenario: Dominada → acierto en la caja de 35 días; solo vuelve si el error reaparece", () => {
    const e = { quote: "the code have", correction: "the code has", note_es: "tercera persona" };
    const { cards } = cardsFromErrors([session(1, "2026-09-01", [e])]);
    const card = cards[0];
    const mastered = leitnerNext({ box: 4, due: TODAY, right: 4, wrong: 0 }, true, TODAY, at);
    assert.ok(mastered.masteredAt);
    const state: ReviewState = { ...emptyReviewState(), cards: { [card.id]: mastered } };
    // Ni dentro de un año entra al repaso.
    assert.equal(buildDaySet(cards, state, shiftDay(TODAY, 400)).length, 0);
    assert.equal(reviewPayload(cards, state, TODAY).mastered, 1);
    // Reaparece en una clase posterior → primera caja, toca desde ese día.
    const later = cardsFromErrors([session(1, "2026-09-01", [e]), session(9, "2026-11-20", [e])]).cards;
    const eff = effectiveCardState(later[0], state.cards[card.id]);
    assert.equal(eff?.masteredAt, undefined);
    assert.equal(eff?.box, 0);
    assert.deepEqual(buildDaySet(later, state, "2026-11-20").map((i) => i.id), [card.id]);
  });
});

describe("Requirement: Dos formas de responder", () => {
  it("Scenario: Escribir con diferencias menores → acierto", () => {
    const ok: [string, string][] = [
      ["the code has", "The code has."],
      ["  The   code HAS ", "the code has"],
      ["I don’t completely understand what happened", "I don't completely understand what happened"],
      ["I do not completely understand what happened", "I don't completely understand what happened"],
      ["I'm outside my home", "I am outside my home"],
      ["It's enough", "it is enough"],
      ["I would argue that", "I'd argue that"],
      ["they're really technical!", "They are really technical"],
      ["you can not do it", "you can't do it"],
      ["“the best model”", "the best model"],
      ["problem solving skill", "problem-solving skill"],
      ["I won't go", "I will not go"],
    ];
    for (const [answer, better] of ok) assert.ok(checkTyped(answer, better), `${answer} ≈ ${better}`);
    // Alternativas que dio el corrector también valen.
    assert.ok(checkTyped("a physician", "a doctor", ["a physician"]));
  });

  it("checkTyped NO perdona un error de gramática", () => {
    const bad: [string, string][] = [
      ["he go", "he goes"],
      ["the code have", "the code has"],
      ["I prefer be specific", "I prefer to be specific"],
      ["information on internet", "information on the internet"],
      ["my manager wants", "my manager wanted"],
      ["too many confidence", "too much confidence"],
      ["", "the code has"],
      ["the code", "the code has"],
      ["people's opinion", "peoples opinion"],
    ];
    for (const [answer, better] of bad) assert.equal(checkTyped(answer, better), false, `${answer} ≠ ${better}`);
  });

  it("Scenario: Elegir → las opciones traen lo dicho y la correcta, en orden que cambia", () => {
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(12))]);
    const card = cards.find((c) => c.said === "the code have")!;
    const orders = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const opts = chooseOptions(card, cards, shiftDay(TODAY, i));
      assert.ok(opts.includes(card.said) && opts.includes(card.better));
      assert.deepEqual(opts, chooseOptions(card, cards, shiftDay(TODAY, i)), "determinista por tarjeta y día");
      orders.add(opts.join("|"));
    }
    assert.ok(orders.size > 1, "el orden cambia entre días");
  });

  it("el distractor sale del mismo tipo de error de OTRA tarjeta del mismo patrón, o no hay", () => {
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(12))]);
    // "the whole response have/has" (tercera-s) le da a "the code has" el distractor "the code have"? No:
    // ese es justo lo que dijiste, así que no sirve; un distractor nunca repite lo dicho ni lo correcto.
    for (const c of cards) {
      const d = distractorFor(c, cards);
      if (!d) continue;
      assert.notEqual(d.toLowerCase(), c.better.toLowerCase());
      assert.notEqual(d.toLowerCase(), c.said.toLowerCase());
    }
    const onlyOne = cardsFromErrors([session(1, "2026-11-01", manyErrors(1))]).cards;
    assert.equal(distractorFor(onlyOne[0], onlyOne), null);
    assert.equal(chooseOptions(onlyOne[0], onlyOne, TODAY).length, 2);
    // "rely for → rely on" (preposiciones) aplicado a otra frase con "on" del mismo patrón.
    const preps = cardsFromErrors([
      session(1, "2026-11-01", [
        { quote: "rely for", correction: "rely on", note_es: "La preposición correcta para rely es on" },
        { quote: "I have been working in this feature", correction: "I have been working on this feature", note_es: "preposición: on, no in" },
      ]),
    ]).cards;
    const working = preps.find((c) => c.said.startsWith("I have"))!;
    assert.equal(distractorFor(working, preps), "I have been working for this feature");
  });
});

describe("Requirement: Racha y avance", () => {
  it("Scenario: Repaso completo → cuenta para la racha y marca el hábito una sola vez", async () => {
    const { svc, checkins, dir } = await service([session(1, "2026-11-01", manyErrors(3))]);
    const first = await svc.today();
    assert.equal(first.total, 3);
    assert.equal(first.streak, 0);
    let n = 0;
    for (const c of first.cards) {
      const r = await svc.answer({ cardId: c.id, kind: c.kind, answer: rightAnswer(c), clientId: `w-${n++}` });
      assert.equal(r.result.ok, true);
    }
    const done = await svc.today();
    assert.equal(done.complete, true);
    assert.equal(done.done, 3);
    assert.equal(done.correct, 3);
    assert.equal(done.streak, 1);
    assert.deepEqual(checkins, [TODAY]);
    // Repetir una respuesta (mismo o distinto clientId) no vuelve a marcar.
    const c0 = first.cards[0];
    await svc.answer({ cardId: c0.id, kind: c0.kind, answer: rightAnswer(c0), clientId: "w-0" });
    const again = await svc.answer({ cardId: c0.id, kind: c0.kind, answer: "nope", clientId: "otro" });
    assert.equal(again.result.ok && again.result.already, true);
    assert.equal(again.result.ok && again.result.correct, true, "vale la primera respuesta");
    assert.deepEqual(checkins, [TODAY]);
    const lines = (await readFile(join(dir, "answers.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 3);
  });

  it("racha: días seguidos con el repaso completo, desde hoy o desde ayer", () => {
    const day = (completed: boolean) => ({ items: [{ id: "x", kind: "type" as const }], results: {}, ...(completed ? { completedAt: "t" } : {}) });
    const state: ReviewState = {
      ...emptyReviewState(),
      days: { "2026-11-07": day(true), "2026-11-08": day(true), "2026-11-09": day(true), [TODAY]: day(false), "2026-11-05": day(true) },
    };
    assert.equal(reviewStreak(state, TODAY), 3, "hoy aún no: cuenta desde ayer");
    state.days[TODAY] = day(true);
    assert.equal(reviewStreak(state, TODAY), 4);
    assert.equal(reviewStreak(state, "2026-11-12"), 0);
  });

  it("el set del día es estable: responder 3 y volver deja las otras 5", async () => {
    const { svc } = await service([session(1, "2026-11-01", manyErrors(12))]);
    const first = await svc.today();
    assert.equal(first.total, 8);
    for (const c of first.cards.slice(0, 3))
      await svc.answer({ cardId: c.id, kind: c.kind, answer: "wrong on purpose", clientId: `x-${c.id}` });
    const back = await svc.today();
    assert.deepEqual(back.cards.map((c) => c.id), first.cards.map((c) => c.id));
    assert.equal(back.cards.filter((c) => !c.answered).length, 5);
    assert.equal(back.done, 3);
    assert.equal(back.correct, 0);
    assert.equal(back.dueTomorrow, 3, "los fallos vuelven mañana");
    // Puro: un set guardado manda sobre uno nuevo.
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(12))]);
    const saved = withDaySet(emptyReviewState(), TODAY, [{ id: cards[11].id, kind: "type" }]);
    assert.deepEqual(todayReview(cards, saved, TODAY).items.map((i) => i.id), [cards[11].id]);
  });
});

describe("Requirement: Disponible en la web y en el teléfono", () => {
  it("Scenario: Teléfono sin conexión → las respuestas suben al reconectar, sin duplicarse", async () => {
    const t = await service([session(1, "2026-11-01", manyErrors(4))], { now: "2026-11-09T23:00:00.000Z" });
    // El teléfono baja el repaso el 9 en la noche (Bogotá) y responde sin red, dos antes y dos después de medianoche.
    const downloaded = await t.svc.today();
    assert.equal(downloaded.day, "2026-11-09");
    const queue = downloaded.cards.map((c, i) => ({
      cardId: c.id,
      kind: c.kind,
      answer: rightAnswer(c),
      clientId: `phone-${i}`,
      answeredAt: i < 2 ? "2026-11-10T03:00:00.000Z" : "2026-11-10T06:00:00.000Z",
      day: downloaded.day,
    }));
    t.setNow("2026-11-10T14:00:00.000Z");
    const up = await t.svc.answers(queue);
    assert.ok(up.results.every((r) => r.ok && !r.duplicate));
    // El reintento del mismo lote (se cortó la red antes de la respuesta) no cuenta dos veces.
    const retry = await t.svc.answers(queue);
    assert.ok(retry.results.every((r) => r.ok && r.duplicate));
    const lines = (await readFile(join(t.dir, "answers.jsonl"), "utf8")).trim().split("\n");
    assert.equal(lines.length, 4);
    assert.deepEqual(t.checkins, ["2026-11-09"], "el hábito se marca en el día del repaso, una vez");
  });

  it("respuestas fuera de margen o mal formadas se rechazan con motivo", async () => {
    const t = await service([session(1, "2026-11-01", manyErrors(2))]);
    const r = await t.svc.today();
    const c = r.cards[0];
    const old = await t.svc.answer({ cardId: c.id, answer: "x", clientId: "a", answeredAt: "2026-10-01T00:00:00Z" });
    assert.equal(old.result.ok, false);
    assert.equal((await t.svc.answer({ cardId: c.id, answer: "x" })).result.ok, false, "sin clientId");
    assert.equal((await t.svc.answer({ cardId: "nada", answer: "x", clientId: "b" })).result.ok, false);
    assert.equal((await t.svc.answer({ cardId: c.id, answer: "  ", clientId: "c" })).result.ok, false);
    // Un reloj adelantado no fecha en el futuro: cuenta como ahora.
    const fut = await t.svc.answer({ cardId: c.id, answer: rightAnswer(c), clientId: "d", answeredAt: "2027-01-01T00:00:00Z" });
    assert.equal(fut.result.ok && fut.result.correct, true);
  });

  it("contrato: la tarjeta de escribir no trae la solución en claro; `reveal` sí, codificada", () => {
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(12))]);
    const p = reviewPayload(cards, emptyReviewState(), TODAY);
    for (const v of p.cards) {
      const card = cards.find((c) => c.id === v.id)!;
      const plain = JSON.stringify({ ...v, reveal: undefined });
      if (v.kind === "type") {
        assert.equal(v.said, card.said);
        assert.ok(!plain.includes(JSON.stringify(card.better)), "la correcta no viaja en claro");
        assert.equal(v.options, undefined);
      } else {
        assert.equal(v.said, undefined, "en elegir no se marca cuál es lo que dijiste");
        assert.ok(v.options!.includes(card.better));
      }
      const rev = decodeReveal(v.reveal);
      assert.equal(rev.better, card.better);
      assert.equal(rev.said, card.said);
      assert.match(rev.source.label, /^(Clase|Práctica) · \d+ [a-z]{3}$/);
    }
  });

  it("stats por patrón: tarjetas, dominadas y acierto de 14 días", async () => {
    const t = await service([session(1, "2026-11-01", manyErrors(4))]);
    const r = await t.svc.today();
    for (const [i, c] of r.cards.entries())
      await t.svc.answer({ cardId: c.id, answer: i % 2 ? "mal" : rightAnswer(c), clientId: `s-${i}` });
    const s = await t.svc.stats();
    assert.equal(s.totalCards, 4);
    assert.equal(s.patterns.reduce((n, p) => n + p.cards, 0), 4);
    assert.equal(s.patterns.reduce((n, p) => n + p.answered14, 0), 4);
    const acc = s.patterns.filter((p) => p.accuracy14 != null);
    assert.ok(acc.every((p) => p.accuracy14! >= 0 && p.accuracy14! <= 1));
  });

  it("applyAnswer puro rechaza una tarjeta que no es del set de ese día", () => {
    const { cards } = cardsFromErrors([session(1, "2026-11-01", manyErrors(2))]);
    const r = applyAnswer(emptyReviewState(), cards[0] as ReviewCard, { day: TODAY, correct: true, answeredAt: `${TODAY}T15:00:00Z` });
    assert.equal(r.ok, false);
  });
});
