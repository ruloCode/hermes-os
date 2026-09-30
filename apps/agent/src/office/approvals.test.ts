import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROVAL_TIMEOUT_MS,
  DEFAULT_OFFICE_MODE,
  THINKING_AFTER_MS,
  denialMessage,
  nextOfficeMode,
  officeModeFromCli,
  officeModeLabel,
  setWorkerMode,
  describeApproval,
  isReadOnlyBash,
  needsApproval,
  officeCounts,
  reduceOfficeEvent,
  registerWorker,
  setWorkerApproval,
  tickOffice,
  type AgentActivityEvent,
  type OfficeApproval,
  type OfficeWorker,
} from "@hermes/shared";

const T0 = Date.parse("2026-09-30T15:00:00.000Z");

function ev(kind: AgentActivityEvent["kind"], at: number, extra: Partial<AgentActivityEvent> = {}): AgentActivityEvent {
  return { kind, ts: new Date(at).toISOString(), machine: "mac", taskId: "r1", ...extra };
}

function approval(summary = "git commit -m x"): OfficeApproval {
  return {
    id: "a1",
    tool: "Bash",
    summary,
    detail: summary,
    since: new Date(T0).toISOString(),
    expiresAt: new Date(T0 + APPROVAL_TIMEOUT_MS).toISOString(),
  };
}

function working() {
  const workers = new Map<string, OfficeWorker>();
  registerWorker(workers, { id: "r1", source: "run", project: "hermes-os", title: "Arregla el login" }, T0);
  reduceOfficeEvent(workers, ev("tool_call", T0 + 1000, { toolName: "Bash", detail: JSON.stringify({ command: "git commit -m x" }) }));
  return workers;
}

describe("isReadOnlyBash: solo lo que de verdad solo lee pasa sin preguntar", () => {
  it("lecturas comunes pasan", () => {
    for (const c of [
      "ls -la",
      "git status",
      "git log --oneline -5",
      "git diff HEAD~1 -- src",
      "cat package.json | head -20",
      "grep -rn foo src && wc -l src/a.ts",
      "find . -name '*.ts'",
      "sed -n 1,20p a.ts",
      "node -v",
      "ls 2>/dev/null",
      "cat a.ts 2>&1 | head",
      "NODE_ENV=test cat a.ts",
      "git branch -a",
    ]) {
      assert.equal(isReadOnlyBash(c), true, c);
    }
  });

  it("cualquier efecto pide permiso", () => {
    for (const c of [
      "git commit -m x",
      "git push",
      "git checkout -b x",
      "git branch -D viejo",
      "rm a.ts",
      "pnpm install",
      "echo hola > a.txt",
      "cat a >> b",
      "sed -i '' s/a/b/ a.ts",
      "find . -name '*.log' -delete",
      "find . -exec rm {} ;",
      "ls && rm -f x",
      "cat $(rm a)",
      "echo `rm a`",
      "env rm a",
      "curl -X POST http://x",
      "node script.js",
    ]) {
      assert.equal(isReadOnlyBash(c), false, c);
    }
  });

  it("needsApproval: solo Bash de lectura se libra; otras tools que llegan a preguntar, preguntan", () => {
    assert.equal(needsApproval("Bash", { command: "git status" }), false);
    assert.equal(needsApproval("Bash", { command: "git commit -m x" }), true);
    assert.equal(needsApproval("Edit", { file_path: "/x/a.ts" }), true);
    assert.equal(needsApproval("mcp__linear__save_issue", {}), true);
  });
});

