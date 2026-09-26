"use client";

/**
 * PARES fonemas → letra, frase por frase. Patrón ElevenLabs Dubbing (el
 * segmento de origen arriba y su traducción debajo, alineados) llevado a la
 * sílaba: cada columna es UNA posición del molde — lo que se tarareó ahí
 * ("na na ná uh oh") y la sílaba de la letra que la canta ("Na-da más, tu
 * voz"), con la lectura de sinalefas que eligió `lineFit` (la misma que mide
 * el agente).
 *
 *  - La vocal que la letra CONSERVA del tarareo va subrayada en terracota; la
 *    que cambia, en gris tenue. "Resaltar eco" (E) pinta cada sílaba por su
 *    parecido (igual · misma familia · lejana · distinta).
 *  - "1 de N" por frase (patrón Linear): recorre Tu versión y las versiones
 *    que traen esa frase sin salir de la fila; "Usar" la pasa a tu versión.
 *  - Comparar (patrón Braintrust): una tercera fila con otra versión, con lo
 *    que cambia resaltado.
 *
 * Degrada sin inventar: si el molde no trae tarareo con vocales (palabras
 * reales, un memo de Sesiones), la fila de arriba muestra lo que se cantó y
 * no hay eco que pintar; los malacentos siguen (salen del peso métrico).
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import type { LineFit, LyricBoard, LyricVersion, MelismaMode, Phrase, PhraseMold } from "@hermes/shared";
import { FitChips } from "./FitChips";
import { GuideKaraoke, GuideLineButton, KARAOKE, sungFor, useKaraoke } from "./GuideControls";
import { fitOf } from "./measure";
import { originTokens, readingTokens, wordOfToken, type OriginToken, type ReadingToken } from "./reading";
import type { Guide } from "./useGuide";
import { btn, btnGhost } from "./ui";

type EcoSlot = NonNullable<LineFit["echo"]>["perSlot"][number];

/** Parecido de vocal → fondo (clases ESTÁTICAS: Tailwind purga las interpoladas). */
const ECO_BG = { same: "bg-accent/15", near: "bg-accent/6", far: "bg-panel-2", none: "" } as const;
const ecoBucket = (sim: number): keyof typeof ECO_BG => (sim >= 1 ? "same" : sim >= 0.5 ? "near" : sim > 0 ? "far" : "none");
const SIM_LABEL = { same: "la misma vocal", near: "misma familia (abiertas / cerradas)", far: "se parece poco", none: "distinta" } as const;

export const letterOf = (i: number) => String.fromCharCode(65 + (i % 26));

interface PairSource {
  id: string;
  label: string;
  text: string;
  why?: string;
}

/** Leyenda del eco (va junto al conmutador). */
export function EcoLegend() {
  return (
    <span className="flex items-center gap-1.5 text-2xs text-text-faint" aria-hidden>
      <span className={`rounded-xs px-1 text-text ${ECO_BG.same}`}>igual</span>
      <span className={`rounded-xs px-1 text-text ${ECO_BG.near}`}>familia</span>
      <span className={`rounded-xs px-1 text-text-dim ${ECO_BG.far}`}>lejana</span>
      <span className="px-1 text-text-faint">distinta</span>
    </span>
  );
}

export function PhonemePairs({
  phrases,
  molds,
  mode,
  board,
  versions,
  onUse,
  onToggleLock,
  eco,
  echoAvailable,
  compareId,
  guide,
  focusRow,
  setFocusRow,
  generating,
}: {
  phrases: Phrase[];
  molds: PhraseMold[];
  mode: MelismaMode;
  board: LyricBoard;
  /** Las versiones, la más nueva primero (la misma letra A, B… que la rejilla). */
  versions: LyricVersion[];
  onUse: (phrase: number, text: string, from?: string) => void;
  onToggleLock: (phrase: number) => void;
  eco: boolean;
  /** ¿Algún molde trae tarareo con vocales? Si no, se dice UNA vez arriba (no en cada fila). */
  echoAvailable: boolean;
  /** "mine" · id de una versión · null (sin comparar). */
  compareId: string | null;
  guide: Guide | null;
  focusRow: number | null;
  setFocusRow: (i: number | null) => void;
  generating: boolean;
}) {
  const [shown, setShown] = useState<Record<number, string>>({});
  return (
    <div className="flex flex-col gap-2">
      {!echoAvailable && (
        <p className="text-xs text-text-faint">
          Aquí se cantaron palabras, no tarareo: no hay vocales de relleno que conservar, así que no hay eco que medir.
          Los acentos y los malacentos sí se miden.
        </p>
      )}
      {phrases.map((ph, row) => {
        const pi = ph.idx;
        const mine = board.mine.find((m) => !m.stale && m.phrase === pi);
        const sources: PairSource[] = [
          ...(mine?.text.trim() ? [{ id: "mine", label: "Tu versión", text: mine.text }] : []),
          ...versions.flatMap((v, j) => {
            const l = v.lines.find((x) => x.phrase === pi);
            return l?.text.trim() ? [{ id: v.id, label: `${letterOf(j)} · ${v.angle}`, text: l.text, why: l.why }] : [];
          }),
        ];
        const k = Math.max(0, sources.findIndex((s) => s.id === shown[pi]));
        const compare =
          compareId === "mine"
            ? mine?.text.trim()
              ? { id: "mine", label: "Tu versión", text: mine.text }
              : null
            : compareId
              ? (sources.find((s) => s.id === compareId) ?? null)
              : null;
        return (
          <PairRow
            key={pi}
            phrase={ph}
            mold={molds[row]}
            mode={mode}
            sources={sources}
            index={k}
            onIndex={(i) => setShown((m) => ({ ...m, [pi]: sources[i]?.id }))}
            mine={mine}
            locked={board.locked.includes(pi)}
            onUse={onUse}
            onToggleLock={() => onToggleLock(pi)}
            eco={eco}
            compare={compare}
            guide={guide}
            noEchoNote={echoAvailable}
            on={focusRow === pi}
            onFocus={() => setFocusRow(pi)}
            generating={generating}
          />
        );
      })}
    </div>
  );
}

