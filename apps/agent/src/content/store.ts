/**
 * Estudio de contenido (proyecto RuloCodeShow): piezas del pipeline de
 * producción, sesiones de grabación batch y radar de tendencias
 * (migraciones 016/017). Patrón idempotente por local_key (sha1), como
 * english/hábitos/reuniones.
 *
 * Etapas: el estado es la FASE EN CURSO (idea → guion → grabacion → edicion →
 * programado → publicado); las definiciones y criterios de salida viven en
 * `@hermes/shared` (content.ts) y los comparten agente y dashboard. Cada
 * cambio de etapa sella `status_since` y agrega una entrada a `stage_history`:
 * de ahí salen "N días aquí", el lead time y las piezas atascadas.
 *
 * Linear: cada pieza puede enlazarse a un issue del proyecto RuloCodeShow
 * (espejo del vault) con label "contenido"; el cambio de estado local se
 * refleja en el issue (fire-and-forget). El guion se espeja al vault en
 * projects/rulocodeshow/contenido/ al guardarse — la UI edita, Obsidian lee.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { PLATFORM_PROVIDER, STAGES, stageGates, youtubeVideoId } from "@hermes/shared";
import type {
  ContentBoard,
  ContentChatMessage,
  ContentPiece,
  ContentPillar,
  ContentPublication,
  ContentRef,
  ContentSession,
  ContentStageEntry,
  ContentStatus,
} from "@hermes/shared";
import { emit } from "../events.js";
import { env } from "../env.js";
import { createLinearIssue, linearEnabled, updateIssueState } from "../linear.js";
import { supabase } from "../supabase.js";

/** Slug del proyecto del vault que manda en el Estudio (espejo 1:1 en Linear). */
export const CONTENT_PROJECT_SLUG = "rulocodeshow";
const VAULT_CONTENT_DIR = join("projects", CONTENT_PROJECT_SLUG, "contenido");

