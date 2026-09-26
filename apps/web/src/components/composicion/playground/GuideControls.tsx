"use client";

/**
 * Controles de la GUÍA CANTADA (useGuide) y su karaoke. Referencias Mobbin:
 * ElevenLabs (selector de voz + costo en caracteres a la vista), Suno (el
 * conmutador de cómo suena junto al ▶), Apple Music (la sílaba que suena
 * encendida, lo cantado atenuado, lo que viene tenue).
 *
 * Siempre rotulada como GUÍA: es una voz sintética que muestra dónde cae cada
 * sílaba sobre la melodía — no es un demo ni la voz de nadie.
 */
import { useEffect, useRef } from "react";
import type { GuideResult } from "@hermes/shared";
import type { Guide, GuideLine, GuidePlaying } from "./useGuide";
import { btn, btnGhost, chip } from "./ui";

const GENDER: Record<string, string> = { female: "femenina", male: "masculina", neutral: "neutra" };

/** Enciende elementos por tiempo desde un rAF (sin estado por cuadro). */
export function useKaraoke(clock: () => number | null, spans: { start: number; end: number }[] | null) {
  const els = useRef<(HTMLElement | null)[]>([]);
  useEffect(() => {
    if (!spans?.length) return;
    let raf = 0;
    let last = "";
    // Los nodos tocados se recuerdan aquí: al terminar, React ya soltó los refs.
    const touched = new Set<HTMLElement>();
    const tick = () => {
      const t = clock();
      let cur = -1;
      if (t != null) for (let i = 0; i < spans.length; i++) if (t >= spans[i].start - 0.02) cur = i;
      const on = t != null && cur >= 0 && t <= spans[cur].end + 0.06;
      const key = t == null ? "x" : `${cur}:${on ? 1 : 0}`;
      if (key !== last) {
        last = key;
        els.current.forEach((el, i) => {
          if (!el) return;
          touched.add(el);
          el.dataset.k = t == null || i > cur ? "next" : i === cur && on ? "now" : "past";
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      touched.forEach((el) => delete el.dataset.k);
    };
  }, [clock, spans]);
  return (i: number) => (el: HTMLElement | null) => {
    els.current[i] = el;
  };
}

/** Clases de una sílaba de karaoke (por data-k: next · now · past). */
export const KARAOKE =
  "rounded-xs transition-colors duration-75 data-[k=next]:text-text-faint data-[k=past]:text-text-dim data-[k=now]:bg-accent/15 data-[k=now]:text-accent";

/** La tira de sílabas de la guía de UNA frase, encendiéndose con el audio. */
export function GuideKaraoke({
  syllables,
  clock,
}: {
  syllables: GuideResult["syllables"];
  clock: () => number | null;
}) {
  const bind = useKaraoke(clock, syllables);
  return (
    <span className="flex flex-wrap items-baseline gap-x-0.5 text-sm leading-snug" aria-label="Guía sonando">
      <span className="mr-1 text-2xs text-text-faint">guía</span>
      {syllables.map((s, i) => (
        <span key={i} ref={bind(i)} data-k="next" className={`${KARAOKE} px-0.5`}>
          {s.text}
        </span>
      ))}
    </span>
  );
}

/** Las sílabas de la guía que suenan para una frase y un texto (null = no es esta). */
export function sungFor(p: GuidePlaying | null | undefined, phrase: number, text: string | undefined): GuideResult["syllables"] | null {
  if (!p || !text) return null;
  const line = p.lines.find((l) => l.phrase === phrase);
  if (!line || line.text.trim() !== text.trim()) return null;
  const syl = p.syllables.filter((s) => s.phrase === phrase);
  return syl.length ? syl : null;
}

/** ¿Esta frase (con este texto) se está preparando o sonando? */
export function guideStateOf(guide: Guide | null, phrase: number, text: string | undefined): "rendering" | "playing" | null {
  if (!guide || !text?.trim()) return null;
  const same = (ls: GuideLine[] | undefined) => !!ls?.find((l) => l.phrase === phrase && l.text.trim() === text.trim());
  if (guide.rendering && same(guide.rendering.lines)) return "rendering";
  if (guide.playing && same(guide.playing.lines)) return "playing";
  return null;
}

/** "▶ guía" de una línea: ▶ / … / ■ según esté quieta, preparándose o sonando. */
export function GuideLineButton({
  guide,
  phrase,
  text,
  label = "guía",
}: {
  guide: Guide | null;
  phrase: number;
  text: string | undefined;
  label?: string;
}) {
  if (!guide?.available) return null;
  const st = guideStateOf(guide, phrase, text);
  const blocked = guide.problem?.kind === "clave" || guide.voicesError?.kind === "clave";
  return (
    <button
      type="button"
      className={`${btnGhost} whitespace-nowrap ${st ? "text-accent" : ""}`}
      disabled={!text?.trim() || (blocked && !st)}
      onClick={() => (st ? guide.stop() : void guide.play([{ phrase, text: text ?? "" }]))}
      title={
        blocked
          ? (guide.problem?.message ?? guide.voicesError?.message)
          : st === "playing"
            ? "Detener la guía"
            : st === "rendering"
              ? "Preparando la guía… (clic = cancelar)"
              : guide.onTrack
                ? "Guía cantada de esta línea sobre la pista (voz sintética: una guía, no un demo)"
                : "Guía cantada de esta línea (voz sintética: una guía, no un demo)"
      }
      aria-label={st === "playing" ? "Detener la guía" : `Guía cantada de la frase ${phrase + 1}`}
    >
      {st === "playing" ? "■" : st === "rendering" ? <Dots /> : "▶"} {label}
    </button>
  );
}

function Dots() {
  return (
    <span className="inline-flex gap-px" aria-hidden>
      <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
      <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </span>
  );
}

/**
 * La barra de la guía: altura (notas | tarareo), voz, "▶ todo con guía" y la
 * línea de estado (costo real, errores honestos, avisos del render).
 */
export function GuideBar({ guide, allLines }: { guide: Guide; allLines: GuideLine[] }) {
  const selectRef = useRef<HTMLSelectElement>(null);
  // "Elige una voz": el agente no tiene una por defecto → el selector se enciende y toma el foco.
  useEffect(() => {
    if (guide.needVoice) selectRef.current?.focus();
  }, [guide.needVoice]);

  const all = allLines.filter((l) => l.text.trim());
  const allOn = guide.playing?.tag === "todo" || guide.rendering?.tag === "todo";
  const chars = all.reduce((a, l) => a + l.text.trim().length, 0);
  const blocked = guide.problem?.kind === "clave" || guide.voicesError?.kind === "clave";
  const p = guide.problem;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <span
          className="flex items-center gap-1.5 text-xs text-text"
          title="Se envía a ElevenLabs solo el texto de las líneas; tu voz no sale de este equipo"
        >
          Guía cantada
          <span className="rounded-sm border border-line px-1.5 py-px text-2xs text-text-faint">voz sintética · no es un demo</span>
        </span>
        <span className="flex items-center gap-0.5 rounded-sm border border-line p-0.5" role="radiogroup" aria-label="Altura de la guía">
          {(["notas", "tarareo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={guide.pitch === m}
              className={chip(guide.pitch === m)}
              onClick={() => guide.setPitch(m)}
              title={
                m === "notas"
                  ? "Alturas limpias de las notas medidas (con un vibrato suave)"
                  : "El contorno real de tu tarareo: ligaduras, vibrato y desafines incluidos"
              }
            >
              {m}
            </button>
          ))}
        </span>
        <select
          ref={selectRef}
          value={guide.voiceId ?? ""}
          onChange={(e) => guide.setVoiceId(e.target.value || null)}
          aria-label="Voz de la guía"
          aria-invalid={guide.needVoice || undefined}
          className={`max-w-[26ch] cursor-pointer rounded-sm border bg-panel px-1.5 py-1 text-xs text-text focus:border-accent focus:outline-none ${
            guide.needVoice ? "border-accent ring-2 ring-accent/30" : "border-line"
          }`}
        >
          <option value="">{guide.needVoice ? "Elige una voz…" : "Voz: la del agente"}</option>
          {(guide.voices ?? []).map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
              {v.accent ? ` · ${v.accent}` : ""}
              {v.gender ? ` · ${GENDER[v.gender] ?? v.gender}` : ""}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={allOn ? `${btn} border-accent text-accent` : btn}
          disabled={(!all.length || blocked) && !allOn}
          onClick={() => (allOn ? guide.stop() : void guide.play(all, { loop: guide.onTrack, tag: "todo" }))}
          title={
            blocked
              ? (p?.message ?? guide.voicesError?.message)
              : !all.length
                ? "Arma tu versión primero: escribe o elige una línea por frase"
                : guide.onTrack
                  ? `Tu versión cantada por la guía sobre la pista, en loop · hasta ${chars} caracteres de TTS (lo que ya está en caché no se cobra)`
                  : `Tu versión cantada por la guía · hasta ${chars} caracteres de TTS (lo que ya está en caché no se cobra)`
          }
        >
          {allOn ? "■ Detener guía" : "▶ Todo con guía"}
        </button>
      </div>
      <GuideStatus guide={guide} />
    </div>
  );
}

/** El agente numera las frases desde 0 ("frase 1: …"); la UI las llama F1, F2… */
const fWarn = (w: string) => w.replace(/^frase (\d+):/, (_, n: string) => `F${Number(n) + 1}:`);

function GuideStatus({ guide }: { guide: Guide }) {
  const p = guide.problem;
  const r = guide.rendering;
  const pl = guide.playing;
  const phrasesLabel = (xs: number[]) => xs.map((x) => `F${x + 1}`).join(" · ");
  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-0.5 text-2xs" aria-live="polite">
      {r ? (
        <span className="text-text-dim">
          Preparando la guía de {phrasesLabel(r.lines.map((l) => l.phrase))}… (TTS + ajuste de altura en el agente){" "}
          <button type="button" className={`${btnGhost} text-2xs`} onClick={guide.stop}>
            cancelar
          </button>
        </span>
      ) : pl ? (
        <span className="text-text-dim">
          Sonando la guía de {phrasesLabel(pl.lines.map((l) => l.phrase))}
          {pl.onTrack ? (pl.loop ? " sobre la pista, en loop" : " sobre la pista") : " (sin pista)"}
        </span>
      ) : null}
      {p ? (
        <span className="text-amber">{p.message}</span>
      ) : guide.voicesError && guide.voicesError.kind !== "voz" ? (
        <span className="text-amber">
          {guide.voicesError.kind === "clave" ? guide.voicesError.message : `No se pudo leer la lista de voces: ${guide.voicesError.message}`}
        </span>
      ) : guide.cost ? (
        <span className="text-text-faint">
          Última guía:{" "}
          {guide.cost.free ? (
            <span className="text-text-dim">de caché, sin costo</span>
          ) : (
            <span className="text-text-dim tabular-nums">{guide.cost.ttsChars} caracteres de TTS</span>
          )}
          {guide.voiceName ? ` · ${guide.voiceName}` : ""}
        </span>
      ) : (
        !r &&
        !pl && <span className="text-text-faint">Se envía a ElevenLabs solo el texto de las líneas. Tu voz no sale de este equipo.</span>
      )}
      {guide.warnings.length > 0 && !p && (
        <span className="text-amber" title={guide.warnings.map(fWarn).join("\n")}>
          {guide.warnings.length === 1 ? fWarn(guide.warnings[0]) : `${guide.warnings.length} avisos: ${fWarn(guide.warnings[0])}…`}
        </span>
      )}
    </div>
  );
}
