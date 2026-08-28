// Tipos compartidos entre el agent server (apps/agent) y el dashboard (apps/web).

export type MemoryType =
  | "user"
  | "feedback"
  | "project"
  | "reference"
  | "daily"
  | "agent";

export interface Memory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string | null;
  project_slug: string | null;
  tags: string[];
  importance: number;
  source: string;
  machine: string | null;
  created_at: string;
}

/** Fuente de un resultado de la base de conocimiento unificada (RPC match_knowledge). */
export type KnowledgeSource =
  | "memory"
  | "meeting"
  | "execution"
  | "conversation"
  | "vault";

/** Un hit de búsqueda semántica cross-fuente: memorias, reuniones, ejecuciones,
 *  conversaciones (texto/voz) y notas del vault. */
export interface KnowledgeHit {
  source: KnowledgeSource;
  /** Ancla dentro de su fuente: uuid de memoria, meeting_id, execution_id, id de mensaje o path del vault. */
  ref: string;
  title: string;
  content: string;
  project_slug: string | null;
  created_at: string;
  similarity: number | null;
  score: number | null;
}

export interface ProjectStatus {
  slug: string;
  name: string;
  estado: string;
  rama?: string;
  ruta_local?: string;
  estado_actual: string;
  tareas_pendientes: string[];
  actualizado?: string;
}

/**
 * Un documento .md del vault resuelto desde una referencia (wikilink `[[nombre]]`
 * o ruta `docs/x.md`). Lo consume el visor tipo Notion del dashboard.
 */
export interface VaultDoc {
  found: boolean;
  /** La referencia original tal cual venía en el texto. */
  ref: string;
  /** Nombre del archivo sin extensión (basename). */
  name?: string;
  /** Título legible: frontmatter `proyecto`/`title` o el basename. */
  title?: string;
  /** Ruta relativa al vault, para el breadcrumb. */
  path?: string;
  /** Cuerpo markdown ya sin frontmatter. */
  markdown?: string;
  /** Fecha de `actualizado` del frontmatter, si existe. */
  updated?: string;
}

/** Resumen de un chat archivado de la consola (historial de chats). */
export interface ChatSummary {
  id: string;
  /** primer mensaje del usuario, recortado (título del chat). */
  title: string;
  /** fecha ISO del último mensaje. */
  ts: string;
  /** cantidad de mensajes. */
  messages: number;
}

// ── Sesiones de la consola leídas DIRECTO de ~/.claude/projects ────────
// (la misma fuente que ve `claude` abierto en Cursor dentro del repo)

/** Mensaje de texto de una sesión (user/assistant, sin tools ni thinking). */
export interface ChatSessionMessage {
  role: "user" | "assistant";
  content: string;
}

/** Resumen de una sesión de Claude para el historial/tabs de la consola. */
export interface ChatSessionSummary {
  /** uuid de la sesión (= nombre del .jsonl; sirve para resume). */
  id: string;
  title: string;
  /** última actividad (ISO, del mtime del archivo). */
  updatedAt: string;
  /** nº de mensajes de texto user+assistant. */
  messages: number;
}

/** Detalle de una sesión: sus mensajes de texto en orden. */
export interface ChatSessionDetail extends ChatSessionSummary {
  transcript: ChatSessionMessage[];
}

/** Una skill del proyecto, leída de .claude/skills/<name>/SKILL.md. */
export interface ProjectSkill {
  name: string;
  description: string;
}

/** Un server MCP declarado en el .mcp.json del proyecto. */
export interface ProjectMcpServer {
  name: string;
  /** stdio | http | sse | unknown — inferido de la config. */
  kind: string;
  /** command o url resumidos, como pista de qué es. */
  detail?: string;
  /** ¿habilitado explícitamente en settings? (undefined = sin dato). */
  enabled?: boolean;
}

/** Estado git real del repo local del proyecto (panel Versión del dashboard). */
export interface ProjectGit {
  /** rama actual (HEAD). */
  rama: string;
  /** hash corto del último commit. */
  commit: string;
  /** primera línea del mensaje del último commit (título). */
  mensaje: string;
  /** cuerpo del mensaje del commit (descripción); "" si no tiene. */
  descripcion: string;
  /** fecha del último commit (epoch ms). */
  commitAt: number;
  /** archivos con cambios sin commitear (git status --porcelain). */
  archivosCambiados: number;
}

/**
 * Contexto operativo de un proyecto: qué skills, MCP, herramientas y comandos
 * tiene su repo local (leído de ruta_local/.claude + .mcp.json). Lo consume el
 * panel de contexto del dashboard cuando se enfoca un proyecto.
 */
export interface ProjectContext {
  slug: string;
  ruta_local: string | null;
  /** ¿se pudo leer el repo local? (la ruta existe). */
  found: boolean;
  rama?: string;
  /** estado git del repo; null si la ruta no es un repo git. */
  git?: ProjectGit | null;
  hasClaudeMd: boolean;
  skills: ProjectSkill[];
  mcpServers: ProjectMcpServer[];
  /** permissions.allow (merge de settings.json + settings.local.json). */
  allowTools: string[];
  denyTools: string[];
  /** slash-commands en .claude/commands. */
  commands: string[];
}

/** Una línea del transcript de una corrida `claude -p` (stream-json → HUD). */
export interface ClaudeSessionLine {
  t: number;
  kind: string;
  text: string;
}

/** Campos comunes de una sesión de Claude Code (CLI) persistida por proyecto. */
export interface ClaudeSessionMeta {
  /** Id estable de la sesión (uuid, = --session-id del CLI). */
  id: string;
  projectSlug: string;
  title: string;
  model: string;
  status: "running" | "done" | "error";
  createdAt: string;
  updatedAt: string;
}

/** Resumen para la lista de sesiones (con conteo de líneas del transcript). */
export interface ClaudeSessionSummary extends ClaudeSessionMeta {
  lineCount: number;
}

/**
 * Resumen en vivo de un run de Claude Code (proceso `claude -p` en curso o
 * recién terminado). Lo consume el panel Orquestador para listar todo lo que
 * está corriendo en todos los proyectos a la vez (endpoint GET /claude/runs).
 */
