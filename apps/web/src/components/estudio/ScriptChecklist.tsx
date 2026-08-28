"use client";

/**
 * El guion COMPLETO como checklist: hook + cada bloque, con su estado real de
 * grabación. Se usa en dos sitios (patrón Codecademy/Basecamp: el índice de lo
 * que falta siempre visible, nunca en otra pantalla):
 *   · riel izquierdo del modo grabación — saltar de bloque sin perder el hilo,
 *   · tab Guion del workspace — ver de un vistazo qué queda por grabar.
 *
 * El estado NO es un checkbox suelto: sale del `ContentTake` de cada bloque
 * (mismo dato del tab Tomas y de los criterios de la etapa `grabacion`).
 */
import type { ContentPiece, ContentTake } from "@hermes/shared";
import {
  beatState,
  parseScript,
  pieceBeats,
  spokenSeconds,
  takeForBeat,
  type BeatState,
  type ScriptBeat,
} from "@/lib/script-beats";
import { BeatVariants } from "./BeatVariants";

const GLYPH: Record<BeatState, string> = {
  buena: "✓",
  revisar: "↻",
  descartada: "✕",
  pendiente: "○",
};

const TONE: Record<BeatState, string> = {
  buena: "text-green",
  revisar: "text-amber",
  descartada: "text-text-faint",
  pendiente: "text-text-faint",
};

