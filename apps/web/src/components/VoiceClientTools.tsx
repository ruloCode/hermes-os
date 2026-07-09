"use client";

import { useConversationClientTool } from "@elevenlabs/react";
import type { ProjectStatus } from "@hermes/shared";
import { hermesGet, hermesPost } from "@/lib/hermes";
import { useVoice } from "./VoiceBusyContext";

/**
 * Registra TODAS las client tools de la voz con el ConversationProvider.
 * ElevenLabs las invoca EN EL BROWSER, así que pueden llamar a localhost:8642
 * directo (sin túnel) y —lo nuevo— manejar la interfaz del dashboard.
 *
 * Se usa `useConversationClientTool` (una llamada por tool) en vez del prop
 * `clientTools` del provider porque su handler siempre refleja el closure más
 * reciente (ref pattern del SDK): los callbacks de UI (onFocusProject, …)
 * pueden cambiar entre renders sin registrar tools obsoletas.
 *
 * No renderiza nada: es solo el punto de registro.
 */

type Panel = "consola" | "actividad" | "claude" | "reuniones" | "voz";

interface Props {
  /** Proyectos conocidos: para resolver el slug que dice la voz. */
  projects: ProjectStatus[];
  /** Enfoca (o limpia con null) un proyecto en el dashboard. */
  onFocusProject: (slug: string | null) => void;
  /** Cambia el panel central. */
  onShowPanel: (panel: Panel) => void;
  /** Lanza a Claude Code en el repo de un proyecto y abre su stream en vivo. */
  onWork: (opts: { project: string; prompt: string }) => Promise<{ runId: string } | null>;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

export function VoiceClientTools({ projects, onFocusProject, onShowPanel, onWork }: Props) {
  const { setAction, startArtifact } = useVoice();

  // Resuelve lo que dice la voz ("careways", "el de salud") a un slug real.
  const resolveSlug = (raw?: string): string | null => {
    const q = str(raw)?.toLowerCase();
    if (!q) return null;
    const match =
      projects.find((p) => p.slug.toLowerCase() === q) ??
      projects.find((p) => p.name.toLowerCase() === q) ??
      projects.find((p) => p.name.toLowerCase().includes(q) || q.includes(p.slug.toLowerCase()));
    return match?.slug ?? null;
  };

  // ── Tools de interfaz (efecto "Iron Man") ────────────────────────────
  useConversationClientTool("focus_project", async (p) => {
    const raw = str(p.project);
    if (!raw) {
      onFocusProject(null);
      return "Listo, quité el foco y volví a la vista general.";
    }
    const slug = resolveSlug(raw);
    if (!slug) return `No tengo un proyecto que coincida con "${raw}".`;
    setAction(`Enfocando ${slug}`);
    onFocusProject(slug);
    setTimeout(() => setAction(null), 1400);
    return `Enfocando ${slug} en el dashboard.`;
  });

  useConversationClientTool("show_panel", async (p) => {
    const raw = (str(p.panel) ?? "").toLowerCase();
    const panel: Panel | null = raw.includes("voz") || raw.includes("preview") || raw.includes("report")
      ? "voz"
      : raw.includes("reuni") || raw.includes("junta") || raw.includes("meeting")
        ? "reuniones"
        : raw.includes("activ") || raw.includes("feed")
          ? "actividad"
          : raw.includes("claude") || raw.includes("cod") || raw.includes("term")
            ? "claude"
            : raw.includes("consol") || raw.includes("chat")
              ? "consola"
              : null;
    if (!panel) return `No conozco el panel "${raw}".`;
    onShowPanel(panel);
    return `Mostrando ${panel}.`;
  });

  useConversationClientTool("work_on_project", async (p) => {
    const slug = resolveSlug(str(p.project));
    if (!slug) return `¿En qué proyecto trabajo? No reconocí "${str(p.project) ?? ""}".`;
    const prompt = str(p.prompt);
    if (!prompt) return "¿Qué quieres que haga Claude en el repo?";
    setAction(`Claude · ${slug}`);
    try {
      const res = await onWork({ project: slug, prompt });
      if (!res) {
        setAction(null);
        return "No pude lanzar a Claude: el agente local no responde.";
      }
      return `Va, Claude ya está trabajando en ${slug}, lo puedes ver en el terminal. Te aviso cuando termine. El run es ${res.runId}.`;
    } catch {
      setAction(null);
      return "No pude lanzar a Claude en el repo.";
    }
  });

  // ── Tools del agente local (:8642) ───────────────────────────────────
  useConversationClientTool("run_task", async (p) => {
    const prompt = str(p.prompt);
    if (!prompt) return "¿Qué tarea quieres que haga?";
    try {
      const res = await hermesPost<{ task_id: string }>("/tasks", { prompt });
      // Abre el modo Voz y arranca el preview: cuando la tarea termine, su
      // resultado (reporte, resumen, lo que sea) se renderiza en el centro.
      startArtifact({ title: prompt, taskId: res.task_id });
      onShowPanel("voz");
      return `Va, lo estoy preparando. Aquí en pantalla vas a ver el resultado en cuanto esté; te aviso al terminar.`;
    } catch {
      return "No alcanzo al agente local ahora mismo.";
    }
  });

  useConversationClientTool("check_task", async (p) => {
    const id = str(p.task_id);
    if (!id) return "¿De qué tarea? Necesito el identificador.";
    // 1) tarea del SDK (run_task)
    try {
      const t = await hermesGet<{ status: string; result?: string; toolCalls: number }>(
        `/tasks/${encodeURIComponent(id)}`,
      );
      if (t.status === "running")
        return `Sigue en curso, ${t.toolCalls} acciones ejecutadas hasta ahora.`;
      if (t.status === "error") return `Falló: ${t.result?.slice(0, 220) ?? "sin detalle"}.`;
      return `Terminó. ${t.result?.slice(0, 320) ?? "Sin detalle."}`;
    } catch {
      /* no es tarea SDK: probamos con los runs de Claude Code */
    }
    // 2) run de Claude Code (work_on_project)
    try {
      const runs = await hermesGet<
        Array<{ id: string; status: string; lastText?: string; projectSlug: string }>
      >("/claude/runs");
      const run = runs.find((r) => r.id === id);
      if (!run) return `No encontré nada con el id ${id}.`;
      if (run.status === "running") return `Claude sigue trabajando en ${run.projectSlug}.`;
      if (run.status === "error") return `El run en ${run.projectSlug} falló.`;
      return `Terminó en ${run.projectSlug}. ${run.lastText ?? ""}`.trim();
    } catch {
      return `No pude consultar el id ${id}.`;
    }
  });

  useConversationClientTool("get_project_status", async (p) => {
    try {
      const data = await hermesPost<unknown[]>("/tools/get_project_status", {
        project: str(p.project),
      });
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude leer el estado de los proyectos.";
    }
  });

  useConversationClientTool("search_memory", async (p) => {
    try {
      const data = await hermesPost<unknown[]>("/tools/search_memory", { query: str(p.query) });
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude buscar en la memoria.";
    }
  });

  useConversationClientTool("save_memory", async (p) => {
    const content = str(p.content);
    if (!content) return "¿Qué quieres que recuerde?";
    try {
      await hermesPost("/tools/save_memory", { content, type: str(p.type) });
      return "Memoria guardada.";
    } catch {
      return "No pude guardar la memoria.";
    }
  });

  useConversationClientTool("get_daily_brief", async () => {
    try {
      const data = await hermesPost<{ brief: string }>("/tools/get_daily_brief", {});
      return data.brief;
    } catch {
      return "No pude armar el resumen del día.";
    }
  });

  return null;
}
