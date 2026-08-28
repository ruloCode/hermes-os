"use client";

// Chip global del header: mientras las manos sobre la UI están encendidas se
// ve desde cualquier vista (mismo contrato que GestureChip — una cámara
// encendida jamás debe ser un estado invisible). Click → apagar directo.

import { useUiHands } from "@/state/UiHandsProvider";

export function UiHandsChip() {
  const h = useUiHands();
  if (h.phase === "idle") return null;

  let cls = "border-cyan/60 bg-cyan/10 text-cyan";
  let label = "Manos · activo";
  if (h.phase === "starting") {
    cls = "border-amber/60 bg-amber/10 text-amber";
    label = "Manos · iniciando";
  } else if (h.phase === "error") {
    cls = "border-red/60 bg-red/10 text-red";
    label = "Manos · error";
  } else if (h.pinching) {
    cls = "border-red/60 bg-red/10 text-red";
    label = "Manos · pinza";
  } else if (!h.handVisible) {
    label = "Manos · sin mano";
  }

  return (
    <button
      type="button"
      onClick={h.stop}
      title="Apagar las manos sobre la UI"
      className={`flex items-center gap-1.5 rounded-sm border px-2 py-1 text-2xs tracking-label uppercase ${cls}`}
    >
      <span className={h.phase === "tracking" && h.handVisible ? "pulse-dot" : ""}>✋</span>
      <span>{label}</span>
    </button>
  );
}