export interface ClaudeRunSummary {
  /** Id de la corrida (run.id, corto). */
  id: string;
  /** Id estable de la sesión Hermes (para reabrir su stream/terminal). */
  sessionId: string;
  projectSlug: string;
  /** Prompt recortado, como etiqueta de la fila. */
  title: string;
  status: "running" | "done" | "error";
  startedAt: string;
  model: string;
  effort: string;
  /** Nº de tool_use vistos en el transcript hasta ahora. */
  toolCalls: number;
  exitCode?: number;
  /** Costo real del run en USD (del evento result del CLI); solo al terminar. */
  costUsd?: number;
  /** Duración reportada por el CLI en ms; solo al terminar. */
  durationMs?: number;
  /** Nº de turnos del run; solo al terminar. */
  numTurns?: number;
  /** Tokens del evento result del CLI; solo al terminar. */
  usage?: RunTokenUsage;
  /** Último texto del asistente (recortado) como preview del resultado. */
  lastText?: string;
}

/** Tokens del evento result del CLI (por run y acumulado diario). */
export interface RunTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Acumulado de gasto del día en runs de Claude Code (GET /stats). */
export interface DailyRunUsage {
  /** Suma de total_cost_usd de los runs terminados hoy. */
  costUsd: number;
  /** Nº de runs terminados hoy. */
  runs: number;
  /** Suma de tokens de los runs de hoy (opcional: archivos viejos no lo traen). */
  tokens?: RunTokenUsage;
}

/** Detalle completo de una sesión de Claude Code, con su transcript. */
export interface ClaudeSessionDetail extends ClaudeSessionMeta {
  effort: string;
  permissionMode: string;
  cwd: string;
  /** Id de sesión del SDK/CLI a usar con `claude --resume` (sigue al último fork). */
  sdkSessionId: string;
  lines: ClaudeSessionLine[];
}

/** Evento del bus de actividad del agente (SSE /events + tabla agent_activity). */
export interface AgentActivityEvent {
  kind:
    | "task_start"
    | "tool_call"
    | "tool_result"
    | "text"
    | "task_done"
    | "error"
    | "session_start"
    | "meeting_live"
    | "gestures"
    | "browser"
    | "lights";
  taskId?: string;
  sessionId?: string;
  toolName?: string;
  detail?: string;
  machine?: string;
  ts: string;
}

/**
 * Paso agéntico de UN turno de la consola. Viaja en el frame `hermes.tool` del
 * SSE de /v1/chat/completions — así queda correlacionado con SU request (el bus
 * global /events no distingue de qué tab salió cada tool_call).
 */
export interface ChatToolStep {
  /** Nombre crudo de la tool del SDK (Read, Grep, mcp__hermes__save_memory…). */
  name: string;
  /** Objetivo extraído del input (ruta, patrón, query…); vacío si no aplica. */
  target?: string;
}

export type TaskStatus = "running" | "done" | "error";

export interface HermesTask {
  id: string;
  prompt: string;
  status: TaskStatus;
  /** Resumen final (último texto del asistente) cuando status === done. */
  result?: string;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  toolCalls: number;
}

export interface SystemVitals {
  memories: number;
  activeProjects: number;
  sessionsToday: number;
  tasksToday: number;
  machine: string;
  uptimeSeconds: number;
  supabase: boolean;
}

// ── Reuniones / Juntas por proyecto ────────────────────────────────────
// Una reunión vive como markdown en el vault (projects/<slug>/reuniones/) y se
// espeja en Supabase (meetings + meeting_actionables) para búsqueda semántica.

/** Cómo entró la reunión al sistema. */
export type MeetingSource = "audio" | "upload" | "paste" | "live";

/** Estado de un accionable extraído de una reunión. */
export type ActionableStatus = "pending" | "running" | "done" | "dismissed";

/** Un accionable puntual sacado de la reunión (siempre son 2 por reunión). */
export interface MeetingActionable {
  /** id estable `<meetingId>#<idx>` — ancla para triar. */
  id: string;
  /** índice 0/1 dentro de la reunión. */
  idx: number;
  title: string;
  /** resumen de una línea del accionable. */
  one_liner: string;
  /** prompt listo para arrancar la ejecución con `claude -p` en el repo. */
  exec_prompt: string;
  /** id de la tarea creada al triar (null/undefined = aún sin decidir). */
  taskId?: number | null;
  /** estado de esa tarea (solo si ya se trió). */
  status?: ActionableStatus | null;
  /** run de Claude Code lanzado (si se ejecutó). */
  run_id?: string | null;
  /** issue de Linear creado por el triage Linear-first (RUL-x + URL). */
  linear_identifier?: string | null;
  linear_url?: string | null;
}

// ── Tareas (tracker de misión por proyecto) ────────────────────────────
// Tarea de primera clase con ciclo de vida. Verdad del ESTADO en Supabase
// (tabla `tasks`); espejo humano en "## Tareas Pendientes" de la nota del vault.

/** pending=por hacer · running=ejecutando · done=hecha · dismissed=ignorada.
 *  (distinto de TaskStatus, que es el estado de las HermesTask async del SDK). */
export type TaskState = ActionableStatus;

/** De dónde salió la tarea. */
export type TaskSource = "meeting" | "manual" | "vault" | "voice";

export interface Task {
  id: number;
  project_slug: string;
  title: string;
  detail?: string | null;
  /** prompt para ejecutar la tarea con `claude -p` (si aplica). */
  exec_prompt?: string | null;
  status: TaskState;
  source: TaskSource;
  /** procedencia: id de la reunión y del accionable (si source=meeting). */
  meeting_id?: string | null;
  meeting_idx?: number | null;
  /** run/sesión de Claude Code al ejecutar. */
  run_id?: string | null;
  session_id?: string | null;
  created_at: string;
  updated_at?: string | null;
  done_at?: string | null;
}

