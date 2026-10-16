"use client";

import type { ReactNode } from "react";

// Estados de panel unificados: antes cada componente resolvía
// "cargando / offline / vacío / error" con texto ad-hoc; esto los
// estandariza (mismo tono, mismos tamaños legibles).

const ICON: Record<"offline" | "empty" | "error", ReactNode> = {
  offline: (
    <path d="M2 8.8a15 15 0 0 1 20 0M5 12.6a10 10 0 0 1 5.2-2.7M16.8 11.4a10 10 0 0 1 2.2 1.2M8.5 16.2a5 5 0 0 1 7 0M12 20h.01M3 3l18 18" />
  ),
  empty: <path d="M4 13.5 6.5 6h11l2.5 7.5V18a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM4 13.5h5l1 2h4l1-2h5" />,
  error: <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />,
};

export function PanelState({
  kind,
  title,
  hint,
  retry,
  icon,
  action,
  compact = false,
}: {
  kind: "loading" | "offline" | "empty" | "error";
  title?: string;
  hint?: string;
  retry?: () => void;
  /** Icono propio (svg de 24×24 con trazo). Por defecto, uno por `kind`. */
  icon?: ReactNode;
  /** Qué hacer ahora: un vacío sin siguiente paso es un callejón. */
  action?: ReactNode;
  compact?: boolean;
}) {
  if (kind === "loading") {
    return (
      <div
        className={`flex flex-col gap-2 ${compact ? "py-2" : "py-4"}`}
        role="status"
        aria-label={title ?? "Cargando"}
      >
        <div className="skeleton h-3 w-3/4" />
        <div className="skeleton h-3 w-1/2" />
        {!compact && <div className="skeleton h-3 w-2/3" />}
      </div>
    );
  }

  const label = {
    offline: "Agente desconectado",
    empty: "Sin datos todavía",
    error: "Algo falló",
  }[kind];
  const tone = kind === "empty" ? "text-text-faint" : "text-red";

  // Compacto (rieles, listas cortas): solo texto — el círculo con icono pesa
  // demasiado dentro de una columna de 260px.
  if (compact) {
    return (
      <div className="flex flex-col gap-1 px-2 py-3">
        <p className={`text-sm ${kind === "empty" ? "text-text-dim" : "text-red"}`}>
          {title ?? label}
        </p>
        {hint && <p className="text-xs text-text-faint">{hint}</p>}
        {(retry || action) && (
          <div className="mt-1 flex gap-2">
            {action}
            {retry && <RetryButton onClick={retry} />}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-8 text-center">
      <span
        aria-hidden
        className={`mb-1.5 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel-2 ${tone}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          {icon ?? ICON[kind]}
        </svg>
      </span>
      <p className="text-sm font-medium text-text">{title ?? label}</p>
      {hint && <p className="max-w-[40ch] text-xs text-text-faint">{hint}</p>}
      {(retry || action) && (
        <div className="mt-2 flex items-center gap-2">
          {action}
          {retry && <RetryButton onClick={retry} />}
        </div>
      )}
    </div>
  );
}

function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-7 cursor-pointer rounded-xs border border-line px-2.5 text-xs text-text-dim transition-colors hover:border-line-2 hover:bg-hover hover:text-text"
    >
      Reintentar
    </button>
  );
}
