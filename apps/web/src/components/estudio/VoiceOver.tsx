"use client";

/**
 * Piezas compartidas de la VOZ EN OFF: el micrófono elegido, la grabación de
 * UNA toma y el medidor de nivel.
 *
 * Las usan dos superficies con la misma semántica: el tab **Voz**
 * (`VoiceTab.tsx`, la grabadora completa) y el **teleprompter** (`RecordMode`,
 * tecla R mientras lees). El contrato de nombres vive en un solo lugar: la UI
 * manda el `stem` del bloque y el agente pone `-vo[-N].wav` en `assets/`.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { PieceMediaFile } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { useMediaRecorder, type MeterState } from "@/hooks/useMediaRecorder";

const MIC_KEY = "hermes.estudio.vo.device";

/** Micrófono elegido (persistente entre sesiones: el USB no se re-elige cada vez). */
export function useVoiceMic(): [string | null, (id: string | null) => void] {
  const [deviceId, setDeviceId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDeviceId(window.localStorage.getItem(MIC_KEY));
    } catch {
      /* modo privado */
    }
  }, []);
  const set = useCallback((id: string | null) => {
    setDeviceId(id);
    try {
      if (id) window.localStorage.setItem(MIC_KEY, id);
      else window.localStorage.removeItem(MIC_KEY);
    } catch {
      /* modo privado */
    }
  }, []);
  return [deviceId, set];
}

/**
 * Grabación de UNA toma de voz en off: arranca el mic (crudo, sin cancelación
 * de eco ni AGC), la detiene y la sube con el stem del bloque. Detener SIEMPRE
 * guarda — descartar es un acto aparte (`cancel`).
 */
export function useVoiceOverTake(pieceId: number) {
  const { saveVoiceover } = useEstudioContext();
  const [deviceId] = useVoiceMic();
  const rec = useMediaRecorder({ raw: true, meter: true, deviceId });
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  /** Pico captado en la última toma: ~0 = el mic no escuchó nada. */
  const [lastPeak, setLastPeak] = useState<number | null>(null);

  const start = useCallback(
    async (stem: string) => {
      setError(null);
      setLastSaved(null);
      const ok = await rec.start();
      if (ok) setTarget(stem);
      return ok;
    },
    [rec],
  );

  /** Detiene, sube y devuelve el archivo guardado (null si no hubo audio). */
  const finish = useCallback(async (): Promise<PieceMediaFile | null> => {
    const stem = target;
    setTarget(null);
    const { blob, peak } = await rec.stop();
    setLastPeak(peak);
    if (!stem || !blob) return null;
    setSaving(true);
    const r = await saveVoiceover(pieceId, stem, blob);
    setSaving(false);
    if ("error" in r && r.error) {
      setError(r.error);
      return null;
    }
    const file = "file" in r ? (r.file ?? null) : null;
    if (file) setLastSaved(file.name);
    if ("transcoded" in r && r.transcoded === false)
      setError("Guardado sin convertir (ffmpeg no respondió): quedó en el formato del browser.");
    return file;
  }, [pieceId, rec, saveVoiceover, target]);

  const cancel = useCallback(() => {
    setTarget(null);
    rec.cancel();
  }, [rec]);

  return {
    ...rec,
    /** Bloque que se está grabando ahora mismo (null = nada corriendo). */
    target,
    saving,
    error: error ?? rec.error,
    lastSaved,
    lastPeak,
    start,
    finish,
    cancel,
  };
}

/**
 * Barra de nivel del micrófono: sin esto no se sabe si el mic está vivo.
 * Se anima escribiendo el DOM desde su propio rAF (el nivel viaja por ref):
 * el teleprompter no se re-renderiza por una barrita.
 */
export function MicLevel({
  meterRef,
  active,
  className = "",
}: {
  meterRef: RefObject<MeterState>;
  active: boolean;
  className?: string;
}) {
  const barRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (barRef.current)
        barRef.current.style.width = `${Math.round(Math.min(1, meterRef.current.level) * 100)}%`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, meterRef]);

  return (
    <span
      className={`inline-block h-1 w-16 shrink-0 overflow-hidden rounded-full bg-line ${className}`}
      aria-hidden
    >
      <span ref={barRef} className="block h-full w-0 rounded-full bg-red" />
    </span>
  );
}
