"use client";

// Lo que /equipo sabe del agente. Puerto de `TeamRepo.kt` de Hermes Phone: todo
// sale de rutas reales — `/office/state` (sesiones vivas), `/office/approvals`
// (permisos pendientes), `/scheduled` (agentes que despiertan solos),
// `/machines` y `/cloud/agents` — con el MISMO ritmo que el teléfono:
// oficina + permisos cada 5 s, nube cada 15 s, tareas + máquinas cada minuto.
//
// Solo trabaja mientras la vista está a la vista (`active`: el AppShell deja
// todas las vistas montadas). Ahí abre `/office/events` para contar como
// observador de la Oficina: si nadie mira, el agente NIEGA solo los permisos;
// con la vista oculta no hay quién responda, así que el stream se cierra.

import { useCallback, useEffect, useRef, useState } from "react";
import { hermesFetch, sseUrl } from "@/lib/hermes";
import {
  build,
  cloudIssue,
  parseApprovals,
  parseCloudAgents,
  parseCloudChat,
  parseMachines,
  parseRuns,
  parseScheduled,
  parseWorkers,
  type Approval,
  type ChatLine,
  type CloudAgent,
  type Machine,
  type Member,
  type Run,
  type Scheduled,
  type Sources,
  type Worker,
} from "@/lib/team";

export interface TeamState {
  members: Member[];
  workers: Map<string, Worker>;
  tasks: Map<string, Scheduled>;
  cloud: Map<string, CloudAgent>;
  approvals: Approval[];
  machines: Machine[] | null;
  /** Cuándo se armó el equipo por última vez con datos de la Mac (0 = nunca). */
  fetchedAt: number;
  /** Ninguna ruta respondió: lo que se ve es lo último que llegó (o nada). */
  offline: boolean;
  /** Por qué faltan los agentes de la nube (la Mac contestó, `/cloud/agents` no). */
  cloudIssue: string | null;
}

const EMPTY: TeamState = {
  members: [],
  workers: new Map(),
  tasks: new Map(),
  cloud: new Map(),
  approvals: [],
  machines: null,
  fetchedAt: 0,
  offline: false,
  cloudIssue: null,
};

type Got = { ok: true; data: unknown } | { ok: false; status: number | null };

/** GET que nunca lanza: o el JSON, o el código (null = no contestó). */
async function getJson(path: string, timeoutMs = 12_000): Promise<Got> {
  try {
    const res = await hermesFetch(path, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: null };
  }
}

/** POST/PATCH de una acción del dueño. Devuelve el motivo si no se pudo (null = hecho). */
async function act(path: string, method: "POST" | "PATCH", body: unknown = {}): Promise<string | null> {
  try {
    const res = await hermesFetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
    if (!res.ok || json?.ok === false) return json?.error ?? json?.message ?? `No se pudo (${res.status}).`;
    return null;
  } catch {
    return "No alcanzo a tu Mac.";
  }
}

/**
 * El centro (la Mac mini) por su `/health`. Si la Mac que contesta es el centro,
 * listo; si no, se pregunta a las otras máquinas en línea por su URL LAN (fuera
 * de casa no contestan: entonces null y la etiqueta no adivina).
 */
