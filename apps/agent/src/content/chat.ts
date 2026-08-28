/**
 * Chat de UNA pieza del Estudio: conversación con memoria (sesión SDK
 * resumida entre visitas) cuyo único poder es LEER y MODIFICAR esa pieza vía
 * tools acotadas — sin Bash, sin filesystem, sin otras piezas. "Hazme el hook
 * más agresivo", "agrega un beat de demo", "reescribe el copy de LinkedIn".
 *
 * Los cambios pasan por updatePiece (mismo camino que la UI): espejo al
 * vault, sync de Linear y seguimiento de etapas vienen gratis. Cada mutación
 * se anuncia al stream (`onPiece`) para que la UI se refresque en vivo sin
 * esperar el poll.
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { newPublication } from "@hermes/shared";
import type { ContentPiece } from "@hermes/shared";
import { emit } from "../events.js";
import { env } from "../env.js";
import { OWNER, ownerBlurb } from "../owner.js";
import { buildCreativeContext } from "./context.js";
import {
  appendChatMessage,
  getChatSessionId,
  getPiece,
  setChatSessionId,
  updatePiece,
} from "./store.js";

const SYSTEM_PROMPT = `# Hermes — Editor de la pieza (Estudio RuloCode)

Eres el editor de UNA pieza de contenido de ${OWNER}${ownerBlurb("Creador de contenido")}. Conversas en español y aplicas los cambios que te pida DIRECTAMENTE sobre la pieza con la tool update_piece.

Reglas de la marca (no negociables):
- **Todo dato visible es real**: nada de métricas inventadas; los errores en cámara se quedan.
- Español colombiano natural, cercano, cero gurú. Tutea. Términos técnicos en inglés cuando es lo normal.
- El hook va en el primer segundo y no sobrepromete. Verticales 24-38s (~90-120 palabras con [marcas de tiempo] y cues **[DEMO: …]**); pilares de YouTube 10-14 min con secciones ##; posts de LinkedIn = el guion ES el texto, sin links en el cuerpo.
- La regla transmedia: cada plataforma recibe SU hook reescrito, nunca el mismo.
- CTA del mes 1: seguir + comentar. NADA de vender.

Formato del guion (respétalo al editar script_md — el teleprompter lo parsea):
- \`[0-3s]\` marca de tiempo al inicio del bloque · \`«frase»\` lo que se dice a cámara · \`**[DEMO: …]**\` / \`**[PANTALLA: …]**\` lo que se ve · \`(cara a cámara)\` acotación · \`**Notas de grabación:** …\` al final.

Cómo trabajas:
- El estado ACTUAL de la pieza llega en cada mensaje; si necesitas releerlo tras tus cambios, usa get_piece.
- Aplica el cambio con update_piece y confirma en UNA o dos frases QUÉ cambiaste (no pegues el guion entero en el chat).
- Cambios que pisan material real (tomas grabadas, copies ya escritos) pídelos confirmar antes; el resto aplícalo directo.
- Si te piden variantes/versiones de una parte, agrégalas con update_piece al campo variants (part = "hook" o la etiqueta del bloque, source = "hermes") en vez de pegarlas al chat.`;

/** Estado compacto de la pieza que se inyecta en cada turno. */
function pieceSnapshot(p: ContentPiece): string {
  return JSON.stringify(
    {
      id: p.id,
      title: p.title,
      pillar: p.pillar,
      format: p.format,
      platforms: p.platforms,
      status: p.status,
      publish_at: p.publish_at,
      hook: p.hook,
      script_md: p.script_md,
      notes: p.notes,
      takes: p.takes,
      edit_points: p.edit_points,
      publications: p.publications,
      variants: p.variants,
    },
    null,
    1,
  );
}

const STATUSES = [
  "idea",
  "guion",
  "grabacion",
  "edicion",
  "programado",
  "publicado",
  "descartada",
] as const;
const PLATFORMS = ["youtube", "shorts", "tiktok", "reels", "linkedin", "x"] as const;

export interface PieceChatHandlers {
  onDelta?: (text: string) => void;
  /** La pieza tras CADA mutación + qué campos tocó (la UI lo pinta como tarjeta). */
  onPiece?: (piece: ContentPiece, fields: string[]) => void;
  /** El agente arrancó una tool (la UI muestra "editando la pieza…"). */
  onTool?: (name: string) => void;
  /** Abortar el turno (Stop del cliente / desconexión del SSE). */
  signal?: AbortSignal;
}

