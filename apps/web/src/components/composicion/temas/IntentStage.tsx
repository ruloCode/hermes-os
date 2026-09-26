"use client";

/**
 * Etapa INTENCIÓN: de qué habla el tema, qué quiere transmitir, quién le habla
 * a quién, qué evitar, las palabras ancla y el género. Es la capa que manda
 * sobre todo lo demás: entra al pedido de letra por encima del molde y de la
 * rima. La escribe el humano; Hermes no la rellena.
 */
import { useState } from "react";
import { GENRES, type Genre, type TemaIntent } from "@hermes/shared";
import { chip, field } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";
import { patchSection } from "./track-edit";

const GENRE_LABEL: Record<Genre, string> = {
  rnb: "R&B",
  dancehall: "Dancehall",
  reggaeton: "Reggaetón",
  "pop-urbano": "Pop urbano",
  otro: "Otro",
};

const POVS = ["yo → tú", "yo → ella / él", "nosotros → tú", "nosotras → él", "narrador"];

const area =
  "w-full resize-none rounded-sm border border-line bg-transparent px-2.5 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

export function IntentStage() {
  const { tema, patch } = useTemaCtx();
  const intent = tema.intent;
  const set = (p: Partial<TemaIntent>) => patch({ intent: { ...intent, ...p } });

  return (
    <div className="grid min-h-0 grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex max-w-[720px] flex-col gap-5">
        <Field label="De qué habla" hint="La situación, en una o dos frases. Lo concreto le gana a lo abstracto.">
          <textarea
            rows={2}
            value={intent.about}
            onChange={(e) => set({ about: e.target.value })}
            placeholder="Una escena, una historia, un momento…"
            aria-label="De qué habla"
            className={area}
          />
        </Field>
        <Field label="Qué quiere transmitir" hint="La emoción o la idea con la que se tiene que quedar quien la oye.">
          <textarea
            rows={2}
            value={intent.convey}
            onChange={(e) => set({ convey: e.target.value })}
            placeholder="Lo que tiene que sentir quien la canta de vuelta"
            aria-label="Qué quiere transmitir"
            className={area}
          />
        </Field>
        <Field label="Quién le habla a quién">
          <div className="flex flex-wrap items-center gap-1.5">
            <input
              value={intent.pov ?? ""}
              onChange={(e) => set({ pov: e.target.value || undefined })}
              placeholder="yo → tú"
              aria-label="Quién le habla a quién"
              className={`${field} w-48 text-sm`}
            />
            {POVS.map((p) => (
              <button key={p} type="button" className={chip(intent.pov === p)} onClick={() => set({ pov: p })}>
                {p}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Qué evitar" hint="Clichés, palabras gastadas, temas que no van.">
          <textarea
            rows={2}
            value={intent.avoid ?? ""}
            onChange={(e) => set({ avoid: e.target.value || undefined })}
            placeholder="Rimas obvias, palabras que ya suenan en todo…"
            aria-label="Qué evitar"
            className={area}
          />
        </Field>
        <Field label="Palabras ancla" hint="Imágenes o palabras que tienen que aparecer. Enter para agregar.">
          <Anchors value={intent.anchors ?? []} onChange={(anchors) => set({ anchors: anchors.length ? anchors : undefined })} />
        </Field>
        <Field label="Género">
          <div className="flex flex-wrap gap-1">
            {GENRES.map((g) => (
              <button key={g} type="button" className={chip(intent.genre === g)} onClick={() => set({ genre: g })}>
                {GENRE_LABEL[g]}
              </button>
            ))}
          </div>
        </Field>
        <SectionIntents />
      </div>
      <aside className="flex flex-col gap-4 text-xs text-text-dim xl:border-l xl:border-line xl:pl-6">
        <section className="flex flex-col gap-1.5">
          <span className="text-text-faint">Para qué sirve</span>
          <p>
            La intención entra al pedido de letra por encima de todo: el molde dice cuántas sílabas, la intención dice
            qué contar. Las versiones que no la respeten sobran.
          </p>
        </section>
        <section className="flex flex-col gap-1.5">
          <span className="text-text-faint">Qué sale del equipo</span>
          <p>
            Al generar letra se envía a Claude la intención, la progresión y los fonemas del tarareo. Tu voz no sale de
            este equipo.
          </p>
        </section>
        <section className="flex flex-col gap-1.5">
          <span className="text-text-faint">La regla de la casa</span>
          <p>Hermes no escribe la intención: la mide contra lo que propone. La decisión es tuya.</p>
        </section>
      </aside>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      <span className="text-sm text-text">{label}</span>
      {children}
      {hint && <span className="text-xs text-text-faint">{hint}</span>}
    </div>
  );
}

function Anchors({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const w = draft.trim().replace(/,$/, "");
    if (w && !value.includes(w)) onChange([...value, w]);
    setDraft("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 rounded-sm border border-line px-1.5 py-1 focus-within:border-accent">
      {value.map((w) => (
        <span key={w} className="inline-flex items-center gap-1 rounded-sm bg-panel-2 py-0.5 pr-1 pl-2 text-xs text-text">
          {w}
          <button
            type="button"
            onClick={() => onChange(value.filter((x) => x !== w))}
            aria-label={`Quitar ${w}`}
            className="cursor-pointer rounded-sm px-0.5 text-text-faint hover:text-text"
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={add}
        placeholder={value.length ? "" : "ventana, diciembre, la foto…"}
        aria-label="Agregar palabra ancla"
        className="min-w-[12ch] flex-1 bg-transparent px-1 py-0.5 text-sm text-text placeholder:text-text-faint focus:outline-none"
      />
    </div>
  );
}

/** Qué tiene que pasar en cada sección (entra al pedido de letra de esa sección). */
function SectionIntents() {
  const { tema, patch } = useTemaCtx();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-text">Por sección</span>
      <ul className="flex flex-col gap-2">
        {tema.track.sections.map((s) => (
          <li key={s.id} className="grid grid-cols-[120px_minmax(0,1fr)] items-start gap-3">
            <span className="pt-1.5 text-xs text-text-dim">{s.label}</span>
            <input
              value={s.intent ?? ""}
              onChange={(e) => patch({ track: patchSection(tema.track, s.id, { intent: e.target.value || undefined }) })}
              placeholder={`Qué tiene que pasar en ${s.label.toLowerCase()}`}
              className={`${field} text-sm`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
