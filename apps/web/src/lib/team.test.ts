// Contratos de "Tu equipo" (/equipo). Puerto de los casos de
// hermes-phone/core/src/test/.../TeamTest.kt: el teléfono y la web deben leer
// el MISMO equipo de la misma forma. Runner nativo: `pnpm --filter @hermes/web test`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  build,
  cloudIssue,
  headline,
  lookFor,
  machineLabel,
  parseApprovals,
  parseCloudAgents,
  parseCloudChat,
  parseMachines,
  parseRuns,
  parseScheduled,
  parseWorkers,
  SHAPES,
  sleepLine,
  timeLabel,
  toolLine,
  type Machine,
  type Scheduled,
  type Worker,
} from "./team.ts";

const zone = "America/Bogota";
const now = Date.parse("2026-10-24T15:00:00Z"); // sábado 10:00 en Bogotá
const at = (s: string) => Date.parse(s);

function sched(id: string, title: string, next: string | null, enabled = true, status: string | null = "ok"): Scheduled {
  return {
    id,
    title,
    prompt: "",
    cron: "0 8 * * 1",
    tz: zone,
    enabled,
    whenText: null,
    nextRunAt: next ? at(next) : null,
    lastRunAt: null,
    lastStatus: status,
    lastOutput: null,
    machine: null,
  };
}

function worker(
  id: string,
  name: string,
  status: string,
  o: { source?: string; tool?: string; target?: string; finished?: string } = {},
): Worker {
  return {
    id,
    source: o.source ?? "run",
    name,
    status,
    machine: "macbook-main",
    toolName: o.tool ?? null,
    toolTarget: o.target ?? null,
    lines: [],
    lastText: "Listo: **encontré 5**\nmás",
    toolCalls: 3,
    startedAt: at("2026-10-24T14:50:00Z"),
    lastEventAt: at("2026-10-24T14:58:00Z"),
    finishedAt: o.finished ? at(o.finished) : null,
  };
}

const mini: Machine[] = [{ name: "macbook-main", online: true, self: true, canRun: true, baseUrl: null }];

test("lo que te necesita va primero y los dormidos al final", () => {
  const team = build(
    {
      workers: [worker("a", "Licitaciones", "working", { tool: "Bash", target: "curl" }), worker("b", "Guardián", "needs_you")],
      scheduled: [sched("t1", "Brief", "2026-10-26T11:00:00Z")],
      machines: mini,
    },
    { now, zone },
  );
  assert.deepEqual(
    team.map((m) => m.name),
    ["Guardián", "Licitaciones", "Brief"],
  );
  assert.equal(team[0].status, "NEEDS_YOU");
});

test("una aprobación pendiente pone al agente en te necesita con su resumen", () => {
  const [m, ...rest] = build(
    {
      workers: [worker("a", "Guardián", "working")],
      approvals: [{ id: "ap1", workerId: "a", tool: "Bash", summary: "git push origin fix", detail: "git push origin fix", since: null }],
      machines: mini,
    },
    { now, zone },
  );
  assert.equal(rest.length, 0);
  assert.equal(m.status, "NEEDS_YOU");
  assert.equal(m.approvalId, "ap1");
  assert.ok(m.line.includes("git push origin fix"));
});

test("la corrida viva de una tarea programada no sale dos veces", () => {
  const team = build(
    {
      workers: [worker("w", "Brief", "working", { source: "scheduled", tool: "Read", target: "/vault/hoy.md" })],
      scheduled: [sched("t1", "Brief", "2026-10-26T11:00:00Z")],
      machines: mini,
    },
    { now, zone },
  );
  assert.equal(team.length, 1);
  assert.equal(team[0].status, "WORKING");
  assert.equal(team[0].taskId, "t1");
  assert.equal(team[0].id, "task:t1");
  assert.equal(team[0].line, "Leyendo hoy.md");
});

test("dormidos se ordenan por el próximo turno más cercano", () => {
  const team = build(
    { scheduled: [sched("lejos", "Lejos", "2026-10-30T13:00:00Z"), sched("cerca", "Cerca", "2026-10-25T13:00:00Z")], machines: mini },
    { now, zone },
  );
  assert.deepEqual(
    team.map((m) => m.name),
    ["Cerca", "Lejos"],
  );
});

test("una tarea pausada o que falló lo dice", () => {
  const team = build(
    { scheduled: [sched("p", "Pausada", null, false), sched("f", "Falló", null, true, "error")], machines: mini },
    { now, zone },
  );
  const by = Object.fromEntries(team.map((m) => [m.name, m]));
  assert.equal(by["Pausada"].status, "PAUSED");
  assert.equal(by["Falló"].status, "PROBLEM");
  assert.ok(by["Falló"].line.startsWith("La última corrida falló"));
});