function sha1(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex");
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// ── Piezas ─────────────────────────────────────────────────────────────

export interface CreatePieceInput {
  title: string;
  pillar?: ContentPillar;
  platforms?: string[];
  format?: ContentPiece["format"];
  status?: ContentStatus;
  publishAt?: string | null;
  weekLabel?: string | null;
  hook?: string | null;
  scriptMd?: string | null;
  notes?: string | null;
  sessionId?: number | null;
  /** Referencia del radar que originó la pieza (trazabilidad). */
  refId?: number | null;
}

export async function createPiece(input: CreatePieceInput): Promise<ContentPiece | null> {
  if (!supabase) return null;
  const title = input.title.trim();
  if (!title) return null;
  const now = new Date().toISOString();
  const status = input.status ?? "idea";
  const { data, error } = await supabase
    .from("content_pieces")
    .upsert(
      {
        local_key: sha1("piece", title.toLowerCase()),
        title,
        pillar: input.pillar ?? "p1",
        platforms: input.platforms ?? [],
        format: input.format ?? "vertical",
        status,
        status_since: now,
        stage_history: [{ status, at: now }],
        publish_at: input.publishAt ?? null,
        week_label: input.weekLabel ?? null,
        hook: input.hook ?? null,
        script_md: input.scriptMd ?? null,
        notes: input.notes ?? null,
        session_id: input.sessionId ?? null,
        ref_id: input.refId ?? null,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[content] create piece:", error.message);
    return null;
  }
  const piece = rowToPiece(data as Record<string, unknown>);
  emit({
    kind: "task_done",
    taskId: `content-${piece.id}`,
    detail: `pieza de contenido creada: "${piece.title}" (${piece.pillar}, ${piece.status})`,
  });
  return piece;
}

/** Campos editables desde la UI (camelCase → columna). */
export interface UpdatePieceInput {
  title?: string;
  pillar?: ContentPillar;
  platforms?: string[];
  format?: ContentPiece["format"];
  status?: ContentStatus;
  publishAt?: string | null;
  weekLabel?: string | null;
  hook?: string | null;
  scriptMd?: string | null;
  takes?: ContentPiece["takes"];
  editPoints?: ContentPiece["edit_points"];
  /** Crudos + job de edición: los escriben las rutas de content/edit.ts. */
  rawClips?: ContentPiece["raw_clips"];
  editJob?: ContentPiece["edit_job"];
  publications?: ContentPiece["publications"];
  variants?: ContentPiece["variants"];
  notes?: string | null;
  sessionId?: number | null;
  refId?: number | null;
  chatSessionId?: string | null;
  /** Carpeta canónica en el disco extraíble (la escribe content/media.ts). */
  mediaDir?: string | null;
  /** Master verificado en disco (lo sellan media.ts / publish.ts). */
  masterPath?: string | null;
  /** Run de publicación (lo escribe content/publish.ts). */
  publishJob?: ContentPiece["publish_job"];
}

const PIECE_COLUMNS: Record<keyof UpdatePieceInput, string> = {
  title: "title",
  pillar: "pillar",
  platforms: "platforms",
  format: "format",
  status: "status",
  publishAt: "publish_at",
  weekLabel: "week_label",
  hook: "hook",
  scriptMd: "script_md",
  takes: "takes",
  editPoints: "edit_points",
  rawClips: "raw_clips",
  editJob: "edit_job",
  publications: "publications",
  variants: "variants",
  notes: "notes",
  sessionId: "session_id",
  refId: "ref_id",
  chatSessionId: "chat_session_id",
  mediaDir: "media_dir",
  masterPath: "master_path",
  publishJob: "publish_job",
};

export async function updatePiece(
  id: number,
  patch: UpdatePieceInput,
): Promise<ContentPiece | null> {
  if (!supabase) return null;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = { updated_at: now };
  for (const [key, col] of Object.entries(PIECE_COLUMNS) as [keyof UpdatePieceInput, string][]) {
    if (patch[key] !== undefined) row[col] = patch[key];
  }
  // Seguimiento de etapas: solo una transición REAL sella fecha e historial
  // (re-guardar la misma etapa no reinicia el contador de días).
  const before = patch.status !== undefined ? await getPiece(id) : null;
  const moved = before != null && before.status !== patch.status;
  if (moved) {
    row.status_since = now;
    row.stage_history = [...before.stage_history, { status: patch.status, at: now }];
  }
  const { data, error } = await supabase
    .from("content_pieces")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[content] update piece:", error.message);
    return null;
  }
  const piece = rowToPiece(data as Record<string, unknown>);
  // Efectos laterales, nunca bloquean la respuesta. El espejo también corre en
  // transiciones: solo-al-guardar-guion dejaba el `estado:` del vault mintiendo
  // (una pieza publicada figuraba "grabacion" — auditoría 2026-08-10).
  if (patch.scriptMd !== undefined || moved) void mirrorPieceToVault(piece);
  if (moved) {
    emit({
      kind: "task_done",
      taskId: `content-${piece.id}`,
      detail: `"${piece.title}" → ${STAGES[piece.status].label.toLowerCase()}`,
    });
    void syncLinearState(piece);
    // Entrar a "programado" encola las variantes automáticas. Import dinámico
    // porque publish.ts depende de este módulo (mismo truco que edit↔media).
    if (piece.status === "programado") {
      void import("./publish.js")
        .then((m) => m.schedulePublications(piece.id))
        .catch((err) => console.error("[content] encolar publicación:", String(err).slice(0, 160)));
    }
  }
  return piece;
}

export async function getPiece(id: number): Promise<ContentPiece | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("content_pieces").select("*").eq("id", id).maybeSingle();
  return data ? rowToPiece(data as Record<string, unknown>) : null;
}

