"use client";

/**
 * LATENCIA de grabar sobre la pista: cuánto tarda el sonido en salir y la voz
 * en entrar. Sin corregirla, la toma queda corrida respecto a la rejilla y el
 * análisis lee síncopas que no cantaste.
 *
 * Tres maneras, en orden de confianza (lib/latency.ts): MEDIDA por loopback
 * (8 clics por los parlantes, uno por segundo; el micrófono los graba y se
 * mide el retardo) > lo que declara el NAVEGADOR > a OÍDO (empujón ±150 ms,
 * re-escuchando la última toma con el ajuste antes de aplicarlo). La medida se
 * guarda por par micrófono/salida (el aparato real del track, no "default") y
 * se descarta sola si la latencia de salida cambió; el empujón también va por
 * ese par.
 */
import { useEffect, useRef, useState } from "react";
import type { TemaTrack } from "@hermes/shared";
import { calibrate, saveCalibration, type LatencyEstimate } from "@/lib/latency";
import type { TrackEngine } from "@/lib/track-engine";
import { usePlaygroundApi } from "../playground/api";
import { Sheet } from "../playground/Sheet";
import { btn, btnGhost, btnPrimary } from "../playground/ui";
import { loadTakeAudio, playTake, type TakePlayback } from "./take-audio";

export const NUDGE_MAX = 150;

const SOURCE_TEXT: Record<LatencyEstimate["source"], string> = {
  medida: "Medida con clics en este equipo.",
  navegador: "La que declara el navegador (salida + entrada). Es aproximada: medirla es mejor.",
  manual: "El navegador no la declara: mídela, o ajústala a oído con la última toma.",
};

