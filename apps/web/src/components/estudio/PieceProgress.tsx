"use client";

/**
 * Progreso de la pieza en UN solo módulo — antes eran tres franjas (chips de
 * etapas + propiedades + panel de etapa) compitiendo por el ojo. Patrones
 * Mobbin: Uxcel (anillo con "N% complete" al lado del checklist) · Contra
 * (stepper de puntos ✓—●—○ conectados, sin texto por chip) · Graphite/Mercury
 * (solo el paso ACTUAL expandido; el detalle se pide, no se impone).
 *
 *   ┌ ◐ 62% ─ ✓──✓──●──○──○──○ ────────────────── [Edición →] ┐
 *   │  Grabación · Grabar las tomas y marcar… · 2 días aquí ▾  │
 *   │  [✓ Tomas registradas] [○ Al menos una toma buena]       │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Los criterios de la etapa actual van SIEMPRE visibles como chips (cada uno
 * salta a su tab). Antes vivían tras el ▾ y la línea solo cabía para
 * "falta: X (+2)": había que abrir y leer para saber en qué punto está el
 * video. El ▾ conserva lo que sí se pide: definición, recorrido y descarte.
 *
 * El % es de TODO el pipeline hasta publicar (pipelineProgress en shared):
 * etapas pasadas completas + la fracción REAL de criterios de la actual —
 * el mismo dato honesto de siempre, nunca un número decorativo.
 */
import { useState } from "react";
import {
  CONTENT_STAGES,
  STAGES,
  daysInStage,
  pipelineProgress,
  stageDurations,
  stageGates,
  stageReady,
} from "@hermes/shared";
import type { ContentPiece, ContentStatus } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { ConfirmModal } from "./ConfirmModal";
import { fmtDays, fmtPublish } from "./labels";

type Tab = "guion" | "tomas" | "edicion" | "publicacion";

/** Clases ESTÁTICAS por tono (Tailwind purga las interpoladas). */
const ACTIVE_DOT: Record<string, string> = {
  green: "border-green bg-green/20 text-green",
  amber: "border-amber bg-amber/20 text-amber",
  violet: "border-violet bg-violet/20 text-violet",
  cyan: "border-cyan bg-cyan/20 text-cyan",
  neutral: "border-line-2 bg-panel-2 text-text-dim",
};

/** Dónde se resuelve cada criterio → tab del workspace (null = cabecera). */
const WHERE_TAB: Record<string, Tab | null> = {
  "tab Guion": "guion",
  "tab Tomas": "tomas",
  "tab Edición": "edicion",
  "tab Publicación": "publicacion",
  cabecera: null,
};