export async function listPieces(limit = 200): Promise<ContentPiece[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("content_pieces")
    .select("*")
    .order("publish_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  return (data ?? []).map((r) => rowToPiece(r as Record<string, unknown>));
}

// ── Linear ─────────────────────────────────────────────────────────────

const STATUS_TO_LINEAR: Record<
  ContentStatus,
  "backlog" | "unstarted" | "started" | "completed" | "canceled"
> = {
  idea: "backlog",
  guion: "unstarted",
  grabacion: "started",
  edicion: "started",
  programado: "started",
  publicado: "completed",
  descartada: "canceled",
};

/** Refleja el estado local en el issue enlazado (si hay). Nunca lanza. */
async function syncLinearState(piece: ContentPiece): Promise<void> {
  if (!piece.linear_identifier || !linearEnabled()) return;
  try {
    await updateIssueState(piece.linear_identifier, STATUS_TO_LINEAR[piece.status]);
  } catch (err) {
    console.error("[content] sync linear:", String(err).slice(0, 160));
  }
}

/** Crea el issue de la pieza en el proyecto RuloCodeShow (label "contenido"). */
export async function linkPieceToLinear(id: number): Promise<ContentPiece | null> {
  if (!supabase) return null;
  const piece = await getPiece(id);
  if (!piece) return null;
  if (piece.linear_identifier) return piece; // ya enlazada — idempotente
  if (!linearEnabled()) return null;

  const publishLine = piece.publish_at
    ? `\n- **Publica:** ${new Date(piece.publish_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}`
    : "";
  const stage = STAGES[piece.status];
  const pending = stageGates(piece)
    .filter((g) => !g.done)
    .map((g) => g.label);
  const description = [
    `Pieza del Estudio de contenido (tab ESTUDIO de Hermes).`,
    ``,
    `- **Pilar:** ${piece.pillar.toUpperCase()}`,
    `- **Formato:** ${piece.format} · ${piece.platforms.join(", ") || "sin plataforma"}`,
    `- **Etapa:** ${stage.label} — ${stage.meaning}${publishLine}`,
    pending.length ? `- **Falta para avanzar:** ${pending.join(" · ")}` : ``,
    piece.hook ? `- **Hook:** ${piece.hook}` : ``,
  ]
    .filter(Boolean)
    .join("\n");
  const prompt = [
    `Contexto: pieza de contenido de la marca RuloCode (estrategia 2026 en el vault:`,
    `projects/rulocode/docs/estrategia-marca-personal-2026.md; el pipeline de producción`,
    `y las etapas viven en projects/rulocodeshow/).`,
    `Pieza: "${piece.title}" — pilar ${piece.pillar.toUpperCase()}, formato ${piece.format},`,
    `plataformas: ${piece.platforms.join(", ") || "por definir"}.`,
    `Tarea: ayúdame a producirla — afina el guion (hook con retención <3s, estructura,`,
    `CTA único), propone los puntos de edición y los copies por plataforma (el hook se`,
    `reescribe por red, nunca se reusa). El estado y el material viven en el tab ESTUDIO.`,
  ].join(" ");

  try {
    const issue = await createLinearIssue({
      title: `Producir: ${piece.title}`,
      description,
      prompt,
      project: CONTENT_PROJECT_SLUG,
      labels: ["contenido", piece.pillar],
    });
    const updated = await supabase
      .from("content_pieces")
      .update({
        linear_identifier: issue.identifier,
        linear_url: issue.url,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (updated.error) {
      console.error("[content] link linear:", updated.error.message);
      return piece;
    }
    const linked = rowToPiece(updated.data as Record<string, unknown>);
    emit({
      kind: "task_done",
      taskId: `content-${id}`,
      detail: `pieza enlazada a Linear: ${issue.identifier}`,
    });
    // El issue nace en el estado que ya tiene la pieza (p.ej. guion → Todo).
    void syncLinearState(linked);
    return linked;
  } catch (err) {
    console.error("[content] crear issue:", String(err).slice(0, 200));
    return null;
  }
}

// ── Espejo al vault ────────────────────────────────────────────────────

/** Escribe el .md de la pieza en el vault (Obsidian lee, la UI edita). */
async function mirrorPieceToVault(piece: ContentPiece): Promise<void> {
  if (!env.VAULT_PATH) return;
  try {
    const dir = join(env.VAULT_PATH, VAULT_CONTENT_DIR);
    await mkdir(dir, { recursive: true });
    const relative = piece.vault_path ?? join(VAULT_CONTENT_DIR, `${slugify(piece.title)}.md`);
    const frontmatter = {
      tipo: "contenido",
      pieza: piece.title,
      pilar: piece.pillar,
      formato: piece.format,
      plataformas: piece.platforms,
      estado: piece.status,
      etapa_desde: piece.status_since ?? null,
      publica: piece.publish_at ?? null,
      linear: piece.linear_identifier ?? null,
      actualizado: new Date().toISOString().slice(0, 10),
    };
    // La nota del vault también cuenta el seguimiento: en qué etapa va, qué
    // falta para avanzar y por dónde pasó (Obsidian lee, la UI edita).
    const stage = STAGES[piece.status];
    const gates = stageGates(piece)
      .map((g) => `- [${g.done ? "x" : " "}] ${g.label}`)
      .join("\n");
    const history = piece.stage_history
      .map((e) => `${STAGES[e.status].label} (${e.at.slice(0, 10)})`)
      .join(" → ");
    const body = [
      `# ${piece.title}`,
      `\n> [!info] Etapa: ${stage.label}\n> ${stage.meaning}`,
      piece.hook ? `\n## Hook\n\n${piece.hook}` : "",
      `\n## Guion\n\n${piece.script_md ?? "_(sin guion aún)_"}`,
      gates ? `\n## Seguimiento\n\nPara salir de ${stage.label.toLowerCase()}:\n\n${gates}` : "",
      history ? `\nRecorrido: ${history}` : "",
      piece.notes ? `\n## Notas\n\n${piece.notes}` : "",
    ].join("\n");
    await writeFile(join(env.VAULT_PATH, relative), matter.stringify(body, frontmatter), "utf8");
    if (!piece.vault_path && supabase) {
      await supabase.from("content_pieces").update({ vault_path: relative }).eq("id", piece.id);
    }
  } catch (err) {
    console.error("[content] espejo vault:", String(err).slice(0, 160));
  }
}

// ── Sesiones de grabación ──────────────────────────────────────────────

export async function createSession(input: {
  title: string;
  scheduledAt?: string | null;
  checklist?: { label: string; done: boolean }[];
  folder?: string | null;
  notes?: string | null;
}): Promise<ContentSession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("content_sessions")
    .upsert(
      {
        local_key: sha1("csession", input.scheduledAt ?? input.title.toLowerCase()),
        title: input.title.trim(),
        scheduled_at: input.scheduledAt ?? null,
        checklist: input.checklist ?? [],
        folder: input.folder ?? null,
        notes: input.notes ?? null,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[content] create session:", error.message);
    return null;
  }
  return rowToSession(data as Record<string, unknown>);
}

/** Próximo sábado (o hoy si es sábado) a las 9:00 de Bogotá, en ISO. */
function nextSaturdayBogota(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(14, 0, 0, 0); // 9:00 Bogotá (UTC-5)
  return d.toISOString();
}

/**
 * Arma la sesión de grabación DESDE piezas concretas (el botón "armar el
 * batch" de la cola de grabación): checklist = una línea por pieza, y las que
 * están en guion avanzan a grabacion — meterlas al batch ES el compromiso de
 * grabarlas (la transición la dispara este acto humano, no un automatismo).
 */
export async function createSessionFromPieces(input: {
  title?: string;
  scheduledAt?: string | null;
  pieceIds: number[];
}): Promise<{ session: ContentSession | null; pieces: ContentPiece[] }> {
  const pieces: ContentPiece[] = [];
  for (const id of input.pieceIds) {
    const p = await getPiece(id);
    if (p) pieces.push(p);
  }
  if (!pieces.length) return { session: null, pieces: [] };
  const scheduledAt = input.scheduledAt ?? nextSaturdayBogota();
  const session = await createSession({
    title:
      input.title?.trim() ||
      `Batch — ${pieces.length} pieza${pieces.length === 1 ? "" : "s"} lista${pieces.length === 1 ? "" : "s"}`,
    scheduledAt,
    checklist: pieces.map((p) => ({
      label: `Grabar: ${p.title}${p.format !== "vertical" ? ` (${p.format})` : ""}`,
      done: false,
    })),
  });
  if (!session) return { session: null, pieces };
  const updated: ContentPiece[] = [];
  for (const p of pieces) {
    const next = await updatePiece(p.id, {
      sessionId: session.id,
      ...(p.status === "guion" ? { status: "grabacion" as const } : {}),
    });
    updated.push(next ?? p);
  }
  emit({
    kind: "task_done",
    taskId: `content-session-${session.id}`,
    detail: `batch de grabación armado: "${session.title}" (${pieces.length} pieza/s)`,
  });
  return { session, pieces: updated };
}

// ── Replan del calendario ──────────────────────────────────────────────

/** Pauta horaria de la estrategia (UTC): qué día/hora le toca a cada formato. */
const SLOT_RULES: Record<string, { days: number[]; hourUtc: number; minuteUtc: number }> = {
  // Verticales: L-Mi-V 12:30 Bogotá.
  vertical: { days: [1, 3, 5], hourUtc: 17, minuteUtc: 30 },
  otro: { days: [1, 3, 5], hourUtc: 17, minuteUtc: 30 },
  // LinkedIn (post/carrusel): Ma/Ju 8:00 Bogotá.
  post: { days: [2, 4], hourUtc: 13, minuteUtc: 0 },
  carrusel: { days: [2, 4], hourUtc: 13, minuteUtc: 0 },
  // Pilar de YouTube: sábado 10:00 Bogotá.
  pilar: { days: [6], hourUtc: 15, minuteUtc: 0 },
};

/** Lunes de la semana de la fecha (clave para el tope semanal). */
function weekKey(d: Date): string {
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

export interface ReplanChange {
  id: number;
  title: string;
  from: string;
  to: string;
}

/**
 * Re-fecha en UN acto las piezas con la fecha VENCIDA (el calendario
 * aspiracional del lote inicial: 12 vencidas en la auditoría 2026-08-10).
 * Respeta la pauta horaria de la estrategia por formato y un tope de
 * `perWeek` piezas por semana — la cadencia la decide el humano con el botón.
 * Nunca toca piezas publicadas/descartadas ni variantes ya subidas.
 */
export async function replanOverdue(
  input: { perWeek?: number; ids?: number[] } = {},
): Promise<{ changed: ReplanChange[] }> {
  const perWeek = Math.min(7, Math.max(1, input.perWeek ?? 3));
  const now = Date.now();
  const all = await listPieces();
  const targets = all
    .filter((p) => (input.ids ? input.ids.includes(p.id) : true))
    .filter((p) => p.status !== "publicado" && p.status !== "descartada")
    .filter((p) => p.publish_at && new Date(p.publish_at).getTime() < now)
    .filter((p) => !p.publications.some((pub) => pub.remote_id))
    .sort((a, b) => (a.publish_at ?? "").localeCompare(b.publish_at ?? ""));
  if (!targets.length) return { changed: [] };

  const weekCount = new Map<string, number>();
  // Arranca mañana: re-fechar para "hoy en 10 minutos" es volver a mentir.
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() + 1);
  start.setUTCHours(0, 0, 0, 0);

  const changed: ReplanChange[] = [];
  let cursor = new Date(start);
  for (const piece of targets) {
    const rule = SLOT_RULES[piece.format] ?? SLOT_RULES.vertical;
    const slot = new Date(cursor);
    for (;;) {
      const key = weekKey(slot);
      if (rule.days.includes(slot.getUTCDay()) && (weekCount.get(key) ?? 0) < perWeek) break;
      slot.setUTCDate(slot.getUTCDate() + 1);
    }
    slot.setUTCHours(rule.hourUtc, rule.minuteUtc, 0, 0);
    weekCount.set(weekKey(slot), (weekCount.get(weekKey(slot)) ?? 0) + 1);
    const updated = await updatePiece(piece.id, { publishAt: slot.toISOString() });
    if (updated)
      changed.push({
        id: piece.id,
        title: piece.title,
        from: piece.publish_at as string,
        to: slot.toISOString(),
      });
    // La siguiente pieza busca desde el día siguiente: mantiene el orden y
    // reparte la semana en vez de apilar todo el mismo día.
    cursor = new Date(slot);
    cursor.setUTCHours(0, 0, 0, 0);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (changed.length)
    emit({
      kind: "task_done",
      taskId: "content-replan",
      detail: `calendario re-fechado: ${changed.length} pieza(s) vencida(s) reprogramada(s)`,
    });
  return { changed };
}

export async function updateSession(
  id: number,
  patch: {
    title?: string;
    scheduledAt?: string | null;
    status?: ContentSession["status"];
    checklist?: { label: string; done: boolean }[];
    folder?: string | null;
    notes?: string | null;
  },
): Promise<ContentSession | null> {
  if (!supabase) return null;
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title;
  if (patch.scheduledAt !== undefined) row.scheduled_at = patch.scheduledAt;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.checklist !== undefined) row.checklist = patch.checklist;
  if (patch.folder !== undefined) row.folder = patch.folder;
  if (patch.notes !== undefined) row.notes = patch.notes;
  const { data, error } = await supabase
    .from("content_sessions")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[content] update session:", error.message);
    return null;
  }
  return rowToSession(data as Record<string, unknown>);
}

// ── Radar ──────────────────────────────────────────────────────────────

/** Título/canal REALES de un link de YouTube (oEmbed público, sin API key). */
async function resolveOEmbed(url: string): Promise<{ title: string; author: string | null } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: AbortSignal.timeout(6_000) },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { title?: string; author_name?: string };
    return j.title ? { title: j.title, author: j.author_name ?? null } : null;
  } catch {
    return null;
  }
}

