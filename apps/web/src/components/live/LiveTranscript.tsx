"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHART_OTHER, CHART_SLOTS, chartVar } from "@/components/ui/tones";
import { fmtLiveClock, liveSpeakerName, useLiveMeeting } from "@/state/LiveMeetingProvider";

// Mismo campo de texto que MeetingsPanel (borde/focus del design system).
const FIELD =
  "rounded-sm border border-line bg-transparent outline-none transition-colors focus:border-line-2";

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
            <p className="text-2xs tracking-label text-text-dim uppercase pulse-dot">
              ◈ Escuchando… el transcript aparece con la primera intervención
            </p>
          </div>
        ) : (
          <>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + RENDER_CAP)}
                className="mb-1 w-full rounded-sm border border-line px-2 py-1 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-line-2 hover:text-text"
              >
                ↑ Cargar más · {hiddenCount} intervenciones anteriores
              </button>
            )}
            {visible.map((s) => {
              const color = speakerColor(s.speaker, live.speakerOrder);
              const isEditing = editing?.segId === s.id;
              return (
                <div key={s.id} className="flex items-start gap-2 py-1">
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
                        className={`${FIELD} w-24 px-1.5 py-px text-2xs text-text`}
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
                        className={`rounded-sm border px-1.5 py-px text-2xs tracking-label uppercase transition-colors ${
                          live.selfSpeaker === s.speaker
                            ? "border-cyan text-cyan"
                            : "border-line text-text-dim hover:border-line-2 hover:text-text"
                        }`}
                      >
                        {live.selfSpeaker === s.speaker ? "✓ soy yo" : "soy yo"}
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
                      // El color viene de chartVar (paleta categórica del
                      // design system) — sancionado para style, como en charts.
                      className="shrink-0 rounded-sm border px-1.5 py-px text-2xs tracking-label uppercase opacity-90 transition-opacity hover:opacity-100"
                      style={{ borderColor: color, color }}
                    >
                      {liveSpeakerName(s.speaker, live.speakerNames, live.speakerOrder)}
                      {live.selfSpeaker === s.speaker ? " · yo" : ""}
                    </button>
                  )}
                  <p
                    className={`min-w-0 flex-1 text-xs leading-relaxed ${
                      s.final ? "text-text" : "text-text-dim italic"
                    }`}
                  >
                    {s.text}
                  </p>
                  <span className="shrink-0 text-2xs text-text-faint tabular-nums">
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
          className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm border border-cyan bg-bg px-2.5 py-1 text-2xs tracking-label text-cyan uppercase transition-colors hover:bg-cyan/10"
        >
          ↓ {newCount} nuevos
        </button>
      )}
    </div>
  );
}
