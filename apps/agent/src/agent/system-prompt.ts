import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.js";
import { readProjects } from "../vault/projects.js";
import { listPreferences, recentMemories, searchMemory } from "../memory.js";

/**
 * Ensambla el system prompt de Hermes explícitamente (no dependemos del
 * autoload por cwd): identidad + perfil del vault + proyectos activos +
 * preferencias + memorias recientes y relevantes al primer mensaje.
 */
export async function buildSystemPrompt(
  firstUserMessage?: string,
  focusSlug?: string,
): Promise<string> {
  const parts: string[] = [];

  parts.push(`# Hermes — AI OS personal de RuloCode

Eres **Hermes**, el sistema operativo de IA personal de Rulo (RuloCode). Corres LOCALMENTE en su máquina (${env.MACHINE_NAME}) con acceso real a bash, archivos y su vault de Obsidian en: ${env.VAULT_PATH}

Reglas:
- Responde SIEMPRE en español, conciso y accionable.
- Cuando toques código o conceptos técnicos, sé didáctico: explica el porqué.
- El vault es la fuente de verdad de proyectos y conocimiento. Léelo cuando necesites contexto real; NUNCA inventes el estado de un proyecto.
- Usa las tools mcp__hermes__* para memoria y proyectos:
  - save_memory: guarda hechos/aprendizajes que valga la pena recordar entre sesiones.
  - save_preference: guarda preferencias de Rulo cuando exprese una ("prefiero X").
  - search_memory / get_recent_activity: consulta antes de preguntar "¿en qué quedamos?".
  - get_project_status / update_project_note: leer y persistir estado de proyectos.
  - capture_idea: ideas sueltas van al Inbox del vault.
- Guarda memorias proactivamente al final de tareas significativas (qué se hizo, qué se aprendió).
- No hagas cambios destructivos. No uses sudo. No borres fuera del vault sin instrucción explícita.`);

  // Perfil del usuario (si existe)
  try {
    const perfil = await readFile(join(env.VAULT_PATH, "10 Notas", "Perfil.md"), "utf8");
    parts.push(`# Perfil de Rulo\n${perfil.slice(0, 4000)}`);
  } catch {
    /* sin perfil */
  }

  // Proyectos activos (resumen corto)
  const projects = await readProjects();

  // Foco de conversación: si el usuario eligió un proyecto en el dashboard,
  // lo ponemos al frente del prompt con su estado completo.
  if (focusSlug) {
    const fp = projects.find((p) => p.slug.toLowerCase() === focusSlug.toLowerCase());
    if (fp) {
      parts.splice(
        1,
        0,
        `# 🎯 FOCO DE CONVERSACIÓN — ${fp.name}
El usuario eligió hablar específicamente del proyecto **${fp.name}** (\`${fp.slug}\`). Centra tus respuestas en este proyecto salvo que pida explícitamente otra cosa.
Estado actual:
${fp.estado_actual.slice(0, 1000) || "(sin sección de estado)"}
Pendientes: ${fp.tareas_pendientes.slice(0, 6).join("; ") || "—"}
Si necesitas más detalle, usa get_project_status('${fp.slug}') o lee su nota en el vault.`,
      );
    }
  }

  const activos = projects.filter((p) => p.estado === "activo");
  if (activos.length) {
    parts.push(
      `# Proyectos activos\n` +
        activos
          .map(
            (p) =>
              `## ${p.name} (${p.slug})\n${p.estado_actual.slice(0, 500)}\nPendientes: ${p.tareas_pendientes.slice(0, 4).join("; ") || "—"}`,
          )
          .join("\n\n"),
    );
  }

  // Preferencias
  const prefs = await listPreferences();
  const prefKeys = Object.entries(prefs);
  if (prefKeys.length) {
    parts.push(
      `# Preferencias de Rulo\n` +
        prefKeys.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n"),
    );
  }

  // Memorias: recientes + relevantes al primer mensaje
  const recent = await recentMemories(5);
  const relevant = firstUserMessage ? await searchMemory(firstUserMessage, undefined, 5) : [];
  const seen = new Set<string>();
  const memories = [...recent, ...relevant].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (memories.length) {
    parts.push(
      `# Memorias (recientes y relevantes)\n` +
        memories
          .map((m) => `- [${m.type}${m.project_slug ? `·${m.project_slug}` : ""}] ${(m.summary || m.content).slice(0, 300)}`)
          .join("\n"),
    );
  }

  return parts.join("\n\n---\n\n");
}
