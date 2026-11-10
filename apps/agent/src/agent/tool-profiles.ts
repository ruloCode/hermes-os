/**
 * Qué tools carga cada canal (spec «sesion», requisito «Tools por canal»).
 *
 * Antes TODO turno registraba hermes + el MCP remoto de Linear + chrome-devtools
 * y las ~24 tools integradas del CLI. Cada definición viaja en el prefijo de
 * CADA llamada: lo que un canal no usa se paga igual (y en el teléfono, además,
 * el MCP de Chrome abre un navegador de la Mac que nadie está mirando).
 *
 * Medido el 2026-11-10 con el SDK 0.3.322 (un turno trivial, Haiku, sin MCP):
 *  - sin `tools` (las 24 integradas por defecto): 24.608 tokens de prefijo
 *  - con las 10 de abajo: 18.993
 *  - con `tools: []`: 10.398
 * Las integradas por defecto incluyen Task, CronCreate/Delete/List, DesignSync,
 * EnterWorktree/ExitWorktree, ListAgents, Monitor, NotebookEdit,
 * PushNotification, ReportFindings, ScheduleWakeup, SendMessage, TaskStop y
 * Workflow: herramientas de sesiones de trabajo de Claude Code que el chat de
 * Hermes nunca usa (sus tareas largas van por run_task / schedule_task, que son
 * tools de Hermes).
 *
 * Lógica pura: quien decide si Linear o el navegador existen en ESTA máquina
 * (llave, binario) lo pasa en `available`.
 */

export type ToolProfile = "chat-web" | "chat-phone" | "task" | "scheduled";

export type McpServerName = "hermes" | "linear" | "chrome-devtools";

export interface ToolProfileSpec {
  /** Servidores MCP que se registran (en este orden). */
  mcpServers: McpServerName[];
  /**
   * Tools integradas del CLI (`options.tools`). null = el conjunto por defecto
   * del CLI (no se manda la opción): las tareas siguen teniendo todo.
   */
  builtinTools: string[] | null;
}

/**
 * Las integradas que el chat sí usa: leer y buscar (Read/Glob/Grep — Glob y
 * Grep hay que nombrarlos: en builds nativos no vienen por defecto), Bash y
 * edición (pasan por el guardrail), la web, `Skill` (carga los procedimientos
 * del plugin de Hermes) y `ToolSearch` (si el CLI difiere tools detrás de la
 * búsqueda, sin ella el modelo no las encuentra).
 */
export const CHAT_BUILTIN_TOOLS = ["Read", "Glob", "Grep", "Bash", "Write", "Edit", "WebSearch", "WebFetch", "Skill", "ToolSearch"] as const;

export function toolProfileSpec(profile: ToolProfile, available: { linear: boolean; browser: boolean }): ToolProfileSpec {
  const all: McpServerName[] = ["hermes", ...(available.linear ? (["linear"] as const) : []), ...(available.browser ? (["chrome-devtools"] as const) : [])];
  switch (profile) {
    case "task":
    case "scheduled":
      return { mcpServers: all, builtinTools: null };
    case "chat-web":
      return { mcpServers: all, builtinTools: [...CHAT_BUILTIN_TOOLS] };
    case "chat-phone":
      // Desde el teléfono: sin navegador de la Mac ni el catálogo remoto de
      // Linear (create_linear_issue / list_linear_issues siguen: son de Hermes).
      return { mcpServers: ["hermes"], builtinTools: [...CHAT_BUILTIN_TOOLS] };
  }
}

/** El perfil de un turno de chat según quién escribe (`X-Hermes-Client`). */
export function chatProfile(client: string | undefined): ToolProfile {
  return client === "phone" ? "chat-phone" : "chat-web";
}
