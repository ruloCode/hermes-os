"use client";

import { Fragment, useMemo } from "react";
import { GYM_HABITS, type GymRep } from "@hermes/shared";

// Clases estáticas por nota (Tailwind purga las interpoladas).
const SCORE_BAR: Record<number, string> = {
  1: "bg-red",
  2: "bg-amber",
  3: "bg-amber",
  4: "bg-green",
  5: "bg-green",
};

export function scoreTone(score: number): string {
  return score >= 75 ? "text-green" : score >= 45 ? "text-amber" : "text-red";
}

/** Escapa un fragmento para usarlo dentro de una RegExp. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Lo que dijiste, con las frases débiles marcadas (las que vio el detector). */
function MarkedTranscript({ text, weak }: { text: string; weak: string[] }) {
  const parts = useMemo(() => {
    if (!weak.length) return [text];
    const re = new RegExp(`(${weak.map(esc).join("|")})`, "gi");
    return text.split(re);
  }, [text, weak]);
  const lower = weak.map((w) => w.toLowerCase());
  return (
    <p className="text-sm leading-relaxed text-text-dim">
      {parts.map((p, i) =>
        lower.includes(p.toLowerCase()) ? (
          <mark key={i} className="rounded-xs bg-amber/15 px-0.5 text-amber" title="Le resta fuerza a lo que dices">
            {p}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </p>
  );
}

/** Lee una frase en voz alta con la voz del sistema en ese idioma. */
export function speak(text: string, lang: "es" | "en") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const clean = text.replace(/\[[^\]]*\]/g, "…");
  const u = new SpeechSynthesisUtterance(clean);
  u.lang = lang === "en" ? "en-US" : "es-CO";
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
  if (voice) u.voice = voice;
  u.rate = 1;
  synth.speak(u);
}

export function GymFeedback({ rep, previous }: { rep: GymRep; previous?: GymRep | null }) {
  const f = rep.feedback;
  const delta = previous ? rep.score - previous.score : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className={`text-4xl font-semibold tabular-nums ${scoreTone(rep.score)}`}>{rep.score}</span>
        <span className="text-sm text-text-dim">/ 100</span>
        {delta != null && (
          <span className={`text-sm tabular-nums ${delta > 0 ? "text-green" : delta < 0 ? "text-red" : "text-text-dim"}`}>
            {delta > 0 ? `+${delta}` : delta} vs. el intento anterior
          </span>
        )}
        <span className="ml-auto text-xs text-text-faint tabular-nums">
          intento {rep.attempt}
          {/* Escrita (sin audio) no tiene duración: nada de "0 s · 0 palabras/min". */}
          {rep.durationSec > 0 ? ` · ${rep.durationSec} s · ${rep.wpm} palabras/min` : " · escrita"}
          {rep.fillers > 0 ? ` · ${rep.fillers} muletillas` : ""}
        </span>
      </div>

      {f.progress && <p className="text-sm text-text">{f.progress}</p>}

      <section className="flex flex-col gap-2">
        <span className="text-2xs text-text-faint">Dilo así</span>
        <div className="flex items-start gap-3 rounded-md border border-accent/40 bg-accent/5 px-4 py-3">
          <p className="flex-1 text-lg leading-snug text-text">{f.better}</p>
          <button
            type="button"
            onClick={() => speak(f.better, rep.lang)}
            className="shrink-0 cursor-pointer rounded-sm border border-line px-2 py-1 text-xs text-text-dim hover:border-line-2 hover:text-text"
            title="Escucharla en voz alta"
          >
            ▶ Escuchar
          </button>
        </div>
        <p className="text-sm text-text">
          <span className="text-text-faint">Para el siguiente intento: </span>
          {f.tip}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <span className="text-2xs text-text-faint">Lo que dijiste</span>
        <MarkedTranscript text={rep.transcript} weak={rep.weak} />
      </section>

      <section className="flex flex-col gap-2.5">
        <span className="text-2xs text-text-faint">Hábito por hábito</span>
        {GYM_HABITS.map((h) => {
          const s = Math.min(5, Math.max(1, f.scores[h.key] ?? 1));
          return (
            <div key={h.key} className="grid grid-cols-[9.5rem_4.5rem_minmax(0,1fr)] items-start gap-3">
              <span className="text-xs text-text">{h.label}</span>
              <span className="mt-1 flex gap-0.5" aria-label={`${s} de 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`h-1.5 flex-1 rounded-xs ${i <= s ? SCORE_BAR[s] : "bg-line-2"}`} />
                ))}
              </span>
              <span className="text-xs leading-snug text-text-dim">{f.notes[h.key]}</span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
