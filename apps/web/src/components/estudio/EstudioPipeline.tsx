"use client";

/**
 * Pipeline del ESTUDIO: las piezas agrupadas por etapa (idea → publicado),
 * con filtro por etapa y alta rápida de ideas. Cada fila muestra su avance en
 * el pipeline y, si está atascada, cuánto lleva ahí. Clic = abrir la pieza.
 *
 * v5: filas de lista (título + una línea gris de metadatos), no tarjetas con
 * borde; el color queda solo para estado (atascada = ámbar).
 */
import { useState, type ReactNode } from "react";
import { STAGES, daysInStage, isStuck, pipelineProgress, stageProgress } from "@hermes/shared";
import type { ContentPiece, ContentPillar, ContentStatus } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PanelState } from "@/components/ui/PanelState";
import { Segmented } from "@/components/ui/Segmented";
import { PILLARS, STATUSES, STATUS_ORDER, fmtDays, fmtPublish } from "./labels";

export function EstudioPipeline() {
  const { board, selectedId, setSelectedId, createPiece, replanOverdue } = useEstudioContext();
  // El filtro que importa a diario es la ETAPA ("muéstrame lo que toca grabar"),
  // no el pilar: el pilar ya va como badge en cada tarjeta.
  const [filter, setFilter] = useState<ContentStatus | null>(null);
  // "estado" = tablero de producción · "fecha" = calendario de publicación
  // (patrón Later/Mobbin: lista por fecha con pill de estado para control fino).
  const [view, setView] = useState<"estado" | "fecha">("estado");
  const [newTitle, setNewTitle] = useState("");
  const [newPillar, setNewPillar] = useState<ContentPillar>("p1");
  const [creating, setCreating] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanned, setReplanned] = useState<number | null>(null);

  const pieces = filter ? board.pieces.filter((p) => p.status === filter) : board.pieces;

  // Fechas vencidas SIN publicar: el calendario aspiracional. Re-fecharlas es
  // UNA acción con la cadencia elegida — no doce ediciones a mano.
  const overdue = board.pieces.filter(
    (p) =>
      p.publish_at &&
      new Date(p.publish_at).getTime() < Date.now() &&
      p.status !== "publicado" &&
      p.status !== "descartada" &&
      !p.publications.some((pub) => pub.remote_id),
  ).length;

  const replan = async (perWeek: number) => {
    if (replanning) return;
    setReplanning(true);
    const r = await replanOverdue(perWeek);
    setReplanned(r?.changed.length ?? 0);
    setReplanning(false);
  };

  const submitIdea = async () => {
    const title = newTitle.trim();
    if (!title || creating) return;
    setCreating(true);
    await createPiece({ title, pillar: newPillar });
    setNewTitle("");
    setCreating(false);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Barra de la lista: filtro por etapa (el corte real del día a día,
          "¿qué toca grabar?") a la izquierda, y cómo se ordena a la derecha.
          v5: píldoras calmadas — la seleccionada en gris, las vacías apagadas;
          el acento no se gasta en un filtro. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 pb-3">
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar por etapa">
          {/* "Todas" cuenta lo que la lista muestra: las descartadas no entran. */}
          <FilterPill
            on={filter === null}
            onClick={() => setFilter(null)}
            count={board.pieces.filter((p) => p.status !== "descartada").length}
          >
            Todas
          </FilterPill>
          {STATUS_ORDER.map((s) => {
            const n = board.pieces.filter((p) => p.status === s).length;
            return (
              <FilterPill
                key={s}
                on={filter === s}
                empty={n === 0}
                count={n}
                title={STAGES[s].meaning}
                onClick={() => setFilter(filter === s ? null : s)}
              >
                {STATUSES[s].label}
              </FilterPill>
            );
          })}
        </div>
        {/* Vista: por estado (producción) o por fecha (publicación) */}
        <Segmented
          size="sm"
          ariaLabel="Ordenar piezas"
          value={view}
          onChange={setView}
          options={[
            { value: "estado", label: "Por estado" },
            { value: "fecha", label: "Por fecha" },
          ]}
        />
      </div>

      {/* Alta rápida: una idea es una línea; el resto se completa en la pieza. */}
      <form
        className="mb-3 flex shrink-0 gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submitIdea();
        }}
      >
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="Nueva idea…"
          aria-label="Título de la nueva idea"
          className="h-8 min-w-0 flex-1 rounded-sm border border-line bg-panel px-3 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none"
        />
        <select
          value={newPillar}
          onChange={(e) => setNewPillar(e.target.value as ContentPillar)}
          className="h-8 rounded-sm border border-line bg-panel px-2 text-xs text-text-dim focus:border-accent focus:outline-none"
          aria-label="Pilar de la idea"
        >
          {(Object.keys(PILLARS) as ContentPillar[]).map((p) => (
            <option key={p} value={p}>
              {PILLARS[p].short} · {PILLARS[p].label}
            </option>
          ))}
        </select>
        <Button type="submit" size="md" disabled={!newTitle.trim() || creating}>
          {creating ? "Creando…" : "Agregar"}
        </Button>
      </form>

      {/* Lista por fecha de publicación (control de qué sale y cuándo) */}
      {view === "fecha" && (
        <div className="-mx-2 min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {overdue > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-amber/35 bg-amber/8 px-3 py-2">
              <p className="min-w-0 flex-1 text-xs text-text">
                <span className="tabular-nums">{overdue}</span> fecha
                {overdue === 1 ? "" : "s"} vencida{overdue === 1 ? "" : "s"} sin publicar.{" "}
                <span className="text-text-dim">Re-fechar a una cadencia real:</span>
              </p>
              <div className="flex items-center gap-1">
                {[2, 3, 5].map((n) => (
                  <Button key={n} disabled={replanning} onClick={() => void replan(n)}>
                    <span className="tabular-nums">{n}</span> por semana
                  </Button>
                ))}
              </div>
              {replanning && <span className="text-xs text-text-faint">Re-fechando…</span>}
              {!replanning && replanned != null && (
                <span className="text-xs text-green tabular-nums">
                  {replanned} reprogramada{replanned === 1 ? "" : "s"}
                </span>
              )}
            </div>
          )}
          {[...pieces]
            .filter((p) => p.status !== "descartada")
            .sort((a, b) => {
              // Dos sin fecha conservan el orden del servidor (por etiqueta).
              if (!a.publish_at) return b.publish_at ? 1 : 0;
              if (!b.publish_at) return -1;
              return new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime();
            })
            .map((p) => {
              const late =
                p.publish_at &&
                new Date(p.publish_at).getTime() < Date.now() &&
                p.status !== "publicado";
              return (
                <PieceRow
                  key={p.id}
                  piece={p}
                  on={p.id === selectedId}
                  onOpen={setSelectedId}
                  right={<Badge size="sm">{STATUSES[p.status].label}</Badge>}
                >
                  {/* Atrasada = estado (atención): la fecha va en ámbar. */}
                  <span className={`tabular-nums ${late ? "text-amber" : "text-text-dim"}`}>
                    {fmtPublish(p.publish_at)}
                    {late ? " · atrasada" : ""}
                  </span>
                  <Dot />
                  <span>{PILLARS[p.pillar].short}</span>
                  <Dot />
                  <span className="truncate">{p.platforms.join(" + ") || p.format}</span>
                </PieceRow>
              );
            })}
          {!pieces.length && <EmptyList filter={filter} />}
        </div>
      )}

      {/* Grupos por estado */}
      {view === "estado" && (
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2">
          {STATUS_ORDER.map((status) => {
            const group = pieces.filter((p) => p.status === status);
            if (!group.length) return null;
            return (
              <section key={status} className="mb-4">
                <h3
                  className="flex items-center gap-2 px-2 pb-1 text-xs font-medium text-text-dim"
                  title={`${STAGES[status].meaning}\n${STAGES[status].work}`}
                >
                  {STATUSES[status].label}
                  <span className="font-normal text-text-faint tabular-nums">{group.length}</span>
                </h3>
                {group.map((p) => (
                  <PieceRow
                    key={p.id}
                    piece={p}
                    on={p.id === selectedId}
                    onOpen={setSelectedId}
                    dim={p.status === "publicado"}
                    right={<StageProgress piece={p} />}
                  >
                    <Badge size="sm">{PILLARS[p.pillar].short}</Badge>
                    <span className="truncate">{p.platforms.join(" + ") || p.format}</span>
                    {p.publish_at &&
                      (p.status === "programado" || p.status === "publicado" ? (
                        // Programada = compromiso real: la fecha manda.
                        <>
                          <Dot />
                          <span className="shrink-0 text-text-dim tabular-nums">
                            {p.status === "publicado" ? "salió" : "sale"}{" "}
                            {fmtPublish(p.publish_at)}
                          </span>
                        </>
                      ) : (
                        // Objetivo tentativo: sigue siendo un dato secundario.
                        <>
                          <Dot />
                          <span className="shrink-0 tabular-nums">
                            objetivo {fmtPublish(p.publish_at)}
                          </span>
                        </>
                      ))}
                    {p.linear_identifier && (
                      <>
                        <Dot />
                        <span className="shrink-0 font-mono">{p.linear_identifier}</span>
                      </>
                    )}
                  </PieceRow>
                ))}
              </section>
            );
          })}
          {!pieces.length && <EmptyList filter={filter} />}
        </div>
      )}
    </div>
  );
}

