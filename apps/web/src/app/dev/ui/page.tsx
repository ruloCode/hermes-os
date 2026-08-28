"use client";

// Galería de QA visual de los primitivos del design system (solo dev).
// No forma parte del dashboard: es el "storybook" casero para revisar
// tonos, tamaños y estados sin depender de datos reales.

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { PanelState } from "@/components/ui/PanelState";
import { SectionTitle } from "@/components/ui/SectionTitle";
import { StatusPill } from "@/components/ui/StatusPill";
import { Badge } from "@/components/ui/Badge";
import { CmdButton } from "@/components/ui/CmdButton";
import { SlashChip } from "@/components/ui/SlashChip";
import { TabBar } from "@/components/ui/TabBar";
import { Toggle } from "@/components/ui/Toggle";
import { RadialGauge } from "@/components/ui/RadialGauge";
import { Sparkline } from "@/components/ui/Sparkline";
import { BarMeter } from "@/components/ui/BarMeter";
import { AreaChartMini } from "@/components/ui/AreaChartMini";
import { StatBlock } from "@/components/ui/StatBlock";
import { DataRow } from "@/components/ui/DataRow";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Waveform } from "@/components/ui/Waveform";
import { DonutChart, type DonutSlice } from "@/components/ui/DonutChart";
import { CHART_OTHER, chartVar } from "@/components/ui/tones";
import { CategoryIcon } from "@/components/vida/categories";
import { LivePractice, type SessionWord } from "@/components/ingles/LivePractice";
import { LiveWordBank } from "@/components/ingles/LiveWordBank";
import { useVoice } from "@/components/VoiceBusyContext";
import type { VocabEntry } from "@hermes/shared";

const SPARK = [3, 5, 2, 8, 6, 9, 4, 7, 10, 6, 8, 12, 9, 11];
const AREA = [0, 2, 1, 4, 8, 3, 2, 6, 12, 9, 4, 2, 1, 0, 3, 7, 14, 10, 6, 4, 2, 5, 8, 3];

// Demo del donut: montos en miles, paleta chart-1..5 + cola gris.
const DONUT: DonutSlice[] = [
  ["mercado", 840, "12 movs"],
  ["restaurantes", 520, "8 movs"],
  ["transporte", 310, "9 movs"],
  ["vivienda", 280, "1 mov"],
  ["salud", 140, "2 movs"],
].map(([cat, value, sub], i) => ({
  key: String(cat),
  label: String(cat),
  value: Number(value),
  color: chartVar(i),
  icon: <CategoryIcon category={String(cat)} />,
  sub: String(sub),
}));
DONUT.push({
  key: "__resto",
  label: "otras (3)",
  value: 90,
  color: CHART_OTHER,
  icon: <CategoryIcon category="otros" />,
  sub: "5 movs",
});

