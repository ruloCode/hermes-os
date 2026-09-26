"use client";

/**
 * TRANSPORTE del tema, fijo abajo en TODAS las etapas: la misma pista suena en
 * loop mientras escribes la intención, armas acordes o lees la rejilla.
 * Referencias Mobbin: [untitled] (− BPM + con Tap y el número editable en su
 * sitio), Epidemic "Loopable" (el loop como unidad), el contador compás:tiempo
 * de los secuenciadores.
 *
 * El contador y el estado ▶/■ se leen del motor por rAF y se escriben por ref:
 * un estado por cuadro re-renderizaría la etapa que estás mirando. Cambiar bpm,
 * acordes o groove mientras suena NO corta: el motor sigue en la misma
 * posición musical (`engine.update` sobre la pasada de ESTA barra — el único
 * cambio en vivo del motor; cualquier otra pasada arranca de cero).
 *
 * Mientras Grabar graba, el candado del transporte (`tempoLock`) fija el bpm Y
 * la sección: cambiar cualquiera a mitad de una toma la dejaría fuera de su
 * rejilla.
 *
 * Teclado (fuera de campos): Espacio ▶/■ · T tap. Espacio cede ante un BUTTON
 * (el navegador ya le manda el clic y se dispararía dos veces).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { tapTempo } from "@hermes/shared";
import type { TrackBus, TrackPlayOptions } from "@/lib/track-engine";
import { keyLabel } from "@/lib/music-theory";
import { useComposicion } from "../ComposicionContext";
import { btnGhost, chip, plainKey, spaceOnButton } from "../playground/ui";
import { useTemaCtx } from "./TemaContext";
import { fmtBpm } from "./track-edit";
import { transportStore, useTransport, type TransportSettings } from "./transport-settings";

const BUS_LABEL: Record<TrackBus, string> = { pista: "Pista", metro: "Clic", guia: "Guía", toma: "Toma" };

/** 40..220 con una décima como mucho (el estimado de un tarareo trae décimas; ±1 vuelve al entero). */
const clampBpm = (n: number) => Math.max(40, Math.min(220, Math.round(n * 10) / 10));