/** Píldora de filtro: seleccionada = gris (no acento); sin piezas = apagada. */
function FilterPill({
  on,
  empty = false,
  count,
  title,
  onClick,
  children,
}: {
  on: boolean;
  empty?: boolean;
  count: number;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${
        on
          ? "bg-selected font-medium text-text"
          : empty
            ? "text-text-faint hover:bg-hover"
            : "text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      {children}
      <span className="text-text-faint tabular-nums">{count}</span>
    </button>
  );
}

/** Fila de pieza: título arriba, metadatos en una línea gris abajo. */
function PieceRow({
  piece,
  on,
  dim = false,
  onOpen,
  right,
  children,
}: {
  piece: ContentPiece;
  on: boolean;
  dim?: boolean;
  onOpen: (id: number) => void;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(piece.id)}
      className={`flex w-full cursor-pointer items-center gap-4 rounded-sm px-2 py-2 text-left transition-colors ${
        on ? "bg-selected" : "hover:bg-hover"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${dim ? "text-text-dim" : "text-text"}`}>
          {piece.title}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-text-faint">
          {children}
        </span>
      </span>
      {right && <span className="shrink-0">{right}</span>}
    </button>
  );
}

function Dot() {
  return (
    <span aria-hidden className="shrink-0 text-text-faint">
      ·
    </span>
  );
}

