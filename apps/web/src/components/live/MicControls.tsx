"use client";

// Tu micrófono, a la vista. En la clase del 16-oct el STT se quedó solo con
// la profe y nada lo avisó: el único medidor era el de la MEZCLA (mic +
// pestaña) y con ella hablando se movía igual. Aquí: un medidor por fuente,
// qué micrófono se está usando (y cambiarlo sin cortar), y el aviso cuando
// lo medido dice que tu voz no está entrando.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  readMicPref,
  saveMicPref,
  useLiveMeeting,
  type MicWarning,
} from "@/state/LiveMeetingProvider";
import { LiveVuMeter } from "./LiveVuMeter";

/** Medidores "Tú" y la otra parte (solo remoto tiene dos fuentes). */
export function LiveSourceMeters() {
  const live = useLiveMeeting();
  const other = live.isClass ? "Profe" : live.callSource === "app" ? "App" : "Llamada";
  return (
    <span className="flex items-center gap-3">
      <span className="flex items-center gap-1.5" title={live.mic?.label ?? "Micrófono"}>
        <span className="text-xs text-text-dim">Tú</span>
        <LiveVuMeter levelRef={live.micLevelRef} label="Nivel de tu micrófono" />
      </span>
      {live.mode === "remoto" && live.systemAudio && (
        <span className="flex items-center gap-1.5">
          <span className="text-xs text-text-dim">{other}</span>
          <LiveVuMeter levelRef={live.callLevelRef} label="Nivel del audio de la llamada" />
        </span>
      )}
    </span>
  );
}

/** Entradas de audio del equipo (las etiquetas existen porque ya hay permiso de mic). */
function useAudioInputs(): MediaDeviceInfo[] {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    const md = navigator.mediaDevices;
    if (!md?.enumerateDevices) return;
    const load = () =>
      void md
        .enumerateDevices()
        .then((all) => setInputs(all.filter((d) => d.kind === "audioinput" && d.deviceId !== "communications")))
        .catch(() => setInputs([]));
    load();
    md.addEventListener("devicechange", load);
    return () => md.removeEventListener("devicechange", load);
  }, []);
  return inputs;
}

/** Selector del micrófono: cambia en caliente y queda guardado para la próxima. */
export function MicPicker({ compact = false }: { compact?: boolean }) {
  const live = useLiveMeeting();
  const inputs = useAudioInputs();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = live.mic?.deviceId ?? "";
  if (inputs.length === 0) return null;

  const onChange = async (deviceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await live.switchMic(deviceId === "default" ? null : deviceId);
    } catch {
      setError("No pude abrir ese micrófono");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <select
        aria-label="Micrófono"
        value={inputs.some((d) => d.deviceId === current) ? current : "default"}
        onChange={(e) => void onChange(e.target.value)}
        disabled={busy || live.phase !== "live"}
        className={`h-7 min-w-0 cursor-pointer truncate rounded-sm border border-line bg-panel px-1.5 text-xs text-text hover:border-line-2 disabled:opacity-50 ${compact ? "max-w-[220px]" : "max-w-[240px]"}`}
      >
        {inputs.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `Micrófono ${i + 1}`}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red">{error}</span>}
    </span>
  );
}

/**
 * Antes de arrancar: qué micrófono usar (queda guardado; la sesión arranca con
 * él). Solo aparece si el navegador ya dio nombres — sin permiso de mic todos
 * se llaman igual y elegir a ciegas no sirve.
 */
export function MicPreferencePicker() {
  const inputs = useAudioInputs();
  const [value, setValue] = useState<string>("default");
  useEffect(() => setValue(readMicPref() ?? "default"), []);
  if (!inputs.some((d) => d.label)) return null;
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-text-faint">Micrófono</span>
    <select
      value={inputs.some((d) => d.deviceId === value) ? value : "default"}
      onChange={(e) => {
        setValue(e.target.value);
        saveMicPref(e.target.value === "default" ? null : e.target.value);
      }}
      className="h-7 max-w-[240px] min-w-0 cursor-pointer truncate rounded-sm border border-line bg-panel px-1.5 text-xs text-text hover:border-line-2"
    >
      {inputs.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || `Micrófono ${i + 1}`}
        </option>
      ))}
    </select>
    </label>
  );
}

const WARNING_TEXT: Record<MicWarning, string> = {
  muted: "El sistema silenció tu micrófono (otra app lo tomó o se desconectó): no te estoy oyendo.",
  ended: "Tu micrófono se desconectó: no te estoy oyendo.",
  silent: "La profe se oye, pero tu micrófono casi no tiene voz hace más de un minuto.",
  lopsided: "En los últimos minutos casi no te he transcrito: tu voz no está entrando bien.",
};

/**
 * El aviso de que tu voz no entra. Muestra qué micrófono se usa y deja
 * cambiarlo ahí mismo; los avisos medidos se pueden posponer ("Te oigo bien").
 */
export function MicWarningBanner({ compact = false }: { compact?: boolean }) {
  const live = useLiveMeeting();
  const w = live.micWarning;
  if (!w || live.phase !== "live") return null;
  const measured = w === "silent" || w === "lopsided";
  return (
    <div
      role="alert"
      className={`flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-red/30 bg-red/5 text-xs leading-snug text-text ${compact ? "px-2 py-1.5" : "px-3 py-2"}`}
    >
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-red" />
      <span className="min-w-0 flex-1">
        {WARNING_TEXT[w]}
        {!compact && live.mic && (
          <span className="text-text-dim">
            {" "}
            Usando «{live.mic.label}». ¿Hablas por otro micrófono (audífonos, el de Meet)? Cámbialo aquí.
          </span>
        )}
      </span>
      <MicPicker compact={compact} />
      {measured && (
        <Button variant="ghost" size="xs" onClick={live.dismissMicWarning}>
          Te oigo bien
        </Button>
      )}
    </div>
  );
}
