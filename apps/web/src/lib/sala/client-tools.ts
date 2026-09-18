// Client tools de la Sala: las sesiones de @elevenlabs/client reciben un mapa
// plano (no los hooks del ConversationProvider). Mismos cuerpos que las tools
// equivalentes de VoiceClientTools — llaman al agente local en :8650 — en la
// versión mínima que un personaje de la sala necesita para no inventar.

import { hermesGet, hermesPost } from "@/lib/hermes";
import { emitUiEvent, type UiNotice, type UiPlace, type UiRoutePlan } from "./ui-bus";

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

interface RouteAnswer {
  ok: boolean;
  error?: string;
  suggestions?: string[];
  plan?: UiRoutePlan;
  notices?: UiNotice[];
  next?: { line: string; headsign: string; inMinutes: number[] }[];
  scheduleStale?: boolean;
  say?: string;
}

/**
 * Tools del TÓTEM DE ESTACIÓN. Cada una devuelve TEXTO para la voz y además
 * emite el payload estructurado al bus de UI: la tarjeta de la ruta se pinta
 * con los datos del agente, no con lo que el modelo alcance a decir.
 * Sin GTFS o sin archivos de config, la tool dice el motivo y la pantalla no
 * pinta nada — nunca una ruta inventada.
 */
export function estacionClientTools(): Record<string, (p: Record<string, unknown>) => Promise<string>> {
  return {
    metro_route: async (p) => {
      const from = str(p.from) ?? str(p.origen) ?? "";
      const to = str(p.to) ?? str(p.destino) ?? "";
      if (!to) return "¿A dónde quieres ir?";
      try {
        const r = await hermesPost<RouteAnswer>("/metro/route", { from, to });
        if (!r.ok || !r.plan) {
          emitUiEvent({ kind: "route_failed", query: to, error: r.error ?? "sin ruta", suggestions: r.suggestions ?? [] });
          const near = r.suggestions?.length ? ` ¿Te sirve alguna de estas: ${r.suggestions.slice(0, 3).join(", ")}?` : "";
          return `${r.error ?? "No pude armar la ruta"}.${near}`;
        }
        emitUiEvent({
          kind: "route",
          plan: r.plan,
          notices: r.notices ?? [],
          next: r.next ?? [],
          scheduleStale: Boolean(r.scheduleStale),
        });
        const avisos = (r.notices ?? []).map((n) => `Aviso — ${n.line ? `Línea ${n.line}: ` : ""}${n.text}`).join(" ");
        return [avisos, r.say ?? ""].filter(Boolean).join(" ");
      } catch {
        return "No alcanzo los datos del sistema ahora mismo.";
      }
    },
    metro_status: async () => {
      try {
        const r = await hermesGet<{ ok: boolean; notices?: UiNotice[]; error?: string }>("/metro/status");
        if (!r.ok) return r.error ?? "No pude leer el estado del servicio.";
        const notices = r.notices ?? [];
        emitUiEvent({ kind: "status", notices });
        if (!notices.length) return "No hay novedades reportadas del servicio.";
        return notices.map((n) => `${n.line ? `Línea ${n.line}: ` : ""}${n.text}${n.delayMin ? ` (unos ${n.delayMin} minutos)` : ""}`).join(" ");
      } catch {
        return "No alcanzo el estado del servicio ahora mismo.";
      }
    },
    places_near: async (p) => {
      const station = str(p.station) ?? str(p.estacion) ?? "";
      if (!station) return "¿Cerca de qué estación?";
      try {
        const r = await hermesGet<{ ok: boolean; station?: string; places?: UiPlace[]; available?: string[]; configured?: boolean; error?: string }>(
          `/metro/places?station=${encodeURIComponent(station)}`,
        );
        if (!r.ok) return r.error ?? "No pude leer los lugares.";
        const places = r.places ?? [];
        emitUiEvent({ kind: "places", station: r.station ?? station, places });
        if (!places.length) {
          if (!r.configured) return "Todavía no tengo lugares cargados para ninguna estación.";
          const other = (r.available ?? []).slice(0, 4).join(", ");
          return `No tengo lugares cargados para ${r.station ?? station}${other ? `; sí para ${other}` : ""}.`;
        }
        return places
          .slice(0, 3)
          .map((x) => `${x.name}, ${x.walkMinutes === 0 ? "en la misma estación" : `a ${x.walkMinutes} minutos a pie`}${x.hours ? `, ${x.hours}` : ", sin horario publicado"}`)
          .join(". ");
      } catch {
        return "No alcanzo la lista de lugares ahora mismo.";
      }
    },
    metro_next: async (p) => {
      const station = str(p.station) ?? str(p.estacion) ?? "";
      if (!station) return "¿En qué estación?";
      try {
        const r = await hermesGet<{
          ok: boolean;
          station?: string;
          stale?: boolean;
          departures?: { line: string; headsign: string; inMinutes: number[] }[];
          error?: string;
        }>(`/metro/next?station=${encodeURIComponent(station)}`);
        if (!r.ok) return r.error ?? "No pude leer las salidas.";
        const deps = r.departures ?? [];
        if (!deps.length) return `No hay salidas programadas ahora en ${r.station ?? station}.`;
        const txt = deps
          .slice(0, 3)
          .map((d) => `${d.line} hacia ${d.headsign} en ${d.inMinutes[0]} minutos`)
          .join(", ");
        // El feed vencido NO se disfraza de predicción: se dice que es horario.
        return r.stale ? `Según el horario publicado: ${txt}.` : `${txt}.`;
      } catch {
        return "No alcanzo los horarios ahora mismo.";
      }
    },
    set_language: async (p) => {
      const lang = (str(p.language) ?? str(p.idioma) ?? "").toLowerCase();
      if (!lang) return "¿Qué idioma?";
      emitUiEvent({ kind: "language", language: lang });
      return `Idioma de la pantalla: ${lang}.`;
    },
  };
}

export function salaClientTools(): Record<string, (p: Record<string, unknown>) => Promise<string> | string> {
  return {
    ...estacionClientTools(),
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