export default function UiGallery() {
  const [tab, setTab] = useState("consola");
  const [on, setOn] = useState(true);

  return (
    <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
      <Panel title="RadialGauge" delay={0}>
        <div className="flex flex-wrap items-center gap-4">
          <RadialGauge value={78} label="Uso" sublabel="sesión 5h" />
          <RadialGauge value={68} tone="cyan" size={72} label="Proyecto" />
          <RadialGauge
            value={91}
            thresholds={{ warn: 70, danger: 90 }}
            size={72}
            label="Límite"
          />
        </div>
      </Panel>

      <Panel title="BarMeter" tone="cyan" delay={40}>
        <div className="flex flex-col gap-2">
          <BarMeter value={23} label="CPU" />
          <BarMeter value={45} label="RAM" tone="violet" />
          <BarMeter value={62} label="DISCO" thresholds={{ warn: 75, danger: 90 }} />
          <BarMeter value={88} label="ALERTA" thresholds={{ warn: 75, danger: 90 }} />
          <BarMeter value={62} label="CONTINUA" segments={0} />
        </div>
      </Panel>

      <Panel title="DonutChart" delay={60}>
        <div className="flex flex-wrap items-center justify-center gap-4">
          <DonutChart
            slices={DONUT}
            centerLabel="Gastado"
            centerValue="$2.180k"
            centerTone="red"
            format={(v) => `$${v}k`}
            ariaLabel="Demo de gastos por categoría"
          />
          <DonutChart
            slices={DONUT.slice(0, 1)}
            size={120}
            thickness={14}
            callouts={false}
            centerLabel="Única"
            centerValue="$840k"
          />
          <DonutChart slices={[]} size={120} thickness={14} callouts={false} emptyHint="sin datos" />
        </div>
      </Panel>

      <Panel title="Sparkline · AreaChart" delay={80}>
        <div className="flex flex-col gap-3">
          <Sparkline data={SPARK} fill />
          <Sparkline data={SPARK} tone="cyan" />
          <AreaChartMini data={AREA} labels={["00h", "24h"]} ariaLabel="Actividad 24h" />
        </div>
      </Panel>

      <Panel title="StatBlock · DataRow" delay={120}>
        <div className="mb-3 flex flex-wrap items-end gap-5">
          <StatBlock label="Costo hoy" value="$1.42" tone="violet" size="xl" spark={SPARK} />
          <StatBlock label="Ejecuciones" value={23} size="lg" trend={{ dir: "up", label: "+4" }} />
          <StatBlock label="Tokens" value="1.2M" unit="tok" tone="cyan" />
        </div>
        <DataRow label="Rama" value="main" tone="cyan" />
        <DataRow label="Último commit" value="hace 2 horas" />
        <DataRow label="Runs hoy" value={23} tone="violet" />
      </Panel>

      <Panel title="Pills · Badges" delay={160}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <StatusPill status="active" pulse />
          <StatusPill status="paused" />
          <StatusPill status="ok" label="DB SYNC" />
          <StatusPill status="warn" />
          <StatusPill status="error" />
          <StatusPill status="idle" size="sm" />
          <StatusPill status="offline" size="sm" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="red" variant="solid">Alta</Badge>
          <Badge tone="amber" variant="solid">Media</Badge>
          <Badge tone="blue" variant="solid">Baja</Badge>
          <Badge tone="violet">opus</Badge>
          <Badge tone="cyan">12 tareas</Badge>
          <Badge size="sm">neutral</Badge>
        </div>
      </Panel>

      <Panel title="Controles" delay={200}>
        <div className="flex flex-col gap-3">
          <TabBar
            tabs={[
              { id: "voz", label: "voz en vivo" },
              { id: "consola", label: "consola" },
              { id: "tareas", label: "tareas", badge: 3 },
              { id: "memoria", label: "memoria" },
            ]}
            active={tab}
            onChange={setTab}
          />
          <div className="flex flex-wrap gap-2">
            <CmdButton onClick={() => {}}>Pulse Check</CmdButton>
            <CmdButton variant="solid" onClick={() => {}}>Resumen del día</CmdButton>
            <CmdButton variant="danger" size="sm" onClick={() => {}}>Cancelar</CmdButton>
            <CmdButton loading onClick={() => {}}>Cargando</CmdButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <SlashChip command="/resumen diario" description="Brief del día" onClick={() => {}} />
            <SlashChip command="/analizar proyecto" onClick={() => {}} active />
            <SlashChip command="/crear tarea" onClick={() => {}} disabled description="Requiere foco" />
          </div>
          <div className="flex gap-5">
            <Toggle checked={on} onChange={setOn} label="Backup diario" />
            <Toggle checked={!on} onChange={(v) => setOn(!v)} label="Reportes" size="sm" />
            <Toggle checked disabled onChange={() => {}} label="Bloqueado" />
          </div>
        </div>
      </Panel>

      <Panel title="Panel variantes" variant="hero" delay={240}>
        <div className="grid grid-cols-2 gap-2">
          <Panel title="Ghost" variant="ghost" padding="sm">
            <p className="text-xs text-text-dim">Sub-sección sin borde.</p>
          </Panel>
          <Panel title="Alerta" variant="alert" tone="red" padding="sm">
            <p className="text-xs text-red">Borde teñido de estado.</p>
          </Panel>
        </div>
        <div className="mt-2">
          <SectionTitle tone="cyan" right={<Badge tone="cyan" size="sm">right</Badge>}>
            SectionTitle
          </SectionTitle>
        </div>
      </Panel>

      <Panel title="PanelState" delay={280}>
        <div className="grid grid-cols-2 gap-2">
          <PanelState kind="loading" compact />
          <PanelState kind="empty" compact />
          <PanelState kind="offline" compact hint="Revisa el agente en :8650" />
          <PanelState kind="error" compact retry={() => {}} />
        </div>
      </Panel>

      <Panel title="Waveform · ScrollArea" delay={320}>
        <div className="flex flex-col gap-3">
          <Waveform live bars={28} />
          <Waveform live={false} bars={28} />
          <ScrollArea className="h-24 border border-line p-2">
            {Array.from({ length: 20 }, (_, i) => (
              <p key={i} className="py-0.5 text-xs text-text-dim">
                Línea de contenido scrolleable {i + 1}
              </p>
            ))}
          </ScrollArea>
        </div>
      </Panel>

      <LivePracticeDemo />
    </main>
  );
}

