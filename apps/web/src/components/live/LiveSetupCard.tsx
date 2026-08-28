"use client";

// Setup de la junta EN VIVO: modo de audio (presencial/remoto) e idiomas del
// STT antes de iniciar. Reemplaza al botón único de MeetingsPanel — el título
// sigue viviendo en el input compartido de arriba.

import { useState } from "react";

export interface LiveSetupOptions {
  mode: "presencial" | "remoto";
  languages: ("es" | "en")[];
}

const MODES: { id: LiveSetupOptions["mode"]; label: string; hint: string }[] = [
  { id: "presencial", label: "Presencial", hint: "mic de la sala capta a todos" },
  { id: "remoto", label: "Remoto · Meet", hint: "mic + audio de la pestaña compartida" },
];

const LANGS: { id: string; label: string; languages: ("es" | "en")[] }[] = [
  { id: "es", label: "Español", languages: ["es"] },
  { id: "es-en", label: "ES + EN", languages: ["es", "en"] },
  { id: "en", label: "English", languages: ["en"] },
];

function Pill({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={`rounded-sm border px-2 py-1 text-2xs tracking-label uppercase transition-colors ${
        active
          ? "border-green/70 bg-green/10 text-green"
          : "border-line text-text-dim hover:border-line-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function LiveSetupCard({
  projectLabel,
  disabled,
  disabledTitle,
  onStart,
}: {
  projectLabel: string;
  disabled: boolean;
  disabledTitle?: string;
  onStart: (opts: LiveSetupOptions) => void;
}) {
  const [mode, setMode] = useState<LiveSetupOptions["mode"]>("presencial");
  const [langId, setLangId] = useState("es");
  const lang = LANGS.find((l) => l.id === langId) ?? LANGS[0];
  const modeHint = MODES.find((m) => m.id === mode)?.hint;

  return (
    <div className="space-y-2 rounded-sm border border-green/40 bg-green/5 p-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1" role="group" aria-label="Modo de audio">
          {MODES.map((m) => (
            <Pill key={m.id} active={mode === m.id} onClick={() => setMode(m.id)} title={m.hint}>
              {m.label}
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Idiomas de la junta">
          {LANGS.map((l) => (
            <Pill key={l.id} active={langId === l.id} onClick={() => setLangId(l.id)}>
              {l.label}
            </Pill>
          ))}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onStart({ mode, languages: lang.languages })}
        disabled={disabled}
        title={disabled ? disabledTitle : "Transcript + sugerencias de Hermes en tiempo real"}
        className="flex w-full items-center justify-between gap-2 rounded-sm border border-green/50 bg-green/5 px-3 py-2 text-left transition-colors hover:border-green disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-xs text-green">▶ Iniciar junta en vivo · {projectLabel}</span>
        <span className="text-2xs tracking-label text-text-dim uppercase">
          copiloto en tiempo real
        </span>
      </button>
      {modeHint && <p className="text-2xs leading-snug text-text-dim">{modeHint}</p>}
    </div>
  );
}
