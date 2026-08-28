import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendFile, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FINANCE_CATEGORIES } from "@hermes/shared";
import { env } from "../env.js";
import { queryCodeGraph } from "../code-graph.js";
import { saveMemory, searchMemory, savePreference } from "../memory.js";
import { searchKnowledge, knowledgeToText } from "../knowledge.js";
import { readProjects } from "../vault/projects.js";
import { searchMeetings } from "../meetings/store.js";
import { supabase } from "../supabase.js";
import {
  createTransaction,
  listTransactions,
  setBudget,
} from "../finance/store.js";
import { getFinanceSummary, summaryToText, formatAmount } from "../finance/advisor.js";
import { balancesToText, setWalletBalance } from "../finance/wallets.js";
import {
  createHabit,
  archiveHabit,
  resolveHabit,
  checkinHabit,
  habitsToday,
  listHabits,
} from "../habits/store.js";
import { listGoals, resolveGoal, updateGoal } from "../habits/goals.js";
import {
  linearEnabled,
  createLinearIssue,
  listLinearIssues,
  linearIssuesToText,
  LINEAR_PRIORITIES,
} from "../linear.js";
import { createPiece, listPieces } from "../content/store.js";
import { lightsCommand, LIGHT_ACTIONS } from "../lights.js";
import { STAGES, daysInStage, isStuck, stageGates } from "@hermes/shared";
import { OWNER } from "../owner.js";

const execFileAsync = promisify(execFile);

const MEMORY_TYPES = ["user", "feedback", "project", "reference", "daily", "agent"] as const;

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ── Tools MCP in-process del servidor "hermes" ─────────────────────────

const saveMemoryTool = tool(
  "save_memory",
  `Guarda una memoria persistente en Supabase (compartida entre todas las máquinas de ${OWNER}). Úsala al aprender algo nuevo sobre ${OWNER}, sus proyectos o al terminar tareas significativas.`,
  {
    content: z.string().describe("El contenido de la memoria, autocontenido y claro"),
    type: z.enum(MEMORY_TYPES).describe(`user=sobre ${OWNER}, feedback=correcciones, project=proyectos, reference=links/recursos, daily=diario, agent=aprendizajes propios`),
    project: z.string().optional().describe("Slug del proyecto relacionado (ej: ternium, zylen)"),
    tags: z.array(z.string()).optional(),
    importance: z.number().min(1).max(5).optional().describe("1=trivial, 5=crítico"),
  },
  async (args) => text(await saveMemory({ ...args, source: "agent" })),
);

const KNOWLEDGE_SOURCES = ["memory", "meeting", "execution", "conversation", "vault"] as const;

const searchKnowledgeTool = tool(
  "search_knowledge",
  "Búsqueda semántica unificada en TODO lo que Hermes sabe: memorias, reuniones, ejecuciones de tareas, conversaciones pasadas (texto y voz) y notas del vault. Primera opción para '¿en qué quedamos?', '¿qué sabemos de X?' o cualquier contexto histórico.",
  {
    query: z.string().describe("Qué buscar, en lenguaje natural"),
    sources: z
      .array(z.enum(KNOWLEDGE_SOURCES))
      .optional()
      .describe("Acotar a ciertas fuentes. Omitir para buscar en todas."),
    project: z.string().optional().describe("Slug del proyecto para acotar (ej: ternium)"),
    limit: z.number().max(20).optional(),
  },
  async ({ query, sources, project, limit }) => {
    const hits = await searchKnowledge(query, { sources, project, limit: limit ?? 10 });
    if (!hits.length) return text("Sin resultados en la base de conocimiento.");
    return text(knowledgeToText(hits));
  },
);

const searchMemoryTool = tool(
  "search_memory",
  "Búsqueda semántica en las memorias persistentes. Úsala antes de preguntar al usuario algo que ya podrías saber.",
  {
    query: z.string(),
    type: z.enum(MEMORY_TYPES).optional(),
    limit: z.number().max(20).optional(),
  },
  async ({ query, type, limit }) => {
    const results = await searchMemory(query, type, limit ?? 8);
    if (!results.length) return text("Sin resultados en memoria.");
    return text(
      results
        .map((m) => `[${m.type}${m.project_slug ? `·${m.project_slug}` : ""} ${m.created_at.slice(0, 10)}] ${m.content.slice(0, 400)}`)
        .join("\n---\n"),
    );
  },
);

const savePreferenceTool = tool(
  "save_preference",
  `Guarda una preferencia de ${OWNER} (clave-valor). Ej: key='package_manager', value='pnpm'.`,
  { key: z.string(), value: z.string() },
  async ({ key, value }) => text(await savePreference(key, value)),
);

