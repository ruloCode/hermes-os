"use client";

import { useEffect, useRef, useState } from "react";
import type { ClaudeExecConfig } from "@/lib/hermes";

/**
 * Modelos vigentes de Claude Code. Se guarda el ID COMPLETO (no el alias
 * `opus`/`sonnet`): el alias apunta siempre al último modelo, así que la
 * etiqueta se desactualiza sola en cuanto sale uno nuevo. Con el ID explícito,
 * lo que dice el botón es lo que corre.
 */
export const CLAUDE_MODELS = [
  { label: "Opus 5", value: "claude-opus-5" },
  { label: "Sonnet 5", value: "claude-sonnet-5" },
  { label: "Haiku 4.5", value: "claude-haiku-4-5" },
  { label: "Fable 5", value: "claude-fable-5" },
] as const;

export const CLAUDE_EFFORTS = [
  { label: "Bajo", value: "low" },
  { label: "Medio", value: "medium" },
  { label: "Alto", value: "high" },
  { label: "Muy alto", value: "xhigh" },
  { label: "Máx", value: "max" },
] as const;

export const CLAUDE_PERMISSIONS = [
  // "auto" = el modo con clasificador del CLI (Sonnet/Opus; con Haiku arranca en manual).
  { label: "Auto", value: "auto" },
  { label: "Auto-editar", value: "acceptEdits" },
  { label: "Plan (solo lee)", value: "plan" },
  { label: "Manual", value: "manual" },
] as const;

export const DEFAULT_CLAUDE_CONFIG: ClaudeExecConfig = {
  model: "claude-opus-5",
  effort: "high",
  permissionMode: "acceptEdits",
};

const labelOf = (
  list: ReadonlyArray<{ label: string; value: string }>,
  value: string,
): string => list.find((o) => o.value === value)?.label ?? value;

/** Nombre corto del modelo ("Opus 5") a partir de su ID, para avisos y chips. */
export const claudeModelLabel = (value: string): string => labelOf(CLAUDE_MODELS, value);

/**
 * Selector de ejecución de Claude Code (estilo la barra de model/effort del
 * propio Claude Code): Modelo + Esfuerzo + Permisos, más dos acciones —
 * abrir Terminal.app real o ejecutar en el panel embebido.
 */
export function ClaudeExecBar({
  config,
  onChange,
  onRun,
  disabled,
}: {
  config: ClaudeExecConfig;
  onChange: (cfg: ClaudeExecConfig) => void;
  onRun: (mode: "terminal" | "embedded") => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // El popover se cierra con clic fuera o Esc (sin robarle el Esc al composer
  // cuando está cerrado).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const ghost =
    "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs text-text-dim transition-colors hover:bg-hover hover:text-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

  // v5: vive DENTRO del composer, en su barra de herramientas (patrón del
  // selector de modelo de Claude/ChatGPT/Cursor). Los ajustes se abren en un
  // popover hacia arriba en vez de empujar la vista.
  return (
    <div ref={ref} className="relative flex min-w-0 items-center gap-0.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${ghost} min-w-0`}
        title="Configurar cómo se ejecuta en Claude Code"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden className="shrink-0 text-accent">
          <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
        </svg>
        <span className="truncate">
          {labelOf(CLAUDE_MODELS, config.model)}
          <span className="text-text-faint">
            {" "}
            · {labelOf(CLAUDE_EFFORTS, config.effort)} · {labelOf(CLAUDE_PERMISSIONS, config.permissionMode)}
          </span>
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="m6 15 6-6 6 6" />
        </svg>
      </button>

      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-line" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRun("embedded")}
        title="Ejecutar en Claude Code aquí, en la consola"
        className={ghost}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <path d="m7.5 9.5 2.8 2.5-2.8 2.5" />
        </svg>
        Consola
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onRun("terminal")}
        title="Abrir una Terminal.app real con claude corriendo"
        className={`${ghost} max-sm:hidden`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
        Terminal
      </button>

      {/* Controles */}
      {open && (
        <div
          role="dialog"
          aria-label="Ejecución de Claude Code"
          className="absolute bottom-full left-0 z-40 mb-2 w-[min(400px,calc(100vw-48px))] space-y-3 rounded-md border border-line bg-panel p-3 shadow-[var(--shadow-pop)]"
        >
          <div className="text-xs font-medium text-text">Ejecutar con Claude Code</div>
          <Field label="Modelo">
            <div className="flex flex-wrap gap-1">
              {CLAUDE_MODELS.map((m) => (
                <Segment
                  key={m.value}
                  active={config.model === m.value}
                  onClick={() => onChange({ ...config, model: m.value })}
                >
                  {m.label}
                </Segment>
              ))}
            </div>
          </Field>

          <Field label="Esfuerzo">
            <div className="flex flex-wrap gap-1">
              {CLAUDE_EFFORTS.map((e) => (
                <Segment
                  key={e.value}
                  active={config.effort === e.value}
                  onClick={() => onChange({ ...config, effort: e.value })}
                >
                  {e.label}
                </Segment>
              ))}
            </div>
          </Field>

          <div>
            <Field label="Permisos">
              <div className="flex flex-wrap gap-1">
                {CLAUDE_PERMISSIONS.map((p) => (
                  <Segment
                    key={p.value}
                    active={config.permissionMode === p.value}
                    onClick={() => onChange({ ...config, permissionMode: p.value })}
                  >
                    {p.label}
                  </Segment>
                ))}
              </div>
            </Field>
            {config.permissionMode === "manual" && (
              <p className="mt-1.5 pl-[76px] text-xs text-amber">
                “Manual” solo aplica en Terminal; en la consola (headless) equivale a “default”.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-[68px] shrink-0 pt-1 text-xs text-text-faint">{label}</span>
      {children}
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 cursor-pointer rounded-xs px-2 text-xs transition-colors ${
        active
          ? "bg-selected font-medium text-text ring-1 ring-line-2"
          : "text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}
