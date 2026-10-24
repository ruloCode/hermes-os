"use client";

import { useCallback, useEffect, useState } from "react";
import { isVirtualMic, micDisplayName, type MicDeviceInfo } from "@hermes/shared";
import { useLiveMeeting } from "@/state/LiveMeetingProvider";

// Alias de Chrome para el predeterminado del sistema: repiten un mic de la lista.
const ALIAS_IDS = new Set(["default", "communications"]);

/**
 * Qué micrófono escucha la junta/clase, cambiable en caliente (la sesión del
 * STT sigue). La elección se recuerda para la próxima. Los drivers virtuales
 * (Teams, Zoom) salen marcados: como entrada entregan silencio.
 */
export function MicPicker({ className = "" }: { className?: string }) {
  const live = useLiveMeeting();
  const { listMics, switchMic, micLabel } = live;
  const [mics, setMics] = useState<MicDeviceInfo[]>([]);

  const refresh = useCallback(() => {
    void listMics()
      .then((all) => setMics(all.filter((m) => !ALIAS_IDS.has(m.deviceId) && m.label)))
      .catch(() => setMics([]));
  }, [listMics]);

  useEffect(() => {
    refresh();
    // Conectaste unos audífonos a media clase: aparecen sin recargar.
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, [refresh]);

  if (!micLabel) return null;
  const current = mics.find((m) => micDisplayName(m.label) === micLabel)?.deviceId ?? "";

  return (
    <select
      aria-label="Micrófono"
      title={`Micrófono: ${micLabel}`}
      value={current}
      onChange={(e) => e.target.value && void switchMic(e.target.value)}
      className={`h-7 max-w-48 cursor-pointer truncate rounded-sm border border-line bg-panel px-2 text-xs text-text transition-colors hover:border-line-2 focus:border-accent focus:outline-none ${className}`}
    >
      {!current && <option value="">{micLabel}</option>}
      {mics.map((m) => (
        <option key={m.deviceId} value={m.deviceId}>
          {micDisplayName(m.label)}
          {isVirtualMic(m.label) ? " (virtual: sin voz)" : ""}
        </option>
      ))}
    </select>
  );
}
