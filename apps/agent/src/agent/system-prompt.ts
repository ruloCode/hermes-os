import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env.js";
import { readProjects } from "../vault/projects.js";
import { listPreferences, recentMemories } from "../memory.js";
import { searchKnowledge } from "../knowledge.js";
import { getFinanceSummary, summaryToText } from "../finance/advisor.js";
import { balancesToText } from "../finance/wallets.js";
import { habitsToday } from "../habits/store.js";
import { listGoals } from "../habits/goals.js";
import { OWNER, soulPromptBlock } from "../owner.js";
import { profilePromptBlock } from "../profile.js";
import { listSkills } from "../learning/skills.js";
import { promptFromParts, type CapturedPrompt } from "@hermes/shared";

/**
 * Contexto de ASESOR FINANCIERO para el chat de la página /vida (scope
 * "vida"): saldo por billetera + resumen del mes (COP y USD) + hábitos y
 * metas, SIEMPRE frescos (se arma en cada turno, server-side). El agente ya
 * tiene las tools mcp__hermes__* de finanzas para bajar al detalle.
 */
async function buildVidaContext(): Promise<string> {
  const [saldo, cop, usd, habits, goals] = await Promise.all([
    balancesToText(),
    getFinanceSummary(undefined, "COP"),
    getFinanceSummary(undefined, "USD"),
    habitsToday(),
    listGoals("active"),
  ]);
  const lines: string[] = [
    `# 🎯 MODO ASESOR FINANCIERO — página Vida
El usuario está en su página VIDA (finanzas personales + hábitos + metas) hablando contigo como SU ASESOR FINANCIERO y coach personal. Sé cercano, concreto y accionable; sin regañar. Analiza con las cifras REALES de abajo — nunca inventes números.`,
  ];
  if (saldo) lines.push(saldo);
  if (cop.tx_count) lines.push(summaryToText(cop));
  if (usd.tx_count) lines.push(summaryToText(usd));
  if (habits.length) {
    const pend = habits.filter((h) => !h.done_today).map((h) => h.name);
    lines.push(
      `Hábitos de hoy: ${habits
        .map((h) => `${h.done_today ? "✓" : "○"} ${h.name} (racha ${h.streak})`)
        .join(" · ")}${pend.length ? ` — pendientes: ${pend.join(", ")}` : ""}.`,
    );
  }
  if (goals.length) {
    lines.push(
      `Metas activas: ${goals
        .map((g) =>
          g.target_value != null
            ? `${g.title} ${g.current_value}/${g.target_value}${g.unit ? ` ${g.unit}` : ""}`
            : `${g.title} (${g.milestones.filter((m) => m.done).length}/${g.milestones.length} hitos)`,
        )
        .join(" · ")}.`,
    );
  }
  lines.push(
    `Herramientas de asesor (mcp__hermes__*): log_transaction registra gastos/ingresos al vuelo (con account si nombra billetera: bancolombia, nu, nequi, ontop — el saldo se ajusta solo); get_balance el saldo vivo; set_wallet_balance recalibra una billetera; get_finance_summary y list_transactions para análisis con detalle; set_budget presupuestos; log_habit / get_habits_today / manage_habit / update_goal para hábitos y metas. Si ${OWNER} menciona un gasto, regístralo sin pedir permiso y confírmalo en una frase.`,
  );
  return lines.join("\n\n");
}

/** Separador entre secciones del prompt. */
export const PROMPT_SEPARATOR = "\n\n---\n\n";

/**
 * Una sección del prompt con el PORQUÉ escrito aquí, junto a ella: la Oficina
 * lo muestra en tarima al lado del texto exacto que se envió. `why: null` =
 * sin motivo escrito (no se inventa uno). `personal` = datos del dueño: en la
 * vista pública se ve el título y "oculto en vista pública".
 */
interface PromptPart {
  id: string;
  title: string;
  why: string | null;
  personal?: boolean;
  text: string;
}