// ── Ejecuciones de tareas (memoria de Control de Misión) ───────────────
// Cada Ejecutar/Continuar de una tarea genera un documento {prompt · análisis ·
// resultado}. Verdad = markdown en el vault (projects/<slug>/ejecuciones/<id>.md);
// espejo en Supabase (tabla task_executions). NO confundir con ClaudeRunSummary,
// que es el run EFÍMERO en memoria; esto es su contraparte DURABLE y curada.

/** Cómo se lanzó la corrida: nueva (Ejecutar) o resume (Continuar). */
export type TaskExecutionKind = "execute" | "continue";

/** Resultado de la corrida: cerró bien (done) o falló/cancelada (error). */
export type TaskExecutionStatus = "done" | "error";

/** Fila de historial: lo mínimo para listar las ejecuciones de una tarea. */
export interface TaskExecutionSummary {
  /** id = nombre del archivo del vault sin `.md` (ancla para abrir el detalle). */
  id: string;
  task_id: number | null;
  project_slug: string;
  kind: TaskExecutionKind;
  status: TaskExecutionStatus;
  /** primeras líneas del resultado, como preview de la fila. */
  result_snippet: string;
  cost_usd?: number | null;
  duration_ms?: number | null;
  created_at: string;
}

/** Documento completo de una ejecución (prompt + análisis + resultado + markdown). */
export interface TaskExecution extends TaskExecutionSummary {
  run_id: string | null;
  session_id: string | null;
  /** prompt de intención que se envió (exec_prompt o el de continuar). */
  prompt: string;
  /** narrativa del pase LLM + trace de pasos/herramientas. */
  analysis: string;
  /** resultado final (último texto del asistente, sin recorte). */
  result: string;
  /** documento markdown completo, listo para renderizar. */
  markdown: string;
  model: string;
  effort: string;
  num_turns?: number | null;
  machine?: string | null;
  /** ruta absoluta del .md en el vault. */
  vault_path?: string | null;
  finished_at?: string | null;
}

/** Fila de historial: lo mínimo para listar reuniones de un proyecto. */
export interface MeetingSummary {
  /** id = nombre del archivo sin `.md` (ej: 2026-07-07-1830-kickoff). */
  id: string;
  project_slug: string;
  title: string;
  /** fecha ISO de la reunión. */
  fecha: string;
  source: MeetingSource;
  stt_provider?: string | null;
  duracion_min?: number | null;
  /** cuántos accionables tiene (normalmente 2). */
  accionables_count: number;
}

/** Detalle completo de una reunión (resumen + accionables + transcripción). */
/** Evaluación de desempeño post-junta (LLM sobre el transcript + métricas reales). */
export interface MeetingPerformance {
  /** 1-10. */
  score: number;
  highlights: string[];
  improvements: string[];
}

/** Coach de una junta EN VIVO: métricas reales + evaluación (si hubo selfSpeaker). */
export interface MeetingCoach {
  metrics: LiveCoachMetrics;
  performance?: MeetingPerformance;
}

export interface Meeting extends MeetingSummary {
  summary: string;
  transcript: string;
  actionables: MeetingActionable[];
  participantes?: string[];
  /** ruta absoluta del archivo en el vault. */
  vault_path?: string;
  /** Solo juntas EN VIVO con coach activo. */
  coach?: MeetingCoach;
}

// ── Junta EN VIVO (copiloto de reuniones en tiempo real) ───────────────
// El browser captura el mic (PCM16 16kHz mono) y lo sube por WS al agente,
// que hace proxy al STT streaming (AssemblyAI) y corre el loop de sugerencias.
// Al terminar, la sesión entra al pipeline batch existente (ingestMeeting).

/** Estado de la sesión en vivo (server-side; `suggesting` va como flag aparte). */
export type LiveMeetingStatus =
  | "connecting"
  | "live"
  | "stopping"
  | "ingesting"
  | "done"
  | "error";

/** Un turno de habla diarizado. Los parciales se upsertean por `id`. */
export interface LiveSegment {
  /** `${epoch}-${turn_order}` — estable incluso tras reconexión del provider. */
  id: string;
  /** Label del provider: "A".."J" | "UNKNOWN". El nombre visible sale de speakerNames. */
  speaker: string;
  text: string;
  /** ms desde el inicio de la junta (con offset acumulado de reconexiones). */
  startMs: number;
  endMs: number;
  final: boolean;
}

/** decir=dilo ya · preguntar=pregunta que destraba · dato=dato del contexto · rumbo=re-encauzar. */
export type LiveSuggestionKind = "decir" | "preguntar" | "dato" | "rumbo";

/** Una sugerencia del copiloto durante la junta. */
export interface LiveSuggestion {
  id: string;
  kind: LiveSuggestionKind;
  /** lista para decirse en voz alta (1-2 frases). */
  text: string;
  /** por qué ahora, en una línea. */
  why: string;
  /** ms desde el inicio de la junta cuando se generó. */
  atMs: number;
  /** true si salió del botón "soplar ahora". */
  manual?: boolean;
  /** "fast" = capa rápida (pregunta detectada, streaming) · ausente/"deep" = loop estratégico. */
  source?: "fast" | "deep";
}

/** Estado del enlace con el proveedor de STT streaming. */
export type LiveSttState = "connected" | "reconnecting" | "degraded";

/** Métricas del coach por hablante — SOLO computadas del transcript real. */
export interface LiveSpeakerStats {
  /** ms hablados (suma de duración de sus segmentos finales). */
  talkMs: number;
  words: number;
  /** Palabras por minuto sobre su tiempo hablado. */
  wpm: number;
  /** Muletillas contadas por regex es/en (este, o sea, um, like…). */
  fillers: number;
}

export interface LiveCoachMetrics {
  /** ms desde el inicio de la junta al momento del cómputo. */
  atMs: number;
  bySpeaker: Record<string, LiveSpeakerStats>;
  selfSpeaker?: string;
}

/** Fuente de audio de la junta: sala física (mic) o llamada remota (mic + pestaña). */
export type LiveAudioMode = "presencial" | "remoto";

