"use client";

// Anillo "SISTEMA" del header (referencia): porcentaje de checks REALES
// pasados — agente local vivo, Supabase sync, SSE conectado y voz
// configurada. Nada de 100% fingido; el tooltip desglosa qué falla.

import { useHermesData } from "@/hooks/useHermesData";
import { useAgentEvents } from "@/hooks/useAgentEvents";
import { RadialGauge } from "@/components/ui/RadialGauge";

export function SystemRing() {
  const { stats, online } = useHermesData();
  const { connected } = useAgentEvents();
  const voiceConfigured = Boolean(process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID);

  const checks: { label: string; ok: boolean }[] = [
    { label: "agente local", ok: online },
    { label: "supabase sync", ok: Boolean(stats?.supabase) },
    { label: "eventos en vivo (SSE)", ok: connected },
    { label: "voz configurada", ok: voiceConfigured },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const pct = Math.round((passed / checks.length) * 100);
  const detail = checks.map((c) => `${c.ok ? "●" : "○"} ${c.label}`).join("\n");

  return (
    <div
      className="flex items-center gap-2"
      title={`Salud del sistema: ${passed}/${checks.length}\n${detail}`}
    >
      <RadialGauge
        value={pct}
        size={46}
        stroke={5}
        tone={pct === 100 ? "green" : pct >= 50 ? "amber" : "red"}
        thresholds={undefined}
        showValue
        format={(v) => `${Math.round(v)}%`}
      />
      <div className="hidden text-right leading-tight min-[1500px]:block">
        <p className="text-2xs tracking-label text-text-dim uppercase">sistema</p>
        <p
          className={`text-2xs tracking-label uppercase ${
            pct === 100 ? "text-green" : pct >= 50 ? "text-amber" : "text-red"
          }`}
        >
          {pct === 100 ? "online" : pct >= 50 ? "degradado" : "caído"}
        </p>
      </div>
    </div>
  );
}
