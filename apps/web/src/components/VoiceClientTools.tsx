"use client";

import { useConversationClientTool } from "@elevenlabs/react";
import { useRouter } from "next/navigation";
import type { ProjectStatus } from "@hermes/shared";
import { hermesGet, hermesPost } from "@/lib/hermes";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
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

type Panel = "consola" | "actividad" | "claude" | "reuniones" | "voz" | "tareas" | "memoria";

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
  const { switchToTutor } = useVoiceConnect();
  const router = useRouter();

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
        : raw.includes("tarea") || raw.includes("tablero") || raw.includes("misi") || raw.includes("kanban")
          ? "tareas"
          : raw.includes("memoria") || raw.includes("conocimiento") || raw.includes("knowledge")
            ? "memoria"
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

  useConversationClientTool("start_english_practice", async () => {
    // El handler corta la sesión que lo invocó: el delay deja que el TTS de
    // Hermes alcance a despedirse antes del switch (heurístico; el camino
    // primario al tutor es ⌘K "Practicar inglés").
    setAction("Cambiando al tutor de inglés");
    setTimeout(() => {
      setAction(null);
      // La práctica vive en /ingles (transcripción en tiempo real).
      router.push("/ingles");
      void switchToTutor();
    }, 2500);
    return "Va, te paso con el tutor de inglés.";
  });

  useConversationClientTool("show_project_status", async (p) => {
    // Enfoca el proyecto: la columna derecha muestra la card "Estado del
    // proyecto" (progreso del tracker + git + prioridades, todo real).
    const slug = resolveSlug(str(p.project));
    if (!slug) return `¿De qué proyecto? No reconocí "${str(p.project) ?? ""}".`;
    setAction(`Estado · ${slug}`);
    onFocusProject(slug);
    setTimeout(() => setAction(null), 1400);
    return `Listo, el estado de ${slug} está en pantalla: progreso de tareas, git y prioridades.`;
  });

  // ── Deixis del control por gestos: "esto"/"esta ventana" resolubles ───
  useConversationClientTool("get_pointer_context", async () => {
    try {
      const ctx = await hermesGet<{
        cursor: { x: number; y: number };
        display: { id: number; main: boolean } | null;
        window: { app: string; title: string } | null;
      }>("/input/pointer");
      if (!ctx.window) {
        return `El cursor está en (${ctx.cursor.x}, ${ctx.cursor.y})${
          ctx.display ? ` del display ${ctx.display.main ? "principal" : ctx.display.id}` : ""
        }, sin ventana identificable debajo.`;
      }
      return `Bajo el cursor está ${ctx.window.app}${
        ctx.window.title ? ` ("${ctx.window.title}")` : ""
      }, en el display ${ctx.display?.main ? "principal" : (ctx.display?.id ?? "?")}.`;
    } catch {
      return "No pude leer el cursor (¿el agente está corriendo?).";
    }
  });

  useConversationClientTool("move_window_next_display", async () => {
    setAction("Moviendo ventana");
    try {
      const res = await hermesPost<{ app: string; display: number }>(
        "/input/windows/teleport",
        {},
      );
      setTimeout(() => setAction(null), 1400);
      return `Listo, la ventana de ${res.app} pasó al display ${res.display}.`;
    } catch {
      setAction(null);
      return "No pude mover la ventana — ¿hay una ventana bajo el cursor y un segundo monitor?";
    }
  });

  // ── Navegador por voz (el Chrome real de la Mac, vía el agente) ──────
  useConversationClientTool("open_in_browser", async (p) => {
    const target = str(p.target);
    if (!target) return "¿Qué sitio abro?";
    setAction(`Abriendo ${target}`);
    try {
      const res = await hermesPost<{ ok: boolean; label?: string; error?: string }>(
        "/browser/open",
        { target },
      );
      setTimeout(() => setAction(null), 1400);
      if (!res.ok) return res.error ?? "No pude abrir el navegador.";
      return `Listo, ${res.label} está abierto en Chrome.`;
    } catch {
      setAction(null);
      return "No alcanzo al agente local para abrir el navegador.";
    }
  });

  useConversationClientTool("list_browser_tabs", async () => {
    try {
      const res = await hermesGet<{
        ok: boolean;
        tabs?: { title: string; active: boolean }[];
        error?: string;
      }>("/browser/tabs");
      if (!res.ok) return res.error ?? "No pude leer las pestañas.";
      if (!res.tabs?.length) return "No hay pestañas abiertas en Chrome.";
      const names = res.tabs.slice(0, 15).map((t) => (t.active ? `[activa] ${t.title}` : t.title));
      return `Pestañas abiertas: ${names.join(" · ")}`;
    } catch {
      return "No alcanzo al agente local para leer las pestañas.";
    }
  });

  useConversationClientTool("switch_browser_tab", async (p) => {
    const query = str(p.query);
    if (!query) return "¿A qué pestaña me paso?";
    setAction(`Pestaña · ${query}`);
    try {
      const res = await hermesPost<{ ok: boolean; title?: string; error?: string }>(
        "/browser/tab",
        { query },
      );
      setTimeout(() => setAction(null), 1400);
      if (!res.ok) return res.error ?? "No pude cambiar de pestaña.";
      return `Listo, estás en "${res.title}".`;
    } catch {
      setAction(null);
      return "No alcanzo al agente local para cambiar de pestaña.";
    }
  });

  useConversationClientTool("control_browser", async (p) => {
    const command = str(p.command);
    if (!command) return "¿Qué hago en el navegador?";
    setAction("Navegador");
    try {
      const res = await hermesPost<{ ok: boolean; error?: string }>("/browser/command", {
        command,
      });
      setTimeout(() => setAction(null), 1200);
      if (!res.ok) return res.error ?? "No pude ejecutar eso en el navegador.";
      return "Hecho.";
    } catch {
      setAction(null);
      return "No alcanzo al agente local para controlar el navegador.";
    }
  });

  useConversationClientTool("browse_web", async (p) => {
    const instruction = str(p.instruction);
    if (!instruction) return "¿Qué hago en el navegador?";
    setAction("Navegando por ti");
    try {
      const res = await hermesPost<{ ok: boolean; task_id?: string; error?: string }>(
        "/browser/navigate",
        { instruction },
      );
      setTimeout(() => setAction(null), 1800);
      if (!res.ok) return res.error ?? "No pude arrancar la navegación.";
      return `Va, ya estoy navegando en el Chrome de Hermes — lo ves en pantalla. La tarea es ${res.task_id}; usa check_task para reportar el resultado.`;
    } catch {
      setAction(null);
      return "No alcanzo al agente local para navegar.";
    }
  });

  // ── Luces del cuarto (tira Kasa vía el agente, ~1 s) ─────────────────
  useConversationClientTool("control_lights", async (p) => {
    const action = str(p.action);
    if (!action) return "¿Qué hago con las luces?";
    const value = typeof p.value === "number" ? String(p.value) : str(p.value);
    setAction("Luces");
    try {
      const res = await hermesPost<{ ok: boolean; detail?: string; error?: string }>(
        "/lights/command",
        { action, value },
      );
      setTimeout(() => setAction(null), 1200);
      if (!res.ok) return res.error ?? "No pude controlar las luces.";
      return `Listo: ${res.detail ?? "hecho"}.`;
    } catch {
      setAction(null);
      return "No alcanzo al agente local para controlar las luces.";
    }
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

  // ── Finanzas personales (asesor financiero por voz) ──────────────────
  useConversationClientTool("log_transaction", async (p) => {
    const amount = typeof p.amount === "number" ? p.amount : Number(p.amount);
    if (!amount || amount <= 0) return "¿De cuánto fue el movimiento?";
    try {
      const res = await hermesPost<{
        ok: boolean;
        deduped?: boolean;
        confirmation?: string;
        error?: string;
      }>("/tools/log_transaction", {
        kind: str(p.kind) ?? "expense",
        amount,
        currency: str(p.currency),
        category: str(p.category),
        account: str(p.account),
        note: str(p.note),
        occurred_on: str(p.date),
        allow_duplicate: p.allow_duplicate === true,
      });
      if (!res.ok) return res.error ?? "No pude registrar el movimiento.";
      if (res.deduped)
        return `Ojo: ya tenía ese registro hoy, no lo dupliqué. Si es un movimiento distinto, dime "regístralo de todos modos".`;
      return res.confirmation ?? "Registrado.";
    } catch {
      return "No alcanzo al agente local para registrar el movimiento.";
    }
  });

  useConversationClientTool("correct_last_transaction", async (p) => {
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/correct_last_transaction",
        {
          amount: typeof p.amount === "number" ? p.amount : undefined,
          currency: str(p.currency),
          category: str(p.category),
          void: p.void === true,
        },
      );
      return res.ok ? (res.confirmation ?? "Corregida.") : (res.error ?? "No pude corregirla.");
    } catch {
      return "No alcanzo al agente local para corregir.";
    }
  });

  useConversationClientTool("get_finance_summary", async (p) => {
    try {
      const res = await hermesPost<{ text: string }>("/tools/get_finance_summary", {
        month: str(p.month),
        currency: str(p.currency),
      });
      return res.text;
    } catch {
      return "No pude consultar las finanzas.";
    }
  });

  useConversationClientTool("get_balance", async () => {
    try {
      const res = await hermesPost<{ text: string }>("/tools/get_balance", {});
      return res.text;
    } catch {
      return "No pude consultar el saldo.";
    }
  });

  useConversationClientTool("set_wallet_balance", async (p) => {
    const wallet = str(p.wallet);
    const balance = typeof p.balance === "number" ? p.balance : Number(p.balance);
    if (!wallet || !Number.isFinite(balance)) return "¿Qué billetera y qué saldo fijo?";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/set_wallet_balance",
        { wallet, balance, currency: str(p.currency) },
      );
      return res.ok ? (res.confirmation ?? "Saldo fijado.") : (res.error ?? "No pude fijarlo.");
    } catch {
      return "No alcanzo al agente local para fijar el saldo.";
    }
  });

  // ── Hábitos y metas (coach por voz) ──────────────────────────────────
  useConversationClientTool("log_habit", async (p) => {
    const habit = str(p.habit);
    if (!habit) return "¿Qué hábito marco?";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/log_habit",
        { habit, note: str(p.note) },
      );
      return res.ok ? (res.confirmation ?? "Marcado.") : (res.error ?? "No pude marcarlo.");
    } catch {
      return "No alcanzo al agente local para marcar el hábito.";
    }
  });

  useConversationClientTool("get_habits_today", async () => {
    try {
      const data = await hermesPost<unknown>("/tools/get_habits_today", {});
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude consultar los hábitos.";
    }
  });

  useConversationClientTool("update_goal", async (p) => {
    const goal = str(p.goal);
    if (!goal) return "¿Qué meta actualizo?";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/update_goal",
        {
          goal,
          progress: typeof p.progress === "number" ? p.progress : undefined,
          delta: typeof p.delta === "number" ? p.delta : undefined,
          milestone: str(p.milestone),
        },
      );
      return res.ok ? (res.confirmation ?? "Actualizada.") : (res.error ?? "No pude actualizarla.");
    } catch {
      return "No alcanzo al agente local para actualizar la meta.";
    }
  });

  // ── Google Calendar: crear / mover / borrar por voz ──────────────────
  const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

  useConversationClientTool("create_event", async (p) => {
    const title = str(p.title);
    const start = str(p.start);
    if (!title || !start) return "¿Qué evento creo y para cuándo?";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/create_event",
        {
          title,
          start,
          end: str(p.end),
          duration_min: num(p.duration_min),
          all_day: p.all_day === true,
          description: str(p.description),
          location: str(p.location),
        },
      );
      return res.ok ? (res.confirmation ?? "Evento creado.") : (res.error ?? "No pude crearlo.");
    } catch {
      return "No alcanzo al agente local para crear el evento.";
    }
  });

  useConversationClientTool("find_events", async (p) => {
    try {
      const res = await hermesPost<{ ok: boolean; events?: unknown[]; error?: string }>(
        "/tools/find_events",
        { query: str(p.query), days_ahead: num(p.days_ahead) },
      );
      if (!res.ok) return res.error ?? "No pude buscar en el calendario.";
      if (!res.events?.length) return "No encontré eventos que coincidan.";
      return JSON.stringify(res.events).slice(0, 1500);
    } catch {
      return "No alcanzo al agente local para buscar en el calendario.";
    }
  });

  useConversationClientTool("update_event", async (p) => {
    const eventId = str(p.event_id);
    if (!eventId) return "Primero busco el evento con find_events para tener su id.";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/update_event",
        {
          event_id: eventId,
          title: str(p.title),
          start: str(p.start),
          end: str(p.end),
          duration_min: num(p.duration_min),
          all_day: p.all_day === true ? true : undefined,
          description: str(p.description),
          location: str(p.location),
        },
      );
      return res.ok ? (res.confirmation ?? "Evento actualizado.") : (res.error ?? "No pude modificarlo.");
    } catch {
      return "No alcanzo al agente local para modificar el evento.";
    }
  });

  useConversationClientTool("cancel_event", async (p) => {
    const eventId = str(p.event_id);
    if (!eventId) return "Primero busco el evento con find_events para tener su id.";
    try {
      const res = await hermesPost<{ ok: boolean; confirmation?: string; error?: string }>(
        "/tools/cancel_event",
        { event_id: eventId, title: str(p.title) },
      );
      return res.ok ? (res.confirmation ?? "Evento cancelado.") : (res.error ?? "No pude cancelarlo.");
    } catch {
      return "No alcanzo al agente local para cancelar el evento.";
    }
  });

  return null;
}
