"use client";

/**
 * Checklist del pipeline de una sesión, EN VIVO (patrón Descript "Activity" +
 * AirOps: pasos no bloqueantes con su avance real y "puedes seguir
 * trabajando"). Cada etapa dice lo que de verdad pasó (detalle del agente,
 * duración medida) y un error se reintenta DESDE esa etapa sin repetir las
 * anteriores: la copia verificada de 4 GB no se rehace porque falló Scribe.
 */
import { useState } from "react";
import { SESSION_STAGES, SESSION_STAGE_LABEL, type ComposeSession, type StageState } from "@hermes/shared";
import { btn, btnGhost } from "./ui";
import { fmtDuration, pct } from "./format";

const ICON: Record<StageState["status"], string> = {
  pendiente: "○",
  corriendo: "◌",
  listo: "✓",
  error: "△",
  omitido: "–",
};
const ICON_TONE: Record<StageState["status"], string> = {
  pendiente: "text-text-faint",
  corriendo: "text-accent animate-pulse",
  listo: "text-green",
  error: "text-red",
  omitido: "text-text-faint",
};

function took(s: StageState): string | null {
  if (!s.startedAt || !s.endedAt) return null;
  const sec = (new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000;
  return sec >= 1 ? fmtDuration(sec) : null;
}

export function SessionPipeline({
  session,
  onProcess,
  onStop,
}: {
  session: ComposeSession;
  onProcess: (from?: StageState["stage"]) => void;
  onStop: () => void;
}) {
  const stages = SESSION_STAGES.map(
    (st) => session.stages.find((x) => x.stage === st) ?? ({ stage: st, status: "pendiente" } as StageState),
  );
  const failed = stages.find((s) => s.status === "error");
  const done = stages.filter((s) => s.status === "listo" || s.status === "omitido").length;
  const quiet = session.status === "lista" && !failed;
  const [open, setOpen] = useState(!quiet);

  if (quiet && !open) {
    return (
      <div className="flex shrink-0 items-center gap-2 text-xs text-text-faint">
        <span className="text-green">✓</span> Procesada · {done} de {stages.length} etapas
        <button type="button" className={btnGhost} onClick={() => setOpen(true)}>
          ver etapas
        </button>
        <button type="button" className={btnGhost} onClick={() => onProcess()} title="Vuelve a correr lo que falte">
          ↻ reprocesar
        </button>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-text">
          {session.status === "procesando"
            ? "Procesando la sesión"
            : session.status === "detenida"
              ? "Procesamiento detenido"
              : session.status === "error"
                ? "El procesamiento se detuvo por un error"
                : "Etapas"}
        </span>
        {session.status === "procesando" && (
          <span className="text-xs text-text-faint">
            puedes seguir trabajando: los pasajes aparecen a medida que se detectan
          </span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {session.status === "procesando" ? (
            <button type="button" className={btn} onClick={onStop}>
              ■ Detener
            </button>
          ) : session.status !== "lista" ? (
            <button type="button" className={btn} onClick={() => onProcess(failed?.stage)}>
              ↻ Reanudar
            </button>
          ) : null}
          {quiet && (
            <button type="button" className={btnGhost} onClick={() => setOpen(false)}>
              ocultar
            </button>
          )}
        </span>
      </div>
      <ol className="grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
        {stages.map((s) => (
          <li key={s.stage} className="flex min-w-0 items-start gap-2 text-xs">
            <span aria-hidden className={`w-3 shrink-0 text-center ${ICON_TONE[s.status]}`}>
              {ICON[s.status]}
            </span>
            <span className="min-w-0 flex-1">
              <span className={s.status === "pendiente" ? "text-text-faint" : "text-text"}>
                {SESSION_STAGE_LABEL[s.stage]}
              </span>
              {(s.detail || took(s)) && (
                <span className="text-text-faint"> · {[s.detail, took(s)].filter(Boolean).join(" · ")}</span>
              )}
              {s.status === "corriendo" && s.pct != null && (
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                  <span
                    className="block h-full rounded-full bg-accent transition-[width]"
                    style={{ width: pct(Math.min(1, Math.max(0, s.pct))).replace(" ", "") }}
                  />
                </span>
              )}
              {s.status === "error" && (
                <span className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-red">{s.error ?? "falló"}</span>
                  <button type="button" className={btnGhost} onClick={() => onProcess(s.stage)}>
                    ↻ reintentar desde aquí
                  </button>
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
