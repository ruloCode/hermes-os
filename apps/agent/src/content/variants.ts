/**
 * Variantes de una PARTE del guion (hook o un bloque): 3-5 versiones con
 * ángulos DISTINTOS entre sí, generadas con el Agent SDK (patrón generate.ts:
 * un turno + tool acotada). Se AGREGAN al pool `variants` de la pieza — las
 * manuales y las anteriores no se pisan; elegir cuál queda activa es un acto
 * humano en la UI (reescribe hook/script_md, la única fuente de verdad).
 */
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ContentPiece, ContentVariant, HookKind } from "@hermes/shared";
import { emit } from "../events.js";
import { env } from "../env.js";
import { buildCreativeContext } from "./context.js";
import { getPiece, updatePiece } from "./store.js";
import { OWNER, ownerBlurb } from "../owner.js";

const uid = () => Math.random().toString(36).slice(2, 9);

/** Máximo de variantes que se conservan por parte (las manuales no cuentan). */
const MAX_HERMES_PER_PART = 10;

const SYSTEM_PROMPT = `# Hermes — Director de contenido de RuloCode (variantes)

Escribes VERSIONES ALTERNATIVAS de una parte del guion de ${OWNER}${ownerBlurb("Creador de contenido")}.

Reglas (no negociables):
- **Todo dato visible es real**: nada de métricas inventadas ni sobrepromesas — el algoritmo 2026 penaliza CTR con abandono.
- Español colombiano natural, cercano, cero gurú. Tutea. Términos técnicos en inglés cuando es lo normal (agent, prompt, deploy).
- Cada variante debe apostar por un ÁNGULO DISTINTO (curiosidad, dato duro, contraste, primera persona, pregunta, urgencia…) — cinco versiones de la misma frase no sirven de nada.
- Si la parte es el HOOK: es el primer segundo del video, se dice a cámara tal cual, una sola frase u oración corta con gancho. Etiqueta CADA variante de hook con su estructura en \`kind\` (pregunta · dato · contraste · error · promesa · demo) — así la biblioteca de hooks aprende de las métricas cuál retiene.
- Si es un bloque intermedio: respeta su función en el guion (no metas el CTA a mitad de video) y su duración aproximada (mismo orden de palabras que el texto actual).
- Las variantes son SOLO lo que se dice — sin marcas de tiempo, sin [DEMO: …], sin acotaciones.

Responde SIEMPRE llamando a la tool record_variants UNA sola vez.`;

/**
 * Genera variantes para una parte y las agrega al pool. Devuelve la pieza
 * actualizada (o null). `current` = el texto vigente de esa parte (lo manda
 * la UI, que ya lo tiene parseado del guion).
 */
export async function generatePartVariants(
  pieceId: number,
  part: string,
  current?: string,
  brief?: string,
): Promise<ContentPiece | null> {
  const piece = await getPiece(pieceId);
  if (!piece) return null;

  const isHook = part.toLowerCase() === "hook";
  const currentText = current?.trim() || (isHook ? (piece.hook ?? "") : "");
  const existing = piece.variants.filter((v) => v.part === part).map((v) => v.text);

  let captured: { text: string; angle: string; kind?: HookKind }[] | null = null;
  const recordTool = tool(
    "record_variants",
    "Registra las variantes de la parte. Llámala UNA sola vez.",
    {
      variants: z
        .array(
          z.object({
            text: z.string().describe("La versión, literal, tal como se dice a cámara."),
            angle: z
              .string()
              .describe("El ángulo de la apuesta en 1-3 palabras: 'curiosidad', 'dato duro', 'contraste'…"),
            kind: z
              .enum(["pregunta", "dato", "contraste", "error", "promesa", "demo"])
              .optional()
              .describe(
                "SOLO para hooks: la estructura de la apertura. La biblioteca de hooks la cruza con las métricas reales para aprender qué tipo retiene.",
              ),
          }),
        )
        .min(3)
        .max(5),
    },
    async (args) => {
      captured = args.variants;
      return { content: [{ type: "text" as const, text: "Registradas." }] };
    },
  );
  const server = createSdkMcpServer({ name: "variants", version: "0.1.0", tools: [recordTool] });

  try {
    const q = query({
      prompt: `Pieza: **${piece.title}** (${piece.pillar.toUpperCase()} · ${piece.format} · ${piece.platforms.join(", ") || "sin plataformas"})

Parte a versionar: **${isHook ? "HOOK (el primer segundo del video)" : part}**
${currentText ? `Texto actual:\n"""\n${currentText}\n"""` : "(sin texto actual — parte nueva)"}
${existing.length ? `\nVersiones que YA existen (no las repitas ni las parafrasees):\n${existing.map((t) => `- ${t}`).join("\n")}` : ""}
${brief?.trim() ? `\nIndicación de ${OWNER}: ${brief.trim()}` : ""}

Guion completo (contexto — la variante tiene que encajar aquí):
"""
${(piece.script_md ?? "").slice(0, 6000)}
"""
${await buildCreativeContext(piece)}

Genera 3-5 variantes con ángulos distintos y llama a record_variants.`,
      options: {
        cwd: env.VAULT_PATH || process.cwd(),
        systemPrompt: SYSTEM_PROMPT,
        model: process.env.HERMES_MODEL || undefined,
        maxTurns: 4,
        settingSources: [],
        mcpServers: { variants: server },
        allowedTools: ["mcp__variants__record_variants"],
        permissionMode: "default",
      },
    });
    for await (const message of q) void message;

    if (!captured) throw new Error("el modelo no llamó record_variants");
    const now = new Date().toISOString();
    const fresh: ContentVariant[] = (
      captured as { text: string; angle: string; kind?: HookKind }[]
    ).map((v) => ({
      id: uid(),
      part,
      text: v.text.trim(),
      angle: v.angle.trim() || null,
      hook_kind: isHook ? (v.kind ?? null) : null,
      source: "hermes",
      created_at: now,
    }));

    // Pool: manuales intactas; de Hermes se conservan las últimas N por parte.
    const others = piece.variants.filter((v) => v.part !== part);
    const manual = piece.variants.filter((v) => v.part === part && v.source === "manual");
    const hermes = [
      ...piece.variants.filter((v) => v.part === part && v.source === "hermes"),
      ...fresh,
    ].slice(-MAX_HERMES_PER_PART);

    const updated = await updatePiece(pieceId, { variants: [...others, ...manual, ...hermes] });
    emit({
      kind: "task_done",
      taskId: `content-variants-${pieceId}`,
      detail: `${fresh.length} variantes de ${isHook ? "hook" : part} para "${piece.title}"`,
    });
    return updated;
  } catch (err) {
    console.error("[content] variantes:", String(err).slice(0, 200));
    return null;
  }
}