export async function saveRef(input: {
  kind: ContentRef["kind"];
  /** Opcional si viene `url`: el título real se resuelve por oEmbed. */
  title?: string;
  body?: string | null;
  metric?: string | null;
  source?: string | null;
  url?: string | null;
  applyStatus?: ContentRef["apply_status"];
  pillar?: ContentPillar | null;
}): Promise<ContentRef | null> {
  if (!supabase) return null;
  const url = input.url?.trim() || null;
  let title = input.title?.trim() ?? "";
  let source = input.source ?? null;
  // Pegar el link basta (patrón Pinterest/Patreon): título y canal salen de la
  // plataforma — dato real, no un "Video de YouTube" decorativo.
  if (url && (!title || !source) && youtubeVideoId(url)) {
    const meta = await resolveOEmbed(url);
    if (meta) {
      title ||= meta.title;
      source ??= meta.author;
    }
  }
  if (!title) title = url ?? "";
  if (!title) return null;
  const { data, error } = await supabase
    .from("content_refs")
    .upsert(
      {
        local_key: sha1("ref", input.kind, title.toLowerCase()),
        kind: input.kind,
        title,
        body: input.body ?? null,
        metric: input.metric ?? null,
        source,
        url,
        apply_status: input.applyStatus ?? null,
        pillar: input.pillar ?? null,
      },
      { onConflict: "local_key" },
    )
    .select()
    .single();
  if (error) {
    console.error("[content] save ref:", error.message);
    return null;
  }
  return rowToRef(data as Record<string, unknown>);
}

