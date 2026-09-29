import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GRACE_MS,
  LAPTOP_LINES,
  THINKING_AFTER_MS,
  describeTool,
  nameWorker,
  officeCounts,
  parseToolInput,
  reduceOfficeEvent,
  registerWorker,
  shortToolName,
  tickOffice,
  type AgentActivityEvent,
  type OfficeWorker,
} from "@hermes/shared";

const T0 = Date.parse("2026-09-29T15:00:00.000Z");

function ev(kind: AgentActivityEvent["kind"], at: number, extra: Partial<AgentActivityEvent> = {}): AgentActivityEvent {
  return { kind, ts: new Date(at).toISOString(), machine: "mac", taskId: "r1", ...extra };
}

function office() {
  return new Map<string, OfficeWorker>();
}

describe("reduceOfficeEvent: ciclo de un run", () => {
  it("task_start → tool_call → text → task_done", () => {
    const m = office();
    const w1 = reduceOfficeEvent(m, ev("task_start", T0, { detail: "claude -p: lee el README y resume la arquitectura" }));
    assert.equal(w1?.status, "starting");
    assert.equal(w1?.name, "Lee el README");

    const w2 = reduceOfficeEvent(m, ev("tool_call", T0 + 1000, { toolName: "Read", detail: JSON.stringify({ file_path: "/repo/README.md" }) }));
    assert.equal(w2?.status, "working");
    assert.equal(w2?.action, "read");
    assert.deepEqual(w2?.tool, { name: "Read", target: "/repo/README.md" });
    assert.equal(w2?.toolCalls, 1);
    assert.equal(w2?.task.summary, "Read /repo/README.md");

    reduceOfficeEvent(m, ev("tool_call", T0 + 2000, { toolName: "Edit", detail: JSON.stringify({ file_path: "/repo/a.ts" }) }));
    assert.equal(m.get("r1")?.action, "edit");

    reduceOfficeEvent(m, ev("text", T0 + 3000, { detail: "Listo: la arquitectura tiene dos procesos.\nMás detalle" }));
    assert.equal(m.get("r1")?.task.summary, "Listo: la arquitectura tiene dos procesos.");

    const w5 = reduceOfficeEvent(m, ev("task_done", T0 + 4000, { detail: "$0.02 · 12s · resumen" }));
    assert.equal(w5?.status, "done");
    assert.equal(w5?.finishedAt, new Date(T0 + 4000).toISOString());
    assert.equal(w5?.action, undefined);
    assert.ok(w5?.lines.at(-1)?.startsWith("✓"));
  });

  it("un tool_call de un taskId desconocido hace nacer al personaje", () => {
    const m = office();
    const w = reduceOfficeEvent(m, ev("tool_call", T0, { taskId: "x9", toolName: "Grep", detail: '{"pattern":"setStatus"}' }));
    assert.equal(w?.id, "x9");
    assert.equal(w?.status, "working");
    assert.equal(w?.project, "general");
  });

  it("eventos sin taskId, los del propio bus de la oficina y los cierres huérfanos no crean nada", () => {
    const m = office();
    assert.equal(reduceOfficeEvent(m, ev("tool_call", T0, { taskId: undefined, toolName: "Read" })), null);
    assert.equal(reduceOfficeEvent(m, ev("office", T0, { detail: "{}" })), null);
    assert.equal(reduceOfficeEvent(m, ev("task_done", T0, { taskId: "nadie" })), null);
    assert.equal(m.size, 0);
  });

  it("guardrail → bloqueado, y la siguiente tool lo devuelve a trabajar", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { detail: "limpia el repo" }));
    const b = reduceOfficeEvent(m, ev("error", T0 + 500, { toolName: "Bash", detail: "GUARDRAIL: rm -rf fuera del proyecto" }));
    assert.equal(b?.status, "blocked");
    assert.ok(b?.lines.at(-1)?.startsWith("✗ GUARDRAIL"));
    const w = reduceOfficeEvent(m, ev("tool_call", T0 + 900, { toolName: "Read", detail: '{"file_path":"a"}' }));
    assert.equal(w?.status, "working");
  });

  it("el error de cierre de un run (toolName claude(slug)) es terminal", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { detail: "x" }));
    const w = reduceOfficeEvent(m, ev("error", T0 + 1, { toolName: "claude(hermes-os)", detail: "falló (código 1): x" }));
    assert.equal(w?.status, "error");
    assert.ok(w?.finishedAt);
  });

  it("startTask emite task_done aun cuando falló: el error manda", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { detail: "x" }));
    reduceOfficeEvent(m, ev("error", T0 + 1, { detail: "Error: se cayó el SDK" }));
    const w = reduceOfficeEvent(m, ev("task_done", T0 + 2, { detail: "Error ejecutando al agente" }));
    assert.equal(w?.status, "error");
  });

  it("una tool después del cierre no revive al personaje", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { detail: "x" }));
    reduceOfficeEvent(m, ev("task_done", T0 + 1));
    reduceOfficeEvent(m, ev("tool_call", T0 + 2, { toolName: "Read" }));
    assert.equal(m.get("r1")?.status, "done");
    assert.equal(m.get("r1")?.toolCalls, 0);
  });

  it("dos tests fallidos seguidos → cabeza entre las manos; uno que pasa lo quita", () => {
    const m = office();
    const run = (at: number, out: string) => {
      reduceOfficeEvent(m, ev("tool_call", at, { toolName: "Bash", detail: JSON.stringify({ command: "pnpm test" }) }));
      reduceOfficeEvent(m, ev("tool_result", at + 1, { detail: out }));
    };
    run(T0, "# tests 4\n# pass 3\n# fail 1");
    assert.equal(m.get("r1")?.action, "test");
    run(T0 + 10, "# tests 4\n# pass 3\n# fail 1");
    assert.equal(m.get("r1")?.action, "failing");
    run(T0 + 20, "# tests 4\n# pass 4\n# fail 0");
    assert.equal(m.get("r1")?.failStreak, 0);
  });

  it("las programadas nacen de ▶ y cierran con ✓ / ✕", () => {
    const m = office();
    const w = reduceOfficeEvent(m, ev("scheduled", T0, { taskId: "s1", detail: "▶ Resumen del lunes" }));
    assert.equal(w?.source, "scheduled");
    assert.equal(w?.name, "Resumen del lunes");
    reduceOfficeEvent(m, ev("scheduled", T0 + 5, { taskId: "s1", detail: "✕ Resumen del lunes" }));
    assert.equal(m.get("s1")?.status, "error");
    assert.equal(reduceOfficeEvent(office(), ev("scheduled", T0, { taskId: "s2", detail: "✓ huérfana" })), null);
  });

  it("la laptop guarda solo las últimas líneas", () => {
    const m = office();
    for (let i = 0; i < LAPTOP_LINES + 8; i++) {
      reduceOfficeEvent(m, ev("tool_call", T0 + i, { toolName: "Read", detail: JSON.stringify({ file_path: `f${i}.ts` }) }));
    }
    const w = m.get("r1")!;
    assert.equal(w.lines.length, LAPTOP_LINES);
    assert.equal(w.lines.at(-1), `⚙ Read f${LAPTOP_LINES + 7}.ts`);
  });

  it("un evento privado marca al personaje", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { taskId: "composicion-1", detail: "letra", private: true }));
    assert.equal(m.get("composicion-1")?.private, true);
    assert.equal(m.get("composicion-1")?.source, "other");
  });
});

