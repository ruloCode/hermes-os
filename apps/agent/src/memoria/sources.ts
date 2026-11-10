/**
 * De dónde sale lo que el índice sabe. Cada fuente convierte su almacén en
 * documentos de texto (`SourceDoc`); el índice los fragmenta y les calcula vector.
 *
 * - **Supabase, solo lectura y paginado**: las cinco de match_knowledge, con las
 *   MISMAS columnas que usa el RPC (memorias = content; reuniones = summary;
 *   ejecuciones = analysis + result; chats = content; vault = content), más las
 *   sesiones de inglés, las metas y los pendientes del día.
 * - **`~/.hermes-os`**: gimnasio, intentos del plan de inglés, planes y actas del
 *   compañero, Upwork y tutor. Se leen con las funciones del módulo dueño cuando
 *   existen (así un cambio de forma se arregla en un solo lugar).
 *
 * FUERA a propósito: finanzas (tiene candado en el teléfono: que el chat o la
 * voz la encuentren por una búsqueda general sería saltárselo) y composición
 * (confidencial; ni sus eventos salen del proceso). `EXCLUDED_SOURCES` lo deja
 * escrito y un test lo comprueba.
 *
 * Cada fuente falla sola: la sincronización conserva lo que ya tenía de ella.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  gymScenario,
  planLesson,
  type GrowthPlan,
  type GymRep,
  type GymScenario,
  type KnowledgeSource,
  type PlanAttempt,
  type TutorConversation,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

export interface SourceDoc {
  source: KnowledgeSource;
  ref: string;
  title: string;
  text: string;
  project: string | null;
  createdAt: string;
  importance?: number;
  kind?: string;
}

export interface SourceCollector {
  id: KnowledgeSource;
  /** De dónde lee (para el estado y los errores). */
  origin: "supabase" | "local";
  collect(): Promise<SourceDoc[]>;
}

/** Almacenes que NUNCA entran al índice. */
export const EXCLUDED_SOURCES = ["finance", "composicion"] as const;

/** Mensajes de chat más cortos que esto («ok», «dale», «gracias») son ruido para buscar. */
export const MIN_CHAT_CHARS = 15;

