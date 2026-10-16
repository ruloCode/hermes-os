"use client";

// Setup de la junta EN VIVO: tipo de reunión (equipo / entrevista), de dónde
// sale el audio (sala · pestaña de Meet o Teams web · app de escritorio) e
// idiomas del STT antes de iniciar. El título sigue viviendo en el input
// compartido de arriba. Lo elegido se recuerda en este navegador.

import { useEffect, useState } from "react";
import { TEAM_COACH_MODE } from "@hermes/shared";
import type { CallAudioSource } from "@/hooks/useLiveMeetingAudio";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";

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
    <div className="space-y-3">
      {/* Tres decisiones, tres segmentados (antes: píldoras verdes en mayúsculas,
          cada una con su propio borde). Lo elegido se recuerda. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <Field label="Tipo">
          <Segmented
            ariaLabel="Tipo de reunión"
            size="sm"
            value={kind.id}
            onChange={(v) => update({ kind: v })}
            options={KINDS.map((k) => ({ value: k.id, label: k.label, title: k.hint }))}
          />
        </Field>
        <Field label="Audio">
          <Segmented
            ariaLabel="De dónde sale el audio"
            size="sm"
            value={audio.id}
            onChange={(v) => update({ audio: v })}
            options={AUDIO.map((a) => ({ value: a.id, label: a.label, title: a.hint }))}
          />
        </Field>
        <Field label="Idioma">
          <Segmented
            ariaLabel="Idiomas de la junta"
            size="sm"
            value={lang.id}
            onChange={(v) => update({ lang: v })}
            options={LANGS.map((l) => ({ value: l.id, label: l.label }))}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-[280px] text-xs leading-snug text-text-faint first-letter:uppercase">
          {kind.hint} · {audio.hint}
        </p>
        <Button
          variant="primary"
          size="md"
          onClick={() =>
            onStart({
              mode: audio.id === "presencial" ? "presencial" : "remoto",
              source: audio.id === "app" ? "app" : "tab",
              languages: lang.languages,
              coachMode: kind.id,
            })
          }
          disabled={disabled}
          title={
            disabled
              ? disabledTitle
              : `Transcript + sugerencias de Hermes en tiempo real · ${projectLabel}`
          }
          icon={
            <span className="relative grid h-2 w-2 place-items-center">
              <span className="h-2 w-2 rounded-full bg-current" />
            </span>
          }
        >
          Iniciar junta en vivo
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-faint">{label}</span>
      {children}
    </div>
  );
}