export function PieceProgress({
  piece,
  onGo,
}: {
  piece: ContentPiece;
  /** Salta al tab donde se resuelve un criterio pendiente. */
  onGo: (tab: Tab) => void;
}) {
  const { patchPiece } = useEstudioContext();
  const [open, setOpen] = useState(false);
  // Candado de etapas: mover la pieza SIEMPRE pasa por confirmación. Un clic
  // suelto en el stepper llegó a mover una pieza real tres veces (2026-08-10)
  // y entrar a "programado" encola subidas — demasiado poder para un clic.
  const [pendingMove, setPendingMove] = useState<ContentStatus | null>(null);

  const discarded = piece.status === "descartada";
  const stage = STAGES[piece.status];
  const gates = stageGates(piece);
  const ready = stageReady(piece);
  const pendientes = gates.filter((g) => !g.done);
  const days = daysInStage(piece);
  const overSla = stage.sla != null && days != null && days > stage.sla;
  const next = stage.next;
  const pct = pipelineProgress(piece);
  const currentIdx = CONTENT_STAGES.indexOf(piece.status);
  const history = stageDurations(piece);

  const scheduled = piece.status === "programado" && Boolean(piece.publish_at);
  const tone = discarded
    ? "neutral"
    : scheduled
      ? "cyan"
      : ready && next
        ? "green"
        : overSla
          ? "amber"
          : "violet";

  // Descartada: fuera del pipeline — una línea con la salida de vuelta.
  if (discarded)
    return (
      <div className="mt-2 flex items-center justify-between gap-2 rounded-sm border border-red/30 bg-red/5 px-3 py-2">
        <p className="text-xs text-text-dim">
          <span className="text-red">Descartada</span> — archivada para no volver a proponerla.
        </p>
        <button
          onClick={() => void patchPiece(piece.id, { status: "idea" })}
          className="shrink-0 rounded-sm border border-line-2 bg-panel-2 px-2.5 py-1 text-2xs tracking-label text-text uppercase hover:border-violet"
        >
          ↺ Restaurar a idea
        </button>
      </div>
    );

  return (
    <div
      className={`mt-2 rounded-sm border px-3 py-2 ${
        scheduled
          ? "border-cyan/35 bg-cyan/6"
          : ready && next
            ? "border-green/35 bg-green/6"
            : "border-line bg-panel-2/40"
      }`}
    >
      <div className="flex items-center gap-3">
        {/* El número que pediste ver: % de TODO el proceso hasta publicar. */}
        <div
          role="progressbar"
          aria-valuenow={Math.round((pct ?? 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Avance total de la pieza: ${Math.round((pct ?? 0) * 100)}%`}
          className="shrink-0"
        >
          <RadialGauge value={Math.round((pct ?? 0) * 100)} size={56} stroke={5} tone={tone} />
        </div>

        <div className="min-w-0 flex-1">
          {/* Stepper de puntos (Contra): ✓ pasadas · ● actual · ○ por venir.
              Clic = mover la pieza (el poder de siempre, sin 7 chips de texto). */}
          <div className="flex items-center" role="list" aria-label="Etapas del pipeline">
            {CONTENT_STAGES.map((s, i) => {
              const passed = i < currentIdx;
              const active = i === currentIdx;
              return (
                <div key={s} role="listitem" className={`flex items-center ${i > 0 ? "flex-1" : ""}`}>
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={`h-px min-w-3 flex-1 ${passed || active ? "bg-violet/60" : "bg-line-2"}`}
                    />
                  )}
                  <button
                    onClick={() => s !== piece.status && setPendingMove(s)}
                    title={`${STAGES[s].label} — ${STAGES[s].meaning}`}
                    aria-current={active ? "step" : undefined}
                    aria-label={`${STAGES[s].label}${active ? " (etapa actual)" : passed ? " (pasada)" : ""}`}
                    className={`group flex shrink-0 flex-col items-center gap-0.5 px-0.5 ${
                      active ? "" : "opacity-80 hover:opacity-100"
                    }`}
                  >
                    <span
                      className={`flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px] leading-none transition-colors ${
                        active
                          ? (ACTIVE_DOT[tone] ?? ACTIVE_DOT.violet)
                          : passed
                            ? "border-violet/60 bg-violet/15 text-violet"
                            : "border-line-2 text-transparent group-hover:border-text-faint"
                      }`}
                    >
                      {passed ? "✓" : active ? "●" : "○"}
                    </span>
                    <span
                      className={`text-2xs leading-none tracking-label uppercase max-xl:hidden ${
                        active ? "text-text" : passed ? "text-text-dim" : "text-text-faint"
                      }`}
                    >
                      {STAGES[s].label}
                    </span>
                    {/* En angosto: solo la etapa actual conserva su nombre */}
                    {active && (
                      <span className="text-2xs leading-none tracking-label text-text uppercase xl:hidden">
                        {STAGES[s].label}
                      </span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* La línea que responde "¿y ahora qué?": etapa · estado · hace cuánto. */}
          <button
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            className="mt-1.5 flex w-full items-center gap-2 text-left"
          >
            <span className="min-w-0 flex-1 truncate text-xs text-text-dim">
              <span className={scheduled ? "text-cyan" : ready && next ? "text-green" : "text-text"}>
                {stage.label}
              </span>
              {" · "}
              {/* Programada/publicada: lo que importa es la FECHA, no cuántos
                  criterios faltan. Antes decía "falta 1 de 3" incluso con el
                  video ya programado, y no había forma de ver cuándo sale sin
                  entrar al tab Publicación. */}
              {piece.publish_at && (piece.status === "programado" || piece.status === "publicado")
                ? `${piece.status === "publicado" ? "salió" : "sale"} ${fmtPublish(piece.publish_at)}`
                : ready
                  ? next
                    ? "todo listo para avanzar"
                    : "cerrada"
                  : `falta ${pendientes.length} de ${gates.length}`}
              <span className={`tabular-nums ${overSla ? " text-amber" : " text-text-faint"}`}>
                {" · "}
                {fmtDays(days)} aquí{overSla ? " · atascada" : ""}
              </span>
            </span>
            <span aria-hidden className="shrink-0 text-2xs text-text-faint">
              {open ? "▴" : "▾"}
            </span>
          </button>

          {/* Qué falta, SIEMPRE a la vista. Antes vivía tras el ▾ y la línea
              solo cabía para "falta: X (+2)": había que abrir y leer para
              saber en qué punto real está el video. Cada chip salta a su tab. */}
          {!ready && gates.length > 0 && (
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {gates.map((g) => {
                const tab = WHERE_TAB[g.where];
                return (
                  <button
                    key={g.label}
                    onClick={() => tab && onGo(tab)}
                    disabled={!tab}
                    title={tab ? `Resolver en ${g.where}` : "Se resuelve en la cabecera"}
                    className={`flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-2xs ${
                      g.done
                        ? "border-green/30 text-green/70"
                        : "border-line-2 text-text-dim enabled:hover:border-violet enabled:hover:text-text"
                    }`}
                  >
                    <span aria-hidden>{g.done ? "✓" : "○"}</span>
                    <span className={g.done ? "line-through" : ""}>{g.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {next && (
          <button
            onClick={() => setPendingMove(next)}
            title={
              ready
                ? `Cumple todo — pasar a ${STAGES[next].label}`
                : `Faltan ${pendientes.length} criterios, pero la decisión es tuya`
            }
            className={`shrink-0 self-center rounded-sm border px-2.5 py-1.5 text-2xs tracking-label uppercase ${
              ready
                ? "border-green bg-green/10 text-green"
                : "border-line-2 bg-panel-2 text-text-dim hover:border-violet hover:text-text"
            }`}
          >
            {STAGES[next].label} →
          </button>
        )}
      </div>

      {/* El detalle se pide, no se impone (Graphite): criterios con salto al
          tab, definición de la etapa, recorrido y la salida de descarte. */}
      {open && (
        <div className="mt-2 flex flex-col gap-2 border-t border-line pt-2">
          <p className="text-xs leading-snug text-text-dim">
            {stage.meaning} <span className="text-text-faint">{stage.work}</span>
          </p>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-2xs tracking-label text-text-faint uppercase">Recorrido</span>
            {history.length ? (
              history.map((h, i) => (
                <span key={`${h.status}-${h.at}`} className="text-2xs text-text-faint">
                  {i > 0 && <span className="mx-1 text-line-2">›</span>}
                  <span className={h.current ? "text-violet" : "text-text-dim"}>
                    {STAGES[h.status].label}
                  </span>{" "}
                  <span className="tabular-nums">{fmtDays(h.days)}</span>
                </span>
              ))
            ) : (
              <span className="text-2xs text-text-faint">
                Se registra desde el próximo cambio de etapa.
              </span>
            )}
            <span className="flex-1" />
            <button
              onClick={() => setPendingMove("descartada")}
              className="text-2xs tracking-label text-text-faint uppercase hover:text-red"
            >
              ✕ descartar
            </button>
          </div>
        </div>
      )}

      {pendingMove && (
        <StageMoveModal
          piece={piece}
          to={pendingMove}
          onClose={() => setPendingMove(null)}
          onConfirm={() => {
            void patchPiece(piece.id, { status: pendingMove });
            setPendingMove(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Qué significa el movimiento ANTES de hacerlo (Kajabi: "check your selections
 * carefully"): hacia atrás avisa que se devuelve trabajo, hacia adelante lista
 * los criterios que se saltaría, y entrar a Programado dice la consecuencia
 * real — se encolan subidas a YouTube.
 */
function StageMoveModal({
  piece,
  to,
  onClose,
  onConfirm,
}: {
  piece: ContentPiece;
  to: ContentStatus;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const from = piece.status;
  const fromIdx = CONTENT_STAGES.indexOf(from);
  const toIdx = CONTENT_STAGES.indexOf(to);
  const discard = to === "descartada";
  const backward = !discard && toIdx >= 0 && fromIdx >= 0 && toIdx < fromIdx;
  const pending = stageGates(piece).filter((g) => !g.done);
  const toLabel = discard ? "Descartada" : STAGES[to].label;
  const tone = discard ? "red" : backward ? "amber" : "violet";

  return (
    <ConfirmModal
      title="Mover de etapa"
      confirmLabel={discard ? "Descartar pieza" : `Mover a ${toLabel}`}
      tone={tone}
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-xs text-text">
        <span className="text-text-dim">{STAGES[from].label}</span>
        <span className="mx-1.5 text-text-faint">→</span>
        <span className={discard ? "text-red" : backward ? "text-amber" : "text-violet"}>
          {toLabel}
        </span>
      </p>

      {discard && (
        <p className="text-xs leading-snug text-text-dim">
          La pieza sale del pipeline y se archiva para no volver a proponerla. Se puede restaurar
          a idea después.
        </p>
      )}

      {backward && (
        <p className="text-xs leading-snug text-text-dim">
          Vas a <span className="text-amber">devolver la pieza</span>. El recorrido queda
          registrado en el historial y el contador de días de la etapa se reinicia — el trabajo
          hecho (guion, tomas, master) no se borra.
        </p>
      )}

      {!discard && !backward && pending.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-text-dim">
            Avanzas <span className="text-amber">sin cumplir</span>:
          </p>
          {pending.map((g) => (
            <p key={g.label} className="text-xs text-text-faint">
              ○ {g.label}
            </p>
          ))}
        </div>
      )}

      {to === "programado" && (
        <p className="rounded-xs border border-violet/30 bg-violet/5 px-2 py-1.5 text-2xs leading-snug text-text-dim">
          Al entrar a Programado, las variantes con copy se encolan y el barrido las{" "}
          <span className="text-violet">sube a YouTube</span> (privadas hasta su fecha).
        </p>
      )}

      <p className="text-2xs text-text-faint">{discard ? "" : STAGES[to].meaning}</p>
    </ConfirmModal>
  );
}
