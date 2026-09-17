"use client";

// Tracking de CUERPO para la Sala de Agentes 3D: webcam → MediaPipe
// PoseLandmarker (UNA persona, WASM local con fallback CDN, GPU) → world
// landmarks crudos al callback. Mismo pipeline que useGraphHands (manos),
// pero con el modelo de pose: 33 puntos en metros con origen en las caderas.
// Aquí no se suaviza ni se mapea nada: eso lo hace la lógica pura de
// @hermes/shared (sala-puppet.ts), que se prueba sin cámara.
//
// Seam de QA: window.__hermesSalaSim(landmarks | null) inyecta un cuerpo
// sintético por el MISMO callback (syntheticBody() de shared genera uno), así
// Playwright ejercita marioneta y señalar sin nadie frente al lente.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { syntheticBody, type PoseWorldLandmark } from "@hermes/shared";

export interface PoseSample {
  /** 33 world landmarks de la persona detectada, o null si no hay nadie. */
  world: PoseWorldLandmark[] | null;
  /** performance.now() del frame. */
  tMs: number;
  /** Ancho/alto del video (para el preview). */
  videoWidth: number;
  videoHeight: number;
}

declare global {
  interface Window {
    /** QA: cuerpo sintético de la Sala 3D (null = nadie en cámara). */
    __hermesSalaSim?: (world: PoseWorldLandmark[] | null) => void;
    /** QA: fabrica un cuerpo sintético (brazo levantado opcional) para __hermesSalaSim. */
    __hermesSalaSynthetic?: typeof syntheticBody;
  }
}

export type PosePhase = "idle" | "starting" | "tracking" | "error";

const VIDEO_CONSTRAINTS = { width: 640, height: 480, frameRate: 30, facingMode: "user" as const };
const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_LOCAL = "/mediapipe/pose_landmarker_lite.task";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export function usePose(onSample: (s: PoseSample) => void): {
  phase: PosePhase;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  /** El <video> vivo (para pintar un preview chico); null hasta que arranca. */
  video: HTMLVideoElement | null;
} {
  const [phase, setPhase] = useState<PosePhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  const aliveRef = useRef(false);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef(0);
  const lastVideoTimeRef = useRef(-1);
  // Mientras el seam de QA inyecta cuerpos, la cámara (real o falsa) calla:
  // si no, un frame sin persona pisa el cuerpo sintético al instante.
  const simUntilRef = useRef(0);

  const teardown = useCallback(() => {
    aliveRef.current = false;
    cancelAnimationFrame(rafRef.current);
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    setVideo(null);
    onSampleRef.current({ world: null, tMs: performance.now(), videoWidth: 0, videoHeight: 0 });
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
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.srcObject = stream;
      await v.play();
      videoRef.current = v;
      setVideo(v);

      const { FilesetResolver, PoseLandmarker } = await import("@mediapipe/tasks-vision");
      const localWasmOk = await fetch(`${WASM_LOCAL}/vision_wasm_internal.wasm`, { method: "HEAD" })
        .then((r) => r.ok)
        .catch(() => false);
      const vision = await FilesetResolver.forVisionTasks(localWasmOk ? WASM_LOCAL : WASM_CDN);
      const create = (modelAssetPath: string) =>
        PoseLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
          outputSegmentationMasks: false,
        });
      landmarkerRef.current = await create(MODEL_LOCAL).catch(() => create(MODEL_CDN));
      if (!aliveRef.current) {
        teardown();
        return;
      }

      const step = () => {
        const vid = videoRef.current;
        const landmarker = landmarkerRef.current;
        if (!aliveRef.current || !vid || !landmarker) return;
        rafRef.current = requestAnimationFrame(step);
        // Un detectForVideo por frame de VIDEO (no de pantalla): el video va a
        // 30 fps y correr el modelo dos veces sobre el mismo frame es gasto puro.
        if (vid.readyState < 2 || vid.currentTime === lastVideoTimeRef.current) return;
        lastVideoTimeRef.current = vid.currentTime;
        const now = performance.now();
        if (now < simUntilRef.current) return;
        const result = landmarker.detectForVideo(vid, now);
        const world = result.worldLandmarks?.[0] as PoseWorldLandmark[] | undefined;
        onSampleRef.current({
          world: world && world.length ? world : null,
          tMs: now,
          videoWidth: vid.videoWidth,
          videoHeight: vid.videoHeight,
        });
      };
      setPhase("tracking");
      rafRef.current = requestAnimationFrame(step);
    } catch (err) {
      teardown();
      const name = err instanceof Error ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Permiso de cámara denegado — actívalo en el navegador."
          : name === "NotFoundError"
            ? "No hay cámara disponible."
            : `No se pudo iniciar el tracking: ${err instanceof Error ? err.message : err}`,
      );
      setPhase("error");
    }
  }, [teardown]);

  // Seam de simulación: cuerpo sintético por el mismo callback.
  useEffect(() => {
    window.__hermesSalaSim = (world) => {
      const now = performance.now();
      simUntilRef.current = now + 2000;
      onSampleRef.current({ world, tMs: now, videoWidth: 640, videoHeight: 480 });
    };
    window.__hermesSalaSynthetic = syntheticBody;
    return () => {
      delete window.__hermesSalaSim;
      delete window.__hermesSalaSynthetic;
    };
  }, []);

  // Desmontaje: cámara apagada SIEMPRE.
  useEffect(() => () => teardown(), [teardown]);

  return { phase, error, start, stop, video };
}
