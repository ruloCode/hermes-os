import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { appendFile, mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { env } from "../env.js";
import { saveMemory, searchMemory, savePreference } from "../memory.js";
import { readProjects } from "../vault/projects.js";
import { searchMeetings } from "../meetings/store.js";
import { supabase } from "../supabase.js";

const execFileAsync = promisify(execFile);

const MEMORY_TYPES = ["user", "feedback", "project", "reference", "daily", "agent"] as const;

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

// ── Tools MCP in-process del servidor "hermes" ─────────────────────────

const saveMemoryTool = tool(
  "save_memory",
  "Guarda una memoria persistente en Supabase (compartida entre todas las máquinas de Rulo). Úsala al aprender algo nuevo sobre Rulo, sus proyectos o al terminar tareas significativas.",
  {
    content: z.string().describe("El contenido de la memoria, autocontenido y claro"),
    type: z.enum(MEMORY_TYPES).describe("user=sobre Rulo, feedback=correcciones, project=proyectos, reference=links/recursos, daily=diario, agent=aprendizajes propios"),
    project: z.string().optional().describe("Slug del proyecto relacionado (ej: ternium, zylen)"),
    tags: z.array(z.string()).optional(),
    importance: z.number().min(1).max(5).optional().describe("1=trivial, 5=crítico"),
  },
  async (args) => text(await saveMemory({ ...args, source: "agent" })),
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
  "Guarda una preferencia de Rulo (clave-valor). Ej: key='package_manager', value='pnpm'.",
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

export const hermesMcpServer = createSdkMcpServer({
  name: "hermes",
  version: "0.1.0",
  tools: [
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
  ],
});

/** Nombres completos para allowedTools. */
export const HERMES_TOOL_NAMES = [
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
];
