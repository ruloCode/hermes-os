"use client";

/**
 * Chips de TONALIDAD del memo (patrón Mobbin: el chip "Key: A Maj" que abre un
 * popover con dos filas estilo piano + Mayor/menor). Tres usos: la tonalidad
 * medida de la voz (con sus candidatas y confianza — una medida, no una
 * certeza), la del instrumento, y la DESTINO (la de la canción o una elegida).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { KeyEstimate } from "@hermes/shared";
import { keyLabel, TONICS, latinName, type Key } from "@/lib/music-theory";
import { chip } from "./ui";
import { pct } from "./format";

function Popover({
  label,
  title,
  children,
  tone = "default",
}: {
  label: ReactNode;
  title?: string;
  children: (close: () => void) => ReactNode;
  tone?: "default" | "target";
}) {
  const [open, setOpen] = useState(false);
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
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-xs transition-colors ${
          tone === "target"
            ? "border-accent/50 text-text hover:border-accent"
            : "border-line text-text-dim hover:border-line-2 hover:text-text"
        }`}
      >
        {label}
        <span aria-hidden className="text-text-faint">
          ▾
        </span>
      </button>
      {open && (
        <div className="absolute top-full left-0 z-20 mt-1 min-w-56 rounded-md border border-line bg-panel p-2 shadow-[var(--shadow-pop)]">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/** Tonalidad MEDIDA (voz o instrumento): la elegida + candidatas con su puntaje. */
export function EstimateChip({
  label,
  estimate,
  chosen,
  notation,
  onChoose,
}: {
  label: string;
  estimate: KeyEstimate;
  chosen: Key;
  notation: "en" | "latin";
  onChoose?: (k: Key) => void;
}) {
  const same = (a: Key, b: Key) => a.tonic === b.tonic && a.mode === b.mode;
  return (
    <Popover
      title="Medida aproximada: la confianza es el margen sobre la segunda candidata"
      label={
        <>
          <span className="text-text-faint">{label}</span>
          <span className="text-text">≈ {keyLabel(chosen, notation)}</span>
          <span className="text-text-faint">· confianza {pct(estimate.confidence)}</span>
        </>
      }
    >
      {(close) => (
        <div className="flex flex-col gap-1">
          <p className="px-1 pb-1 text-xs text-text-faint">
            Candidatas por {estimate.source === "voz" ? "las notas cantadas" : "el instrumento"} (correlación)
          </p>
          {estimate.candidates.map((c) => (
            <button
              key={`${c.key.tonic}-${c.key.mode}`}
              type="button"
              disabled={!onChoose}
              onClick={() => {
                onChoose?.(c.key);
                close();
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1 text-left text-xs disabled:cursor-default ${
                same(c.key, chosen) ? "bg-accent/12 text-accent" : "text-text hover:bg-panel-2"
              }`}
            >
              <span>{keyLabel(c.key, notation)}</span>
              <span className="font-mono text-text-faint tabular-nums">{c.score.toFixed(2)}</span>
            </button>
          ))}
          {onChoose && (
            <p className="px-1 pt-1 text-xs text-text-faint">Elige la que oyes: el análisis propone, tú decides.</p>
          )}
        </div>
      )}
    </Popover>
  );
}

/** Tonalidad DESTINO: rejilla de 12 tónicas (negras arriba, como el piano) + modo. */
export function TargetKeyChip({
  value,
  fromSong,
  notation,
  onChange,
}: {
  value: Key | null;
  fromSong: string | null;
  notation: "en" | "latin";
  onChange: (k: Key) => void;
}) {
  const nm = (pc: number, sharp: string) => (notation === "latin" ? latinName(pc, { tonic: pc, mode: "major" }) : sharp);
  return (
    <Popover
      tone="target"
      label={
        value ? (
          <>
            <span className="text-text-faint">Destino</span>
            <span>{keyLabel(value, notation)}</span>
            {fromSong && <span className="max-w-[16ch] truncate text-text-faint">· {fromSong}</span>}
          </>
        ) : (
          <span>Elegir tonalidad destino</span>
        )
      }
    >
      {(close) => (
        <div className="flex w-64 flex-col gap-2">
          <div className="grid grid-cols-6 gap-1">
            {TONICS.map((t) => (
              <button
                key={t.pc}
                type="button"
                onClick={() => {
                  onChange({ tonic: t.pc, mode: value?.mode ?? "minor" });
                }}
                className={`rounded-sm border px-1 py-1 font-mono text-xs ${
                  value?.tonic === t.pc
                    ? "border-accent bg-accent/12 text-accent"
                    : t.sharp.includes("#")
                      ? "border-line bg-panel-2 text-text-dim hover:text-text"
                      : "border-line text-text hover:border-line-2"
                }`}
              >
                {nm(t.pc, t.sharp)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1">
            {(["major", "minor"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onChange({ tonic: value?.tonic ?? 0, mode: m })}
                className={chip(value?.mode === m)}
              >
                {m === "major" ? "Mayor" : "menor"}
              </button>
            ))}
          </div>
          <button type="button" className="self-end text-xs text-text-dim hover:text-text" onClick={close}>
            listo
          </button>
        </div>
      )}
    </Popover>
  );
}
