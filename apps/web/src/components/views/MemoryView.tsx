"use client";

// Tab MEMORIA: búsqueda unificada sobre TODO lo que Hermes sabe (memorias,
// reuniones, ejecuciones, chats de texto/voz y vault) + conteos reales +
// memorias recientes. Los resultados del vault abren en el DocViewer.
// Segundo modo: GRAFO 3D del código (graphify) — se monta solo al activarlo.

import { useEffect, useRef, useState } from "react";
import type { KnowledgeHit, KnowledgeSource, KnowledgeStats, Memory } from "@hermes/shared";
import { searchKnowledge, getKnowledgeStats } from "@/lib/hermes";
import { useDocViewer } from "@/components/DocViewer";
import { Badge } from "@/components/ui/Badge";
import { PanelState } from "@/components/ui/PanelState";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { RecentInsights } from "@/components/RecentInsights";
import { CodeGraph3D } from "@/components/CodeGraph3D";
import type { Tone } from "@/components/ui/tones";

const SOURCE_META: Record<KnowledgeSource, { label: string; tone: Tone }> = {
  memory: { label: "memoria", tone: "violet" },
  meeting: { label: "reunión", tone: "cyan" },
  execution: { label: "ejecución", tone: "blue" },
  conversation: { label: "chat", tone: "amber" },
  vault: { label: "vault", tone: "green" },
};

export function MemoryView({ memories, online }: { memories: Memory[]; online: boolean }) {
  const openDoc = useDocViewer();
  const [mode, setMode] = useState<"buscar" | "grafo">("buscar");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const seq = useRef(0);

  // Conteos: al montar y cada 60s (el agente cachea, es barato).
  useEffect(() => {
    let alive = true;
    const load = () =>
      getKnowledgeStats()
        .then((s) => alive && setStats(s))
        .catch(() => alive && setStats(null));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const search = async () => {
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    const id = ++seq.current;
    setSearching(true);
    try {
      const res = await searchKnowledge(q, { limit: 14 });
      if (seq.current === id) setHits(res);
    } catch {
      if (seq.current === id) setHits([]);
    } finally {
      if (seq.current === id) setSearching(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Modo: búsqueda de conocimiento o grafo 3D del código */}
      <div className="flex shrink-0 items-center gap-1">
        {(
          [
            ["buscar", "Conocimiento"],
            ["grafo", "Grafo de código 3D"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={`border px-3 py-1 text-2xs tracking-label uppercase transition-colors ${
              mode === id
                ? "border-violet text-violet"
                : "border-line text-text-dim hover:border-line-2 hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "grafo" ? (
        <div className="min-h-0 flex-1 border border-line">
          {online ? (
            <CodeGraph3D />
          ) : (
            <PanelState kind="offline" hint="El agente local no responde" />
          )}
        </div>
      ) : (
        <>
          {/* Búsqueda unificada */}
          <form
            className="flex shrink-0 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void search();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar en todo el conocimiento — memorias, reuniones, vault, chats…"
              className="min-w-0 flex-1 border border-line bg-transparent px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-line-2 focus:outline-none"
              aria-label="Buscar conocimiento"
            />
            <button
              type="submit"
              className="border border-line px-3 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-violet hover:text-violet"
            >
              {searching ? "···" : "Buscar"}
            </button>
          </form>

          {/* Conteos reales por fuente */}
          {stats?.available && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Badge tone="violet">{stats.memories} memorias</Badge>
              <Badge tone="green">{stats.vaultDocs} notas vault</Badge>
              <Badge tone="cyan">{stats.meetings} reuniones</Badge>
              <Badge tone="blue">{stats.executions} ejecuciones</Badge>
              <Badge tone="amber">
                {stats.conversationText + stats.conversationVoice} conversaciones
              </Badge>
              <span className="ml-auto text-2xs tracking-label text-text-dim uppercase">
                {stats.total.toLocaleString("es-CO")} items indexados
              </span>
            </div>
          )}

          {/* Resultados o memorias recientes */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
            {hits === null ? (
              <>
                <div className="mb-2">
                  <SectionTitle tone="violet">Memorias recientes</SectionTitle>
                </div>
                {online ? (
                  <RecentInsights memories={memories} />
                ) : (
                  <PanelState kind="offline" hint="El agente local no responde" />
                )}
              </>
            ) : searching ? (
              <PanelState kind="loading" />
            ) : hits.length === 0 ? (
              <PanelState kind="empty" title="Sin resultados" hint="Prueba con otras palabras" />
            ) : (
              <div className="space-y-2">
                {hits.map((h) => {
                  const meta = SOURCE_META[h.source] ?? {
                    label: h.source,
                    tone: "neutral" as Tone,
                  };
                  const key = `${h.source}:${h.ref}`;
                  const open = expanded === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() =>
                        h.source === "vault"
                          ? openDoc(h.ref, h.project_slug ?? undefined)
                          : setExpanded(open ? null : key)
                      }
                      className="block w-full border border-line px-3 py-2 text-left transition-colors hover:border-line-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge tone={meta.tone} size="sm">
                          {meta.label}
                        </Badge>
                        {h.project_slug && (
                          <span className="text-2xs tracking-label text-cyan uppercase">
                            {h.project_slug}
                          </span>
                        )}
                        <span className="ml-auto text-2xs text-text-faint">
                          {h.created_at?.slice(0, 10) ?? ""}
                        </span>
                      </div>
                      <p className="mt-1 text-xs font-medium text-text">{h.title}</p>
                      <p className={`mt-0.5 text-xs text-text-dim ${open ? "" : "line-clamp-2"}`}>
                        {h.content}
                      </p>
                      {h.source === "vault" && (
                        <span className="mt-1 inline-block text-2xs tracking-label text-green uppercase">
                          ◈ abrir documento
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