export function LatencySheet({
  engine,
  base,
  nudge,
  setNudge,
  monitor,
  lastTake,
  track,
  sectionId,
  onMeasured,
  onApply,
  onClose,
}: {
  engine: TrackEngine;
  /** La mejor estimación SIN el empujón manual. */
  base: LatencyEstimate | null;
  nudge: number;
  setNudge: (ms: number) => void;
  monitor: "audifonos" | "parlantes";
  /** Última toma de la sección (para re-escuchar el ajuste y aplicarlo). */
  lastTake: { sid: string; label: string } | null;
  track: TemaTrack;
  sectionId: string;
  /** Se guardó una medida para el par `key` (el que se midió de verdad). */
  onMeasured: (key: string) => void;
  /** Aplica la latencia total a una toma (el agente corre su rejilla y la re-analiza). */
  onApply: (sid: string, latencyMs: number) => Promise<void>;
  onClose: () => void;
}) {
  const api = usePlaygroundApi();
  const [measuring, setMeasuring] = useState(false);
  const [measured, setMeasured] = useState<{ ms: number; madMs: number; deviceKey: string; outMs: number | null } | null>(
    null,
  );
  const [measureError, setMeasureError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [applyState, setApplyState] = useState<"idle" | "aplicando" | "ok" | string>("idle");
  const playRef = useRef<TakePlayback | null>(null);
  /** Corrida de la re-escucha: ■ (o cerrar) durante la descarga la invalida y ya no suena. */
  const runRef = useRef(0);

  const total = Math.max(0, (base?.ms ?? 0) + nudge);

  useEffect(
    () => () => {
      runRef.current++;
      playRef.current?.stop();
    },
    [],
  );

  const stopListen = () => {
    runRef.current++;
    const h = playRef.current;
    playRef.current = null;
    h?.stop();
    setListening(false);
  };

  const measure = async () => {
    const ac = engine.context();
    if (!ac) {
      setMeasureError("Este navegador no tiene audio web.");
      return;
    }
    stopListen();
    engine.stop();
    setMeasuring(true);
    setMeasured(null);
    setMeasureError(null);
    try {
      const r = await calibrate(ac, { clicks: 8 });
      if ("error" in r) setMeasureError(r.error);
      else setMeasured(r);
    } catch (e) {
      setMeasureError((e as Error).message);
    } finally {
      setMeasuring(false);
    }
  };

  const keepMeasure = () => {
    if (!measured) return;
    // Se guarda con la clave del par que se MIDIÓ (el track real de la calibración) y con la
    // latencia de salida de ese momento: si después cambia la salida, la medida se descarta.
    saveCalibration(measured.deviceKey, measured.ms, measured.outMs);
    setNudge(0);
    setMeasured(null);
    onMeasured(measured.deviceKey);
  };

  /** Re-escucha la última toma como quedaría con la latencia total de ahora. */
  const relisten = async () => {
    if (listening) return stopListen();
    const ac = engine.context();
    if (!ac || !lastTake) return;
    const run = ++runRef.current;
    setListening(true);
    try {
      const { session, buffer } = await loadTakeAudio(api, ac, lastTake.sid);
      // ■ o cerrar la hoja mientras bajaba: no suena.
      if (runRef.current !== run) return;
      const grid = session.take.grid;
      // Su rejilla ya trae SU latencia: el ajuste es la diferencia.
      const shift = (total - session.take.latency.ms) / 1000;
      playRef.current = playTake(engine, {
        base: track,
        sectionId,
        grid: { ...grid, downbeatSec: grid.downbeatSec + shift },
        buffer,
        withTrack: true,
        onEnd: () => {
          if (runRef.current !== run) return;
          playRef.current = null;
          setListening(false);
        },
      });
      if (!playRef.current) setListening(false);
    } catch (e) {
      if (runRef.current !== run) return;
      setListening(false);
      setApplyState((e as Error).message);
    }
  };

  const apply = async () => {
    if (!lastTake) return;
    setApplyState("aplicando");
    try {
      await onApply(lastTake.sid, Math.round(total));
      setApplyState("ok");
    } catch (e) {
      setApplyState((e as Error).message || "no se pudo aplicar");
    }
  };

  const step = (d: number) => setNudge(Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, nudge + d)));

  return (
    <Sheet
      title="Latencia de grabación"
      width={520}
      onClose={onClose}
      footer={
        <button type="button" className={btnPrimary} onClick={onClose}>
          Listo
        </button>
      }
    >
      <div className="flex flex-col gap-5 text-sm text-text-dim">
        <p>
          Lo que tarda la pista en llegarte y tu voz en entrar. Hermes lo descuenta al grabar para que cada toma caiga
          en su compás y su tiempo.
        </p>

        <div>
          <p className="font-mono text-2xl text-text tabular-nums">{Math.round(total)} ms</p>
          <p className="text-xs">
            {nudge !== 0
              ? `${base ? `${Math.round(base.ms)} ms (${base.source})` : "0 ms"} ${nudge > 0 ? "+" : "−"} ${Math.abs(nudge)} ms a oído.`
              : base
                ? SOURCE_TEXT[base.source]
                : "Todavía sin estimar: se lee del navegador al abrir el micrófono."}
          </p>
          {base?.warn && <p className="mt-1 text-xs text-amber">{base.warn}</p>}
        </div>

        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-text">Medir con clics</h4>
          <ol className="list-decimal pl-5 text-xs leading-relaxed">
            <li>Quítate los audífonos y sube los parlantes a un volumen normal.</li>
            <li>Silencio en el cuarto: van a sonar 8 clics, uno por segundo (unos 9 s).</li>
            <li>
              Si la medida sale estable, guárdala: queda para este micrófono y esta salida de audio. Si cambias de
              micrófono o de salida (audífonos Bluetooth, otros parlantes) y el navegador declara otra latencia de
              salida, la medida se deja de usar y se vuelve a pedir.
            </li>
          </ol>
          {monitor === "audifonos" && (
            <p className="text-xs text-text-faint">
              Con audífonos el micrófono no oye los clics: para medir, usa los parlantes un momento.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} onClick={measure} disabled={measuring}>
              {measuring ? "Escuchando los clics…" : measured || measureError ? "Medir otra vez" : "Medir"}
            </button>
            {measured && (
              <>
                <span className="text-xs text-text">
                  {measured.ms.toFixed(1).replace(".", ",")} ms · dispersión ±{measured.madMs.toFixed(1).replace(".", ",")} ms
                </span>
                <button type="button" className={btnPrimary} onClick={keepMeasure}>
                  Guardar para este equipo
                </button>
              </>
            )}
          </div>
          {measureError && <p className="text-xs text-red">{measureError}</p>}
        </section>

        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-medium text-text">Ajuste a oído</h4>
          <p className="text-xs">
            Si tu voz se oye atrasada respecto a la pista, súbelo; si se oye adelantada, bájalo. Pasos de 5 ms, hasta
            ±{NUDGE_MAX} ms.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center rounded-sm border border-line" aria-label="Ajuste a oído">
              <button type="button" className={`${btnGhost} px-2`} onClick={() => step(-5)} aria-label="Bajar 5 ms">
                −
              </button>
              <span className="w-20 text-center font-mono text-xs text-text tabular-nums">
                {nudge > 0 ? "+" : nudge < 0 ? "−" : ""}
                {Math.abs(nudge)} ms
              </span>
              <button type="button" className={`${btnGhost} px-2`} onClick={() => step(5)} aria-label="Subir 5 ms">
                +
              </button>
            </span>
            {nudge !== 0 && (
              <button type="button" className={btnGhost} onClick={() => setNudge(0)}>
                sin ajuste
              </button>
            )}
          </div>
          {lastTake ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btn} onClick={relisten}>
                {listening ? "■ Parar" : `▶ Re-escuchar ${lastTake.label}`}
              </button>
              <button type="button" className={btn} onClick={apply} disabled={applyState === "aplicando"}>
                Aplicar {Math.round(total)} ms a {lastTake.label}
              </button>
              {applyState === "aplicando" && <span className="text-xs">corriendo su rejilla…</span>}
              {applyState === "ok" && <span className="text-xs text-green">listo: se re-analiza con la rejilla corrida</span>}
              {applyState !== "idle" && applyState !== "aplicando" && applyState !== "ok" && (
                <span className="text-xs text-red">{applyState}</span>
              )}
            </div>
          ) : (
            <p className="text-xs text-text-faint">Graba una toma y vuelve aquí para oír el ajuste sobre ella.</p>
          )}
        </section>
      </div>
    </Sheet>
  );
}
