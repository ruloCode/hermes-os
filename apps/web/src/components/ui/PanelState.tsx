"use client";

// Estados de panel unificados: antes cada componente resolvía
// "cargando / offline / vacío / error" con texto ad-hoc; esto los
// estandariza (mismo tono, mismos tamaños legibles).

export function PanelState({
  kind,
  title,
  hint,
  retry,
  compact = false,
}: {
  kind: "loading" | "offline" | "empty" | "error";
  title?: string;
  hint?: string;
  retry?: () => void;
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

  const defaults = {
    offline: { glyph: "◌", label: "Agente desconectado", tone: "var(--color-red)" },
    empty: { glyph: "◇", label: "Sin datos todavía", tone: "var(--color-text-dim)" },
    error: { glyph: "△", label: "Algo falló", tone: "var(--color-red)" },
  } as const;
  const d = defaults[kind];

  return (
    <div
      className={`flex flex-col items-center justify-center gap-1.5 text-center ${compact ? "py-3" : "py-6"}`}
    >
      <span aria-hidden className="text-lg" style={{ color: d.tone, opacity: 0.8 }}>
        {d.glyph}
      </span>
      <p className="text-xs tracking-label uppercase" style={{ color: d.tone }}>
        {title ?? d.label}
      </p>
      {hint && <p className="max-w-[26ch] text-2xs text-text-dim">{hint}</p>}
      {retry && (
        <button
          type="button"
          onClick={retry}
          className="mt-1 border border-line px-2.5 py-1 text-2xs tracking-label text-text-dim uppercase transition-colors hover:border-line-2 hover:text-text"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
