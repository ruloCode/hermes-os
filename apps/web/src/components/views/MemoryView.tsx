"use client";

import { useTheme } from "@/state/ThemeProvider";

// Tab MEMORIA: búsqueda unificada sobre TODO lo que Hermes sabe (memorias,
// reuniones, ejecuciones, chats de texto/voz y vault) + conteos reales +
// memorias recientes. Los resultados del vault abren en el DocViewer.
// Segundo modo: GRAFO 3D del código (graphify) — se monta solo al activarlo.

import { useEffect, useRef, useState } from "react";
import type { KnowledgeHit, KnowledgeSource, KnowledgeStats, Memory } from "@hermes/shared";
import { searchKnowledge, getKnowledgeStats } from "@/lib/hermes";
import { useDocViewer } from "@/components/DocViewer";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { RecentInsights } from "@/components/RecentInsights";
import { CodeGraph3D } from "@/components/CodeGraph3D";

// La fuente es una CATEGORÍA (no un estado): etiqueta neutra. v4 le daba un
// color a cada una y la lista se leía como arcoíris.
const SOURCE_LABEL: Record<KnowledgeSource, string> = {
  memory: "memoria",
  meeting: "reunión",
  execution: "ejecución",
  conversation: "chat",
  vault: "vault",
};

export function MemoryView({ memories, online }: { memories: Memory[]; online: boolean }) {
  const theme = useTheme();
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

  // Conteos reales por fuente (sin dato → sin píldora).
  const counts: { n: number; label: string }[] = stats?.available
    ? [
        { n: stats.memories, label: "memorias" },
        { n: stats.vaultDocs, label: "notas del vault" },
        { n: stats.meetings, label: "reuniones" },
        { n: stats.executions, label: "ejecuciones" },
        { n: stats.conversationText + stats.conversationVoice, label: "conversaciones" },
      ]
    : [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        title="Memoria"
        meta={
          stats?.available ? `${stats.total.toLocaleString("es-CO")} elementos indexados` : undefined
        }
        tabs={
          <Segmented
            ariaLabel="Modo de la memoria"
            value={mode}
            onChange={setMode}
            options={[
              { value: "buscar", label: "Conocimiento" },
              { value: "grafo", label: "Grafo de código 3D" },
            ]}
          />
        }
      />

      {mode === "grafo" ? (
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-line">
          {online ? (
            <CodeGraph3D key={theme.resolved} />
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
            <label className="relative flex min-w-0 flex-1 items-center">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                aria-hidden
                className="pointer-events-none absolute left-3 text-text-faint"
              >
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  // Borrar la búsqueda vuelve a las memorias recientes.
                  if (!e.target.value.trim()) setHits(null);
                }}
                placeholder="Buscar en todo el conocimiento — memorias, reuniones, vault, chats…"
                className="h-9 w-full min-w-0 rounded-sm border border-line bg-panel pr-3 pl-9 text-sm text-text outline-none transition-colors placeholder:text-text-faint focus:border-line-2"
                aria-label="Buscar conocimiento"
              />
            </label>
            <Button type="submit" size="md" disabled={searching} className="h-9">
              {searching ? "Buscando…" : "Buscar"}
            </Button>
          </form>

          {/* Conteos reales por fuente: píldoras neutras, el número manda. */}
          {counts.length > 0 && (
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-1.5">
              {counts.map((c) => (
                <span
                  key={c.label}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-3 text-xs"
                >
                  <span className="font-medium text-text tabular-nums">
                    {c.n.toLocaleString("es-CO")}
                  </span>
                  <span className="text-text-faint">{c.label}</span>
                </span>
              ))}
            </div>
          )}

          {/* Resultados o memorias recientes */}
          <div className="-mx-2 mt-5 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
            {hits === null ? (
              <>
                <h3 className="mb-1.5 px-2 text-xs font-medium text-text-dim">
                  Memorias recientes
                </h3>
                {online ? (
                  <RecentInsights memories={memories} />
                ) : (
                  <PanelState kind="offline" hint="El agente local no responde" />
                )}
              </>
            ) : searching ? (
              <PanelState kind="loading" />
            ) : hits.length === 0 ? (
              <PanelState kind="empty" title="Sin resultados" hint="Prueba con otras palabras." />
            ) : (
              <>
                <h3 className="mb-1.5 flex items-center gap-2 px-2 text-xs font-medium text-text-dim">
                  Resultados
                  <span className="text-text-faint tabular-nums">{hits.length}</span>
                </h3>
                <ul>
                  {hits.map((h) => {
                    const label = SOURCE_LABEL[h.source] ?? h.source;
                    const key = `${h.source}:${h.ref}`;
                    const open = expanded === key;
                    return (
                      <li key={key} className="border-t border-line first:border-t-0">
                        <button
                          type="button"
                          onClick={() =>
                            h.source === "vault"
                              ? openDoc(h.ref, h.project_slug ?? undefined)
                              : setExpanded(open ? null : key)
                          }
                          aria-expanded={h.source === "vault" ? undefined : open}
                          className="block w-full min-w-0 cursor-pointer rounded-sm px-2 py-2.5 text-left transition-colors hover:bg-hover"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="inline-flex h-5 shrink-0 items-center rounded-full border border-line px-2 text-2xs text-text-dim">
                              {label}
                            </span>
                            {h.project_slug && (
                              <span className="min-w-0 truncate text-xs text-text-faint">
                                {h.project_slug}
                              </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-2xs text-text-faint tabular-nums">
                              {h.created_at?.slice(0, 10) ?? ""}
                            </span>
                          </div>
                          <p className="mt-1.5 text-sm font-medium text-text">{h.title}</p>
                          <p
                            className={`mt-0.5 text-sm leading-snug text-text-dim ${open ? "" : "line-clamp-2"}`}
                          >
                            {h.content}
                          </p>
                          {h.source === "vault" && (
                            <span className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent">
                              Abrir documento
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden
                              >
                                <path d="M5 12h14M13 6l6 6-6 6" />
                              </svg>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
