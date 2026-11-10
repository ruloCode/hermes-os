/**
 * Preparación de junta: un test por cada «#### Scenario» de
 * openspec/changes/v6-nucleo/specs/juntas (menos «Simulación», que es el
 * `live:sim --copilot` del paquete núcleo) y los contratos de la lógica pura
 * que los sostienen. Datos inventados; el dueño de prueba se llama «Ana».
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPrepFacts,
  isFirstPersonPromise,
  isOwnerCommitment,
  matchEventProject,
  openPending,
  ownerPromises,
  pickEventProject,
  prepCardState,
  prepContextBlock,
  prepFingerprint,
  prepIsFresh,
  selfSpeakerName,
  transcriptTurns,
  validatePrep,
  type MeetingPrep,
  type PrepDraft,
  type PrepInputs,
  type PrepMeetingInput,
} from "@hermes/shared";
import { ensurePrep, openNoteTasks, type PrepData, type PrepDeps } from "./prep.js";
import { meetingContextBlocks, type MeetingContext } from "./meeting-context.js";

const OWNER_NAMES = ["Ana", "Anita"];

const kickoff: PrepMeetingInput = {
  id: "2026-11-03-1000-kickoff-del-portal",
  fecha: "2026-11-03T15:00:00.000Z",
  title: "Kickoff del portal",
  summary:
    "Se revisó el alcance del portal de pacientes. Se decidió lanzar primero el módulo de citas. Ana quedó de enviar la propuesta de arquitectura el viernes; Carlos prepara los accesos al servidor.",
  transcript: [
    "**Hablante 1:** Bueno, arrancamos con el alcance del portal.",
    "**Hablante 2:** Listo. Les comparto pantalla para que vean el tablero.",
    "**Hablante 1:** ¿Y la base de datos de pruebas?",
    "**Hablante 2:** Mañana les envío el acceso a la base de pruebas. Me comprometo a dejar el ambiente listo antes del lunes.",
  ].join("\n\n"),
  selfSpeaker: "B",
  // El coach cuenta palabras por etiqueta del STT, en orden de aparición: A habló primero.
  speakerWords: { A: 17, B: 31 },
  actionables: [
    { idx: 0, title: "Enviar propuesta de arquitectura", one_liner: "Documento con el diseño del portal.", status: null },
    { idx: 1, title: "Configurar accesos al servidor", one_liner: "Usuarios y llaves.", status: "done" },
  ],
};

const followUp: PrepMeetingInput = {
  id: "2026-11-07-0930-seguimiento-de-citas",
  fecha: "2026-11-07T14:30:00.000Z",
  title: "Seguimiento de citas",
  summary: "Se acordó usar el calendario del cliente para las citas. Carlos debe cotizar el servicio de mensajes.",
  actionables: [{ idx: 0, title: "Cotizar servicio de mensajes", one_liner: "Tres proveedores.", status: "pending" }],
};

function inputs(over: Partial<PrepInputs> = {}): PrepInputs {
  return {
    meetings: [followUp, kickoff],
    tasks: [
      { id: 41, title: "Cotizar servicio de mensajes", status: "pending", meetingId: followUp.id, meetingIdx: 0 },
      { id: 42, title: "Definir roles de acceso", status: "running" },
      { id: 43, title: "Tarea cerrada", status: "done" },
    ],
    noteTasks: ["Definir roles de acceso", "Preparar demo para el comité"],
    hasNote: true,
    ownerNames: OWNER_NAMES,
    event: null,
    ...over,
  };
}

const noHistory = (): PrepInputs => ({
  meetings: [],
  tasks: [],
  noteTasks: [],
  hasNote: true,
  ownerNames: OWNER_NAMES,
  event: null,
});

// ── Scenario: Proyecto con actas ───────────────────────────────────────

describe("Scenario: Proyecto con actas", () => {
  it("trae pendientes y promesas con el acta y la fecha de cada uno", () => {
    const facts = collectPrepFacts(inputs());
    assert.equal(facts.hasHistory, true);

    const pend = facts.pending.find((p) => p.text === "Enviar propuesta de arquitectura");
    assert.ok(pend, "el accionable sin decidir sigue abierto");
    assert.deepEqual(
      { kind: pend.source.kind, ref: pend.source.ref, date: pend.source.date },
      { kind: "meeting", ref: kickoff.id, date: "2026-11-03" },
    );
    assert.ok(!facts.pending.some((p) => p.text === "Configurar accesos al servidor"), "lo hecho no es pendiente");
    assert.ok(!facts.pending.some((p) => p.text === "Tarea cerrada"));

    assert.ok(facts.promises.length >= 2);
    for (const p of facts.promises) {
      assert.equal(p.source.kind, "meeting");
      assert.match(p.source.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    }
    assert.ok(facts.promises.some((p) => /Ana quedó de enviar la propuesta/.test(p.text)), "del resumen que la nombra");
    assert.ok(facts.promises.some((p) => /Mañana les envío el acceso/.test(p.text)), "de su propia voz");
  });

  it("no lista dos veces lo mismo: la tarea-puente de un accionable y la nota con el mismo título", () => {
    const pending = openPending(inputs());
    const titles = pending.map((p) => p.text);
    assert.equal(titles.filter((t) => t === "Cotizar servicio de mensajes").length, 1);
    assert.equal(titles.filter((t) => t === "Definir roles de acceso").length, 1);
    assert.equal(pending.find((p) => p.text === "Definir roles de acceso")?.source.kind, "task");
    assert.equal(pending.find((p) => p.text === "Preparar demo para el comité")?.source.kind, "note");
  });

  it("lo que dicen los demás no es promesa del dueño", () => {
    const promises = ownerPromises(inputs());
    assert.ok(!promises.some((p) => /Carlos/.test(p.text)));
    assert.ok(!promises.some((p) => /comparto pantalla/.test(p.text)), "compartir pantalla no es una promesa");
  });

  it("sin «soy yo» ni su nombre en el resumen, de esa acta no se afirma nada", () => {
    const anon: PrepMeetingInput = {
      ...kickoff,
      summary: "Se revisó el alcance.",
      selfSpeaker: undefined,
      speakerWords: undefined,
    };
    assert.deepEqual(ownerPromises({ meetings: [anon], ownerNames: OWNER_NAMES }), []);
  });
});

describe("quién es el dueño en la transcripción", () => {
  it("toma el «Hablante N» del orden del coach y lo comprueba con las palabras", () => {
    const turns = transcriptTurns(kickoff.transcript ?? "");
    assert.equal(selfSpeakerName(turns, "B", kickoff.speakerWords), "Hablante 2");
  });

  it("si el conteo no cuadra (acta re-transcrita), no se lo atribuye a nadie", () => {
    const turns = transcriptTurns(kickoff.transcript ?? "");
    assert.equal(selfSpeakerName(turns, "B", { A: 17, B: 400 }), null);
  });
});

describe("frases de compromiso", () => {
  it("primera persona: lo explícito y lo que tiene cuándo o a quién", () => {
    assert.ok(isFirstPersonPromise("Mañana les envío el acceso a la base"));
    assert.ok(isFirstPersonPromise("Yo me encargo de hablar con el proveedor"));
    assert.ok(isFirstPersonPromise("Voy a revisar el contrato esta semana"));
    assert.ok(isFirstPersonPromise("I'll send you the deck tomorrow"));
  });

  it("narrar lo que se hace no es prometer", () => {
    assert.ok(!isFirstPersonPromise("Voy a compartir pantalla un momento"));
    assert.ok(!isFirstPersonPromise("Voy a ver qué pasa aquí"));
    assert.ok(!isFirstPersonPromise("Sí"));
  });

  it("en el resumen: el dueño con verbo de compromiso, sin negación", () => {
    assert.ok(isOwnerCommitment("Ana quedó de avisar cuando esté listo", OWNER_NAMES));
    assert.ok(isOwnerCommitment("Quedó pendiente que Anita envíe la URL", OWNER_NAMES));
    assert.ok(!isOwnerCommitment("Ana NO rehace el respaldo", OWNER_NAMES));
    assert.ok(!isOwnerCommitment("Carlos debe cotizar", OWNER_NAMES));
    assert.ok(!isOwnerCommitment("Mariana debe cotizar", OWNER_NAMES), "nombre dentro de otra palabra");
  });
});

describe("lo que se repite entre actas", () => {
  it("la misma tarea con otras palabras se lista una vez (la más reciente)", () => {
    const m = (id: string, fecha: string, title: string): PrepMeetingInput => ({
      id,
      fecha,
      title: id,
      summary: "",
      actionables: [{ idx: 0, title, status: null }],
    });
    const pending = openPending({
      meetings: [
        m("b", "2026-11-06", "Grabar el video de 1 minuto para la Cámara de Comercio"),
        m("a", "2026-10-08", "Grabar el video de 1 min para la Cámara de Comercio"),
      ],
      tasks: [],
      noteTasks: ["Grabar el video de 1 min para la Cámara de Comercio (guion en [[pitch]])", "Montar el VPS del motor"],
    });
    assert.deepEqual(
      pending.map((p) => p.source.ref),
      ["b", "nota"],
    );
  });

  it("«no hubo decisiones» no es una decisión", () => {
    const d = (summary: string) =>
      collectPrepFacts({ ...noHistory(), meetings: [{ id: "x", fecha: "2026-11-06", title: "x", summary, actionables: [] }] }).decisions;
    assert.deepEqual(d("No hubo decisiones, no se asignaron responsables ni fechas."), []);
    assert.deepEqual(d("No hubo temas tratados, decisiones ni acuerdos que registrar."), []);
    assert.equal(d("Se decidió lanzar primero el módulo de citas.").length, 1);
  });
});

it("las casillas tachadas de «Tareas Pendientes» no son pendientes", () => {
  const raw = "---\nestado: activo\n---\n# P\n\n## Tareas Pendientes\n- [ ] Abierta\n- [x] Cerrada\n- Suelta\n\n## Otra\n- [ ] fuera";
  assert.deepEqual(openNoteTasks(raw), ["Abierta", "Suelta"]);
});

// ── Scenario: Proyecto sin historia ────────────────────────────────────

function deps(load: PrepData | null, draft: PrepDeps["draft"]): PrepDeps & { saved: MeetingPrep[] } {
  const saved: MeetingPrep[] = [];
  return {
    saved,
    load: async () => load,
    draft,
    read: async (project, day) => [...saved].reverse().find((p) => p.project === project && p.day === day) ?? null,
    write: async (p) => void saved.push(p),
    now: () => new Date("2026-11-10T14:00:00.000Z"),
    today: () => "2026-11-10",
  };
}

const okDraft: PrepDraft = {
  objective: { text: "Cerrar la fecha de la propuesta de arquitectura", source: `meeting:${kickoff.id}` },
  questions: [
    { text: "¿Qué día entregamos la propuesta de arquitectura?", source: `meeting:${kickoff.id}` },
    { text: "¿Quién aprueba la cotización de mensajes?", source: `meeting:${followUp.id}` },
  ],
  risks: [{ text: "Los roles de acceso siguen sin definir", source: "task:42" }],
  opener: { text: "Hoy cerramos la fecha de la arquitectura y la cotización de mensajes.", source: `meeting:${followUp.id}` },
};

describe("Scenario: Proyecto sin historia", () => {
  it("la hoja lo dice, no inventa puntos y no llama al modelo", async () => {
    let calls = 0;
    const d = deps({ slug: "vacio", projectName: "Vacío", noteDigest: "Un proyecto.", inputs: noHistory() }, async () => {
      calls += 1;
      return okDraft;
    });
    const { prep } = await ensurePrep("vacio", {}, d);
    assert.equal(calls, 0);
    assert.equal(prep.status, "no-history");
    assert.match(prep.note ?? "", /no tiene actas ni tareas/);
    assert.equal(prep.objective, null);
    assert.equal(prep.opener, null);
    for (const k of ["questions", "pending", "promises", "decisions", "risks"] as const) assert.deepEqual(prep[k], []);
  });
});

// ── Scenario: Un punto sin fuente ──────────────────────────────────────

describe("Scenario: Un punto sin fuente", () => {
  const sources = collectPrepFacts(inputs()).sources;

  it("se descarta antes de mostrarse (sin cita, cita inventada o vacía)", () => {
    const v = validatePrep(
      {
        objective: { text: "Objetivo sin fuente", source: "" },
        questions: [
          { text: "¿Pregunta válida?", source: `meeting:${kickoff.id}` },
          { text: "¿Pregunta de un acta que no existe?", source: "meeting:2026-01-01-0000-inventada" },
          { text: "¿Pregunta sin cita?" },
        ],
        risks: [{ text: "Riesgo de una tarea inventada", source: "task:999" }],
        opener: { text: "", source: "note:nota" },
      },
      sources,
    );
    assert.equal(v.objective, null);
    assert.deepEqual(v.questions.map((q) => q.text), ["¿Pregunta válida?"]);
    assert.deepEqual(v.risks, []);
    assert.equal(v.opener, null);
    assert.equal(v.dropped, 5);
  });

  it("la fecha y el título que se muestran son los de la fuente real, no los que escribió el modelo", () => {
    const v = validatePrep({ questions: [{ text: "¿Algo?", source: ` [meeting:${kickoff.id}] ` }] }, sources);
    assert.deepEqual(v.questions[0].source, { kind: "meeting", ref: kickoff.id, date: "2026-11-03", label: "Kickoff del portal" });
  });

  it("como máximo tres preguntas", () => {
    const q = (n: number) => ({ text: `¿Pregunta ${n}?`, source: "note:nota" });
    assert.equal(validatePrep({ questions: [q(1), q(2), q(3), q(4)] }, sources).questions.length, 3);
  });

  it("en la generación: si nada cita bien, la hoja dice que la redacción falló y conserva los datos", async () => {
    const d = deps({ slug: "portal", noteDigest: "", inputs: inputs() }, async () => ({
      objective: { text: "Inventado", source: "meeting:no-existe" },
      questions: [{ text: "¿Inventada?", source: "task:999" }],
    }));
    const { prep } = await ensurePrep("portal", {}, d);
    assert.equal(prep.status, "draft-failed");
    assert.equal(prep.objective, null);
    assert.deepEqual(prep.questions, []);
    assert.ok(prep.pending.length > 0 && prep.promises.length > 0);
  });
});

it("si el modelo falla, la hoja trae pendientes y promesas y dice que la redacción falló", async () => {
  const d = deps({ slug: "portal", noteDigest: "", inputs: inputs() }, async () => {
    throw new Error("sin cuota");
  });
  const { prep } = await ensurePrep("portal", {}, d);
  assert.equal(prep.status, "draft-failed");
  assert.match(prep.note ?? "", /redacción falló.*sin cuota/);
  assert.ok(prep.pending.length > 0 && prep.promises.length > 0);
});

// ── Scenario: Próximo evento ───────────────────────────────────────────

describe("Scenario: Próximo evento", () => {
  const projects = [
    { slug: "portal-salud", name: "Portal Salud" },
    { slug: "rulocodeshow", name: "RuloCodeShow" },
    { slug: "dia", name: "Día" },
  ];
  const now = new Date("2026-11-10T14:00:00.000Z");

  it("un evento en las próximas horas que nombra un proyecto se ofrece con su hora", () => {
    const picked = pickEventProject(
      [
        { id: "e0", title: "Almuerzo", start: "2026-11-10T15:00:00.000Z" },
        { id: "e1", title: "Daily Portal Salud", start: "2026-11-10T16:00:00.000Z", end: "2026-11-10T16:30:00.000Z" },
        { id: "e2", title: "Portal Salud: demo", start: "2026-11-11T16:00:00.000Z" },
      ],
      projects,
      { now, withinHours: 12 },
    );
    assert.equal(picked?.project, "portal-salud");
    assert.equal(picked?.event.start, "2026-11-10T16:00:00.000Z");
  });

  it("también reconoce el nombre partido en palabras y uno en curso", () => {
    assert.equal(matchEventProject("Grabación Rulo Code Show", projects)?.project, "rulocodeshow");
    const running = pickEventProject(
      [{ id: "e", title: "portal-salud sync", start: "2026-11-10T13:30:00.000Z", end: "2026-11-10T14:30:00.000Z" }],
      projects,
      { now },
    );
    assert.equal(running?.project, "portal-salud");
  });

  it("sin coincidencia clara no asigna: palabra dentro de otra, nombre corto, empate, todo el día", () => {
    assert.equal(matchEventProject("Diagnóstico del día", projects), null, "«dia» es demasiado genérico");
    assert.equal(matchEventProject("Portales de salud pública", projects), null);
    assert.equal(
      matchEventProject("Sync Alfa Beta", [
        { slug: "alfa-x", name: "Alfa" },
        { slug: "beta-x", name: "Beta" },
      ]),
      null,
    );
    assert.equal(
      pickEventProject([{ id: "e", title: "Portal Salud", start: "2026-11-10T05:00:00.000Z", allDay: true }], projects, { now }),
      null,
    );
  });

  it("fuera de la ventana no cuenta", () => {
    assert.equal(
      pickEventProject([{ id: "e", title: "Portal Salud", start: "2026-11-11T10:00:00.000Z" }], projects, { now, withinHours: 12 }),
      null,
    );
  });

  it("el evento elegido llega a la hoja con su hora", async () => {
    const ev = { id: "e1", title: "Daily Portal Salud", start: "2026-11-10T16:00:00.000Z" };
    const d = deps({ slug: "portal-salud", noteDigest: "", inputs: inputs({ event: ev }) }, async () => okDraft);
    const { prep } = await ensurePrep("portal-salud", {}, d);
    assert.deepEqual(prep.event, { title: "Daily Portal Salud", startsAt: "2026-11-10T16:00:00.000Z" });
  });
});

// ── Scenario: Segunda consulta el mismo día ────────────────────────────

describe("Scenario: Segunda consulta el mismo día", () => {
  it("sin actas nuevas devuelve la guardada sin otra llamada al modelo", async () => {
    let calls = 0;
    const data: PrepData = { slug: "portal", noteDigest: "", inputs: inputs() };
    const d = deps(data, async () => {
      calls += 1;
      return okDraft;
    });
    const first = await ensurePrep("portal", {}, d);
    const second = await ensurePrep("portal", {}, d);
    assert.equal(calls, 1);
    assert.equal(first.cached, false);
    assert.equal(second.cached, true);
    assert.equal(second.prep.generatedAt, first.prep.generatedAt);
    assert.equal(first.prep.status, "ready");
    assert.equal(first.prep.questions.length, 2);
  });

  it("con un acta nueva se rehace; con force también", async () => {
    let calls = 0;
    const data: PrepData = { slug: "portal", noteDigest: "", inputs: inputs() };
    const d = deps(data, async () => {
      calls += 1;
      return okDraft;
    });
    await ensurePrep("portal", {}, d);
    data.inputs = inputs({
      meetings: [{ ...followUp, id: "2026-11-09-1100-nueva", fecha: "2026-11-09T16:00:00.000Z", title: "Nueva" }, followUp, kickoff],
    });
    await ensurePrep("portal", {}, d);
    assert.equal(calls, 2);
    await ensurePrep("portal", { force: true }, d);
    assert.equal(calls, 3);
  });

  it("la huella no depende del orden ni de la hora del evento, y sí de un pendiente que se cierra", () => {
    const a = collectPrepFacts(inputs());
    const b = collectPrepFacts(inputs({ event: { id: "e", title: "x", start: "2026-11-10T20:00:00Z" } }));
    assert.equal(prepFingerprint(a), prepFingerprint(b));
    const closed = collectPrepFacts(
      inputs({ meetings: [followUp, { ...kickoff, actionables: kickoff.actionables.map((x) => ({ ...x, status: "done" })) }] }),
    );
    assert.notEqual(prepFingerprint(a), prepFingerprint(closed));
    assert.ok(prepIsFresh({ project: "Portal", day: "2026-11-10", fingerprint: prepFingerprint(a) }, "portal", "2026-11-10", prepFingerprint(a)));
    assert.ok(!prepIsFresh({ project: "portal", day: "2026-11-09", fingerprint: prepFingerprint(a) }, "portal", "2026-11-10", prepFingerprint(a)));
  });
});

// ── Scenario: Junta con preparación ────────────────────────────────────

describe("Scenario: Junta con preparación", () => {
  const base: MeetingContext = {
    briefing: "",
    projectNote: "Portal de pacientes.",
    tareas: [],
    recentMeetings: "",
  };

  it("el contexto del copiloto incluye el objetivo, las preguntas y las promesas", async () => {
    const d = deps({ slug: "portal", noteDigest: "", inputs: inputs() }, async () => okDraft);
    const { prep } = await ensurePrep("portal", {}, d);
    const blocks = meetingContextBlocks({ ...base, prep: prepContextBlock(prep, "Ana") });
    const text = blocks.join("\n\n");
    assert.match(blocks[0], /^## Preparación de Ana/, "va primero");
    assert.match(text, /Cerrar la fecha de la propuesta de arquitectura/);
    assert.match(text, /¿Qué día entregamos la propuesta de arquitectura\?/);
    assert.match(text, /Ana quedó de enviar la propuesta/);
    assert.match(text, /acta del 2026-11-03/);
  });

  it("sin preparación el contexto queda exactamente como antes", () => {
    assert.equal(prepContextBlock(null, "Ana"), "");
    assert.deepEqual(meetingContextBlocks({ ...base, prep: "" }), meetingContextBlocks(base));
    assert.ok(!meetingContextBlocks(base).some((b) => /Preparación/.test(b)));
  });

  describe("la hoja guardada en disco llega al contexto", () => {
    let home = "";
    const prevHome = process.env.HERMES_HOME;
    before(async () => {
      home = await mkdtemp(join(tmpdir(), "hermes-prep-"));
      process.env.HERMES_HOME = home;
    });
    after(async () => {
      if (prevHome === undefined) delete process.env.HERMES_HOME;
      else process.env.HERMES_HOME = prevHome;
      await rm(home, { recursive: true, force: true });
    });

    it("se escribe y se lee de ~/.hermes-os/meetings/prep/<proyecto>/<día>.json", async () => {
      const { readPrep, writePrep, prepPath } = await import("./prep-store.js");
      const d = deps({ slug: "portal", noteDigest: "", inputs: inputs() }, async () => okDraft);
      const { prep } = await ensurePrep("portal", {}, d);
      await writePrep(prep);
      assert.equal(prepPath("portal", "2026-11-10"), join(home, "meetings", "prep", "portal", "2026-11-10.json"));
      const back = await readPrep("portal", "2026-11-10");
      assert.equal(back?.objective?.text, prep.objective?.text);
      assert.equal(await readPrep("portal", "2026-11-09"), null, "otro día = sin preparación");
      assert.equal(await readPrep("../fuera", "2026-11-10"), null);
    });
  });
});

// ── Scenario: Sin preparación (tarjeta de inicio) ──────────────────────

describe("Scenario: Sin preparación", () => {
  it("la tarjeta ofrece «Preparar» y muestra el avance mientras se genera", () => {
    assert.equal(prepCardState({ loading: false, generating: false, prep: null }), "offer");
    assert.equal(prepCardState({ loading: false, generating: true, prep: null }), "generating");
    assert.equal(prepCardState({ loading: true, generating: false, prep: null }), "loading");
    assert.equal(prepCardState({ loading: false, generating: false, error: "sin cuota", prep: null }), "error");
  });
});
