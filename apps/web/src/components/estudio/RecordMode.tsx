"use client";

/**
 * MODO GRABACIÓN: la pantalla de "solo lo que tengo que decir".
 *
 * Patrón de teleprompter (Mobbin — ElevenReader / Beside "Read Aloud" para el
 * texto grande con la frase vigente encendida y el resto atenuado; CapCut para
 * el control de tamaño; Codecademy para el riel de checklist a la izquierda):
 *
 *   ┌──────────────┬────────────────────────────────────────────┐
 *   │ CHECKLIST    │   [0-3s]                                   │
 *   │ ✓ Hook       │   «Esto no es CGI. Estoy moviendo el       │
 *   │ ✓ [0-3s]     │    cursor con la mano.»                    │
 *   │ ● [3-12s]    │   ── EN PANTALLA ──                        │
 *   │ ○ [12-22s]   │   ▸ DEMO: pinza índice → click             │
 *   └──────────────┴────────────────────────────────────────────┘
 *
 * El centro NO renderiza markdown: muestra las frases limpias, sin cues ni
 * acotaciones (esas viven en el detalle de la toma, debajo). Marcar un beat
 * escribe un `ContentTake` REAL en la pieza — el mismo dato que leen el tab
 * Tomas, los criterios de la etapa `grabacion` y el espejo del vault; no hay
 * checkbox decorativo que se pueda marcar sin haber grabado.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ContentPiece, ContentTake } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { usePieceMedia } from "@/hooks/usePieceMedia";
import { fmtSeconds, takeStem, voTakesFor } from "@/lib/capture";
import { MicLevel, useVoiceOverTake } from "./VoiceOver";
import {
  parseScript,
  pieceBeats,
  spokenSeconds,
  takeForBeat,
  withBeatVerdict,
  type ScriptBeat,
} from "@/lib/script-beats";
import { ScriptChecklist } from "./ScriptChecklist";

const FONT_MIN = 18;
const FONT_MAX = 56;
const FONT_KEY = "hermes.estudio.teleprompter.px";

const btn =
  "rounded-sm border border-line-2 bg-panel-2 px-2.5 py-1 text-2xs tracking-label text-text uppercase hover:border-violet disabled:opacity-35";

/** "0:07" — cronómetro del beat en curso. */
function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RecordMode() {
  const { board, recordingId, setRecording, patchPiece } = useEstudioContext();
  const piece = board.pieces.find((p) => p.id === recordingId) ?? null;
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!piece || !mounted) return null;
  return createPortal(
    <Teleprompter piece={piece} onExit={() => setRecording(null)} onPatch={patchPiece} />,
    document.body,
  );
}