/** Idioma de las sugerencias: auto = el idioma de la pregunta/última intervención. */
export type LiveSuggestionLang = "auto" | "es" | "en";

/** Foto completa de la sesión (respuesta REST y evento `hello` del WS). */
export interface LiveMeetingSnapshot {
  id: string;
  project: string;
  title?: string;
  status: LiveMeetingStatus;
  suggesting: boolean;
  /** ISO — los timers del front derivan localmente. */
  startedAt: string;
  segments: LiveSegment[];
  /** "A" → "Carlos" (vacío = "Hablante N" por orden de aparición). */
  speakerNames: Record<string, string>;
  suggestions: LiveSuggestion[];
  sttState: LiveSttState;
  /** id de la reunión creada (cuando status === done). */
  meetingId?: string;
  error?: string;
  /** Ausente en snapshots viejos = "presencial". */
  mode?: LiveAudioMode;
  /** Bias de idioma del STT con el que arrancó la junta (p.ej. ["es","en"]). */
  languages?: string[];
  /** Label del hablante que es el dueño ("A".."J") — la capa rápida no le responde a él. */
  selfSpeaker?: string;
  suggestionLang?: LiveSuggestionLang;
  /** true si la capa rápida (sugerencias streaming) está activa en esta sesión. */
  fastCopilot?: boolean;
}

/** Protocolo WS browser→agente (los frames binarios son audio PCM16LE 16kHz mono de ~100ms). */
export type LiveClientMessage =
  | { type: "stop" }
  | { type: "rename"; speaker: string; name: string }
  | { type: "suggest_now" }
  | { type: "mark_self"; speaker: string };

/** Protocolo WS agente→browser (siempre JSON). */
export type LiveServerEvent =
  | { type: "hello"; session: LiveMeetingSnapshot }
  | { type: "status"; status: LiveMeetingStatus; detail?: string }
  | { type: "suggesting"; inFlight: boolean }
  | { type: "transcript_partial"; segment: LiveSegment }
  | { type: "transcript_final"; segment: LiveSegment }
  | { type: "speakers_renamed"; speakerNames: Record<string, string> }
  | { type: "speaker_revision"; changes: { segmentId: string; speaker: string }[] }
  | { type: "suggestion"; suggestion: LiveSuggestion }
  // Capa rápida: la sugerencia llega streameada (start → deltas acumulables →
  // done con la LiveSuggestion final, o aborted si la pisó un trigger nuevo).
  | { type: "suggestion_start"; id: string; kind: LiveSuggestionKind; trigger: string; atMs: number }
  | { type: "suggestion_delta"; id: string; text: string }
  | { type: "suggestion_done"; suggestion: LiveSuggestion }
  | { type: "suggestion_aborted"; id: string }
  | { type: "self_marked"; speaker?: string }
  | { type: "coach_metrics"; metrics: LiveCoachMetrics }
  | { type: "stt_status"; state: LiveSttState; detail?: string }
  | { type: "stop_ack" }
  | { type: "done"; meetingId: string; title: string }
  | { type: "error"; message: string; fatal: boolean }
  | { type: "ping"; ts: number };

// ── Finanzas personales ────────────────────────────────────────────────
// Registro de gastos/ingresos dictados por voz/chat, categorizados por el LLM.
// Supabase-first (tabla `transactions` + `budgets`), sin espejo en vault.

/**
 * Set canónico de categorías — ÚNICA fuente de verdad: lo importan el Zod de
 * las tools del SDK y el JSON Schema de las tools de ElevenLabs (sin drift).
 * La DB no tiene CHECK: ampliar aquí no requiere migración.
 */
export const FINANCE_CATEGORIES = [
  // gastos
  "mercado",
  "restaurantes",
  "transporte",
  "vivienda",
  "servicios",
  "salud",
  "entretenimiento",
  "suscripciones",
  "ropa",
  "educacion",
  "viajes",
  "regalos",
  "mascotas",
  "otros",
  // ingresos
  "salario",
  "freelance",
  "inversiones",
  "otros_ingreso",
] as const;
export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export type TransactionKind = "expense" | "income";

/** COP default; USD solo cuando se dice explícito ("350 dólares"). */
export type Currency = "COP" | "USD";

export interface Transaction {
  id: number;
  kind: TransactionKind;
  /** numeric de Postgres llega como string del cliente → el store normaliza a number. */
  amount: number;
  currency: Currency;
  category: string;
  /** opcional: 'bancolombia', 'efectivo', 'tc'. */
  account?: string | null;
  /** lo que se dijo: "el súper". */
  note?: string | null;
  /** YYYY-MM-DD en America/Bogota. */
  occurred_on: string;
  source: string;
  created_at: string;
  /** soft-delete: anulada por corrección ("bórrala"). */
  voided_at?: string | null;
}

export interface Budget {
  id: number;
  category: string;
  monthly_limit: number;
  currency: Currency;
}

/** Gasto del mes en una categoría, cruzado con su presupuesto (si existe). */
export interface CategorySummary {
  category: string;
  spent: number;
  budget: number | null;
  /** spent/budget; null sin presupuesto. */
  pct: number | null;
  count: number;
}

/** Ingreso del mes en una categoría (los ingresos no llevan presupuesto). */
export interface IncomeCategorySummary {
  category: string;
  amount: number;
  count: number;
}

/** Tasa USD→COP vigente (GET /finance/fx) — para combinar saldos en la UI. */
export interface FxRate {
  /** COP por 1 USD. */
  usd_cop: number;
  /** fecha de la tasa según la fuente. */
  as_of: string;
}

/** Tasa usada por el resumen combinado para convertir la otra moneda. */
export interface FxInfo {
  /** COP por 1 USD. */
  usd_cop: number;
  /** fecha de la tasa según la fuente. */
  as_of: string;
  /** nº de movimientos convertidos desde la otra moneda. */
  converted_count: number;
}

/**
 * Resumen mensual. Por defecto una sola moneda; con `combined` suma AMBAS
 * convirtiendo la otra a `currency` con la TRM real (`fx` presente solo si
 * hubo movimientos convertidos).
 */
