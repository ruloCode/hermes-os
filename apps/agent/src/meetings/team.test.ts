/**
 * Reunión de equipo EN VIVO: contratos de la lógica pura (shared/team-copilot)
 * y de las reglas de disparo del TeamCopilotController con motores falsos.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  conceptMentioned,
  detectOpening,
  foldText,
  parseConcepts,
  parseContribution,
  parseStrategic,
  teamReviewMarkdown,
  teamWindows,
  type LiveSegment,
  type LiveSuggestion,
} from "@hermes/shared";
import { CONCEPT_ID_PREFIX, TeamCopilotController } from "./live-team.js";
import type { FastEngine, FastGenRequest } from "./live-copilot.js";
import type { NormalizedTurn } from "./live-stt.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("parseContribution", () => {
  it("lee ángulo en la primera línea y la frase en la segunda", () => {
    assert.deepEqual(parseContribution("Riesgo\nSi no hay dead-letter perdemos pagos."), {
      angle: "Riesgo",
      text: "Si no hay dead-letter perdemos pagos.",
    });
  });
  it("acepta «Ángulo: frase» en una línea y variantes del nombre", () => {
    assert.deepEqual(parseContribution("Trade-offs: ganamos orden, pagamos latencia."), {
      angle: "Trade-off",
      text: "ganamos orden, pagamos latencia.",
    });
    assert.equal(parseContribution("**Siguiente paso**\nYo armo el prototipo.")?.angle, "Siguiente paso");
  });
  it("«—» es silencio", () => {
    assert.equal(parseContribution("—"), null);
    assert.equal(parseContribution("  "), null);
  });
  it("sin ángulo conocido conserva la frase entera", () => {
    assert.deepEqual(parseContribution("Creo que deberíamos medir antes."), {
      text: "Creo que deberíamos medir antes.",
    });
  });
  it("un ángulo sin frase no es una tarjeta", () => {
    assert.equal(parseContribution("Riesgo"), null);
  });
});

describe("parseConcepts", () => {
  it("una línea por concepto, con raya o dos puntos, máximo 2", () => {
    const c = parseConcepts(
      "Outbox pattern — guardar el evento en la misma transacción que el dato.\nIdempotencia: repetir no cambia el resultado final.\nKafka — log distribuido de eventos.",
    );
    assert.deepEqual(
      c.map((x) => x.term),
      ["Outbox pattern", "Idempotencia"],
    );
  });
  it("«—» = nada nuevo", () => {
    assert.deepEqual(parseConcepts("—"), []);
  });
  it("una anotación del modelo no queda en la explicación", () => {
    assert.equal(
      parseConcepts("Outbox — tabla que guarda el evento antes de publicarlo. (ya explicado, no repitas)")[0]
        .explanation,
      "tabla que guarda el evento antes de publicarlo.",
    );
  });
});

describe("parseStrategic", () => {
  it("una línea por sugerencia «tipo | texto | por qué»", () => {
    assert.deepEqual(
      parseStrategic(
        "dato | El 7 de octubre quedó pendiente validar el backfill. | lo están discutiendo a ciegas\n- rumbo | Volvamos al orden de los scripts. | se fue a otro tema",
      ),
      [
        { kind: "dato", text: "El 7 de octubre quedó pendiente validar el backfill.", why: "lo están discutiendo a ciegas" },
        { kind: "rumbo", text: "Volvamos al orden de los scripts.", why: "se fue a otro tema" },
      ],
    );
  });
  it("«—», tipos desconocidos y líneas sueltas no son sugerencias", () => {
    assert.deepEqual(parseStrategic("—"), []);
    assert.deepEqual(parseStrategic("opinión | algo | x\nTexto libre sin formato"), []);
  });
});

describe("conceptMentioned", () => {
  const said = foldText("Vamos a usar el outbox y una dead-letter queue para los pagos");
  it("vale el término entero o su primera palabra con sustancia", () => {
    assert.equal(conceptMentioned("Outbox pattern", said), true);
    assert.equal(conceptMentioned("Dead-letter queue", said), true);
  });
  it("un término que nadie dijo no pasa (venía del contexto del proyecto)", () => {
    assert.equal(conceptMentioned("visibility", said), false);
    assert.equal(conceptMentioned("Idempotencia", said), false);
  });
});

describe("detectOpening", () => {
  it("te nombran (sin importar tildes ni mayúsculas)", () => {
    assert.equal(detectOpening("Raúl, ¿tú cómo lo ves?", ["raul"]), "named");
    assert.equal(detectOpening("rulo qué piensas", ["Rulo"]), "named");
  });
  it("pedir opinión al grupo", () => {
    assert.equal(detectOpening("¿Qué opinan del outbox?"), "opinion");
    assert.equal(detectOpening("Any thoughts on this approach?"), "opinion");
  });
  it("palabras sueltas solo cuentan en pregunta", () => {
    assert.equal(detectOpening("¿Ideas?"), "opinion");
    assert.equal(detectOpening("Tengo ideas para el diseño del flujo"), null);
  });
  it("decisión y problema", () => {
    assert.equal(detectOpening("Entonces propongo arrancar con el outbox"), "decision");
    assert.equal(detectOpening("El problema es que los reintentos duplican cobros"), "problem");
  });
  it("una afirmación cualquiera no es ventana", () => {
    assert.equal(detectOpening("El servicio de pagos corre en Kubernetes"), null);
  });
});

const seg = (speaker: string, startMs: number, endMs: number): LiveSegment => ({
  id: `${speaker}-${startMs}`,
  speaker,
  text: "algo",
  startMs,
  endMs,
  final: true,
});
const sug = (p: Partial<LiveSuggestion> & Pick<LiveSuggestion, "kind" | "atMs">): LiveSuggestion => ({
  id: String(p.atMs),
  text: "texto",
  why: "pidieron opinión al grupo",
  source: "fast",
  ...p,
});

describe("teamWindows / teamReviewMarkdown", () => {
  it("cuenta como ventana solo los aportes automáticos y mide si hablaste después", () => {
    const suggestions = [
      sug({ kind: "aportar", atMs: 10_000, angle: "Riesgo" }),
      sug({ kind: "aportar", atMs: 120_000 }),
      sug({ kind: "aportar", atMs: 200_000, manual: true }),
      sug({ kind: "dato", atMs: 50_000 }),
    ];
    const segments = [seg("B", 20_000, 25_000), seg("A", 130_000, 140_000)];
    const w = teamWindows(suggestions, segments, "B");
    assert.deepEqual(
      w.map((x) => x.spoke),
      [true, false],
    );
  });
  it("hablar ANTES de la ventana o mucho después no cuenta como tomarla", () => {
    const w = teamWindows(
      [sug({ kind: "aportar", atMs: 60_000 }), sug({ kind: "aportar", atMs: 200_000 })],
      // Un turno tuyo que ya venía (empezó antes) y otro 40 s tarde.
      [seg("B", 50_000, 62_000), seg("B", 240_000, 245_000)],
      "B",
    );
    assert.deepEqual(
      w.map((x) => x.spoke),
      [false, false],
    );
  });
  it("sin «soy yo» no afirma si hablaste", () => {
    const w = teamWindows([sug({ kind: "aportar", atMs: 1_000 })], [seg("B", 2_000, 3_000)], null);
    assert.equal(w[0].spoke, null);
    assert.match(teamReviewMarkdown([sug({ kind: "aportar", atMs: 1_000 })], [], null), /No se marcó/);
  });
  it("el repaso lista los conceptos sin repetir y sin la línea «Tema:»", () => {
    const md = teamReviewMarkdown(
      [
        sug({ kind: "entender", atMs: 1, text: "Outbox — patrón de publicación transaccional confiable." }),
        sug({ kind: "entender", atMs: 2, text: "outbox — repetido con otra explicación larga." }),
        sug({
          kind: "entender",
          atMs: 3,
          manual: true,
          text: "Tema: cómo publicar eventos de pagos\nIdempotencia — repetir no cambia el resultado.",
        }),
      ],
      [],
      "B",
    );
    assert.match(md, /### Para estudiar/);
    assert.equal(md.match(/Outbox/gi)?.length, 1);
    assert.match(md, /\*\*Idempotencia\*\*/);
    assert.doesNotMatch(md, /\*\*Tema\*\*/);
  });
  it("sin ventanas ni conceptos no hay sección", () => {
    assert.equal(teamReviewMarkdown([sug({ kind: "dato", atMs: 1 })], [], "B"), "");
  });
});