// QA de la práctica en vivo del tutor (/ingles): mismas líneas que produciría
// la llamada real (pushLine del VoiceBusyContext), goteadas para ver el
// autoscroll, el KARAOKE de la frase vigente (sin llamada real la animación
// estimada corre sola) y el tap de palabras → banco de la sesión, sin
// conectar ElevenLabs. Ojo: los taps sí hacen POST /english/vocab real.
const DEMO_LINES: { who: "TÚ" | "TUTOR"; text: string }[] = [
  { who: "TUTOR", text: "Hi! Great to see you again. Last time we worked on prepositions — ready to pick it up?" },
  { who: "TÚ", text: "Yes, I want to talk about my project. I've been working on the memory system." },
  { who: "TUTOR", text: "Nice — you said \"working on\", that's exactly the correction from last session. Tell me more: what makes the memory system hard?" },
  { who: "TÚ", text: "The most important part is storing the conversations without losing information." },
  { who: "TUTOR", text: "Excellent use of \"the most important\"! Let's push further: compare it with your previous approach using easier / harder — was it more cumbersome or more straightforward?" },
];

// Vocab de mentira: pinta el subrayado violeta de "ya en el banco" en el
// transcript ("prepositions") y la cola "repasa hoy" del LiveWordBank.
const DEMO_VOCAB: VocabEntry[] = [
  {
    id: 1,
    term: "prepositions",
    meaning_es: "preposiciones (in/on/at…)",
    example: "I've been working ON this project.",
    times_reviewed: 1,
    last_reviewed_at: null,
    learned: false,
  },
];

function LivePracticeDemo() {
  const { pushLine, clearTranscript } = useVoice();
  const [running, setRunning] = useState(false);
  const [words, setWords] = useState<SessionWord[]>([]);

  const simulate = () => {
    if (running) return;
    setRunning(true);
    clearTranscript();
    setWords([]);
    DEMO_LINES.forEach((l, i) =>
      setTimeout(() => {
        pushLine(l);
        if (i === DEMO_LINES.length - 1) setRunning(false);
      }, 1800 * (i + 1)),
    );
  };

  return (
    <Panel
      title="LivePractice (práctica en vivo del tutor: karaoke + banco)"
      delay={360}
      className="h-[460px]"
      right={
        <CmdButton size="sm" onClick={simulate} disabled={running} loading={running}>
          Simular conversación
        </CmdButton>
      }
    >
      <div className="grid h-full min-h-0 grid-cols-3 gap-3">
        <div className="col-span-2 min-h-0">
          <LivePractice
            connecting={false}
            vocab={DEMO_VOCAB}
            onWordSaved={(w) =>
              setWords((prev) => (prev.some((x) => x.term === w.term) ? prev : [w, ...prev]))
            }
          />
        </div>
        <div className="min-h-0 border-l border-line pl-3">
          <LiveWordBank words={words} vocab={DEMO_VOCAB} onChanged={() => undefined} />
        </div>
      </div>
    </Panel>
  );
}
