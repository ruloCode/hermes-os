"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PanelState } from "@/components/ui/PanelState";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { BarMeter } from "@/components/ui/BarMeter";
import { StatBlock } from "@/components/ui/StatBlock";
import { Sparkline } from "@/components/ui/Sparkline";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/components/ui/tones";
import type { ClaudeUsageData } from "@/lib/claude-usage";
import type { ClaudeLimits } from "@/lib/claude-limits";

// Tonos HUD por modelo (mismo tono en toda la fila del desglose).
const MODEL_TONES: Tone[] = ["violet", "cyan", "amber", "green", "blue"];

// "Se restablece en 4 h 31 min", igual que la vista /usage de Claude Code.
function formatReset(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = d.getTime() - Date.now();
  if (diff <= 0) return "Se restablece ahora";
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `Se restablece en ${mins} min`;
  if (mins < 60 * 24) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `Se restablece en ${h} h${m > 0 ? ` ${m} min` : ""}`;
  }
  return `Se restablece ${d.toLocaleString("es-ES", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function shortModel(model: string): string {
  return model.replace(/^claude-/, "");
}

// Límites del plan: gauge de la sesión de 5h + barra semanal global.
function PlanLimits({ limits }: { limits: ClaudeLimits | null }) {
  if (!limits) return null;

  // Solo interesan la sesión de 5h y la ventana semanal "Todos los modelos".
  const weekly = limits.weekly.find((w) => w.label === "Todos los modelos");

  return (
    <div className="mb-4 border-b border-line pb-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-2xs tracking-label text-text-dim uppercase">
          Límites del plan
        </span>
        {limits.plan && (
          <Badge tone="violet" size="sm">
            {limits.plan}
          </Badge>
        )}
      </div>

      {!limits.available ? (
        // Mensaje real del endpoint (p. ej. rate limit con reintento).
        <p className="text-xs leading-relaxed text-amber">
          {limits.reason ?? "Sin datos de límites"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {limits.session && (
            // El countdown va FUERA del gauge: dentro del círculo se
            // apretaba contra el arco en el ancho del riel.
            <div className="flex flex-col items-center gap-1.5">
              <RadialGauge
                value={Math.round(limits.session.utilization)}
                thresholds={{ warn: 70, danger: 90 }}
                label="sesión 5h"
                size={128}
                stroke={8}
              />
              {limits.session.resetsAt && (
                <span className="text-2xs tabular-nums text-text-faint">
                  {formatReset(limits.session.resetsAt)}
                </span>
              )}
            </div>
          )}
          {weekly && (
            // Label, barra y reset apilados: en el riel angosto el reset
            // en la misma línea que el label forzaba un wrap feo.
            <div className="flex flex-col gap-1.5">
              <span className="text-2xs tracking-label text-text-dim uppercase">
                {weekly.label}
              </span>
              <BarMeter
                value={Math.round(weekly.utilization)}
                segments={0}
                height={6}
                tone="cyan"
                thresholds={{ warn: 70, danger: 90 }}
              />
              {weekly.resetsAt && (
                <span className="text-2xs text-text-faint">
                  {formatReset(weekly.resetsAt)}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ClaudeUsage() {
  const [data, setData] = useState<ClaudeUsageData | null>(null);
  const [errored, setErrored] = useState(false);
  const [limits, setLimits] = useState<ClaudeLimits | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/claude-usage", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const fresh = (await res.json()) as ClaudeUsageData;
        if (!alive) return;
        setData(fresh);
        setErrored(false);
      } catch {
        if (alive) setErrored(true);
      }
    };
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // Límites del plan (endpoint separado: token OAuth en solo-lectura).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/claude-limits", { cache: "no-store" });
        const fresh = (await res.json()) as ClaudeLimits;
        if (alive) setLimits(fresh);
      } catch {
        /* endpoint caído → no rompemos el panel */
      }
    };
    void load();
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);

  // Sparkline: tokens por día de los últimos 14 días.
  const spark = useMemo(
    () => (data ? data.byDay.slice(-14).map((d) => d.totalTokens) : []),
    [data],
  );
  // Qué modelos: los más usados por tokens (no por coste).
  const models = useMemo(
    () =>
      data
        ? [...data.byModel]
            .sort((a, b) => b.totalTokens - a.totalTokens)
            .slice(0, 5)
        : [],
    [data],
  );
  const totalTokens = data?.totals.totalTokens ?? 0;

  return (
    <Panel
      title="Claude Usage"
      delay={90}
      right={
        <span
          className={`text-2xs tracking-label tabular-nums ${
            data?.available ? "text-violet" : "text-text-dim"
          }`}
        >
          {data ? `${formatTokens(totalTokens)} tk` : "···"}
        </span>
      }
    >
      <PlanLimits limits={limits} />

      {errored && !data ? (
        <PanelState
          kind="error"
          title="Sin conexión"
          hint="/api/claude-usage no responde"
          compact
        />
      ) : !data ? (
        <PanelState kind="loading" compact />
      ) : !data.available ? (
        <p className="text-xs leading-relaxed text-text-dim">
          {data.error ?? "No se encontró ~/.claude/projects"}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Tokens usados por ventana temporal (flex-wrap: en el sidebar
              angosto de pantallas anchas los bloques fluyen sin apretarse) */}
          <div className="flex flex-wrap gap-x-5 gap-y-2.5">
            <StatBlock
              label="Hoy"
              value={formatTokens(data.today.totalTokens)}
              unit="tk"
              tone="violet"
              size="md"
            />
            <StatBlock
              label="7 días"
              value={formatTokens(data.last7Days.totalTokens)}
              unit="tk"
              tone="cyan"
              size="md"
            />
            <StatBlock
              label="30 días"
              value={formatTokens(data.last30Days.totalTokens)}
              unit="tk"
              tone="green"
              size="md"
            />
          </div>

          {/* Sparkline: tokens por día (últimos 14) */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between text-2xs tracking-label text-text-dim uppercase">
              <span>Tokens · 14d</span>
              <span className="tabular-nums">
                {formatTokens(data.last30Days.totalTokens)} / 30d
              </span>
            </div>
            {spark.length === 0 ? (
              <p className="text-2xs tracking-label text-text-dim uppercase">
                Sin actividad
              </p>
            ) : (
              <div className="h-8 w-full">
                <Sparkline data={spark} height={32} tone="violet" fill />
              </div>
            )}
          </div>

          {/* Qué modelos: desglose por tokens */}
          <div className="flex flex-col gap-2 border-t border-line pt-3">
            <div className="text-2xs tracking-label text-text-dim uppercase">
              Modelos
            </div>
            {models.map((m, i) => (
              <div key={m.model} className="flex items-center gap-2">
                <span
                  className="w-24 shrink-0 truncate text-xs text-text"
                  title={m.model}
                >
                  {shortModel(m.model)}
                </span>
                <BarMeter
                  value={m.totalTokens}
                  max={totalTokens}
                  segments={0}
                  height={4}
                  tone={MODEL_TONES[i % MODEL_TONES.length]}
                  showValue={false}
                />
                <span className="shrink-0 font-display text-2xs tabular-nums text-text-dim">
                  {formatTokens(m.totalTokens)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
