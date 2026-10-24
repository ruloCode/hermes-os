/**
 * Lente (shared/lens.ts): contratos del formato "de mirar" — qué tarjeta sale
 * de cada motor, cómo se recorta, qué cuenta como dirigido a ti y cómo la
 * baraja decide qué se ve. Docs: docs/lente-gafas.md.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cueAllowed,
  glanceText,
  LENS_MAX_CHARS,
  LENS_MIN_VIEW_MS,
  LENS_QUEUE_MAX,
  LENS_STALE_MS,
  LensDeck,
  LENS_STREAM_EVERY_MS,
  LensStreamer,
  OPENING_WHY,
  toCue,
  type LensCue,
  type LiveSuggestion,
} from "@hermes/shared";

const sug = (over: Partial<LiveSuggestion>): LiveSuggestion => ({
  id: "s1",
  kind: "decir",
  text: "Podemos entregarlo el viernes si cerramos el alcance hoy.",
  why: "",
  atMs: 1_000,
  ...over,
});

const cue = (id: string, priority: number, over: Partial<LensCue> = {}): LensCue => ({
  id,
  type: "sugerencia",
  text: `tarjeta ${id}`,
  ttlMs: 8_000,
  priority,
  urgent: priority >= 5,
  atMs: 0,
  ...over,
});

describe("glanceText", () => {
  it("no toca lo que ya cabe", () => {
    assert.equal(glanceText("Corto y claro."), "Corto y claro.");
  });

  it("nunca pasa del tope ni corta una palabra a la mitad", () => {
    const long =
      "Propongo que dejemos la migración para el próximo sprint porque el equipo de datos todavía no tiene el esquema definitivo aprobado";
    const out = glanceText(long);
    assert.ok(out.length <= LENS_MAX_CHARS, out);
    const words = new Set(long.split(" "));
    for (const w of out.replace(/…$/, "").split(" ")) assert.ok(words.has(w), `palabra cortada: ${w}`);
  });

  it("prefiere cerrar en un fin de frase", () => {
    const t =
      "Sí, lo tenemos listo para el jueves. Lo que falta es la parte de reportes que depende del equipo de datos y su API.";
    assert.equal(glanceText(t), "Sí, lo tenemos listo para el jueves.");
  });

  it("colapsa saltos de línea y espacios", () => {
    assert.equal(glanceText("una\n\nidea   clara"), "una idea clara");
  });
});

describe("toCue", () => {
  it("el silencio del modelo no es tarjeta", () => {
    assert.equal(toCue(sug({ text: "—" })), null);
    assert.equal(toCue(sug({ text: "   " })), null);
  });

  it("un aporte de equipo lleva el ángulo de título", () => {
    const c = toCue(sug({ kind: "aportar", angle: "Riesgo", text: "Sin reintentos perdemos pagos." }));
    assert.equal(c?.type, "sugerencia");
    assert.equal(c?.title, "Riesgo");
    assert.equal(c?.text, "Sin reintentos perdemos pagos.");
  });

  it("un concepto separa término y explicación", () => {
    const c = toCue(sug({ kind: "entender", text: "Idempotencia — repetir la llamada no cambia el resultado." }));
    assert.equal(c?.type, "concepto");
    assert.equal(c?.title, "Idempotencia");
    assert.equal(c?.text, "repetir la llamada no cambia el resultado.");
  });

  it("una corrección muestra solo cómo decirlo", () => {
    const c = toCue(sug({ kind: "corregir", text: "I go yesterday → I went yesterday" }));
    assert.equal(c?.type, "dilo-asi");
    assert.equal(c?.text, "I went yesterday");
  });

  it("la frase de la clase deja fuera Clave y Sube", () => {
    const c = toCue(
      sug({
        kind: "decir",
        source: "fast",
        text: "I spent the weekend hiking with friends.\nClave: hiking (caminata)\nSube: recharge = recargar",
      }),
    );
    assert.equal(c?.text, "I spent the weekend hiking with friends.");
  });

  it("un andamio sin frase muestra el arranque", () => {
    const c = toCue(sug({ kind: "andamio", text: "Clave: went hiking (fui de caminata)\nArranca: Last weekend I…" }));
    assert.equal(c?.title, "Arranca");
    assert.equal(c?.text, "Last weekend I…");
  });

  it("el dato del estratégico es respuesta", () => {
    assert.equal(toCue(sug({ kind: "dato", text: "El contrato dice 3 semanas." }))?.type, "respuesta");
  });

  it("guarda el texto completo cuando recorta", () => {
    const text = "palabra ".repeat(30).trim();
    const c = toCue(sug({ text }));
    assert.ok(c && c.text.length <= LENS_MAX_CHARS);
    assert.equal(c?.full, text);
  });

  it("es urgente si te nombran, te preguntan o lo pediste", () => {
    assert.equal(toCue(sug({ kind: "aportar", why: OPENING_WHY.named }))?.urgent, true);
    assert.equal(toCue(sug({ kind: "aportar", why: OPENING_WHY.question }))?.urgent, true);
    assert.equal(toCue(sug({ kind: "rumbo", manual: true }))?.urgent, true);
    assert.equal(toCue(sug({ kind: "decir", source: "fast" }))?.urgent, true);
  });

  it("no es urgente lo que el copiloto propone por su cuenta", () => {
    assert.equal(toCue(sug({ kind: "aportar", why: OPENING_WHY.quiet }))?.urgent, false);
    assert.equal(toCue(sug({ kind: "rumbo", source: "deep" }))?.urgent, false);
    assert.equal(toCue(sug({ kind: "entender", text: "SLA — tiempo de respuesta pactado." }))?.urgent, false);
  });

  it("lo urgente tiene la prioridad más alta", () => {
    const urgent = toCue(sug({ kind: "aportar", why: OPENING_WHY.named }))!;
    const answer = toCue(sug({ kind: "dato" }))!;
    assert.ok(urgent.priority > answer.priority);
  });

  it("que te nombren pesa más que lo que pediste a mano", () => {
    const named = toCue(sug({ kind: "aportar", why: OPENING_WHY.named }))!;
    const asked = toCue(sug({ kind: "entender", manual: true, text: "SLA — tiempo pactado." }))!;
    assert.ok(named.priority > asked.priority);
  });

  it("un texto largo se queda más tiempo que uno corto", () => {
    const short = toCue(sug({ text: "Sí." }))!;
    const long = toCue(sug({ text: "palabra ".repeat(11).trim() }))!;
    assert.ok(long.ttlMs > short.ttlMs);
  });

  it("calma deja pasar solo lo urgente", () => {
    const urgent = toCue(sug({ manual: true }))!;
    const idle = toCue(sug({ kind: "rumbo" }))!;
    assert.equal(cueAllowed(urgent, "calma"), true);
    assert.equal(cueAllowed(idle, "calma"), false);
    assert.equal(cueAllowed(idle, "normal"), true);
  });
});

describe("LensDeck", () => {
  it("muestra una a la vez y la siguiente al vencer", () => {
    const d = new LensDeck();
    d.push(cue("a", 1), 0);
    d.push(cue("b", 1), 100);
    assert.equal(d.view(200).cue?.id, "a");
    assert.equal(d.view(200).queued, 1);
    d.tick(8_000);
    assert.equal(d.view(8_000).cue?.id, "b");
  });

  it("la urgente pisa a la visible, pero no antes del mínimo de vista", () => {
    const d = new LensDeck();
    d.push(cue("a", 1), 0);
    d.push(cue("u", 5), LENS_MIN_VIEW_MS - 1);
    assert.equal(d.view(LENS_MIN_VIEW_MS).cue?.id, "a");
    const d2 = new LensDeck();
    d2.push(cue("a", 1), 0);
    d2.push(cue("u", 5), LENS_MIN_VIEW_MS);
    assert.equal(d2.view(LENS_MIN_VIEW_MS).cue?.id, "u");
  });

  it("la urgente que llegó antes del mínimo pasa en cuanto se cumple", () => {
    const d = new LensDeck();
    d.push(cue("concepto", 2, { ttlMs: 10_000 }), 0);
    d.push(cue("pregunta", 5), 500);
    assert.equal(d.view(1_000).cue?.id, "concepto");
    d.tick(LENS_MIN_VIEW_MS);
    assert.equal(d.view(LENS_MIN_VIEW_MS).cue?.id, "pregunta");
  });

  it("el rumbo del estratégico cede ante un aporte", () => {
    const rumbo = toCue(sug({ kind: "rumbo" }))!;
    const aporte = toCue(sug({ kind: "aportar", angle: "Riesgo", why: OPENING_WHY.decision }))!;
    assert.ok(aporte.priority > rumbo.priority);
  });

  it("la cola no pasa del tope y sale la menos importante", () => {
    const d = new LensDeck();
    d.push(cue("vis", 1), 0);
    d.push(cue("low", 1), 10);
    d.push(cue("mid", 2), 20);
    d.push(cue("hi", 4), 30);
    assert.equal(d.view(40).queued, LENS_QUEUE_MAX);
    d.next(50);
    assert.equal(d.view(50).cue?.id, "hi");
    d.next(60);
    assert.equal(d.view(60).cue?.id, "mid");
    d.next(70);
    assert.equal(d.view(70).cue, null);
  });

  it("lo que esperó demasiado ya no sale", () => {
    const d = new LensDeck();
    d.push(cue("a", 1, { ttlMs: 60_000 }), 0);
    d.push(cue("b", 1), 10);
    d.next(10 + LENS_STALE_MS);
    assert.equal(d.view(10 + LENS_STALE_MS).cue, null);
  });

  it("el streaming no vence y la final la actualiza en sitio", () => {
    const d = new LensDeck();
    d.push(cue("s", 5, { pending: true, text: "Podemos" }), 0);
    d.tick(15_000);
    assert.equal(d.view(15_000).cue?.text, "Podemos");
    assert.equal(d.view(15_000).remaining, 1);
    d.push(cue("s", 5, { text: "Podemos entregarlo el viernes." }), 15_000);
    assert.equal(d.view(15_000).cue?.text, "Podemos entregarlo el viernes.");
    d.tick(15_000 + 8_000);
    assert.equal(d.view(23_000).cue, null);
  });

  it("una abortada desaparece y sube la que esperaba", () => {
    const d = new LensDeck();
    d.push(cue("s", 5, { pending: true }), 0);
    d.push(cue("b", 1), 10);
    d.remove("s", 20);
    assert.equal(d.view(20).cue?.id, "b");
  });

  it("remaining baja con el tiempo", () => {
    const d = new LensDeck();
    d.push(cue("a", 1, { ttlMs: 10_000 }), 0);
    assert.equal(d.view(0).remaining, 1);
    assert.equal(d.view(5_000).remaining, 0.5);
  });
});

describe("LensStreamer", () => {
  it("manda la parcial con la misma id, sin pasarse del ritmo", () => {
    const st = new LensStreamer();
    st.start("f1", "decir", "¿Para cuándo?", 500);
    assert.equal(st.delta("f1", "Para", 0), null, "muy corto todavía");
    const a = st.delta("f1", " el jueves, si", 100);
    assert.equal(a?.id, "f1");
    assert.equal(a?.pending, true);
    assert.equal(st.delta("f1", " hoy", 100 + LENS_STREAM_EVERY_MS - 1), null, "antes del ritmo");
    const b = st.delta("f1", " cerramos", 100 + LENS_STREAM_EVERY_MS);
    assert.equal(b?.text, "Para el jueves, si hoy cerramos");
  });

  it("el silencio del modelo nunca sale", () => {
    const st = new LensStreamer();
    st.start("f2", "decir", "", 0);
    assert.equal(st.delta("f2", "—", 0), null);
    assert.equal(st.delta("f2", "   ——", 1_000), null);
  });

  it("un aporte espera la frase, no pinta solo el ángulo", () => {
    const st = new LensStreamer();
    st.start("t1", "aportar", OPENING_WHY.named, 0);
    assert.equal(st.delta("t1", "Trade-off", 0), null);
    const c = st.delta("t1", "\nSi lo hacemos hoy, se corre la demo.", 1_000);
    assert.equal(c?.title, "Trade-off");
    assert.equal(c?.priority, 6);
  });

  it("después de terminar ya no emite", () => {
    const st = new LensStreamer();
    st.start("f3", "decir", "", 0);
    st.end("f3");
    assert.equal(st.delta("f3", "Un texto bastante largo", 1_000), null);
  });
});
