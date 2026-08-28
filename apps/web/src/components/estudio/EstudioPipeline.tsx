"use client";

/**
 * Pipeline del ESTUDIO: las piezas agrupadas por etapa (idea → publicado),
 * con filtro por pilar y alta rápida de ideas. Cada tarjeta muestra su avance
 * dentro de la etapa (criterios cumplidos) y cuánto lleva ahí. Clic =
 * seleccionar en el workspace central.
 */
import { useState } from "react";
import { STAGES, daysInStage, isStuck, pipelineProgress, stageProgress } from "@hermes/shared";
import type { ContentPiece, ContentPillar, ContentStatus } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { Badge } from "@/components/ui/Badge";
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
      {/* Vista: por estado (producción) o por fecha (publicación) */}
      <div className="mb-1.5 flex gap-0.5 rounded-sm border border-line p-0.5">
        {(
          [
            ["estado", "Por estado"],
            ["fecha", "Por fecha"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setView(id)}
            className={`flex-1 rounded-xs px-2 py-1 text-2xs tracking-label uppercase ${
              view === id ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {/* Filtro por etapa: el corte real del día a día ("¿qué toca grabar?") */}
      <div className="flex flex-wrap gap-1 px-1 pb-2">
        <button
          onClick={() => setFilter(null)}
          className={`rounded-xs px-1.5 py-0.5 text-2xs tracking-label uppercase ${filter === null ? "bg-violet/16 text-violet" : "text-text-faint hover:text-text-dim"}`}
        >
          Todas
        </button>
        {STATUS_ORDER.map((s) => {
          const n = board.pieces.filter((p) => p.status === s).length;
          return (
            <button
              key={s}
              onClick={() => setFilter(filter === s ? null : s)}
              title={STAGES[s].meaning}
              className={`rounded-xs px-1.5 py-0.5 text-2xs tracking-label uppercase ${
                filter === s
                  ? "bg-violet/16 text-violet"
                  : n
                    ? "text-text-faint hover:text-text-dim"
                    : "text-line-2 hover:text-text-faint"
              }`}
            >
              {STATUSES[s].label} <span className="tabular-nums">{n}</span>
            </button>
          );
        })}
      </div>

      {/* Alta rápida */}
      <div className="mb-2 flex gap-1 px-1">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submitIdea()}
          placeholder="+ nueva idea (Enter)"
          className="min-w-0 flex-1 rounded-sm border border-line bg-transparent px-2 py-1 text-xs text-text placeholder:text-text-faint focus:border-violet focus:outline-none"
        />
        <select
          value={newPillar}
          onChange={(e) => setNewPillar(e.target.value as ContentPillar)}
          className="rounded-sm border border-line bg-panel-2 px-1 py-1 text-2xs text-text-dim focus:outline-none"
          aria-label="Pilar de la idea"
        >
          {(Object.keys(PILLARS) as ContentPillar[]).map((p) => (
            <option key={p} value={p}>
              {PILLARS[p].short}
            </option>
          ))}
        </select>
      </div>

      {/* Lista por fecha de publicación (control de qué sale y cuándo) */}
      {view === "fecha" && (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          {overdue > 0 && (
            <div className="mb-2 rounded-sm border border-amber/40 bg-amber/8 px-2 py-1.5">
              <p className="text-2xs text-amber">
                <span className="tabular-nums">{overdue}</span> fecha
                {overdue === 1 ? "" : "s"} vencida{overdue === 1 ? "" : "s"} sin publicar —
                re-fechar a una cadencia real:
              </p>
              <div className="mt-1 flex items-center gap-1">
                {[2, 3, 5].map((n) => (
                  <button
                    key={n}
                    disabled={replanning}
                    onClick={() => void replan(n)}
                    className="rounded-xs border border-line-2 bg-panel-2 px-2 py-0.5 text-2xs text-text-dim uppercase hover:border-amber hover:text-amber disabled:opacity-40"
                  >
                    {n}/sem
                  </button>
                ))}
                {replanning && <span className="text-2xs text-text-faint">re-fechando…</span>}
                {!replanning && replanned != null && (
                  <span className="text-2xs text-green tabular-nums">
                    ✓ {replanned} reprogramada{replanned === 1 ? "" : "s"}
                  </span>
                )}
              </div>
            </div>
          )}
          {[...pieces]
            .filter((p) => p.status !== "descartada")
            .sort((a, b) => {
              if (!a.publish_at) return 1;
              if (!b.publish_at) return -1;
              return new Date(a.publish_at).getTime() - new Date(b.publish_at).getTime();
            })
            .map((p) => {
              const late =
                p.publish_at &&
                new Date(p.publish_at).getTime() < Date.now() &&
                p.status !== "publicado";
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`mb-1 w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${
                    p.id === selectedId
                      ? "border-violet/40 bg-violet/9"
                      : "border-transparent hover:bg-panel-2"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span
                      className={`text-2xs uppercase tabular-nums ${late ? "text-red" : "text-cyan"}`}
                    >
                      {fmtPublish(p.publish_at)}
                      {late ? " · atrasada" : ""}
                    </span>
                    <Badge tone={STATUSES[p.status].tone} variant="solid" size="sm">
                      {p.status}
                    </Badge>
                  </div>
                  <div className="mt-0.5 text-xs leading-snug text-text">{p.title}</div>
                  <div className="mt-0.5 text-2xs text-text-faint uppercase">
                    {PILLARS[p.pillar].short} · {p.platforms.join("+") || p.format}
                  </div>
                </button>
              );
            })}
        </div>
      )}

      {/* Grupos por estado */}
      {view === "estado" && (
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
        {STATUS_ORDER.map((status) => {
          const group = pieces.filter((p) => p.status === status);
          if (!group.length) return null;
          return (
            <div key={status} className="mb-2">
              <div
                className="flex items-center gap-2 px-1 py-1"
                title={`${STAGES[status].meaning}\n${STAGES[status].work}`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{
                    background:
                      status === "idea"
                        ? "var(--color-text-faint)"
                        : `var(--color-${STATUSES[status].tone === "neutral" ? "text-dim" : STATUSES[status].tone})`,
                  }}
                />
                <span className="text-2xs tracking-label text-text-dim uppercase">
                  {STATUSES[status].label}
                </span>
                <span className="text-2xs text-text-faint tabular-nums">{group.length}</span>
              </div>
              {group.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`mb-1 w-full rounded-sm border px-2 py-1.5 text-left transition-colors ${
                    p.id === selectedId
                      ? "border-violet/40 bg-violet/9"
                      : "border-transparent hover:bg-panel-2"
                  } ${p.status === "publicado" ? "opacity-55" : ""}`}
                >
                  <div className="text-xs leading-snug text-text">{p.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Badge tone={PILLARS[p.pillar].tone} variant="solid" size="sm">
                      {PILLARS[p.pillar].short}
                    </Badge>
                    <StageProgress piece={p} />
                    <span className="max-w-full truncate text-2xs text-text-faint uppercase">
                      {p.platforms.join("+") || p.format}
                    </span>
                    {p.publish_at &&
                      (p.status === "programado" || p.status === "publicado" ? (
                        // Programada = compromiso real: la fecha manda.
                        <span
                          className={`rounded-xs px-1 py-px text-2xs tabular-nums ${
                            p.status === "publicado"
                              ? "bg-panel-2 text-text-dim"
                              : "bg-cyan/15 text-cyan"
                          }`}
                        >
                          {p.status === "publicado" ? "salió" : "sale"}{" "}
                          {fmtPublish(p.publish_at)}
                        </span>
                      ) : (
                        // Objetivo tentativo: sigue siendo un dato secundario.
                        <span className="text-2xs text-text-faint tabular-nums">
                          objetivo {fmtPublish(p.publish_at)}
                        </span>
                      ))}
                    {p.linear_identifier && (
                      <span className="text-2xs text-cyan">{p.linear_identifier}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          );
        })}
        {!pieces.length && (
          <p className="px-2 py-4 text-xs text-text-faint">
            Sin piezas todavía — escribe la primera idea arriba.
          </p>
        )}
      </div>
      )}
    </div>
  );
}

/**
 * Avance de TODO el pipeline en la tarjeta (mismo % del detalle): barra fina
 * + número — "¿qué tan cerca está de publicarse?" de un vistazo; ámbar =
 * atascada. El detalle por criterios vive en el módulo de progreso de la pieza.
 */
function StageProgress({ piece }: { piece: ContentPiece }) {
  const pct = pipelineProgress(piece);
  if (pct == null) return null;
  const { done, total } = stageProgress(piece);
  const stuck = isStuck(piece);
  const days = daysInStage(piece);
  return (
    <span
      className={`flex items-center gap-1.5 text-2xs tabular-nums ${stuck ? "text-amber" : "text-text-faint"}`}
      title={`${Math.round(pct * 100)}% del pipeline · ${done}/${total} criterios para salir de ${STAGES[piece.status].label.toLowerCase()} · ${fmtDays(days)} en la etapa`}
    >
      <span className="h-1 w-10 overflow-hidden rounded-xs bg-line-2/60">
        <span
          className="block h-full rounded-xs"
          style={{
            width: `${Math.round(pct * 100)}%`,
            background: stuck
              ? "var(--color-amber)"
              : pct >= 1
                ? "var(--color-green)"
                : "var(--color-violet)",
          }}
        />
      </span>
      {Math.round(pct * 100)}%{stuck ? ` · ${fmtDays(days)}` : ""}
    </span>
  );
}