function EmptyList({ filter }: { filter: ContentStatus | null }) {
  return filter ? (
    <PanelState
      kind="empty"
      title={`Nada en ${STATUSES[filter].label.toLowerCase()}`}
      hint="Quita el filtro para ver todas las piezas."
    />
  ) : (
    <PanelState
      kind="empty"
      title="Sin piezas todavía"
      hint="Escribe la primera idea arriba y presiona Enter."
    />
  );
}

/**
 * Avance de TODO el pipeline en la fila (mismo % del detalle): barra fina +
 * número — "¿qué tan cerca está de publicarse?" de un vistazo. Gris siempre;
 * ámbar SOLO si está atascada (con los días que lleva). El detalle por
 * criterios vive en el módulo de progreso de la pieza.
 */
function StageProgress({ piece }: { piece: ContentPiece }) {
  const pct = pipelineProgress(piece);
  if (pct == null) return null;
  const { done, total } = stageProgress(piece);
  const stuck = isStuck(piece);
  const days = daysInStage(piece);
  const value = Math.round(pct * 100);
  return (
    <span
      className="flex items-center gap-2 text-xs text-text-faint tabular-nums"
      title={`${value}% del pipeline · ${done}/${total} criterios para salir de ${STAGES[piece.status].label.toLowerCase()} · ${fmtDays(days)} en la etapa`}
    >
      {/* Atascada es ESTADO (atención): los días van en ámbar. El resto, gris. */}
      {stuck && <span className="text-amber">{fmtDays(days)}</span>}
      <span className="h-1 w-12 overflow-hidden rounded-full bg-selected">
        <span
          className={`block h-full rounded-full ${stuck ? "bg-amber" : "bg-text-faint"}`}
          style={{ width: `${value}%` }}
        />
      </span>
      <span className="w-8 text-right">{value}%</span>
    </span>
  );
}
