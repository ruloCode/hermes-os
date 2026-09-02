"use client";

/**
 * Riel de Composición: el hábito por encima del talento. Ritual del día
 * (4 cosas de 15 min que no dependen de la inspiración), racha de escritura
 * (mock: en producción se engancha al hábito "Componer" como /ingles),
 * qué canción toca hoy y los principios de la casa — el factor humano
 * escrito, para que Hermes y tú lo tengan enfrente.
 */
import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatBlock } from "@/components/ui/StatBlock";
import { useComposicion } from "./ComposicionContext";
import { DAILY_RITUAL, WRITING_DAYS } from "./mock";
import { STAGES, fmtRelative } from "./labels";

const PRINCIPLES = [
  "La primera versión la escribes tú. Hermes entra cuando hay algo que empujar.",
  "Sugerencias con porqué. Si no puede explicar por qué, no vale.",
  "Una imagen vale más que una explicación — sobre todo en el coro.",
  "Grábala fea antes de pulirla. La canción existe cuando suena.",
  "Terminar > perfeccionar. Una canción terminada enseña más que diez a medias.",
];

export function ComposicionRail() {
  const { songs, setSelectedId, notebook } = useComposicion();
  const [ritual, setRitual] = useState(DAILY_RITUAL);

  // Racha: días consecutivos con escritura al final de la serie.
  let streak = 0;
  for (let i = WRITING_DAYS.length - 1; i >= 0 && WRITING_DAYS[i]; i--) streak++;
  const weekDays = WRITING_DAYS.slice(-7).filter(Boolean).length;
  const done = ritual.filter((r) => r.done).length;

  // Qué toca hoy: la canción activa más reciente que no esté terminada.
  const today = [...songs].filter((s) => s.stage !== "terminada").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const stale = songs.filter((s) => s.stage !== "terminada" && Date.now() - new Date(s.updatedAt).getTime() > 7 * 86_400_000);

  return (
    <div className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain">
      <Panel title="Ritual de hoy" tone="violet" delay={60} className="shrink-0">
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-2">
            <StatBlock label="racha" value={streak} unit="días" tone="violet" />
            <StatBlock label="esta semana" value={`${weekDays}/7`} tone="cyan" />
          </div>
          <div className="flex gap-0.5">
            {WRITING_DAYS.slice(-28).map((d, i) => (
              <span key={i} className={`h-2 flex-1 rounded-xs ${d ? "bg-violet" : "bg-line"}`} title={d ? "escribiste" : "—"} />
            ))}
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {ritual.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => setRitual((prev) => prev.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)))}
                  className="flex w-full items-start gap-2 text-left"
                >
                  <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-xs border text-2xs ${r.done ? "border-violet bg-violet/20 text-violet" : "border-line text-transparent"}`}>✓</span>
                  <span className="min-w-0">
                    <span className={`block text-xs ${r.done ? "text-text-dim line-through" : "text-text"}`}>{r.label}</span>
                    <span className="block text-2xs text-text-faint">{r.hint}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <span className="text-2xs text-text-faint">{done}/{ritual.length} · 15 minutos bastan (la racha es mock: irá al hábito "Componer").</span>
        </div>
      </Panel>

      <Panel title="Hoy toca" tone="cyan" delay={90} className="shrink-0">
        {today ? (
          <button onClick={() => setSelectedId(today.id)} className="flex w-full flex-col gap-1 text-left">
            <span className="font-display text-sm tracking-title text-text uppercase hover:text-violet">{today.title}</span>
            <span className="text-2xs text-text-dim">
              {STAGES[today.stage].label}: {STAGES[today.stage].hint}
            </span>
            <span className="text-2xs text-text-faint">tocada {fmtRelative(today.updatedAt)}</span>
          </button>
        ) : (
          <p className="text-xs text-text-dim">Sin canciones abiertas.</p>
        )}
        {stale.length > 0 && (
          <div className="mt-2 border-t border-line pt-2">
            <span className="text-2xs tracking-label text-amber uppercase">durmiendo +7 días</span>
            {stale.map((s) => (
              <button key={s.id} onClick={() => setSelectedId(s.id)} className="block text-xs text-text-dim hover:text-text">
                {s.title} · {fmtRelative(s.updatedAt)}
              </button>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Cuaderno" tone="amber" delay={120} className="shrink-0">
        <p className="text-xs text-text-dim">
          <span className="font-mono text-text">{notebook.filter((n) => !n.songId).length}</span> ideas sueltas · <span className="font-mono text-text">{notebook.filter((n) => n.kind === "tarareo").length}</span> tarareos
        </p>
        <p className="mt-1 text-2xs text-text-faint italic">"{notebook[0]?.text}"</p>
      </Panel>

      <Panel title="Principios" delay={150} className="shrink-0">
        <ol className="flex flex-col gap-1.5">
          {PRINCIPLES.map((p, i) => (
            <li key={i} className="flex gap-2 text-2xs leading-relaxed text-text-dim">
              <span className="font-mono text-violet">{i + 1}</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </Panel>
    </div>
  );
}