export interface FinanceSummary {
  /** YYYY-MM. */
  month: string;
  currency: Currency;
  income: number;
  expense: number;
  net: number;
  by_category: CategorySummary[];
  income_by_category: IncomeCategorySummary[];
  /** pct >= 0.8 o proyección al ritmo del mes > límite. */
  budgets_at_risk: CategorySummary[];
  tx_count: number;
  fx?: FxInfo | null;
}

// ── Hábitos y metas (desarrollo personal) ──────────────────────────────
// Hábitos daily/weekly con check-ins idempotentes (1 por hábito/día) y racha
// calculada en el agente; metas con progreso numérico o milestones.

export type HabitCadence = "daily" | "weekly";

// ── Práctica de inglés (tutor de voz ElevenLabs) ───────────────────────
// Sesiones de conversación con el tutor + vocabulario con repaso espaciado.

export interface EnglishError {
  /** Lo que dijo el dueño (textual o cercano). */
  quote: string;
  /** La forma corregida en inglés. */
  correction: string;
  /** Explicación corta de la regla, en español. */
  note_es?: string;
}

export interface EnglishSession {
  id: number;
  started_at: string;
  duration_sec: number | null;
  topics: string[];
  /** Fluidez percibida por el tutor, 1-5. */
  fluency: number | null;
  errors: EnglishError[];
  wins: string[];
  /** Reporte post-sesión en markdown (análisis en español). */
  report_md: string | null;
  report_status: "pending" | "running" | "done" | "skipped" | "error";
  /** web | mobile | meeting (sesión pasiva desde una junta en inglés). */
  source: string;
}

export interface VocabEntry {
  id: number;
  term: string;
  meaning_es: string;
  example: string | null;
  times_reviewed: number;
  last_reviewed_at: string | null;
  /** true tras ≥3 repasos: sale de la cola de repaso. */
  learned: boolean;
}

export interface Habit {
  id: number;
  name: string;
  cadence: HabitCadence;
  /** para weekly: cuántas veces por semana cuenta como cumplido (ej. gym 3x). */
  times_per_week: number;
  active: boolean;
  created_at: string;
}

export interface HabitCheckin {
  id: number;
  habit_id: number;
  /** YYYY-MM-DD en America/Bogota. */
  date: string;
  done: boolean;
  note?: string | null;
}

/** Fila para "hábitos de hoy": hábito + estado + racha (brief, voz y web). */
export interface HabitToday extends Habit {
  done_today: boolean;
  /** días (daily) o semanas (weekly) consecutivas. */
  streak: number;
  /** check-ins de esta semana (para weekly). */
  week_count: number;
  /** los 7 días de la semana (lunes→domingo): fecha + si hubo check-in. */
  week_dates: { date: string; done: boolean }[];
}

export interface GoalMilestone {
  title: string;
  done: boolean;
  done_at?: string | null;
}

export type GoalStatus = "active" | "paused" | "done" | "abandoned";

export interface Goal {
  id: number;
  title: string;
  description?: string | null;
  /** null = meta cualitativa (solo milestones). */
  target_value?: number | null;
  current_value: number;
  /** 'libros', 'kg', 'USD', '%'. */
  unit?: string | null;
  milestones: GoalMilestone[];
  status: GoalStatus;
  due_date?: string | null;
  created_at: string;
  updated_at?: string | null;
  done_at?: string | null;
}

/** Billetera con saldo actual (bancolombia, nu, nequi, ontop, efectivo…).
 *  El saldo se ajusta solo con cada transacción que indique billetera. */
export interface Wallet {
  id: number;
  name: string;
  currency: Currency;
  balance: number;
  updated_at?: string | null;
}

// ── Dashboard: capa de datos del rediseño ──────────────────────────────
// Endpoints nuevos del agente que alimentan el strip inferior, la presencia
// multi-Mac y los conteos del rediseño. Regla: cada sección es independiente
// y "nullable" — si su fuente falla, el resto del dashboard sigue vivo.

/** Métricas del Mac local (panel SISTEMA). Fuente: node:os + fs.statfs. */
export interface SystemMetrics {
  /** 0-100, delta de ticks de CPU desde el último sample (5s). */
  cpuPct: number;
  loadAvg1: number;
  /** 0-100 (aprox en macOS: freemem subestima lo disponible). */
  memUsedPct: number;
  memTotalBytes: number;
  memUsedBytes: number;
  /** 0-100 del volumen raíz; 0 con diskTotalBytes 0 = no disponible. */
  diskUsedPct: number;
  diskTotalBytes: number;
  diskFreeBytes: number;
  /** Uptime del Mac (no del agente). */
  uptimeOsSeconds: number;
  uptimeAgentSeconds: number;
}

/** Un bucket horario de la actividad del agente (área chart 24h). */
export interface ActivityBucket {
  /** ISO del inicio de la hora. */
  hour: string;
  total: number;
  toolCalls: number;
  /** task_start + task_done. */
  tasks: number;
  errors: number;
}

export interface ActivitySeries {
  hours: number;
  /** supabase = todas las Macs, persiste reinicios · memoria = fallback parcial. */
  source: "supabase" | "memoria";
  /** Siempre `hours` entradas; horas sin actividad van en 0. */
  buckets: ActivityBucket[];
}

/** Conteos reales de la base de conocimiento (panel MEMORIA ACTIVA). */
export interface KnowledgeStats {
  /** false = sin Supabase (todo en 0). */
  available: boolean;
  total: number;
  memories: number;
  vaultDocs: number;
  meetings: number;
  executions: number;
  conversationText: number;
  conversationVoice: number;
}

/** Un nodo del grafo de código de graphify (recortado para el render 3D). */
export interface CodeGraphNode {
  id: string;
  label: string;
  /** code | document | concept | rationale (file_type de graphify). */
  kind: string;
  /** Comunidad Louvain de graphify; -1 = sin comunidad. */
  community: number;
  /** Grado (número de aristas): dimensiona el nodo en 3D. */
  degree: number;
  /** Archivo de origen (tooltip). */
  file: string | null;
}

