"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_OTHER, CHART_SLOTS, chartVar } from "@/components/ui/tones";
import { fmtLiveClock, liveSpeakerName, useLiveMeeting } from "@/state/LiveMeetingProvider";

// Mismo campo de texto que el resto del design system.
const FIELD =
  "rounded-xs border border-line bg-panel outline-none transition-colors focus:border-line-2";

/** Segmentos renderizados a la vez; "cargar más" suma otra tanda (sin lib de
 *  virtualización: filas de texto plano a 300 nodos son baratas). */
const RENDER_CAP = 300;

/** Color estable por label del provider — paleta categórica real de charts. */
function speakerColor(label: string, order: string[]): string {
  if (label === "UNKNOWN") return CHART_OTHER;
  const idx = order.indexOf(label);
  return idx === -1 ? CHART_OTHER : chartVar(idx % CHART_SLOTS);
}

/**
 * Columna del transcript en vivo: auto-scroll con pausa al scrollear arriba
 * (+ botón "↓ N nuevos" para re-engancharse), parciales en dim italic, chip
 * de hablante clickeable → rename inline optimista.
 */
export function LiveTranscript() {
  const live = useLiveMeeting();
  const boxRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [paused, setPaused] = useState(false);
  const [pausedAt, setPausedAt] = useState(0);
  const [visibleCount, setVisibleCount] = useState(RENDER_CAP);
  const [editing, setEditing] = useState<{ speaker: string; segId: string; value: string } | null>(
    null,
  );

  // Los parciales vacíos no aportan nada visible.
  const rows = useMemo(
    () => live.segments.filter((s) => s.text.trim().length > 0),
    [live.segments],
  );

  // Junta nueva → transcript desde cero.
  useEffect(() => {
    setVisibleCount(RENDER_CAP);
    setPaused(false);
    setEditing(null);
    stickRef.current = true;
  }, [live.liveId]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    const stuck = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (stuck !== stickRef.current) {
      stickRef.current = stuck;
      setPaused(!stuck);
      if (!stuck) setPausedAt(rows.length);
    }
  };

  // Enganchado al fondo: sigue cada segmento nuevo sin arrastrar al usuario
  // que scrolleó arriba a releer.
  useEffect(() => {
    if (stickRef.current) {
      const el = boxRef.current;
      el?.scrollTo({ top: el.scrollHeight });
    }
  }, [rows]);

  const resume = () => {
    stickRef.current = true;
    setPaused(false);
    const el = boxRef.current;
    el?.scrollTo({ top: el.scrollHeight });
  };

  const commitRename = () => {
    if (!editing) return;
    const { speaker, value } = editing;
    setEditing(null);
    if (value.trim()) live.renameSpeaker(speaker, value);
  };

  const visible = rows.slice(-visibleCount);
  const hiddenCount = rows.length - visible.length;
  const newCount = Math.max(0, rows.length - pausedAt);

  return (
    <div className="relative min-h-0 min-w-0 flex-1">
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain pr-1"
      >
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center px-4 text-center">
            <div className="flex flex-col items-center gap-2">
              <span aria-hidden className="pulse-dot h-2 w-2 rounded-full bg-cyan" />
              <p className="text-sm font-medium text-text">Escuchando…</p>
              <p className="text-xs text-text-faint">
                El transcript aparece con la primera intervención.
              </p>
            </div>
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + RENDER_CAP)}
                className="mb-2 h-7 w-full cursor-pointer rounded-sm border border-line text-xs text-text-dim transition-colors hover:border-line-2 hover:bg-hover hover:text-text"
              >
                Cargar {hiddenCount} intervenciones anteriores
              </button>
            )}
            {visible.map((s) => {
              const color = speakerColor(s.speaker, live.speakerOrder);
              const isEditing = editing?.segId === s.id;
              return (
                <div key={s.id} className="flex min-w-0 items-start gap-3 rounded-sm px-1 py-1.5">
                  {isEditing ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <input
                        autoFocus
                        value={editing.value}
                        onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename();
                          else if (e.key === "Escape") setEditing(null);
                        }}
                        placeholder="Nombre…"
                        aria-label="Renombrar hablante"
                        className={`${FIELD} h-6 w-24 px-1.5 text-xs text-text`}
                      />
                      <button
                        type="button"
                        // onMouseDown: gana antes que el onBlur del input (que cierra la edición).
                        onMouseDown={(e) => {
                          e.preventDefault();
                          live.markSelf(s.speaker);
                          setEditing(null);
                        }}
                        title="El copiloto no responde a tus propias intervenciones"
                        className={`h-6 cursor-pointer rounded-xs border px-1.5 text-xs transition-colors ${
                          live.selfSpeaker === s.speaker
                            ? "border-line-2 bg-selected text-text"
                            : "border-line text-text-dim hover:border-line-2 hover:text-text"
                        }`}
                      >
                        {live.selfSpeaker === s.speaker ? "Soy yo ✓" : "Soy yo"}
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          speaker: s.speaker,
                          segId: s.id,
                          value: live.speakerNames[s.speaker] ?? "",
                        })
                      }
                      title="Renombrar hablante"
                      // El color del hablante viene de chartVar (paleta
                      // categórica, como una serie de un gráfico) y va SOLO en
                      // el punto: el nombre queda en gris legible.
                      className="flex w-[112px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xs pt-px text-left text-xs font-medium text-text-dim transition-colors hover:text-text"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: color }}
                      />
                      <span className="min-w-0 truncate">
                        {liveSpeakerName(s.speaker, live.speakerNames, live.speakerOrder)}
                        {live.selfSpeaker === s.speaker && !live.isClass ? " · yo" : ""}
                      </span>
                    </button>
                  )}
                  <p
                    className={`min-w-0 flex-1 text-sm leading-relaxed ${
                      s.final ? "text-text" : "text-text-dim italic"
                    }`}
                  >
                    {s.text}
                  </p>
                  <span className="shrink-0 pt-0.5 font-mono text-2xs text-text-faint tabular-nums">
                    {fmtLiveClock(s.startMs)}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>

      {paused && newCount > 0 && (
        <button
          type="button"
          onClick={resume}
          className="absolute bottom-2 left-1/2 flex h-7 -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line-2 bg-panel px-3 text-xs text-text shadow-[var(--shadow-pop)] transition-colors hover:bg-hover"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          {newCount} nuevos
        </button>
      )}
    </div>
  );
}
