"use client";

import { useState } from "react";
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

  return (
    <div className="mt-2 rounded-sm border border-line">
      {/* Barra resumen + acciones */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-2xs tracking-[0.18em] text-violet uppercase"
          title="Configurar cómo se ejecuta en Claude Code"
        >
          <span>⚡ Claude Code</span>
          <span className="text-text-dim">
            {labelOf(CLAUDE_MODELS, config.model)} · {labelOf(CLAUDE_EFFORTS, config.effort)} ·{" "}
            {labelOf(CLAUDE_PERMISSIONS, config.permissionMode)}
          </span>
          <span className="text-text-dim">{open ? "▴" : "▾"}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRun("terminal")}
            title="Abrir una Terminal.app real con claude corriendo"
            className="rounded-sm border border-line-2 px-2 py-1 text-2xs tracking-[0.15em] text-text uppercase transition-colors disabled:opacity-40"
          >
            ▶ Terminal
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRun("embedded")}
            title="Ejecutar aquí, en el panel embebido"
            className="rounded-sm bg-violet/15 px-2 py-1 text-2xs tracking-[0.15em] text-violet-hot uppercase transition-colors disabled:opacity-40"
          >
            ▣ Panel
          </button>
        </div>
      </div>

      {/* Controles */}
      {open && (
        <div className="space-y-2 border-t border-line px-2 py-2">
          <Field label="Modelo">
            <div className="flex gap-1">
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
            <div className="flex gap-1">
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
              <div className="flex gap-1">
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
              <p className="mt-1 pl-[72px] text-2xs tracking-[0.1em] text-amber">
                “Manual” solo aplica en ▶ Terminal; en ▣ Panel (headless) equivale a “default”.
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
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-2xs tracking-label text-text-dim uppercase">
        {label}
      </span>
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
      className={`rounded-sm px-1.5 py-0.5 text-2xs tracking-[0.1em] transition-colors ${
        active
          ? "bg-cyan/15 text-cyan inset-ring inset-ring-cyan"
          : "bg-transparent text-text-dim inset-ring inset-ring-line"
      }`}
    >
      {children}
    </button>
  );
}
