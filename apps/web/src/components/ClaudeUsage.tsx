"use client";

import { useEffect, useMemo, useState } from "react";
import { Panel } from "./Panel";
import type { ClaudeUsageData } from "@/lib/claude-usage";
import type { ClaudeLimits, LimitWindow } from "@/lib/claude-limits";

// Paleta HUD por modelo (mismo color en toda la fila).
const MODEL_COLORS = [
  "var(--violet)",
  "var(--cyan)",
  "var(--amber)",
  "var(--green)",
  "var(--blue)",
];

// Color por ventana de límite del plan (solo se muestran estas dos).
const LIMIT_COLORS: Record<string, string> = {
  "Sesión actual": "var(--violet)",
  "Todos los modelos": "var(--cyan)",
};

// Ventanas de límite que interesan, en orden: sesión de 5h + semanal global.
const KEEP_LIMITS = ["Sesión actual", "Todos los modelos"];

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

// `hero`: destaca la ventana de sesión (barra más alta, "% usado" grande),
// tal cual la referencia. La ventana semanal va en modo compacto.
function LimitBar({ w, hero = false }: { w: LimitWindow; hero?: boolean }) {
  const color = LIMIT_COLORS[w.label] ?? "var(--violet)";
  const pct = Math.round(w.utilization);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span
          className={`tracking-wide ${hero ? "text-[11px]" : "text-[10px]"}`}
          style={{ color: "var(--text)" }}
        >
          {w.label}
        </span>
        <span className="tabular-nums" style={{ color }}>
          <span
            className={`font-display font-bold ${hero ? "text-sm" : "text-[10px]"}`}
            style={{ textShadow: `0 0 12px ${color}55` }}
          >
            {pct}%
          </span>
          <span
            className={`ml-1 ${hero ? "text-[10px]" : "text-[9px]"}`}
            style={{ color: "var(--text-dim)" }}
          >
            usado
          </span>
        </span>
      </div>
      <div
        className={`mt-1 overflow-hidden ${hero ? "h-2.5" : "h-1.5"}`}
        style={{ background: "rgba(122,132,255,0.1)" }}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${Math.max(pct, 1)}%`, background: color }}
        />
      </div>
      {w.resetsAt && (
        <div
          className={`mt-1 tracking-wide ${hero ? "text-[10px]" : "text-[9px]"}`}
          style={{ color: "var(--text-dim)" }}
        >
          {formatReset(w.resetsAt)}
        </div>
      )}
    </div>
  );
}

function PlanLimits({ limits }: { limits: ClaudeLimits | null }) {
  if (!limits) return null;

  // Solo nos interesan "Sesión actual" y "Todos los modelos".
  const allModels = limits.weekly.find((w) => w.label === "Todos los modelos");

  return (
    <div className="mb-3 border-b pb-3" style={{ borderColor: "var(--line)" }}>
      <div className="mb-2 flex items-baseline justify-between">
        <span
          className="text-[9px] tracking-[0.24em] uppercase"
          style={{ color: "var(--text-dim)" }}
        >
          Límites de uso del plan
        </span>
        {limits.plan && (
          <span
            className="font-display text-[10px] font-bold tracking-wide"
            style={{ color: "var(--violet)" }}
          >
            {limits.plan}
          </span>
        )}
      </div>
      {!limits.available ? (
        <p
          className="text-[10px] leading-relaxed tracking-wide"
          style={{ color: "var(--text-dim)" }}
        >
          {limits.reason ?? "Sin datos de límites"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {limits.session && <LimitBar w={limits.session} hero />}
          {allModels && <LimitBar w={allModels} />}
        </div>
      )}
    </div>
  );
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

// Fila de tokens de una ventana temporal (Hoy / 7 días / 30 días).
function TokenLine({
  label,
  tokens,
  accent,
  hero = false,
}: {
  label: string;
  tokens: number;
  accent: string;
  hero?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between border-b py-2 last:border-b-0"
      style={{ borderColor: "var(--line)" }}
    >
      <span
        className="text-[10px] tracking-[0.22em] uppercase"
        style={{ color: "var(--text-dim)" }}
      >
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-display font-bold tracking-wider ${hero ? "text-2xl" : "text-base"}`}
          style={{ color: accent, textShadow: `0 0 14px ${accent}55` }}
        >
          {formatTokens(tokens)}
        </span>
        <span
          className="text-[9px] tracking-widest"
          style={{ color: "var(--text-dim)" }}
        >
          tokens
        </span>
      </div>
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

  const spark = useMemo(() => (data ? data.byDay.slice(-14) : []), [data]);
  const sparkMax = useMemo(
    () => Math.max(1, ...spark.map((d) => d.totalTokens)),
    [spark],
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
          className="text-[9px] tracking-[0.2em] tabular-nums"
          style={{ color: data?.available ? "var(--violet)" : "var(--text-dim)" }}
        >
          {data ? `${formatTokens(totalTokens)} tk` : "···"}
        </span>
      }
    >
      <PlanLimits limits={limits} />

      {errored && !data ? (
        <p className="text-[10px] tracking-widest" style={{ color: "var(--red)" }}>
          Sin conexión con /api/claude-usage
        </p>
      ) : !data ? (
        <p
          className="text-[10px] tracking-widest uppercase"
          style={{ color: "var(--text-dim)" }}
        >
          Cargando…
        </p>
      ) : !data.available ? (
        <p
          className="text-[10px] leading-relaxed tracking-wide"
          style={{ color: "var(--text-dim)" }}
        >
          {data.error ?? "No se encontró ~/.claude/projects"}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Tokens usados por ventana temporal */}
          <div>
            <TokenLine label="Hoy" tokens={data.today.totalTokens} accent="var(--violet)" hero />
            <TokenLine label="7 días" tokens={data.last7Days.totalTokens} accent="var(--cyan)" />
            <TokenLine label="30 días" tokens={data.last30Days.totalTokens} accent="var(--green)" />
          </div>

          {/* Sparkline: tokens por día (últimos 14) */}
          <div>
            <div
              className="mb-1 flex items-center justify-between text-[9px] tracking-[0.2em] uppercase"
              style={{ color: "var(--text-dim)" }}
            >
              <span>Tokens · 14d</span>
              <span className="tabular-nums">
                {formatTokens(data.last30Days.totalTokens)} / 30d
              </span>
            </div>
            <div className="flex h-8 items-end gap-[2px]">
              {spark.length === 0 ? (
                <span
                  className="text-[9px] tracking-widest"
                  style={{ color: "var(--text-dim)" }}
                >
                  sin actividad
                </span>
              ) : (
                spark.map((d) => (
                  <div
                    key={d.date}
                    className="flex-1"
                    title={`${d.date} · ${formatTokens(d.totalTokens)} tokens`}
                    style={{
                      height: `${Math.max((d.totalTokens / sparkMax) * 100, 3)}%`,
                      background:
                        "linear-gradient(180deg, var(--violet), rgba(167,139,250,0.15))",
                      boxShadow: "0 0 6px rgba(167,139,250,0.25)",
                    }}
                  />
                ))
              )}
            </div>
          </div>

          {/* Qué modelos: desglose por tokens */}
          <div className="flex flex-col gap-1.5">
            <div
              className="mb-0.5 text-[9px] tracking-[0.2em] uppercase"
              style={{ color: "var(--text-dim)" }}
            >
              Modelos
            </div>
            {models.map((m, i) => {
              const share = totalTokens > 0 ? (m.totalTokens / totalTokens) * 100 : 0;
              const color = MODEL_COLORS[i % MODEL_COLORS.length];
              return (
                <div key={m.model}>
                  <div className="flex items-center justify-between text-[10px]">
                    <span
                      className="flex items-center gap-1.5 tracking-wide"
                      style={{ color: "var(--text)" }}
                    >
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{ background: color }}
                      />
                      {shortModel(m.model)}
                    </span>
                    <span
                      className="tabular-nums"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {formatTokens(m.totalTokens)} tk
                    </span>
                  </div>
                  <div
                    className="mt-0.5 h-[3px] overflow-hidden"
                    style={{ background: "rgba(122,132,255,0.1)" }}
                  >
                    <div
                      className="h-full"
                      style={{ width: `${Math.max(share, 1)}%`, background: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
