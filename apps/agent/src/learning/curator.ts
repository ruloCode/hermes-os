import type { LearningProposal } from "@hermes/shared";
import { supabase } from "../supabase.js";
import { emit } from "../events.js";
import { saveMemory } from "../memory.js";
import { addProfileEntry, replaceProfileEntry } from "../profile.js";
import { archiveSkill, createSkill, listSkills, patchSkill } from "./skills.js";

/**
 * Curador: el mantenimiento del conocimiento aprendido.
 *
 * Dos trabajos, los dos con la misma regla — nada se pierde:
 *
 * 1. Aplicar/rechazar PROPUESTAS de la revisión en background. El humano
 *    decide (o `HERMES_LEARNING=auto` decide por él); aplicar es solo
 *    ejecutar el payload contra la tool que corresponda.
 * 2. ARCHIVAR skills muertas. Una skill que nadie usó en 45 días es ruido en
 *    el índice del system prompt, pero archivar ≠ borrar: se mueve a
 *    .archive/ y vuelve con un comando. Las fijadas y las escritas por el
 *    humano no se tocan JAMÁS.
 */

/** Días sin uso tras los que una skill del agente se marca muerta. */
const STALE_AFTER_DAYS = 45;
/** Gracia: una skill recién creada nunca se archiva por "no usada". */
const MIN_AGE_DAYS = 14;

const DAY_MS = 86_400_000;

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / DAY_MS;
}

export interface CuratorResult {
  archived: string[];
  scanned: number;
}

export async function curateSkills(): Promise<CuratorResult | null> {
  const skills = await listSkills();
  if (!skills.length) return null;
  const archived: string[] = [];

  for (const s of skills) {
    if (s.pinned || s.createdBy === "human" || s.state === "archived") continue;
    // La edad protege a las nuevas; el uso protege a las vivas.
    if (daysSince(s.createdAt) < MIN_AGE_DAYS) continue;
    const idle = daysSince(s.lastUsedAt ?? s.createdAt);
    if (idle < STALE_AFTER_DAYS) continue;
    const res = await archiveSkill(s.name);
    if (res.ok) {
      archived.push(s.name);
      emit({ kind: "learning", detail: `skill archivada: ${s.name} (${Math.round(idle)} días sin usarse)` });
    }
  }
  return { archived, scanned: skills.length };
}

// ── Propuestas ─────────────────────────────────────────────────────────

export async function listProposals(status = "pending", limit = 50): Promise<LearningProposal[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("learning_proposals")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as LearningProposal[];
}

export async function countPendingProposals(): Promise<number> {
  if (!supabase) return 0;
  const { count } = await supabase
    .from("learning_proposals")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}

/** Ejecuta el payload de una propuesta. Es la ÚNICA puerta de escritura. */
async function applyPayload(p: LearningProposal): Promise<{ ok: boolean; message: string }> {
  const d = p.payload as Record<string, any>;
  switch (p.kind) {
    case "skill_create":
      return createSkill({
        name: String(d.name ?? ""),
        description: String(d.description ?? ""),
        body: String(d.body ?? ""),
      });
    case "skill_patch":
      return patchSkill({
        name: String(d.name ?? ""),
        find: String(d.find ?? ""),
        replace: String(d.replace ?? ""),
      });
    case "profile": {
      const res = d.find
        ? await replaceProfileEntry(String(d.find), String(d.entry ?? ""))
        : await addProfileEntry(String(d.entry ?? ""));
      return { ok: res.ok, message: res.message };
    }
    case "memory": {
      const msg = await saveMemory({
        content: String(d.content ?? ""),
        type: (d.type as any) ?? "agent",
        project: d.project ? String(d.project) : undefined,
        importance: Number(d.importance) || 3,
        source: "learning",
      });
      return { ok: !msg.startsWith("Error"), message: msg };
    }
    default:
      return { ok: false, message: `Tipo de propuesta desconocido: ${p.kind}` };
  }
}

export async function decideProposal(
  id: string,
  decision: "apply" | "reject",
): Promise<{ ok: boolean; message: string }> {
  if (!supabase) return { ok: false, message: "Supabase no configurado." };
  const { data } = await supabase.from("learning_proposals").select("*").eq("id", id).maybeSingle();
  if (!data) return { ok: false, message: "No existe esa propuesta." };
  const p = data as LearningProposal;
  if (p.status !== "pending") return { ok: false, message: `La propuesta ya está en "${p.status}".` };

  if (decision === "reject") {
    await supabase
      .from("learning_proposals")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", id);
    return { ok: true, message: "Propuesta descartada." };
  }

  const res = await applyPayload(p);
  await supabase
    .from("learning_proposals")
    .update({
      status: res.ok ? "applied" : "failed",
      error: res.ok ? null : res.message.slice(0, 500),
      decided_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (res.ok) emit({ kind: "learning", detail: `aplicada: ${p.title}` });
  return res;
}

/** Guarda una propuesta; con HERMES_LEARNING=auto la aplica de una vez. */
export async function saveProposal(
  input: Omit<LearningProposal, "id" | "status" | "error" | "created_at" | "decided_at">,
  auto: boolean,
): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from("learning_proposals")
    .insert({
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      rationale: input.rationale,
      source: input.source,
      source_ref: input.source_ref,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[hermes] learning proposal", error.message);
    return;
  }
  emit({ kind: "learning", detail: `propuesta: ${input.title}` });
  if (auto) await decideProposal(data.id, "apply");
}
