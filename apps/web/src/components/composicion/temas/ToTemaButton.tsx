"use client";

/**
 * "Llevar a un Tema" (desde Sesiones): crea un tema con ese pasaje como
 * tarareo — el agente lo prellena con la tonalidad medida y el bpm aproximado —
 * y cambia a Temas con él abierto. Fuera de TemasProvider no se dibuja.
 */
import { useState } from "react";
import type { MemoRef } from "@hermes/shared";
import { btn } from "../playground/ui";
import { useTemasMaybe } from "./TemasProvider";

export function ToTemaButton({ memo, title, onLeave }: { memo: MemoRef; title?: string; onLeave?: () => void }) {
  const temas = useTemasMaybe();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!temas) return null;
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={btn}
        disabled={busy}
        title="Crea un tema con este pasaje como tarareo (tonalidad medida, bpm aproximado)"
        onClick={async () => {
          setBusy(true);
          setErr(null);
          const r = await temas.fromPassage(memo, title);
          setBusy(false);
          if ("tema" in r) onLeave?.();
          else setErr(`No se pudo crear el tema: ${r.error}`);
        }}
      >
        {busy ? "Creando tema…" : "Llevar a un Tema"}
      </button>
      {err && <span className="text-xs text-red">{err}</span>}
    </span>
  );
}
