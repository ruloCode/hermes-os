"use client";

// Salud de la memoria v2 en una mirada (pestaña MEMORIA → Conocimiento):
// híbrida · solo léxica · caída, con los números reales del índice local, y
// las propuestas del «sueño» (consolidación nocturna) para aprobar o descartar.
// Se LEE, así que va sin marco; solo las propuestas (que se operan) llevan borde.

import { useCallback, useEffect, useState } from "react";
import { KNOWLEDGE_SOURCE_LABEL, type KnowledgeSource } from "@hermes/shared";
import { StatusPill } from "@/components/ui/StatusPill";
import { Button } from "@/components/ui/Button";
import {
  decideMemoriaProposal,
  getMemoriaProposals,
  getMemoriaStatus,
  type DreamProposal,
  type MemoriaStatus,
} from "@/lib/memoria-api";

const HEALTH = {
  hibrida: { status: "ok", label: "Memoria híbrida" },
  lexica: { status: "warn", label: "Solo léxica" },
  caida: { status: "error", label: "Memoria caída" },
} as const;

const fmt = (n: number) => n.toLocaleString("es-CO");

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return null;
  if (min < 1) return "hace un momento";
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`;
}

/** «local:bge-m3-Q8_0» → «bge-m3 local». */
function engineName(id: string | null): string | null {
  if (!id) return null;
  const [kind, model] = id.split(":");
  const short = (model ?? "").replace(/-Q\d.*$/i, "");
  return kind === "local" ? `${short} local` : kind === "openai" ? `${short} (OpenAI)` : id;
}

export function MemoryHealth() {
  const [status, setStatus] = useState<MemoriaStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<DreamProposal[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await getMemoriaStatus();
    if (!r.ok) {
      setStatus(null);
      setError(r.offline ? null : r.error);
      return;
    }
    setStatus(r.data);
    setError(null);
    if (r.data.proposals.pending > 0) {
      const p = await getMemoriaProposals();
      if (p.ok) setProposals(p.data);
    } else setProposals([]);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (id: string, action: "approve" | "discard") => {
    setBusy(id);
    const r = await decideMemoriaProposal(id, action);
    setBusy(null);
    if (r.ok) setProposals((list) => list.filter((p) => p.id !== id));
    else setError(r.error);
    void load();
  };

  // Agente sin la memoria v2 o que no contesta: nada que mostrar (la vista ya dice offline).
  if (!status) {
    return error ? <p className="mt-3 px-0.5 text-xs text-text-faint">Memoria v2: {error}</p> : null;
  }

  const ix = status.index;
  const h = HEALTH[status.health];
  const pct = ix.chunks ? Math.round((ix.vectors / ix.chunks) * 100) : 0;
  const engine = engineName(status.engine.active);
  const sources = Object.entries(ix.bySource).sort((a, b) => (b[1]?.docs ?? 0) - (a[1]?.docs ?? 0)) as [
    KnowledgeSource,
    { docs: number; chunks: number; vectors: number },
  ][];
  const sourceErrors = Object.entries(ix.sourceErrors);
  const synced = ago(ix.lastSync);

  return (
    <section className="mt-3 shrink-0" aria-label="Salud de la memoria">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <StatusPill status={h.status} label={h.label} />
        {ix.chunks > 0 && (
          <span className="min-w-0 text-text-dim">
            <span className="tabular-nums text-text">{fmt(ix.docs)}</span> documentos ·{" "}
            <span className="tabular-nums text-text">{pct} %</span> con vector
            {engine ? ` · ${engine}` : ""}
            {synced ? ` · sincronizada ${synced}` : ""}
          </span>
        )}
        {status.backend.active === "supabase" && (
          <span className="text-text-faint">búsqueda por el camino anterior</span>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xs px-1.5 py-0.5 text-text-faint hover:bg-hover hover:text-text-dim"
          aria-expanded={open}
        >
          {open ? "Ocultar detalle" : "Detalle"}
        </button>
      </div>

      {/* El porqué cuando no está sana, siempre a la vista (una línea). */}
      {status.health !== "hibrida" && status.engine.reason && (
        <p className="mt-1 truncate text-xs text-text-faint" title={status.engine.reason}>
          {status.engine.reason}
        </p>
      )}

      {open && (
        <div className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <ul className="min-w-0">
            {sources.map(([s, c]) => (
              <li key={s} className="flex justify-between gap-3 px-0.5 py-0.5">
                <span className="truncate text-text-dim">{KNOWLEDGE_SOURCE_LABEL[s] ?? s}</span>
                <span className="shrink-0 tabular-nums text-text-faint">
                  {fmt(c.docs)} · {fmt(c.vectors)}/{fmt(c.chunks)} fragmentos
                </span>
              </li>
            ))}
          </ul>
          <ul className="min-w-0">
            {status.engines.map((e) => (
              <li key={e.id} className="flex min-w-0 items-start justify-between gap-3 px-0.5 py-0.5">
                <span className="truncate text-text-dim">{engineName(e.id)}</span>
                <span className="min-w-0 truncate text-right text-text-faint" title={e.reason ?? undefined}>
                  {e.state === "down" ? (e.reason ?? "no disponible") : e.state === "ok" ? "responde" : "disponible"}
                </span>
              </li>
            ))}
            {ix.superseded > 0 && (
              <li className="px-0.5 py-0.5 text-text-faint">{fmt(ix.superseded)} hechos reemplazados (historial)</li>
            )}
            {sourceErrors.map(([s, e]) => (
              <li key={s} className="truncate px-0.5 py-0.5 text-text-faint" title={e}>
                {s}: {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {proposals.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-1.5 text-xs font-medium text-text-dim">
            Para consolidar <span className="tabular-nums text-text-faint">{proposals.length}</span>
          </h3>
          <ul className="flex flex-col gap-2">
            {proposals.slice(0, 5).map((p) => (
              <li key={p.id} className="rounded-sm border border-line px-3 py-2">
                <p className="text-xs text-text-dim">
                  {p.action === "duplicado" ? "Dicen lo mismo" : "La nueva reemplaza a la vieja"} · {p.reason}
                </p>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {p.items.map((it) => (
                    <li key={it.key} className="flex min-w-0 gap-2 text-xs">
                      <span className="shrink-0 tabular-nums text-text-faint">{it.createdAt.slice(0, 10)}</span>
                      <span className={`min-w-0 break-words ${it.key === p.keep ? "text-text" : "text-text-faint line-through"}`}>
                        {it.text.slice(0, 220)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="secondary" disabled={busy === p.id} onClick={() => void decide(p.id, "approve")}>
                    Aplicar
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === p.id} onClick={() => void decide(p.id, "discard")}>
                    Descartar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
