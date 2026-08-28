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

  parts.push(`# Hermes — AI OS personal de ${OWNER}

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
  - create_linear_issue / list_linear_issues: manejo de tareas en Linear. Al crear un issue, PRIMERO junta contexto real (get_project_status, search_knowledge, query_code_graph) y luego redacta: título imperativo específico; description en markdown con qué/por qué, archivos o rutas relevantes y criterios de aceptación; y prompt = un prompt AUTOCONTENIDO listo para copiar-pegar en Claude Code (ruta local del repo, instrucciones concretas, criterios de aceptación y cómo verificar) — se publica al final del issue como bloque "Copy prompt". Lista antes de crear si sospechas duplicado; pasa project (slug del vault) para que quede etiquetado.
  - mcp__linear__* (MCP oficial de Linear, si está conectado): para TODO lo demás de Linear — actualizar estado/prioridad/asignación, comentar, buscar issues o proyectos, ciclos. Para CREAR issues usa SIEMPRE create_linear_issue (garantiza el bloque Copy prompt); nunca crees issues con el MCP.
  - mcp__chrome-devtools__* (si están disponibles): NAVEGAR la web de verdad en un Chrome dedicado VISIBLE (perfil "Hermes", con sesiones persistidas). Flujo: navega a la página → toma un snapshot para ver los elementos y sus uids → interactúa (click/llenar) con esos uids → verifica con otro snapshot. ${OWNER} está VIENDO esa ventana: no cierres pestañas que no abriste. Si un sitio pide login, no intentes credenciales — reporta que ${OWNER} inicie sesión una vez en ese perfil.
- Guarda memorias proactivamente al final de tareas significativas (qué se hizo, qué se aprendió). Escribe cada memoria autocontenida (con nombres y contexto): así la búsqueda semántica la encuentra después.
- No hagas cambios destructivos. No uses sudo. No borres fuera del vault sin instrucción explícita.`);

  // Persona y preferencias del dueño (SOUL.md, fuera del repo)
  const soul = soulPromptBlock();
  if (soul) parts.push(soul);

  // Perfil del usuario (si existe)
  try {
    const perfil = await readFile(join(env.VAULT_PATH, "10 Notas", "Perfil.md"), "utf8");
    parts.push(`# Perfil de ${OWNER}\n${perfil.slice(0, 4000)}`);
  } catch {
    /* sin perfil */
  }

  // Proyectos activos (resumen corto)
  const projects = await readProjects();

  // Scope "vida" (chat de la página /vida): modo asesor financiero con
  // datos frescos al frente del prompt. No es un proyecto del vault.
  if (focusSlug?.toLowerCase() === "vida") {
    try {
      parts.splice(1, 0, await buildVidaContext());
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
      `# Preferencias de ${OWNER}\n` +
        prefKeys.map(([k, v]) => `- ${k}: ${JSON.stringify(v)}`).join("\n"),
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
      `# Lo que Hermes ya sabe (memorias recientes + contexto relevante al mensaje)\n` +
        lines.join("\n") +
        `\n\nSi necesitas más contexto sobre algo mencionado aquí, amplía con search_knowledge.`,
    );
  }

  return parts.join("\n\n---\n\n");
}