async function findHub(machines: Machine[] | null): Promise<string | null> {
  const self = await getJson("/health", 4_000);
  const s = self.ok ? (self.data as { machine?: string; hub?: boolean }) : null;
  if (s?.hub && s.machine) return s.machine;
  for (const m of machines ?? []) {
    if (m.self || !m.online || !m.baseUrl) continue;
    try {
      const res = await fetch(`${m.baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(2_500) });
      const h = (await res.json()) as { machine?: string; hub?: boolean };
      if (h.hub) return h.machine ?? m.name;
    } catch {
      /* fuera de su red: no se sabe */
    }
  }
  return null;
}

export function useTeam(active: boolean) {
  const [state, setState] = useState<TeamState>(EMPTY);
  const last = useRef<Sources>({});
  const hub = useRef<string | null>(null);
  const busy = useRef(false);
  const again = useRef(false);

  const rebuild = useCallback((src: Sources, patch: Partial<TeamState> = {}) => {
    const members = build(src, { now: Date.now(), hub: hub.current });
    setState((prev) => ({
      ...prev,
      members,
      workers: new Map((src.workers ?? []).map((w) => [w.id, w])),
      tasks: new Map((src.scheduled ?? []).map((t) => [t.id, t])),
      cloud: new Map((src.cloud ?? []).map((a) => [a.id, a])),
      approvals: src.approvals ?? [],
      machines: src.machines ?? null,
      fetchedAt: Date.now(),
      offline: false,
      ...patch,
    }));
  }, []);

  /** `full` = también tareas y máquinas (cambian poco). La nube va aparte: cuesta llamadas a Anthropic. */
  const refresh = useCallback(
    async (full: boolean, withCloud: boolean) => {
      if (busy.current) {
        again.current = true;
        return;
      }
      busy.current = true;
      try {
        const [office, approvals, tasks, machines, cloud] = await Promise.all([
          getJson("/office/state"),
          getJson("/office/approvals"),
          full ? getJson("/scheduled") : null,
          full ? getJson("/machines") : null,
          withCloud ? getJson("/cloud/agents", 20_000) : null,
        ]);
        const prev = last.current;
        const ap = approvals.ok ? parseApprovals(approvals.data) : null;
        const src: Sources = {
          workers: office.ok ? parseWorkers(office.data) : null,
          approvals: ap?.approvals ?? null,
          watched: ap?.watched ?? false,
          scheduled: tasks ? (tasks.ok ? parseScheduled(tasks.data) : null) : prev.scheduled,
          machines: machines ? (machines.ok ? parseMachines(machines.data) : null) : prev.machines,
          cloud: cloud ? (cloud.ok ? parseCloudAgents(cloud.data) : null) : prev.cloud,
        };
        const reached = src.workers != null || src.approvals != null || src.scheduled != null || src.cloud != null;
        if (!reached) {
          setState((s) => ({ ...s, offline: true }));
          return;
        }
        last.current = src;
        if (full && machines?.ok) hub.current = await findHub(src.machines ?? null);
        // Sin consulta a la nube en este tick, el aviso anterior sigue valiendo.
        rebuild(src, cloud ? { cloudIssue: cloud.ok ? null : cloudIssue(cloud.status) } : {});
      } finally {
        busy.current = false;
        if (again.current) {
          again.current = false;
          void refresh(false, false);
        }
      }
    },
    [rebuild],
  );

  // Sondeo: cada 5 s la oficina y los permisos; la nube cada 3 vueltas (15 s);
  // tareas y máquinas cada 12 (1 min). Al volver a la vista, todo de una.
  useEffect(() => {
    if (!active) return;
    let tick = 0;
    const run = () => {
      void refresh(tick % 12 === 0, tick % 3 === 0);
      tick++;
    };
    run();
    const id = window.setInterval(run, 5_000);
    return () => window.clearInterval(id);
  }, [active, refresh]);

  // Observador de la Oficina: mientras se ve, el agente espera tus permisos.
  // Un cambio (worker nuevo, permiso pedido, alguien que sale) refresca ya.
  useEffect(() => {
    if (!active) return;
    const es = new EventSource(sseUrl("/office/events"));
    let timer: number | null = null;
    es.onmessage = (e) => {
      let type: string | undefined;
      try {
        type = (JSON.parse(e.data) as { type?: string }).type;
      } catch {
        return;
      }
      if (type !== "worker" && type !== "removed") return;
      // Un run emite un evento por tool: se junta en un refresco cada 1,5 s.
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void refresh(false, false);
      }, 1_500);
    };
    return () => {
      if (timer != null) window.clearTimeout(timer);
      es.close();
    };
  }, [active, refresh]);

  // ── Acciones (las dispara un clic explícito del dueño) ────────────────

  const decide = useCallback(
    async (approvalId: string, allow: boolean, note?: string) => {
      const n = note?.trim();
      const err = await act(`/office/approvals/${encodeURIComponent(approvalId)}/decide`, "POST", {
        allow,
        ...(n ? { note: n } : {}),
      });
      void refresh(false, false);
      return err;
    },
    [refresh],
  );

  const runNow = useCallback(
    async (taskId: string) => {
      const err = await act(`/scheduled/${encodeURIComponent(taskId)}/run`, "POST");
      void refresh(true, false);
      return err;
    },
    [refresh],
  );

  const setEnabled = useCallback(
    async (taskId: string, enabled: boolean) => {
      const err = await act(`/scheduled/${encodeURIComponent(taskId)}`, "PATCH", { enabled });
      void refresh(true, false);
      return err;
    },
    [refresh],
  );

  return { state, decide, runNow, setEnabled };
}

/** Las corridas de una tarea programada (null = cargando o no contestó). */
export async function fetchRuns(taskId: string): Promise<Run[] | null> {
  const r = await getJson(`/scheduled/${encodeURIComponent(taskId)}/runs`);
  return r.ok ? parseRuns(r.data) : null;
}

export interface CloudChatState {
  messages: ChatLine[];
  working: boolean;
  /** Lo que hace en este turno, en palabras ("bash: curl …"). */
  steps: string[];
  costUsd: number | null;
  error: string | null;
  loading: boolean;
}

/**
 * La conversación con UN agente de la nube (puerto de `TeamChatRepo.kt`): la
 * conversación ES la sesión de Managed Agents y se lee por la Mac, que tiene la
 * llave. Vigila cada 2 s mientras trabaja y cada 10 s si no.
 */
export function useCloudChat(cloudId: string | null, active: boolean) {
  const [st, setSt] = useState<CloudChatState>({
    messages: [],
    working: false,
    steps: [],
    costUsd: null,
    error: null,
    loading: true,
  });
  // Tras mandar, el vigía arranca de nuevo (a 2 s si quedó trabajando).
  const [kick, setKick] = useState(0);

  const load = useCallback(async (id: string): Promise<boolean> => {
    const r = await getJson(`/cloud/agents/${encodeURIComponent(id)}/chat`, 20_000);
    if (!r.ok) {
      setSt((s) => ({
        ...s,
        loading: false,
        error: r.status == null ? "No alcanzo a tu Mac." : `No pude leer la conversación (${r.status}).`,
      }));
      return false;
    }
    const chat = parseCloudChat(r.data);
    const running = chat.status === "running" || chat.status === "rescheduling";
    setSt({
      messages: chat.messages,
      steps: running ? chat.steps : [],
      working: running,
      costUsd: chat.costUsd,
      loading: false,
      error: null,
    });
    return running;
  }, []);

  useEffect(() => {
    setSt({ messages: [], working: false, steps: [], costUsd: null, error: null, loading: true });
  }, [cloudId]);

  useEffect(() => {
    if (!cloudId || !active) return;
    let stop = false;
    let timer: number | null = null;
    const loop = async () => {
      const running = await load(cloudId);
      if (!stop) timer = window.setTimeout(loop, running ? 2_000 : 10_000);
    };
    void loop();
    return () => {
      stop = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [cloudId, active, load, kick]);

  const send = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!cloudId || !t) return;
      const mine: ChatLine = { id: `me-${Date.now()}`, fromAgent: false, text: t, at: Date.now() };
      setSt((s) => ({ ...s, messages: [...s.messages, mine], working: true, steps: [], error: null }));
      const err = await act(`/cloud/agents/${encodeURIComponent(cloudId)}/chat`, "POST", { text: t });
      if (err) setSt((s) => ({ ...s, working: false, error: err }));
      else setKick((k) => k + 1);
    },
    [cloudId],
  );

  const newChat = useCallback(async () => {
    if (!cloudId) return;
    const err = await act(`/cloud/agents/${encodeURIComponent(cloudId)}/chat/new`, "POST");
    if (err) setSt((s) => ({ ...s, error: err }));
    else setSt((s) => ({ ...s, messages: [], steps: [], working: false, error: null }));
  }, [cloudId]);

  return { ...st, send, newChat };
}
