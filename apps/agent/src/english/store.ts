/**
 * Práctica de inglés (tutor de voz): sesiones + vocabulario en Supabase
 * (migración 015). Patrón idempotente por local_key (sha1), como hábitos y
 * reuniones. Cada sesión guardada hace check-in del hábito "Práctica de
 * inglés" → la racha aparece en /vida sin duplicar sistemas.
 */
import { createHash } from "node:crypto";
import type { EnglishError, EnglishSession, VocabEntry } from "@hermes/shared";
import { emit } from "../events.js";
import { checkinHabit, createHabit, resolveHabit } from "../habits/store.js";
import { supabase } from "../supabase.js";

const HABIT_NAME = "Práctica de inglés";
/** Vocab sin repasar hace más de esto vuelve a la cola (repaso espaciado simple). */
const REVIEW_AFTER_DAYS = 3;
const LEARNED_AFTER_REVIEWS = 3;

function sha1(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

export interface SaveSessionInput {
  /** ISO — ancla del local_key (idempotente ante reintentos del cliente). */
  startedAt: string;
  durationSec?: number | null;
  topics?: string[];
  fluency?: number | null;
  errors?: EnglishError[];
  wins?: string[];
  transcript?: string | null;
  source?: string;
}

export async function saveEnglishSession(input: SaveSessionInput): Promise<EnglishSession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("english_sessions")
    .upsert(
      {
        local_key: sha1("english", input.startedAt),
        started_at: input.startedAt,
        duration_sec: input.durationSec ?? null,
        topics: input.topics ?? [],
        fluency: input.fluency ?? null,
        errors: input.errors ?? [],
        wins: input.wins ?? [],
        transcript: input.transcript ?? null,
        source: input.source ?? "web",
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[english] save session:", error.message);
    return null;
  }
  // Racha en /vida: la práctica cuenta como hábito (idempotente por día).
  try {
    const habit =
      (await resolveHabit(HABIT_NAME)) ?? (await createHabit({ name: HABIT_NAME }));
    if (habit) await checkinHabit(habit.id, { source: "english" });
  } catch (err) {
    console.error("[english] check-in hábito:", String(err).slice(0, 120));
  }
  const session = rowToSession(data as Record<string, unknown>);
  emit({
    kind: "task_done",
    taskId: `english-${session.id}`,
    detail: `práctica de inglés guardada (${Math.round((session.duration_sec ?? 0) / 60)} min, fluidez ${session.fluency ?? "?"}/5)`,
  });
  return session;
}

export async function listEnglishSessions(limit = 20): Promise<EnglishSession[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("english_sessions")
    .select("id,started_at,duration_sec,topics,fluency,errors,wins,report_md,report_status,source")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => rowToSession(r as Record<string, unknown>));
}

export async function getEnglishSession(
  id: number,
): Promise<(EnglishSession & { transcript: string | null }) | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("english_sessions").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  return { ...rowToSession(row), transcript: row.transcript ? String(row.transcript) : null };
}

export async function updateSessionReport(
  id: number,
  patch: { report_md?: string; report_status: EnglishSession["report_status"] },
): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("english_sessions").update(patch).eq("id", id);
  if (error) console.error("[english] update report:", error.message);
}

// ── Vocabulario ────────────────────────────────────────────────────────

