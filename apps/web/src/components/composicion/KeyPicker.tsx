"use client";

/**
 * Selector de tonalidad (patrón Mobbin: rejilla de 12 notas + Mayor/menor
 * del picker de "Set Key"). Elegir una tonalidad muestra al instante lo que
 * un compositor necesita: las notas de la escala en el piano, los 7 acordes
 * diatónicos con su grado y función (y un ▶ para oírlos), los prestados que
 * suelen funcionar y las tonalidades vecinas. Cambiar de tonalidad transpone
 * los acordes de la canción (opcional) — la canción sigue siendo la misma.
 */
import { useState } from "react";
import {
  borrowedChords,
  chordNotes,
  chordSymbol,
  diatonicChords,
  keyLabel,
  latinName,
  noteName,
  relatedKeys,
  scaleNotes,
  TONICS,
  usesFlats,
  type Chord,
  type Key,
  type Pc,
} from "@/lib/music-theory";
import { playChord } from "@/lib/chord-audio";
import { Badge } from "@/components/ui/Badge";
import { Toggle } from "@/components/ui/Toggle";
import { PianoKeys } from "./PianoKeys";
import { useComposicion } from "./ComposicionContext";
import { DOT_BG, btnCls } from "./labels";
import type { Song } from "./types";

const ROLE_TONE = { tónica: "accent", subdominante: "cyan", dominante: "amber" } as const;

