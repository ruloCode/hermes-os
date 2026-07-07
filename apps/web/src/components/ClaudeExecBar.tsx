"use client";

import { useState } from "react";
import type { ClaudeExecConfig } from "@/lib/hermes";

export const CLAUDE_MODELS = [
  { label: "Opus 4.8", value: "opus" },
  { label: "Sonnet", value: "sonnet" },
  { label: "Haiku", value: "haiku" },
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
  model: "opus",
  effort: "high",
  permissionMode: "acceptEdits",
};

const labelOf = (
  list: ReadonlyArray<{ label: string; value: string }>,
  value: string,
): string => list.find((o) => o.value === value)?.label ?? value;

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
    <div className="mt-2 rounded-sm border" style={{ borderColor: "var(--line)" }}>
      {/* Barra resumen + acciones */}
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[9px] tracking-[0.18em] uppercase"
          style={{ color: "var(--violet)" }}
          title="Configurar cómo se ejecuta en Claude Code"
        >
          <span>⚡ Claude Code</span>
          <span style={{ color: "var(--text-dim)" }}>
            {labelOf(CLAUDE_MODELS, config.model)} · {labelOf(CLAUDE_EFFORTS, config.effort)} ·{" "}
            {labelOf(CLAUDE_PERMISSIONS, config.permissionMode)}
          </span>
          <span style={{ color: "var(--text-dim)" }}>{open ? "▴" : "▾"}</span>
        </button>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRun("terminal")}
            title="Abrir una Terminal.app real con claude corriendo"
            className="rounded-sm border px-2 py-1 text-[9px] tracking-[0.15em] uppercase transition-colors disabled:opacity-40"
            style={{ borderColor: "var(--line-bright)", color: "var(--text)" }}
          >
            ▶ Terminal
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRun("embedded")}
            title="Ejecutar aquí, en el panel embebido"
            className="rounded-sm px-2 py-1 text-[9px] tracking-[0.15em] uppercase transition-colors disabled:opacity-40"
            style={{ background: "rgba(167,139,250,0.16)", color: "var(--violet-hot)" }}
          >
            ▣ Panel
          </button>
        </div>
      </div>

      {/* Controles */}
      {open && (
        <div className="space-y-2 border-t px-2 py-2" style={{ borderColor: "var(--line)" }}>
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
              <p className="mt-1 pl-[72px] text-[8px] tracking-[0.1em]" style={{ color: "var(--amber)" }}>
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
      <span
        className="w-16 shrink-0 text-[8.5px] tracking-[0.2em] uppercase"
        style={{ color: "var(--text-dim)" }}
      >
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
      className="rounded-sm px-1.5 py-0.5 text-[9px] tracking-[0.1em] transition-colors"
      style={{
        background: active ? "rgba(103,232,249,0.14)" : "transparent",
        color: active ? "var(--cyan)" : "var(--text-dim)",
        boxShadow: active ? "inset 0 0 0 1px var(--cyan)" : "inset 0 0 0 1px var(--line)",
      }}
    >
      {children}
    </button>
  );
}