// ── Por qué existe cada sección (fuente: CLAUDE.md y docs/) ─────────────
const WHY = {
  identity:
    "Se arma a mano y no con el autoload del CLI (settingSources: []): el agente corre con cwd en el vault o en cualquier repo y su identidad no puede depender del CLAUDE.md que haya ahí. Las reglas de cada tool están porque sin ellas el modelo elige mal: crear issues va SIEMPRE por create_linear_issue porque el bloque Copy prompt lo garantiza el código, no el modelo; query_code_graph es UNA tool y no las 17 del servidor, que costarían ~4.600 tokens fijos en cada turno; update_profile tiene tope duro y al llenarse falla para que el modelo consolide; el navegador es un Chrome dedicado con sesiones persistidas porque Chrome 136+ bloquea CDP en el perfil personal.",
  vida: "Scope de la página Vida: el asesor financiero necesita saldos y el resumen del mes FRESCOS, así que se arman en cada turno, del lado del servidor, y van al frente del prompt. Nunca inventa números: las cifras están aquí y el detalle sale de las tools de finanzas.",
  focus: "El usuario eligió un proyecto en el dashboard: su estado completo va al frente del prompt. El vault es la verdad de los proyectos (frontmatter `estado` + secciones Estado Actual / Tareas Pendientes).",
  soul: "La identidad del dueño vive fuera del código (~/.hermes-os/SOUL.md, la escribe el humano): el mismo repo corre en la máquina de cualquiera con su .env y su SOUL.md. Regla del repo: ningún nombre propio en el código.",
  profile:
    "USER.md lo mantiene Hermes con update_profile. Tope duro de 1.400 caracteres sin auto-compactar: al pasarse la escritura falla y el agente consolida. Es un snapshot al abrir la sesión, porque recargarlo a mitad reconstruiría el system prompt y tiraría el prefijo cacheado.",
  vaultProfile: null,
  projects: "El vault es la verdad de los proyectos: el resumen de los activos va en el prompt para que el modelo no invente su estado (regla del bloque de identidad); el detalle se pide con get_project_status.",
  preferences: null,
  knowledge:
    "Capa de conocimiento unificada (match_knowledge, migraciones 009/010): una sola búsqueda semántica cubre memorias, reuniones, ejecuciones, conversaciones de texto y voz y el vault. Va lo reciente más lo relevante al primer mensaje; para más, search_knowledge.",
  skills:
    "Las skills son memoria procedimental y viven como plugin local del CLI: el prompt lleva solo el ÍNDICE (nombre y descripción) y el cuerpo lo carga el CLI cuando hace falta. Por eso la descripción tiene tope de 120 caracteres: el índice trunca ahí y lo que se pasa nunca rutea.",
} as const;

/**
 * Ensambla el system prompt de Hermes explícitamente (no dependemos del
 * autoload por cwd): identidad + perfil del vault + proyectos activos +
 * preferencias + memorias recientes y relevantes al primer mensaje.
 */
export async function buildSystemPrompt(firstUserMessage?: string, focusSlug?: string): Promise<string> {
  return (await buildSystemPromptCaptured(firstUserMessage, focusSlug)).raw;
}

