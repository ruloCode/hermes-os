"use client";

// QA de TEMAS (hermana de /dev/ui): la vista de Composición completa, pero
// hablándole a una API en memoria con datos SINTÉTICOS — temas, tomas,
// análisis y letras inventados, y una grabadora sin micrófono. Sirve para
// revisar la UI sin agente (o antes de reiniciarlo con las rutas nuevas) y sin
// exponer jamás material real: el repo es público.

import { useEffect } from "react";
import { ComposicionView } from "@/components/views/ComposicionView";
import { getTrackEngine } from "@/lib/track-engine";
import { startLoopRecorder } from "@/lib/loop-recorder";
import { calibrate, currentLatency } from "@/lib/latency";
import { TemasApiCtx } from "@/components/composicion/temas/api";
import { PlaygroundApiCtx } from "@/components/composicion/playground/api";
import { TemaSeamsCtx } from "@/components/composicion/temas/seams";
import { mockPlaygroundApi, mockTemasApi, syntheticRecorder } from "./mock";
// Fixtures del Montaje (se registran sobre los mapas del mock al importarse).
import "./mock-montaje";
// La guía cantada (voces, render de tonos, errores por ?guia=) y una sesión con palabras reales.
import "./mock-guia";

const SEAMS = { startRecorder: syntheticRecorder };

export default function TemasQA() {
  // Costuras de QA: el motor, la grabadora y la latencia a mano desde la consola.
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__hermesTrackEngine = getTrackEngine();
    w.__hermesLoopRecorder = { startLoopRecorder, calibrate, currentLatency };
  }, []);
  return (
    <TemasApiCtx.Provider value={mockTemasApi}>
      <PlaygroundApiCtx.Provider value={mockPlaygroundApi}>
        <TemaSeamsCtx.Provider value={SEAMS}>
          <div className="flex h-screen flex-col gap-2 bg-bg p-3">
            <p className="shrink-0 text-xs text-text-faint">
              /dev/temas · datos sintéticos en memoria (nada se guarda ni sale del navegador)
            </p>
            <ComposicionView offline />
          </div>
        </TemaSeamsCtx.Provider>
      </PlaygroundApiCtx.Provider>
    </TemasApiCtx.Provider>
  );
}
