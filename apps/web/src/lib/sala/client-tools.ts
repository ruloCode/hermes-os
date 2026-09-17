// Client tools de la Sala: las sesiones de @elevenlabs/client reciben un mapa
// plano (no los hooks del ConversationProvider). Mismos cuerpos que las tools
// equivalentes de VoiceClientTools — llaman al agente local en :8650 — en la
// versión mínima que un personaje de la sala necesita para no inventar.

import { hermesGet, hermesPost } from "@/lib/hermes";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

export function salaClientTools(): Record<string, (p: Record<string, unknown>) => Promise<string> | string> {
  return {
    get_project_status: async (p) => {
      try {
        const data = await hermesPost<unknown[]>("/tools/get_project_status", { project: str(p.project) });
        return JSON.stringify(data).slice(0, 1500);
      } catch {
        return "No pude leer el estado de los proyectos.";
      }
    },
    search_memory: async (p) => {
      try {
        const data = await hermesPost<unknown[]>("/tools/search_memory", { query: str(p.query) });
        return JSON.stringify(data).slice(0, 1500);
      } catch {
        return "No pude buscar en la memoria.";
      }
    },
    run_task: async (p) => {
      const prompt = str(p.prompt);
      if (!prompt) return "¿Qué tarea quieres que haga?";
      try {
        const res = await hermesPost<{ task_id: string }>("/tasks", { prompt });
        return `Va, arrancó en segundo plano (id ${res.task_id}). Pregúntame en un rato con check_task.`;
      } catch {
        return "No alcanzo al agente local ahora mismo.";
      }
    },
    check_task: async (p) => {
      const id = str(p.task_id);
      if (!id) return "¿De qué tarea? Necesito el identificador.";
      try {
        const t = await hermesGet<{ status: string; result?: string; toolCalls: number }>(`/tasks/${encodeURIComponent(id)}`);
        if (t.status === "running") return `Sigue en curso, ${t.toolCalls} acciones ejecutadas hasta ahora.`;
        if (t.status === "error") return `Falló: ${t.result?.slice(0, 220) ?? "sin detalle"}.`;
        return `Terminó. ${t.result?.slice(0, 320) ?? "Sin detalle."}`;
      } catch {
        return `No pude consultar el id ${id}.`;
      }
    },
    // Tools de interfaz que el agente Hermes tiene declaradas: en la sala no
    // hay dashboard que mover; se responde algo útil en vez de fallar.
    focus_project: () => "En la sala no hay tablero que enfocar; sigue hablando.",
    show_panel: () => "En la sala no hay paneles; te lo cuento hablado.",
    show_project_status: async (p) => {
      try {
        const data = await hermesPost<unknown[]>("/tools/get_project_status", { project: str(p.project) });
        return JSON.stringify(data).slice(0, 1200);
      } catch {
        return "No pude leer el estado.";
      }
    },
    get_daily_brief: async () => {
      try {
        const data = await hermesPost<unknown>("/tools/get_daily_brief", {});
        return JSON.stringify(data).slice(0, 1500);
      } catch {
        return "No pude armar el resumen del día.";
      }
    },
    // Tutor de inglés: sus tools de práctica guardan sesión/vocabulario; en la
    // sala la práctica no se registra.
    save_vocab: () => "Noted. In the room we don't save vocabulary; keep talking.",
    recall_vocab: () => "No saved vocabulary in the room session.",
    end_practice_session: () => "This room chat isn't a tracked practice session.",
    start_english_practice: () => "Teacher ya está en la sala: levanta la mano hacia él.",
  };
}
