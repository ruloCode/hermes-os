"use client";

/**
 * Memo · MOLDE: lo que la melodía le pide a una letra. Arriba, lo cantado
 * estilo karaoke (patrón Apple Music Sing: la sílaba vigente encendida, los
 * rellenos na/dun/uh en estilo secundario porque son molde, no letra; la nota
 * sostenida como chip inline, patrón ElevenLabs Studio). Al lado, la tabla del
 * molde por frase — sílabas, acentos, final, melismas, notas largas, rima — que
 * el humano puede CORREGIR: si el análisis contó mal una sílaba, se arregla y
 * el molde manda con la corrección. Es medida, no autoría (como un metrónomo).
 *
 * El conmutador de melismas recalcula en el cliente: "Respetar" = una sílaba
 * estirada (pide vocal abierta) · "Silabizar" = una sílaba por nota.
 */
import { useEffect, useMemo, useState } from "react";
import type { LineEnding, MelismaMode, PassageAnalysis, Phrase, PhraseMold } from "@hermes/shared";
import { useQuantizedTime, type MemoPlayer } from "./useMemoPlayer";
import { Transport } from "./MelodyTab";
import { moldOf } from "./measure";
import { btnGhost, chip, field } from "./ui";
import { fmtTime } from "./format";

const ENDINGS: LineEnding[] = ["aguda", "llana", "esdrujula"];
const ENDING_LABEL: Record<LineEnding, string> = { aguda: "aguda", llana: "llana", esdrujula: "esdrújula" };

export function MelismaToggle({ mode, onChange }: { mode: MelismaMode; onChange: (m: MelismaMode) => void }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 text-xs text-text-dim">
      Melismas
      <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup">
        <button
          type="button"
          role="radio"
          aria-checked={mode === "respetar"}
          className={chip(mode === "respetar")}
          onClick={() => onChange("respetar")}
          title="La sílaba se estira sobre toda la corrida: pide vocal abierta (a, e, o)"
        >
          Respetar
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "silabizar"}
          className={chip(mode === "silabizar")}
          onClick={() => onChange("silabizar")}
          title="Cada nota de la corrida recibe su propia sílaba: más palabras"
        >
          Silabizar
        </button>
      </span>
      <span className="text-text-faint">
        {mode === "respetar" ? "una sílaba estirada, vocal abierta" : "una sílaba por nota"}
      </span>
    </span>
  );
}