const getProjectStatusTool = tool(
  "get_project_status",
  "Lee el estado real de los proyectos desde el vault de Obsidian (frontmatter + Estado Actual + Tareas Pendientes). Sin argumentos devuelve todos los activos.",
  { project: z.string().optional().describe("Slug del proyecto (ej: ternium). Omitir para todos los activos.") },
  async ({ project }) => {
    const projects = await readProjects();
    const filtered = project
      ? projects.filter((p) => p.slug.toLowerCase() === project.toLowerCase())
      : projects.filter((p) => p.estado === "activo");
    if (!filtered.length) return text(`No encontré el proyecto "${project ?? "(activos)"}" en el vault.`);
    return text(
      filtered
        .map(
          (p) =>
            `# ${p.name} [${p.estado}]${p.rama ? ` rama:${p.rama}` : ""}\n## Estado Actual\n${p.estado_actual || "—"}\n## Tareas Pendientes\n${p.tareas_pendientes.map((t) => `- ${t}`).join("\n") || "—"}`,
        )
        .join("\n\n====\n\n"),
    );
  },
);

const updateProjectNoteTool = tool(
  "update_project_note",
  "Anexa una entrada con fecha a la sección 'Estado Actual' de la nota de un proyecto del vault. Es el flujo 'persistir aprendizajes' del AIOS.",
  {
    project: z.string().describe("Slug del proyecto (carpeta en projects/)"),
    content: z.string().describe("Texto a anexar (markdown)"),
  },
  async ({ project, content }) => {
    const projects = await readProjects(true);
    const p = projects.find((x) => x.slug.toLowerCase() === project.toLowerCase());
    if (!p) return text(`Proyecto "${project}" no encontrado en el vault.`);
    const notePath = join(env.VAULT_PATH, "projects", p.slug, `${p.name}.md`);
    const raw = await readFile(notePath, "utf8");
    const today = new Date().toISOString().slice(0, 10);
    const entry = `\n> [!note] Hermes · ${today}\n> ${content.replace(/\n/g, "\n> ")}\n`;
    // Insertar justo después del header "Estado Actual"
    const lines = raw.split("\n");
    const idx = lines.findIndex((l) => /^#{1,3}\s*.*Estado Actual/i.test(l));
    if (idx === -1) {
      await writeFile(notePath, raw + `\n## 📊 Estado Actual\n${entry}`, "utf8");
    } else {
      lines.splice(idx + 1, 0, entry);
      await writeFile(notePath, lines.join("\n"), "utf8");
    }
    return text(`Nota de ${p.name} actualizada (${notePath}).`);
  },
);

const searchVaultTool = tool(
  "search_vault",
  "Búsqueda de texto (read-only) sobre todo el vault de Obsidian con ripgrep.",
  {
    query: z.string(),
    folder: z.string().optional().describe("Subcarpeta del vault (ej: projects)"),
  },
  async ({ query, folder }) => {
    const dir = folder ? join(env.VAULT_PATH, folder) : env.VAULT_PATH;
    try {
      const { stdout } = await execFileAsync(
        "rg",
        ["-i", "--max-count", "3", "--max-columns", "240", "-g", "*.md", query, dir],
        { maxBuffer: 1024 * 512 },
      );
      return text(stdout.slice(0, 6000) || "Sin coincidencias.");
    } catch (err: unknown) {
      const e = err as { code?: number; stdout?: string };
      if (e.code === 1) return text("Sin coincidencias.");
      return text(`Error en búsqueda: ${String(err).slice(0, 300)}`);
    }
  },
);

const captureIdeaTool = tool(
  "capture_idea",
  "Captura una idea suelta: la escribe en '00 Inbox/' del vault y la espeja como memoria.",
  { content: z.string(), tags: z.array(z.string()).optional() },
  async ({ content, tags }) => {
    const inbox = join(env.VAULT_PATH, "00 Inbox");
    await mkdir(inbox, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const file = join(inbox, `idea-${stamp}.md`);
    await appendFile(
      file,
      `---\ncapturada: ${new Date().toISOString()}\ntags: [${(tags ?? []).join(", ")}]\norigen: hermes\n---\n\n${content}\n`,
    );
    await saveMemory({ content, type: "agent", tags: [...(tags ?? []), "idea"], source: "agent" });
    return text(`Idea capturada en ${file}`);
  },
);

const getRecentActivityTool = tool(
  "get_recent_activity",
  "Devuelve la actividad reciente del agente (sesiones y acciones) para responder '¿en qué quedamos?'.",
  { limit: z.number().max(50).optional() },
  async ({ limit }) => {
    if (!supabase) return text("Supabase no configurado: sin historial.");
    const { data } = await supabase
      .from("agent_activity")
      .select("kind,tool_name,payload,machine,created_at")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (!data?.length) return text("Sin actividad registrada.");
    return text(
      data
        .map((a) => `${a.created_at.slice(0, 16)} [${a.machine}] ${a.kind}${a.tool_name ? `:${a.tool_name}` : ""} ${JSON.stringify(a.payload).slice(0, 120)}`)
        .join("\n"),
    );
  },
);

const searchMeetingsTool = tool(
  "search_meetings",
  "Búsqueda semántica en el historial de reuniones/juntas por su resumen. Úsala para responder '¿qué salió en la última junta de X?' o '¿qué decidimos sobre Y?'.",
  {
    query: z.string(),
    project: z.string().optional().describe("Slug del proyecto para acotar (ej: divisual). Omitir para buscar en todos."),
    limit: z.number().max(10).optional(),
  },
  async ({ query, project, limit }) => {
    const hits = await searchMeetings(query, project, limit ?? 5);
    if (!hits.length) return text("Sin reuniones que coincidan.");
    return text(
      hits
        .map((h) => `[${h.project_slug}·${h.fecha.slice(0, 10)}] ${h.title}\n${(h.summary ?? "").slice(0, 400)}`)
        .join("\n---\n"),
    );
  },
);

/** Convierte un subtítulo .vtt de YouTube en texto plano, quitando timestamps,
 *  tags de karaoke (<00:00:04><c>…</c>) y las líneas duplicadas de auto-captions. */
function vttToText(vtt: string): string {
  const out: string[] = [];
  let last = "";
  for (const raw of vtt.split("\n")) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || line.includes("-->")) continue;
    if (/^(Kind|Language):/.test(line)) continue;
    const clean = line.replace(/<[^>]+>/g, "").trim(); // quita <...c> y timestamps inline
    if (!clean || clean === last) continue;
    out.push(clean);
    last = clean;
  }
  return out.join(" ");
}