export async function saveVocab(input: {
  term: string;
  /** Sin significado = tap desde el transcript en vivo: entra "por definir". */
  meaningEs?: string | null;
  example?: string | null;
}): Promise<VocabEntry | null> {
  if (!supabase) return null;
  const term = input.term.trim();
  if (!term) return null;
  const meaning = input.meaningEs?.trim() ?? "";
  const localKey = sha1("vocab", term.toLowerCase());
  // Tap sin significado: NUNCA pisar una definición existente del tutor —
  // si el término ya está en el banco, se devuelve tal cual.
  if (!meaning) {
    const { data: existing } = await supabase
      .from("english_vocab")
      .select("*")
      .eq("local_key", localKey)
      .maybeSingle();
    if (existing) return existing as VocabEntry;
  }
  const { data, error } = await supabase
    .from("english_vocab")
    .upsert(
      {
        local_key: localKey,
        term,
        meaning_es: meaning,
        example: input.example?.trim() || null,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[english] save vocab:", error.message);
    return null;
  }
  return data as VocabEntry;
}

export async function listVocab(opts: { due?: boolean; limit?: number } = {}): Promise<VocabEntry[]> {
  if (!supabase) return [];
  let q = supabase.from("english_vocab").select("*");
  if (opts.due) {
    const cutoff = new Date(Date.now() - REVIEW_AFTER_DAYS * 86_400_000).toISOString();
    q = q
      .eq("learned", false)
      .or(`last_reviewed_at.is.null,last_reviewed_at.lt.${cutoff}`)
      .order("last_reviewed_at", { ascending: true, nullsFirst: true });
  } else {
    q = q.order("created_at", { ascending: false });
  }
  const { data } = await q.limit(opts.limit ?? 20);
  return (data ?? []) as VocabEntry[];
}

export async function reviewVocab(id: number): Promise<VocabEntry | null> {
  if (!supabase) return null;
  const { data: cur } = await supabase.from("english_vocab").select("*").eq("id", id).maybeSingle();
  if (!cur) return null;
  const reviews = ((cur as VocabEntry).times_reviewed ?? 0) + 1;
  const { data, error } = await supabase
    .from("english_vocab")
    .update({
      times_reviewed: reviews,
      last_reviewed_at: new Date().toISOString(),
      learned: reviews >= LEARNED_AFTER_REVIEWS,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[english] review vocab:", error.message);
    return null;
  }
  return data as VocabEntry;
}

// ── Contexto para la dynamic var {{practice_context}} del tutor ────────

/** Resumen del progreso real para abrir la sesión con continuidad. */
export async function buildPracticeContext(): Promise<string> {
  const [sessions, due] = await Promise.all([listEnglishSessions(5), listVocab({ due: true, limit: 5 })]);
  if (!sessions.length && !due.length) return "First session — no history yet.";
  const parts: string[] = [];
  const last = sessions[0];
  if (last) {
    parts.push(
      `Last session: ${last.started_at.slice(0, 10)}, fluency ${last.fluency ?? "?"}/5, topics: ${last.topics.join(", ") || "—"}.`,
    );
    // Errores recurrentes de las últimas sesiones (los drills del reporte
    // ya vienen resumidos en report_md; aquí van los quotes crudos).
    const errors = sessions.flatMap((s) => s.errors).slice(0, 3);
    if (errors.length)
      parts.push(
        `Recent errors to re-drill: ${errors.map((e) => `"${e.quote}" → "${e.correction}"`).join(" · ")}.`,
      );
    const lastReport = sessions.find((s) => s.report_status === "done" && s.report_md);
    if (lastReport?.report_md) {
      const drills = lastReport.report_md.match(/## Drills\n([\s\S]*?)(?:\n##|$)/)?.[1]?.trim();
      if (drills) parts.push(`Suggested drills from last report: ${drills.slice(0, 300)}`);
    }
  }
  if (due.length) parts.push(`Vocabulary due for review: ${due.map((v) => v.term).join(", ")}.`);
  parts.push(`Sessions so far: ${sessions.length >= 5 ? "5+" : sessions.length}.`);
  return parts.join(" ");
}

// ── Helpers ────────────────────────────────────────────────────────────

function rowToSession(r: Record<string, unknown>): EnglishSession {
  return {
    id: Number(r.id),
    started_at: String(r.started_at),
    duration_sec: r.duration_sec == null ? null : Number(r.duration_sec),
    topics: Array.isArray(r.topics) ? r.topics.map(String) : [],
    fluency: r.fluency == null ? null : Number(r.fluency),
    errors: Array.isArray(r.errors) ? (r.errors as EnglishError[]) : [],
    wins: Array.isArray(r.wins) ? r.wins.map(String) : [],
    report_md: r.report_md ? String(r.report_md) : null,
    report_status: (r.report_status as EnglishSession["report_status"]) ?? "pending",
    source: String(r.source ?? "web"),
  };
}