export interface PieceChatResult {
  reply: string;
  isError: boolean;
}

export async function pieceChatTurn(
  pieceId: number,
  message: string,
  handlers: PieceChatHandlers = {},
): Promise<PieceChatResult> {
  const piece = await getPiece(pieceId);
  if (!piece) return { reply: "La pieza no existe.", isError: true };

  const uid = () => Math.random().toString(36).slice(2, 9);

  const getTool = tool(
    "get_piece",
    "Estado ACTUAL completo de la pieza (tras tus cambios).",
    {},
    async () => {
      const fresh = await getPiece(pieceId);
      return {
        content: [
          { type: "text" as const, text: fresh ? pieceSnapshot(fresh) : "no encontrada" },
        ],
      };
    },
  );

  const updateTool = tool(
    "update_piece",
    "Aplica cambios a la pieza. Manda SOLO los campos que cambian.",
    {
      title: z.string().optional(),
      hook: z.string().nullable().optional().describe("El primer segundo, literal."),
      script_md: z
        .string()
        .nullable()
        .optional()
        .describe("El guion COMPLETO en markdown (se reemplaza entero, respeta el formato)."),
      notes: z.string().nullable().optional(),
      publish_at: z.string().nullable().optional().describe("ISO 8601 o null."),
      status: z.enum(STATUSES).optional(),
      platforms: z.array(z.enum(PLATFORMS)).optional(),
      format: z.enum(["pilar", "vertical", "post", "carrusel", "otro"]).optional(),
      week_label: z.string().nullable().optional(),
      takes: z
        .array(
          z.object({
            id: z.string().optional().describe("Omitir en tomas nuevas."),
            label: z.string(),
            range: z.string().nullable(),
            verdict: z.enum(["buena", "revisar", "descartada"]),
            note: z.string().nullable(),
          }),
        )
        .optional()
        .describe("La lista COMPLETA de tomas (reemplaza)."),
      edit_points: z
        .array(
          z.object({
            id: z.string().optional(),
            tc: z.string(),
            kind: z.enum(["corte", "zoom", "caption", "broll", "card"]),
            note: z.string(),
          }),
        )
        .optional()
        .describe("La lista COMPLETA de puntos de edición (reemplaza)."),
      publications: z
        .array(
          z.object({
            id: z.string().optional(),
            platform: z.enum(PLATFORMS),
            title: z.string().nullable(),
            copy: z.string().nullable(),
            scheduled_at: z.string().nullable(),
            status: z.enum(["borrador", "programada", "publicada"]),
          }),
        )
        .optional()
        .describe("La lista COMPLETA de variantes de publicación (reemplaza)."),
      variants: z
        .array(
          z.object({
            id: z.string().optional(),
            part: z.string().describe('"hook" o la etiqueta del bloque ("[0-3s]").'),
            text: z.string(),
            angle: z.string().nullable(),
            source: z.enum(["hermes", "manual"]),
          }),
        )
        .optional()
        .describe("El pool COMPLETO de versiones del guion (reemplaza)."),
    },
    async (args) => {
      const now = new Date().toISOString();
      const withIds = <T extends { id?: string }>(xs: T[] | undefined) =>
        xs?.map((x) => ({ ...x, id: x.id || uid() }));
      const updated = await updatePiece(pieceId, {
        ...(args.title !== undefined ? { title: args.title } : {}),
        ...(args.hook !== undefined ? { hook: args.hook } : {}),
        ...(args.script_md !== undefined ? { scriptMd: args.script_md } : {}),
        ...(args.notes !== undefined ? { notes: args.notes } : {}),
        ...(args.publish_at !== undefined ? { publishAt: args.publish_at } : {}),
        ...(args.status !== undefined ? { status: args.status } : {}),
        ...(args.platforms !== undefined ? { platforms: [...args.platforms] } : {}),
        ...(args.format !== undefined ? { format: args.format } : {}),
        ...(args.week_label !== undefined ? { weekLabel: args.week_label } : {}),
        ...(args.takes !== undefined
          ? { takes: withIds(args.takes) as ContentPiece["takes"] }
          : {}),
        ...(args.edit_points !== undefined
          ? { editPoints: withIds(args.edit_points) as ContentPiece["edit_points"] }
          : {}),
        // Las variantes que propone el chat pasan por la fábrica: así nacen con
        // su provider y su estado de máquina, nunca a medio construir.
        ...(args.publications !== undefined
          ? {
              publications: args.publications.map((p) =>
                newPublication(p as Parameters<typeof newPublication>[0]),
              ),
            }
          : {}),
        ...(args.variants !== undefined
          ? {
              variants: args.variants.map((v) => ({
                ...v,
                id: v.id || uid(),
                created_at: now,
              })) as ContentPiece["variants"],
            }
          : {}),
      });
      if (!updated) return { content: [{ type: "text" as const, text: "Error guardando." }] };
      handlers.onPiece?.(updated, Object.keys(args));
      const changed = Object.keys(args).join(", ");
      return {
        content: [{ type: "text" as const, text: `Guardado (${changed}).` }],
      };
    },
  );

  const server = createSdkMcpServer({
    name: "piece",
    version: "0.1.0",
    tools: [getTool, updateTool],
  });

  const resume = (await getChatSessionId(pieceId)) ?? undefined;
  // Contexto creativo (radar + hooks con dato) SOLO al abrir la sesión: la
  // memoria del resume lo conserva y repetirlo en cada turno sería pagar
  // tokens por lo mismo.
  const creative = resume ? "" : await buildCreativeContext(piece);
  // Stop real: el AbortController del SDK se ata al signal del request — si
  // el cliente corta (botón Stop o cierre del tab), el turno muere de verdad.
  const abort = new AbortController();
  if (handlers.signal) {
    if (handlers.signal.aborted) abort.abort();
    else handlers.signal.addEventListener("abort", () => abort.abort(), { once: true });
  }
  // El turno puede traer varios bloques de texto (narración → tool →
  // confirmación): el historial guarda TODO lo que se streameó, no solo el último.
  const parts: string[] = [];
  let isError = false;
  let deltasSeen = false;

  void appendChatMessage(pieceId, "user", message);

  try {
    const q = query({
      // El snapshot va en el turno (no en el system prompt): la sesión se
      // resume entre visitas y la pieza pudo cambiar por fuera del chat.
      prompt: `Estado actual de la pieza:\n${pieceSnapshot(piece)}${creative}\n\nRulo dice: ${message}`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: SYSTEM_PROMPT,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 12,
        includePartialMessages: true,
        settingSources: [],
        resume,
        abortController: abort,
        mcpServers: { piece: server },
        allowedTools: ["mcp__piece__get_piece", "mcp__piece__update_piece"],
        permissionMode: "default",
      },
    });

    for await (const raw of q) {
      const m = raw as Record<string, any>;
      if (m.type === "system" && m.subtype === "init" && m.session_id) {
        if (m.session_id !== resume) void setChatSessionId(pieceId, m.session_id as string);
        continue;
      }
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          deltasSeen = true;
          handlers.onDelta?.(ev.delta.text as string);
        }
        continue;
      }
      if (m.type === "assistant") {
        for (const block of m.message?.content ?? []) {
          if (block.type === "tool_use" && block.name) handlers.onTool?.(block.name as string);
          if (block.type === "text" && block.text) {
            parts.push(block.text as string);
            if (!deltasSeen) handlers.onDelta?.(block.text as string);
          }
        }
        continue;
      }
      if (m.type === "result") {
        if (m.subtype === "success" && typeof m.result === "string" && !parts.length)
          parts.push(m.result);
        else if (m.subtype && m.subtype !== "success") isError = true;
      }
    }
  } catch (err) {
    if (abort.signal.aborted) {
      // Stop del usuario: lo dicho hasta aquí vale, sin marcar error.
      if (!parts.length) parts.push("(detenido)");
    } else {
      isError = true;
      if (!parts.length) parts.push(`Error en el chat de la pieza: ${String(err).slice(0, 300)}`);
      console.error("[content] chat:", String(err).slice(0, 200));
    }
  }

  const reply = parts.join("\n\n");
  if (reply.trim()) void appendChatMessage(pieceId, "assistant", reply);
  emit({
    kind: "task_done",
    taskId: `content-chat-${pieceId}`,
    detail: `chat de "${piece.title}": ${message.slice(0, 80)}`,
  });
  return { reply, isError };
}
