"use client";

// Elenco de la Oficina: UNA llamada de ElevenLabs multi-voz donde cada
// personaje vivo presta una voz (packages/shared/src/office-voices.ts). Le
// hablas al equipo entero y el director enruta: "Iván, corre los tests; el de
// video-edit, resúmeme el diff". El trabajo lo hacen los runs reales (las
// client tools continúan su sesión) y el resultado vuelve con la voz de cada
// uno como un turno "[aviso]" cuando el run termina de verdad.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GENERAL_PROJECT,
  assignOfficeVoices,
  describeOfficeTeam,
  describeWorker,
  resolveOfficeTarget,
  type OfficeCastPublic,
  type OfficeProject,
  type OfficeWorker,
} from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";
import { CastCall } from "@/lib/sala/cast";

export type OfficeCastStatus = "unavailable" | "off" | "connecting" | "on" | "error";

interface Options {
  /** Personajes REALES (en simulación no hay llamada: los runs no existen). */
  workers: OfficeWorker[];
  projects: OfficeProject[];
  projectName: (slug: string) => string;
  owner: string;
  /** Continúa la sesión del personaje con `text`; devuelve el id del run/tarea nuevo. */
  instruct: (w: OfficeWorker, text: string) => Promise<string>;
  /** Contrata un agente nuevo en `project`; devuelve su id. */
  hire: (project: string, text: string) => Promise<string>;
}

/** Caracteres del resultado que viajan en un aviso. */
const RESULT_MAX = 1800;

/** Silencio real antes de meter un aviso (entre voces el modo parpadea). */
const QUIET_MS = 900;

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const running = (w: OfficeWorker) => w.status !== "done" && w.status !== "error";

