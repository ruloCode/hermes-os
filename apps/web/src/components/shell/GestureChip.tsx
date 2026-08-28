"use client";

// Chip global del header: mientras el control por gestos está encendido, se
// ve desde cualquier vista (mismo contrato que LiveMeetingChip). Una cámara
// encendida moviendo TU cursor jamás debe ser un estado invisible. Click →
// apagar directo (el kill switch de UI, además del puño sostenido).

import { useGestureControl } from "@/state/GestureControlProvider";

export function GestureChip() {
  const g = useGestureControl();
  if (g.phase === "idle") return null;

  let cls = "border-cyan/60 bg-cyan/10 text-cyan";
  let label = "Gestos · activo";
  if (g.phase === "starting") {
    cls = "border-amber/60 bg-amber/10 text-amber";
    label = "Gestos · iniciando";
  } else if (g.phase === "error") {
    cls = "border-red/60 bg-red/10 text-red";
    label = "Gestos · error";
  } else if (g.accessibility === false) {
    cls = "border-amber/60 bg-amber/10 text-amber";
    label = "Gestos · sin permiso";
  } else if (g.pinching) {
    cls = "border-red/60 bg-red/10 text-red";
    label = "Gestos · pinza";
  } else if (!g.handVisible) {
    label = "Gestos · sin mano";
  }

  return (
    <button
      type="button"
      onClick={g.stop}
      title="Apagar el control por gestos"
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs tracking-label uppercase ${cls}`}
    >
      <span className={g.phase === "tracking" && g.handVisible ? "pulse-dot" : ""}>✋</span>
      <span>{label}</span>
    </button>
  );
}
