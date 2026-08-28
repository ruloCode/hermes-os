"use client";

// Tracking de manos LOCAL al grafo 3D del tab MEMORIA: webcam → MediaPipe
// HandLandmarker (DOS manos, WASM local con fallback CDN — mismo pipeline que
// GestureControlProvider pero sin agente, sin WS y sin robotjs: el único
// efecto es la cámara three.js del grafo) → GraphGestureEngine → callback.
//
// Seam de QA: window.__hermesGraphHandsSim inyecta manos sintéticas por el
// MISMO motor (sin cámara) — Playwright no puede fabricar manos reales frente
// al lente; el sim ejercita matching, histéresis y mapeo a cámara de verdad.

import { useCallback, useEffect, useRef, useState } from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import {
  GraphGestureEngine,
  handFromLandmarks,
  type GraphGestureDecision,
  type Landmark,
} from "@/lib/gestures/graph-engine";

/** Frame de manos sintéticas para QA (coords YA espejadas [0,1]). */
export type SimHandsFrame = { x: number; y: number; pinch: boolean }[] | null;

declare global {
  interface Window {
    /** QA: manos sintéticas del grafo 3D (tab MEMORIA). */
    __hermesGraphHandsSim?: (hands: SimHandsFrame) => void;
    /** QA: manos sintéticas del control de UI global (UiHandsProvider). */
    __hermesUiHandsSim?: (hands: SimHandsFrame) => void;
  }
}

export type GraphHandsPhase = "idle" | "starting" | "tracking" | "error";

// Misma cámara chica y mismos assets que GestureControlProvider (constantes
// module-level de ese archivo, no exportadas — duplicarlas es el menor mal).
const VIDEO_CONSTRAINTS = { width: 640, height: 360, frameRate: 30 };
const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

export function useGraphHands(
  onDecision: (d: GraphGestureDecision) => void,
  opts?: {
    /** Bajo qué key de window se registra el seam de sim (QA). */
    simKey?: "__hermesGraphHandsSim" | "__hermesUiHandsSim";
  },
): {
  phase: GraphHandsPhase;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
} {
  const simKey = opts?.simKey ?? "__hermesGraphHandsSim";
  const [phase, setPhase] = useState<GraphHandsPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  const onDecisionRef = useRef(onDecision);
  onDecisionRef.current = onDecision;

  const aliveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const rafRef = useRef(0);
  const engineRef = useRef(new GraphGestureEngine());
  const lastVideoTimeRef = useRef(0);

  const teardown = useCallback(() => {
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    engineRef.current.reset();
    // Último frame vacío: el consumidor apaga dots/cursor sin estado colgado.
    onDecisionRef.current({
      mode: "idle",
      hands: [],
      orbit: null,
      zoom: null,
      cursor: null,
      click: null,
    });
  }, []);

  const stop = useCallback(() => {
    teardown();
    setPhase("idle");
    setError(null);
  }, [teardown]);

  const start = useCallback(async () => {
    if (aliveRef.current) return;
    setPhase("starting");
    setError(null);
    aliveRef.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      if (!aliveRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();
      videoRef.current = video;

      const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
      const localWasmOk = await fetch(`${WASM_LOCAL}/vision_wasm_internal.wasm`, { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false);
      const vision = await FilesetResolver.forVisionTasks(localWasmOk ? WASM_LOCAL : WASM_CDN);
      const createLandmarker = (modelAssetPath: string) =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "GPU" },
          runningMode: "VIDEO",
          // 4, no 2: con varias personas en cámara, las manos de un tercero
          // no deben ROBARLE los slots al usuario — el motor luego se queda
          // solo con la(s) del más cercano (filtro por tamaño de mano).
          numHands: 4,
          minHandDetectionConfidence: 0.6,
        });
      landmarkerRef.current = await createLandmarker(MODEL_LOCAL).catch(() =>
        createLandmarker(MODEL_CDN),
      );
      if (!aliveRef.current) {
        teardown();
        return;
      }

      const step = () => {
        const v = videoRef.current;
        const landmarker = landmarkerRef.current;
        if (!aliveRef.current || !v || !landmarker) return;
        const now = performance.now();
        if (v.readyState >= 2 && v.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = v.currentTime;
          const result = landmarker.detectForVideo(v, now);
          // Aspecto REAL del video: sin él, la distancia de la pinza depende
          // de la orientación de la mano (x e y se normalizan por ejes distintos).
          const aspect = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 16 / 9;
          const inputs = (result.landmarks ?? []).map((lm) =>
            handFromLandmarks(lm as Landmark[], aspect),
          );
          onDecisionRef.current(engineRef.current.update(inputs, now));
        }
        rafRef.current = requestAnimationFrame(step);
      };
      setPhase("tracking");
      rafRef.current = requestAnimationFrame(step);
    } catch (err) {
      teardown();
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Permiso de cámara denegado — actívalo en el navegador."
          : `No se pudo iniciar el tracking: ${err instanceof Error ? err.message : err}`,
      );
      setPhase("error");
    }
  }, [teardown]);

  // Seam de simulación (vida del hook): motor PROPIO para no pelear con el de
  // la cámara si ambos corren.
  useEffect(() => {
    const simEngine = new GraphGestureEngine();
    window[simKey] = (hands) => {
      const inputs = (hands ?? []).map((h) => ({
        x: h.x,
        y: h.y,
        pinchRatio: h.pinch ? 0.1 : 1,
        scale: 0.6, // manos sintéticas del mismo "usuario" (tamaño uniforme)
      }));
      onDecisionRef.current(simEngine.update(inputs, performance.now()));
    };
    return () => {
      delete window[simKey];
    };
  }, [simKey]);

  // Desmontaje: cámara apagada SIEMPRE (privacidad primero).
  useEffect(() => () => teardown(), [teardown]);

  return { phase, error, start, stop };
}
