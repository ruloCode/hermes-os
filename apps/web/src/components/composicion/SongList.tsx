"use client";

/**
 * Lista de canciones = la pantalla de entrada (patrón del Estudio: la lista
 * ES la pantalla, elegir una abre el takeover). Cada tarjeta dice lo que un
 * compositor quiere saber de un vistazo: etapa, tonalidad, tempo, cuántos
 * versos hay, cuándo la tocó por última vez. Alta rápida arriba: título +
 * semilla — una canción empieza por una frase, no por un formulario.
 */
import { useMemo, useState } from "react";
import { keyLabel } from "@/lib/music-theory";
import { Badge } from "@/components/ui/Badge";
import { useComposicion } from "./ComposicionContext";
import { STAGES, STAGE_ORDER, btnCls, fmtRelative, inputCls } from "./labels";
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
        className="flex flex-col gap-1.5 rounded-sm border border-line bg-panel-2 p-2"
      >
        <div className="flex gap-1.5">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título (o déjalo salir después)" className={`${inputCls} w-52`} />
          <input value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="La frase-semilla: de qué va, en una línea" className={`${inputCls} flex-1`} />
          <button type="submit" className={btnCls} disabled={!title.trim() && !seed.trim()}>+ Canción</button>
        </div>
        <span className="text-2xs text-text-faint">Una canción empieza por una frase que no negocias. Tonalidad y acordes vienen después.</span>
      </form>

      <div className="flex flex-wrap items-center gap-1">
        <button onClick={() => setFilter("todas")} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${filter === "todas" ? "bg-violet/16 text-violet" : "text-text-dim hover:text-text"}`}>
          todas · {songs.length}
        </button>
        {STAGE_ORDER.map((st) => {
          const n = songs.filter((s) => s.stage === st).length;
          return (
            <button key={st} onClick={() => setFilter(st)} className={`rounded-sm px-2 py-0.5 text-2xs tracking-label uppercase ${filter === st ? "bg-violet/16 text-violet" : "text-text-dim hover:text-text"}`}>
              {STAGES[st].label} · {n}
            </button>
          );
        })}
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-1 gap-2 overflow-y-auto overscroll-contain pr-1 md:grid-cols-2">
        {list.length === 0 && <p className="col-span-full py-6 text-center text-xs text-text-dim">Nada en esta etapa.</p>}
        {list.map((s) => {
          const st = STAGES[s.stage];
          const lines = s.sections.reduce((n, sec) => n + sec.lyrics.split("\n").filter((l) => l.trim()).length, 0);
          const pct = songProgress(s);
          return (
            <button key={s.id} onClick={() => setSelectedId(s.id)} className="hud-panel group flex flex-col gap-2 p-3 text-left transition-colors hover:border-violet/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-md tracking-title text-text uppercase group-hover:text-violet">{s.title}</h3>
                  <p className="mt-0.5 line-clamp-2 text-2xs text-text-dim italic">{s.seed}</p>
                </div>
                <Badge tone={st.tone} size="sm">{st.label}</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-2xs text-text-dim">
                <span className="text-text">{keyLabel(s.key, notation)}</span>
                <span>{s.tempo} bpm · {s.meter}</span>
                <span>{s.sections.length} secc · {lines} versos</span>
                <span className="ml-auto text-text-faint">{fmtRelative(s.updatedAt)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-line">
                  <div className="h-full bg-violet" style={{ width: `${pct}%` }} />
                </div>
                <span className="font-mono text-2xs text-text-dim">{pct}%</span>
              </div>
              {s.mood.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {s.mood.map((m) => (
                    <span key={m} className="rounded-xs bg-panel-2 px-1.5 py-0.5 text-2xs text-text-faint">{m}</span>
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