/** Una arista del grafo de código. Índices contra el array `nodes`. */
export interface CodeGraphLink {
  s: number;
  t: number;
  /** contains | imports | calls | … */
  relation: string;
}

/** Grafo de código completo de un repo, listo para el render 3D. */
export interface CodeGraph3D {
  /** false = graphify aún no indexó este repo (nodes/links vacíos). */
  available: boolean;
  project: string;
  /** Commit en el que se construyó el grafo (graph.json). */
  builtAtCommit: string | null;
  nodes: CodeGraphNode[];
  links: CodeGraphLink[];
  /** Nombres de comunidades (graphify label): id → nombre legible. */
  communities: Record<string, string>;
}

/** Un evento próximo del calendario (feed ICS privado de Google Calendar). */
export interface CalendarEvent {
  /** UID + fecha de la instancia (únicas también en eventos recurrentes). */
  id: string;
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
  location: string | null;
  /** Notas del evento (DESCRIPTION del ICS); null si el evento no las trae. */
  description: string | null;
  /** Minutos hasta el inicio; negativo = ya empezó (en curso). */
  startsInMin: number;
}

export interface UpcomingCalendar {
  /** false = sin GOOGLE_CALENDAR_ICS_URL en .env (el panel muestra CTA). */
  configured: boolean;
  fetchedAt: string | null;
  /** true = el último fetch falló y esto es cache viejo. */
  stale: boolean;
  events: CalendarEvent[];
}

/** Clima actual (Open-Meteo, códigos WMO; el front mapea a iconos). */
export interface WeatherNow {
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  precipitationMm: number;
  windKmh: number;
  weatherCode: number;
}

export interface WeatherDay {
  /** YYYY-MM-DD. */
  date: string;
  minC: number;
  maxC: number;
  precipProbPct: number | null;
  weatherCode: number;
}

export interface WeatherReport {
  place: string;
  fetchedAt: string;
  /** true = el último fetch falló y esto es cache viejo. */
  stale: boolean;
  now: WeatherNow;
  /** Hoy + 2 días. */
  daily: WeatherDay[];
}

export type JobResult = "ok" | "error" | "skipped";

/** Estado de un job periódico del agente (panel AUTOMATIZACIONES). */
export interface JobStatus {
  name: string;
  intervalMs: number;
  /** null = aún no corrió desde el arranque. */
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastResult: JobResult | null;
  /** Mensaje recortado si lastResult === "error". */
  lastError: string | null;
  /** Detalle humano de la última corrida ("3 notas vectorizadas…"). */
  lastDetail: string | null;
  nextRunAt: string | null;
  runsOk: number;
  runsError: number;
}

/** Fila del panel de agentes activos (agent_presence + estado local). */
export interface MachinePresence {
  machine: string;
  status: "idle" | "working" | "thinking" | "offline";
  currentTask: string | null;
  lastHeartbeat: string | null;
  version: string | null;
  /** Heartbeat hace menos de 90 s. */
  online: boolean;
  /** La máquina que respondió este request. */
  self: boolean;
  /**
   * URL base alcanzable en la red interna (http://192.168.1.60:8650) publicada
   * por el propio agente. El selector de máquina apunta el dashboard aquí, así
   * que null = esa máquina existe pero no se sabe cómo hablarle.
   */
  baseUrl: string | null;
  lanIp: string | null;
  /** "macOS · arm64", "Linux (WSL) · x64", "Windows · x64". */
  os: string | null;
  /** Qué puede hacer REALMENTE esa máquina (cada PC corre un subconjunto). */
  capabilities: MachineCapabilities | null;
}

/**
 * Capacidades reales de un agente. Se derivan de su entorno al latir (no son
 * flags de configuración): la UI las usa para no ofrecer en un PC algo que
 * solo existe en el otro.
 */
export interface MachineCapabilities {
  /** VAULT_PATH configurado → proyectos, juntas y Estudio escriben notas. */
  vault: boolean;
  /** Ejecuta `claude` (runs, tareas, chat con memoria de sesión). */
  runs: boolean;
  /** Control por gestos / cursor del sistema (robotjs + macOS). */
  gestures: boolean;
  /** Control del navegador (AppleScript de Chrome). */
  browser: boolean;
  /** Juntas EN VIVO (STT streaming configurado). */
  liveMeetings: boolean;
  /** Disco de captura del Estudio montado. */
  estudioMedia: boolean;
  /** Grafo de código (binario de graphify presente). */
  codeGraph: boolean;
}

/** Conteos del tracker por estado (header del tablero). */
export interface TrackerSummary {
  /** false = sin Supabase. */
  available: boolean;
  pending: number;
  running: number;
  done: number;
  dismissed: number;
  /** Solo con ?byProject=1. */
  byProject?: { project_slug: string; pending: number; running: number; done: number }[];
}

/** Snapshot único del dashboard (GET /dashboard): un solo poll para el strip
 *  inferior y la presencia. Cada sección se arma con Promise.allSettled. */
export interface DashboardSnapshot {
  generatedAt: string;
  machine: string;
  system: SystemMetrics;
  presence: MachinePresence[];
  knowledge: KnowledgeStats;
  tracker: TrackerSummary;
  jobs: JobStatus[];
  activity: ActivitySeries | null;
  weather: WeatherReport | null;
  calendar: UpcomingCalendar;
  usage: DailyRunUsage;
}

// ── Estudio (creación de contenido RuloCode) ────────────────────────────────

/** Pilar de contenido de la estrategia de marca personal 2026. */
export type ContentPillar = "p1" | "p2" | "p3" | "p4" | "p5";

/** Etapa de una pieza en el pipeline de producción.
 *  Cada estado es una FASE en curso ("qué se está haciendo ahora"), no un hito
 *  cumplido: una pieza en `grabacion` es la que TOCA grabar. Definiciones y
 *  criterios de salida en `content.ts` (STAGES). */
export type ContentStatus =
  | "idea"
  | "guion"
  | "grabacion"
  | "edicion"
  | "programado"
  | "publicado"
  | "descartada";