function Teleprompter({
  piece,
  onExit,
  onPatch,
}: {
  piece: ContentPiece;
  onExit: () => void;
  onPatch: ReturnType<typeof useEstudioContext>["patchPiece"];
}) {
  const { recordingBeat } = useEstudioContext();
  const beats = useMemo(() => pieceBeats(piece), [piece]);
  const notes = useMemo(() => parseScript(piece.script_md).notes, [piece.script_md]);
  const [idx, setIdx] = useState(() => Math.min(Math.max(recordingBeat, 0), Math.max(beats.length - 1, 0)));
  const [px, setPx] = useState(28);
  const [elapsed, setElapsed] = useState(0);
  const liveRef = useRef<HTMLDivElement | null>(null);
  // Voz en off: los bloques de pantalla/demo se narran aquí mismo, leyendo el
  // teleprompter, y el audio cae en assets/ con el nombre del bloque.
  const voice = useVoiceOverTake(piece.id);
  const { media, refresh: refreshMedia } = usePieceMedia(piece.id);

  // Tamaño de letra: se lee a un metro de la cámara, y la preferencia se queda.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(FONT_KEY));
    if (saved >= FONT_MIN && saved <= FONT_MAX) setPx(saved);
  }, []);
  useEffect(() => {
    window.localStorage.setItem(FONT_KEY, String(px));
  }, [px]);

  const current = beats[idx] ?? null;
  const go = useCallback(
    (next: number) => setIdx(Math.min(Math.max(next, 0), Math.max(beats.length - 1, 0))),
    [beats.length],
  );

  /**
   * Marcar el beat = escribir su toma. El mismo veredicto dos veces la borra
   * (deshacer sin menús). Upsert por etiqueta: re-parsear el guion no duplica.
   */
  const mark = useCallback(
    (beat: ScriptBeat, verdict: ContentTake["verdict"]) => {
      void onPatch(piece.id, { takes: withBeatVerdict(piece, beat, verdict) });
    },
    [piece, onPatch],
  );

  /**
   * ● / ⏹ de la voz en off del bloque vigente. Al detener SIEMPRE se guarda:
   * la lección de las juntas perdidas aplica igual aquí — el audio grabado no
   * se tira por un atajo de teclado.
   */
  const toggleVoice = useCallback(async () => {
    const beat = beats[idx];
    if (!beat) return;
    if (voice.target) {
      await voice.finish();
      await refreshMedia();
      return;
    }
    await voice.start(takeStem(idx, beat.label));
  }, [beats, idx, voice, refreshMedia]);

  // Cronómetro del beat: cuánto llevas realmente en este bloque.
  useEffect(() => {
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [idx]);

  // El beat vigente siempre centrado (autoscroll del teleprompter).
  useEffect(() => {
    liveRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [idx]);

  // Manos ocupadas frente a la cámara: todo se maneja con una tecla.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const beat = beats[idx];
      switch (e.key) {
        case "Escape":
          // Grabando: la primera Esc cierra y GUARDA la toma; la segunda sale.
          if (voice.target) void toggleVoice();
          else onExit();
          break;
        case "r":
        case "R":
          e.preventDefault();
          void toggleVoice();
          break;
        case "ArrowDown":
        case "ArrowRight":
        case "j":
        case " ":
          e.preventDefault();
          go(idx + 1);
          break;
        case "ArrowUp":
        case "ArrowLeft":
        case "k":
          e.preventDefault();
          go(idx - 1);
          break;
        case "1":
          if (beat) {
            // Con la voz corriendo, "buena" la cierra primero: el bloque queda
            // marcado y su audio guardado en el mismo gesto.
            if (voice.target) void toggleVoice();
            mark(beat, "buena");
            go(idx + 1);
          }
          break;
        case "2":
          if (beat) mark(beat, "revisar");
          break;
        case "+":
        case "=":
          setPx((p) => Math.min(FONT_MAX, p + 2));
          break;
        case "-":
          setPx((p) => Math.max(FONT_MIN, p - 2));
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beats, idx, go, mark, onExit, toggleVoice, voice.target]);

  const take = current ? takeForBeat(piece, current) : null;
  const target = current?.seconds ?? (current ? spokenSeconds(current.words) : null);
  const overTarget = target != null && elapsed > target + 2;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-bg">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onExit}
            className="shrink-0 text-2xs tracking-label text-text-faint uppercase hover:text-text"
          >
            ← Salir
          </button>
          <span className="shrink-0 text-2xs tracking-label text-red uppercase">● Grabando</span>
          <span className="min-w-0 truncate text-xs text-text-dim">{piece.title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-2xs text-text-faint tabular-nums">
            {beats.length ? `${idx + 1}/${beats.length}` : "—"}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPx((p) => Math.max(FONT_MIN, p - 2))}
              className={btn}
              aria-label="Letra más pequeña"
            >
              A−
            </button>
            <button
              onClick={() => setPx((p) => Math.min(FONT_MAX, p + 2))}
              className={btn}
              aria-label="Letra más grande"
            >
              A+
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Riel: el guion COMPLETO como checklist — hook, cada bloque y las
            notas de set. Clic = saltar ahí (no hay que leer en orden). */}
        <aside className="flex max-h-[28vh] min-h-0 min-w-0 flex-col border-b border-line lg:max-h-none lg:border-r lg:border-b-0">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
            <ScriptChecklist
              piece={piece}
              beats={beats}
              activeIndex={idx}
              onSelect={go}
              onMark={mark}
            />
          </div>
          {notes.length > 0 && (
            <div className="shrink-0 border-t border-line px-3 py-2">
              <p className="text-2xs tracking-label text-text-faint uppercase">Notas de set</p>
              {notes.map((n) => (
                <p key={n} className="mt-1 text-2xs leading-snug text-text-dim">
                  {n}
                </p>
              ))}
            </div>
          )}
        </aside>

        {/* Teleprompter: SOLO las frases. Lo demás es contexto atenuado. */}
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain px-6 py-[35vh]">
          {/* fontSize aquí y no solo en cada frase: `ch` mide contra la letra
              del contenedor — sin esto la columna se calcula con los 13px base
              y queda de la mitad del ancho al subir el tamaño. */}
          <div
            className="mx-auto flex w-full max-w-[34ch] flex-col gap-10"
            style={{ fontSize: `${px}px` }}
          >
            {beats.map((beat, i) => {
              const live = i === idx;
              return (
                <div
                  key={`${beat.label}-${i}`}
                  ref={live ? liveRef : undefined}
                  onClick={() => go(i)}
                  className={`cursor-pointer transition-opacity duration-200 ${
                    live ? "opacity-100" : "opacity-25 hover:opacity-50"
                  }`}
                >
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-2xs tracking-label text-violet uppercase">
                      {beat.kind === "hook" ? "✦ Hook" : (beat.heading ?? beat.label)}
                    </span>
                    {beat.heading && beat.time && (
                      <span className="text-2xs text-text-faint tabular-nums">{beat.time}</span>
                    )}
                    {beat.isCta && (
                      <span className="text-2xs tracking-label text-cyan uppercase">CTA</span>
                    )}
                  </div>
                  {beat.say.length ? (
                    beat.say.map((line, j) => (
                      <p
                        key={j}
                        className="font-display leading-snug text-text"
                        style={{ fontSize: live ? "1em" : "0.62em" }}
                      >
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className="text-sm text-text-faint">
                      (bloque sin frases — solo dirección de cámara)
                    </p>
                  )}

                  {/* Detalle de la toma: qué tiene que verse mientras dices eso.
                      Solo en el beat vigente — no compite con la lectura. */}
                  {live && (
                    <div className="mt-5 rounded-sm border border-line bg-panel-2/50 px-3 py-2">
                      {/* El nombre con el que se guarda el crudo (da igual la app):
                          así el checklist de Tomas lo encuentra en el disco. */}
                      <p className="text-2xs text-text-faint">
                        Archivo:{" "}
                        <span className="font-mono text-violet">{takeStem(i, beat.label)}</span>
                      </p>
                      {(() => {
                        // Estado real de la voz en off de ESTE bloque (disco).
                        const takes = voTakesFor(media?.assets ?? [], takeStem(i, beat.label));
                        const last = takes[takes.length - 1];
                        return last ? (
                          <p className="mt-1 text-2xs text-text-faint">
                            Voz:{" "}
                            <span className="font-mono text-green">{last.name}</span>{" "}
                            <span className="tabular-nums">{fmtSeconds(last.duration_sec)}</span>
                            {takes.length > 1 && (
                              <span className="text-text-faint"> · {takes.length} tomas</span>
                            )}
                          </p>
                        ) : null;
                      })()}
                      {beat.cues.length > 0 && (
                        <>
                          <p className="mt-2 text-2xs tracking-label text-cyan uppercase">
                            En pantalla
                          </p>
                          {beat.cues.map((c) => (
                            <p key={c} className="mt-0.5 text-xs leading-snug text-text-dim">
                              ▸ {c}
                            </p>
                          ))}
                        </>
                      )}
                      {beat.directions.length > 0 && (
                        <>
                          <p className="mt-2 text-2xs tracking-label text-text-faint uppercase">
                            Cómo
                          </p>
                          {beat.directions.map((d) => (
                            <p key={d} className="mt-0.5 text-xs leading-snug text-text-dim">
                              {d}
                            </p>
                          ))}
                        </>
                      )}
                      {take?.note && take.note !== beat.say[0] && (
                        <p className="mt-2 text-2xs text-text-faint">Toma: {take.note}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {!beats.length && (
              <p className="text-sm text-text-faint">
                Esta pieza todavía no tiene guion ni hook. Escríbelo (o genéralo con Hermes) y
                vuelve a grabar.
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (!current) return;
              mark(current, "buena");
              go(idx + 1);
            }}
            disabled={!current}
            className={`rounded-sm border px-3 py-1 text-2xs tracking-label uppercase ${
              take?.verdict === "buena"
                ? "border-green bg-green/12 text-green"
                : "border-line-2 bg-panel-2 text-text hover:border-green hover:text-green"
            }`}
          >
            ✓ Buena <span className="text-text-faint">1</span>
          </button>
          <button
            onClick={() => current && mark(current, "revisar")}
            disabled={!current}
            className={`rounded-sm border px-3 py-1 text-2xs tracking-label uppercase ${
              take?.verdict === "revisar"
                ? "border-amber bg-amber/12 text-amber"
                : "border-line-2 bg-panel-2 text-text hover:border-amber hover:text-amber"
            }`}
          >
            ↻ Repetir <span className="text-text-faint">2</span>
          </button>
          <button onClick={() => go(idx - 1)} disabled={idx <= 0} className={btn}>
            ↑
          </button>
          <button onClick={() => go(idx + 1)} disabled={idx >= beats.length - 1} className={btn}>
            ↓ Siguiente
          </button>

          {/* Voz en off del bloque: se graba leyendo el teleprompter y cae en
              assets/ con el nombre del bloque (mismo contrato que el crudo). */}
          <span className="mx-1 h-4 w-px bg-line" aria-hidden />
          <button
            onClick={() => void toggleVoice()}
            disabled={!current || voice.saving || !voice.supported}
            title="Grabar la voz en off de este bloque (tecla R)"
            className={`rounded-sm border px-3 py-1 text-2xs tracking-label uppercase disabled:opacity-35 ${
              voice.target
                ? "border-red bg-red/12 text-red"
                : "border-line-2 bg-panel-2 text-text hover:border-red hover:text-red"
            }`}
          >
            {voice.saving
              ? "◌ guardando…"
              : voice.target
                ? `⏹ Guardar voz ${mmss(voice.elapsed)}`
                : "🎙 Voz en off"}{" "}
            <span className="text-text-faint">R</span>
          </button>
          {voice.target && <MicLevel meterRef={voice.meterRef} active />}
          {!voice.target && voice.lastSaved && (
            <span className="text-2xs text-green">✓ {voice.lastSaved}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {voice.error && <span className="text-2xs text-red">{voice.error}</span>}
          <span className={`text-xs tabular-nums ${overTarget ? "text-amber" : "text-text-dim"}`}>
            {mmss(elapsed)}
            {target != null && <span className="text-text-faint"> / ~{target}s</span>}
          </span>
          <span className="text-2xs text-text-faint">
            ↑↓ moverse · 1 buena · 2 repetir · R voz en off · ± letra · Esc salir
          </span>
        </div>
      </footer>

    </div>
  );
}
