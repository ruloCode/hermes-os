/**
 * Metas de desarrollo personal (tabla goals). Progreso numérico
 * (current/target) o cualitativo (milestones jsonb). Auto-done al alcanzar
 * el target. Sin Supabase, degrada a no-op (null/[]).
 */
import { createHash } from "node:crypto";
import type { Goal, GoalMilestone, GoalStatus } from "@hermes/shared";
import { supabase } from "../supabase.js";

function localKey(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

function mapGoal(row: Record<string, unknown>): Goal {
  return {
    ...(row as unknown as Goal),
    current_value: Number(row.current_value ?? 0),
    target_value: row.target_value != null ? Number(row.target_value) : null,
    milestones: (row.milestones ?? []) as GoalMilestone[],
  };
}

export async function createGoal(input: {
  title: string;
  description?: string | null;
  targetValue?: number | null;
  unit?: string | null;
  milestones?: string[];
  dueDate?: string | null;
}): Promise<Goal | null> {
  if (!supabase) return null;
  const title = input.title.trim();
  const milestones: GoalMilestone[] = (input.milestones ?? []).map((t) => ({
    title: t,
    done: false,
  }));
  const { data, error } = await supabase
    .from("goals")
    .upsert(
      {
        local_key: localKey("goal", title.toLowerCase()),
        title,
        description: input.description ?? null,
        target_value: input.targetValue ?? null,
        unit: input.unit ?? null,
        milestones,
        due_date: input.dueDate ?? null,
        status: "active",
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[goals] create:", error.message);
    return null;
  }
  return mapGoal(data);
}

export async function listGoals(status?: GoalStatus): Promise<Goal[]> {
  if (!supabase) return [];
  let q = supabase.from("goals").select("*").order("created_at");
  if (status) q = q.eq("status", status);
  const { data } = await q;
  return (data ?? []).map(mapGoal);
}

/** Resuelve "leer 12 libros" → meta por título (exact → includes). */
export async function resolveGoal(titleOrId: string | number): Promise<Goal | null> {
  if (typeof titleOrId === "number") {
    if (!supabase) return null;
    const { data } = await supabase.from("goals").select("*").eq("id", titleOrId).maybeSingle();
    return data ? mapGoal(data) : null;
  }
  const needle = titleOrId.trim().toLowerCase();
  const goals = await listGoals();
  return (
    goals.find((g) => g.title.toLowerCase() === needle) ??
    goals.find((g) => g.title.toLowerCase().includes(needle)) ??
    goals.find((g) => needle.includes(g.title.toLowerCase())) ??
    null
  );
}

export async function updateGoal(
  id: number,
  patch: {
    currentValue?: number;
    delta?: number;
    status?: GoalStatus;
    /** marca un milestone por título (includes, case-insensitive). */
    milestoneDone?: string;
    description?: string;
  },
): Promise<Goal | null> {
  if (!supabase) return null;
  const goal = await resolveGoal(id);
  if (!goal) return null;

  const clean: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let current = goal.current_value;
  if (patch.currentValue !== undefined) current = patch.currentValue;
  if (patch.delta !== undefined) current += patch.delta;
  if (current !== goal.current_value) clean.current_value = current;
  if (patch.description !== undefined) clean.description = patch.description;
  if (patch.status !== undefined) clean.status = patch.status;

  if (patch.milestoneDone) {
    const needle = patch.milestoneDone.toLowerCase();
    const milestones = goal.milestones.map((m) =>
      !m.done && m.title.toLowerCase().includes(needle)
        ? { ...m, done: true, done_at: new Date().toISOString() }
        : m,
    );
    clean.milestones = milestones;
    // Meta cualitativa: todos los milestones hechos → done.
    if (goal.target_value == null && milestones.length && milestones.every((m) => m.done)) {
      clean.status = "done";
    }
  }

  // Auto-done al alcanzar el target numérico.
  if (goal.target_value != null && current >= goal.target_value && goal.status === "active") {
    clean.status = "done";
  }
  if (clean.status === "done" && goal.status !== "done") {
    clean.done_at = new Date().toISOString();
  }

  const { data, error } = await supabase
    .from("goals")
    .update(clean)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) console.error("[goals] update:", error.message);
  return data ? mapGoal(data) : null;
}