// ── Controller con motores falsos ──────────────────────────────────────

class RecordingEngine implements FastEngine {
  readonly requests: FastGenRequest[] = [];
  generate(req: FastGenRequest): void {
    this.requests.push(req);
  }
  destroy(): void {}
  epoch(): number {
    return 1;
  }
}

let n = 0;
const turn = (speaker: string, text: string, final = true): NormalizedTurn => ({
  key: `k-${(n += 1)}`,
  speaker,
  text,
  startMs: 0,
  endMs: 0,
  final,
  endOfTurn: final,
});

function setup(overrides: { quietChars?: number } = {}) {
  const help = new RecordingEngine();
  const concepts = new RecordingEngine();
  const ctl = new TeamCopilotController(help, concepts, {
    nameOf: (l) => `Hablante ${l}`,
    ownerNames: ["Rulo"],
    conceptMergeMs: 15,
    ...overrides,
  });
  return { help, concepts, ctl };
}

describe("TeamCopilotController", () => {
  it("una pregunta ajena dispara un aporte automático", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "¿Lo hacemos con outbox o directo?"), "B");
    assert.equal(help.requests.length, 1);
    assert.equal(help.requests[0].kind, "aportar");
    assert.equal(help.requests[0].manual, false);
    assert.match(help.requests[0].prompt, /TAREA: APORTAR/);
    assert.match(help.requests[0].prompt, /hicieron una pregunta/);
    ctl.destroy();
  });

  it("lo que dices tú nunca dispara", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("B", "¿Y si medimos primero la latencia?"), "B");
    assert.equal(help.requests.length, 0);
    ctl.destroy();
  });

  it("dos ventanas seguidas: la segunda espera, salvo que te nombren", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "¿Qué opinan del particionamiento?"), "B");
    ctl.onTurn(turn("C", "Entonces propongo partir por id de cliente"), "B");
    assert.equal(help.requests.length, 1, "la decisión cae dentro del intervalo mínimo");
    ctl.onTurn(turn("A", "Rulo, ¿tú cómo lo ves?"), "B");
    assert.equal(help.requests.length, 2);
    assert.match(help.requests[1].prompt, /te nombraron/);
    ctl.destroy();
  });

  it("una pregunta nueva merece su respuesta aunque otra acabe de salir", async () => {
    const help = new RecordingEngine();
    const ctl = new TeamCopilotController(help, null, {
      nameOf: (l) => `Hablante ${l}`,
      ownerNames: ["Rulo"],
      floors: { question: 20, opinion: 20 },
    });
    ctl.onTurn(turn("A", "¿Tienen alguna sugerencia de cómo seguir con la migración?"), "B");
    ctl.onTurn(turn("C", "¿En qué estado estamos actualmente?"), "B");
    assert.equal(help.requests.length, 1, "dentro del piso, todavía no");
    await sleep(30);
    ctl.onTurn(turn("C", "¿Y quién tiene los scripts del backfill?"), "B");
    assert.equal(help.requests.length, 2);
    ctl.destroy();
  });

  it("el contexto es incremental: cada mensaje lleva solo lo que el motor no vio", () => {
    const { help, ctl } = setup();
    ctl.onTurn(turn("A", "Hablemos de Kafka y del outbox"), "B");
    ctl.triggerNow();
    ctl.onTurn(turn("C", "Me preocupa el orden de los eventos"), "B");
    ctl.triggerNow(undefined, "question");
    const [first, second] = help.requests;
    assert.match(first.prompt, /Conversación hasta ahora/);
    assert.match(first.prompt, /Kafka/);
    assert.match(second.prompt, /Líneas nuevas/);
    assert.doesNotMatch(second.prompt, /Kafka/);
    assert.equal(second.kind, "preguntar");
    ctl.destroy();
  });

  it("a mano: «¿De qué hablan?» pide ENTENDER", () => {
    const { help, ctl } = setup();
    ctl.triggerNow(undefined, "explain");
    assert.equal(help.requests[0].kind, "entender");
    assert.equal(help.requests[0].manual, true);
    assert.match(help.requests[0].prompt, /TAREA: ENTENDER/);
    ctl.destroy();
  });

  it("los conceptos se agrupan y salen por su motor con su prefijo", async () => {
    const { concepts, ctl } = setup();
    ctl.onTurn(turn("A", "Vamos a usar outbox pattern con Kafka y consumidores idempotentes"), "B");
    ctl.onTurn(turn("C", "y una dead-letter queue para los que fallen tres veces"), "B");
    assert.equal(concepts.requests.length, 0, "espera a que se junte la conversación");
    await sleep(40);
    assert.equal(concepts.requests.length, 1);
    assert.ok(concepts.requests[0].id.startsWith(CONCEPT_ID_PREFIX));
    assert.match(concepts.requests[0].prompt, /dead-letter/);
    assert.match(concepts.requests[0].prompt, /outbox/);
    ctl.destroy();
  });

  it("«llevas rato sin intervenir» cuando los demás hablan mucho y tú no", () => {
    const { help, ctl } = setup({ quietChars: 60 });
    ctl.onTurn(turn("A", "El servicio de pagos hoy corre en un monolito con su propia base"), "B");
    assert.equal(help.requests.length, 1);
    assert.match(help.requests[0].prompt, /llevas rato sin intervenir/);
    ctl.destroy();
  });
});
