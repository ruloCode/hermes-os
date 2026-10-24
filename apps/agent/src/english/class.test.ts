/**
 * Clase de inglés EN VIVO: contratos de la lógica pura (shared/english-class)
 * y de las reglas de disparo del ClassCompanionController con motores falsos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  classSpeakerNames,
  computeClassMetrics,
  correctable,
  correctionsFromSuggestions,
  guessLang,
  inferSelfSpeaker,
  looksLikeSilence,
  micHealth,
  parseClassHelp,
  type SourceEnergy,
  correctionText,
  parseCorrection,
  type LiveSegment,
  type LiveSuggestion,
} from "@hermes/shared";
import {
  askOf,
  buildHelpSystemPrompt,
  ClassCompanionController,
  CORRECTION_ID_PREFIX,
  worthAnswering,
} from "./class-companion.js";
import type { FastEngine, FastGenRequest } from "../meetings/live-copilot.js";
import type { NormalizedTurn } from "../meetings/live-stt.js";
import { countFillers } from "../meetings/live-coach.js";

const seg = (speaker: string, text: string, startMs: number, endMs: number): LiveSegment => ({
  id: `${speaker}-${startMs}`,
  speaker,
  text,
  startMs,
  endMs,
  final: true,
});

describe("parseCorrection", () => {
  it("lee «dijo → mejor | regla»", () => {
    assert.deepEqual(parseCorrection("yesterday I go → yesterday I went | pasado simple de go"), {
      quote: "yesterday I go",
      correction: "yesterday I went",
      note_es: "pasado simple de go",
    });
  });

  it("acepta -> y comillas alrededor", () => {
    const e = parseCorrection('"I have 30 years" -> "I am 30 years old"');
    assert.equal(e?.quote, "I have 30 years");
    assert.equal(e?.correction, "I am 30 years old");
    assert.equal(e?.note_es, undefined);
  });

  it("el silencio del modelo no es una corrección", () => {
    assert.equal(parseCorrection("—"), null);
    assert.equal(parseCorrection("  -  "), null);
    assert.equal(parseCorrection(""), null);
  });

  it("sin flecha o idéntica al original = formato roto, se descarta", () => {
    assert.equal(parseCorrection("Todo bien, sin errores"), null);
    assert.equal(parseCorrection("I went → I went. | nada"), null);
  });

  it("sin «lo que dijo» no es corrección aunque la regla traiga una flecha", () => {
    assert.equal(
      parseCorrection('One client wants an agent | tercera persona; "for answer → to answer"'),
      null,
    );
  });

  it("forma | regla sin «lo que dijo»: se arma con lo que se mandó a corregir", () => {
    const said = "One client want a agent for answer the emails";
    assert.deepEqual(parseCorrection("One client wants an agent to answer the emails | want → wants", said), {
      quote: said,
      correction: "One client wants an agent to answer the emails",
      note_es: "want → wants",
    });
    // Sin regla ni flecha no es una corrección: es texto suelto.
    assert.equal(parseCorrection("Looks fine to me", said), null);
  });

  it("solo mira la primera línea", () => {
    const e = parseCorrection("depending of → depending on | preposición\nOtra cosa");
    assert.equal(e?.correction, "depending on");
  });
});

describe("correctionsFromSuggestions", () => {
  const sug = (id: string, text: string, why: string, kind: LiveSuggestion["kind"] = "corregir") =>
    ({ id, kind, text, why, atMs: 0 }) as LiveSuggestion;

  it("ida y vuelta con correctionText, dedupe por forma y solo kind corregir", () => {
    const a = { quote: "I go", correction: "I went", note_es: "pasado" };
    const out = correctionsFromSuggestions([
      sug("1", correctionText(a), a.note_es),
      sug("2", "i go → I went.", "otra vez"), // mismo error, distinta puntuación
      sug("3", "Clave: weekend", "", "andamio"),
      sug("4", "is depending of → depends on", "presente simple"),
    ]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], a);
    assert.equal(out[1].correction, "depends on");
  });

  it("respeta el tope", () => {
    const many = Array.from({ length: 30 }, (_, i) => sug(String(i), `error ${i} → fix ${i}`, ""));
    assert.equal(correctionsFromSuggestions(many, 20).length, 20);
  });
});

describe("guessLang", () => {
  it("inglés sin the/and/you también es inglés (el bug que dejaba frases sin corregir)", () => {
    assert.equal(guessLang("Yes, I make a similar agent last year for a restaurant."), "en");
    assert.equal(guessLang("One client want a agent for answer the emails of his company."), "en");
  });
  it("español se reconoce aunque traiga palabras técnicas en inglés", () => {
    assert.equal(guessLang("no sé cómo se dice eso en inglés"), "es");
    assert.equal(guessLang("pues hice el deploy del agent ayer"), "es");
  });
  it("en empate deciden los acentos", () => {
    assert.equal(guessLang("dashboard API"), "en");
    assert.equal(guessLang("¿dashboard?"), "es");
  });
});

describe("correctable", () => {
  it("inglés de 5+ palabras sí; corto o en español no", () => {
    assert.equal(correctable("Yesterday I go to the park with my family"), true);
    assert.equal(correctable("Yes, sure"), false);
    assert.equal(correctable("no sé cómo se dice eso en inglés la verdad"), false);
  });
});

describe("classSpeakerNames", () => {
  const segs = [seg("A", "Hi", 0, 1000), seg("B", "Hello", 1000, 2000)];
  it("tú = Yo, la otra voz = Profe", () => {
    assert.deepEqual(classSpeakerNames(segs, "B", {}), { A: "Profe", B: "Yo" });
  });
  it("un nombre puesto a mano manda", () => {
    assert.deepEqual(classSpeakerNames(segs, "B", { A: "Sarah" }), { A: "Sarah", B: "Yo" });
  });
  it("sin saber quién eres, no se inventan nombres", () => {
    assert.deepEqual(classSpeakerNames(segs, undefined, {}), {});
  });
});

describe("computeClassMetrics", () => {
  it("share, palabras, turnos en español y correcciones por 100 palabras", () => {
    const segs = [
      seg("A", "How was your weekend and what did you do", 0, 3000),
      seg("B", "It was good, I go to the park with my family", 3000, 6000), // 11 palabras
      seg("B", "no sé cómo se dice", 6000, 7000), // 5 palabras, español
      { ...seg("B", "parcial que no cuenta", 7000, 9000), final: false },
    ];
    const m = computeClassMetrics(segs, "B", 2);
    assert.ok(m);
    assert.equal(m.selfShare, 0.57); // 4000 / 7000
    assert.equal(m.selfWords, 16);
    assert.equal(m.selfTurns, 2);
    assert.equal(m.spanishTurns, 1);
    assert.equal(m.correctionsPer100, 12.5);
  });
  it("sin selfSpeaker no hay métricas (no se adivina quién eres)", () => {
    assert.equal(computeClassMetrics([seg("A", "hi there", 0, 1000)], undefined, 0), undefined);
  });
});

describe("countFillers en clase", () => {
  it("modo en no cuenta 'este'/'pues' (eso es caída al español, no muletilla)", () => {
    const t = "um so este I think, like, pues it works";
    assert.equal(countFillers(t), 4);
    assert.equal(countFillers(t, "en"), 2);
  });
});

// ── Controller con motores falsos ───────────────────────────────────────

class SpyEngine implements FastEngine {
  readonly reqs: FastGenRequest[] = [];
  destroyed = false;
  session = 1;
  epoch(): number {
    return this.session;
  }
  generate(req: FastGenRequest): void {
    // Como un motor libre: el prompt se arma al enviarse, para este motor.
    this.reqs.push({ ...req, prompt: req.promptFor ? req.promptFor(this) : req.prompt });
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function setup() {
  const correct = new SpyEngine();
  const help = new SpyEngine();
  const ctl = new ClassCompanionController(correct, help, { selfMergeMs: 20 });
  return { correct, help, ctl };
}

let k = 0;
const turn = (speaker: string, text: string, final = true, endOfTurn = final): NormalizedTurn => ({
  key: `t-${k++}`,
  speaker,
  text,
  startMs: 0,
  endMs: 1000,
  final,
  endOfTurn,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("ClassCompanionController", () => {
  it("por defecto, la pregunta de la profe trae la FRASE completa sola", () => {
    const { help, correct, ctl } = setup();
    ctl.onTurn(turn("A", "How was your weekend? What did you do?"), "B");
    assert.equal(help.reqs.length, 1);
    assert.equal(help.reqs[0].kind, "decir");
    assert.equal(help.reqs[0].manual, false);
    assert.match(help.reqs[0].prompt, /FRASE \(automática\)/);
    assert.equal(correct.reqs.length, 0);
    ctl.destroy();
  });

  it("autoHelp se cambia en caliente: andamio y luego nada", () => {
    const { help, ctl } = setup();
    ctl.setAutoHelp("scaffold");
    ctl.onTurn(turn("A", "What do you do for work?"), "B");
    assert.equal(help.reqs[0]?.kind, "andamio");
    assert.match(help.reqs[0].prompt, /ANDAMIO/);
    ctl.setAutoHelp("off");
    ctl.onTurn({ ...turn("A", "And where do you live?"), key: "otra" }, "B");
    assert.equal(help.reqs.length, 1);
    ctl.destroy();
  });

  it("la profe comenta sin preguntar → algo para seguir la conversación (no solo preguntas)", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "I spent the weekend in the mountains with my family, it was freezing."), "B");
    assert.equal(help.reqs.length, 1);
    assert.equal(help.reqs[0].kind, "decir");
    assert.equal(help.reqs[0].manual, false);
    assert.match(help.reqs[0].prompt, /Modo: SEGUIR\. [\s\S]*mountains/);
    // En un monólogo no sale una tarjeta por cada final.
    ctl.onTurn(turn("A", "We stayed in a small cabin near the lake for two nights."), "B");
    assert.equal(help.reqs.length, 1);
    ctl.destroy();
  });

  it("seguir: con andamio pide Clave/Arranca; corto, en español, sin 'soy yo' u off no sale", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "That sounds lovely."), "B"); // corto
    ctl.onTurn(turn("A", "bueno, aquí tienes que usar el pasado simple siempre"), "B"); // español
    ctl.onTurn(turn("A", "I really love that kind of music, especially the old stuff."), undefined); // sin soy yo
    assert.equal(help.reqs.length, 0);
    ctl.setAutoHelp("scaffold");
    ctl.onTurn(turn("A", "I really love that kind of music, especially the old stuff."), "B");
    assert.equal(help.reqs[0]?.kind, "andamio");
    assert.match(help.reqs[0].prompt, /SEGUIR \(andamio\)/);
    const off = setup();
    off.ctl.setAutoHelp("off");
    off.ctl.onTurn(turn("A", "I really love that kind of music, especially the old stuff."), "B");
    assert.equal(off.help.reqs.length, 0);
    ctl.destroy();
    off.ctl.destroy();
  });

  it("una pregunta justo después de un comentario sí sale (las preguntas no esperan los 7 s)", async () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "I spent the weekend in the mountains with my family, it was freezing."), "B");
    await wait(1_300);
    ctl.onTurn(turn("A", "And what did you do last weekend?"), "B");
    assert.equal(help.reqs.length, 2);
    assert.match(help.reqs[1].prompt, /FRASE \(automática\)/);
    ctl.destroy();
  });

  it("tu intervención se junta y se corrige cuando la profe responde", () => {
    const { correct, ctl } = setup();
    ctl.onTurn(turn("B", "Yesterday I go to the park"), "B");
    ctl.onTurn(turn("B", "with my family and we eat empanadas"), "B");
    assert.equal(correct.reqs.length, 0); // todavía puedes seguir hablando
    ctl.onTurn(turn("A", "That sounds lovely."), "B");
    assert.equal(correct.reqs.length, 1);
    const r = correct.reqs[0];
    assert.equal(r.kind, "corregir");
    assert.ok(r.id.startsWith(CORRECTION_ID_PREFIX));
    assert.match(r.prompt, /Yesterday I go to the park with my family and we eat empanadas/);
    ctl.destroy();
  });

  it("también se corrige tras el silencio aunque la profe no hable", async () => {
    const { correct, ctl } = setup();
    ctl.onTurn(turn("B", "I am agree with you about that point"), "B");
    await wait(40);
    assert.equal(correct.reqs.length, 1);
    ctl.destroy();
  });

  it("lo dicho en español o muy corto no va al corrector", async () => {
    const { correct, ctl } = setup();
    ctl.onTurn(turn("B", "no sé cómo se dice eso en inglés la verdad"), "B");
    ctl.onTurn(turn("A", "Okay."), "B");
    ctl.onTurn(turn("B", "Yes sure"), "B");
    await wait(40);
    assert.equal(correct.reqs.length, 0);
    ctl.destroy();
  });

  it("sin 'soy yo' no hay correcciones (no se sabe qué voz es la tuya)", async () => {
    const { correct, ctl } = setup();
    ctl.onTurn(turn("B", "Yesterday I go to the park with my family"), undefined);
    await wait(40);
    assert.equal(correct.reqs.length, 0);
    ctl.destroy();
  });

  it("tus propias preguntas no disparan andamio", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("B", "Can you repeat the question please?"), "B");
    assert.equal(help.reqs.length, 0);
    ctl.destroy();
  });

  it("a mano: explicar y frase completa", () => {
    const { help, ctl } = setup();
    ctl.setAutoHelp("off");
    ctl.onTurn(turn("A", "How was your weekend?"), "B");
    ctl.triggerNow(undefined, "explain");
    ctl.triggerNow(undefined, "full");
    ctl.triggerNow();
    assert.deepEqual(
      help.reqs.map((r) => [r.kind, r.manual]),
      [
        ["explicar", true],
        ["decir", true],
        ["andamio", true],
      ],
    );
    assert.match(help.reqs[0].prompt, /EXPLICAR[\s\S]*How was your weekend/);
    ctl.destroy();
  });

  it("con autoHelp off la pregunta no dispara nada, pero la corrección y el botón sí", () => {
    const correct = new SpyEngine();
    const help = new SpyEngine();
    const ctl = new ClassCompanionController(correct, help, { selfMergeMs: 20, autoHelp: "off" });
    ctl.onTurn(turn("yo", "Yesterday I go to the cinema with my friends"), "yo");
    ctl.onTurn(turn("tutora", "Nice! What did you watch?"), "yo");
    assert.equal(help.reqs.length, 0);
    assert.equal(correct.reqs.length, 1);
    ctl.triggerNow(); // "Ayúdame" a mano sí funciona
    assert.equal(help.reqs[0]?.kind, "andamio");
    ctl.destroy();
  });

  it("contexto: la primera vez va la conversación entera; después, solo lo nuevo", () => {
    const { help, ctl } = setup();
    ctl.setAutoHelp("off");
    ctl.onTurn(turn("A", "Hi! I'm Sarah, your teacher today."), "B");
    ctl.onTurn(turn("B", "Nice to meet you, I am Rulo from Bogota."), "B");
    ctl.triggerNow(undefined, "full");
    assert.match(help.reqs[0].prompt, /Conversación hasta ahora[\s\S]*I'm Sarah[\s\S]*from Bogota/);
    ctl.onTurn(turn("A", "Where do you work?"), "B");
    ctl.triggerNow(undefined, "full");
    const second = help.reqs[1].prompt;
    assert.match(second, /Líneas nuevas[\s\S]*Where do you work/);
    assert.doesNotMatch(second, /I'm Sarah/); // la sesión ya lo vio
    ctl.destroy();
  });

  it("si la sesión del modelo se reinicia, se reenvía la conversación entera", () => {
    const { help, ctl } = setup();
    ctl.setAutoHelp("off");
    ctl.onTurn(turn("A", "Hi! I'm Sarah, your teacher today."), "B");
    ctl.triggerNow(undefined, "full");
    help.session = 2; // la sesión murió y arranca de cero
    ctl.onTurn(turn("A", "Where do you work?"), "B");
    ctl.triggerNow(undefined, "full");
    assert.match(help.reqs[1].prompt, /Conversación hasta ahora[\s\S]*I'm Sarah[\s\S]*Where do you work/);
    ctl.destroy();
  });

  it("la pregunta en streaming dispara antes, y el final de esa misma pregunta no repite", () => {
    const { help, ctl } = setup();
    ctl.onPartialOther("That's great. So tell me");
    assert.equal(help.reqs.length, 0); // aún no hay pregunta completa
    ctl.onPartialOther("That's great. So tell me, what do you do for work?");
    assert.equal(help.reqs.length, 1);
    assert.match(help.reqs[0].prompt, /aún está hablando/);
    ctl.onTurn(turn("A", "That's great. So tell me, what do you do for work? I'm curious."), "B");
    assert.equal(help.reqs.length, 1);
    ctl.destroy();
  });

  it("una orden sin '?' también pide respuesta", () => {
    assert.equal(askOf("Okay, nice. Tell me about your last trip."), "Tell me about your last trip.");
    assert.equal(askOf("That sounds lovely."), null);
  });

  it("destroy apaga ambos motores y no dispara más", async () => {
    const { help, correct, ctl } = setup();
    ctl.onTurn(turn("B", "Yesterday I go to the park with my family"), "B");
    ctl.destroy();
    await wait(40);
    ctl.triggerNow();
    assert.equal(correct.reqs.length, 0);
    assert.equal(help.reqs.length, 0);
    assert.ok(help.destroyed && correct.destroyed);
  });
});

describe("inferSelfSpeaker", () => {
  // Reloj de 100 ms: la profe (A) suena en la pestaña, tú (B) en el mic.
  const frames = (spans: { from: number; to: number; mic: number; tab: number }[]): SourceEnergy[] => {
    const out: SourceEnergy[] = [];
    for (let ms = 0; ms <= 20_000; ms += 100) {
      const span = spans.find((s) => ms >= s.from && ms < s.to);
      out.push({ ms, mic: span?.mic ?? 0.001, tab: span?.tab ?? 0.001 });
    }
    return out;
  };
  const turns = [
    seg("A", "How was your weekend?", 0, 2000),
    seg("B", "It was good thanks", 2000, 4000),
    seg("A", "What did you do?", 4000, 6000),
    seg("B", "I went to the park", 6000, 8000),
  ];
  const energy = frames([
    { from: 0, to: 2000, mic: 0.002, tab: 0.08 },
    { from: 2000, to: 4000, mic: 0.09, tab: 0.002 },
    { from: 4000, to: 6000, mic: 0.003, tab: 0.07 },
    { from: 6000, to: 8000, mic: 0.1, tab: 0.001 },
  ]);

  it("la voz que coincide con el mic eres tú", () => {
    assert.equal(inferSelfSpeaker(turns, energy), "B");
  });

  it("con un solo turno tuyo todavía no decide", () => {
    assert.equal(inferSelfSpeaker(turns.slice(0, 2), energy), undefined);
  });

  it("con eco en el mic decide por tus turnos limpios; con todo por el mic no adivina", () => {
    const leaky = frames([
      { from: 0, to: 2000, mic: 0.08, tab: 0.08 },
      { from: 2000, to: 4000, mic: 0.09, tab: 0.002 },
      { from: 4000, to: 6000, mic: 0.07, tab: 0.07 },
      { from: 6000, to: 8000, mic: 0.1, tab: 0.001 },
    ]);
    // B sigue siendo el único con mic dominante: decide B (la profe empata, no vota).
    assert.equal(inferSelfSpeaker(turns, leaky), "B");
    // Pero si las dos voces salen solo por el mic (presencial), no hay a quién elegir.
    const micOnly = frames([{ from: 0, to: 8000, mic: 0.08, tab: 0.001 }]);
    assert.equal(inferSelfSpeaker(turns, micOnly), undefined);
  });

  it("sin energía registrada no decide", () => {
    assert.equal(inferSelfSpeaker(turns, []), undefined);
  });
});

// ── Clase del 16-oct: lo que se aprendió de la sesión real ─────────────

describe("worthAnswering (preguntas de trámite)", () => {
  it("las de confirmar audio o ritmo no piden una frase", () => {
    for (const q of [
      "Sound good?",
      "Can you hear me okay now?",
      "Okay, so sound good?",
      "Which one?",
      "Did you hear me?",
      "Ready?",
      "What's that?",
      "How do you spell that?",
    ])
      assert.equal(worthAnswering(q), false, q);
  });

  it("las preguntas de verdad sí", () => {
    for (const q of [
      "What would you say are some of your strengths?",
      "Tell me a little bit about yourself.",
      "How did the protest go in Bogotá?",
      "Can you justify the price to me?",
    ])
      assert.equal(worthAnswering(q), true, q);
  });

  it("una pregunta de trámite no arranca ayuda; la siguiente de verdad sí", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "We'll do the homework and then a mini interview. Sound good?"), "B");
    assert.equal(help.reqs.length, 0);
    ctl.onTurn(turn("A", "So first question. What opportunities are you looking for?"), "B");
    assert.equal(help.reqs.length, 1);
    assert.match(help.reqs[0].trigger, /opportunities/);
    ctl.destroy();
  });
});

describe("parseClassHelp", () => {
  it("FRASE: lo que se dice y la expresión que sube el nivel, por separado", () => {
    const p = parseClassHelp(
      "Our app crashed under heavy load, so I moved the slow work to a queue.\nSube: under heavy load = con mucha carga",
    );
    assert.equal(p.main, "Our app crashed under heavy load, so I moved the slow work to a queue.");
    assert.deepEqual(p.levelUp, { expr: "under heavy load", meaning: "con mucha carga" });
  });

  it("ANDAMIO: chips y arranque sin comillas", () => {
    const p = parseClassHelp('Clave: trade-off (compromiso) · on the roadmap (en los planes)\nArranca: "The hardest part was…"');
    assert.deepEqual(p.keys, ["trade-off (compromiso)", "on the roadmap (en los planes)"]);
    assert.equal(p.start, "The hardest part was…");
    assert.equal(p.levelUp, null);
  });

  it("a medio streamear, lo que no tiene prefijo es el texto principal", () => {
    assert.equal(parseClassHelp("It's been a busy").main, "It's been a busy");
  });

  it("el silencio del modelo (o su primer carácter) no es tarjeta", () => {
    assert.ok(looksLikeSilence(""));
    assert.ok(looksLikeSilence("—"));
    assert.ok(looksLikeSilence(" — "));
    assert.ok(!looksLikeSilence("— well"));
    assert.ok(!looksLikeSilence("It"));
  });
});

describe("prompt de ayuda: articulación", () => {
  const prompt = buildHelpSystemPrompt({ recurring: [] });
  it("trae las reglas que la profe corrigió en clases reales", () => {
    assert.match(prompt, /so yeah/);
    assert.match(prompt, /I haven't been in that situation yet/);
    assert.match(prompt, /dos partes/);
    assert.match(prompt, /sujeto explícito/);
  });
  it("el ejemplo de FRASE usa el prefijo que la UI sabe leer", () => {
    const example = prompt.split("Ejemplo de FRASE")[1] ?? "";
    assert.ok(parseClassHelp(example.split("\n").slice(1, 3).join("\n")).levelUp);
  });
});

describe("micHealth", () => {
  /** Frames de 100 ms durante `secs`, con la energía que diga cada fuente. */
  const frames = (secs: number, mic: (t: number) => number, tab: (t: number) => number): SourceEnergy[] =>
    Array.from({ length: secs * 10 }, (_, i) => ({ ms: i * 100, mic: mic(i * 100), tab: tab(i * 100) }));

  it("la profe habla y tu mic no tiene voz en 90 s: silent", () => {
    assert.equal(micHealth(frames(100, () => 0.002, (t) => (t % 4000 < 2000 ? 0.08 : 0.001)), []), "silent");
  });

  it("hablas a ratos: todo bien", () => {
    assert.equal(
      micHealth(frames(100, (t) => (t % 10_000 < 3000 ? 0.05 : 0.002), (t) => (t % 10_000 >= 3000 ? 0.08 : 0.001)), []),
      null,
    );
  });

  it("menos de 90 s de audio todavía no decide", () => {
    assert.equal(micHealth(frames(60, () => 0, () => 0.1), []), null);
  });

  it("el mic suena pero el STT casi no te transcribe (la clase del 16-oct): lopsided", () => {
    const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    const segs = [
      seg("A", words(150), 0, 60_000),
      seg("B", "Okay.", 61_000, 61_500),
      seg("A", words(150), 62_000, 120_000),
      seg("B", "Wow.", 121_000, 121_500),
    ];
    assert.equal(micHealth([], segs), "lopsided");
    assert.equal(micHealth([], segs, "B"), "lopsided");
    // Con tus respuestas transcritas, nada que avisar.
    assert.equal(micHealth([], [...segs, seg("B", words(60), 122_000, 140_000)], "B"), null);
  });
});
