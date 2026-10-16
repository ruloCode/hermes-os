import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { CALL_LABEL, STAGE_LABEL, dayLabel, isValidDate, isValidTime, type CallSlot } from "@hermes/shared";
import { OWNER } from "../owner.js";
import { createGoal, listGoals, resolveGoal, updateGoal } from "../habits/goals.js";
import { resolveHabit } from "../habits/store.js";

/**
 * Tools del compañero (chat de texto y run_task de la voz). La regla que
 * manda: las metas, los planes y los horarios los DICE el dueño; Hermes los
 * anota y pregunta lo que falta, nunca los inventa.
 *
 * `companion` se importa al llamarla (no al cargar): growth/index arrastra la
 * agenda, las juntas y el enlace del teléfono, y así no hay ciclos de import.
 */

function text(t: string, isError = false) {
  return { content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) };
}

const companion = async () => (await import("./index.js")).companion;

const DAYS = ["", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];

const growthGoalTool = tool(
  "growth_goal",
  `Metas de ${OWNER} con su regla: solo la meta = sueño · con fecha = objetivo · con fecha y plan = en marcha (solo a estas les hace seguimiento el compañero). ` +
    `Úsala SOLO cuando ${OWNER} diga una meta con sus palabras o pida ver cómo van; nunca inventes ni propongas metas por tu cuenta. ` +
    `Al crear: si falta la fecha o el plan, pregúntale solo «¿para cuándo?» y «¿qué vas a hacer, y cuándo?» (el plan va con growth_plan).`,
  {
    action: z.enum(["create", "set_due", "status"]),
    title: z.string().optional().describe(`La meta con las palabras de ${OWNER} (create) o un fragmento para encontrarla (set_due)`),
    due_date: z.string().nullable().optional().describe("AAAA-MM-DD. null en set_due la quita"),
    why: z.string().optional().describe("Para qué la quiere, si lo dijo"),
  },
  async ({ action, title, due_date, why }) => {
    const c = await companion();
    if (action === "status") {
      const st = await c.status();
      if (!st.goals.length) return text("No hay metas activas.");
      const lines = st.goals.map((g) => {
        const plans = g.plans
          .filter((p) => p.status === "active")
          .map((p) => `   · plan «${p.words}» — ${p.week.done}/${p.week.occurrences} esta semana${p.week.without_reminder ? ` (${p.week.without_reminder} sin recordatorio)` : ""}`);
        return [`${STAGE_LABEL[g.stage]}: «${g.title}»${g.due_date ? ` · para el ${dayLabel(g.due_date)}` : " · sin fecha"}`, ...plans].join("\n");
      });
      return text([...lines, callsLine(st.settings.calls)].join("\n"));
    }
    if (due_date != null && !isValidDate(due_date)) return text("La fecha debe ir como AAAA-MM-DD.", true);
    if (action === "create") {
      if (!title?.trim()) return text("¿Cuál es la meta, con tus palabras?", true);
      const g = await createGoal({ title: title.trim(), description: why ?? null, dueDate: due_date ?? null });
      if (!g) return text("No pude guardar la meta (Supabase no configurado).", true);
      const missing = [!g.due_date && "la fecha («¿para cuándo?»)", "un plan («¿qué vas a hacer, y cuándo?»)"].filter(Boolean);
      return text(`Meta guardada (id ${g.id}): «${g.title}»${g.due_date ? `, para el ${dayLabel(g.due_date)}` : ""}. Le falta ${missing.join(" y ")} para quedar en marcha.`);
    }
    if (!title?.trim()) return text("¿Qué meta? Dime un fragmento del título.", true);
    const g = await resolveGoal(title);
    if (!g) {
      const titles = (await listGoals("active")).map((x) => x.title);
      return text(`No encontré la meta "${title}". Activas: ${titles.join(", ") || "ninguna"}.`, true);
    }
    const updated = await updateGoal(g.id, { dueDate: due_date ?? null });
    if (!updated) return text("No pude actualizar la meta.", true);
    return text(updated.due_date ? `«${updated.title}» ahora es para el ${dayLabel(updated.due_date)}.` : `«${updated.title}» quedó sin fecha (vuelve a ser un sueño).`);
  },
);