test("el centro se llama Mac mini aunque su nombre diga macbook", () => {
  assert.equal(machineLabel("macbook-main", mini), "Mac mini");
  assert.equal(machineLabel("macbook-pro", mini), "MacBook");
  assert.equal(machineLabel("", mini), "Mac mini");
});

test("desde una Mac que NO es el centro: el centro conocido es la Mac mini y uno desconocido no se adivina", () => {
  const two: Machine[] = [
    { name: "macbook-pro", online: true, self: true, canRun: true, baseUrl: null },
    { name: "macbook-main", online: true, self: false, canRun: true, baseUrl: null },
  ];
  // El centro respondió su /health: se sabe cuál es.
  assert.equal(machineLabel("macbook-main", two, "macbook-main"), "Mac mini");
  assert.equal(machineLabel("macbook-pro", two, "macbook-main"), "MacBook");
  // No se supo cuál es: la que contesta (que dijo no ser el centro) sí es MacBook;
  // la otra se nombra tal cual en vez de inventarle un modelo.
  assert.equal(machineLabel("macbook-pro", two, null), "MacBook");
  assert.equal(machineLabel("macbook-main", two, null), "macbook-main");
  assert.equal(machineLabel("", two, null), "");
});

test("líneas de sueño en palabras", () => {
  assert.equal(sleepLine(at("2026-10-25T13:00:00Z"), now, zone), "Despierta mañana a las 8:00");
  assert.equal(sleepLine(at("2026-10-26T13:00:00Z"), now, zone), "Duerme hasta el lunes a las 8:00");
  assert.equal(sleepLine(at("2026-10-24T22:30:00Z"), now, zone), "Despierta hoy a las 17:30");
  assert.equal(sleepLine(null, now, zone), null);
});

test("hora relativa", () => {
  assert.equal(timeLabel(at("2026-10-24T14:58:00Z"), now, zone), "9:58");
  assert.equal(timeLabel(at("2026-10-23T14:58:00Z"), now, zone), "Ayer");
  assert.equal(timeLabel(at("2026-10-20T14:58:00Z"), now, zone), "Martes");
  assert.equal(timeLabel(at("2026-10-12T14:58:00Z"), now, zone), "12 oct");
  // El día lo pone Bogotá, no UTC: las 2:00 UTC del 24 son las 21:00 del 23 allá.
  assert.equal(timeLabel(at("2026-10-24T02:00:00Z"), now, zone), "Ayer");
  assert.equal(timeLabel(null, now, zone), "");
});

test("el mismo id da siempre el mismo personaje y nunca el índigo de Hermes", () => {
  assert.deepEqual(lookFor("abc"), lookFor("abc"));
  const looks = Array.from({ length: 200 }, (_, i) => lookFor(`agente-${i + 1}`));
  assert.ok(looks.every((l) => l.color !== 0));
  assert.equal(new Set(looks.map((l) => l.shape)).size, SHAPES.length);
  assert.notDeepEqual(lookFor("a"), lookFor("b"));
});

test("el personaje es el MISMO que en el teléfono (valores del Team.lookFor de Kotlin)", () => {
  assert.deepEqual(lookFor("abc"), { shape: "flower", color: 5 });
  assert.deepEqual(lookFor("a"), { shape: "pill", color: 7 });
  assert.deepEqual(lookFor("agent_01JBG5koyusbPD8dqKsZvMpM"), { shape: "cloud", color: 5 });
  assert.deepEqual(lookFor("ñandú"), { shape: "squircle", color: 1 });
});

test("tool en palabras", () => {
  assert.equal(toolLine("Bash", "pnpm test"), "Corriendo pnpm test");
  assert.equal(toolLine("mcp__linear__save_issue", "x"), "Usando linear");
  assert.equal(toolLine("WebSearch", "licitaciones"), "Buscando en la web");
  assert.equal(toolLine("Read", "/a/b/Team.kt"), "Leyendo Team.kt");
  assert.equal(toolLine(null, "x"), null);
});

