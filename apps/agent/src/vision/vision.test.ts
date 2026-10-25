import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import {
  frameDiff,
  nextVisionAction,
  parseVisionMessage,
  toGray,
  visionReply,
  DEFAULT_VISION_QUESTION,
  ASK_FRAME_WAIT_MS,
  ASK_GIVE_UP_MS,
  FRAME_MAX_AGE_MS,
  NARRATE_MIN_INTERVAL_MS,
  type VisionSchedulerState,
  type VisionServerEvent,
} from "@hermes/shared";

/**
 * Visión en vivo: lo que importa es CUÁNDO habla (raro, nunca encima de sí
 * misma, la pregunta gana) y que callar sea una respuesta válida. La sesión
 * se prueba entera con el motor fake (HERMES_COPILOT=fake, fijado antes de
 * importar): cero tokens, mismos eventos que el real.
 */

const base: VisionSchedulerState = {
  mode: "narrar",
  busy: false,
  frameAt: 1_000,
  frameUnseen: true,
  pendingAsk: null,
  askAt: null,
  lastNarrateAt: 0,
};
const NOW = 1_000 + 100;

describe("visión: cuándo mirar", () => {
  it("narra con un cuadro nuevo y fresco", () => {
    assert.equal(nextVisionAction(base, NOW + NARRATE_MIN_INTERVAL_MS), "narrate");
  });

  it("no narra dos veces dentro del intervalo", () => {
    assert.equal(nextVisionAction({ ...base, lastNarrateAt: NOW - 1_000 }, NOW), null);
  });

  it("no narra el mismo cuadro dos veces", () => {
    assert.equal(nextVisionAction({ ...base, frameUnseen: false }, NOW + 60_000 - 59_000), null);
  });

  it("en modo manual solo responde preguntas", () => {
    assert.equal(nextVisionAction({ ...base, mode: "manual" }, NOW), null);
    assert.equal(nextVisionAction({ ...base, mode: "manual", pendingAsk: "¿qué es?", askAt: 900 }, NOW), "ask");
  });

  it("la pregunta gana aunque el cuadro ya se haya visto y no haya pasado el intervalo", () => {
    assert.equal(
      nextVisionAction({ ...base, frameUnseen: false, lastNarrateAt: NOW, pendingAsk: "¿qué dice?", askAt: 900 }, NOW),
      "ask",
    );
  });

  it("con el modelo ocupado no se hace nada (nada se pisa)", () => {
    assert.equal(nextVisionAction({ ...base, busy: true, pendingAsk: "¿qué?" }, NOW), null);
  });

  it("la pregunta espera el cuadro nítido que la sigue; si no llega, usa el último fresco", () => {
    const asked = { ...base, pendingAsk: "¿qué dice?", askAt: 1_050 }; // cuadro (1000) ANTES de preguntar
    assert.equal(nextVisionAction(asked, 1_100), null);
    assert.equal(nextVisionAction({ ...asked, frameAt: 1_080 }, 1_100), "ask");
    assert.equal(nextVisionAction(asked, 1_050 + ASK_FRAME_WAIT_MS), "ask");
  });

  it("sin cámara, o con un cuadro viejo, no se mira; una pregunta así termina en 'no hay imagen'", () => {
    assert.equal(nextVisionAction({ ...base, frameAt: null }, NOW), null);
    assert.equal(nextVisionAction({ ...base }, 1_000 + FRAME_MAX_AGE_MS + 1), null);
    const blind = { ...base, frameAt: null, pendingAsk: "¿qué?", askAt: 1_000 };
    assert.equal(nextVisionAction(blind, 1_000 + ASK_GIVE_UP_MS - 1), null);
    assert.equal(nextVisionAction(blind, 1_000 + ASK_GIVE_UP_MS), "no_frame");
  });
});

describe("visión: lo que se dice", () => {
  it("— es callar, en cualquiera de sus formas", () => {
    for (const s of ["—", " – ", "-", "—.", ""]) assert.equal(visionReply(s), null, JSON.stringify(s));
  });

  it("quita comillas que envuelven y etiquetas de relleno", () => {
    assert.equal(visionReply("«Una taza roja junto al teclado.»"), "Una taza roja junto al teclado.");
    assert.equal(visionReply("Descripción: Un letrero de salida."), "Un letrero de salida.");
  });

  it("una frase con guion adentro no es silencio", () => {
    assert.equal(visionReply("Un semáforo en rojo — espera."), "Un semáforo en rojo — espera.");
  });
});

