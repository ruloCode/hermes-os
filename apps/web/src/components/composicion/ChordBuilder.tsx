"use client";

/**
 * Constructor de progresiones por sección. La progresión se ve como tarjetas
 * grandes (símbolo + grado romano + estado diatónico/prestado), se OYE con
 * ▶ al tempo de la canción (paso encendido), y se arma desde la paleta de la
 * tonalidad, los prestados o los presets clásicos. Ningún acorde entra sin
 * un clic humano; Hermes sugiere desde el copiloto.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeChord,
  chordFromRoman,
  chordNotes,
  chordSymbol,
  diatonicChords,
  borrowedChords,
  parseChord,
  PROGRESSION_PRESETS,
  scaleNotes,
  type Chord,
  type Spell,
} from "@/lib/music-theory";
import { playChord, playProgression, audioSupported } from "@/lib/chord-audio";
import { Toggle } from "@/components/ui/Toggle";
import { PianoKeys } from "./PianoKeys";
import { useComposicion } from "./ComposicionContext";
import { SECTION_KINDS, btnCls, ghostBtnCls, inputCls } from "./labels";
import type { Song } from "./types";

const STATUS_CLS = {
  diatónico: "border-line text-text",
  prestado: "border-amber/50 text-amber",
  fuera: "border-red/50 text-red",
} as const;

export function ChordBuilder({ song }: { song: Song }) {
  const { patchSection, patchSong, notation } = useComposicion();
  const [sectionId, setSectionId] = useState(song.sections[0]?.id ?? "");
  const [step, setStep] = useState<number | null>(null);
  const [loop, setLoop] = useState(true);
  const [custom, setCustom] = useState("");
  const [heard, setHeard] = useState<Chord | null>(null);
  const stopRef = useRef<(() => void) | null>(null);

  const section = song.sections.find((s) => s.id === sectionId) ?? song.sections[0];
  const key = song.key;
  const dia = diatonicChords(key);
  const borrowed = borrowedChords(key);

  const chords = useMemo(() => (section?.chords ?? []).map((sym) => ({ sym, chord: parseChord(sym) })), [section]);

  useEffect(() => () => stopRef.current?.(), []);
  // Cambiar de sección corta la reproducción.
  useEffect(() => {
    stopRef.current?.();
    stopRef.current = null;
  }, [sectionId]);

  if (!section) return <p className="text-xs text-text-dim">Agrega una sección en Estructura para armar acordes.</p>;

  const setChords = (next: string[]) => patchSection(song.id, section.id, { chords: next });
  // Se guarda SIEMPRE en anglosajón; se muestra según la notación elegida.
  // `spell` respeta el deletreo del grado (el ♭II de La menor es Bb, no A#).
  const sym = (c: Chord, spell: Spell = "auto") => chordSymbol(c, key, "en", spell);
  const show = (s: string) => {
    const c = parseChord(s);
    return c ? chordSymbol(c, key, notation) : s;
  };
  const add = (c: Chord, spell: Spell = "auto") => {
    setChords([...section.chords, sym(c, spell)]);
    hear(c);
  };
  const hear = (c: Chord) => {
    playChord(c);
    setHeard(c);
    setTimeout(() => setHeard((p) => (p === c ? null : p)), 1200);
  };
  const remove = (i: number) => setChords(section.chords.filter((_, j) => j !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= section.chords.length) return;
    const next = [...section.chords];
    [next[i], next[j]] = [next[j], next[i]];
    setChords(next);
  };

  const toggle = () => {
    if (stopRef.current) {
      stopRef.current();
      stopRef.current = null;
      return;
    }
    const list = chords.map((c) => c.chord).filter((c): c is Chord => Boolean(c));
    if (list.length === 0) return;
    const beats = song.meter === "3/4" ? 3 : song.meter === "6/8" ? 6 : 4;
    stopRef.current = playProgression(list, song.tempo, {
      beatsPerChord: beats,
      loop,
      onStep: (i) => {
        setStep(i);
        if (i == null) stopRef.current = null;
      },
    });
  };

  const applyPreset = (romans: string[]) => {
    // Un grado con ♭ se deletrea con bemol aunque la tonalidad use sostenidos.
    const list = romans
      .map((r) => ({ chord: chordFromRoman(r, key), spell: (/^[♭b]/.test(r) ? "flat" : "auto") as Spell }))
      .filter((x): x is { chord: Chord; spell: Spell } => Boolean(x.chord));
    setChords(list.map((x) => sym(x.chord, x.spell)));
    patchSong(song.id, (s) => ({
      versions: [...s.versions, { id: `v-${Date.now()}`, at: new Date().toISOString(), note: `${section.label}: preset ${romans.join("–")}`, scope: "armonía" }],
    }));
  };

  const addCustom = () => {
    const c = parseChord(custom);
    if (!c) return;
    add(c);
    setCustom("");
  };

  const playing = step != null;
  const activeNotes = heard ? chordNotes(heard) : playing && chords[step!]?.chord ? chordNotes(chords[step!].chord!) : [];

  return (
    <div className="flex flex-col gap-4">
      {/* Qué sección estoy armando */}
      <div className="flex flex-wrap items-center gap-1">
        {song.sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setSectionId(s.id)}
            className={`rounded-sm border px-2 py-1 text-2xs tracking-label uppercase ${
              s.id === section.id ? "border-violet bg-violet/16 text-violet" : "border-line text-text-dim hover:text-text"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* La progresión: tarjetas grandes, clic = oír */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-2xs tracking-label text-text-dim uppercase">
            {section.label} · {section.bars} compases · {SECTION_KINDS[section.kind].hint}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-2xs text-text-dim">
              <input
                type="number"
                min={40}
                max={220}
                value={song.tempo}
                onChange={(e) => patchSong(song.id, { tempo: Math.max(40, Math.min(220, Number(e.target.value) || 90)) })}
                className={`${inputCls} w-14 text-center font-mono`}
              />
              bpm
            </label>
            <Toggle size="sm" checked={loop} onChange={setLoop} label="loop" />
            <button onClick={toggle} disabled={!audioSupported() || chords.length === 0} className={`${btnCls} ${playing ? "border-cyan text-cyan" : ""}`}>
              {playing ? "■ Parar" : "▶ Tocar"}
            </button>
          </div>
        </div>
        {chords.length === 0 ? (
          <p className="rounded-sm border border-dashed border-line px-3 py-4 text-center text-xs text-text-dim">
            Sin acordes. Toma de la paleta de abajo o aplica un preset.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {chords.map(({ sym: s, chord }, i) => {
              const a = chord ? analyzeChord(chord, key) : null;
              const on = step === i;
              return (
                <div
                  key={`${s}-${i}`}
                  className={`group relative flex min-w-[84px] flex-col items-center gap-0.5 rounded-sm border bg-panel-2 px-3 py-2 transition-all ${
                    on ? "border-cyan shadow-[0_0_14px_rgb(103_232_249_/_0.35)]" : a ? STATUS_CLS[a.status] : "border-red/50"
                  }`}
                  title={a?.hint ?? (a ? a.status : "no reconocido")}
                >
                  <button onClick={() => chord && hear(chord)} className="font-mono text-xl leading-none text-text">
                    {show(s)}
                  </button>
                  <span className={`font-mono text-2xs ${a?.status === "prestado" ? "text-amber" : a?.status === "fuera" ? "text-red" : "text-text-dim"}`}>
                    {a?.roman ?? "?"}
                  </span>
                  <div className="absolute -top-2 right-1 hidden gap-0.5 group-hover:flex group-focus-within:flex">
                    <button onClick={() => move(i, -1)} className="rounded-xs bg-panel-2 px-1 text-2xs text-text-dim hover:text-text" title="mover antes">◀</button>
                    <button onClick={() => move(i, 1)} className="rounded-xs bg-panel-2 px-1 text-2xs text-text-dim hover:text-text" title="mover después">▶</button>
                    <button onClick={() => remove(i)} className="rounded-xs bg-panel-2 px-1 text-2xs text-red" title="quitar">✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <PianoKeys musicKey={key} scale={scaleNotes(key)} active={activeNotes} notation={notation} octaves={2} height={54} />
      </div>

      {/* Paleta de la tonalidad */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs tracking-label text-text-dim uppercase">Paleta · clic agrega y suena</span>
        <div className="flex flex-wrap gap-1">
          {dia.map((d) => (
            <button key={d.degree} onClick={() => add(d.chord)} className="flex items-center gap-1.5 rounded-sm border border-line bg-panel-2 px-2 py-1 hover:border-violet">
              <span className="font-mono text-xs text-text">{chordSymbol(d.chord, key, notation)}</span>
              <span className="font-mono text-2xs text-text-dim">{d.roman}</span>
            </button>
          ))}
          {borrowed.map((b) => (
            <button key={b.roman} onClick={() => add(b.chord, b.spell)} title={b.hint} className="flex items-center gap-1.5 rounded-sm border border-amber/40 bg-panel-2 px-2 py-1 hover:border-amber">
              <span className="font-mono text-xs text-text">{chordSymbol(b.chord, key, notation, b.spell)}</span>
              <span className="font-mono text-2xs text-amber">{b.roman}</span>
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              addCustom();
            }}
            className="flex items-center gap-1"
          >
            <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="otro: Fmaj7, Sol7, Bsus4" className={`${inputCls} w-40 font-mono`} />
            <button type="submit" className={ghostBtnCls} disabled={!parseChord(custom)}>+</button>
          </form>
        </div>
      </div>

      {/* Presets: para no arrancar de cero */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs tracking-label text-text-dim uppercase">Progresiones clásicas · reemplazan la sección</span>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {PROGRESSION_PRESETS.filter((p) => p.mode === "any" || p.mode === key.mode).map((p) => {
            const resolved = p.romans.map((r) => chordFromRoman(r, key)).filter((c): c is Chord => Boolean(c));
            return (
              <button key={p.id} onClick={() => applyPreset(p.romans)} className="flex flex-col gap-0.5 rounded-sm border border-line px-2 py-1.5 text-left hover:border-violet">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-text">{p.name}</span>
                  <span className="font-mono text-2xs text-text-dim">{p.romans.join("–")}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs text-text-faint">{p.feel}</span>
                  <span className="font-mono text-2xs text-violet">{resolved.map((c) => chordSymbol(c, key, notation)).join(" ")}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
