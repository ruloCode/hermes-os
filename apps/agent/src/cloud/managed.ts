import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Agentes en la nube (Claude Managed Agents) vistos desde Hermes: el teléfono
 * los lista y conversa con ellos por estas funciones, nunca directo con
 * Anthropic (la llave no puede vivir en el APK).
 *
 * La llave se lee de ~/.hermes-os/secrets/anthropic-cloud.key en cada llamada y
 * NO entra a process.env: si estuviera ahí, el CLI de Claude Code que usa
 * Hermes la tomaría y le cobraría a los créditos de la API en vez de al plan.
 *
 * Qué agentes son "del equipo" lo dice ~/.hermes-os/cloud/agents.json (id,
 * environment y la sesión que hace de chat). La sesión ES la conversación: un
 * mensaje nuevo se manda a la misma sesión mientras siga viva.
 */

const DIR = join(homedir(), ".hermes-os", "cloud");
const REGISTRY = join(DIR, "agents.json");
const KEY_FILE = join(homedir(), ".hermes-os", "secrets", "anthropic-cloud.key");
const API = "https://api.anthropic.com/v1";
/** Tope por sesión de chat en centavos de dólar (US$3). */
const CHAT_BUDGET_CENTS = "300";

export interface CloudAgentEntry {
  id: string;
  environment_id: string;
  name: string;
  session_id?: string;
  deployment_id?: string;
}

interface CloudEvent {
  id: string;
  type: string;
  processed_at?: string;
  content?: Array<{ type: string; text?: string }>;
  name?: string;
  input?: Record<string, unknown>;
  stop_reason?: { type?: string };
}

async function key(): Promise<string> {
  const k = (await readFile(KEY_FILE, "utf8").catch(() => "")).trim();
  if (!k) throw new Error("No hay llave de Anthropic para la nube en esta Mac.");
  return k;
}

async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API + path, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "content-type": "application/json",
      "x-api-key": await key(),
      "anthropic-version": "2026-10-21",
      "anthropic-beta": "managed-agents-2026-04-01",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(json?.error?.message ?? `${path} → ${res.status}`);
  return json as T;
}

export async function readRegistry(): Promise<CloudAgentEntry[]> {
  const raw = await readFile(REGISTRY, "utf8").catch(() => "");
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((a) => a?.id && a?.environment_id) : [];
  } catch {
    return [];
  }
}

async function writeRegistry(list: CloudAgentEntry[]): Promise<void> {
  await mkdir(DIR, { recursive: true });
  await writeFile(REGISTRY, JSON.stringify(list, null, 2));
}

async function entry(id: string): Promise<CloudAgentEntry> {
  const e = (await readRegistry()).find((a) => a.id === id);
  if (!e) throw new Error("Ese agente no está en tu equipo de la nube.");
  return e;
}

async function events(sessionId: string): Promise<CloudEvent[]> {
  const all: CloudEvent[] = [];
  let page: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await api<{ data?: CloudEvent[]; next_page?: string | null }>(
      `/sessions/${sessionId}/events${page ? `?page=${encodeURIComponent(page)}` : ""}`,
    );
    all.push(...(res.data ?? []));
    if (!res.next_page) break;
    page = res.next_page;
  }
  return all;
}

const text = (e: CloudEvent) =>
  (e.content ?? []).filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n").trim();

/** Un paso de trabajo en palabras: "curl -s https://…" en vez del JSON de la tool. */
function stepText(e: CloudEvent): string {
  const input = e.input ?? {};
  const target = String(input.command ?? input.file_path ?? input.path ?? input.url ?? input.query ?? input.pattern ?? "").trim();
  const name = e.name ?? "tool";
  const short = target.length > 90 ? `${target.slice(0, 90)}…` : target;
  return short ? `${name}: ${short}` : name;
}

export interface CloudChat {
  agent_id: string;
  session_id: string | null;
  status: "running" | "idle" | "terminated" | "none" | "rescheduling";
  messages: Array<{ id: string; role: "user" | "agent"; text: string; at: string | null }>;
  /** Pasos (tools) del turno en curso o del último. */
  steps: Array<{ id: string; text: string; at: string | null }>;
  cost_usd: number;
  url: string | null;
}