export function useOfficeCast({ workers, projects, projectName, owner, instruct, hire }: Options) {
  const [cast, setCast] = useState<OfficeCastPublic | null>(null);
  const [status, setStatus] = useState<OfficeCastStatus>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const callRef = useRef<CastCall | null>(null);

  useEffect(() => {
    let alive = true;
    hermesGet<{ ok: boolean; error?: string } & Partial<OfficeCastPublic>>("/office/cast")
      .then((r) => {
        if (!alive) return;
        if (r.ok && r.lead && r.pool) {
          setCast({ ready: Boolean(r.ready), lead: r.lead, pool: r.pool });
          setStatus(r.ready ? "off" : "unavailable");
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Reparto voz ↔ personaje: pegajoso entre renders.
  const voicesRef = useRef<Map<string, string>>(new Map());
  const voices = useMemo(() => {
    const labels = cast?.pool.map((v) => v.label) ?? [];
    const next = assignOfficeVoices(voicesRef.current, workers, labels);
    voicesRef.current = next;
    return next;
  }, [workers, cast]);

  const voiceNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, label] of voices) {
      const v = cast?.pool.find((x) => x.label === label);
      if (v) out.set(id, v.name);
    }
    return out;
  }, [voices, cast]);

  // Lo último, para las tools (corren fuera del ciclo de React).
  const live = useRef({ workers, voices, projects, projectName, instruct, hire, cast });
  live.current = { workers, voices, projects, projectName, instruct, hire, cast };

  /** Runs que salieron de esta llamada: su resultado se cuenta con su voz. */
  const watchRef = useRef(new Set<string>());
  const announcedRef = useRef(new Set<string>());
  /** Instrucciones para agentes ocupados: se entregan al terminar. */
  const queuedRef = useRef(new Map<string, string[]>());
  const noticesRef = useRef<string[]>([]);

  const resolveProject = useCallback((q: string): string | null => {
    const n = norm(q);
    if (!n || n === "general" || n === "hermes general") return GENERAL_PROJECT;
    const ps = live.current.projects;
    return (
      ps.find((p) => norm(p.slug) === n || norm(p.name) === n)?.slug ??
      ps.find((p) => norm(p.slug).includes(n) || norm(p.name).includes(n) || n.includes(norm(p.slug)))?.slug ??
      null
    );
  }, []);

  const clientTools = useMemo(
    () => ({
      office_team: () => {
        const { workers, voices, cast, projectName } = live.current;
        return describeOfficeTeam(workers, voices, cast?.pool ?? [], projectName);
      },
      office_report: (p: Record<string, unknown>) => {
        const { workers, voices, cast, projectName } = live.current;
        const r = resolveOfficeTarget(String(p.who ?? ""), workers, voices, cast?.pool ?? [], projectName);
        if ("error" in r) return r.options.length ? `${r.error}:\n${r.options.join("\n")}` : r.error;
        const lines = r.worker.lines.slice(-8).join("\n");
        const text = r.worker.lastText ? `\nTexto final completo:\n${r.worker.lastText.slice(0, 4000)}` : "";
        return `${describeWorker(r.worker, voices, cast?.pool ?? [], projectName)}\nÚltimas líneas:\n${lines || "(todavía nada)"}${text}`;
      },
      office_tell: async (p: Record<string, unknown>) => {
        const { workers, voices, cast, projectName, instruct } = live.current;
        const text = String(p.instruction ?? "").trim();
        if (!text) return "¿Qué le digo?";
        const r = resolveOfficeTarget(String(p.who ?? ""), workers, voices, cast?.pool ?? [], projectName);
        if ("error" in r) return r.options.length ? `${r.error}:\n${r.options.join("\n")}` : r.error;
        const w = r.worker;
        if (running(w)) {
          const q = queuedRef.current.get(w.id) ?? [];
          queuedRef.current.set(w.id, [...q, text]);
          return `${describeWorker(w, voices, cast?.pool ?? [], projectName)}\nEstá trabajando: la instrucción queda en cola y se le pasa apenas termine.`;
        }
        try {
          const id = await instruct(w, text);
          if (id) watchRef.current.add(id);
          return `Enviado. Continúa su sesión en ${projectName(w.project)}; el resultado llega como [aviso] cuando termine.`;
        } catch (err) {
          return `No se pudo enviar: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
      office_hire: async (p: Record<string, unknown>) => {
        const text = String(p.instruction ?? "").trim();
        if (!text) return "¿Qué tarea le doy?";
        const slug = resolveProject(String(p.project ?? ""));
        if (!slug) {
          const names = live.current.projects.map((x) => x.name).slice(0, 8).join(", ");
          return `No encuentro el proyecto "${String(p.project ?? "")}". Los que hay: ${names}.`;
        }
        try {
          const id = await live.current.hire(slug, text);
          if (id) watchRef.current.add(id);
          return `Contratado en ${live.current.projectName(slug)}: aparece en su escritorio en unos segundos y recibe una voz libre si queda alguna.`;
        } catch (err) {
          return `No se pudo contratar: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
    [resolveProject],
  );

  // Cuando un run vigilado termina: aviso con su voz (y la cola sale al que quedó libre).
  const seenRef = useRef(new Set<string>());
  useEffect(() => {
    const call = callRef.current;
    const pool = cast?.pool ?? [];
    for (const w of workers) {
      const label = voices.get(w.id);
      const voice = pool.find((v) => v.label === label);
      // Llegada de un agente con voz durante la llamada: el modelo se entera sin turno.
      if (!seenRef.current.has(w.id)) {
        seenRef.current.add(w.id);
        if (call?.isConnected() && !w.continues) {
          call.context(
            `[equipo] Llegó un agente a ${projectName(w.project)}${voice ? ` con la voz ${voice.name} (<${voice.label}>)` : " sin voz libre"}. Tarea: ${w.task.name}.`,
          );
        }
      }
      if (running(w)) continue;
      const queued = queuedRef.current.get(w.id);
      if (queued?.length) {
        queuedRef.current.delete(w.id);
        void instruct(w, queued.join("\n\n"))
          .then((id) => {
            if (id) watchRef.current.add(id);
            call?.context(`[equipo] ${voice?.name ?? "El agente"} recibió la instrucción que estaba en cola.`);
          })
          .catch(() => undefined);
      }
      if (!watchRef.current.has(w.id) || announcedRef.current.has(w.id)) continue;
      announcedRef.current.add(w.id);
      const who = voice ? `${voice.name} (voz <${voice.label}>)` : `El agente de ${projectName(w.project)} (sin voz propia: cuéntalo con la voz <${cast?.lead.label}>)`;
      // Recortar a mitad de una tabla invita al modelo a completar de memoria (pasó:
      // atribuyó las líneas de un archivo a otro). Se manda más y se marca el corte.
      const full = (w.lastText ?? w.task.summary ?? "").replace(/\s+/g, " ").trim();
      const result = full.length > RESULT_MAX ? `${full.slice(0, RESULT_MAX)}… (recortado: no completes lo que falta; ofrece office_report)` : full;
      noticesRef.current.push(
        w.status === "done"
          ? `[aviso] ${who} terminó en ${projectName(w.project)}. Resultado: ${result || "sin texto final"}`
          : `[aviso] ${who} falló en ${projectName(w.project)}. Motivo: ${result || "sin detalle"}`,
      );
    }
  }, [workers, voices, cast, projectName, instruct]);

  // Los avisos salen de a uno y solo tras un silencio real (nunca pisan una voz).
  useEffect(() => {
    if (status !== "on") return;
    const id = setInterval(() => {
      const call = callRef.current;
      if (!call?.isConnected() || !noticesRef.current.length || call.quietFor() < QUIET_MS) return;
      const next = noticesRef.current.shift();
      if (next) call.notify(next);
    }, 300);
    return () => clearInterval(id);
  }, [status]);

  const connect = useCallback(async () => {
    if (!cast?.ready || callRef.current) return;
    setError(null);
    const labels: Record<string, string> = Object.fromEntries([cast.lead, ...cast.pool].map((v) => [v.key, v.label]));
    const call = new CastCall({
      fetchToken: async () => {
        const res = await fetch("/api/elevenlabs/token?agent=office");
        return (await res.json()) as { conversationToken?: string; signedUrl?: string; error?: string };
      },
      clientTools,
      labels,
      defaultKey: cast.lead.key,
      owner,
      onEvent: (ev) => {
        if (ev.kind === "status") {
          if (ev.status === "connected") setStatus("on");
          else if (ev.status === "connecting") setStatus("connecting");
          else if (ev.status === "error") setStatus("error");
          else if (ev.status === "disconnected") {
            callRef.current = null;
            setStatus("off");
          }
        } else if (ev.kind === "error" && ev.text) setError(ev.text);
      },
    });
    callRef.current = call;
    // Lo que ya estaba en la oficina no se anuncia como "llegó".
    for (const w of live.current.workers) seenRef.current.add(w.id);
    await call.connect(`${owner || "El dueño"} está en la Oficina de agentes 3D, caminando entre sus agentes con un control. Empieza llamando office_team.`);
    if (call.getStatus() !== "connected") {
      callRef.current = null;
      setStatus((s) => (s === "on" ? s : "error"));
    }
  }, [cast, clientTools, owner]);

  const hangup = useCallback(async () => {
    const call = callRef.current;
    callRef.current = null;
    noticesRef.current = [];
    if (call) await call.hangup();
    setStatus(cast?.ready ? "off" : "unavailable");
  }, [cast]);

  useEffect(
    () => () => {
      void callRef.current?.hangup();
    },
    [],
  );

  /** Id del personaje cuya voz suena AHORA (null = el líder o nadie). */
  const speakingWorker = useCallback((): { id: string; level: number } | null => {
    const call = callRef.current;
    const c = live.current.cast;
    if (!call || !c) return null;
    const key = call.speakingKey();
    const label = key ? [c.lead, ...c.pool].find((v) => v.key === key)?.label : undefined;
    if (!label || label === c.lead.label) return null;
    const id = [...live.current.voices].find(([, l]) => l === label)?.[0];
    return id ? { id, level: call.volume() } : null;
  }, []);

  return {
    /** Hay elenco y ya existe en ElevenLabs (si no, la oficina sigue con la llamada a Hermes). */
    available: Boolean(cast?.ready),
    status,
    error,
    lead: cast?.lead ?? null,
    voices,
    voiceNames,
    connect,
    hangup,
    speakingWorker,
    /** QA: texto como si lo dijera el dueño, sin micrófono. */
    say: (text: string) => callRef.current?.say(text) ?? false,
    debug: () => ({
      status,
      voices: Object.fromEntries(voices),
      watching: [...watchRef.current],
      queued: Object.fromEntries(queuedRef.current),
      notices: [...noticesRef.current],
      cast: callRef.current?.debug() ?? null,
    }),
  };
}