const growthPlanTool = tool(
  "growth_plan",
  `Planes si-entonces de una meta de ${OWNER} (máximo 3 activos por meta). Un plan dice QUÉ va a hacer y CUÁNDO: días + hora ("L-V a las 6:00") o un bloque de SU agenda ("🏋️ Gym"). ` +
    `Si lo mide un hábito (gym, leer…), pásalo en habit: "Hecho" marca ese hábito y si ya lo marcó, Hermes no pregunta. ` +
    `El compañero pregunta por el plan después de su hora, dentro de la franja de mensajes, y nunca durante una junta o un bloque ocupado. Solo con las palabras de ${OWNER}.`,
  {
    action: z.enum(["add", "pause", "resume", "remove"]),
    goal: z.string().optional().describe("Fragmento del título de la meta (add)"),
    words: z.string().optional().describe(`El plan con las palabras de ${OWNER} (add)`),
    days: z.array(z.number().int().min(1).max(7)).optional().describe("1=lunes … 7=domingo (plan de hora fija)"),
    time: z.string().optional().describe("HH:MM, hora local (plan de hora fija)"),
    calendar_match: z.string().optional().describe("Texto del título del bloque de agenda (plan de agenda)"),
    habit: z.string().optional().describe("Nombre del hábito que lo mide, si hay uno"),
    checkin_after_min: z.number().int().min(0).max(600).optional().describe("Minutos después de la hora (o del fin del bloque) para preguntar. Default 60 / 15"),
    plan_id: z.string().optional().describe("pause/resume/remove: el id del plan (sale en growth_goal status o en la respuesta de add)"),
  },
  async (a) => {
    const c = await companion();
    if (a.action !== "add") {
      if (!a.plan_id) return text("Falta plan_id.", true);
      const ok = await c.setPlanStatus(a.plan_id, a.action === "pause" ? "paused" : a.action === "resume" ? "active" : "removed");
      return text(ok ? `Plan ${a.action === "pause" ? "en pausa" : a.action === "resume" ? "activo otra vez" : "borrado"}.` : "No encontré ese plan.", !ok);
    }
    if (!a.goal || !a.words) return text("Para un plan necesito la meta y el plan con tus palabras.", true);
    const g = await resolveGoal(a.goal);
    if (!g) return text(`No encontré la meta "${a.goal}".`, true);
    let when: Record<string, unknown> | null = null;
    if (a.calendar_match?.trim()) when = { kind: "calendar", match: a.calendar_match.trim() };
    else if (a.days?.length && isValidTime(a.time)) when = { kind: "weekly", days: a.days, time: a.time };
    if (!when) return text("¿Cuándo? Dame días y hora (HH:MM) o el nombre del bloque de tu agenda.", true);
    let measure: Record<string, unknown> = { kind: "self_report" };
    if (a.habit?.trim()) {
      const h = await resolveHabit(a.habit.trim());
      if (!h) return text(`No encontré el hábito "${a.habit}". Créalo con manage_habit o deja el plan sin hábito.`, true);
      measure = { kind: "habit", habit_id: h.id, habit_name: h.name };
    }
    const r = await c.addPlan({
      goal_id: g.id,
      words: a.words,
      when,
      measure,
      ...(a.checkin_after_min != null ? { checkin_after_min: a.checkin_after_min } : {}),
    });
    if (!r.ok) return text(r.error, true);
    const stageNote = g.due_date ? "La meta queda EN MARCHA." : "Ojo: la meta aún no tiene fecha, así que sigue siendo objetivo hasta que la tenga.";
    return text(`Plan guardado (id ${r.plan.id}) para «${g.title}»: «${r.plan.words}». ${stageNote}`);
  },
);

function daysLabel(days: number[]): string {
  const d = [...days].sort();
  if (d.length === 7) return "todos los días";
  if (d.join() === "1,2,3,4,5") return "de lunes a viernes";
  return d.map((x) => DAYS[x]).join(", ");
}

function callsLine(calls: CallSlot[]): string {
  if (!calls.length) return "Sin llamadas agendadas.";
  return `Llamadas: ${calls.map((c) => `${CALL_LABEL[c.kind]} ${daysLabel(c.days)} a las ${c.time}`).join(" · ")}.`;
}

const growthSettingsTool = tool(
  "growth_settings",
  `Ajustes del compañero de ${OWNER}. Las llamadas las agenda ÉL: morning = arranque del día (3 min: qué te toca hoy y una intención), evening = cierre del día (3 min: cómo te fue con tus planes y lo de mañana), weekly = revisión semanal (5 min). ` +
    `Pasa la lista COMPLETA en calls (reemplaza la anterior; [] = sin llamadas). Si a la hora de una llamada hay una junta en su agenda, Hermes espera a que termine. ` +
    `También: la franja en que acepta mensajes y qué hace el No molestar con los check-ins (silent = llegan callados · veto = esperan).`,
  {
    calls: z
      .array(
        z.object({
          kind: z.enum(["morning", "evening", "weekly"]),
          days: z.array(z.number().int().min(1).max(7)).min(1).describe("1=lunes … 7=domingo"),
          time: z.string().describe("HH:MM, hora local"),
        }),
      )
      .max(6)
      .optional(),
    messages_start: z.string().optional().describe("HH:MM"),
    messages_end: z.string().optional().describe("HH:MM"),
    dnd: z.enum(["silent", "veto"]).optional(),
  },
  async (a) => {
    const c = await companion();
    if (a.calls?.some((x) => !isValidTime(x.time))) return text("Cada hora va como HH:MM.", true);
    const s = await c.updateSettings((cur) => {
      const next = { ...cur };
      if (a.calls) next.calls = a.calls.map((x) => ({ kind: x.kind, days: [...new Set(x.days)].sort(), time: x.time }));
      if (isValidTime(a.messages_start) && isValidTime(a.messages_end) && a.messages_start < a.messages_end) {
        next.messages = { start: a.messages_start, end: a.messages_end };
      }
      if (a.dnd) next.dnd = a.dnd;
      return next;
    });
    return text(`Listo. ${callsLine(s.calls)} Mensajes de ${s.messages.start} a ${s.messages.end}. No molestar: ${s.dnd === "silent" ? "llegan callados" : "esperan"}.`);
  },
);

export const GROWTH_TOOLS = [growthGoalTool, growthPlanTool, growthSettingsTool];
