"use client";

// Detalle de un tablero de pared de la Oficina: Issues (tres columnas de
// Linear), Pull requests (GitHub) o Servicios (puertos escuchando). Todo sale
// de GET /office/boards; si la fuente falló, el panel lo dice. Esc o B cierra.

import { OFFICE_BOARD_TITLES, type BoardIssueItem, type BoardSection, type OfficeBoardId, type OfficeBoards } from "@hermes/shared";
import { PadGlyph } from "./VoiceComposer";

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

const COLUMNS: { key: BoardIssueItem["column"]; label: string; dot: string }[] = [
  { key: "todo", label: "Por hacer", dot: "bg-amber" },
  { key: "doing", label: "En curso", dot: "bg-cyan" },
  { key: "done", label: "Hecho", dot: "bg-green" },
];

function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "justo ahora";
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

function Empty<T>({ section, empty, off }: { section: BoardSection<T> | undefined; empty: string; off: string }) {
  if (!section) return <p className="py-6 text-center text-sm text-text-dim">Cargando…</p>;
  if (!section.available) return <p className="py-6 text-center text-sm text-text-dim">{section.error ?? off}</p>;
  if (section.error) return <p className="py-6 text-center text-sm text-red">{section.error}</p>;
  if (!section.items.length) return <p className="py-6 text-center text-sm text-text-dim">{empty}</p>;
  return null;
}

export function BoardPanel({
  id,
  data,
  refreshing,
  padConnected,
  onRefresh,
  onClose,
  issueAction,
}: {
  id: OfficeBoardId;
  data: OfficeBoards | null;
  refreshing: boolean;
  padConnected: boolean;
  onRefresh: () => void;
  onClose: () => void;
  /** Acción extra por issue abierto (p. ej. mandarlo a la cola de agentes). */
  issueAction?: { label: string; run: (it: BoardIssueItem) => void; disabled?: (it: BoardIssueItem) => boolean };
}) {
  const now = Date.now();
  return (
    <section
      role="dialog"
      aria-label={OFFICE_BOARD_TITLES[id]}
      className={`pointer-events-auto absolute top-1/2 left-1/2 z-40 flex max-h-[82vh] w-[min(64rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl ${glass}`}
    >
      <header className="flex items-center gap-3 border-b border-line px-5 py-3">
        <h2 className="text-base font-semibold text-text">{OFFICE_BOARD_TITLES[id]}</h2>
        <span className="text-xs text-text-dim">
          {id === "issues" ? "Linear" : id === "prs" ? "GitHub · repos de tus proyectos activos" : "Procesos de desarrollo escuchando en esta máquina"}
        </span>
        <span className="ml-auto text-xs text-text-faint">{data ? `Actualizado ${ago(data.fetchedAt, now)}` : ""}</span>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="rounded-lg border border-line px-2.5 py-1 text-xs text-text-dim hover:text-text disabled:opacity-50"
        >
          {refreshing ? "Actualizando…" : "↻ Actualizar"}
        </button>
        <button type="button" onClick={onClose} className="rounded-md px-1.5 text-text-dim hover:text-text" aria-label="Cerrar">
          ✕
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {id === "issues" ? (
          (Empty({ section: data?.issues, empty: "No hay issues en Linear.", off: "Linear no está configurado en esta máquina." }) ?? (
            <div className="grid gap-3 md:grid-cols-3">
              {COLUMNS.map((col) => {
                const items = (data?.issues.items ?? []).filter((i) => i.column === col.key);
                return (
                  <div key={col.key} className="flex min-w-0 flex-col gap-2 rounded-xl bg-panel-2/60 p-2.5">
                    <p className="flex items-center gap-2 px-1 text-xs font-medium text-text-dim">
                      <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                      {col.label}
                      <span className="ml-auto tabular-nums text-text-faint">{items.length}</span>
                    </p>
                    {items.map((it) => (
                      <article key={it.id} className="rounded-lg border border-line bg-panel p-2.5">
                        <p className="flex items-center gap-2 text-xs text-text-dim">
                          <span className="font-mono">{it.id}</span>
                          <span className="truncate">{it.state}</span>
                          {it.ready ? <span className="ml-auto shrink-0 rounded-full bg-accent/15 px-1.5 text-accent">prompt listo</span> : null}
                        </p>
                        <p className="mt-1 text-sm text-text">{it.title}</p>
                        <p className="mt-1.5 flex items-center gap-2 text-xs text-text-faint">
                          <span className="truncate">{it.project ?? "sin proyecto"}</span>
                          <a href={it.url} target="_blank" rel="noreferrer" className="ml-auto shrink-0 hover:text-text">
                            Linear ↗
                          </a>
                          {issueAction && it.column !== "done" ? (
                            <button
                              type="button"
                              disabled={issueAction.disabled?.(it)}
                              onClick={() => issueAction.run(it)}
                              className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-text-dim hover:border-accent hover:text-text disabled:opacity-40"
                            >
                              {issueAction.label}
                            </button>
                          ) : null}
                        </p>
                      </article>
                    ))}
                  </div>
                );
              })}
            </div>
          ))
        ) : id === "prs" ? (
          (Empty({ section: data?.prs, empty: "No hay PRs abiertos en los repos de tus proyectos.", off: "GitHub no está disponible en esta máquina." }) ?? (
            <ul className="divide-y divide-line">
              {data!.prs.items.map((pr) => (
                <li key={pr.url} className="flex items-center gap-3 py-2.5">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${pr.draft ? "bg-text-faint" : "bg-green"}`} title={pr.draft ? "borrador" : "abierto"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text">
                      <span className="font-mono text-text-dim">#{pr.number}</span> {pr.title}
                    </p>
                    <p className="truncate text-xs text-text-faint">
                      {pr.repo}
                      {pr.author ? ` · ${pr.author}` : ""}
                      {pr.draft ? " · borrador" : ""}
                      {pr.updatedAt ? ` · ${ago(pr.updatedAt, now)}` : ""}
                    </p>
                  </div>
                  <a href={pr.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-text-dim hover:text-text">
                    GitHub ↗
                  </a>
                </li>
              ))}
            </ul>
          ))
        ) : (
          (Empty({ section: data?.services, empty: "Ningún servidor de desarrollo escuchando ahora.", off: "No se pudo leer los puertos." }) ?? (
            <ul className="divide-y divide-line">
              {data!.services.items.map((sv) => (
                <li key={`${sv.pid}:${sv.port}`} className="flex items-center gap-3 py-2.5">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green" />
                  <span className="w-20 shrink-0 font-mono text-sm text-text">:{sv.port}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text">{sv.role ?? sv.project ?? "proyecto desconocido"}</p>
                    <p className="truncate text-xs text-text-faint">
                      {sv.process} · pid {sv.pid}
                      {sv.role && sv.project ? ` · ${sv.project}` : ""}
                    </p>
                  </div>
                  <a href={sv.url} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-text-dim hover:text-text">
                    Abrir ↗
                  </a>
                </li>
              ))}
            </ul>
          ))
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-line px-5 py-2 text-xs text-text-faint">
        {padConnected ? (
          <span className="flex items-center gap-1">
            <PadGlyph b="B" /> cerrar
          </span>
        ) : (
          <span>Esc cierra</span>
        )}
      </footer>
    </section>
  );
}
