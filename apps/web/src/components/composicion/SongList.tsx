"use client";

/**
 * Lista de canciones = la pantalla de entrada (patrón del Estudio: la lista
 * ES la pantalla, elegir una abre el takeover). Cada tarjeta dice lo que un
 * compositor quiere saber de un vistazo: etapa, tonalidad, tempo, cuántos
 * versos hay, cuándo la tocó por última vez. Alta rápida arriba: título +
 * semilla — una canción empieza por una frase, no por un formulario.
 */
import { useMemo, useState, type ReactNode } from "react";
import { keyLabel } from "@/lib/music-theory";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { useComposicion } from "./ComposicionContext";
import { STAGES, STAGE_ORDER, fieldCls, fmtRelative } from "./labels";
import type { Song, SongStage } from "./types";

export function songProgress(song: Song): number {
  const idx = STAGE_ORDER.indexOf(song.stage);
  return Math.round((idx / (STAGE_ORDER.length - 1)) * 100);
}

export function SongList() {
  const { songs, setSelectedId, createSong, notation } = useComposicion();
  const [filter, setFilter] = useState<SongStage | "todas">("todas");
  const [title, setTitle] = useState("");
  const [seed, setSeed] = useState("");

  const list = useMemo(
    () => songs.filter((s) => filter === "todas" || s.stage === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [songs, filter],
  );

  const create = () => {
    if (!title.trim() && !seed.trim()) return;
    createSong(title || seed.slice(0, 32), seed);
    setTitle("");
    setSeed("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Alta rápida: título + semilla. Sin caja — es la primera fila de la
          pantalla, no un objeto aparte. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="flex shrink-0 flex-col gap-1.5"
      >
        <div className="flex flex-wrap gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Título (o déjalo salir después)"
            aria-label="Título de la canción"
            className={`${fieldCls} w-56`}
          />
          <input
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            placeholder="La frase-semilla: de qué va, en una línea"
            aria-label="Frase-semilla"
            className={`${fieldCls} min-w-0 flex-1`}
          />
          <Button type="submit" size="md" disabled={!title.trim() && !seed.trim()}>
            Nueva canción
          </Button>
        </div>
        <span className="text-xs text-text-faint">
          Una canción empieza por una frase que no negocias. Tonalidad y acordes vienen después.
        </span>
      </form>

      {/* Filtro por etapa: píldoras calmadas (la seleccionada en gris, las
          vacías apagadas); el acento no se gasta en un filtro. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label="Filtrar por etapa">
        <FilterPill on={filter === "todas"} count={songs.length} onClick={() => setFilter("todas")}>
          Todas
        </FilterPill>
        {STAGE_ORDER.map((st) => {
          const n = songs.filter((s) => s.stage === st).length;
          return (
            <FilterPill
              key={st}
              on={filter === st}
              empty={n === 0}
              count={n}
              title={STAGES[st].hint}
              onClick={() => setFilter(st)}
            >
              {STAGES[st].label}
            </FilterPill>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-3 overflow-y-auto overscroll-contain pr-1 md:grid-cols-2">
        {list.length === 0 && (
          <p className="col-span-full py-6 text-center text-sm text-text-faint">
            Nada en esta etapa.
          </p>
        )}
        {list.map((s) => {
          const st = STAGES[s.stage];
          const lines = s.sections.reduce((n, sec) => n + sec.lyrics.split("\n").filter((l) => l.trim()).length, 0);
          const pct = songProgress(s);
          return (
            // Tarjeta = se abre (se opera): lleva marco; hover en el marco, no
            // en el color del título.
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className="flex cursor-pointer flex-col gap-2.5 rounded-md border border-line bg-panel p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-line-2 hover:bg-hover"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-md font-medium text-text">{s.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-sm text-text-dim italic">{s.seed}</p>
                </div>
                <Badge size="sm">{st.label}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-text-faint tabular-nums">
                <span className="text-text-dim">{keyLabel(s.key, notation)}</span>
                <span aria-hidden>·</span>
                <span>{s.tempo} bpm</span>
                <span aria-hidden>·</span>
                <span>{s.meter}</span>
                <span aria-hidden>·</span>
                <span>
                  {s.sections.length} {s.sections.length === 1 ? "sección" : "secciones"}
                </span>
                <span aria-hidden>·</span>
                <span>
                  {lines} {lines === 1 ? "verso" : "versos"}
                </span>
                <span className="ml-auto">{fmtRelative(s.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-selected">
                  <div className="h-full rounded-full bg-text-faint" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right text-xs text-text-faint tabular-nums">{pct}%</span>
              </div>
              {s.mood.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.mood.map((m) => (
                    <span
                      key={m}
                      className="rounded-full border border-line px-2 py-0.5 text-xs text-text-dim"
                    >
                      {m}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Píldora de filtro (mismo patrón que el pipeline del Estudio). */
function FilterPill({
  on,
  empty = false,
  count,
  title,
  onClick,
  children,
}: {
  on: boolean;
  empty?: boolean;
  count: number;
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${
        on
          ? "bg-selected font-medium text-text"
          : empty
            ? "text-text-faint hover:bg-hover"
            : "text-text-dim hover:bg-hover hover:text-text"
      }`}
    >
      {children}
      <span className="text-text-faint tabular-nums">{count}</span>
    </button>
  );
}