export function TemaTransport() {
  const { tema, section, setSectionId, patch, engine, active } = useTemaCtx();
  const { notation } = useComposicion();
  // Preferencias por espectador (no son del tema): un store compartido — Grabar las LEE.
  const { settings, tempoLock } = useTransport();
  const [playing, setPlaying] = useState(false);
  const [mixOpen, setMixOpen] = useState(false);
  const [tapInfo, setTapInfo] = useState<string | null>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const playingRef = useRef(false);
  /** La pasada que arrancó esta barra (Grabar, la guía o una toma arrancan las suyas). null = no es nuestra. */
  const own = useRef<number | null>(null);
  const taps = useRef<number[]>([]);
  const track = tema.track;

  const setSetting = useCallback(<K extends keyof TransportSettings>(k: K, v: TransportSettings[K]) => {
    transportStore.set({ [k]: v } as Partial<TransportSettings>);
  }, []);

  const options = useCallback(
    (countInBars: number): TrackPlayOptions => ({
      track,
      sectionId: section.id,
      countInBars,
      loop: true,
      chords: settings.chords,
      groove: settings.groove,
      metronome: settings.metronome,
      onEnd: () => {
        own.current = null;
      },
    }),
    [track, section.id, settings.chords, settings.groove, settings.metronome],
  );

  const toggle = useCallback(() => {
    if (engine.playing()) {
      engine.stop();
      return;
    }
    const { startAt, id } = engine.play(options(settings.countIn));
    own.current = startAt ? id : null;
  }, [engine, options, settings.countIn]);

  // Cambios en vivo (bpm, acordes, groove, sección) SOLO sobre la pasada de esta barra. Cambiar
  // de sección reinicia (el motor avisa onEnd a la vieja): la barra sigue siendo la dueña de la
  // nueva. Si otra pasada la cortó (la guía, una toma, Grabar), `update` no toca nada.
  useEffect(() => {
    const id = own.current;
    if (id == null) return;
    const r = engine.update(id, options(0));
    own.current = r ? r.id : null;
  }, [engine, options]);

  // Contador c.t y ▶/■ desde el motor, por rAF (solo con la vista a la vista).
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = "";
    const beats = track.meter === "4/4" ? 4 : track.meter === "3/4" ? 3 : 2;
    const loop = () => {
      const pos = engine.position();
      const text = !pos
        ? "c.1 t.1"
        : pos.bar <= 0
          ? `cuenta ${(-pos.bar) * beats + (beats - pos.beat + 1)}`
          : `c.${pos.bar} t.${pos.beat}`;
      if (text !== last && counterRef.current) {
        counterRef.current.textContent = text;
        counterRef.current.dataset.on = pos ? "1" : "0";
        last = text;
      }
      const p = engine.playing();
      if (p !== playingRef.current) {
        playingRef.current = p;
        setPlaying(p);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, engine, track.meter]);

  const setBpm = useCallback(
    (bpm: number, source: "manual" | "tap" = "manual") => {
      const b = clampBpm(bpm);
      if (b === track.bpm && source === track.bpmSource) return;
      patch({ track: { ...track, bpm: b, bpmSource: source } });
    },
    [patch, track],
  );

  const tap = useCallback(() => {
    const now = performance.now();
    const last = taps.current[taps.current.length - 1];
    if (last != null && now - last > 2000) taps.current = [];
    taps.current = [...taps.current.slice(-8), now];
    let bpm: number | null = null;
    try {
      bpm = tapTempo(taps.current);
    } catch {
      setTapInfo("tap no disponible todavía");
      return;
    }
    if (bpm == null) {
      setTapInfo("sigue marcando…");
      return;
    }
    setTapInfo(`${taps.current.length} golpes`);
    // El pulso a mano no da décimas confiables: entero.
    setBpm(Math.round(bpm), "tap");
  }, [setBpm]);

  useEffect(() => {
    if (!tapInfo) return;
    const t = setTimeout(() => setTapInfo(null), 2500);
    return () => clearTimeout(t);
  }, [tapInfo]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!plainKey(e)) return;
      if (e.key === " " && !spaceOnButton(e)) {
        e.preventDefault();
        toggle();
      } else if (e.key.toLowerCase() === "t" && !e.shiftKey && !transportStore.get().tempoLock) {
        e.preventDefault();
        tap();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, tap, toggle]);

  const sectionBars = section.bars;
  const loopBars = section.loop.length;

  return (
    <div
      data-tema-transport
      className="relative flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-md border border-line bg-panel px-3 py-2 transition-shadow duration-300 data-[flash=1]:ring-2 data-[flash=1]:ring-accent/40"
    >
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? "Detener (Espacio)" : "Tocar el loop de la sección (Espacio)"}
          title={playing ? "Detener · Espacio" : "Tocar el loop · Espacio"}
          className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full border transition-colors ${
            playing ? "border-accent bg-accent text-white" : "border-line-2 text-text hover:border-accent hover:text-accent"
          }`}
        >
          {playing ? (
            <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden>
              <rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden>
              <path d="M2.5 1.2v7.6L9 5z" fill="currentColor" />
            </svg>
          )}
        </button>
        <span
          ref={counterRef}
          data-on="0"
          className="w-[76px] font-mono text-sm tabular-nums text-text-faint data-[on=1]:text-text"
          aria-live="off"
        >
          c.1 t.1
        </span>
      </div>

      <label className="flex items-center gap-1.5 text-xs text-text-faint">
        Sección
        <select
          value={section.id}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={!!tempoLock}
          title={tempoLock ?? undefined}
          className="max-w-[18ch] cursor-pointer rounded-sm border border-line bg-panel px-1.5 py-0.5 text-xs text-text focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          aria-label="Sección que suena"
        >
          {tema.track.sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label} · {s.bars} c.
            </option>
          ))}
        </select>
        <span className="tabular-nums" title="Compases del loop de acordes · compases de la sección">
          loop {loopBars}
          {sectionBars !== loopBars ? ` de ${sectionBars}` : ""}
        </span>
      </label>

      <div className="flex items-center gap-1 text-xs" title={tempoLock ?? undefined}>
        <button
          type="button"
          className={btnGhost}
          disabled={!!tempoLock}
          onClick={(e) => setBpm(Math.round(track.bpm) - (e.shiftKey ? 5 : 1))}
          aria-label="Bajar bpm (⇧ = de 5 en 5)"
        >
          −
        </button>
        <BpmField bpm={track.bpm} onCommit={(n) => setBpm(n)} disabled={!!tempoLock} />
        <button
          type="button"
          className={btnGhost}
          disabled={!!tempoLock}
          onClick={(e) => setBpm(Math.round(track.bpm) + (e.shiftKey ? 5 : 1))}
          aria-label="Subir bpm (⇧ = de 5 en 5)"
        >
          +
        </button>
        <span className="text-text-faint">
          bpm{track.bpmSource === "estimado" ? " aprox." : track.bpmSource === "tap" ? " · tap" : ""}
        </span>
        <button
          type="button"
          className={`${btnGhost} ml-1`}
          onClick={tap}
          disabled={!!tempoLock}
          title={tempoLock ?? "Marca el pulso con clics o con la tecla T"}
        >
          Tap <kbd className="text-2xs opacity-70">T</kbd>
        </button>
        {tempoLock ? (
          <span className="text-text-faint">{tempoLock}</span>
        ) : (
          tapInfo && <span className="text-text-faint">{tapInfo}</span>
        )}
      </div>

      <div className="flex items-center gap-0.5" role="group" aria-label="Qué suena">
        <button type="button" className={chip(settings.chords)} aria-pressed={settings.chords} onClick={() => setSetting("chords", !settings.chords)}>
          Acordes
        </button>
        <button
          type="button"
          className={chip(settings.groove)}
          aria-pressed={settings.groove}
          onClick={() => setSetting("groove", !settings.groove)}
          title={
            track.groove === "clic"
              ? "El groove de la pista es solo clic"
              : track.meter !== "4/4"
                ? "En este compás el groove suena como clic"
                : `Groove ${track.groove}`
          }
        >
          Batería
        </button>
        <button
          type="button"
          data-transport-focus="clic"
          className={chip(settings.metronome)}
          aria-pressed={settings.metronome}
          onClick={() => setSetting("metronome", !settings.metronome)}
          title="Metrónomo (también el de Grabar)"
        >
          Clic
        </button>
      </div>

      <div className="flex items-center gap-0.5 text-xs text-text-faint" role="group" aria-label="Cuenta de entrada">
        <span className="mr-1">Cuenta</span>
        {([0, 1, 2] as const).map((n) => (
          <button key={n} type="button" className={chip(settings.countIn === n)} onClick={() => setSetting("countIn", n)} title={n === 0 ? "Sin cuenta" : `${n} ${n === 1 ? "compás" : "compases"} de clic antes`}>
            {n}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span className="hidden text-xs text-text-faint min-[1400px]:inline">
          {keyLabel(track.key, notation)} · {track.meter}
        </span>
        <div className="relative">
          <button type="button" className={btnGhost} onClick={() => setMixOpen((v) => !v)} aria-expanded={mixOpen}>
            Mezcla <span className="text-text-faint">▾</span>
          </button>
          {mixOpen && <MixPopover onClose={() => setMixOpen(false)} />}
        </div>
      </div>
    </div>
  );
}

/** El bpm editable en su sitio: se escribe y se confirma con Enter o al salir. */
function BpmField({ bpm, onCommit, disabled }: { bpm: number; onCommit: (n: number) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState(fmtBpm(bpm));
  useEffect(() => setDraft(fmtBpm(bpm)), [bpm]);
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (Number.isFinite(n) && n > 0) onCommit(n);
    else setDraft(fmtBpm(bpm));
  };
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, "").slice(0, 5))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(fmtBpm(bpm));
          (e.target as HTMLInputElement).blur();
        }
      }}
      inputMode="numeric"
      aria-label="Tempo en bpm"
      data-transport-focus="bpm"
      disabled={disabled}
      className="w-12 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-center font-mono text-sm tabular-nums text-text hover:border-line focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
    />
  );
}

function MixPopover({ onClose }: { onClose: () => void }) {
  const { engine } = useTemaCtx();
  const [mix, setMix] = useState(() => engine.mix());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute right-0 bottom-full z-30 mb-2 flex w-60 flex-col gap-2 rounded-md border border-line bg-panel p-3 shadow-[var(--shadow-pop)]"
    >
      <span className="text-xs text-text-faint">Volumen por bus</span>
      {(Object.keys(BUS_LABEL) as TrackBus[]).map((b) => (
        <label key={b} className="flex items-center gap-2 text-xs text-text-dim">
          <span className="w-10 shrink-0">{BUS_LABEL[b]}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(mix[b] * 100)}
            onChange={(e) => {
              const v = Number(e.target.value) / 100;
              engine.setMix({ [b]: v });
              setMix((m) => ({ ...m, [b]: v }));
            }}
            className="min-w-0 flex-1 accent-accent"
            aria-label={`Volumen de ${BUS_LABEL[b]}`}
          />
          <span className="w-8 text-right font-mono tabular-nums text-text-faint">{Math.round(mix[b] * 100)}</span>
        </label>
      ))}
    </div>
  );
}
