"use client";

/**
 * Estructura de la canción como línea de tiempo (patrón Mobbin: los bloques
 * de sección de ElevenLabs Music al pie). Cada bloque mide sus compases,
 * dice cuántos versos tiene y qué acordes; se reordena con ◀ ▶ y se agregan
 * secciones desde la fila de abajo. La duración estimada sale del tempo y
 * el compás reales.
 */
import { chordSymbol, parseChord } from "@/lib/music-theory";
import { useComposicion } from "./ComposicionContext";
import { DOT_BG, SECTION_KINDS, btnCls, ghostBtnCls, inputCls } from "./labels";
import type { SectionKind, Song } from "./types";

const TONE_BG: Record<string, string> = {
  accent: "border-accent/50 bg-accent/10",
  cyan: "border-cyan/50 bg-cyan/10",
  blue: "border-blue/50 bg-blue/10",
  amber: "border-amber/50 bg-amber/10",
  green: "border-green/50 bg-green/10",
  neutral: "border-line bg-panel-2",
  red: "border-red/50 bg-red/10",
};

export function StructureTab({ song }: { song: Song }) {
  const { addSection, moveSection, removeSection, patchSection, patchSong, notation } = useComposicion();
  const beats = song.meter === "3/4" ? 3 : song.meter === "6/8" ? 6 : 4;
  const totalBars = song.sections.reduce((n, s) => n + s.bars, 0);
  const seconds = Math.round((totalBars * beats * 60) / song.tempo);
  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");
  const show = (s: string) => {
    const c = parseChord(s);
    return c ? chordSymbol(c, song.key, notation) : s;
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-text-dim">
          <span className="font-mono text-text">{song.sections.length}</span> secciones · <span className="font-mono text-text">{totalBars}</span> compases ·{" "}
          <span className="font-mono text-text">~{mm}:{ss}</span> a {song.tempo} bpm en {song.meter}
        </p>
        <div className="flex items-center gap-1">
          {(["4/4", "3/4", "6/8"] as const).map((m) => (
            <button key={m} onClick={() => patchSong(song.id, { meter: m })} className={`rounded-sm border px-2 py-1 font-mono text-2xs ${song.meter === m ? "border-accent text-accent" : "border-line text-text-dim"}`}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Línea de tiempo proporcional a los compases */}
      <div className="flex w-full gap-1 overflow-x-auto pb-1">
        {song.sections.map((s) => {
          const k = SECTION_KINDS[s.kind];
          const lines = s.lyrics.split("\n").filter((l) => l.trim()).length;
          return (
            <div
              key={s.id}
              className={`flex min-w-[96px] flex-col gap-0.5 rounded-sm border px-2 py-1.5 ${TONE_BG[k.tone]}`}
              style={{ flexGrow: s.bars, flexBasis: 0 }}
              title={k.hint}
            >
              <span className="truncate text-2xs tracking-label text-text uppercase">{s.label}</span>
              <span className="font-mono text-2xs text-text-dim">{s.bars} comp · {lines} versos</span>
              <span className="truncate font-mono text-2xs text-text-faint">{s.chords.map(show).join(" ") || "—"}</span>
            </div>
          );
        })}
      </div>

      {/* Lista editable */}
      <div className="flex flex-col gap-1">
        {song.sections.map((s, i) => {
          const k = SECTION_KINDS[s.kind];
          return (
            <div key={s.id} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1.5">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_BG[k.tone]}`} />
              <select
                value={s.kind}
                onChange={(e) => patchSection(song.id, s.id, { kind: e.target.value as SectionKind })}
                className="rounded-sm border border-line bg-panel-2 px-1 py-0.5 text-2xs text-text-dim uppercase focus:outline-none"
              >
                {(Object.keys(SECTION_KINDS) as SectionKind[]).map((kk) => (
                  <option key={kk} value={kk}>{SECTION_KINDS[kk].label}</option>
                ))}
              </select>
              <input value={s.label} onChange={(e) => patchSection(song.id, s.id, { label: e.target.value })} className={`${inputCls} w-28`} />
              <label className="flex items-center gap-1 text-2xs text-text-dim">
                <input type="number" min={1} max={64} value={s.bars} onChange={(e) => patchSection(song.id, s.id, { bars: Math.max(1, Number(e.target.value) || 1) })} className={`${inputCls} w-14 text-center font-mono`} />
                compases
              </label>
              <span className="min-w-0 flex-1 truncate text-2xs text-text-faint">{s.intent || k.hint}</span>
              <button onClick={() => moveSection(song.id, s.id, -1)} disabled={i === 0} className={ghostBtnCls}>▲</button>
              <button onClick={() => moveSection(song.id, s.id, 1)} disabled={i === song.sections.length - 1} className={ghostBtnCls}>▼</button>
              <button onClick={() => removeSection(song.id, s.id)} className={`${ghostBtnCls} text-red`} title="quitar sección">✕</button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-2xs tracking-label text-text-dim uppercase">agregar</span>
        {(Object.keys(SECTION_KINDS) as SectionKind[]).map((kk) => (
          <button key={kk} onClick={() => addSection(song.id, kk)} className={btnCls}>+ {SECTION_KINDS[kk].label}</button>
        ))}
      </div>

      <p className="text-2xs text-text-faint">
        Formas que funcionan: <span className="font-mono">V–C–V–C–P–C</span> (pop) · <span className="font-mono">V–V–C–V–C</span> (folk) · <span className="font-mono">V–Pre–C–V–Pre–C–P–C</span> (balada). Nada obliga: la canción manda.
      </p>
    </div>
  );
}
