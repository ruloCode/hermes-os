"use client";

/**
 * Modal de confirmación del ESTUDIO — para acciones que salen de la casa o
 * deshacen trabajo (publicar, mover de etapa). Patrones Mobbin: Kajabi
 * ("Everything look good?" — resumen de lo que va a pasar + nota de
 * irreversibilidad antes del botón) · beehiiv ("Review and publish" — el botón
 * de confirmar lleva la FECHA en el label, no un "OK" genérico).
 *
 * Lleva `data-estudio-takeover` para que el Esc del takeover de la pieza ceda:
 * Esc cierra el modal, no la pieza (mismo contrato que RecordMode).
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { btnCls } from "./styles";

/** Clases ESTÁTICAS por tono (Tailwind purga las interpoladas). v5: el
 *  confirmar normal es el botón primario (índigo sólido); verde/ámbar/rojo
 *  quedan para cuando la consecuencia ES un estado (publicar, devolver, borrar). */
const CONFIRM_TONE: Record<string, string> = {
  accent: "border-transparent bg-accent-solid text-on-accent hover:brightness-110",
  green: "border-green bg-green/15 text-green hover:bg-green/25",
  amber: "border-amber bg-amber/15 text-amber hover:bg-amber/25",
  red: "border-red bg-red/15 text-red hover:bg-red/25",
};

export function ConfirmModal({
  title,
  confirmLabel,
  tone = "accent",
  disabled = false,
  busy = false,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  /** Específico, nunca "Aceptar": "Subir a YouTube" · "Devolver a Guion". */
  confirmLabel: string;
  tone?: "accent" | "green" | "amber" | "red";
  disabled?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    // Captura: gana antes que el Esc del takeover de la pieza.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      data-estudio-takeover
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-md border border-line-2 bg-panel shadow-[var(--shadow-pop)]"
      >
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-medium text-text">{title}</h3>
        </div>
        <div className="flex flex-col gap-2 px-4 py-3">{children}</div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2.5">
          <button onClick={onClose} className={btnCls}>
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={disabled || busy}
            className={`h-7 cursor-pointer rounded-sm border px-3 text-xs font-medium transition-colors ${
              disabled || busy ? "cursor-not-allowed opacity-40" : ""
            } ${CONFIRM_TONE[tone]}`}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