/** Entrada del historial de etapas: cuándo entró la pieza a cada una. */
export interface ContentStageEntry {
  status: ContentStatus;
  /** ISO del momento de la transición. */
  at: string;
}

/** Una toma de una sesión de grabación. */
export interface ContentTake {
  id: string;
  label: string;
  /** Rango en el archivo de grabación, ej. "02:30–04:48". */
  range: string | null;
  verdict: "buena" | "revisar" | "descartada";
  note: string | null;
}

/** Punto de edición marcado sobre el material (para el kit Divisual). */
export interface ContentEditPoint {
  id: string;
  /** Timecode "MM:SS". */
  tc: string;
  kind: "corte" | "zoom" | "caption" | "broll" | "card";
  note: string;
}

/** Clip crudo vinculado a la pieza: archivo local en el disco del agente. */
export interface ContentRawClip {
  id: string;
  /** Ruta absoluta en la máquina del agente. */
  path: string;
  name: string;
  size_bytes: number;
  /** Metadata real de ffprobe (null si el probe falló). */
  duration_sec: number | null;
  resolution: string | null;
  added_at: string;
}

/**
 * Job de edición automática (OpenMontage): snapshot del run en curso o del
 * último. Vive en la pieza (jsonb) para que el poll del board lo traiga solo.
 */
export interface ContentEditJob {
  status: "running" | "done" | "error";
  /** Etapa del pipeline que reporta el run (script/assets/edit/compose…). */
  stage: string | null;
  /** Última línea de progreso legible. */
  detail: string | null;
  /** Brief opcional que acompañó el run. */
  brief: string | null;
  started_at: string;
  finished_at: string | null;
  /** Ruta absoluta del master renderizado (renders/final.mp4). */
  output_path: string | null;
  /** Carpeta del proyecto OpenMontage (projects/<slug>). */
  project_dir: string | null;
  error: string | null;
}

/** Listado de una carpeta local para elegir crudos (GET /content/clips/browse). */
export interface ClipBrowse {
  dir: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
  files: { name: string; path: string; size_bytes: number; mtime: string }[];
}

/** Archivo real en la carpeta de la pieza (disco extraíble). */
export interface PieceMediaFile {
  name: string;
  /** Nombre base sin extensión — la identidad de la toma ("01-hook"). */
  stem: string;
  path: string;
  size_bytes: number;
  mtime: string;
  /** Duración real (ffprobe); null en imágenes o si el probe falló. */
  duration_sec: number | null;
}

/**
 * Estado de la carpeta canónica de la pieza en el disco extraíble
 * (GET /content/pieces/:id/media): ESTUDIO_MEDIA_ROOT/<slug>/{crudos,assets,exports}.
 */
export interface PieceMedia {
  /** ¿El disco extraíble está montado? */
  connected: boolean;
  /** Dónde vive la carpeta resuelta: el disco extraíble o el fallback local
   *  (~/Movies/estudio — la grabación no se bloquea por un cable). */
  root: "disco" | "local";
  /** Carpeta de la pieza (la sellada en media_dir o la derivada del título). */
  dir: string;
  /** ¿La carpeta ya existe en el disco? */
  exists: boolean;
  crudos: PieceMediaFile[];
  assets: PieceMediaFile[];
  exports: PieceMediaFile[];
}

/**
 * Versión alternativa de una PARTE del guion ("hook" o la etiqueta del beat:
 * "[0-3s]", "Bloque 2"). La versión ACTIVA no vive aquí: es el texto real en
 * hook/script_md — elegir una variante lo reescribe (una sola fuente de
 * verdad; el teleprompter y el espejo del vault no cambian de contrato).
 */
/**
 * Estructura del hook — la etiqueta que la biblioteca de hooks cruza con las
 * métricas reales (¿qué tipo de apertura retiene?). Se guarda en la variante
 * al generarla; las manuales pueden quedar sin etiqueta.
 */
export type HookKind = "pregunta" | "dato" | "contraste" | "error" | "promesa" | "demo";

export interface ContentVariant {
  id: string;
  part: string;
  text: string;
  /** El ángulo/apuesta de la versión ("curiosidad", "dato duro", "contraste"…). */
  angle: string | null;
  /** Estructura del hook (solo variantes de part="hook"; null en las viejas). */
  hook_kind?: HookKind | null;
  source: "hermes" | "manual";
  created_at: string;
}

/** Mensaje del chat de una pieza (historial persistente por pieza). */
export interface ContentChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

/** Quién publica la variante. 'manual' = la sube el dueño; Hermes solo anota. */
export type PublishProvider = "youtube" | "instagram" | "tiktok" | "manual";

/**
 * Estado REAL de la publicación, verificado contra la API — distinto del
 * `status` editorial que marca el humano. No se colapsan a propósito: marcar
 * "publicada" a mano no significa que la plataforma lo haya confirmado.
 *
 *  pendiente  → en cola, esperando su turno o su fecha
 *  subiendo   → el archivo está viajando
 *  programada → la plataforma ya lo tiene y saldrá a su hora (YouTube publishAt)
 *  publicada  → confirmado en vivo
 *  error      → falló; `last_error` dice qué pasó
 *  manual     → sin provider automático: la sube el dueño
 */
export type PublishState =
  | "pendiente"
  | "subiendo"
  | "programada"
  | "publicada"
  | "error"
  | "manual";

/** Variante de publicación por plataforma (el hook se reescribe SIEMPRE). */
export interface ContentPublication {
  id: string;
  platform: "youtube" | "shorts" | "tiktok" | "reels" | "linkedin" | "x";
  title: string | null;
  copy: string | null;
  scheduled_at: string | null;
  /** Estado editorial (lo marca el humano). */
  status: "borrador" | "programada" | "publicada";
  /** Quién la publica. */
  provider: PublishProvider;
  /** Estado de la máquina, verificado contra la API. */
  publish_state: PublishState;
  /** Id del video en la plataforma. Es el CANDADO de idempotencia: si existe,
   *  la variante no se vuelve a subir jamás (subir dos veces es el fallo caro). */
  remote_id: string | null;
  remote_url: string | null;
  attempts: number;
  last_attempt_at: string | null;
  last_error: string | null;
}

