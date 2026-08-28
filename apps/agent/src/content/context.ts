/**
 * Contexto REAL para la generación de contenido (kit, variantes, chat):
 * hasta la auditoría 2026-08-10 los prompts generaban a ciegas — solo los
 * campos de la pieza, con la estrategia resumida y hardcodeada. Aquí se junta
 * lo que ya existe y cambia el resultado:
 *
 *  1. La estrategia madre LEÍDA del vault (posicionamiento, pilares, funnel).
 *  2. El radar aplicable: referencias en 'aplicado'/'probar' (las del pilar
 *     de la pieza primero) — tendencias con métrica y fuente.
 *  3. Hooks con dato: qué aperturas ya salieron y cómo les fue (bucle de
 *     resultados). Solo si hay filas — jamás se inventa el ranking.
 *
 * Todo es texto plano al prompt: los runs de generación siguen sin tools de
 * lectura (una sola tool de registro), que es lo que los mantiene baratos.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ContentPiece, ContentRef } from "@hermes/shared";
import { env } from "../env.js";
import { supabase } from "../supabase.js";
import { hookPerformance } from "./metrics.js";

const STRATEGY_PATH = join("projects", "rulocode", "docs", "estrategia-marca-personal-2026.md");
/** Tope del extracto de estrategia: portada + posicionamiento + pilares. */
const STRATEGY_MAX = 6000;

async function strategyExcerpt(): Promise<string | null> {
  if (!env.VAULT_PATH) return null;
  try {
    const raw = await readFile(join(env.VAULT_PATH, STRATEGY_PATH), "utf8");
    const body = raw.replace(/^---\n[\s\S]*?\n---\n/, "").trim();
    if (!body) return null;
    return body.length > STRATEGY_MAX ? `${body.slice(0, STRATEGY_MAX)}\n\n[… extracto]` : body;
  } catch {
    return null;
  }
}

async function radarRefs(piece: ContentPiece, limit = 6): Promise<ContentRef[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("content_refs")
    .select("*")
    .in("apply_status", ["aplicado", "probar"])
    .order("created_at", { ascending: false })
    .limit(24);
  const refs = (data ?? []) as unknown as ContentRef[];
  // Las del pilar de la pieza primero; las globales (sin pilar) después.
  return refs
    .sort((a, b) => Number(b.pillar === piece.pillar) - Number(a.pillar === piece.pillar))
    .slice(0, limit);
}

/**
 * El bloque de contexto listo para pegar al prompt. `full` incluye la
 * estrategia completa (kit); sin él va la versión corta (variantes, chat).
 */
export async function buildCreativeContext(
  piece: ContentPiece,
  opts: { full?: boolean } = {},
): Promise<string> {
  const parts: string[] = [];

  if (opts.full) {
    const strategy = await strategyExcerpt();
    if (strategy)
      parts.push(`## Estrategia de la marca (del vault, extracto)\n\n${strategy}`);
  }

  const refs = await radarRefs(piece);
  if (refs.length)
    parts.push(
      `## Radar aplicable (tendencias/referencias en uso)\n\n${refs
        .map(
          (r) =>
            `- [${r.kind}${r.pillar ? ` · ${r.pillar}` : ""}] ${r.title}${r.metric ? ` (${r.metric})` : ""}${r.body ? ` — ${r.body}` : ""}${r.source ? ` [fuente: ${r.source}]` : ""}`,
        )
        .join("\n")}`,
    );

  try {
    const hooks = (await hookPerformance()).slice(0, 3);
    if (hooks.length)
      parts.push(
        `## Hooks que ya salieron, con su dato real\n\n${hooks
          .map(
            (h) =>
              `- «${h.hook}»${h.hook_kind ? ` (${h.hook_kind})` : ""} → ${h.engaged_views ?? h.views ?? "?"} views${h.avg_view_pct != null ? ` · retención media ${Math.round(h.avg_view_pct)}%` : ""} [${h.platform}]`,
          )
          .join("\n")}`,
      );
  } catch {
    // Sin métricas no hay sección — nunca un ranking inventado.
  }

  return parts.length ? `\n---\n\nContexto real (no lo repitas, úsalo):\n\n${parts.join("\n\n")}` : "";
}