function PairRow({
  phrase,
  mold,
  mode,
  sources,
  index,
  onIndex,
  mine,
  locked,
  onUse,
  onToggleLock,
  eco,
  compare,
  guide,
  noEchoNote,
  on,
  onFocus,
  generating,
}: {
  phrase: Phrase;
  mold: PhraseMold;
  mode: MelismaMode;
  sources: PairSource[];
  index: number;
  onIndex: (i: number) => void;
  mine: LyricBoard["mine"][number] | undefined;
  locked: boolean;
  onUse: (phrase: number, text: string, from?: string) => void;
  onToggleLock: () => void;
  eco: boolean;
  compare: PairSource | null;
  guide: Guide | null;
  /** Avisar por fila que no hay eco (solo si otras frases sí lo tienen). */
  noEchoNote: boolean;
  on: boolean;
  onFocus: () => void;
  generating: boolean;
}) {
  const pi = phrase.idx;
  const src = sources[index] ?? null;
  const text = src?.text ?? "";
  const fit = useMemo(() => (text ? fitOf(text, mold, mode) : null), [text, mold, mode]);
  const origin = useMemo(() => originTokens(phrase, mode, mold.syllables), [phrase, mode, mold.syllables]);
  const dest = useMemo(() => (fit?.reading ? readingTokens(text, fit.reading) : []), [fit, text]);
  const cmp = useMemo(() => {
    if (!compare || compare.id === src?.id) return null;
    const f = fitOf(compare.text, mold, mode);
    return f?.reading ? readingTokens(compare.text, f.reading) : null;
  }, [compare, mold, mode, src?.id]);
  const echo = useMemo(() => new Map<number, EcoSlot>((fit?.echo?.perSlot ?? []).map((x) => [x.pos, x])), [fit]);
  const mis = useMemo(() => new Set((fit?.misaccents ?? []).map((m) => m.pos)), [fit]);
  const hasWant = origin.some((o) => o.want);
  const cols = Math.max(origin.length, dest.length, cmp?.length ?? 0, 1);

  // Karaoke: si la guía canta ESTE texto y sus sílabas son las de la lectura, se encienden en su sitio.
  const playingNow = guide?.playing ?? null;
  const sung = useMemo(() => sungFor(playingNow, pi, text), [playingNow, pi, text]);
  const inPlace = !!sung && sung.length === dest.length;
  const bind = useKaraoke(guide?.clock ?? noClock, inPlace ? sung : null);

  const inMine = src?.id === "mine" || (!!mine && mine.from === src?.id && mine.text === src?.text);
  const fromVersion = mine?.from ? sources.find((s) => s.id === mine.from) : null;

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" && index < sources.length - 1) {
      e.preventDefault();
      onIndex(index + 1);
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      onIndex(index - 1);
    }
  };

  return (
    <section
      tabIndex={0}
      onKeyDown={onKey}
      onFocusCapture={onFocus}
      onMouseDown={onFocus}
      aria-label={`Frase ${pi + 1}: tarareo y letra`}
      className={`flex min-w-0 flex-col rounded-md border bg-panel transition-colors focus-visible:outline-none ${
        on ? "border-accent/50" : "border-line"
      }`}
    >
      {/* Cabecera: la frase, su molde, el navegador "1 de N" y las acciones */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line/60 px-3 py-2">
        <span className={`font-mono text-xs ${on ? "text-accent" : "text-text-dim"}`}>F{pi + 1}</span>
        <button
          type="button"
          onClick={onToggleLock}
          aria-pressed={locked}
          title={locked ? "Fija: no se regenera (B)" : "Fijar esta frase (B)"}
          className={`cursor-pointer rounded-xs p-0.5 ${locked ? "text-accent" : "text-text-faint hover:text-text"}`}
        >
          <LockIcon on={locked} />
        </button>
        <span className="text-2xs text-text-faint">
          {mold.syllables} sílabas · {mold.ending === "esdrujula" ? "esdrújula" : mold.ending}
          {mold.melismas.length > 0 && (
            <span className="text-chart-4"> · melisma en {mold.melismas.map((m) => m.pos).join(", ")}</span>
          )}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {sources.length > 0 ? (
            <span className="flex items-center gap-0.5 text-xs" aria-label="Versiones de esta frase">
              <button
                type="button"
                className={btnGhost}
                disabled={index === 0}
                onClick={() => onIndex(index - 1)}
                aria-label="Versión anterior (←)"
              >
                ‹
              </button>
              <span className="max-w-[26ch] truncate text-text" title={src?.label}>
                {src?.label}
              </span>
              <span className="whitespace-nowrap text-text-faint tabular-nums">
                · {index + 1} de {sources.length}
              </span>
              <button
                type="button"
                className={btnGhost}
                disabled={index >= sources.length - 1}
                onClick={() => onIndex(index + 1)}
                aria-label="Versión siguiente (→)"
              >
                ›
              </button>
            </span>
          ) : (
            <span className="text-xs text-text-faint">{generating ? "Hermes está escribiendo…" : "sin letra todavía"}</span>
          )}
          {src && src.id !== "mine" && (
            <button
              type="button"
              className={btn}
              disabled={inMine}
              onClick={() => onUse(pi, src.text, src.id)}
              title="Pasar esta línea a tu versión (nada entra a la canción sin «Aplicar»)"
            >
              {inMine ? "✓ en tu versión" : "Usar"}
            </button>
          )}
          <GuideLineButton guide={guide} phrase={pi} text={text} />
        </span>
      </header>

      {/* Tarareo ↓ letra, posición por posición */}
      <div className="min-w-0 overflow-x-auto px-3 py-2.5">
        <div
          className="grid w-max items-baseline gap-x-1 gap-y-1.5"
          style={{ gridTemplateColumns: `4.5rem repeat(${cols}, minmax(2.6rem, max-content))` }}
        >
          <span className="text-2xs text-text-faint" title={hasWant ? undefined : "Se cantaron palabras, no tarareo"}>
            {hasWant ? "tarareo" : "cantado"}
          </span>
          {Array.from({ length: cols }, (_, i) => (
            <OriginCell key={`o${i}`} tok={origin[i]} />
          ))}

          <span className="text-2xs text-text-faint">{src ? "letra" : ""}</span>
          {src
            ? Array.from({ length: cols }, (_, i) => (
                <DestCell
                  key={`d${i}`}
                  tok={dest[i]}
                  extra={i >= origin.length}
                  slot={dest[i] ? echo.get(dest[i].pos) : undefined}
                  mis={dest[i] ? mis.has(dest[i].pos) : false}
                  eco={eco}
                  bindRef={inPlace ? bind(i) : undefined}
                />
              ))
            : (
                <span className="text-xs text-text-faint italic" style={{ gridColumn: `span ${cols}` }}>
                  Escribe tu versión o genera versiones: aquí se ve qué vocal del tarareo conserva cada sílaba.
                </span>
              )}

          {compare && compare.id !== src?.id && (
            <>
              <span className="truncate text-2xs text-text-faint" title={`Comparar con ${compare.label}`}>
                vs {compare.id === "mine" ? "tu versión" : compare.label.split(" · ")[0]}
              </span>
              {cmp ? (
                Array.from({ length: cols }, (_, i) => <DiffCell key={`c${i}`} tok={cmp[i]} other={dest[i]} />)
              ) : (
                <span className="text-2xs text-text-faint" style={{ gridColumn: `span ${cols}` }}>
                  no se pudo medir
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Medida de la línea a la vista + su porqué */}
      {src && (
        <footer className="flex flex-col gap-1 px-3 pb-2.5">
          {sung && !inPlace ? <GuideKaraoke syllables={sung} clock={guide!.clock} /> : <FitChips fit={fit} text={text} />}
          <span className="text-2xs text-text-faint">
            {src.id === "mine" && fromVersion
              ? `de ${fromVersion.label}${mine?.text !== fromVersion.text ? " · editada" : ""}`
              : src.why
                ? `Por qué: ${src.why}`
                : src.id === "mine"
                  ? "escrita por ti"
                  : ""}
            {!hasWant && noEchoNote && " · en esta frase se cantaron palabras: no hay eco que medir"}
          </span>
          {compare && compare.id === src.id && (
            <span className="text-2xs text-text-faint">Comparando con la misma versión que se ve.</span>
          )}
        </footer>
      )}
    </section>
  );
}

const noClock = () => null;

function OriginCell({ tok }: { tok: OriginToken | undefined }) {
  if (!tok) return <span />;
  return (
    <span
      className={`flex items-baseline justify-center rounded-xs bg-panel-2 px-1.5 py-0.5 font-mono text-xs whitespace-nowrap ${
        tok.cont ? "text-text-faint" : tok.stressed ? "font-medium text-text" : "text-text-dim"
      } ${tok.filler ? "" : "italic"}`}
      title={[
        `Posición ${tok.pos}`,
        tok.stressed ? "acento de la melodía" : null,
        tok.melisma ? `melisma de ${tok.melisma} notas` : null,
        tok.want ? `el tarareo pide «${tok.want}»` : tok.filler ? null : "palabra cantada (no se le exige vocal)",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {tok.text}
      {tok.melisma ? <span className="ml-0.5 text-2xs text-chart-4">~{tok.melisma}</span> : null}
    </span>
  );
}

function DestCell({
  tok,
  extra,
  slot,
  mis,
  eco,
  bindRef,
}: {
  tok: ReadingToken | undefined;
  extra: boolean;
  slot: EcoSlot | undefined;
  mis: boolean;
  eco: boolean;
  bindRef?: (el: HTMLElement | null) => void;
}) {
  if (!tok)
    return (
      <span className="text-center text-xs text-text-faint" title="La línea no llega a esta posición (falta una sílaba)">
        —
      </span>
    );
  const b = slot ? ecoBucket(slot.sim) : null;
  const i = tok.nucleus;
  const vowelCls = !slot
    ? ""
    : slot.sim >= 1
      ? "underline decoration-accent decoration-2 underline-offset-[5px]"
      : "text-text-faint";
  const title = [
    extra ? "Sobra: el molde no tiene esta posición" : null,
    slot ? `Tarareo «${slot.want}» → letra «${slot.got ?? "—"}»: ${SIM_LABEL[ecoBucket(slot.sim)]}` : null,
    mis ? `«${wordOfToken(tok, tok.text)}» carga el acento en un tiempo débil y corto` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      ref={bindRef}
      title={title || undefined}
      className={`flex items-baseline justify-center rounded-xs px-1 py-0.5 text-sm whitespace-nowrap text-text ${
        eco && b ? (b === "none" ? "text-text-faint" : ECO_BG[b]) : ""
      } ${extra ? "text-amber ring-1 ring-amber/40 ring-inset" : ""} ${bindRef ? KARAOKE : ""}`}
    >
      {!tok.wordStart && <span className="text-text-faint">-</span>}
      <span className={mis ? "underline decoration-amber decoration-dotted decoration-2 underline-offset-[7px]" : ""}>
        {i >= 0 ? (
          <>
            <Tie text={tok.text.slice(0, i)} />
            <span className={vowelCls}>{tok.text[i]}</span>
            <Tie text={tok.text.slice(i + 1)} />
          </>
        ) : (
          <Tie text={tok.text} />
        )}
      </span>
    </span>
  );
}

/** La sinalefa ("va‿el") con el lazo tenue: se lee como una sílaba, no como un guion bajo. */
function Tie({ text }: { text: string }) {
  if (!text.includes("‿")) return <>{text}</>;
  return (
    <>
      {text.split("‿").map((part, k) => (
        <span key={k}>
          {k > 0 && <span className="px-px text-text-faint">‿</span>}
          {part}
        </span>
      ))}
    </>
  );
}

const plainSyl = (t: ReadingToken | undefined) =>
  (t?.text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-zñ]/g, "");

function DiffCell({ tok, other }: { tok: ReadingToken | undefined; other: ReadingToken | undefined }) {
  if (!tok) return <span className="text-center text-xs text-text-faint">—</span>;
  const same = plainSyl(tok) === plainSyl(other);
  return (
    <span
      className={`flex items-baseline justify-center rounded-xs px-1 py-0.5 text-xs whitespace-nowrap ${
        same ? "text-text-faint" : "bg-panel-2 text-text"
      }`}
      title={same ? "igual" : `cambia: «${other?.text ?? "—"}» → «${tok.text}»`}
    >
      {!tok.wordStart && <span className="text-text-faint">-</span>}
      <Tie text={tok.text} />
    </span>
  );
}

export function LockIcon({ on }: { on: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {on ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7.5-1.9" />}
    </svg>
  );
}