describe("describeApproval: la tarjeta muestra la acción exacta", () => {
  it("Bash = el comando entero; archivos = tool + ruta", () => {
    assert.deepEqual(describeApproval("Bash", { command: "git commit -m 'arregla login'" }), {
      summary: "git commit -m 'arregla login'",
      detail: "git commit -m 'arregla login'",
    });
    assert.equal(describeApproval("Edit", { file_path: "/a/b.ts", old_string: "x" }).detail, "Edit /a/b.ts");
    assert.equal(describeApproval("mcp__linear__save_issue", { title: "X" }).summary, 'save_issue {"title":"X"}');
  });

  it("un comando largo se recorta en el resumen, no en el detalle (hasta el tope)", () => {
    const long = `echo ${"a".repeat(200)}`;
    const d = describeApproval("Bash", { command: long });
    assert.ok(d.summary.length <= 90 && d.summary.endsWith("…"));
    assert.equal(d.detail, long);
  });
});

describe("denialMessage: el modelo sabe por qué y no reintenta igual", () => {
  it("negado por el humano lleva su indicación", () => {
    const m = denialMessage("denied", "no commitees, déjame el diff");
    assert.match(m, /NEGÓ/);
    assert.match(m, /déjame el diff/);
  });
  it("vencido dice cuánto esperó", () => {
    assert.match(denialMessage("timeout"), /10 minutos/);
  });
});

describe("setWorkerApproval: levantar y bajar la mano", () => {
  it("con solicitud → needs_you, tarjeta y laptop dicen qué pide", () => {
    const workers = working();
    const w = setWorkerApproval(workers, "r1", approval(), "allowed", T0 + 2000)!;
    assert.equal(w.status, "needs_you");
    assert.equal(w.approval?.id, "a1");
    assert.equal(w.task.summary, "Pide permiso: git commit -m x");
    assert.equal(w.lines.at(-1), "✋ git commit -m x");
    assert.equal(officeCounts(workers.values()).needs_you, 1);
  });

  it("aprobado → vuelve a trabajar y la laptop lo dice", () => {
    const workers = working();
    setWorkerApproval(workers, "r1", approval(), "allowed", T0 + 2000);
    const w = setWorkerApproval(workers, "r1", null, "allowed", T0 + 3000)!;
    assert.equal(w.status, "working");
    assert.equal(w.approval, undefined);
    assert.equal(w.lines.at(-1), "✓ aprobado por ti");
  });

  it("negado y vencido dejan su propia línea", () => {
    const a = working();
    setWorkerApproval(a, "r1", approval(), "allowed", T0 + 2000);
    assert.equal(setWorkerApproval(a, "r1", null, "denied", T0 + 3000)!.lines.at(-1), "✗ negado por ti");
    const b = working();
    setWorkerApproval(b, "r1", approval(), "allowed", T0 + 2000);
    assert.equal(setWorkerApproval(b, "r1", null, "timeout", T0 + 3000)!.lines.at(-1), "✗ nadie respondió: se negó sola");
  });

  it("mientras espera, ni el silencio lo pasa a pensando ni una tool tardía le baja la mano", () => {
    const workers = working();
    setWorkerApproval(workers, "r1", approval(), "allowed", T0 + 2000);
    tickOffice(workers, T0 + 2000 + THINKING_AFTER_MS * 5);
    assert.equal(workers.get("r1")!.status, "needs_you");
    reduceOfficeEvent(workers, ev("tool_call", T0 + 90_000, { toolName: "Bash", detail: JSON.stringify({ command: "git commit -m x" }) }));
    reduceOfficeEvent(workers, ev("text", T0 + 91_000, { detail: "Voy a commitear" }));
    const w = workers.get("r1")!;
    assert.equal(w.status, "needs_you");
    assert.equal(w.task.summary, "Pide permiso: git commit -m x");
  });

  it("si el run termina esperando, la solicitud desaparece con él", () => {
    const workers = working();
    setWorkerApproval(workers, "r1", approval(), "allowed", T0 + 2000);
    reduceOfficeEvent(workers, ev("task_done", T0 + 5000, { detail: "cancelado" }));
    const w = workers.get("r1")!;
    assert.equal(w.status, "done");
    assert.equal(w.approval, undefined);
    assert.equal(setWorkerApproval(workers, "r1", approval(), "allowed", T0 + 6000), null);
  });

  it("un personaje que no existe no levanta la mano", () => {
    assert.equal(setWorkerApproval(new Map(), "nadie", approval()), null);
  });
});

