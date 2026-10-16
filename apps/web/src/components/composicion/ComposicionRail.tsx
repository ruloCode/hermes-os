"use client";

/**
 * Riel de Composición: el hábito por encima del talento. Ritual del día
 * (4 cosas de 15 min que no dependen de la inspiración), racha de escritura
 * (mock: en producción se engancha al hábito "Componer" como /ingles),
 * qué canción toca hoy y los principios de la casa — el factor humano
 * escrito, para que Hermes y tú lo tengan enfrente.
 */
import { useState } from "react";
import { Rail, RailRow, RailSection } from "@/components/ui/Rail";
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

  const sueltas = notebook.filter((n) => !n.songId).length;
  const tarareos = notebook.filter((n) => n.kind === "tarareo").length;

  return (
    // v5: secciones sin caja (Rail). Los números van en el color del texto;
    // el acento queda para lo que se marca (los días escritos, el ritual hecho).
    <Rail>
      <RailSection
        label="Ritual de hoy"
        right={
          <span className="text-2xs text-text-faint tabular-nums">
            {done}/{ritual.length}
          </span>
        }
      >
        <div className="flex flex-col gap-3 px-2">
          <div className="flex items-baseline gap-6">
            <div>
              <div className="text-lg leading-tight font-semibold text-text tabular-nums">
                {streak} <span className="text-sm font-normal text-text-dim">{streak === 1 ? "día" : "días"}</span>
              </div>
              <div className="text-xs text-text-faint">Racha</div>
            </div>
            <div>
              <div className="text-lg leading-tight font-semibold text-text tabular-nums">
                {weekDays}/7
              </div>
              <div className="text-xs text-text-faint">Esta semana</div>
            </div>
          </div>
          <div className="flex gap-0.5" aria-label="Últimos 28 días">
            {WRITING_DAYS.slice(-28).map((d, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full ${d ? "bg-accent" : "bg-selected"}`}
                title={d ? "escribiste" : "—"}
              />
            ))}
          </div>
        </div>
        <ul className="mt-2 flex flex-col">
          {ritual.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setRitual((prev) => prev.map((x) => (x.id === r.id ? { ...x, done: !x.done } : x)))}
                role="checkbox"
                aria-checked={r.done}
                className="flex w-full cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-hover"
              >
                <span
                  aria-hidden
                  className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-xs border ${
                    r.done ? "border-accent-solid bg-accent-solid text-on-accent" : "border-line-2"
                  }`}
                >
                  {r.done && <CheckIcon />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm ${r.done ? "text-text-faint line-through" : "text-text"}`}>
                    {r.label}
                  </span>
                  <span className="block text-xs text-text-faint">{r.hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {/* Honestidad: la racha todavía no sale de un dato real. */}
        <p className="mt-1 px-2 text-xs text-text-faint">
          15 minutos bastan. La racha es de prueba: irá al hábito "Componer".
        </p>
      </RailSection>

      <RailSection label="Hoy toca">
        {today ? (
          <>
            <RailRow
              title={today.title}
              sub={`${STAGES[today.stage].label} · tocada ${fmtRelative(today.updatedAt)}`}
              onClick={() => setSelectedId(today.id)}
            />
            {/* Qué significa la etapa: guía, no dato — en su propia línea, sin truncar. */}
            <p className="px-2 text-xs text-text-faint">{STAGES[today.stage].hint}.</p>
          </>
        ) : (
          <p className="px-2 text-sm text-text-faint">Sin canciones abiertas.</p>
        )}
      </RailSection>

      {/* Durmiendo = estado (atención): el punto ámbar va en la fila, no en la etiqueta. */}
      {stale.length > 0 && (
        <RailSection
          label="Durmiendo +7 días"
          right={<span className="text-2xs text-text-faint tabular-nums">{stale.length}</span>}
        >
          <div className="flex flex-col">
            {stale.map((s) => (
              <RailRow
                key={s.id}
                tone="amber"
                title={s.title}
                value={fmtRelative(s.updatedAt)}
                onClick={() => setSelectedId(s.id)}
              />
            ))}
          </div>
        </RailSection>
      )}

      <RailSection label="Cuaderno">
        <div className="px-2">
          <p className="text-sm text-text-dim">
            <span className="text-text tabular-nums">{sueltas}</span>{" "}
            {sueltas === 1 ? "idea suelta" : "ideas sueltas"} ·{" "}
            <span className="text-text tabular-nums">{tarareos}</span>{" "}
            {tarareos === 1 ? "tarareo" : "tarareos"}
          </p>
          {notebook[0]?.text && (
            <p className="mt-1 line-clamp-2 text-xs text-text-faint italic">“{notebook[0].text}”</p>
          )}
        </div>
      </RailSection>

      <RailSection label="Principios">
        <ol className="flex flex-col gap-2 px-2">
          {PRINCIPLES.map((p, i) => (
            <li key={i} className="flex gap-2.5 text-xs leading-relaxed text-text-dim">
              <span className="w-3 shrink-0 text-text-faint tabular-nums">{i + 1}</span>
              <span>{p}</span>
            </li>
          ))}
        </ol>
      </RailSection>
    </Rail>
  );
}

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
