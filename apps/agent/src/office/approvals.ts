// Solicitudes de permiso vivas de la Oficina: un agente que va a hacer algo con
// efectos se PAUSA aquí hasta que el humano decide (o pasan 10 minutos).
//
// Dos caminos llegan a lo mismo:
// - Tareas del Agent SDK: canUseTool en session.ts llama a requestApproval y
//   espera la promesa.
// - Runs de claude -p: el CLI pregunta por --permission-prompt-tool al puente
//   approval-mcp.mjs, que hace POST /office/approvals/ask y consulta la decisión.
//   Cada run recibe un token propio que solo sirve para PEDIR y leer sus propias
//   decisiones; decidir exige la credencial normal del dashboard.
//
// Todo en memoria a propósito: una solicitud es un run pausado en ESTE proceso.
// Si el agente se reinicia, el run murió con él.

import { randomBytes, randomUUID } from "node:crypto";
import {
  APPROVAL_TIMEOUT_MS,
  PLAN_TOOL,
  denialMessage,
  describeApproval,
  type ApprovalDecision,
  type ApprovalOutcome,
  type OfficeApproval,
  type OfficeMode,
} from "@hermes/shared";
import { setOfficeApproval } from "./state.js";

interface Pending {
  approval: OfficeApproval;
  workerId: string;
  input: Record<string, unknown>;
  resolve: (d: ApprovalDecision) => void;
  timer: NodeJS.Timeout;
}

const pending = new Map<string, Pending>();
/** Decisiones ya tomadas, un rato, para que el puente de claude -p las lea al consultar. */
const decided = new Map<string, { decision: ApprovalDecision; workerId: string }>();
const DECIDED_TTL_MS = 60_000;
/** token del run → id del personaje (run). */
const runTokens = new Map<string, string>();

function close(id: string, outcome: ApprovalOutcome, note?: string, mode?: OfficeMode): boolean {
  const p = pending.get(id);
  if (!p) return false;
  pending.delete(id);
  clearTimeout(p.timer);
  const decision: ApprovalDecision =
    outcome === "allowed"
      ? {
          behavior: "allow",
          updatedInput: p.input,
          // Aprobar puede cambiar el modo de la sesión: un plan aprobado se ejecuta en Auto (o el que elijas).
          ...(mode ? { updatedPermissions: [{ type: "setMode" as const, mode, destination: "session" as const }] } : {}),
        }
      : { behavior: "deny", message: denialMessage(outcome, note) };
  decided.set(id, { decision, workerId: p.workerId });
  setTimeout(() => decided.delete(id), DECIDED_TTL_MS).unref();
  setOfficeApproval(p.workerId, null, outcome);
  p.resolve(decision);
  return true;
}

/**
 * Pausa al personaje `workerId` hasta que el humano decida. Si el personaje ya
 * tenía una solicitud abierta (no debería: el run espera), la anterior se cierra.
 */
export function requestApproval(
  workerId: string,
  tool: string,
  input: Record<string, unknown>,
): { id: string; decision: Promise<ApprovalDecision> } {
  for (const [id, p] of pending) if (p.workerId === workerId) close(id, "gone");
  const id = randomUUID().slice(0, 8);
  const now = Date.now();
  const { summary, detail } = describeApproval(tool, input);
  const approval: OfficeApproval = {
    id,
    tool,
    summary,
    detail,
    since: new Date(now).toISOString(),
    expiresAt: new Date(now + APPROVAL_TIMEOUT_MS).toISOString(),
  };
  let resolve!: (d: ApprovalDecision) => void;
  const decision = new Promise<ApprovalDecision>((r) => (resolve = r));
  const timer = setTimeout(() => close(id, "timeout"), APPROVAL_TIMEOUT_MS);
  timer.unref();
  pending.set(id, { approval, workerId, input, resolve, timer });
  // Sin personaje en la oficina (p. ej. un run que nació antes de este proceso)
  // no hay dónde levantar la mano: nadie lo va a ver, así que se niega ya.
  if (!setOfficeApproval(workerId, approval)) close(id, "gone");
  return { id, decision };
}

/**
 * El humano decidió. false = ya no existía (decidida, vencida o cerrada).
 * En un plan, negar es "pedir cambios" (sigue planeando) y aprobar lo ejecuta
 * en `mode` (Auto si no se dice otro, como el "sí" por defecto de Claude Code).
 */
export function decideApproval(id: string, allow: boolean, note?: string, mode?: OfficeMode): boolean {
  const plan = pending.get(id)?.approval.tool === PLAN_TOOL;
  if (!allow) return close(id, plan ? "plan-changes" : "denied", note);
  return close(id, "allowed", undefined, plan ? (mode && mode !== "plan" ? mode : "auto") : mode);
}

/** El run terminó o se detuvo: lo que esperaba se cierra sin ejecutarse. */
export function closeApprovalsFor(workerId: string): void {
  for (const [id, p] of pending) if (p.workerId === workerId) close(id, "gone");
}

/** Estado de una solicitud para el puente: decidida, pendiente o desconocida. */
export function approvalState(id: string): { workerId: string; decision?: ApprovalDecision } | null {
  const d = decided.get(id);
  if (d) return d;
  const p = pending.get(id);
  return p ? { workerId: p.workerId } : null;
}

export function pendingApprovals(): Array<OfficeApproval & { workerId: string }> {
  return [...pending.values()].map((p) => ({ ...p.approval, workerId: p.workerId }));
}

/** Token del puente para un run de claude -p (se revoca al terminar el run). */
export function issueRunToken(runId: string): string {
  const token = randomBytes(24).toString("hex");
  runTokens.set(token, runId);
  return token;
}

export function revokeRunToken(token: string): void {
  runTokens.delete(token);
}

export function runForToken(token: string | undefined): string | null {
  return token ? (runTokens.get(token) ?? null) : null;
}
