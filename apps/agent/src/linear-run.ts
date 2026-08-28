/**
 * Puente Linear ↔ motor de ejecución (Linear-first).
 *
 * Linear es la VERDAD de las tareas; la tabla local `tasks` guarda solo la
 * fila-puente de ejecución (local_key = "linear:RUL-x") que engancha el issue
 * al motor existente: runs headless de Claude Code, stream SSE, memoria de
 * ejecuciones (.md del vault + task_executions) y "Continuar" con la misma
 * sesión. Ejecutar mueve el issue a In Progress; al terminar, Hermes comenta
 * el resultado en el issue y lo deja en In Progress para revisión humana
 * (marcar Done es decisión del dueño, desde el dashboard o Linear).
 */
import type { Task } from "@hermes/shared";
import { env } from "./env.js";
import { supabase } from "./supabase.js";
import {
  createLinearIssue,
  getLinearIssue,
  listLinearIssues,
  updateIssueState,
  commentOnIssue,
  type LinearIssue,
  type LinearIssueDetail,
} from "./linear.js";
import { readProjects } from "./vault/projects.js";
import { executeTask, setTaskStatus, type TaskRunRef } from "./tasks/store.js";
import { subscribeClaudeRun, getClaudeRun } from "./agent/claude-cli.js";
import { OWNER } from "./owner.js";

const bridgeKey = (identifier: string) => `linear:${identifier.toUpperCase()}`;

/** Proyecto de Linear (nombre canónico) → slug del vault. Inverso de resolveProjectId. */
async function slugForIssue(issue: LinearIssueDetail): Promise<string> {
  const name = issue.project?.name;
  if (name) {
    const vault = await readProjects().catch(() => []);
    const p = vault.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (p) return p.slug;
    return name.toLowerCase().replace(/\s+/g, "-");
  }
  // Sin proyecto en Linear: un label que coincida con un slug del vault.
  const vault = await readProjects().catch(() => []);
  const slugs = new Set(vault.map((p) => p.slug.toLowerCase()));
  const label = issue.labels.nodes.find((l) => slugs.has(l.name.toLowerCase()));
  return label?.name.toLowerCase() ?? "hermes-os";
}