/** El mismo prompt, con sus secciones como rangos del string exacto (lo que la Oficina muestra en tarima). */
export async function buildSystemPromptCaptured(
  firstUserMessage?: string,
  focusSlug?: string,
): Promise<CapturedPrompt> {
  const parts: PromptPart[] = [];
  const part = (id: keyof typeof WHY, title: string, text: string, personal = false): PromptPart => ({ id, title, why: WHY[id], ...(personal ? { personal } : {}), text });

  parts.push(part("identity", "Identidad y reglas de las tools", `# Hermes — AI OS personal de ${OWNER}

Eres **Hermes**, el sistema operativo de IA personal de ${OWNER}. Corres LOCALMENTE en su máquina (${env.MACHINE_NAME}) con acceso real a bash, archivos y su vault de Obsidian en: ${env.VAULT_PATH}

Reglas:
- Responde SIEMPRE en español, conciso y accionable.
- Cuando toques código o conceptos técnicos, sé didáctico: explica el porqué.
- El vault es la fuente de verdad de proyectos y conocimiento. Léelo cuando necesites contexto real; NUNCA inventes el estado de un proyecto.
- Usa las tools mcp__hermes__* para memoria y proyectos:
  - search_knowledge: TU PRIMERA opción para contexto histórico. Busca semánticamente en TODO lo que sabes: memorias, reuniones, ejecuciones de tareas, conversaciones pasadas (texto y voz) y notas del vault. Úsala SIEMPRE antes de preguntar algo que podrías saber.
  - save_memory: guarda hechos/aprendizajes que valga la pena recordar entre sesiones.
  - save_preference: guarda preferencias de ${OWNER} cuando exprese una ("prefiero X").
  - search_memory / search_meetings / get_recent_activity: búsquedas acotadas a una sola fuente.
  - query_code_graph: preguntas sobre la estructura del código de hermes-os (qué depende de qué, dónde vive un módulo, cómo se conectan dos partes). Prefiérela sobre leer archivos a ciegas.
  - get_project_status / update_project_note: leer y persistir estado de proyectos.
  - capture_idea: ideas sueltas van al Inbox del vault.
  - update_profile: el perfil de ${OWNER} (USER.md) — algo duradero sobre él o sobre cómo trabajar con él. Tiene un tope duro de caracteres: si se llena, consolida entradas parecidas en vez de insistir. NO es para hechos de un proyecto (eso es save_memory).
  - schedule_task / list_scheduled_tasks: trabajo que debe repetirse sin que nadie lo dispare ("cada lunes a las 8…", "todos los días al final del día…"). Confirma SIEMPRE la interpretación del horario que te devuelve la tool.
  - manage_skill: cuando acabes de resolver un procedimiento multi-paso que se va a repetir, guárdalo como skill (action='create'); si usaste una y se quedó corta, mejórala (action='patch'). No dupliques las que ya están listadas abajo.
  - create_linear_issue / list_linear_issues: manejo de tareas en Linear. Al crear un issue, PRIMERO junta contexto real (get_project_status, search_knowledge, query_code_graph) y luego redacta: título imperativo específico; description en markdown con qué/por qué, archivos o rutas relevantes y criterios de aceptación; y prompt = un prompt AUTOCONTENIDO listo para copiar-pegar en Claude Code (ruta local del repo, instrucciones concretas, criterios de aceptación y cómo verificar) — se publica al final del issue como bloque "Copy prompt". Lista antes de crear si sospechas duplicado; pasa project (slug del vault) para que quede etiquetado.
  - mcp__linear__* (MCP oficial de Linear, si está conectado): para TODO lo demás de Linear — actualizar estado/prioridad/asignación, comentar, buscar issues o proyectos, ciclos. Para CREAR issues usa SIEMPRE create_linear_issue (garantiza el bloque Copy prompt); nunca crees issues con el MCP.
  - mcp__chrome-devtools__* (si están disponibles): NAVEGAR la web de verdad en un Chrome dedicado VISIBLE (perfil "Hermes", con sesiones persistidas). Flujo: navega a la página → toma un snapshot para ver los elementos y sus uids → interactúa (click/llenar) con esos uids → verifica con otro snapshot. ${OWNER} está VIENDO esa ventana: no cierres pestañas que no abriste. Si un sitio pide login, no intentes credenciales — reporta que ${OWNER} inicie sesión una vez en ese perfil.
- Guarda memorias proactivamente al final de tareas significativas (qué se hizo, qué se aprendió). Escribe cada memoria autocontenida (con nombres y contexto): así la búsqueda semántica la encuentra después.
- No hagas cambios destructivos. No uses sudo. No borres fuera del vault sin instrucción explícita.`));

  // Persona y preferencias del dueño (SOUL.md, fuera del repo)
  const soul = soulPromptBlock();
  if (soul) parts.push(part("soul", "SOUL.md (persona del dueño)", soul, true));

  // Perfil que Hermes mantiene solo (USER.md). Snapshot al abrir la sesión:
  // lo que se escriba durante la conversación manda desde la SIGUIENTE, para
  // no reconstruir el prompt a mitad y tirar el prefijo cacheado.
  const profile = await profilePromptBlock();
  if (profile) parts.push(part("profile", "USER.md (perfil que mantiene Hermes)", profile, true));

  // Perfil del usuario (si existe)
  try {
    const perfil = await readFile(join(env.VAULT_PATH, "10 Notas", "Perfil.md"), "utf8");
    parts.push(part("vaultProfile", "Perfil del vault (Perfil.md)", `# Perfil de ${OWNER}\n${perfil.slice(0, 4000)}`, true));
  } catch {
    /* sin perfil */
  }

  // Proyectos activos (resumen corto)
  const projects = await readProjects();

  // Scope "vida" (chat de la página /vida): modo asesor financiero con
  // datos frescos al frente del prompt. No es un proyecto del vault.
  if (focusSlug?.toLowerCase() === "vida") {
    try {
      parts.splice(1, 0, part("vida", "Modo asesor financiero (página Vida)", await buildVidaContext(), true));
    } catch (err) {
      console.error("[system-prompt] contexto vida:", err);
    }
  }

  // Foco de conversación: si el usuario eligió un proyecto en el dashboard,
  // lo ponemos al frente del prompt con su estado completo.
  if (focusSlug && focusSlug.toLowerCase() !== "vida") {
    const fp = projects.find((p) => p.slug.toLowerCase() === focusSlug.toLowerCase());
    if (fp) {
      parts.splice(
        1,
        0,
        part("focus", `Foco de conversación: ${fp.name}`, `# 🎯 FOCO DE CONVERSACIÓN — ${fp.name}
El usuario eligió hablar específicamente del proyecto **${fp.name}** (\`${fp.slug}\`). Centra tus respuestas en este proyecto salvo que pida explícitamente otra cosa.
Estado actual:
${fp.estado_actual.slice(0, 1000) || "(sin sección de estado)"}
Pendientes: ${fp.tareas_pendientes.slice(0, 6).join("; ") || "—"}
Si necesitas más detalle, usa get_project_status('${fp.slug}') o lee su nota en el vault.`),
      );
    }
  }

  const activos = projects.filter((p) => p.estado === "activo");
  if (activos.length) {
    parts.push(
      part("projects", "Proyectos activos", `# Proyectos activos\n` +
        activos
          .map(
            (p) =>
              `## ${p.name} (${p.slug})\n${p.estado_actual.slice(0, 500)}\nPendientes: ${p.tareas_pendientes.slice(0, 4).join("; ") || "—"}`,
          )
          .join("\n\n")),
    );
  }

  // Preferencias
  const prefs = await listPreferences();
  const prefKeys = Object.entries(prefs);
  if (prefKeys.length) {
    parts.push(
      part("preferences", "Preferencias del dueño", `# Preferencias de ${OWNER}\n` +
        prefKeys.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n"), true),
    );
  }

  // Memorias recientes + conocimiento relevante al primer mensaje.
  // El retrieval es UNIFICADO (match_knowledge): memorias, reuniones,
  // ejecuciones, conversaciones pasadas (texto/voz) y notas del vault.
  const recent = await recentMemories(5);
  const relevant = firstUserMessage
    ? await searchKnowledge(firstUserMessage, { limit: 8 })
    : [];
  const seenMemories = new Set<string>(recent.map((m) => m.id));
  const lines = recent.map(
    (m) =>
      `- [memoria·${m.type}${m.project_slug ? `·${m.project_slug}` : ""}] ${(m.summary || m.content).slice(0, 300)}`,
  );
  const labels: Record<string, string> = {
    memory: "memoria",
    meeting: "reunión",
    execution: "ejecución",
    conversation: "chat",
    vault: "vault",
  };
  for (const h of relevant) {
    if (h.source === "memory" && seenMemories.has(h.ref)) continue;
    const label = labels[h.source] ?? h.source;
    const scope = h.project_slug ? `·${h.project_slug}` : "";
    const body = h.content.replace(/\s+/g, " ").trim().slice(0, 300);
    lines.push(`- [${label}${scope} ${h.created_at.slice(0, 10)}] ${body}`);
  }
  if (lines.length) {
    parts.push(
      part("knowledge", "Lo que Hermes ya sabe (memorias y contexto)", `# Lo que Hermes ya sabe (memorias recientes + contexto relevante al mensaje)\n` +
        lines.join("\n") +
        `\n\nSi necesitas más contexto sobre algo mencionado aquí, amplía con search_knowledge.`, true),
    );
  }

  // Índice de skills: solo nombre y descripción. El cuerpo lo carga el CLI
  // cuando hace falta (progressive disclosure) — por eso la descripción es
  // lo único que decide si una skill se activa o se queda dormida.
  try {
    const skills = (await listSkills()).filter((s) => s.state !== "archived");
    if (skills.length) {
      parts.push(
        part("skills", "Índice de skills", `# Procedimientos aprendidos (skills)\n` +
          `Hermes ya resolvió estos flujos antes. Si el pedido encaja con uno, cárgalo con /hermes:<nombre> ANTES de improvisar:\n` +
          skills.map((s) => `- **${s.name}**: ${s.description}`).join("\n")),
      );
    }
  } catch (err) {
    console.error("[system-prompt] skills:", err);
  }

  return promptFromParts(parts, PROMPT_SEPARATOR);
}
