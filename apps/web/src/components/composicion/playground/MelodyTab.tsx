"use client";

/**
 * Memo · MELODÍA: las tonalidades (la medida de la voz, la del instrumento y
 * la destino), el transporte con sus tres fuentes, los semitonos y el piano
 * roll. La consecuencia de transponer se dice debajo del control (patrón
 * Speechify, "1.1× · 220 palabras por minuto"): "−1 st → La menor · rango
 * Mi3–Do5 · 3 notas fuera".
 */
import { useEffect, useRef } from "react";
import type { Key, PassageAnalysis } from "@hermes/shared";
import { keyLabel } from "@/lib/music-theory";
import { MelodyRoll } from "./MelodyRoll";
import { EstimateChip, TargetKeyChip } from "./KeyPop";
import type { MemoPlayer, MemoSource, TimeClock } from "./useMemoPlayer";
import { btn, btnGhost, chip } from "./ui";
import { fmtSemis, fmtTime, midiName } from "./format";
import { outOfKeyMask, semisToKey as semisToTarget, shiftKey, shiftNotes } from "./measure";

const SOURCES: { id: MemoSource; label: string; hint: string }[] = [
  { id: "voz", label: "Voz aislada", hint: "La voz separada de la guitarra" },
  { id: "original", label: "Original", hint: "Tal como se grabó" },
  { id: "sinte", label: "Melodía sintetizada", hint: "Las notas medidas, tocadas: la escucha exacta de lo que se entendió" },
];

/** El contador "0:12.3" del reloj, escrito por DOM (un estado por cuadro re-renderizaría el memo). */
export function LiveTime({ clock, fallback }: { clock: TimeClock; fallback: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const write = (t: number) => {
      const el = ref.current;
      if (!el) return;
      const text = fmtTime(t, true);
      if (el.textContent !== text) el.textContent = text;
    };
    write(clock.now());
    return clock.subscribe(write);
  }, [clock]);
  return <span ref={ref}>{fmtTime(fallback, true)}</span>;
}

export function Transport({
  player,
  loop,
  onLoop,
  focusLabel,
  showSources = true,
}: {
  player: MemoPlayer;
  loop: boolean;
  onLoop?: () => void;
  focusLabel?: string | null;
  showSources?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button
        type="button"
        onClick={() => player.toggle()}
        className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-sm text-white hover:opacity-90"
        aria-label={player.playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
        title={player.playing ? "Pausar (Espacio)" : "Reproducir (Espacio)"}
      >
        {player.playing ? "❚❚" : "▶"}
      </button>
      <span className="font-mono text-xs text-text-dim tabular-nums">
        <LiveTime clock={player.clock} fallback={player.time} /> / {fmtTime(player.duration, true)}
      </span>
      {onLoop && (
        <button
          type="button"
          onClick={onLoop}
          className={chip(loop)}
          title="Repetir la frase enfocada (L)"
        >
          ⟲ {focusLabel ? `Repetir ${focusLabel}` : "Repetir frase"}
        </button>
      )}
      {showSources && (
        <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup" aria-label="Qué oír">
          {SOURCES.filter((s) => s.id !== "voz" || player.hasVoice).map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={player.source === s.id}
              title={s.hint}
              onClick={() => player.setSource(s.id)}
              className={chip(player.source === s.id)}
            >
              {s.label}
            </button>
          ))}
        </span>
      )}
      {player.rendering && <span className="text-xs text-accent">preparando el audio transpuesto…</span>}
      {player.error && <span className="text-xs text-red">{player.error}</span>}
    </div>
  );
}

