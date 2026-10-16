"use client";

// Setup de la junta EN VIVO: tipo de reunión (equipo / entrevista), de dónde
// sale el audio (sala · pestaña de Meet o Teams web · app de escritorio) e
// idiomas del STT antes de iniciar. El título sigue viviendo en el input
// compartido de arriba. Lo elegido se recuerda en este navegador.

import { useEffect, useState } from "react";
import { TEAM_COACH_MODE } from "@hermes/shared";
import type { CallAudioSource } from "@/hooks/useLiveMeetingAudio";

export interface LiveSetupOptions {
  mode: "presencial" | "remoto";
  source: CallAudioSource;
  languages: ("es" | "en")[];
  /** "equipo" = aportar + conceptos · "junta" = responder cuando te preguntan. */
  coachMode: string;
}

const KINDS: { id: string; label: string; hint: string }[] = [
  {
    id: TEAM_COACH_MODE,
    label: "Equipo",
    hint: "te avisa cuándo aportar (con su ángulo) y te explica los términos nuevos",
  },
  {
    id: "junta",
    label: "Entrevista · cliente",
    hint: "te sopla la respuesta cuando te preguntan a ti",
  },
];

type AudioId = "presencial" | "tab" | "app";

const AUDIO: { id: AudioId; label: string; hint: string }[] = [
  { id: "presencial", label: "Presencial", hint: "el mic de la sala capta a todos" },
  {
    id: "tab",
    label: "Meet · Teams web",
    hint: "mic + audio de la pestaña: elige la pestaña de la llamada y marca «Compartir audio de la pestaña»",
  },
  {
    id: "app",
    label: "App de Teams",
    hint: "mic + audio de la Mac (Teams, Zoom, Slack…). Usa audífonos: por bocinas el mic vuelve a captar a los demás",
  },
];

const LANGS: { id: string; label: string; languages: ("es" | "en")[] }[] = [
  { id: "es", label: "Español", languages: ["es"] },
  { id: "es-en", label: "ES + EN", languages: ["es", "en"] },
  { id: "en", label: "English", languages: ["en"] },
];

const PREFS_KEY = "hermes-live-setup";

interface Prefs {
  kind: string;
  audio: AudioId;
  lang: string;
}

const DEFAULTS: Prefs = { kind: TEAM_COACH_MODE, audio: "presencial", lang: "es" };

function readPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      kind: KINDS.some((k) => k.id === raw.kind) ? raw.kind! : DEFAULTS.kind,
      audio: AUDIO.some((a) => a.id === raw.audio) ? raw.audio! : DEFAULTS.audio,
      lang: LANGS.some((l) => l.id === raw.lang) ? raw.lang! : DEFAULTS.lang,
    };
  } catch {
    return DEFAULTS;
  }
}

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
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);
  // localStorage solo en el cliente: se lee al montar (sin desfase de hidratación).
  useEffect(() => setPrefs(readPrefs()), []);
  const update = (patch: Partial<Prefs>) =>
    setPrefs((cur) => {
      const next = { ...cur, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* sin storage: la elección vale solo para esta vez */
      }
      return next;
    });

  const lang = LANGS.find((l) => l.id === prefs.lang) ?? LANGS[0];
  const kind = KINDS.find((k) => k.id === prefs.kind) ?? KINDS[0];
  const audio = AUDIO.find((a) => a.id === prefs.audio) ?? AUDIO[0];

  return (
    <div className="space-y-2 rounded-sm border border-green/40 bg-green/5 p-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1" role="group" aria-label="Tipo de reunión">
          {KINDS.map((k) => (
            <Pill
              key={k.id}
              active={prefs.kind === k.id}
              onClick={() => update({ kind: k.id })}
              title={k.hint}
            >
              {k.label}
            </Pill>
          ))}
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Idiomas de la junta">
          {LANGS.map((l) => (
            <Pill key={l.id} active={prefs.lang === l.id} onClick={() => update({ lang: l.id })}>
              {l.label}
            </Pill>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="De dónde sale el audio">
        {AUDIO.map((a) => (
          <Pill
            key={a.id}
            active={prefs.audio === a.id}
            onClick={() => update({ audio: a.id })}
            title={a.hint}
          >
            {a.label}
          </Pill>
        ))}
      </div>
      <button
        type="button"
        onClick={() =>
          onStart({
            mode: audio.id === "presencial" ? "presencial" : "remoto",
            source: audio.id === "app" ? "app" : "tab",
            languages: lang.languages,
            coachMode: kind.id,
          })
        }
        disabled={disabled}
        title={disabled ? disabledTitle : "Transcript + sugerencias de Hermes en tiempo real"}
        className="flex w-full items-center justify-between gap-2 rounded-sm border border-green/50 bg-green/5 px-3 py-2 text-left transition-colors hover:border-green disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-xs text-green">▶ Iniciar junta en vivo · {projectLabel}</span>
        <span className="text-2xs tracking-label text-text-dim uppercase">{kind.label}</span>
      </button>
      <p className="text-2xs leading-snug text-text-dim">
        {kind.hint} · {audio.hint}
      </p>
    </div>
  );
}
