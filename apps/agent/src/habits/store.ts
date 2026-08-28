/**
 * Store de hábitos (tablas habits + habit_checkins). Check-in idempotente:
 * local_key = sha1(checkin|habit_id|date) → repetir "ya medité" el mismo día
 * no duplica. Racha calculada en TS caminando los últimos ~120 check-ins
 * (volumen personal; más simple de testear que window functions). Sin
 * Supabase, degrada a no-op (null/[]).
 */
import { createHash } from "node:crypto";
import type { Habit, HabitCadence, HabitCheckin, HabitToday } from "@hermes/shared";
import { supabase } from "../supabase.js";
import { addDays, startOfWeekBogota, todayBogota } from "../dates.js";

function localKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

// ── Hábitos ────────────────────────────────────────────────────────────

export async function createHabit(input: {
  name: string;
  cadence?: HabitCadence;
  timesPerWeek?: number;
}): Promise<Habit | null> {
  if (!supabase) return null;
  const name = input.name.trim();
  const cadence = input.cadence ?? "daily";
  const { data, error } = await supabase
    .from("habits")
    .upsert(
      {
        local_key: localKey("habit", name.toLowerCase()),
        name,
        cadence,
        times_per_week: input.timesPerWeek ?? (cadence === "daily" ? 7 : 3),
        active: true,
        archived_at: null,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[habits] create:", error.message);
    return null;
  }
  return data as Habit;
}

export async function listHabits(activeOnly = true): Promise<Habit[]> {
  if (!supabase) return [];
  let q = supabase.from("habits").select("*").order("created_at");
  if (activeOnly) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as Habit[];
}

export async function archiveHabit(id: number): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase
    .from("habits")
    .update({ active: false, archived_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

/** Resuelve "meditar" → hábito por nombre (exact → includes), como resolveSlug. */
export async function resolveHabit(nameOrId: string | number): Promise<Habit | null> {
  if (typeof nameOrId === "number") {
    if (!supabase) return null;
    const { data } = await supabase.from("habits").select("*").eq("id", nameOrId).maybeSingle();
    return (data as Habit) ?? null;
  }
  const needle = nameOrId.trim().toLowerCase();
  const habits = await listHabits(true);
  return (
    habits.find((h) => h.name.toLowerCase() === needle) ??
    habits.find((h) => h.name.toLowerCase().includes(needle)) ??
    habits.find((h) => needle.includes(h.name.toLowerCase())) ??
    null
  );
}

// ── Check-ins ──────────────────────────────────────────────────────────

export async function checkinHabit(
  habitId: number,
  opts: { date?: string; done?: boolean; note?: string | null; source?: string } = {},
): Promise<HabitCheckin | null> {
  if (!supabase) return null;
  const date = opts.date ?? todayBogota();
  const { data, error } = await supabase
    .from("habit_checkins")
    .upsert(
      {
        local_key: localKey("checkin", String(habitId), date),
        habit_id: habitId,
        date,
        done: opts.done ?? true,
        note: opts.note ?? null,
        source: opts.source ?? "agent",
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[habits] checkin:", error.message);
    return null;
  }
  return data as HabitCheckin;
}

async function recentCheckins(habitId: number, limit = 120): Promise<HabitCheckin[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("habit_checkins")
    .select("*")
    .eq("habit_id", habitId)
    .eq("done", true)
    .order("date", { ascending: false })
    .limit(limit);
  return (data ?? []) as HabitCheckin[];
}

/**
 * Racha del hábito. daily: días consecutivos terminando hoy o AYER (hoy sin
 * marcar aún no rompe — no se pierde la racha hasta medianoche Bogotá).
 * weekly: semanas consecutivas (lunes) con >= times_per_week check-ins,
 * contando la semana corriente solo si ya cumplió.
 */
export function computeStreak(habit: Habit, checkins: HabitCheckin[], today: string): number {
  const dates = new Set(checkins.map((c) => c.date));
  if (habit.cadence === "daily") {
    let cursor = dates.has(today) ? today : addDays(today, -1);
    let streak = 0;
    while (dates.has(cursor)) {
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }
  // weekly: contar por semanas hacia atrás.
  const countWeek = (monday: string) => {
    let n = 0;
    for (let i = 0; i < 7; i++) if (dates.has(addDays(monday, i))) n += 1;
    return n;
  };
  const thisMonday = startOfWeekBogota(today);
  let streak = 0;
  let monday = thisMonday;
  // La semana corriente suma solo si ya cumplió; si no, no rompe (como "hoy" en daily).
  if (countWeek(monday) >= habit.times_per_week) streak += 1;
  monday = addDays(monday, -7);
  while (countWeek(monday) >= habit.times_per_week) {
    streak += 1;
    monday = addDays(monday, -7);
  }
  return streak;
}

/** Hábitos activos con done_today, racha y la semana en 7 puntos (brief/voz/web). */
export async function habitsToday(): Promise<HabitToday[]> {
  const habits = await listHabits(true);
  if (!habits.length) return [];
  const today = todayBogota();
  const monday = startOfWeekBogota(today);
  const out: HabitToday[] = [];
  for (const h of habits) {
    const checkins = await recentCheckins(h.id);
    const dates = new Set(checkins.map((c) => c.date));
    const week_dates = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(monday, i);
      return { date, done: dates.has(date) };
    });
    out.push({
      ...h,
      done_today: dates.has(today),
      streak: computeStreak(h, checkins, today),
      week_count: week_dates.filter((d) => d.done).length,
      week_dates,
    });
  }
  return out;
}