export function MelodyTab({
  analysis,
  player,
  semis,
  setSemis,
  memoKey,
  setMemoKey,
  targetKey,
  setTargetKey,
  songTitle,
  notation,
  setNotation,
  focusPhrase,
  setFocusPhrase,
  selectedNote,
  onNoteClick,
  loop,
  setLoop,
  zoom,
  setZoom,
}: {
  analysis: PassageAnalysis;
  player: MemoPlayer;
  semis: number;
  setSemis: (n: number) => void;
  memoKey: Key;
  setMemoKey: (k: Key) => void;
  targetKey: Key | null;
  setTargetKey: (k: Key) => void;
  songTitle: string | null;
  notation: "en" | "latin";
  setNotation: (n: "en" | "latin") => void;
  focusPhrase: number | null;
  setFocusPhrase: (i: number | null) => void;
  selectedNote: number | null;
  onNoteClick: (i: number) => void;
  loop: boolean;
  setLoop: (v: boolean) => void;
  zoom: number;
  setZoom: (z: number) => void;
}) {
  const shifted = shiftNotes(analysis.notes, semis);
  const transposing = semis !== 0 && !!targetKey;
  const mask = transposing ? outOfKeyMask(shifted, targetKey!) : null;
  const outCount = mask?.filter(Boolean).length ?? 0;
  const displayKey = transposing ? targetKey! : shiftKey(memoKey, semis);
  const lo = Math.min(...shifted.map((n) => n.midi));
  const hi = Math.max(...shifted.map((n) => n.midi));
  const toSong = targetKey ? semisToTarget(memoKey, targetKey) : null;
  const phrase = analysis.phrases.find((p) => p.idx === focusPhrase) ?? null;

  return (
    <div className="flex flex-col gap-3">
      {/* Tonalidades: medida → destino */}
      <div className="flex flex-wrap items-center gap-2">
        <EstimateChip
          label="Voz"
          estimate={analysis.key}
          chosen={memoKey}
          notation={notation}
          onChoose={setMemoKey}
        />
        {analysis.instrumentKey && (
          <EstimateChip
            label="Instrumento"
            estimate={analysis.instrumentKey}
            chosen={analysis.instrumentKey.best.key}
            notation={notation}
          />
        )}
        <span aria-hidden className="text-text-faint">
          →
        </span>
        <TargetKeyChip value={targetKey} fromSong={songTitle} notation={notation} onChange={setTargetKey} />
        {toSong != null && (
          <span className="text-xs text-text-faint">
            = {fmtSemis(toSong)}
          </span>
        )}
      </div>

      {/* Transporte + semitonos */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-3 py-2">
        <Transport
          player={player}
          loop={loop}
          onLoop={() => setLoop(!loop)}
          focusLabel={phrase ? `F${phrase.idx + 1}` : null}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btnGhost}
            onClick={() => setNotation(notation === "en" ? "latin" : "en")}
            title="Cómo se escriben las notas (N)"
          >
            {notation === "en" ? "C D E" : "Do Re Mi"}
          </button>
          <span className="flex items-center rounded-sm border border-line" aria-label="Transponer">
            <button type="button" className={`${btnGhost} px-2`} onClick={() => setSemis(Math.max(-12, semis - 1))} title="Bajar un semitono (−)">
              −
            </button>
            <span className="w-14 text-center font-mono text-xs text-text tabular-nums">{fmtSemis(semis)}</span>
            <button type="button" className={`${btnGhost} px-2`} onClick={() => setSemis(Math.min(12, semis + 1))} title="Subir un semitono (+)">
              +
            </button>
          </span>
          <button
            type="button"
            className={btn}
            disabled={toSong == null || toSong === semis}
            onClick={() => toSong != null && setSemis(toSong)}
            title="Llevar el memo a la tonalidad destino (T)"
          >
            Llevar a {targetKey ? keyLabel(targetKey, notation) : "la canción"} <kbd className="text-2xs opacity-60">T</kbd>
          </button>
          {semis !== 0 && (
            <button type="button" className={btnGhost} onClick={() => setSemis(0)} title="Tonalidad original (0)">
              original
            </button>
          )}
        </div>
      </div>

      {/* La consecuencia, debajo del control */}
      <p className="text-xs text-text-dim">
        {semis === 0 ? "Original" : `${fmtSemis(semis)} → ${keyLabel(shiftKey(memoKey, semis), notation)}`}
        {Number.isFinite(lo) && (
          <>
            {" · rango "}
            {midiName(lo, displayKey, notation)}–{midiName(hi, displayKey, notation)}
          </>
        )}
        {transposing && (
          <span className={outCount ? "text-amber" : "text-green"}>
            {" · "}
            {outCount
              ? `${outCount} ${outCount === 1 ? "nota queda" : "notas quedan"} fuera de ${keyLabel(targetKey!, notation)}`
              : `todas las notas caen en ${keyLabel(targetKey!, notation)}`}
          </span>
        )}
        {Math.abs(semis) >= 4 && player.source !== "sinte" && (
          <span className="text-text-faint"> · a ±4 st o más la voz transpuesta se deforma: la melodía sintetizada es la escucha fiel</span>
        )}
      </p>

      <MelodyRoll
        notes={shifted}
        f0={analysis.f0}
        hop={analysis.hop}
        shift={semis}
        peaks={analysis.peaks}
        phrases={analysis.phrases}
        duration={player.duration}
        displayKey={displayKey}
        outMask={mask}
        notation={notation}
        clock={player.clock}
        playing={player.playing}
        selectedNote={selectedNote}
        activeNote={player.activeNote}
        focusPhrase={focusPhrase}
        pxPerSec={zoom}
        onNoteClick={onNoteClick}
        onSeek={(t) => player.seek(t)}
        onPhraseClick={(i) => setFocusPhrase(i === focusPhrase ? null : i)}
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-dim">
        <span className="flex items-center gap-1">
          <button
            type="button"
            className={btnGhost}
            disabled={!analysis.phrases.length}
            onClick={() => setFocusPhrase(Math.max(0, (focusPhrase ?? 1) - 1))}
            title="Frase anterior (⇧←)"
          >
            ‹
          </button>
          {phrase ? `Frase ${phrase.idx + 1} de ${analysis.phrases.length}` : `${analysis.phrases.length} frases`}
          <button
            type="button"
            className={btnGhost}
            disabled={!analysis.phrases.length}
            onClick={() =>
              setFocusPhrase(Math.min(analysis.phrases.length - 1, focusPhrase == null ? 0 : focusPhrase + 1))
            }
            title="Frase siguiente (⇧→)"
          >
            ›
          </button>
        </span>
        {phrase && (
          <span className="text-text-faint">
            «{phrase.text}» · {phrase.mold.syllables} sílabas · final {phrase.mold.ending}
            {phrase.mold.melismas.length > 0 &&
              ` · ${phrase.mold.melismas.length} ${phrase.mold.melismas.length === 1 ? "melisma" : "melismas"}`}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-text-faint">
          zoom
          <button type="button" className={btnGhost} onClick={() => setZoom(Math.max(20, Math.round(zoom / 1.4)))} aria-label="Alejar">
            −
          </button>
          <button type="button" className={btnGhost} onClick={() => setZoom(Math.min(400, Math.round(zoom * 1.4)))} aria-label="Acercar">
            +
          </button>
        </span>
      </div>
      <p className="text-xs text-text-faint">
        Medido sobre {analysis.source === "voz" ? "la voz aislada" : "la mezcla (sin separar la voz)"} · afinación de la
        sesión {analysis.tuningCents > 0 ? "+" : ""}
        {Math.round(analysis.tuningCents)} c, ya compensada · notas y sílabas aproximadas. Clic en una nota = suena;
        ←→ recorre las notas.
      </p>
    </div>
  );
}