/** Prompt de respaldo cuando el issue no trae bloque "Copy prompt". */
function composePrompt(issue: LinearIssueDetail, slug: string): string {
  const body = issue.description.split(/^##\s.*copy prompt.*$/im)[0].trim();
  return [
    `Ejecuta esta tarea de Linear (${issue.identifier}) del proyecto ${slug}: ${issue.title}`,
    body,
    "Al terminar, resume qué hiciste y cómo verificarlo.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Fila-puente en `tasks` para un issue de Linear (idempotente por local_key).
 * Refresca título/prompt en cada llamada: si el issue cambió en Linear, la
 * siguiente ejecución usa lo nuevo. `detail` = URL del issue (el panel de
 * detalle la pinta como link).
 */
export async function bridgeTask(
  issue: LinearIssueDetail,
  extra: { meetingId?: string | null; meetingIdx?: number | null } = {},
): Promise<Task | null> {
  if (!supabase) return null;
  const slug = await slugForIssue(issue);
  const prompt = issue.copyPrompt ?? composePrompt(issue, slug);
  const { data, error } = await supabase
    .from("tasks")
    .upsert(
      {
        local_key: bridgeKey(issue.identifier),
        project_slug: slug,
        title: `${issue.identifier} · ${issue.title}`,
        detail: issue.url,
        exec_prompt: prompt,
        source: "manual",
        meeting_id: extra.meetingId ?? null,
        meeting_idx: extra.meetingIdx ?? null,
        machine: env.MACHINE_NAME,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[linear-run] bridge:", error.message);
    return null;
  }
  return data as Task;
}

export interface LinearRunRef extends TaskRunRef {
  identifier: string;
}

/**
 * Ejecuta un issue de Linear con Claude Code: puente local → In Progress en
 * Linear → run headless. Al terminar comenta el resultado en el issue.
 */
export async function executeLinearIssue(identifier: string): Promise<LinearRunRef | null> {
  const issue = await getLinearIssue(identifier);
  const task = await bridgeTask(issue);
  if (!task) return null;

  // El estado en Linear es informativo del flujo — best-effort, nunca bloquea el run.
  void updateIssueState(identifier, "started").catch((e) =>
    console.error("[linear-run] estado started:", e),
  );

  const ref = await executeTask(task.id);
  if (!ref) return null;

  const unsub = subscribeClaudeRun(ref.runId, (line) => {
    if ((line.kind === "done" || line.kind === "error") && line.text.includes("finaliz")) {
      unsub?.();
      void reportRunToLinear(identifier, ref.runId, line.kind === "done").catch((e) =>
        console.error("[linear-run] comentario:", e),
      );
    }
  });

  return { ...ref, identifier: issue.identifier };
}

/** Comenta en el issue cómo terminó el run (métricas reales del proceso). */
async function reportRunToLinear(identifier: string, runId: string, ok: boolean): Promise<void> {
  const run = getClaudeRun(runId);
  const mins = run?.durationMs ? ` en ${Math.max(1, Math.round(run.durationMs / 60000))} min` : "";
  const turns = run?.numTurns ? ` · ${run.numTurns} turnos` : "";
  const body = ok
    ? `🤖 **Hermes ejecutó esta tarea con Claude Code**${mins}${turns}.\n\nEl análisis completo quedó en el dashboard (TAREAS → Ejecuciones). El issue queda en In Progress hasta que ${OWNER} verifique y lo marque Done.`
    : `🤖 **La ejecución con Claude Code falló o quedó incompleta**${mins}.\n\nRevisa el stream en el dashboard (TAREAS) y usa Continuar para retomarla con la misma sesión.`;
  await commentOnIssue(identifier, body);
}

/**
 * Cambia el estado del issue en Linear y refleja el puente local (para que
 * el resumen del tracker no mienta). "completed" también marca done la fila.
 */
export async function setLinearIssueState(
  identifier: string,
  stateType: "backlog" | "unstarted" | "started" | "completed" | "canceled",
): Promise<{ identifier: string; state: string }> {
  const res = await updateIssueState(identifier, stateType);
  if (supabase) {
    const { data } = await supabase
      .from("tasks")
      .select("id")
      .eq("local_key", bridgeKey(identifier))
      .maybeSingle();
    if (data) {
      const local = stateType === "completed" ? "done" : stateType === "canceled" ? "dismissed" : "pending";
      void setTaskStatus(data.id, local).catch(() => {});
    }
  }
  return res;
}

export type BoardIssue = LinearIssue & {
  /** Estado de ejecución local (fila-puente), si existe. */
  local?: {
    task_id: number;
    status: Task["status"];
    run_id: string | null;
    session_id: string | null;
  };
};

/**
 * Tablero Linear-first: issues del team (excluye canceladas; Done viaja para
 * el grupo colapsado) + overlay de ejecución local por identifier.
 */
export async function linearBoard(opts: { project?: string } = {}): Promise<BoardIssue[]> {
  const issues = await listLinearIssues({ project: opts.project, includeDone: true, limit: 50 });
  const visible = issues.filter((i) => i.state.type !== "canceled");

  if (!supabase) return visible;
  const { data } = await supabase
    .from("tasks")
    .select("id,local_key,status,run_id,session_id")
    .like("local_key", "linear:%");
  const byIdentifier = new Map(
    (data ?? []).map((t) => [
      String(t.local_key).slice("linear:".length),
      {
        task_id: t.id as number,
        status: t.status as Task["status"],
        run_id: (t.run_id as string) ?? null,
        session_id: (t.session_id as string) ?? null,
      },
    ]),
  );
  return visible.map((i) => {
    const local = byIdentifier.get(i.identifier.toUpperCase());
    return local ? { ...i, local } : i;
  });
}

/**
 * Triage Linear-first de un accionable de junta: crea el issue en Linear (el
 * exec_prompt del accionable ES el Copy prompt) y deja la fila-puente con la
 * referencia a la junta (overlay del MeetingDetail). No ejecuta.
 */
export async function createIssueFromActionable(input: {
  project: string;
  title: string;
  detail?: string | null;
  execPrompt?: string | null;
  meetingId: string;
  meetingIdx: number;
}): Promise<{ issue: { identifier: string; url: string }; task: Task | null }> {
  const description = [
    input.detail?.trim() || input.title,
    `_Origen: accionable de la junta \`${input.meetingId}\` (${input.project})._`,
  ].join("\n\n");
  const prompt =
    input.execPrompt?.trim() ||
    `En el proyecto ${input.project}, ejecuta esta tarea: ${input.title}${input.detail ? `\n${input.detail}` : ""}`;
  const issue = await createLinearIssue({
    title: input.title,
    description,
    prompt,
    project: input.project,
  });
  const detail = await getLinearIssue(issue.identifier);
  const task = await bridgeTask(detail, {
    meetingId: input.meetingId,
    meetingIdx: input.meetingIdx,
  });
  return { issue, task };
}