/** Edición fina de una referencia (detalle del radar). */
export async function updateRef(
  id: number,
  patch: {
    kind?: ContentRef["kind"];
    title?: string;
    body?: string | null;
    metric?: string | null;
    source?: string | null;
    url?: string | null;
    applyStatus?: ContentRef["apply_status"];
    pillar?: ContentPillar | null;
  },
): Promise<ContentRef | null> {
  if (!supabase) return null;
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.body !== undefined) row.body = patch.body;
  if (patch.metric !== undefined) row.metric = patch.metric;
  if (patch.source !== undefined) row.source = patch.source;
  if (patch.url !== undefined) row.url = patch.url?.trim() || null;
  if (patch.applyStatus !== undefined) row.apply_status = patch.applyStatus;
  if (patch.pillar !== undefined) row.pillar = patch.pillar;
  // El local_key se recalcula con el título nuevo para no romper la idempotencia
  // del seed (kind|title es su identidad).
  if (patch.title !== undefined || patch.kind !== undefined) {
    const current = await supabase.from("content_refs").select("kind,title").eq("id", id).maybeSingle();
    const kind = patch.kind ?? (current.data?.kind as ContentRef["kind"]) ?? "guardada";
    const title = (patch.title ?? String(current.data?.title ?? "")).trim();
    row.local_key = sha1("ref", kind, title.toLowerCase());
  }
  const { data, error } = await supabase
    .from("content_refs")
    .update(row)
    .eq("id", id)
    .select()
    .single();
  if (error) {
    console.error("[content] update ref:", error.message);
    return null;
  }
  return rowToRef(data as Record<string, unknown>);
}

