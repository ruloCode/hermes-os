"use client";

import { useEffect, useState } from "react";
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

  // Tick local de 1 s solo mientras hay junta (el timer deriva de startedAt).
  const [, tick] = useState(0);
  useEffect(() => {
    if (!live.active) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live.active]);

  if (!live.active) return null;

  const elapsed = live.startedAt ? fmtLiveClock(Date.now() - live.startedAt) : null;

  let cls = "border-red/60 bg-red/10 text-red";
  let dot = true;
  let label: string = "Junta en vivo";
  if (live.phase === "processing") {
    cls = "border-violet/60 bg-violet/10 text-violet";
    dot = false;
    label = "◈ Procesando junta";
  } else if (live.phase === "reconnecting") {
    cls = "border-amber/60 bg-amber/10 text-amber";
    label = "Junta · reconectando";
  } else if (live.phase === "requesting_mic" || live.phase === "connecting") {
    cls = "border-amber/60 bg-amber/10 text-amber";
    label = "Junta · conectando";
  } else if (live.phase === "stopping") {
    label = "Junta · cerrando";
  }

  return (
    <button
      type="button"
      onClick={() => ws.showPanel("reuniones")}
      title="Ir a la junta en vivo"
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs tracking-label uppercase ${cls}`}
    >
      {dot && <span className="pulse-dot">●</span>}
      <span>{label}</span>
      {dot && elapsed && <span className="tabular-nums">{elapsed}</span>}
    </button>
  );
}