const iso = (v: unknown, fallback = "1970-01-01T00:00:00.000Z"): string => {
  const s = typeof v === "string" ? v : "";
  return s && Number.isFinite(Date.parse(s)) ? s : fallback;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

// ── Supabase ────────────────────────────────────────────────────────────

const PAGE = 1000;

/** Lee una tabla entera por páginas (el API corta en 1.000 filas). */
export async function readAll<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  apply?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select(columns).order("created_at", { ascending: true }).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export interface MemoryRow {
  id: string;
  type: string | null;
  content: string;
  summary: string | null;
  project_slug: string | null;
  importance: number | null;
  created_at: string;
}

/** Una memoria como documento. La usan la sincronización Y `saveMemory`: la huella tiene que salir igual. */
export function memoryToSourceDoc(m: MemoryRow): SourceDoc {
  return {
    source: "memory",
    ref: String(m.id),
    title: (m.summary ?? "").trim() || m.content.slice(0, 120),
    text: m.content,
    project: m.project_slug ?? null,
    createdAt: iso(m.created_at),
    importance: typeof m.importance === "number" ? m.importance : 3,
    kind: m.type ?? undefined,
  };
}

export function supabaseCollectors(db: SupabaseClient): SourceCollector[] {
  return [
    {
      id: "memory",
      origin: "supabase",
      async collect() {
        const rows = await readAll<MemoryRow>(db, "memories", "id,type,content,summary,project_slug,importance,created_at");
        return rows.filter((m) => str(m.content).trim()).map(memoryToSourceDoc);
      },
    },
    {
      id: "meeting",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(db, "meetings", "meeting_id,title,summary,project_slug,meeting_date,created_at");
        return rows
          .filter((r) => str(r.summary).trim())
          .map((r) => ({
            source: "meeting" as const,
            ref: str(r.meeting_id),
            title: str(r.title) || "reunión",
            text: str(r.summary),
            project: (r.project_slug as string) ?? null,
            createdAt: iso(r.meeting_date, iso(r.created_at)),
          }));
      },
    },
    {
      id: "execution",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(db, "task_executions", "execution_id,prompt,analysis,result,project_slug,created_at");
        return rows
          .map((r) => ({
            source: "execution" as const,
            ref: str(r.execution_id),
            title: str(r.prompt).slice(0, 120) || "ejecución",
            text: `${str(r.analysis)}\n${str(r.result)}`.trim(),
            project: (r.project_slug as string) ?? null,
            createdAt: iso(r.created_at),
          }))
          .filter((d) => d.text);
      },
    },
    {
      id: "conversation",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(db, "conversation_messages", "id,role,project_slug,channel,content,ts,created_at");
        return rows
          .filter((r) => str(r.content).trim().length >= MIN_CHAT_CHARS)
          .map((r) => ({
            source: "conversation" as const,
            ref: String(r.id),
            title: `${str(r.role)} · ${str(r.project_slug)}${r.channel === "voice" ? " (voz)" : ""}`,
            text: str(r.content),
            project: (r.project_slug as string) ?? null,
            createdAt: iso(r.ts, iso(r.created_at)),
          }));
      },
    },
    {
      id: "vault",
      origin: "supabase",
      async collect() {
        // vault_docs no tiene created_at: se ordena por path.
        const out: Record<string, unknown>[] = [];
        for (let from = 0; ; from += PAGE) {
          const { data, error } = await db
            .from("vault_docs")
            .select("path,title,content,project_slug,updated_at")
            .order("path", { ascending: true })
            .range(from, from + PAGE - 1);
          if (error) throw new Error(`vault_docs: ${error.message}`);
          out.push(...(data ?? []));
          if (!data || data.length < PAGE) break;
        }
        return out
          .filter((r) => str(r.content).trim())
          .map((r) => ({
            source: "vault" as const,
            ref: str(r.path),
            title: str(r.title) || str(r.path),
            text: str(r.content),
            project: (r.project_slug as string) ?? null,
            createdAt: iso(r.updated_at),
          }));
      },
    },
    {
      id: "english",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(
          db,
          "english_sessions",
          "id,started_at,topics,errors,wins,report_md,source,created_at",
        );
        return rows.map((r) => {
          const topics = Array.isArray(r.topics) ? (r.topics as unknown[]).map(String).join(", ") : "";
          const errors = Array.isArray(r.errors) ? (r.errors as unknown[]).map(fmtEnglishError).filter(Boolean) : [];
          const wins = Array.isArray(r.wins) ? (r.wins as unknown[]).map(String) : [];
          const kind = r.source === "class" ? "Clase de inglés" : "Práctica de inglés";
          const date = iso(r.started_at, iso(r.created_at));
          return {
            source: "english" as const,
            ref: `session:${r.id}`,
            title: `${kind} · ${date.slice(0, 10)}${topics ? ` · ${topics}` : ""}`,
            text: [
              str(r.report_md),
              errors.length ? `Errores:\n${errors.map((e) => `- ${e}`).join("\n")}` : "",
              wins.length ? `Bien dicho: ${wins.join("; ")}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
            project: "ingles",
            createdAt: date,
          };
        }).filter((d) => d.text);
      },
    },
    {
      id: "growth",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(
          db,
          "goals",
          "id,title,description,target_value,current_value,unit,milestones,status,due_date,created_at",
        );
        return rows.map((r) => ({
          source: "growth" as const,
          ref: `goal:${r.id}`,
          title: `Meta: ${str(r.title)}`,
          text: [
            str(r.title),
            str(r.description),
            r.target_value != null ? `Objetivo: ${r.current_value ?? 0} de ${r.target_value} ${str(r.unit)}`.trim() : "",
            r.due_date ? `Fecha: ${str(r.due_date)}` : "Sin fecha",
            `Estado: ${str(r.status)}`,
          ]
            .filter(Boolean)
            .join("\n"),
          project: null,
          createdAt: iso(r.created_at),
        }));
      },
    },
    {
      id: "day",
      origin: "supabase",
      async collect() {
        const rows = await readAll<Record<string, unknown>>(db, "tasks", "id,title,status,detail,project_slug,created_at,updated_at", (q) =>
          q.eq("project_slug", "dia"),
        );
        const due = await readJsonFile<Record<string, string>>(join(HERMES_HOME, "day", "due.json"));
        return rows
          .filter((r) => r.status !== "dismissed")
          .map((r) => {
            const date = due?.[String(r.id)] ?? null;
            const done = r.status === "done";
            return {
              source: "day" as const,
              ref: `task:${r.id}`,
              title: `Pendiente: ${str(r.title)}`,
              text: [str(r.title), str(r.detail), date ? `Para el ${date}` : "", done ? `Hecho (${iso(r.updated_at).slice(0, 10)})` : "Pendiente"]
                .filter(Boolean)
                .join("\n"),
              project: null,
              createdAt: iso(r.created_at),
            };
          });
      },
    },
  ];
}

function fmtEnglishError(e: unknown): string {
  if (typeof e === "string") return e;
  if (!e || typeof e !== "object") return "";
  const o = e as Record<string, unknown>;
  const said = str(o.said ?? o.original ?? o.wrong);
  const better = str(o.better ?? o.correction ?? o.right);
  const rule = str(o.rule ?? o.note ?? o.explanation);
  return [said && better ? `«${said}» → «${better}»` : said || better, rule].filter(Boolean).join(" · ");
}

// ── ~/.hermes-os ────────────────────────────────────────────────────────

async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readJsonl<T>(path: string): Promise<T[]> {
  let raw = "";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as T);
    } catch {
      /* línea a medias */
    }
  }
  return out;
}

/** Las fuentes locales leídas desde `home` (por defecto `~/.hermes-os`; los tests usan una carpeta temporal). */
export function localCollectors(home: string = HERMES_HOME): SourceCollector[] {
  return [
    {
      id: "gym",
      origin: "local",
      async collect() {
        const [reps, generated] = await Promise.all([
          readJsonl<GymRep>(join(home, "gym", "reps.jsonl")),
          readJsonl<GymScenario>(join(home, "gym", "scenarios.jsonl")),
        ]);
        const byId = new Map(generated.map((s) => [s.id, s]));
        return reps
          .filter((r) => r && r.id && str(r.transcript).trim())
          .map((r) => {
            const s = gymScenario(r.scenarioId) ?? byId.get(r.scenarioId);
            const fb = r.feedback ?? ({} as GymRep["feedback"]);
            return {
              source: "gym" as const,
              ref: `rep:${r.id}`,
              title: `Gimnasio ${r.date} · ${s?.prompt?.slice(0, 80) ?? r.scenarioId} (${r.score}/100)`,
              text: [
                s ? `Escenario: ${s.situation} ${s.prompt}` : `Escenario: ${r.scenarioId}`,
                `Lo que dije: ${r.transcript}`,
                fb.better ? `Dicho mejor: ${fb.better}` : "",
                fb.tip ? `Consejo: ${fb.tip}` : "",
                fb.progress ? `Progreso: ${fb.progress}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              project: null,
              createdAt: iso(r.createdAt, `${r.date}T12:00:00.000Z`),
            };
          });
      },
    },
    {
      id: "english",
      origin: "local",
      async collect() {
        const attempts = await readJsonl<PlanAttempt>(join(home, "english-plan", "attempts.jsonl"));
        return attempts
          .filter((a) => a && a.id)
          .map((a) => {
            const lesson = planLesson(a.lessonId);
            return {
              source: "english" as const,
              ref: `plan:${a.id}`,
              title: `Plan de inglés · ${lesson?.title ?? a.lessonId} (${a.score}/100)`,
              text: [
                `Lección ${lesson?.title ?? a.lessonId} (${a.kind}) del ${a.date}: ${a.passed ? "pasada" : "no pasada"}, ${a.score}/100.`,
                a.quiz ? `Quiz: ${a.quiz.correct} de ${a.quiz.total}.` : "",
                a.drill?.transcript ? `Lo que dije: ${a.drill.transcript}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              project: "ingles",
              createdAt: iso(a.createdAt),
            };
          });
      },
    },
    {
      id: "growth",
      origin: "local",
      async collect() {
        const [plans, calls] = await Promise.all([
          readJsonFile<GrowthPlan[]>(join(home, "growth", "plans.json")),
          readJsonFile<{ id: string; at: string; kind?: string; acta_md?: string; outcome?: string }[]>(join(home, "growth", "calls.json")),
        ]);
        const out: SourceDoc[] = [];
        for (const p of Array.isArray(plans) ? plans : []) {
          if (!p?.id || !str(p.words).trim()) continue;
          out.push({
            source: "growth",
            ref: `plan:${p.id}`,
            title: `Plan de la meta ${p.goal_id}`,
            text: `${p.words}\nEstado: ${p.status === "active" ? "activo" : "en pausa"}`,
            project: null,
            createdAt: iso(p.created_at),
          });
        }
        for (const c of Array.isArray(calls) ? calls : []) {
          if (!c?.id || !str(c.acta_md).trim()) continue;
          const kind = c.kind === "morning" ? "Arranque del día" : c.kind === "evening" ? "Cierre del día" : "Revisión semanal";
          out.push({
            source: "growth",
            ref: `call:${c.id}`,
            title: `${kind} · ${iso(c.at).slice(0, 10)}`,
            text: str(c.acta_md),
            project: null,
            createdAt: iso(c.at),
          });
        }
        return out;
      },
    },
    {
      id: "upwork",
      origin: "local",
      async collect() {
        // Append-only: gana la última línea de cada jobId (como reduceOpportunities).
        const lines = await readJsonl<Record<string, any>>(join(home, "upwork", "opportunities.jsonl"));
        const byJob = new Map<string, Record<string, any>>();
        for (const o of lines) if (o?.jobId) byJob.set(String(o.jobId), o);
        return [...byJob.values()].map((o) => {
          const job = (o.job ?? {}) as Record<string, any>;
          const budget = job.budget ? JSON.stringify(job.budget) : "";
          return {
            source: "upwork" as const,
            ref: `job:${o.jobId}`,
            title: `Upwork: ${str(job.title)} (${o.score ?? "?"} pts, ${str(o.status)})`,
            text: [
              str(job.title),
              str(job.description),
              Array.isArray(job.skills) && job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
              budget ? `Presupuesto: ${budget}` : "",
              Array.isArray(o.reasons) && o.reasons.length ? `Por qué: ${o.reasons.join("; ")}` : "",
              o.draft?.text ? `Borrador de propuesta: ${o.draft.text}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            project: null,
            createdAt: typeof o.receivedAt === "number" ? new Date(o.receivedAt).toISOString() : iso(o.updatedAt),
          };
        });
      },
    },
    {
      id: "tutor",
      origin: "local",
      async collect() {
        const root = join(home, "tutor");
        let projects: string[] = [];
        try {
          projects = await readdir(root);
        } catch {
          return [];
        }
        const out: SourceDoc[] = [];
        for (const project of projects) {
          let files: string[] = [];
          try {
            files = (await readdir(join(root, project))).filter((f) => f.endsWith(".json"));
          } catch {
            continue;
          }
          for (const f of files) {
            const c = await readJsonFile<TutorConversation>(join(root, project, f));
            if (!c?.id || !Array.isArray(c.history) || !c.history.length) continue;
            out.push({
              source: "tutor",
              ref: `${project}/${c.id}`,
              title: `Tutor ${project}: ${c.title}`,
              text: c.history.map((m) => `${m.role === "user" ? "Pregunta" : "Tutor"}: ${m.text}`).join("\n\n"),
              project,
              createdAt: iso(c.updatedAt, iso(c.createdAt)),
            });
          }
        }
        return out;
      },
    },
  ];
}

/** Todas las fuentes de esta máquina. Sin Supabase, solo las locales. */
export function allCollectors(db: SupabaseClient | null, home: string = HERMES_HOME): SourceCollector[] {
  return [...(db ? supabaseCollectors(db) : []), ...localCollectors(home)];
}