const analyzeYouTubeTool = tool(
  "analyze_youtube",
  "Extrae y devuelve la transcripción de un video de YouTube (vía yt-dlp) para que la analices. Puedes pedir resumen, puntos clave, accionables, etc.",
  {
    url: z.string().url().describe("URL del video de YouTube"),
    language: z.string().optional().describe("Código de idioma preferido (ej: es, en). Por defecto intenta es y luego en."),
  },
  async ({ url, language }) => {
    const videoIdMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([\w-]+)/);
    if (!videoIdMatch) return text("URL de YouTube inválida. Usa: youtube.com/watch?v=ID, youtu.be/ID o /shorts/ID");
    const videoId = videoIdMatch[1];
    const langs = language ? `${language},es,en` : "es,en";

    const workDir = join(tmpdir(), `hermes-yt-${videoId}-${Date.now()}`);
    await mkdir(workDir, { recursive: true });
    try {
      await execFileAsync(
        "yt-dlp",
        [
          "--skip-download",
          "--write-subs",
          "--write-auto-subs",
          "--sub-langs", langs,
          "--sub-format", "vtt",
          "--no-warnings",
          "-o", join(workDir, "sub"),
          `https://www.youtube.com/watch?v=${videoId}`,
        ],
        { maxBuffer: 1024 * 1024 * 8, timeout: 60_000 },
      );

      const files = (await readdir(workDir)).filter((f) => f.endsWith(".vtt"));
      if (!files.length) return text("No se encontró transcripción/subtítulos para este video.");

      // Prioriza según el orden de preferencia (idioma pedido → es → en → lo que haya).
      const prefs = langs.split(",");
      const pick = prefs.map((l) => files.find((f) => f.includes(`.${l}.`))).find(Boolean) ?? files[0];
      const vtt = await readFile(join(workDir, pick), "utf8");
      const fullText = vttToText(vtt);
      if (!fullText) return text("La transcripción está vacía tras el parseo.");

      const truncated = fullText.length > 12000;
      return text(
        `# Transcripción (${pick.replace(/^sub\.|\.vtt$/g, "")}): ${url}\n\n${fullText.slice(0, 12000)}${truncated ? "\n\n[... transcripción truncada ...]" : ""}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/429|Too Many Requests/i.test(msg)) return text("YouTube devolvió 429 (rate limit). Intenta de nuevo en un momento.");
      return text(`Error al extraer transcripción: ${msg.slice(0, 300)}`);
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  },
);

const queryCodeGraphTool = tool(
  "query_code_graph",
  `Responde preguntas sobre la ESTRUCTURA del código de los proyectos de ${OWNER} usando su grafo de dependencias (graphify, local). Por defecto consulta hermes-os; pasa 'project' (slug del vault: zylen, ternium, careways, teker, video-edit…) para consultar otro. mode=query: pregunta libre ('¿qué conecta el checkout con el pago?'); mode=explain: explica un símbolo/módulo y sus conexiones ('explícame registerJob'); mode=path: ruta de dependencias entre dos símbolos/archivos (requiere target). Úsala para '¿dónde vive X?', '¿qué depende de Y?', '¿cómo se conectan A y B?' — nunca adivines arquitectura.`,
  {
    mode: z.enum(["query", "path", "explain"]).describe("query=pregunta libre, explain=explicar un símbolo, path=ruta entre dos nodos"),
    query: z.string().describe("La pregunta (query), el símbolo a explicar (explain) o el nodo origen (path)"),
    target: z.string().optional().describe("Solo para mode=path: nodo destino"),
    project: z.string().optional().describe("Slug del proyecto a consultar (ej: zylen, ternium, careways). Omitir = hermes-os (este dashboard)."),
  },
  async ({ mode, query, target, project }) => {
    if (mode === "path" && !target) return text("mode=path requiere 'target' (nodo destino).");
    return text(await queryCodeGraph(mode, query, target, project));
  },
);

// ── Linear (manejo de tareas) ──────────────────────────────────────────

const LINEAR_CTA = "Linear no está configurado: agrega LINEAR_API_KEY al .env de la raíz (Linear → Settings → API → Personal API keys).";

const createLinearIssueTool = tool(
  "create_linear_issue",
  "Crea un issue en Linear con TODO el contexto del proyecto. Antes de llamarla, junta contexto real (get_project_status / search_knowledge / query_code_graph): título imperativo y corto; description con el contexto que un dev necesita (qué, por qué, archivos/rutas relevantes, criterios de aceptación en markdown); prompt = prompt AUTOCONTENIDO listo para copiar-pegar en Claude Code (incluye repo/ruta local, qué hacer, criterios de aceptación y cómo verificar) — la tool lo publica al final del issue como bloque 'Copy prompt' con botón de copiar.",
  {
    title: z.string().describe("Título imperativo y específico (ej: 'Agregar retry al upload de grabaciones')"),
    description: z.string().describe("Contexto en markdown: qué, por qué, archivos relevantes, criterios de aceptación. SIN el prompt — ese va aparte."),
    prompt: z.string().describe("Prompt autocontenido para ejecutar la tarea en Claude Code: repo/ruta, instrucciones concretas, criterios de aceptación y verificación."),
    project: z.string().optional().describe("Slug del proyecto del vault (ej: ternium) — el issue cae en el proyecto de Linear correspondiente (espejo del vault; se crea si falta)"),
    team: z.string().optional().describe("Key o nombre del team de Linear. Omitir = LINEAR_TEAM_KEY o el primer team."),
    priority: z.enum(LINEAR_PRIORITIES).optional().describe("Default: normal"),
    labels: z.array(z.string()).optional().describe("Labels extra (se crean si no existen)"),
  },
  async (args) => {
    if (!linearEnabled()) return text(LINEAR_CTA);
    try {
      const issue = await createLinearIssue({
        title: args.title,
        description: args.description,
        prompt: args.prompt,
        teamKey: args.team,
        project: args.project,
        priority: args.priority,
        labels: args.labels,
      });
      return text(`Issue creado: ${issue.identifier} · ${issue.title}\n${issue.url}`);
    } catch (err) {
      return text(`No pude crear el issue: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

const listLinearIssuesTool = tool(
  "list_linear_issues",
  "Lista los issues de Linear (abiertos por defecto). Úsala para '¿qué tengo en Linear?' o antes de crear uno para no duplicar.",
  {
    project: z.string().optional().describe("Filtrar por proyecto (slug del vault, ej: ternium)"),
    team: z.string().optional().describe("Key o nombre del team"),
    include_done: z.boolean().optional().describe("true para incluir completados/cancelados"),
    limit: z.number().max(50).optional(),
  },
  async ({ project, team, include_done, limit }) => {
    if (!linearEnabled()) return text(LINEAR_CTA);
    try {
      const issues = await listLinearIssues({ project, teamKey: team, includeDone: include_done, limit });
      if (!issues.length) return text("Sin issues con esos filtros en Linear.");
      return text(linearIssuesToText(issues));
    } catch (err) {
      return text(`No pude listar issues: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
);

// ── Finanzas personales (asesor financiero) ────────────────────────────

const logTransactionTool = tool(
  "log_transaction",
  `Registra un gasto o ingreso de ${OWNER} ('gasté 45 mil en un almuerzo', 'me pagaron el proyecto'). Categoriza tú el movimiento. Montos colombianos: se habla en miles — '45 mil' = 45000, 'dos millones/palos' = 2000000. COP por defecto; USD solo si lo dice explícito. Confirma monto y categoría en una frase.`,
  {
    kind: z.enum(["expense", "income"]).describe("expense=gasto, income=ingreso"),
    amount: z.number().positive().describe("Monto en la moneda indicada"),
    currency: z.enum(["COP", "USD"]).optional().describe("COP por defecto"),
    category: z.enum(FINANCE_CATEGORIES).optional().describe("Categoría del movimiento"),
    account: z.string().optional().describe("Billetera si la menciona: bancolombia, nu, nequi, ontop, efectivo — descuenta/suma su saldo"),
    note: z.string().optional().describe("Lo que dijo: 'el súper', 'almuerzo con Juan'"),
    date: z.string().optional().describe("YYYY-MM-DD si NO es hoy (fecha de pago del gasto)"),
    allow_duplicate: z.boolean().optional().describe(`true solo si ${OWNER} confirma que es un movimiento repetido genuino`),
  },
  async (args) => {
    const res = await createTransaction({
      kind: args.kind,
      amount: args.amount,
      currency: args.currency,
      category: args.category,
      account: args.account,
      note: args.note,
      occurredOn: args.date,
      source: "chat",
      allowDuplicate: args.allow_duplicate,
    });
    if (!res) return text("No pude registrar (Supabase no configurado).");
    if (res.deduped)
      return text(
        `Ya tenía ese registro de hoy (${formatAmount(res.tx.amount, res.tx.currency)} en ${res.tx.category}) — no lo dupliqué. Si es un movimiento distinto, repite con allow_duplicate=true.`,
      );
    const verb = res.tx.kind === "income" ? "Ingreso" : "Gasto";
    let out = `${verb} registrado: ${formatAmount(res.tx.amount, res.tx.currency)} en ${res.tx.category} (${res.tx.occurred_on}).`;
    if (res.wallet)
      out += ` ${res.wallet.name}: queda ${formatAmount(res.wallet.balance, res.wallet.currency)}.`;
    return text(out);
  },
);

const getBalanceTool = tool(
  "get_balance",
  `Saldo ACTUAL de ${OWNER}: total por moneda y detalle por billetera (bancolombia, nu, nequi, ontop…). Úsala cuando pregunte cuánto tiene o cuánta plata le queda — nunca lo deduzcas de los ingresos del mes.`,
  {},
  async () => text((await balancesToText()) ?? `No hay billeteras registradas aún. Pídele a ${OWNER} el saldo de cada una.`),
);

const setWalletBalanceTool = tool(
  "set_wallet_balance",
  `Fija el saldo actual de una billetera cuando ${OWNER} lo diga ('tengo 55 mil en nequi', 'en ontop tengo 653 dólares'). Crea la billetera si no existe. Es el recalibre manual; los gastos con billetera ya descuentan solos.`,
  {
    wallet: z.string().describe("Nombre de la billetera: bancolombia, nu, nequi, ontop, efectivo…"),
    balance: z.number().min(0).describe("Saldo actual, ya expandido (55 mil → 55000)"),
    currency: z.enum(["COP", "USD"]).optional().describe("COP por defecto; USD si es cuenta en dólares"),
  },
  async ({ wallet, balance, currency }) => {
    const w = await setWalletBalance(wallet, balance, currency ?? "COP");
    if (!w) return text("No pude guardar el saldo (Supabase no configurado).");
    return text(`${w.name}: ${formatAmount(w.balance, w.currency)}.`);
  },
);

const listTransactionsTool = tool(
  "list_transactions",
  `Lista movimientos financieros de ${OWNER} (detalle para análisis de asesor). Filtra por mes, categoría o tipo.`,
  {
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default mes actual"),
    category: z.enum(FINANCE_CATEGORIES).optional(),
    kind: z.enum(["expense", "income"]).optional(),
    limit: z.number().max(200).optional(),
  },
  async ({ month, category, kind, limit }) => {
    const txs = await listTransactions({ month, category, kind, limit: limit ?? 50 });
    if (!txs.length) return text("Sin movimientos con esos filtros.");
    return text(
      txs
        .map((t) => `${t.occurred_on} · ${t.kind === "income" ? "+" : "-"}${formatAmount(t.amount, t.currency)} · ${t.category}${t.note ? ` · ${t.note}` : ""}`)
        .join("\n"),
    );
  },
);

const getFinanceSummaryTool = tool(
  "get_finance_summary",
  `Resumen financiero del mes: ingresos, gastos por categoría vs presupuesto y riesgo. Úsala cuando ${OWNER} pregunte cómo van sus finanzas y analiza los datos como su asesor financiero — nunca inventes cifras.`,
  {
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, default mes actual"),
    currency: z.enum(["COP", "USD"]).optional().describe("COP por defecto"),
  },
  async ({ month, currency }) => text(summaryToText(await getFinanceSummary(month, currency ?? "COP"))),
);

const setBudgetTool = tool(
  "set_budget",
  "Define o actualiza el presupuesto mensual de una categoría (aplica cada mes).",
  {
    category: z.enum(FINANCE_CATEGORIES),
    monthly_limit: z.number().positive(),
    currency: z.enum(["COP", "USD"]).optional(),
  },
  async ({ category, monthly_limit, currency }) => {
    const b = await setBudget(category, monthly_limit, currency ?? "COP");
    if (!b) return text("No pude guardar el presupuesto (Supabase no configurado).");
    return text(`Presupuesto de ${b.category}: ${formatAmount(b.monthly_limit, b.currency)}/mes.`);
  },
);

// ── Hábitos y metas (coach de desarrollo personal) ─────────────────────

const logHabitTool = tool(
  "log_habit",
  `Marca un hábito de ${OWNER} como hecho hoy ('ya medité', 'fui al gym'). Devuelve la racha — celébrala en una frase.`,
  {
    habit: z.string().describe("Nombre del hábito (aproximado: 'meditar', 'gym')"),
    done: z.boolean().optional().describe("false para des-marcar"),
    note: z.string().optional(),
  },
  async ({ habit, done, note }) => {
    const h = await resolveHabit(habit);
    if (!h) {
      const names = (await listHabits(true)).map((x) => x.name);
      return text(`No encontré el hábito "${habit}". Activos: ${names.join(", ") || "ninguno — puedes crearlo con manage_habit"}.`);
    }
    const checkin = await checkinHabit(h.id, { done, note, source: "chat" });
    if (!checkin) return text("No pude registrar el check-in (Supabase no configurado).");
    const today = (await habitsToday()).find((x) => x.id === h.id);
    const unidad = h.cadence === "weekly" ? "semanas" : "días";
    return text(`${h.name} ${checkin.done ? "✓" : "✗"} — racha de ${today?.streak ?? 0} ${unidad}.`);
  },
);

const getHabitsTodayTool = tool(
  "get_habits_today",
  `Hábitos de hoy (hechos/pendientes, rachas) y metas activas con progreso. Úsala si ${OWNER} pregunta qué le falta hoy o cómo va con sus hábitos/metas.`,
  {},
  async () => {
    const habits = await habitsToday();
    const goals = await listGoals("active");
    if (!habits.length && !goals.length) return text("Sin hábitos ni metas registrados aún.");
    const lines: string[] = [];
    for (const h of habits) {
      const unidad = h.cadence === "weekly" ? "sem" : "días";
      const weekly = h.cadence === "weekly" ? ` (${h.week_count}/${h.times_per_week} esta semana)` : "";
      lines.push(`${h.done_today ? "✓" : "○"} ${h.name} — racha ${h.streak} ${unidad}${weekly}`);
    }
    for (const g of goals) {
      const progress =
        g.target_value != null
          ? `${g.current_value}/${g.target_value}${g.unit ? ` ${g.unit}` : ""}`
          : `${g.milestones.filter((m) => m.done).length}/${g.milestones.length} hitos`;
      lines.push(`◎ Meta: ${g.title} — ${progress}${g.due_date ? ` (para ${g.due_date})` : ""}`);
    }
    return text(lines.join("\n"));
  },
);

const manageHabitTool = tool(
  "manage_habit",
  "Crea o archiva un hábito. Para weekly, times_per_week es cuántas veces por semana cuenta como cumplido (ej: gym 3x).",
  {
    action: z.enum(["create", "archive"]),
    name: z.string(),
    cadence: z.enum(["daily", "weekly"]).optional(),
    times_per_week: z.number().min(1).max(7).optional(),
  },
  async ({ action, name, cadence, times_per_week }) => {
    if (action === "create") {
      const h = await createHabit({ name, cadence, timesPerWeek: times_per_week });
      if (!h) return text("No pude crear el hábito (Supabase no configurado).");
      return text(`Hábito creado: ${h.name} (${h.cadence === "weekly" ? `${h.times_per_week}x/semana` : "diario"}).`);
    }
    const h = await resolveHabit(name);
    if (!h) return text(`No encontré el hábito "${name}".`);
    await archiveHabit(h.id);
    return text(`Hábito archivado: ${h.name}.`);
  },
);

const updateGoalTool = tool(
  "update_goal",
  "Actualiza el progreso de una meta: valor absoluto (progress), incremento (delta) o marcar un milestone. Auto-completa la meta al llegar al target.",
  {
    goal: z.string().describe("Título aproximado de la meta"),
    progress: z.number().optional().describe("Nuevo valor absoluto de current_value"),
    delta: z.number().optional().describe("Incremento (ej: +1 libro leído)"),
    milestone: z.string().optional().describe("Título aproximado del hito a marcar como hecho"),
    status: z.enum(["active", "paused", "done", "abandoned"]).optional(),
  },
  async ({ goal, progress, delta, milestone, status }) => {
    const g = await resolveGoal(goal);
    if (!g) {
      const titles = (await listGoals("active")).map((x) => x.title);
      return text(`No encontré la meta "${goal}". Activas: ${titles.join(", ") || "ninguna"}.`);
    }
    const updated = await updateGoal(g.id, { currentValue: progress, delta, milestoneDone: milestone, status });
    if (!updated) return text("No pude actualizar la meta (Supabase no configurado).");
    const p =
      updated.target_value != null
        ? `${updated.current_value}/${updated.target_value}${updated.unit ? ` ${updated.unit}` : ""}`
        : `${updated.milestones.filter((m) => m.done).length}/${updated.milestones.length} hitos`;
    return text(updated.status === "done" ? `¡Meta cumplida! ${updated.title} (${p}).` : `${updated.title}: ${p}.`);
  },
);

const CONTENT_PILLARS = ["p1", "p2", "p3", "p4", "p5"] as const;

const createContentIdeaTool = tool(
  "create_content_idea",
  "Guarda una idea de contenido para la marca RuloCode en el tab ESTUDIO (pipeline de producción). " +
    `Úsala cuando ${OWNER} diga 'idea de contenido', 'apunta este video', 'para TikTok/YouTube', etc. ` +
    "IMPORTANTE: una idea sin ángulo nace incumpliendo su criterio de salida — pregunta (o infiere " +
    "de la conversación) POR QUÉ funcionaría y guárdalo en notes ('funciona porque X: se muestra Y, " +
    "le duele a Z'). Pilares: p1 Jarvis en público (demos Hermes) · p2 agentes que trabajan (Claude " +
    "Code) · p3 automatización en producción (n8n/B2B) · p4 build in public · p5 puente no-técnico.",
  {
    title: z.string().describe(`Título/gancho de la pieza, como lo diría ${OWNER}`),
    pillar: z.enum(CONTENT_PILLARS).optional().describe("Pilar de la estrategia (default p1)"),
    platforms: z
      .array(z.enum(["youtube", "shorts", "tiktok", "reels", "linkedin", "x"]))
      .optional()
      .describe("Plataformas destino"),
    format: z.enum(["pilar", "vertical", "post", "carrusel", "otro"]).optional(),
    hook: z.string().optional().describe("Primer segundo del video, si ya se le ocurrió"),
    notes: z
      .string()
      .optional()
      .describe(
        "La HIPÓTESIS de la idea: por qué funcionaría, qué se muestra, a quién le duele. Es el 'ángulo escrito' que pide el gate de idea.",
      ),
  },
  async (args) => {
    const piece = await createPiece({
      title: args.title,
      pillar: args.pillar,
      platforms: args.platforms,
      format: args.format,
      hook: args.hook ?? null,
      notes: args.notes ?? null,
    });
    if (!piece) return text("No pude guardar la idea (sin Supabase).");
    return text(
      `Idea guardada en el ESTUDIO: "${piece.title}" (${piece.pillar.toUpperCase()}, ${piece.format}). Está en el pipeline como idea${args.notes ? " con su hipótesis" : " — SIN hipótesis: pídele a ${OWNER} el porqué cuando pueda"}.`,
    );
  },
);

const listContentPiecesTool = tool(
  "list_content_pieces",
  "Lista las piezas del pipeline de contenido (proyecto RuloCodeShow, tab ESTUDIO) con su ETAPA, " +
    "cuántos días lleva ahí y qué le falta para avanzar. " +
    "Las etapas son fases en curso: idea (sin compromiso) · guion (escribiendo) · grabacion (toca grabarla) · " +
    "edicion (hay material, falta el corte) · programado (lista, esperando fecha) · publicado. " +
    "Úsala para '¿en qué va el contenido?', '¿qué grabo el sábado?' (status=grabacion), " +
    "'¿qué se publica esta semana?', '¿qué está atascado?'.",
  {
    status: z
      .enum(["idea", "guion", "grabacion", "edicion", "programado", "publicado"])
      .optional()
      .describe("Filtra por etapa del pipeline"),
    stuck: z
      .boolean()
      .optional()
      .describe("true = solo las atascadas (llevan más del SLA de su etapa o se les pasó la fecha)"),
  },
  async (args) => {
    const pieces = await listPieces();
    let filtered = args.status ? pieces.filter((p) => p.status === args.status) : pieces;
    if (args.stuck) filtered = filtered.filter((p) => isStuck(p));
    if (!filtered.length) return text("No hay piezas en el pipeline con ese filtro.");
    const lines = filtered
      .slice(0, 25)
      .map((p) => {
        const when = p.publish_at
          ? new Date(p.publish_at).toLocaleString("es-CO", {
              timeZone: "America/Bogota",
              weekday: "short",
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "sin fecha";
        const days = daysInStage(p);
        const age = days == null ? "" : ` · ${Math.floor(days)}d en ${STAGES[p.status].label.toLowerCase()}`;
        const pending = stageGates(p).filter((g) => !g.done);
        const falta = pending.length ? ` · falta: ${pending.map((g) => g.label).join(", ")}` : "";
        return `- [${p.status}] ${p.title} · ${p.pillar.toUpperCase()} · ${p.platforms.join("+") || "?"} · ${when}${age}${falta}${p.linear_identifier ? ` · ${p.linear_identifier}` : ""}`;
      })
      .join("\n");
    return text(`${filtered.length} piezas:\n${lines}`);
  },
);

const controlLightsTool = tool(
  "control_lights",
  `Controla la tira de luces LED del cuarto de ${OWNER} (Kasa 'luz led', en su LAN): encender/apagar, ` +
    "brillo, color por nombre o HSV, blanco cálido/neutro/frío y efectos animados (Ocean, Rainbow, " +
    "Lightning, Aurora…). action=status dice cómo está ahora (encendida, brillo, color, consumo). " +
    "Úsala para 'prende/apaga las luces', 'ponlas en azul', 'bájale el brillo', 'modo océano'.",
  {
    action: z.enum(LIGHT_ACTIONS).describe("on · off · toggle · brightness · color · temperature · effect · status"),
    value: z
      .string()
      .optional()
      .describe(
        "brightness: 0-100 · color: nombre ('rojo', 'azul', 'blanco cálido'…) o 'hue sat val' · " +
          "temperature: 2700-5000 o cálido/neutro/frío · effect: nombre del efecto (o alias: océano, arcoíris, tormenta…)",
      ),
  },
  async (args) => {
    const res = await lightsCommand(args.action, args.value);
    return text(res.ok ? `Listo: ${res.detail}.` : `No pude: ${res.error}`);
  },
);

export const hermesMcpServer = createSdkMcpServer({
  name: "hermes",
  version: "0.1.0",
  tools: [
    searchKnowledgeTool,
    saveMemoryTool,
    searchMemoryTool,
    savePreferenceTool,
    getProjectStatusTool,
    updateProjectNoteTool,
    searchVaultTool,
    captureIdeaTool,
    getRecentActivityTool,
    searchMeetingsTool,
    analyzeYouTubeTool,
    queryCodeGraphTool,
    createLinearIssueTool,
    listLinearIssuesTool,
    logTransactionTool,
    listTransactionsTool,
    getFinanceSummaryTool,
    getBalanceTool,
    setWalletBalanceTool,
    setBudgetTool,
    logHabitTool,
    getHabitsTodayTool,
    manageHabitTool,
    updateGoalTool,
    createContentIdeaTool,
    listContentPiecesTool,
    controlLightsTool,
  ],
});

/** Nombres completos para allowedTools. */
export const HERMES_TOOL_NAMES = [
  "mcp__hermes__search_knowledge",
  "mcp__hermes__save_memory",
  "mcp__hermes__search_memory",
  "mcp__hermes__save_preference",
  "mcp__hermes__get_project_status",
  "mcp__hermes__update_project_note",
  "mcp__hermes__search_vault",
  "mcp__hermes__capture_idea",
  "mcp__hermes__get_recent_activity",
  "mcp__hermes__search_meetings",
  "mcp__hermes__analyze_youtube",
  "mcp__hermes__query_code_graph",
  "mcp__hermes__create_linear_issue",
  "mcp__hermes__list_linear_issues",
  "mcp__hermes__log_transaction",
  "mcp__hermes__list_transactions",
  "mcp__hermes__get_finance_summary",
  "mcp__hermes__get_balance",
  "mcp__hermes__set_wallet_balance",
  "mcp__hermes__set_budget",
  "mcp__hermes__log_habit",
  "mcp__hermes__get_habits_today",
  "mcp__hermes__manage_habit",
  "mcp__hermes__update_goal",
  "mcp__hermes__create_content_idea",
  "mcp__hermes__list_content_pieces",
  "mcp__hermes__control_lights",
];