test("lee las respuestas reales del agente", () => {
  const s = parseScheduled([
    {
      id: "t1",
      title: "Qué está atascado",
      prompt: "p",
      cron: "0 8 * * 1",
      tz: zone,
      enabled: true,
      next_run_at: "2026-10-26T13:00:00+00:00",
      last_run_at: "2026-10-19T13:01:57.112+00:00",
      last_status: "ok",
      when: "los lunes a las 8:00",
      machine: "macbook-main",
    },
  ]);
  assert.equal(s[0].nextRunAt, at("2026-10-26T13:00:00Z"));
  assert.equal(s[0].whenText, "los lunes a las 8:00");
  assert.equal(s[0].machine, "macbook-main");
  const machines = parseMachines({
    machines: [{ machine: "macbook-main", online: true, self: true, baseUrl: "http://192.168.0.170:8650", capabilities: { runs: true } }],
  });
  assert.ok(machines[0].self && machines[0].canRun);
  assert.deepEqual(parseApprovals({ approvals: [], watched: false }), { approvals: [], watched: false });
  assert.deepEqual(parseWorkers({ workers: [], projects: [] }), []);
  const w = parseWorkers({
    workers: [{ id: "r1", source: "run", name: "x", status: "working", task: { name: "Brief", summary: "" }, tool: { name: "Bash", target: "ls" }, lines: ["a", 3], machine: "m", toolCalls: 2, startedAt: "2026-10-24T14:50:00.000Z" }],
  });
  assert.equal(w[0].name, "Brief");
  assert.deepEqual(w[0].lines, ["a"]);
  assert.equal(w[0].toolName, "Bash");
  const runs = parseRuns([{ id: "r", started_at: "2026-10-19T13:01:57.0565+00:00", status: "ok", output: "hola" }, { status: "ok" }]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].startedAt, at("2026-10-19T13:01:57.056Z"));
  // Basura no revienta: devuelve vacío.
  assert.deepEqual(parseScheduled({ error: "x" }), []);
  assert.deepEqual(parseCloudAgents(null), []);
});

test("cabecera", () => {
  const team = build(
    { workers: [worker("a", "A", "working"), worker("b", "B", "needs_you")], scheduled: [sched("t", "T", null)], machines: mini },
    { now, zone },
  );
  assert.equal(headline(team), "1 trabajando · 1 te necesita · 1 en espera");
  assert.equal(headline([]), "Nadie trabajando ahora");
});

test("los agentes de la nube entran al equipo con su último mensaje", () => {
  const cloud = parseCloudAgents({
    agents: [
      { id: "agent_1", name: "Teky", status: "idle", preview: "Todo arriba", updated_at: "2026-10-24T16:16:06.512309Z", cost_usd: 0.02, next_run_at: "2026-10-26T13:00:00Z" },
      { id: "agent_2", name: "Licitaciones", status: "none", preview: null, updated_at: null, cost_usd: 0, next_run_at: null },
      { id: "agent_3", name: "Corriendo", status: "running", preview: null, updated_at: null, cost_usd: 0, next_run_at: null },
    ],
  });
  const by = Object.fromEntries(build({ cloud }, { now, zone }).map((m) => [m.name, m]));
  assert.equal(by["Teky"].status, "DONE");
  assert.equal(by["Teky"].line, "Todo arriba");
  assert.equal(by["Teky"].where, "Nube");
  assert.equal(by["Teky"].cloudId, "agent_1");
  assert.equal(by["Licitaciones"].status, "ASLEEP");
  assert.equal(by["Licitaciones"].line, "Escríbele para empezar");
  assert.equal(by["Corriendo"].status, "WORKING");
});

test("si una fuente no responde, sus miembros no aparecen (y las demás sí)", () => {
  const cloud = parseCloudAgents({ agents: [{ id: "c", name: "Nube", status: "none" }] });
  const team = build({ workers: null, scheduled: null, machines: null, cloud }, { now, zone });
  assert.deepEqual(
    team.map((m) => m.id),
    ["cloud:c"],
  );
});

test("lee el chat de un agente de la nube", () => {
  const chat = parseCloudChat({
    session_id: "s1",
    status: "idle",
    cost_usd: 0.03,
    messages: [
      { id: "m1", role: "user", text: "hola", at: "2026-10-24T16:00:00Z" },
      { id: "m2", role: "agent", text: "Todo arriba", at: null },
    ],
    steps: [{ id: "p", text: "bash: curl" }],
  });
  assert.equal(chat.sessionId, "s1");
  assert.deepEqual(
    chat.messages.map((m) => m.fromAgent),
    [false, true],
  );
  assert.deepEqual(chat.steps, ["bash: curl"]);
  assert.equal(chat.costUsd, 0.03);
});

test("por qué faltan los agentes de la nube", () => {
  assert.ok(cloudIssue(404).includes("todavía no los trae"));
  assert.ok(cloudIssue(502).includes("no respondieron"));
  assert.ok(cloudIssue(null).includes("no respondieron"));
});