export async function deleteRef(id: number): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("content_refs").delete().eq("id", id);
  if (error) {
    console.error("[content] delete ref:", error.message);
    return false;
  }
  return true;
}

// ── Board (un solo poll para toda la vista) ────────────────────────────

export async function contentBoard(): Promise<ContentBoard> {
  if (!supabase) return { available: false, pieces: [], sessions: [], refs: [] };
  const [pieces, sessions, refs] = await Promise.all([
    listPieces(),
    supabase
      .from("content_sessions")
      .select("*")
      .order("scheduled_at", { ascending: false })
      .limit(10)
      .then(({ data }) => (data ?? []).map((r) => rowToSession(r as Record<string, unknown>))),
    supabase
      .from("content_refs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(60)
      .then(({ data }) => (data ?? []).map((r) => rowToRef(r as Record<string, unknown>))),
  ]);
  return { available: true, pieces, sessions, refs };
}

// ── Helpers ────────────────────────────────────────────────────────────

function rowToPiece(r: Record<string, unknown>): ContentPiece {
  return {
    id: Number(r.id),
    title: String(r.title),
    pillar: (r.pillar as ContentPillar) ?? "p1",
    platforms: Array.isArray(r.platforms) ? r.platforms.map(String) : [],
    format: (r.format as ContentPiece["format"]) ?? "vertical",
    status: (r.status as ContentStatus) ?? "idea",
    status_since: r.status_since ? String(r.status_since) : null,
    stage_history: Array.isArray(r.stage_history) ? (r.stage_history as ContentStageEntry[]) : [],
    publish_at: r.publish_at ? String(r.publish_at) : null,
    week_label: r.week_label ? String(r.week_label) : null,
    hook: r.hook ? String(r.hook) : null,
    script_md: r.script_md ? String(r.script_md) : null,
    takes: Array.isArray(r.takes) ? (r.takes as ContentPiece["takes"]) : [],
    edit_points: Array.isArray(r.edit_points)
      ? (r.edit_points as ContentPiece["edit_points"])
      : [],
    raw_clips: Array.isArray(r.raw_clips) ? (r.raw_clips as ContentPiece["raw_clips"]) : [],
    edit_job: r.edit_job ? (r.edit_job as ContentPiece["edit_job"]) : null,
    master_path: r.master_path ? String(r.master_path) : null,
    publish_job: r.publish_job ? (r.publish_job as ContentPiece["publish_job"]) : null,
    // Las variantes viejas (anteriores a la migración 021) no traen el estado
    // de máquina: se leen como 'manual', que es lo que realmente eran.
    publications: Array.isArray(r.publications)
      ? (r.publications as Partial<ContentPublication>[]).map(normalizePublication)
      : [],
    variants: Array.isArray(r.variants) ? (r.variants as ContentPiece["variants"]) : [],
    linear_identifier: r.linear_identifier ? String(r.linear_identifier) : null,
    linear_url: r.linear_url ? String(r.linear_url) : null,
    session_id: r.session_id == null ? null : Number(r.session_id),
    ref_id: r.ref_id == null ? null : Number(r.ref_id),
    vault_path: r.vault_path ? String(r.vault_path) : null,
    media_dir: r.media_dir ? String(r.media_dir) : null,
    notes: r.notes ? String(r.notes) : null,
    created_at: String(r.created_at),
    updated_at: String(r.updated_at ?? r.created_at),
  };
}

/**
 * Rellena una variante con los campos de publicación (migración 021). Se aplica
 * al LEER para que una fila vieja nunca llegue a la UI con `undefined` — el
 * default es 'manual' porque es lo que era antes de que existiera el automático.
 */
function normalizePublication(p: Partial<ContentPublication>): ContentPublication {
  const platform = (p.platform ?? "tiktok") as ContentPublication["platform"];
  return {
    id: String(p.id ?? Math.random().toString(36).slice(2, 9)),
    platform,
    title: p.title ?? null,
    copy: p.copy ?? null,
    scheduled_at: p.scheduled_at ?? null,
    status: p.status ?? "borrador",
    provider: p.provider ?? PLATFORM_PROVIDER[platform] ?? "manual",
    publish_state: p.publish_state ?? (p.status === "publicada" ? "manual" : "pendiente"),
    remote_id: p.remote_id ?? null,
    remote_url: p.remote_url ?? null,
    attempts: p.attempts ?? 0,
    last_attempt_at: p.last_attempt_at ?? null,
    last_error: p.last_error ?? null,
  };
}

function rowToSession(r: Record<string, unknown>): ContentSession {
  return {
    id: Number(r.id),
    title: String(r.title),
    scheduled_at: r.scheduled_at ? String(r.scheduled_at) : null,
    status: (r.status as ContentSession["status"]) ?? "planeada",
    checklist: Array.isArray(r.checklist)
      ? (r.checklist as { label: string; done: boolean }[])
      : [],
    folder: r.folder ? String(r.folder) : null,
    notes: r.notes ? String(r.notes) : null,
    created_at: String(r.created_at),
  };
}

function rowToRef(r: Record<string, unknown>): ContentRef {
  return {
    id: Number(r.id),
    kind: (r.kind as ContentRef["kind"]) ?? "guardada",
    title: String(r.title),
    body: r.body ? String(r.body) : null,
    metric: r.metric ? String(r.metric) : null,
    source: r.source ? String(r.source) : null,
    url: r.url ? String(r.url) : null,
    apply_status: (r.apply_status as ContentRef["apply_status"]) ?? null,
    pillar: (r.pillar as ContentPillar | null) ?? null,
    created_at: String(r.created_at),
  };
}

// ── Chat por pieza (migración 018) ──────────────────────────────────────

/** Historial del chat de una pieza, en orden cronológico. */
export async function listChatMessages(
  pieceId: number,
  limit = 80,
): Promise<ContentChatMessage[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("content_chat_messages")
    .select("*")
    .eq("piece_id", pieceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .reverse()
    .map((r: Record<string, unknown>) => ({
      id: Number(r.id),
      role: r.role as ContentChatMessage["role"],
      content: String(r.content),
      created_at: String(r.created_at),
    }));
}

export async function appendChatMessage(
  pieceId: number,
  role: ContentChatMessage["role"],
  content: string,
): Promise<void> {
  if (!supabase || !content.trim()) return;
  const { error } = await supabase
    .from("content_chat_messages")
    .insert({ piece_id: pieceId, role, content });
  if (error) console.error("[content] chat append:", error.message);
}

/** Sesión SDK del chat de la pieza (para resumir la conversación). */
export async function getChatSessionId(pieceId: number): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase
    .from("content_pieces")
    .select("chat_session_id")
    .eq("id", pieceId)
    .maybeSingle();
  return data?.chat_session_id ? String(data.chat_session_id) : null;
}

export async function setChatSessionId(pieceId: number, sessionId: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("content_pieces").update({ chat_session_id: sessionId }).eq("id", pieceId);
}