export async function cloudChat(agentId: string): Promise<CloudChat> {
  const e = await entry(agentId);
  if (!e.session_id) return { agent_id: agentId, session_id: null, status: "none", messages: [], steps: [], cost_usd: 0, url: null };
  const [session, evs] = await Promise.all([api(`/sessions/${e.session_id}`), events(e.session_id)]);
  const messages: CloudChat["messages"] = [];
  let steps: CloudChat["steps"] = [];
  for (const ev of evs) {
    if (ev.type === "user.message") {
      const t = text(ev);
      if (t) messages.push({ id: ev.id, role: "user", text: t, at: ev.processed_at ?? null });
      steps = []; // los pasos que se muestran son los del turno actual
    } else if (ev.type === "agent.message") {
      const t = text(ev);
      if (t) messages.push({ id: ev.id, role: "agent", text: t, at: ev.processed_at ?? null });
    } else if (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") {
      steps.push({ id: ev.id, text: stepText(ev), at: ev.processed_at ?? null });
    }
  }
  return {
    agent_id: agentId,
    session_id: e.session_id,
    status: (session?.status as CloudChat["status"]) ?? "idle",
    messages,
    steps,
    cost_usd: Number(session?.usage?.list_cost?.amount ?? 0) / 100,
    url: `https://platform.claude.com/workspaces/default/sessions/${e.session_id}`,
  };
}

/** Manda un mensaje: a la sesión viva del agente o, si no hay, abre una nueva. */
export async function cloudSend(agentId: string, message: string): Promise<{ session_id: string }> {
  const list = await readRegistry();
  const e = list.find((a) => a.id === agentId);
  if (!e) throw new Error("Ese agente no está en tu equipo de la nube.");
  const event = { type: "user.message", content: [{ type: "text", text: message }] };
  if (e.session_id) {
    const s = await api(`/sessions/${e.session_id}`).catch(() => null);
    if (s && s.status !== "terminated") {
      await api(`/sessions/${e.session_id}/events`, { body: { events: [event] } });
      return { session_id: e.session_id };
    }
  }
  const created = await api<{ id: string }>("/sessions", {
    body: {
      agent: e.id,
      environment_id: e.environment_id,
      title: `${e.name} · chat`,
      budget: { type: "limit", max_list_cost: { amount: CHAT_BUDGET_CENTS, currency: "USD" } },
      initial_events: [event],
    },
  });
  e.session_id = created.id;
  await writeRegistry(list);
  return { session_id: created.id };
}

/** Empezar de cero: la próxima vez se abre otra sesión (la vieja queda en la Console). */
export async function cloudNewChat(agentId: string): Promise<void> {
  const list = await readRegistry();
  const e = list.find((a) => a.id === agentId);
  if (!e) throw new Error("Ese agente no está en tu equipo de la nube.");
  delete e.session_id;
  await writeRegistry(list);
}

export interface CloudAgentSummary {
  id: string;
  name: string;
  description: string | null;
  model: string | null;
  status: CloudChat["status"];
  preview: string | null;
  updated_at: string | null;
  cost_usd: number;
  next_run_at: string | null;
}

let cache: { at: number; agents: CloudAgentSummary[] } | null = null;

/** Los agentes de la nube del equipo, con su último mensaje y su próximo turno (caché de 8 s). */
export async function listCloudAgents(): Promise<CloudAgentSummary[]> {
  if (cache && Date.now() - cache.at < 8_000) return cache.agents;
  const list = await readRegistry();
  const agents = await Promise.all(
    list.map(async (e): Promise<CloudAgentSummary> => {
      const [agent, chat, dep] = await Promise.all([
        api(`/agents/${e.id}`).catch(() => null),
        cloudChat(e.id).catch(() => null),
        e.deployment_id ? api(`/deployments/${e.deployment_id}`).catch(() => null) : Promise.resolve(null),
      ]);
      const last = chat?.messages.filter((m) => m.role === "agent").at(-1) ?? null;
      const lastAny = chat?.messages.at(-1) ?? null;
      return {
        id: e.id,
        name: e.name || agent?.name || "Agente",
        description: agent?.description ?? null,
        model: agent?.model?.id ?? null,
        status: chat?.status ?? "none",
        preview: last?.text.split("\n").find((l) => l.trim())?.slice(0, 160) ?? null,
        updated_at: lastAny?.at ?? null,
        cost_usd: chat?.cost_usd ?? 0,
        next_run_at: dep?.status === "active" ? (dep?.schedule?.upcoming_runs_at?.[0] ?? null) : null,
      };
    }),
  );
  cache = { at: Date.now(), agents };
  return agents;
}

export function invalidateCloudCache(): void {
  cache = null;
}
