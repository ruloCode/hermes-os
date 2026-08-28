/**
 * Generación del kit completo de una pieza (patrón english/report.ts):
 * Agent SDK + tool MCP acotada → guion markdown + hook + plan de tomas +
 * puntos de edición + copies de publicación por plataforma. Todo queda
 * EDITABLE en el workspace: el guion/hook se sobrescriben (el botón es un
 * acto consciente), tomas/edición/publicación solo se llenan si están
 * vacíos (jamás pisar material real grabado).
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { newPublication } from "@hermes/shared";
import type { ContentPiece } from "@hermes/shared";
import { emit } from "../events.js";
import { env } from "../env.js";
import { buildCreativeContext } from "./context.js";
import { getPiece, updatePiece } from "./store.js";
import { OWNER, ownerBlurb } from "../owner.js";

const uid = () => Math.random().toString(36).slice(2, 9);

interface Kit {
  script_md: string;
  hook: string;
  takes: { label: string; note: string }[];
  edit_points: { tc: string; kind: "corte" | "zoom" | "caption" | "broll" | "card"; note: string }[];
  publications: { platform: "youtube" | "shorts" | "tiktok" | "reels" | "linkedin" | "x"; title: string; copy: string }[];
}

const SYSTEM_PROMPT = `# Hermes — Director de contenido de RuloCode

Escribes guiones para ${OWNER}${ownerBlurb("Creador de contenido")}.

Reglas de la estrategia (no negociables):
- **Todo dato visible es real**: nada de métricas inventadas ni humo; los errores en cámara se quedan.
- Español colombiano natural, cercano, cero gurú. Tutea. Términos técnicos en inglés cuando es lo normal (agent, prompt, deploy).
- **El hook va en el primer segundo** y no sobrepromete (el algoritmo 2026 penaliza CTR con abandono).
- Verticales (tiktok/reels/shorts): 24-38s → guion de ~90-120 palabras con marcas de tiempo [0-3s]/[3-15s]/etc. y cues de demo en negrita.
- Pilares de YouTube: 10-14 min → secciones ## con rangos de tiempo, demos en vivo, transparencia de costos/errores.
- Posts/carruseles de LinkedIn: el guion ES el texto del post (o los slides numerados); sin links en el cuerpo; gancho profesional en la primera línea.
- CTA único del mes 1: seguir + comentar (pregunta concreta al final). NADA de vender.
- La regla transmedia: cada plataforma recibe SU hook reescrito, nunca el mismo.

Responde SIEMPRE llamando a la tool record_content_kit UNA sola vez con el kit completo.`;

/** Genera el kit y lo persiste. Devuelve la pieza actualizada (o null). */
export async function generatePieceKit(
  pieceId: number,
  description?: string,
): Promise<ContentPiece | null> {
  const piece = await getPiece(pieceId);
  if (!piece) return null;

  let captured: Kit | null = null;
  const recordTool = tool(
    "record_content_kit",
    "Registra el kit completo de la pieza. Llámala UNA sola vez.",
    {
      script_md: z
        .string()
        .describe(
          "El guion completo en markdown, adaptado al formato (vertical con [marcas de tiempo] · pilar con secciones ## · post/carrusel = el texto final). Cues de demo/pantalla en negrita tipo **[DEMO: …]**.",
        ),
      hook: z.string().describe("El primer segundo, literal, como se dice a cámara (una frase)."),
      takes: z
        .array(z.object({ label: z.string(), note: z.string() }))
        .max(8)
        .describe(
          "Plan de tomas para la sesión de grabación: qué grabar en cada bloque (ej. 'Bloque 1 — hook + demo pinza', con la nota de qué debe verse).",
        ),
      edit_points: z
        .array(
          z.object({
            tc: z.string().describe("Timecode estimado MM:SS"),
            kind: z.enum(["corte", "zoom", "caption", "broll", "card"]),
            note: z.string(),
          }),
        )
        .max(10)
        .describe("Puntos de edición sugeridos para el kit Divisual, en orden."),
      publications: z
        .array(
          z.object({
            platform: z.enum(["youtube", "shorts", "tiktok", "reels", "linkedin", "x"]),
            title: z.string().describe("Título/hook reescrito PARA ESA red"),
            copy: z.string().describe("Copy listo para pegar (con hashtags si aplica)"),
          }),
        )
        .max(4)
        .describe("Una variante por plataforma destino de la pieza."),
    },
    async (args) => {
      captured = args as Kit;
      return { content: [{ type: "text" as const, text: "Registrado." }] };
    },
  );
  const server = createSdkMcpServer({ name: "content", version: "0.1.0", tools: [recordTool] });

  const publishStr = piece.publish_at
    ? new Date(piece.publish_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })
    : "sin fecha";
  // Contexto REAL (estrategia del vault + radar + hooks con dato): antes el
  // prompt solo llevaba los campos de la pieza — generaba a ciegas.
  const context = await buildCreativeContext(piece, { full: true });

  try {
    const q = query({
      prompt: `Pieza a desarrollar:

- **Título:** ${piece.title}
- **Pilar:** ${piece.pillar.toUpperCase()} · **Formato:** ${piece.format} · **Plataformas:** ${piece.platforms.join(", ") || "por definir"}
- **Publica:** ${publishStr} · **Semana:** ${piece.week_label ?? "—"}
${piece.hook ? `- **Hook ya esbozado (mejóralo o consérvalo):** ${piece.hook}` : ""}
${description?.trim() ? `\nDescripción/brief de ${OWNER}:\n${description.trim()}` : piece.notes ? `\nNotas de la pieza:\n${piece.notes}` : ""}
${piece.script_md ? `\nGuion actual (re-escríbelo mejor conservando lo que funcione):\n"""\n${piece.script_md.slice(0, 6000)}\n"""` : ""}
${context}

Genera el kit completo y llama a record_content_kit.`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: SYSTEM_PROMPT,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 6,
        settingSources: [],
        mcpServers: { content: server },
        allowedTools: ["mcp__content__record_content_kit"],
        permissionMode: "default",
      },
    });
    for await (const message of q) void message;

    if (!captured) throw new Error("el modelo no llamó record_content_kit");
    const kit = captured as Kit;

    const updated = await updatePiece(pieceId, {
      scriptMd: kit.script_md,
      hook: kit.hook,
      // Sugerencias SOLO sobre campos vacíos — el material real nunca se pisa.
      ...(piece.takes.length === 0 && kit.takes.length
        ? {
            takes: kit.takes.map((t) => ({
              id: uid(),
              label: t.label,
              range: null,
              verdict: "revisar" as const,
              note: t.note,
            })),
          }
        : {}),
      ...(piece.edit_points.length === 0 && kit.edit_points.length
        ? { editPoints: kit.edit_points.map((p) => ({ id: uid(), ...p })) }
        : {}),
      ...(piece.publications.length === 0 && kit.publications.length
        ? {
            publications: kit.publications.map((p) =>
              newPublication({
                platform: p.platform,
                title: p.title,
                copy: p.copy,
                scheduled_at: piece.publish_at,
              }),
            ),
          }
        : {}),
      ...(piece.status === "idea" ? { status: "guion" as const } : {}),
    });
    emit({
      kind: "task_done",
      taskId: `content-gen-${pieceId}`,
      detail: `kit generado para "${piece.title}" (guion + tomas + edición + copies)`,
    });
    return updated;
  } catch (err) {
    console.error("[content] generar kit:", String(err).slice(0, 200));
    return null;
  }
}