describe("registerWorker", () => {
  it("fija fuente, proyecto y nombre antes del primer evento, y el evento no los pisa", () => {
    const m = office();
    registerWorker(m, { id: "r1", source: "run", project: "hermes-os", title: "Revisa los tests del agente", machine: "mac" }, T0);
    const w = reduceOfficeEvent(m, ev("tool_call", T0 + 1, { toolName: "Read", detail: '{"file_path":"x"}' }))!;
    assert.equal(w.source, "run");
    assert.equal(w.project, "hermes-os");
    assert.equal(w.name, "Revisa los tests");
    assert.equal(w.lines[0], "❯ Revisa los tests del agente");
  });

  it("un task_start con etiqueta renombra con lo que sigue a la etiqueta", () => {
    const m = office();
    registerWorker(m, { id: "r1", source: "run", project: "careways", title: "Contexto: enfócate en careways. Arregla el login" }, T0);
    reduceOfficeEvent(m, ev("task_start", T0 + 1, { detail: "tarea: Arreglar redirect del login" }));
    assert.equal(m.get("r1")?.name, "Arreglar redirect del login");
  });
});

describe("tickOffice", () => {
  it("un personaje callado pasa a pensando; un evento lo devuelve a trabajar", () => {
    const m = office();
    reduceOfficeEvent(m, ev("tool_call", T0, { toolName: "Read" }));
    assert.deepEqual(tickOffice(m, T0 + THINKING_AFTER_MS - 1).changed, []);
    const { changed } = tickOffice(m, T0 + THINKING_AFTER_MS);
    assert.equal(changed[0]?.status, "thinking");
    reduceOfficeEvent(m, ev("text", T0 + THINKING_AFTER_MS + 5, { detail: "hola" }));
    assert.equal(m.get("r1")?.status, "working");
  });

  it("bloqueado no pasa a pensando por silencio", () => {
    const m = office();
    reduceOfficeEvent(m, ev("error", T0, { toolName: "Bash", detail: "GUARDRAIL: no" }));
    reduceOfficeEvent(m, ev("task_start", T0, { taskId: "b", detail: "x" }));
    reduceOfficeEvent(m, ev("error", T0, { taskId: "b", toolName: "Bash", detail: "GUARDRAIL: no" }));
    tickOffice(m, T0 + THINKING_AFTER_MS * 3);
    assert.equal(m.get("b")?.status, "blocked");
  });

  it("tras la gracia, el terminado se va", () => {
    const m = office();
    reduceOfficeEvent(m, ev("task_start", T0, { detail: "x" }));
    reduceOfficeEvent(m, ev("task_done", T0 + 1000));
    assert.deepEqual(tickOffice(m, T0 + 1000 + GRACE_MS - 1).removed, []);
    assert.deepEqual(tickOffice(m, T0 + 1000 + GRACE_MS).removed, ["r1"]);
    assert.equal(m.size, 0);
  });

  it("officeCounts cuenta lo que hay", () => {
    const m = office();
    reduceOfficeEvent(m, ev("tool_call", T0, { taskId: "a", toolName: "Read" }));
    reduceOfficeEvent(m, ev("task_start", T0, { taskId: "b", detail: "x" }));
    reduceOfficeEvent(m, ev("task_done", T0, { taskId: "b" }));
    const c = officeCounts(m.values());
    assert.equal(c.working, 1);
    assert.equal(c.done, 1);
    assert.equal(c.error, 0);
  });
});

