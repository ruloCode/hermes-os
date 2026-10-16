"use client";

// Devolución de una repetición del gimnasio: la nota, tu respuesta dicha mejor,
// lo que dijiste con las frases débiles marcadas y la nota hábito por hábito.
//
// v5: el color vuelve a ser estado y nada más. La nota grande va en el color
// del texto con UN punto de estado al lado (antes el número entero en verde,
// ámbar o rojo); "Dilo así" es una tarjeta neutra (el acento es para lo que se
// toca, no para lo que se lee); las barras de hábito son grises y solo se
// encienden en ámbar donde la nota pide trabajo (≤ 2 de 5).

import { Fragment, useMemo } from "react";
import { GYM_HABITS, type GymRep } from "@hermes/shared";
import { Button } from "@/components/ui/Button";

export function scoreTone(score: number): string {
  return score >= 75 ? "text-green" : score >= 45 ? "text-amber" : "text-red";
}

/** Punto de estado de una nota 0-100 (clases estáticas: Tailwind purga las interpoladas). */
export function scoreDot(score: number): string {
  return score >= 75 ? "bg-green" : score >= 45 ? "bg-amber" : "bg-red";
}

/** Altavoz (escuchar en voz alta), trazo 1.7 como el resto de iconos. */
export function SpeakerIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
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
          <mark
            key={i}
            className="rounded-xs bg-amber/15 px-0.5 text-text underline decoration-amber/70 underline-offset-2"
            title="Le resta fuerza a lo que dices"
          >
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

function Label({ children }: { children: string }) {
  return <h3 className="text-xs font-medium text-text-faint">{children}</h3>;
}

export function GymFeedback({ rep, previous }: { rep: GymRep; previous?: GymRep | null }) {
  const f = rep.feedback;
  const delta = previous ? rep.score - previous.score : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-2.5 self-center">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${scoreDot(rep.score)}`} />
          <span className="text-4xl leading-none font-semibold text-text tabular-nums">
            {rep.score}
          </span>
        </span>
        <span className="text-sm text-text-faint">/ 100</span>
        {delta != null && (
          <span
            className={`text-sm tabular-nums ${delta > 0 ? "text-green" : delta < 0 ? "text-red" : "text-text-dim"}`}
          >
            {delta > 0 ? `+${delta}` : delta} vs. el intento anterior
          </span>
        )}
        <span className="ml-auto text-xs text-text-faint tabular-nums">
          Intento {rep.attempt}
          {/* Escrita (sin audio) no tiene duración: nada de "0 s · 0 palabras/min". */}
          {rep.durationSec > 0 ? ` · ${rep.durationSec} s · ${rep.wpm} palabras/min` : " · escrita"}
          {rep.fillers > 0 ? ` · ${rep.fillers} muletillas` : ""}
        </span>
      </div>

      {f.progress && <p className="text-sm leading-relaxed text-text">{f.progress}</p>}

      <section className="flex flex-col gap-2">
        <Label>Dilo así</Label>
        <div className="flex items-start gap-3 rounded-md border border-line bg-panel px-4 py-3.5 shadow-[var(--shadow-card)]">
          <p className="flex-1 text-lg leading-snug text-text">{f.better}</p>
          <Button
            variant="ghost"
            onClick={() => speak(f.better, rep.lang)}
            title="Escucharla en voz alta"
            icon={<SpeakerIcon />}
          >
            Escuchar
          </Button>
        </div>
        <p className="text-sm leading-relaxed text-text">
          <span className="text-text-faint">Para el siguiente intento: </span>
          {f.tip}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Lo que dijiste</Label>
        <MarkedTranscript text={rep.transcript} weak={rep.weak} />
      </section>

      <section className="flex flex-col gap-3">
        <Label>Hábito por hábito</Label>
        {GYM_HABITS.map((h) => {
          const s = Math.min(5, Math.max(1, f.scores[h.key] ?? 1));
          const weak = s <= 2;
          return (
            <div
              key={h.key}
              className="grid grid-cols-[9.5rem_4.5rem_minmax(0,1fr)] items-start gap-3"
            >
              <span className="text-sm text-text">{h.label}</span>
              <span className="mt-2 flex gap-0.5" aria-label={`${s} de 5`}>
                {[1, 2, 3, 4, 5].map((i) => (
                  <span
                    key={i}
                    className={`h-1.5 flex-1 rounded-xs ${i <= s ? (weak ? "bg-amber" : "bg-text-dim") : "bg-line-2"}`}
                  />
                ))}
              </span>
              <span className="text-sm leading-relaxed text-text-dim">{f.notes[h.key]}</span>
            </div>
          );
        })}
      </section>
    </div>
  );
}