describe("visión: protocolo", () => {
  it("ask sin texto es '¿qué estoy viendo?'", () => {
    assert.deepEqual(parseVisionMessage('{"t":"ask"}'), { t: "ask", text: DEFAULT_VISION_QUESTION });
    assert.deepEqual(parseVisionMessage('{"t":"ask","text":" ¿qué dice? "}'), { t: "ask", text: "¿qué dice?" });
  });

  it("modo inválido o basura = null (se ignora)", () => {
    assert.equal(parseVisionMessage('{"t":"mode","mode":"gritar"}'), null);
    assert.equal(parseVisionMessage("no es json"), null);
    assert.deepEqual(parseVisionMessage('{"t":"mode","mode":"manual"}'), { t: "mode", mode: "manual" });
  });
});

describe("visión: escena cambió", () => {
  it("idénticas = 0, opuestas = 1, tamaños distintos = cambió", () => {
    const a = new Uint8Array([10, 20, 30, 40]);
    assert.equal(frameDiff(a, a), 0);
    assert.equal(frameDiff(new Uint8Array([0, 0]), new Uint8Array([255, 255])), 1);
    assert.equal(frameDiff(a, new Uint8Array([1, 2])), 1);
  });

  it("RGBA → gris con los pesos de luminancia", () => {
    assert.deepEqual([...toGray([255, 255, 255, 255, 0, 0, 0, 255])], [255, 0]);
    assert.deepEqual([...toGray([255, 0, 0, 255])], [76]);
  });
});

describe("visión: la sesión de punta a punta (motor fake)", () => {
  let live: typeof import("./live.js");
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;

  before(async () => {
    process.env.HERMES_COPILOT = "fake";
    live = await import("./live.js");
  });

  const collect = () => {
    const events: VisionServerEvent[] = [];
    const waitFor = (pred: (e: VisionServerEvent) => boolean, ms = 3_000) =>
      new Promise<VisionServerEvent>((res, rej) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const hit = events.find(pred);
          if (hit) {
            clearInterval(iv);
            res(hit);
          } else if (Date.now() - t0 > ms) {
            clearInterval(iv);
            rej(new Error(`timeout; eventos: ${JSON.stringify(events.map((e) => e.t))}`));
          }
        }, 20);
      });
    return { events, send: (e: VisionServerEvent) => events.push(e), waitFor };
  };

  it("un cuadro → narra y dice algo; lo que no es JPEG no llega al modelo", async () => {
    const c = collect();
    const s = new live.VisionSession(c.send);
    try {
      assert.equal(c.events[0].t, "ready");
      s.onFrame(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer); // PNG: se ignora
      await new Promise((r) => setTimeout(r, 100));
      assert.equal(c.events.filter((e) => e.t === "start").length, 0);
      s.onFrame(JPEG);
      const say = await c.waitFor((e) => e.t === "say");
      assert.equal(say.t === "say" && say.kind, "narrar");
    } finally {
      s.close();
    }
  });

  it("una pregunta con el modelo ocupado espera su turno y se responde después", async () => {
    const c = collect();
    const s = new live.VisionSession(c.send);
    try {
      s.onFrame(JPEG); // arranca una narración
      s.onMessage('{"t":"ask","text":"¿qué dice el letrero?"}'); // llega en vuelo
      const answer = await c.waitFor((e) => e.t === "say" && e.kind === "respuesta");
      const starts = c.events.filter((e) => e.t === "start");
      assert.equal(starts.length, 2, "una narración y una respuesta, en ese orden");
      assert.equal(starts[1].t === "start" && starts[1].question, "¿qué dice el letrero?");
      assert.ok(answer);
    } finally {
      s.close();
    }
  });

  it("preguntar sin cámara lo dice en vez de inventar", async () => {
    const c = collect();
    const s = new live.VisionSession(c.send);
    try {
      s.onMessage('{"t":"ask"}');
      const err = await c.waitFor((e) => e.t === "error", ASK_GIVE_UP_MS + 2_000);
      assert.ok(err.t === "error" && /imagen/.test(err.message));
      assert.equal(c.events.filter((e) => e.t === "start").length, 0);
    } finally {
      s.close();
    }
  });

  it("abrir otra visión cierra la anterior", () => {
    let kicked = 0;
    const a = live.openVision(() => undefined, () => (kicked += 1));
    const b = live.openVision(() => undefined, () => undefined);
    assert.equal(kicked, 1);
    live.closeVision(a);
    live.closeVision(b);
  });
});