describe("modos de la oficina (los de Claude Code)", () => {
  it("el modo que reporta el CLI se traduce sin inventar etiquetas", () => {
    assert.equal(officeModeFromCli("auto"), "auto");
    assert.equal(officeModeFromCli("acceptEdits"), "acceptEdits");
    assert.equal(officeModeFromCli("plan"), "plan");
    assert.equal(officeModeFromCli("manual"), "manual");
    // "default" es el nombre viejo de manual (con Haiku, auto arranca así).
    assert.equal(officeModeFromCli("default"), "manual");
    assert.equal(officeModeFromCli("bypassPermissions"), undefined);
    assert.equal(officeModeFromCli(undefined), undefined);
  });

  it("Shift+Tab recorre los cuatro y vuelve al principio", () => {
    const seen = [DEFAULT_OFFICE_MODE];
    for (let i = 0; i < 4; i++) seen.push(nextOfficeMode(seen[seen.length - 1]));
    assert.deepEqual(seen, ["auto", "acceptEdits", "plan", "manual", "auto"]);
    assert.equal(officeModeLabel("acceptEdits"), "Editar");
  });

  it("un plan se describe por su título y se muestra entero", () => {
    const plan = "# Plan: agregar la línea adiós\n\n## Pasos\n1. Editar a.txt";
    const d = describeApproval("ExitPlanMode", { plan });
    assert.equal(d.summary, "Plan: agregar la línea adiós");
    assert.equal(d.detail, plan);
    assert.equal(describeApproval("ExitPlanMode", { plan: "" }).detail, "(el agente no escribió el plan)");
  });

  it("pedir cambios a un plan le dice que siga planeando", () => {
    assert.match(denialMessage("plan-changes", "hazlo en dos commits"), /sigue en modo plan/);
    assert.match(denialMessage("plan-changes", "hazlo en dos commits"), /dos commits/);
  });

  it("la tarjeta de un plan dice que propone, no que pide permiso", () => {
    const workers = working();
    const w = setWorkerApproval(workers, "r1", { ...approval("Plan: migrar la tabla"), tool: "ExitPlanMode" }, "allowed", T0 + 2000)!;
    assert.equal(w.task.summary, "Propone un plan: migrar la tabla");
    assert.equal(setWorkerApproval(workers, "r1", null, "plan-changes", T0 + 3000)!.lines.at(-1), "↺ pediste cambios al plan");
  });

  it("el modo real se guarda y solo publica cuando cambia", () => {
    const workers = working();
    assert.equal(setWorkerMode(workers, "r1", "plan")?.mode, "plan");
    assert.equal(setWorkerMode(workers, "r1", "plan"), null);
    assert.equal(setWorkerMode(workers, "r1", undefined), null);
    assert.equal(setWorkerMode(workers, "r1", "auto")?.mode, "auto");
  });

  it("lo que el modo Auto niega solo se ve como bloqueado, con su motivo", () => {
    const workers = working();
    reduceOfficeEvent(
      workers,
      ev("tool_result", T0 + 2000, {
        detail: "Permission for this action was denied by the Claude Code auto mode classifier. Reason: [Data Exfiltration]. If you have other tasks",
      }),
    );
    const w = workers.get("r1")!;
    assert.equal(w.status, "blocked");
    assert.equal(w.task.summary, "El modo Auto lo negó: Data Exfiltration");
    // La siguiente tool lo devuelve a trabajar, como cualquier bloqueo.
    reduceOfficeEvent(workers, ev("tool_call", T0 + 3000, { toolName: "Read", detail: JSON.stringify({ file_path: "/a.ts" }) }));
    assert.equal(workers.get("r1")!.status, "working");
  });
});