/** Snapshot del run de publicación en curso/último (patrón ContentEditJob). */
export interface ContentPublishJob {
  status: "running" | "done" | "error";
  /** Qué se está haciendo ahora, en español. */
  detail: string | null;
  started_at: string;
  finished_at: string | null;
  /** Cuántas variantes quedaron OK / con error en el último barrido. */
  ok: number;
  failed: number;
  error: string | null;
}

/** Estado de un provider de publicación (GET /content/publish/providers). */
export interface PublishProviderStatus {
  provider: PublishProvider;
  label: string;
  configured: boolean;
  /** Por qué no está listo, en español accionable. */
  hint: string | null;
}

/** Pieza de contenido: la unidad del tab ESTUDIO. */
export interface ContentPiece {
  id: number;
  title: string;
  pillar: ContentPillar;
  platforms: string[];
  format: "pilar" | "vertical" | "post" | "carrusel" | "otro";
  status: ContentStatus;
  /** Desde cuándo lleva en la etapa actual (ISO) — base del "N días aquí". */
  status_since: string | null;
  /** Historial append-only de transiciones (una entrada por cambio de etapa). */
  stage_history: ContentStageEntry[];
  /** Fecha/hora objetivo de publicación (ISO). */
  publish_at: string | null;
  /** Etiqueta de planeación, ej. "M1·S1". */
  week_label: string | null;
  hook: string | null;
  /** Guion en markdown — editable desde la UI; se espeja al vault al guardar. */
  script_md: string | null;
  takes: ContentTake[];
  edit_points: ContentEditPoint[];
  /** Crudos vinculados (archivos locales; alimentan la edición automática). */
  raw_clips: ContentRawClip[];
  /** Run de edición automática (OpenMontage) en curso/último. */
  edit_job: ContentEditJob | null;
  /** Video final canónico, verificado en disco (lo sella el agente). */
  master_path: string | null;
  /** Run de publicación en curso/último. */
  publish_job: ContentPublishJob | null;
  publications: ContentPublication[];
  /** Pool de versiones por parte del guion (hook y bloques). */
  variants: ContentVariant[];
  linear_identifier: string | null;
  linear_url: string | null;
  session_id: number | null;
  /** Referencia del radar que originó la pieza (content_refs.id). */
  ref_id: number | null;
  /** Ruta del espejo .md en el vault (relativa al vault). */
  vault_path: string | null;
  /** Carpeta canónica en el disco extraíble (estudio/<slug>; se sella al crearla). */
  media_dir: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Sesión de grabación (batch sabatino u otra). */
export interface ContentSession {
  id: number;
  title: string;
  scheduled_at: string | null;
  status: "planeada" | "en_curso" | "completada" | "cancelada";
  checklist: { label: string; done: boolean }[];
  /** Carpeta local de grabación. */
  folder: string | null;
  notes: string | null;
  created_at: string;
}

/** Entrada del radar: tendencia comprobada, referente o referencia guardada. */
export interface ContentRef {
  id: number;
  kind: "tendencia" | "referente" | "guardada";
  title: string;
  body: string | null;
  /** Dato corto que encabeza la tarjeta, ej. "+53%" o "24–38s". */
  metric: string | null;
  source: string | null;
  /** Enlace canónico del material (migración 023). Con YouTube, la UI deriva
   *  la miniatura y el clic navega al video; el agente resuelve título/canal
   *  reales por oEmbed cuando se guarda solo el link. */
  url: string | null;
  apply_status: "aplicado" | "probar" | "observar" | null;
  pillar: ContentPillar | null;
  created_at: string;
}

/** Id del video si la URL es de YouTube (watch/shorts/youtu.be); null si no. */
export function youtubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/,
  );
  return m ? m[1] : null;
}

/** Miniatura real de YouTube para la tarjeta del radar (null si no es YT). */
export function youtubeThumbnail(url: string | null | undefined): string | null {
  const id = youtubeVideoId(url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

/** Respuesta de GET /content/board: un solo poll para toda la vista ESTUDIO. */
export interface ContentBoard {
  /** false = sin Supabase. */
  available: boolean;
  pieces: ContentPiece[];
  sessions: ContentSession[];
  refs: ContentRef[];
}

// ── Bucle de resultados (migración 022) ────────────────────────────────

/** Snapshot diario de métricas de una publicación remota (dato de API, jamás estimado). */
export interface ContentMetricRow {
  day: string;
  source: "youtube-analytics" | "youtube-data" | "ig-insights" | "tiktok-display" | "manual";
  platform: string;
  remote_id: string;
  views: number | null;
  /** Métrica post-2025 de YouTube: vista con intención (equivale al conteo viejo). */
  engaged_views: number | null;
  avg_view_duration_s: number | null;
  avg_view_pct: number | null;
  watch_time_s: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  subs_gained: number | null;
  fetched_at: string;
}

/** Punto de la curva de retención de YouTube (elapsedVideoTimeRatio). */
export interface ContentRetentionPoint {
  elapsed_ratio: number;
  watch_ratio: number | null;
  rel_performance: number | null;
}

/** Respuesta de GET /content/pieces/:id/metrics — si no hay filas, no se pinta nada. */
export interface PieceMetrics {
  /** false = el provider de analytics no está configurado. */
  available: boolean;
  rows: ContentMetricRow[];
  retention: ContentRetentionPoint[];
  /** Por qué no hay datos, en español accionable (falta scope, sin publicaciones…). */
  hint: string | null;
}

/** Fila de GET /content/hooks/performance: qué hook salió y cómo le fue. */
export interface HookPerformanceRow {
  piece_id: number;
  title: string;
  /** El hook que REALMENTE salió a esa red (título efectivo de la variante). */
  hook: string;
  hook_kind: HookKind | null;
  platform: string;
  remote_id: string;
  day: string;
  views: number | null;
  engaged_views: number | null;
  avg_view_pct: number | null;
  subs_gained: number | null;
}