export function MoldTab({
  analysis,
  player,
  mode,
  onMode,
  onOverride,
  focusPhrase,
  setFocusPhrase,
}: {
  analysis: PassageAnalysis;
  player: MemoPlayer;
  mode: MelismaMode;
  onMode: (m: MelismaMode) => void;
  onOverride: (phrase: number, o: Partial<Pick<PhraseMold, "syllables" | "ending" | "rhyme">>) => void;
  focusPhrase: number | null;
  setFocusPhrase: (i: number | null) => void;
}) {
  // Karaoke sin re-render por cuadro: el tiempo se cuantiza a los bordes de sílaba y de frase.
  const bounds = useMemo(
    () => analysis.phrases.flatMap((p) => [p.start, p.end + 0.3, ...p.syllables.flatMap((s) => [s.start, s.end])]),
    [analysis.phrases],
  );
  const t = useQuantizedTime(player.clock, bounds);
  const current = analysis.phrases.find((p) => t >= p.start && t < p.end + 0.3)?.idx ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Transport player={player} loop={false} />
        <MelismaToggle mode={mode} onChange={onMode} />
      </div>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        {/* Letra cantada, estilo karaoke (sin marco: se lee) */}
        <section className="flex min-w-0 flex-col gap-3">
          <p className="text-xs text-text-faint">
            Lo que se cantó · alineado automáticamente · sílabas aprox. Clic en una sílaba = ir ahí.
          </p>
          {analysis.phrases.length === 0 && (
            <p className="text-sm text-text-dim">No se encontraron frases con sílabas en este pasaje.</p>
          )}
          {analysis.phrases.map((ph) => (
            <KaraokeLine
              key={ph.idx}
              phrase={ph}
              time={t}
              live={current === ph.idx}
              focused={focusPhrase === ph.idx}
              onSeek={(x) => player.seek(x)}
              onFocus={() => setFocusPhrase(ph.idx)}
            />
          ))}
        </section>

        {/* El molde (se opera: lleva marco) */}
        <section className="flex min-w-0 flex-col gap-2">
          <p className="text-xs text-text-faint">
            El molde por frase — lo que una letra tiene que llenar. Corrige lo que el análisis contó mal.
          </p>
          <div className="overflow-x-auto rounded-md border border-line bg-panel">
            <table className="w-full min-w-[520px] text-xs">
              <thead>
                <tr className="border-b border-line text-left text-text-faint">
                  <th className="px-2 py-1.5 font-normal">Frase</th>
                  <th className="px-2 py-1.5 font-normal">Sílabas</th>
                  <th className="px-2 py-1.5 font-normal">Acentos</th>
                  <th className="px-2 py-1.5 font-normal">Final</th>
                  <th className="px-2 py-1.5 font-normal">Melismas</th>
                  <th className="px-2 py-1.5 font-normal" title="Notas de 0,6 s o más: piden vocal abierta">
                    Largas
                  </th>
                  <th className="px-2 py-1.5 font-normal">Rima</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {analysis.phrases.map((ph) => (
                  <MoldRow
                    key={ph.idx}
                    phrase={ph}
                    mold={moldOf(ph, mode)}
                    mode={mode}
                    focused={focusPhrase === ph.idx}
                    onFocus={() => setFocusPhrase(ph.idx)}
                    onPlay={() => player.play({ from: ph.start, to: ph.end })}
                    onOverride={(o) => onOverride(ph.idx, o)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-text-faint">
            Acentos y melismas en posición de sílaba (1 = la primera). Las correcciones quedan marcadas y viajan
            con la generación de versiones.
          </p>
        </section>
      </div>
    </div>
  );
}

function KaraokeLine({
  phrase,
  time,
  live,
  focused,
  onSeek,
  onFocus,
}: {
  phrase: Phrase;
  time: number;
  live: boolean;
  focused: boolean;
  onSeek: (t: number) => void;
  onFocus: () => void;
}) {
  return (
    <div
      className={`flex items-baseline gap-3 rounded-sm px-2 py-1 transition-colors ${
        focused ? "bg-accent/6" : ""
      }`}
    >
      <button
        type="button"
        onClick={onFocus}
        className={`w-7 shrink-0 cursor-pointer text-left font-mono text-xs ${focused ? "text-accent" : "text-text-faint"}`}
        title="Enfocar esta frase"
      >
        F{phrase.idx + 1}
      </button>
      <p className={`min-w-0 leading-relaxed ${live ? "text-lg" : "text-md"}`}>
        {phrase.syllables.map((s, i) => {
          const prev = phrase.syllables[i - 1];
          const newWord = i > 0 && prev.word !== s.word;
          const past = time >= s.end;
          const now = time >= s.start && time < s.end;
          const tone = now
            ? "text-accent"
            : s.filler
              ? "text-text-faint italic"
              : past && live
                ? "text-text"
                : live
                  ? "text-text-dim"
                  : "text-text-dim/80";
          return (
            <span key={i}>
              {newWord && " "}
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                className={`cursor-pointer rounded-xs transition-colors hover:bg-panel-2 ${tone} ${
                  s.stressed && !s.filler ? "font-semibold" : ""
                }`}
                title={`${fmtTime(s.start, true)}${s.stressed ? " · tónica" : ""}${s.melisma ? ` · melisma de ${s.noteIdx.length} notas` : ""}`}
              >
                {s.text}
              </button>
              {s.melisma && (
                <span className="mx-1 inline-flex items-center gap-1 align-middle text-2xs text-chart-4">
                  <span aria-hidden className="inline-block h-px w-5 bg-chart-4" />
                  {s.noteIdx.length} notas
                </span>
              )}
            </span>
          );
        })}
      </p>
    </div>
  );
}

function MoldRow({
  phrase,
  mold,
  mode,
  focused,
  onFocus,
  onPlay,
  onOverride,
}: {
  phrase: Phrase;
  mold: PhraseMold;
  mode: MelismaMode;
  focused: boolean;
  onFocus: () => void;
  onPlay: () => void;
  onOverride: (o: Partial<Pick<PhraseMold, "syllables" | "ending" | "rhyme">>) => void;
}) {
  const ov = phrase.override ?? {};
  const corrected = Object.keys(ov).length > 0;
  const [syl, setSyl] = useState(String(mold.syllables));
  const [rhyme, setRhyme] = useState(mold.rhyme ?? "");
  useEffect(() => setSyl(String(mold.syllables)), [mold.syllables]);
  useEffect(() => setRhyme(mold.rhyme ?? ""), [mold.rhyme]);

  const commitSyl = () => {
    const n = Number(syl);
    if (!Number.isInteger(n) || n < 1 || n > 40) return setSyl(String(mold.syllables));
    if (n !== mold.syllables) onOverride({ ...ov, syllables: n });
  };
  const commitRhyme = () => {
    const r = rhyme.trim().toUpperCase().slice(0, 2);
    if (r !== (mold.rhyme ?? "")) onOverride({ ...ov, rhyme: r || undefined });
  };

  return (
    <tr
      onClick={onFocus}
      className={`border-t border-line/60 first:border-t-0 ${focused ? "bg-accent/6" : "hover:bg-panel-2/50"}`}
    >
      <td className="px-2 py-1.5">
        <span className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className="cursor-pointer text-text-faint hover:text-accent"
            aria-label={`Oír la frase ${phrase.idx + 1}`}
          >
            ▶
          </button>
          <span className={`font-mono ${focused ? "text-accent" : "text-text-dim"}`}>F{phrase.idx + 1}</span>
        </span>
      </td>
      <td className="px-2 py-1">
        <input
          value={syl}
          inputMode="numeric"
          onChange={(e) => setSyl(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commitSyl}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`${field} w-11 text-center font-mono tabular-nums ${ov.syllables != null ? "border-accent/50" : ""}`}
          aria-label="Sílabas del molde"
          title={mode === "silabizar" ? "Con melismas silabizados (una sílaba por nota)" : "Sílabas cantadas"}
        />
      </td>
      <td className="px-2 py-1.5 font-mono text-text-dim tabular-nums">{mold.stresses.join("·") || "—"}</td>
      <td className="px-2 py-1">
        <select
          value={mold.ending}
          onChange={(e) => onOverride({ ...ov, ending: e.target.value as LineEnding })}
          className={`${field} ${ov.ending ? "border-accent/50" : ""}`}
          aria-label="Final de la frase"
        >
          {ENDINGS.map((x) => (
            <option key={x} value={x}>
              {ENDING_LABEL[x]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-1.5 text-text-dim">
        {mold.melismas.length
          ? mold.melismas.map((m) => `${m.pos}: ${m.notes} notas`).join(" · ")
          : mode === "silabizar" && phrase.mold.melismas.length
            ? "silabizados"
            : ""}
      </td>
      <td className="px-2 py-1.5 font-mono text-text-dim tabular-nums">{mold.long.join("·")}</td>
      <td className="px-2 py-1">
        <input
          value={rhyme}
          onChange={(e) => setRhyme(e.target.value)}
          onBlur={commitRhyme}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          placeholder="—"
          className={`${field} w-10 text-center font-mono uppercase ${ov.rhyme ? "border-accent/50" : ""}`}
          aria-label="Letra de rima"
        />
      </td>
      <td className="px-2 py-1 text-right">
        {corrected && (
          <button
            type="button"
            className={btnGhost}
            onClick={(e) => {
              e.stopPropagation();
              onOverride({});
            }}
            title="Quitar la corrección: vuelve a lo medido"
          >
            corregido · ↺
          </button>
        )}
      </td>
    </tr>
  );
}
