// Simulación para QA y ensayo SIN gastar tokens: window.__hermesOficinaSim("demo")
// pinta una oficina con todos los estados. La página la marca siempre como
// SIMULACIÓN en el HUD — la regla del dashboard (todo dato visible es real)
// se respeta diciendo qué no lo es.

import { APPROVAL_TIMEOUT_MS, describeApproval, type OfficeAction, type OfficeMode, type OfficeProject, type OfficeState, type OfficeWorker, type OfficeWorkerStatus } from "@hermes/shared";

interface Seed {
  project: string;
  name: string;
  status: OfficeWorkerStatus;
  mode?: OfficeMode;
  /** Solicitud abierta: la tool y lo que pide (el comando o el plan). */
  ask?: { tool: string; detail: string };
  action?: OfficeAction;
  summary: string;
  lines: string[];
}

const SEEDS: Seed[] = [
  {
    project: "",
    name: "Lee el README",
    status: "working",
    action: "read",
    summary: "Read apps/agent/src/index.ts",
    lines: ["❯ Lee el README y resume la arquitectura", "⚙ Glob **/README.md", "↩ README.md", "⚙ Read README.md", "⚙ Read apps/agent/src/index.ts"],
  },
  {
    project: "",
    name: "Arregla el login",
    status: "working",
    action: "edit",
    summary: "Edit src/auth/login.ts",
    lines: ["❯ Arregla el redirect del login", "⚙ Grep redirect", "⚙ Read src/auth/login.ts", "⚙ Edit src/auth/login.ts"],
  },
  {
    project: "",
    name: "Corre los tests",
    status: "working",
    action: "test",
    summary: "Bash pnpm test",
    lines: ["❯ Corre la suite y arregla lo que falle", "⚙ Bash pnpm test", "↩ # tests 603 # pass 603"],
  },
  {
    project: "",
    name: "Investiga precios",
    status: "working",
    action: "web",
    summary: "WebFetch https://docs.anthropic.com",
    lines: ["❯ Compara precios de modelos", "⚙ WebSearch precios claude", "⚙ WebFetch https://docs.anthropic.com"],
  },
  {
    project: "",
    name: "Planea la migración",
    status: "thinking",
    summary: "Voy a revisar primero el esquema…",
    lines: ["❯ Planea la migración 026", "⚙ Read supabase/migrations/025.sql", "Voy a revisar primero el esquema…"],
  },
  {
    project: "",
    name: "Limpia el repo",
    status: "blocked",
    summary: "GUARDRAIL: rm -rf fuera del proyecto",
    lines: ["❯ Limpia los temporales", "⚙ Bash ls -la", "✗ GUARDRAIL: rm -rf fuera del proyecto"],
  },
  {
    project: "",
    name: "Publica la rama",
    status: "needs_you",
    mode: "acceptEdits",
    ask: { tool: "Bash", detail: "git push origin fix/login" },
    summary: "Pide permiso: git push origin fix/login",
    lines: ["❯ Sube el arreglo del login", "⚙ Bash git status", "⚙ Bash git push origin fix/login", "✋ git push origin fix/login"],
  },
  {
    project: "",
    name: "Agrega modo oscuro",
    status: "needs_you",
    mode: "plan",
    ask: {
      tool: "ExitPlanMode",
      detail:
        "# Plan: modo oscuro en la configuración\n\n## Contexto\nLa app solo tiene tema claro; los colores están escritos a mano en 14 componentes.\n\n## Pasos\n1. Pasar los colores a variables en `theme.css`.\n2. Agregar el interruptor en `Settings.tsx` y guardar la preferencia.\n3. Probar los 14 componentes en los dos temas.\n\n## Verificación\n- `pnpm test` y capturas en claro y oscuro.",
    },
    summary: "Propone un plan: modo oscuro en la configuración",
    lines: ["❯ Agrega modo oscuro a la app", "⚙ Grep color:", "⚙ Read src/theme.css", "📋 Plan: modo oscuro en la configuración"],
  },
  {
    project: "",
    name: "Resume la junta",
    status: "done",
    summary: "$0.12 · 34s · Tres accionables",
    lines: ["❯ Resume la junta del lunes", "⚙ Read junta.md", "✓ $0.12 · 34s · Tres accionables"],
  },
  {
    project: "",
    name: "Sube el build",
    status: "error",
    summary: "falló (código 1)",
    lines: ["❯ Sube el build a producción", "⚙ Bash pnpm build", "↩ error TS2322", "✗ falló (código 1)"],
  },
];

/**
 * Estado de demostración sobre los proyectos reales que ya tiene la página.
 * `count` (QA y capturas) recorta o repite las semillas: 0, 3, 10 personajes.
 */
export function demoOfficeState(projects: OfficeProject[], machine: string, count = SEEDS.length): OfficeState {
  const slugs = projects.length ? projects.map((p) => p.slug) : ["general"];
  const now = Date.now();
  const seeds = Array.from({ length: Math.max(0, count) }, (_, i) => SEEDS[i % SEEDS.length]);
  const workers: OfficeWorker[] = seeds.map((s, i) => {
    const at = new Date(now - (seeds.length - i) * 20_000).toISOString();
    const terminal = s.status === "done" || s.status === "error";
    return {
      id: `sim-${i}`,
      source: "run",
      project: slugs[i % Math.min(4, slugs.length)],
      name: s.name,
      status: s.status,
      action: s.action,
      task: { name: s.name, summary: s.summary },
      tool: undefined,
      startedAt: at,
      lastEventAt: at,
      finishedAt: terminal ? at : undefined,
      lastText: s.summary,
      toolCalls: s.lines.filter((l) => l.startsWith("⚙")).length,
      failStreak: 0,
      machine,
      lines: s.lines,
      mode: s.mode ?? "auto",
      approval: s.ask
        ? {
            id: `sim-approval-${i}`,
            tool: s.ask.tool,
            ...describeApproval(s.ask.tool, s.ask.tool === "Bash" ? { command: s.ask.detail } : { plan: s.ask.detail }),
            since: at,
            expiresAt: new Date(Date.parse(at) + APPROVAL_TIMEOUT_MS).toISOString(),
          }
        : undefined,
    };
  });
  return { workers, projects, machine, ts: new Date(now).toISOString() };
}
