"use client";

/**
 * Hoja modal del Playground (importar, aplicar a canción). Portal a <body>,
 * Esc en CAPTURA — gana antes que el Esc de la pantalla de atrás, así cierra
 * la hoja y no la sesión — y ⌘⏎ confirma. `data-composicion-modal` hace que
 * los atajos sueltos de la pantalla de atrás esperen mientras está abierta.
 *
 * Foco de un diálogo modal de verdad (`aria-modal` sin esto mentía): al abrir
 * va al primer control del cuerpo (o al que un hijo ya enfocó con autoFocus),
 * Tab y ⇧Tab dan la vuelta DENTRO de la hoja, y al cerrar vuelve a donde
 * estaba (el botón que la abrió).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Los controles enfocables y visibles de `root`, en orden de tabulación del DOM. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.closest("[inert]") && el.getClientRects().length > 0,
  );
}

export function Sheet({
  title,
  width = 560,
  onClose,
  onConfirm,
  footer,
  children,
}: {
  title: string;
  width?: number;
  onClose: () => void;
  /** ⌘⏎. Omitir si la acción todavía no se puede confirmar. */
  onConfirm?: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && onConfirm) {
        e.preventDefault();
        onConfirm();
      } else if (e.key === "Tab" && dialogRef.current) {
        // Trampa de foco: Tab al final vuelve al primero, ⇧Tab al principio va al último.
        const list = focusables(dialogRef.current);
        if (!list.length) {
          e.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = list[0];
        const last = list[list.length - 1];
        const cur = document.activeElement as HTMLElement | null;
        const inside = !!cur && dialogRef.current.contains(cur);
        if (e.shiftKey && (!inside || cur === first || cur === dialogRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (!inside || cur === last)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, onConfirm]);

  // Foco al abrir (primer control del cuerpo; si no hay, el primero de la hoja) y de vuelta al cerrar.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    // Un hijo con autoFocus ya lo tomó (React lo aplica antes de los efectos): se respeta.
    if (dialog && !dialog.contains(document.activeElement)) {
      const target = (bodyRef.current && focusables(bodyRef.current)[0]) ?? focusables(dialog)[0] ?? dialog;
      target.focus({ preventScroll: true });
    }
    return () => {
      // Solo si el foco sigue en la hoja (o se perdió al desmontarla): no robarlo si ya se fue a otro lado.
      const now = document.activeElement;
      if (opener && opener.isConnected && (!now || now === document.body || dialog?.contains(now))) opener.focus({ preventScroll: true });
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      data-composicion-modal
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        className="flex max-h-[88vh] flex-col overflow-hidden rounded-md border border-line bg-panel shadow-[var(--shadow-pop)] outline-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h3 className="text-sm font-medium text-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="cursor-pointer rounded-sm px-1.5 text-text-faint hover:text-text"
          >
            ✕
          </button>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}