export function KeyPicker({ song }: { song: Song }) {
  const { setKey, notation } = useComposicion();
  const [transpose, setTranspose] = useState(true);
  const [preview, setPreview] = useState<Chord | null>(null);
  const key = song.key;
  const scale = scaleNotes(key);
  const dia = diatonicChords(key);
  const borrowed = borrowedChords(key);
  const flats = usesFlats(key);
  const nm = (pc: Pc) => (notation === "latin" ? latinName(pc, key) : noteName(pc, key));

  const choose = (k: Key) => setKey(song.id, k, transpose);
  const play = (c: Chord) => {
    setPreview(c);
    playChord(c);
    setTimeout(() => setPreview((p) => (p === c ? null : p)), 1200);
  };

  const sharps = TONICS.filter((t) => t.sharp.includes("#"));
  const naturals = TONICS.filter((t) => !t.sharp.includes("#"));

  return (
    <div className="flex flex-col gap-4">
      {/* Rejilla de tónicas: negras arriba (como el piano), blancas abajo, modo al pie */}
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-7 gap-1">
          {[sharps[0], sharps[1], null, sharps[2], sharps[3], sharps[4], null].map((t, i) =>
            t ? (
              <button
                key={t.pc}
                onClick={() => choose({ tonic: t.pc, mode: key.mode })}
                className={`rounded-sm border px-1 py-1.5 font-mono text-xs leading-tight ${
                  key.tonic === t.pc ? "border-accent bg-accent/16 text-accent" : "border-line bg-panel-2 text-text-dim hover:border-line-2 hover:text-text"
                }`}
              >
                <span className="block">{notation === "latin" ? latinName(t.pc, { tonic: t.pc, mode: "major" }).replace("♭", "♯") : t.sharp}</span>
                <span className="block text-2xs opacity-60">{notation === "latin" ? latinName(t.pc, { tonic: 5, mode: "major" }) : t.flat}</span>
              </button>
            ) : (
              <span key={`gap-${i}`} />
            ),
          )}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {naturals.map((t) => (
            <button
              key={t.pc}
              onClick={() => choose({ tonic: t.pc, mode: key.mode })}
              className={`rounded-sm border px-1 py-2 font-mono text-sm ${
                key.tonic === t.pc ? "border-accent bg-accent/16 text-accent" : "border-line bg-panel-2 text-text-dim hover:border-line-2 hover:text-text"
              }`}
            >
              {notation === "latin" ? latinName(t.pc, key) : t.sharp}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {(["major", "minor"] as const).map((m) => (
            <button
              key={m}
              onClick={() => choose({ tonic: key.tonic, mode: m })}
              className={`rounded-sm border px-2 py-1.5 text-2xs tracking-label uppercase ${
                key.mode === m ? "border-accent bg-accent/16 text-accent" : "border-line bg-panel-2 text-text-dim hover:text-text"
              }`}
            >
              {m === "major" ? "Mayor · luz" : "menor · sombra"}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Toggle size="sm" checked={transpose} onChange={setTranspose} label="Transponer acordes al cambiar" />
          <span className="text-2xs text-text-faint">{flats ? "se escribe con ♭" : "se escribe con ♯"}</span>
        </div>
      </div>

      {/* La escala en el piano + notas */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-sm tracking-title text-text uppercase">{keyLabel(key, notation)}</span>
          <span className="font-mono text-2xs text-text-dim">{scale.map(nm).join(" · ")}</span>
        </div>
        <PianoKeys musicKey={key} scale={scale} active={preview ? chordNotes(preview) : []} notation={notation} onPlay={(m) => playChord({ root: m % 12, quality: "maj" }, 0.6)} />
      </div>

      {/* Acordes diatónicos: la paleta de la tonalidad */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs tracking-label text-text-dim uppercase">Los 7 acordes de esta tonalidad</span>
        <div className="grid grid-cols-7 gap-1">
          {dia.map((d) => (
            <button
              key={d.degree}
              onClick={() => play(d.chord)}
              title={`${d.roman} · ${d.role} — clic para oír`}
              className={`group flex flex-col items-center gap-0.5 rounded-sm border px-1 py-1.5 transition-colors hover:border-accent ${
                preview === d.chord ? "border-cyan bg-cyan/10" : "border-line bg-panel-2"
              }`}
            >
              <span className="font-mono text-2xs text-text-dim">{d.roman}</span>
              <span className="font-mono text-sm text-text">{chordSymbol(d.chord, key, notation)}</span>
              <span aria-hidden className={`h-1 w-1 rounded-full ${DOT_BG[ROLE_TONE[d.role]]}`} />
            </button>
          ))}
        </div>
        <div className="flex gap-3 text-2xs text-text-faint">
          <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full bg-accent" /> tónica · casa</span>
          <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full bg-cyan" /> subdominante · salida</span>
          <span className="flex items-center gap-1"><i className="inline-block h-1.5 w-1.5 rounded-full bg-amber" /> dominante · tensión</span>
        </div>
      </div>

      {/* Prestados: color fuera de la tonalidad, con el porqué */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs tracking-label text-text-dim uppercase">Acordes prestados que suelen funcionar</span>
        <div className="flex flex-col gap-1">
          {borrowed.map((b) => (
            <button key={b.roman} onClick={() => play(b.chord)} className="flex items-center gap-2 rounded-sm border border-line px-2 py-1 text-left hover:border-amber/60">
              <span className="w-10 shrink-0 font-mono text-xs text-amber">{b.roman}</span>
              <span className="w-12 shrink-0 font-mono text-xs text-text">{chordSymbol(b.chord, key, notation, b.spell)}</span>
              <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">{b.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Vecinas */}
      <div className="flex flex-col gap-1.5">
        <span className="text-2xs tracking-label text-text-dim uppercase">Tonalidades vecinas</span>
        <div className="flex flex-wrap gap-1">
          {relatedKeys(key).map((r) => (
            <button key={r.label} onClick={() => choose(r.key)} className={btnCls} title={`Cambiar a ${keyLabel(r.key, notation)}`}>
              {r.label}: {keyLabel(r.key, notation)}
            </button>
          ))}
        </div>
        <p className="text-2xs text-text-faint">
          La relativa comparte las mismas notas (cambia la casa). La paralela cambia la luz sin mover el registro de tu voz.
        </p>
      </div>

      <div className="flex flex-wrap gap-1">
        {song.mood.map((m) => (
          <Badge key={m} tone="neutral" size="sm">{m}</Badge>
        ))}
      </div>
    </div>
  );
}
