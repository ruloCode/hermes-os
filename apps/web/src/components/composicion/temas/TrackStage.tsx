"use client";

/**
 * Etapa PISTA: tonalidad, compás, groove y swing del tema, las secciones con su
 * largo, y el loop de acordes de la sección en un carril de bloques por compás
 * (ChordLane) con la paleta de la tonalidad al lado (ChordPalette). El bpm vive
 * en el transporte (abajo, en todas las etapas).
 *
 * Teclado en el carril (fuera de campos): ←→ elegir bloque · ⌫ borrar · / partir
 * o unir el compás. Nada con ⌘ (⌘1..9 son los destinos globales).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GROOVES, type Groove, type Meter, type SectionKind, type TemaSection } from "@hermes/shared";
import { playChord } from "@/lib/chord-audio";
import { keyLabel, latinName, relatedKeys, TONICS, type Chord, type Key } from "@/lib/music-theory";
import { Toggle } from "@/components/ui/Toggle";
import { useComposicion } from "../ComposicionContext";
import { btn, btnGhost, chip, field, plainKey } from "../playground/ui";
import { ChordLane } from "./ChordLane";
import { ChordPalette } from "./ChordPalette";
import { useTemaCtx } from "./TemaContext";
import {
  appendBar,
  joinBar,
  loopFromSymbols,
  MAX_SECTION_BARS,
  moveBar,
  newSection,
  patchSection,
  remeter,
  removeBlock,
  SECTION_LABEL,
  setChord,
  splitBar,
  transposeTrack,
  type LaneSel,
} from "./track-edit";

const METERS: Meter[] = ["4/4", "3/4", "6/8"];
const GROOVE_LABEL: Record<Groove, string> = {
  clic: "Solo clic",
  dembow: "Dembow",
  dancehall: "Dancehall",
  rnb: "R&B",
  pop: "Pop",
};
const ADDABLE: SectionKind[] = ["verso", "pre", "coro", "puente", "intro", "final"];

export function TrackStage() {
  const { tema, section, setSectionId, patch, engine, active } = useTemaCtx();
  const { notation } = useComposicion();
  const track = tema.track;
  const [sel, setSel] = useState<LaneSel | null>(null);
  const [undo, setUndo] = useState<{ label: string; section: TemaSection } | null>(null);

  // Cambiar de sección suelta el bloque elegido.
  useEffect(() => setSel(null), [section.id]);
  // Si el bloque elegido desapareció (se borró o se unió), se suelta.
  useEffect(() => {
    if (sel && !section.loop[sel.bar]?.chords[sel.idx]) setSel(null);
  }, [sel, section.loop]);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 12_000);
    return () => clearTimeout(t);
  }, [undo]);

  const setLoop = useCallback(
    (loop: TemaSection["loop"]) => patch({ track: patchSection(track, section.id, { loop }) }),
    [patch, section.id, track],
  );

  // Oír un acorde elegido de la paleta — solo con la pista quieta (encima del loop es ruido).
  const audition = useCallback(
    (c: Chord) => {
      if (!engine.playing()) playChord(c, 1.1);
    },
    [engine],
  );

  const pick = useCallback(
    (symbol: string, chord: Chord) => {
      audition(chord);
      if (sel) setLoop(setChord(section.loop, sel, symbol));
      else {
        const next = appendBar(section.loop, symbol);
        setLoop(next);
        if (next.length > section.loop.length) setSel({ bar: next.length - 1, idx: 0 });
      }
    },
    [audition, section.loop, sel, setLoop],
  );

  const preset = useCallback(
    (symbols: string[], name: string) => {
      setUndo({ label: `Plantilla «${name}»`, section });
      setLoop(loopFromSymbols(symbols));
      setSel(null);
    },
    [section, setLoop],
  );

  const addBar = useCallback(() => {
    const last = section.loop[section.loop.length - 1];
    const symbol = last?.chords[last.chords.length - 1]?.symbol ?? "C";
    const next = appendBar(section.loop, symbol);
    setLoop(next);
    setSel({ bar: next.length - 1, idx: 0 });
  }, [section.loop, setLoop]);

  const selBar = sel ? section.loop[sel.bar] : null;

  const removeSel = useCallback(() => {
    if (!sel) return;
    if (section.loop.length <= 1 && (section.loop[0]?.chords.length ?? 0) <= 1) return;
    setUndo({ label: "Bloque borrado", section });
    setLoop(removeBlock(section.loop, sel));
    setSel(null);
  }, [section, sel, setLoop]);

  const toggleSplit = useCallback(() => {
    if (!sel || !selBar) return;
    if (selBar.chords.length > 1) {
      setLoop(joinBar(section.loop, sel.bar));
      setSel({ bar: sel.bar, idx: 0 });
    } else {
      setLoop(splitBar(section.loop, sel.bar, track.meter));
      setSel({ bar: sel.bar, idx: 1 });
    }
  }, [section.loop, sel, selBar, setLoop, track.meter]);

  const move = useCallback(
    (dir: -1 | 1) => {
      if (!sel) return;
      const j = sel.bar + dir;
      if (j < 0 || j >= section.loop.length) return;
      setLoop(moveBar(section.loop, sel.bar, dir));
      setSel({ bar: j, idx: sel.idx });
    },
    [section.loop, sel, setLoop],
  );

  // Teclado del carril.
  const blocks = useMemo(
    () => section.loop.flatMap((b, i) => b.chords.map((_, j) => ({ bar: i, idx: j }))),
    [section.loop],
  );
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e)) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        if (!blocks.length) return;
        e.preventDefault();
        const cur = sel ? blocks.findIndex((b) => b.bar === sel.bar && b.idx === sel.idx) : -1;
        const n = e.key === "ArrowRight" ? Math.min(blocks.length - 1, cur + 1) : Math.max(0, cur < 0 ? blocks.length - 1 : cur - 1);
        setSel(blocks[n]);
      } else if ((e.key === "Backspace" || e.key === "Delete") && sel) {
        e.preventDefault();
        removeSel();
      } else if (e.key === "/" && sel) {
        e.preventDefault();
        toggleSplit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, blocks, removeSel, sel, toggleSplit]);

  return (
    <div className="grid min-h-0 grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-5">
        <TrackProps />

        <SectionsBar
          sections={track.sections}
          current={section}
          onSelect={setSectionId}
          onAdd={(kind) => {
            const s = newSection(track, kind, section);
            patch({ track: { ...track, sections: [...track.sections, s] } });
            setSectionId(s.id);
          }}
        />

        <SectionEditor
          section={section}
          canDelete={track.sections.length > 1}
          onPatch={(p) => patch({ track: patchSection(track, section.id, p) })}
          onDelete={() => {
            const rest = track.sections.filter((s) => s.id !== section.id);
            patch({ track: { ...track, sections: rest } });
            setSectionId(rest[0].id);
          }}
        />

        <ChordLane
          loop={section.loop}
          meter={track.meter}
          musicKey={track.key}
          notation={notation}
          sel={sel}
          onSelect={setSel}
          onAdd={addBar}
          engine={engine}
          sectionBars={section.bars}
          active={active}
        />

        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {sel && selBar ? (
            <>
              <span className="mr-1 text-xs text-text-faint">Compás {sel.bar + 1}</span>
              <button type="button" className={btn} onClick={toggleSplit} title="Tecla /">
                {selBar.chords.length > 1 ? "Unir el compás" : `Partir en el tiempo ${track.meter === "6/8" ? 2 : 3}`}
              </button>
              <button type="button" className={btn} onClick={() => move(-1)} disabled={sel.bar === 0} aria-label="Mover el compás a la izquierda">
                ← Mover
              </button>
              <button
                type="button"
                className={btn}
                onClick={() => move(1)}
                disabled={sel.bar >= section.loop.length - 1}
                aria-label="Mover el compás a la derecha"
              >
                Mover →
              </button>
              <button
                type="button"
                className={btn}
                onClick={removeSel}
                disabled={section.loop.length <= 1 && selBar.chords.length <= 1}
                title="Tecla ⌫"
              >
                Borrar
              </button>
              <button type="button" className={btnGhost} onClick={() => setSel(null)}>
                Soltar
              </button>
            </>
          ) : (
            <span className="text-xs text-text-faint">
              Elige un bloque para cambiarlo desde la paleta, partirlo, moverlo o borrarlo (←→ · / · ⌫).
            </span>
          )}
          {undo && (
            <span className="ml-auto flex items-center gap-2 text-xs text-text-dim">
              {undo.label}
              <button
                type="button"
                className={btnGhost}
                onClick={() => {
                  patch({
                    track: {
                      ...track,
                      sections: track.sections.some((s) => s.id === undo.section.id)
                        ? track.sections.map((s) => (s.id === undo.section.id ? undo.section : s))
                        : [...track.sections, undo.section],
                    },
                  });
                  setUndo(null);
                }}
              >
                Deshacer
              </button>
            </span>
          )}
        </div>
      </div>

      <aside className="min-w-0 xl:border-l xl:border-line xl:pl-6">
        <ChordPalette
          musicKey={track.key}
          notation={notation}
          hasSelection={!!sel}
          onPick={pick}
          onPreset={preset}
        />
      </aside>
    </div>
  );
}

/** Tonalidad · compás · groove · swing: las propiedades de TODA la pista. */
function TrackProps() {
  const { tema, patch } = useTemaCtx();
  const { notation } = useComposicion();
  const track = tema.track;
  const swingPct = Math.round((track.swing ?? 0) * 100);
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <KeyChip
        musicKey={track.key}
        measured={track.keySource === "medida"}
        notation={notation}
        onChoose={(k, transpose) =>
          patch({
            track: { ...(transpose ? transposeTrack(track, k) : { ...track, key: k }), keySource: "manual" },
          })
        }
      />
      <div className="flex items-center gap-1 text-xs text-text-faint" role="group" aria-label="Compás">
        <span className="mr-1">Compás</span>
        {METERS.map((m) => (
          <button key={m} type="button" className={chip(track.meter === m)} onClick={() => patch({ track: remeter(track, m) })}>
            {m}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 text-xs text-text-faint" role="group" aria-label="Groove">
        <span className="mr-1">Groove</span>
        {GROOVES.map((g) => (
          <button
            key={g}
            type="button"
            className={chip(track.groove === g)}
            onClick={() => patch({ track: { ...track, groove: g } })}
            title={g !== "clic" && track.meter !== "4/4" ? "Los grooves son de 4/4: en este compás suena el clic" : undefined}
          >
            {GROOVE_LABEL[g]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-text-faint">
        Swing
        <input
          type="range"
          min={0}
          max={50}
          step={5}
          value={swingPct}
          onChange={(e) => {
            const v = Number(e.target.value) / 100;
            patch({ track: { ...track, swing: v > 0 ? v : undefined } });
          }}
          className="w-24 accent-accent"
          aria-label="Swing de las semicorcheas"
        />
        <span className="w-9 font-mono tabular-nums text-text-dim">{swingPct} %</span>
      </label>
      {track.meter !== "4/4" && track.groove !== "clic" && (
        <span className="text-xs text-amber">En {track.meter} el groove suena como clic (los patrones son de 4/4).</span>
      )}
    </div>
  );
}

/** Chip de tonalidad con la rejilla de 12 tónicas + Mayor/menor (patrón del KeyPicker de Canciones). */
function KeyChip({
  musicKey,
  measured,
  notation,
  onChoose,
}: {
  musicKey: Key;
  measured: boolean;
  notation: "en" | "latin";
  onChoose: (k: Key, transpose: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [transpose, setTranspose] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const name = (pc: number) =>
    notation === "latin" ? latinName(pc, { tonic: pc, mode: "major" }) : TONICS[pc].sharp.includes("#") ? `${TONICS[pc].sharp}/${TONICS[pc].flat}` : TONICS[pc].sharp;
  const choose = (k: Key) => onChoose(k, transpose);

  return (
    <div ref={ref} className="relative flex items-center gap-2 text-xs text-text-faint">
      Tonalidad
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm border border-line px-2 py-1 text-xs text-text transition-colors hover:border-line-2"
      >
        {keyLabel(musicKey, notation)}
        {measured && <span className="text-text-faint">· medida</span>}
        <span aria-hidden className="text-text-faint">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-md border border-line bg-panel p-2.5 shadow-[var(--shadow-pop)]">
          <div className="grid grid-cols-4 gap-1">
            {TONICS.map((t) => (
              <button
                key={t.pc}
                type="button"
                onClick={() => choose({ tonic: t.pc, mode: musicKey.mode })}
                className={`cursor-pointer rounded-sm border px-1 py-1 font-mono text-xs ${
                  musicKey.tonic === t.pc ? "border-accent bg-accent/12 text-accent" : "border-line text-text-dim hover:border-line-2 hover:text-text"
                }`}
              >
                {name(t.pc)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(["major", "minor"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => choose({ tonic: musicKey.tonic, mode: m })}
                className={`cursor-pointer rounded-sm border px-2 py-1 text-xs ${
                  musicKey.mode === m ? "border-accent bg-accent/12 text-accent" : "border-line text-text-dim hover:text-text"
                }`}
              >
                {m === "major" ? "Mayor" : "menor"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {relatedKeys(musicKey)
              .slice(0, 2)
              .map((r) => (
                <button key={r.label} type="button" className={btnGhost} onClick={() => choose(r.key)}>
                  {r.label}: {keyLabel(r.key, notation)}
                </button>
              ))}
          </div>
          <Toggle size="sm" checked={transpose} onChange={setTranspose} label="Transponer los acordes al cambiar" />
          {measured && (
            <p className="text-xs text-text-faint">La tonalidad actual se midió del tarareo: es aproximada.</p>
          )}
        </div>
      )}
    </div>
  );
}

function SectionsBar({
  sections,
  current,
  onSelect,
  onAdd,
}: {
  sections: TemaSection[];
  current: TemaSection;
  onSelect: (id: string) => void;
  onAdd: (kind: SectionKind) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Secciones">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          role="tab"
          aria-selected={s.id === current.id}
          onClick={() => onSelect(s.id)}
          className={chip(s.id === current.id)}
        >
          {s.label} <span className="text-text-faint tabular-nums">{s.bars} c.</span>
        </button>
      ))}
      {adding ? (
        <span className="flex flex-wrap items-center gap-1 rounded-sm border border-line px-1 py-0.5">
          {ADDABLE.map((k) => (
            <button
              key={k}
              type="button"
              className={btnGhost}
              onClick={() => {
                onAdd(k);
                setAdding(false);
              }}
            >
              {SECTION_LABEL[k]}
            </button>
          ))}
          <button type="button" className={btnGhost} onClick={() => setAdding(false)} aria-label="Cancelar">
            ×
          </button>
        </span>
      ) : (
        <button type="button" className={btnGhost} onClick={() => setAdding(true)}>
          + Sección
        </button>
      )}
    </div>
  );
}

function SectionEditor({
  section,
  canDelete,
  onPatch,
  onDelete,
}: {
  section: TemaSection;
  canDelete: boolean;
  onPatch: (p: Partial<TemaSection>) => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setConfirm(false), [section.id]);
  const setBars = (n: number) => onPatch({ bars: Math.max(1, Math.min(MAX_SECTION_BARS, Math.round(n))) });
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <LabelField
        key={section.id}
        label={section.label}
        fallback={SECTION_LABEL[section.kind]}
        onCommit={(label) => onPatch({ label })}
      />
      <label className="flex items-center gap-1.5 text-xs text-text-faint">
        Tipo
        <select
          value={section.kind}
          onChange={(e) => onPatch({ kind: e.target.value as SectionKind })}
          className="cursor-pointer rounded-sm border border-line bg-panel px-1.5 py-0.5 text-xs text-text focus:border-accent focus:outline-none"
        >
          {(Object.keys(SECTION_LABEL) as SectionKind[]).map((k) => (
            <option key={k} value={k}>
              {SECTION_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-1 text-xs text-text-faint" role="group" aria-label="Largo de la sección">
        <span className="mr-1">Largo</span>
        {[4, 8, 16].map((n) => (
          <button key={n} type="button" className={chip(section.bars === n)} onClick={() => setBars(n)}>
            {n}
          </button>
        ))}
        <button type="button" className={btnGhost} onClick={() => setBars(section.bars - 1)} aria-label="Un compás menos">
          −
        </button>
        <span className="w-6 text-center font-mono tabular-nums text-text">{section.bars}</span>
        <button type="button" className={btnGhost} onClick={() => setBars(section.bars + 1)} aria-label="Un compás más">
          +
        </button>
        <span>compases</span>
      </div>
      {canDelete &&
        (confirm ? (
          <span className="flex items-center gap-1 text-xs text-text-dim">
            ¿Borrar {section.label}?
            <button type="button" className={btn} onClick={onDelete}>
              Borrar
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirm(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className={`${btnGhost} ml-auto`} onClick={() => setConfirm(true)}>
            Borrar sección
          </button>
        ))}
    </div>
  );
}

/** Nombre de la sección: vacío no se manda; al salir vacío, vuelve el nombre del tipo. */
function LabelField({ label, fallback, onCommit }: { label: string; fallback: string; onCommit: (l: string) => void }) {
  const [draft, setDraft] = useState(label);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(label);
  }, [label, focused]);
  return (
    <input
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onCommit(e.target.value);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (!draft.trim()) {
          setDraft(label.trim() ? label : fallback);
          if (!label.trim()) onCommit(fallback);
        }
      }}
      aria-label="Nombre de la sección"
      className={`${field} w-40 text-sm`}
    />
  );
}