describe("nombres y líneas", () => {
  it("nameWorker: sin etiquetas, primera frase, hasta 4 palabras, sin conectores al final", () => {
    assert.equal(nameWorker("claude -p: lee el README y resume"), "Lee el README");
    assert.equal(nameWorker("❯ arregla el login. Luego corre los tests"), "Arregla el login");
    assert.equal(nameWorker("Lee el README: resume la arquitectura"), "Lee el README");
    assert.equal(nameWorker(""), "Agente");
    assert.equal(nameWorker(undefined), "Agente");
    assert.ok(nameWorker("Supercalifragilisticoespialidoso extraordinariamente largo").length <= 28);
  });

  it("parseToolInput rescata campos de un JSON truncado", () => {
    assert.deepEqual(parseToolInput('{"file_path":"/a/b.ts"}'), { file_path: "/a/b.ts" });
    assert.deepEqual(parseToolInput('{"command":"pnpm test","description":"corre los te'), { command: "pnpm test" });
    assert.deepEqual(parseToolInput("no es json"), {});
    assert.deepEqual(parseToolInput(undefined), {});
  });

  it("describeTool acorta el nombre MCP y las rutas largas por la izquierda", () => {
    assert.equal(shortToolName("mcp__hermes__search_memory"), "search_memory");
    assert.equal(shortToolName("mcp__chrome-devtools__navigate_page"), "navigate_page");
    assert.equal(describeTool("Read", ""), "Read");
    const long = `/Users/x/${"carpeta/".repeat(20)}archivo.ts`;
    const d = describeTool("Read", long);
    assert.ok(d.length <= 90, d);
    assert.ok(d.endsWith("archivo.ts"));
    assert.ok(d.startsWith("Read …"));
  });
});
