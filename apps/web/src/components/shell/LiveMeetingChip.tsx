"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/state/WorkspaceContext";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";

/**
 * Chip global del header: la junta EN VIVO sigue visible (con timer real)
 * desde cualquier vista/tab. Click → tab Reuniones (la vista en vivo es el
 * takeover de ese tab). Solo existe mientras hay junta — nada decorativo.
 */
export function LiveMeetingChip() {
  const live = useLiveMeeting();
  const ws = useWorkspace();
  const router = useRouter();

  // Tick local de 1 s solo mientras hay junta (el timer deriva de startedAt).
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live.active]);

  if (!live.active) return null;

  const elapsed = live.startedAt ? fmtLiveClock(Date.now() - live.startedAt) : null;

  // La clase de inglés vive en /ingles; la junta, en el tab Reuniones.
  const noun = live.isClass ? "Clase" : "Junta";
  let cls = "border-red/30 bg-red/10 text-red";
  let dot = true;
  let label: string = `${noun} en vivo`;
  if (live.phase === "processing") {
    cls = "border-accent/30 bg-accent/10 text-accent";
    dot = false;
    label = live.isClass ? "◈ Guardando clase" : "◈ Procesando junta";
  } else if (live.phase === "reconnecting") {
    cls = "border-amber/30 bg-amber/10 text-amber";
    label = `${noun} · reconectando`;
  } else if (live.phase === "requesting_mic" || live.phase === "connecting") {
    cls = "border-amber/30 bg-amber/10 text-amber";
    label = `${noun} · conectando`;
  } else if (live.phase === "stopping") {
    label = `${noun} · cerrando`;
  }

  return (
    <button
      type="button"
      onClick={() => (live.isClass ? router.push("/ingles") : ws.showPanel("reuniones"))}
      title={live.isClass ? "Ir a la clase en vivo" : "Ir a la junta en vivo"}
      className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-sm border px-2.5 text-xs font-medium whitespace-nowrap ${cls}`}
    >
      {dot && <span className="pulse-dot">●</span>}
      <span>{label}</span>
      {dot && elapsed && <span className="ml-auto tabular-nums">{elapsed}</span>}
    </button>
  );
}
