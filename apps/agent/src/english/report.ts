/**
 * Reporte post-sesión de práctica de inglés (patrón meetings/ingest.ts):
 * Agent SDK + tool MCP acotada → markdown con análisis en español, errores
 * recurrentes y drills para la próxima sesión. Los drills alimentan
 * {{practice_context}} → la siguiente clase abre calentando con ellos.
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { env } from "../env.js";
import { emit } from "../events.js";
import { getEnglishSession, listEnglishSessions, updateSessionReport } from "./store.js";
import { OWNER, ownerBlurb } from "../owner.js";

const MAX_TRANSCRIPT_CHARS = 60_000;

/** Genera el reporte en background; el estado viaja por report_status. */
export async function generatePracticeReport(sessionId: number): Promise<void> {
  const session = await getEnglishSession(sessionId);
  if (!session) return;
  // Sin transcript ni errores no hay nada que analizar (cierre abrupto muy corto).
  if (!session.transcript?.trim() && !session.errors.length) {
    await updateSessionReport(sessionId, { report_status: "skipped" });
    return;
  }
  await updateSessionReport(sessionId, { report_status: "running" });

  let captured: { report_md: string } | null = null;
  const recordTool = tool(
    "record_practice_report",
    "Registra el reporte de la sesión de práctica de inglés. Llámala UNA sola vez.",
    {
      report_md: z
        .string()
        .describe(
          "Reporte en markdown con EXACTAMENTE estas secciones: '## Análisis' (3-6 líneas en español sobre fluidez/claridad, citando frases reales), '## Errores recurrentes' (bullets: \"quote\" → \"corrección\" — regla en español; prioriza los que se repiten entre sesiones), '## Drills' (3 ejercicios hablados concretos para la próxima sesión, una línea cada uno).",
        ),
      recurring_errors: z
        .array(z.string())
        .max(5)
        .describe("Etiquetas cortas de los patrones que se repiten (ej: 'preposiciones on/in')."),
      drills: z
        .array(z.string())
        .max(3)
        .describe("Los 3 drills, una línea cada uno (mismos del report_md)."),
    },
    async (args) => {
      captured = { report_md: args.report_md };
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({ name: "english", version: "0.1.0", tools: [recordTool] });

  try {
    const previous = (await listEnglishSessions(6)).filter((s) => s.id !== sessionId);
    const prevErrors = previous
      .flatMap((s) => s.errors)
      .slice(0, 12)
      .map((e) => `- "${e.quote}" → "${e.correction}"`)
      .join("\n");
    const sessionErrors = session.errors
      .map((e) => `- "${e.quote}" → "${e.correction}"${e.note_es ? ` (${e.note_es})` : ""}`)
      .join("\n");

    const q = query({
      prompt: `Sesión de HOY (fluidez ${session.fluency ?? "?"}/5, temas: ${session.topics.join(", ") || "—"}):

Errores anotados por el tutor:
${sessionErrors || "(ninguno anotado)"}

Aciertos: ${session.wins.join(" · ") || "—"}

${prevErrors ? `Errores de sesiones ANTERIORES (busca recurrencias):\n${prevErrors}\n` : ""}
Transcript:
"""
${(session.transcript ?? "").slice(0, MAX_TRANSCRIPT_CHARS)}
"""

Analiza la sesión y llama a record_practice_report.`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: `# Hermes — Coach de inglés de ${OWNER}

Eres el coach que analiza las sesiones de práctica de inglés hablado de ${OWNER}${ownerBlurb("Inglés", " (hispanohablante que practica inglés hablado)")}. Recibes el transcript y los errores anotados por el tutor de voz.

Reglas:
- El análisis va en ESPAÑOL; los ejemplos y correcciones en inglés.
- Cita frases REALES del transcript — nada de generalidades.
- Prioriza patrones que se REPITEN entre sesiones sobre errores puntuales.
- Los drills deben ser hablados y concretos ("describe tu proyecto actual usando solo pasado perfecto", no "estudiar gramática").
- Responde SIEMPRE llamando a la tool record_practice_report UNA sola vez.`,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 6,
        settingSources: [],
        mcpServers: { english: server },
        allowedTools: ["mcp__english__record_practice_report"],
        permissionMode: "default",
      },
    });
    for await (const message of q) void message;

    if (!captured) throw new Error("el modelo no llamó record_practice_report");
    await updateSessionReport(sessionId, {
      report_md: (captured as { report_md: string }).report_md,
      report_status: "done",
    });
    emit({
      kind: "task_done",
      taskId: `english-report-${sessionId}`,
      detail: "reporte de inglés listo — míralo en /vida",
    });
  } catch (err) {
    console.error("[english] reporte:", String(err).slice(0, 200));
    await updateSessionReport(sessionId, { report_status: "error" });
  }
}