export function ScriptChecklist({
  piece,
  beats,
  activeIndex,
  onSelect,
  onMark,
}: {
  piece: ContentPiece;
  beats: ScriptBeat[];
  /** Bloque vigente (modo grabación); -1 = ninguno (vista del workspace). */
  activeIndex?: number;
  onSelect: (index: number) => void;
  /** Ausente = checklist de solo lectura. */
  onMark?: (beat: ScriptBeat, verdict: ContentTake["verdict"]) => void;
}) {
  if (!beats.length)
    return (
      <p className="px-1 text-2xs text-text-faint">
        Sin bloques todavía: escribe el hook y el guion.
      </p>
    );

  const buenas = beats.filter((b) => beatState(piece, b) === "buena").length;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 px-1 pb-1.5">
        <span className="text-2xs tracking-label text-text-faint uppercase">Checklist</span>
        <span className="flex-1 flex gap-0.5">
          {beats.map((b, i) => {
            const st = beatState(piece, b);
            return (
              <span
                key={`${b.label}-${i}`}
                className={`h-1 flex-1 rounded-xs ${
                  st === "buena" ? "bg-green" : st === "revisar" ? "bg-amber" : "bg-line-2"
                }`}
              />
            );
          })}
        </span>
        <span className="text-2xs text-text-dim tabular-nums">
          {buenas}/{beats.length}
        </span>
      </div>

      {beats.map((beat, i) => {
        const state = beatState(piece, beat);
        const take = takeForBeat(piece, beat);
        const active = i === activeIndex;
        return (
          <div
            key={`${beat.label}-${i}`}
            className={`group flex items-start gap-1.5 rounded-sm border px-1.5 py-1 ${
              active ? "border-violet/40 bg-violet/9" : "border-transparent hover:bg-panel-2"
            }`}
          >
            <button
              onClick={() => onMark?.(beat, state === "buena" ? "revisar" : "buena")}
              disabled={!onMark}
              title={
                onMark
                  ? state === "buena"
                    ? "Marcada buena — clic para pasarla a repetir"
                    : "Marcar como toma buena"
                  : take
                    ? `Toma ${state}`
                    : "Sin toma registrada"
              }
              className={`mt-px shrink-0 text-xs ${TONE[state]} ${onMark ? "hover:text-green" : ""}`}
            >
              {GLYPH[state]}
            </button>
            <button onClick={() => onSelect(i)} className="min-w-0 flex-1 text-left">
              <div className="flex items-baseline gap-1.5">
                <span
                  className={`shrink-0 text-2xs tracking-label uppercase ${
                    active ? "text-violet" : "text-text-dim"
                  }`}
                >
                  {beat.kind === "hook" ? "✦ Hook" : (beat.heading ?? beat.label)}
                </span>
                {beat.heading && beat.time && (
                  <span className="shrink-0 text-2xs text-text-faint tabular-nums">{beat.time}</span>
                )}
                {beat.isCta && <span className="shrink-0 text-2xs text-cyan uppercase">cta</span>}
                {beat.cues.length > 0 && (
                  <span
                    className="shrink-0 text-2xs text-cyan"
                    title={beat.cues.join(" · ")}
                    aria-label={`${beat.cues.length} indicaciones de pantalla`}
                  >
                    ▸{beat.cues.length}
                  </span>
                )}
              </div>
              <p
                className={`truncate text-xs ${
                  state === "buena" ? "text-text-faint" : "text-text-dim"
                }`}
              >
                {beat.say[0] ?? beat.cues[0] ?? "—"}
              </p>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/**
 * El mismo guion, pero desplegado: cada bloque con sus frases, lo que tiene que
 * verse y su estado de grabación. Es la vista por defecto del tab Guion — el
 * markdown crudo se queda en "Editar", que es donde de verdad se necesita.
 */
export function ScriptBoard({
  piece,
  onRecord,
  onMark,
  onEditHook,
  dirty,
}: {
  piece: ContentPiece;
  /** Abre el modo grabación en ese bloque. */
  onRecord: (index: number) => void;
  onMark: (beat: ScriptBeat, verdict: ContentTake["verdict"]) => void;
  /** Salta al editor con el hook enfocado (aquí el hook se lee, no se escribe). */
  onEditHook?: () => void;
  /** El editor tiene cambios sin guardar (las versiones no aplican hasta ⌘S). */
  dirty?: boolean;
}) {
  const beats = pieceBeats(piece);
  const parsed = parseScript(piece.script_md);
  const buenas = beats.filter((b) => beatState(piece, b) === "buena").length;
  const spoken = spokenSeconds(parsed.words);

  if (!beats.length)
    return (
      <p className="px-1 py-4 text-xs text-text-faint">
        Sin guion todavía. Escríbelo en <span className="text-text-dim">Editar</span> o genéralo con
        Hermes — aquí aparecerá partido en bloques, listo para grabar.
      </p>
    );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-2xs text-text-dim tabular-nums">
          {beats.length} bloques · {parsed.words} palabras habladas ·{" "}
          {parsed.seconds != null ? `${parsed.seconds}s guionizados` : `~${spoken}s hablados`}
        </span>
        <span
          className={`text-2xs tabular-nums ${buenas ? "text-green" : "text-text-faint"}`}
        >
          {buenas}/{beats.length} grabados
        </span>
        {parsed.format && (
          <span className="min-w-0 truncate text-2xs text-text-faint">{parsed.format}</span>
        )}
      </div>

      {beats.map((beat, i) => {
        const state = beatState(piece, beat);
        return (
          <div
            key={`${beat.label}-${i}`}
            className={`rounded-sm border px-2.5 py-2 ${
              state === "buena"
                ? "border-green/30 bg-green/5"
                : state === "revisar"
                  ? "border-amber/30 bg-amber/5"
                  : "border-line bg-panel-2/40"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onMark(beat, state === "buena" ? "revisar" : "buena")}
                title={state === "buena" ? "Pasar a repetir" : "Marcar como toma buena"}
                className={`text-xs ${TONE[state]} hover:text-green`}
              >
                {GLYPH[state]}
              </button>
              <span className="text-2xs tracking-label text-violet uppercase">
                {beat.kind === "hook" ? "✦ Hook" : (beat.heading ?? beat.label)}
              </span>
              {beat.heading && beat.time && (
                <span className="text-2xs text-text-faint tabular-nums">{beat.time}</span>
              )}
              {beat.isCta && (
                <span className="text-2xs tracking-label text-cyan uppercase">cta</span>
              )}
              <span className="flex-1" />
              <span className="text-2xs text-text-faint tabular-nums">
                {beat.words} pal · {beat.seconds ?? spokenSeconds(beat.words)}s
              </span>
              <button
                onClick={() => onRecord(i)}
                title="Grabar desde este bloque"
                className="rounded-xs border border-line-2 px-1.5 py-0.5 text-2xs text-text-dim hover:border-violet hover:text-violet"
              >
                ▶
              </button>
            </div>
            {beat.say.map((line, j) =>
              beat.kind === "hook" && onEditHook ? (
                <button
                  key={j}
                  onClick={onEditHook}
                  title="Editar el hook"
                  className="mt-1 block w-full text-left text-xs leading-relaxed text-text hover:text-violet"
                >
                  {line}
                </button>
              ) : (
                <p key={j} className="mt-1 text-xs leading-relaxed text-text">
                  {line}
                </p>
              ),
            )}
            {beat.cues.map((c) => (
              <p key={c} className="mt-1 text-2xs leading-snug text-cyan">
                ▸ {c}
              </p>
            ))}
            {beat.directions.map((d) => (
              <p key={d} className="mt-1 text-2xs leading-snug text-text-faint">
                {d}
              </p>
            ))}
            {/* Versiones de la parte: el hook abre desplegado (es LA decisión
                del video); los bloques, plegados en una línea. */}
            <BeatVariants piece={piece} beat={beat} dirty={dirty} />
          </div>
        );
      })}

      {parsed.notes.length > 0 && (
        <div className="rounded-sm border border-line px-2.5 py-2">
          <p className="text-2xs tracking-label text-text-faint uppercase">Notas de grabación</p>
          {parsed.notes.map((n) => (
            <p key={n} className="mt-1 text-xs leading-snug text-text-dim">
              {n}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
