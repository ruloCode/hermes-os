"use client";

// Control por gestos: webcam → MediaPipe HandLandmarker (WASM local, sin
// red) → GestureEngine (pinza/pose/acciones) → One Euro → WS al agente, que
// inyecta los eventos de mouse/teclado reales (robotjs). Este provider es el
// orquestador: dueño de la cámara, del loop de inferencia, del WS y del HUD
// flotante. La lógica de gestos vive en lib/gestures/engine.ts (pura); la
// inyección, en el agente.
//
// HUD flotante (Document Picture-in-Picture, Chrome): al armar se despega
// una ventanita siempre-visible con la cámara + esqueleto + estado. No es
// solo estética — los rAF de una pestaña OCULTA se congelan, y la ventana
// PiP nunca está oculta: es lo que mantiene el tracking vivo mientras
// trabajas en otra pestaña o en otra app. Sin PiP (Firefox/Safari o si el
// usuario la cierra), el loop corre en la pestaña y se pausa al ocultarla.
//
// Seguridad operativa:
//  - Nunca arranca solo: siempre lo enciende un comando explícito (⌘K).
//  - Kill switch físico: puño cerrado sostenido ~1.2s apaga todo.
//  - Sin PiP y pestaña oculta => rAF congelado => el watchdog del agente
//    suelta el botón: quedarse "agarrado" no es un estado posible.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { gesturesWsUrl } from "@/lib/hermes";
import {
  GestureEngine,
  type FrameDecision,
  type GestureAction,
  type Landmark,
} from "@/lib/gestures/engine";
import { OneEuroFilter } from "@/lib/gestures/one-euro";

// Document PiP aún no está en lib.dom de TS.
interface DocumentPip {
  requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
}
declare global {
  interface Window {
    documentPictureInPicture?: DocumentPip;
  }
}

export type GesturePhase = "idle" | "starting" | "tracking" | "error";

export interface GestureFrame {
  landmarks: Landmark[] | null;
  decision: FrameDecision | null;
  fps: number;
}

interface GestureControlValue {
  phase: GesturePhase;
  /** El agente confirmó el armado (permiso Accessibility OK). */
  armed: boolean;
  /** false = el agente no tiene permiso de Accessibility (banner de ayuda). */
  accessibility: boolean | null;
  error: string | null;
  handVisible: boolean;
  pinching: boolean;
  active: boolean;
  /** El browser soporta el HUD flotante (Document PiP — Chrome). */
  hudSupported: boolean;
  /** El HUD flotante está abierto. */
  hudOpen: boolean;
  start: (opts?: { hud?: boolean }) => Promise<void>;
  stop: () => void;
  /** Despega el HUD flotante (requiere gesto de usuario — llamar en onClick). */
  openHud: () => Promise<void>;
  /** Stream de la cámara para el preview de /dev/gestos (null si apagado). */
  getStream: () => MediaStream | null;
  /** Frames con landmarks para el overlay de debug (rAF-rate). */
  subscribeFrame: (cb: (f: GestureFrame) => void) => () => void;
}

const GestureControlContext = createContext<GestureControlValue | null>(null);

// La cámara chica basta (el modelo trabaja a 224px) y ahorra GPU.
const VIDEO_CONSTRAINTS = { width: 640, height: 360, frameRate: 30 };
const FIST_KILL_MS = 1200;
const SCROLL_GAIN = 60; // unidades robotjs por frame de movimiento vertical
const WASM_LOCAL = "/mediapipe/wasm";
const WASM_CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_LOCAL = "/mediapipe/hand_landmarker.task";
const MODEL_CDN =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Huesos de la mano para el esqueleto del HUD (índices de los 21 landmarks).
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

const ACTION_LABEL: Record<GestureAction, string> = {
  copy: "COPIAR",
  paste: "PEGAR",
  space_left: "◀ SPACE",
  space_right: "SPACE ▶",
  mission_control: "MISSION CONTROL",
};

export function GestureControlProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<GesturePhase>("idle");
  const [armed, setArmed] = useState(false);
  const [accessibility, setAccessibility] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handVisible, setHandVisible] = useState(false);
  const [pinching, setPinching] = useState(false);
  const [hudOpen, setHudOpen] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafRef = useRef(0);
  const rafWindowRef = useRef<Window | null>(null);
  const aliveRef = useRef(false);
  const engineRef = useRef(new GestureEngine());
  const filterX = useRef(new OneEuroFilter());
  const filterY = useRef(new OneEuroFilter());
  const sentPinchRef = useRef(false);
  const fistSinceRef = useRef<number | null>(null);
  const scrollLastYRef = useRef<number | null>(null);
  const scrollAccRef = useRef(0);
  const fpsRef = useRef(0);
  const lastFrameTsRef = useRef(0);
  const lastTickRef = useRef(0);
  const lastActionRef = useRef<{ label: string; at: number } | null>(null);
  const subscribersRef = useRef(new Set<(f: GestureFrame) => void>());
  // HUD flotante (Document PiP).
  const pipRef = useRef<Window | null>(null);
  const hudCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const hudStatusRef = useRef<HTMLElement | null>(null);
  // Refs espejo para leer estado dentro del loop sin re-crear callbacks.
  const handVisibleRef = useRef(false);
  const pinchingRef = useRef(false);
  const armedRef = useRef(false);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const emitFrame = useCallback((f: GestureFrame) => {
    for (const cb of subscribersRef.current) cb(f);
  }, []);

  const closeHud = useCallback(() => {
    try {
      pipRef.current?.close();
    } catch {
      /* noop */
    }
    pipRef.current = null;
    hudCtxRef.current = null;
    hudStatusRef.current = null;
    setHudOpen(false);
  }, []);

  const teardown = useCallback(() => {
    aliveRef.current = false;
    (rafWindowRef.current ?? window).cancelAnimationFrame(rafRef.current);
    rafWindowRef.current = null;
    // Soltar el botón ANTES de cerrar: el server también lo hace en el
    // detach, pero no dependas de una sola red de seguridad.
    if (sentPinchRef.current) send({ t: "pinch", down: false });
    send({ t: "disarm" });
    wsRef.current?.close();
    wsRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    videoRef.current = null;
    closeHud();
    engineRef.current.reset();
    filterX.current.reset();
    filterY.current.reset();
    sentPinchRef.current = false;
    fistSinceRef.current = null;
    scrollLastYRef.current = null;
    lastActionRef.current = null;
    setArmed(false);
    setHandVisible(false);
    setPinching(false);
    handVisibleRef.current = false;
    pinchingRef.current = false;
    armedRef.current = false;
  }, [closeHud, send]);

  const stop = useCallback(() => {
    teardown();
    setPhase("idle");
    setError(null);
  }, [teardown]);

  const fail = useCallback(
    (msg: string) => {
      teardown();
      setError(msg);
      setPhase("error");
    },
    [teardown],
  );

  // ── HUD flotante ────────────────────────────────────────────────────────
  const drawHud = useCallback(
    (lm: Landmark[] | null, decision: FrameDecision | null, now: number) => {
      const ctx = hudCtxRef.current;
      const video = videoRef.current;
      if (!ctx || !video) return;
      const W = 320;
      const H = 180;
      // Video espejado (sensación de espejo, igual que el cursor).
      ctx.save();
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, W, H);
      ctx.restore();
      if (lm) {
        const px = (x: number) => (1 - x) * W;
        const py = (y: number) => y * H;
        ctx.strokeStyle = "rgba(139, 92, 246, 0.85)";
        ctx.lineWidth = 1.5;
        for (const [a, b] of BONES) {
          ctx.beginPath();
          ctx.moveTo(px(lm[a].x), py(lm[a].y));
          ctx.lineTo(px(lm[b].x), py(lm[b].y));
          ctx.stroke();
        }
        for (let i = 0; i < lm.length; i++) {
          const isPinchPoint = i === 4 || i === 8;
          ctx.fillStyle = isPinchPoint
            ? decision?.pinching
              ? "#f43f5e"
              : "#22d3ee"
            : "rgba(139, 92, 246, 0.9)";
          ctx.beginPath();
          ctx.arc(px(lm[i].x), py(lm[i].y), isPinchPoint ? 4 : 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Flash de acción (COPIAR/PEGAR/…) durante 900ms.
      const act = lastActionRef.current;
      if (act && now - act.at < 900) {
        ctx.fillStyle = "rgba(34, 211, 238, 0.92)";
        ctx.font = "bold 18px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.fillText(act.label, W / 2, H / 2);
      }
      const status = hudStatusRef.current;
      if (status) {
        const state = !armedRef.current
          ? "SIN PERMISO"
          : decision?.pinching
            ? "PINZA"
            : decision?.pose === "scroll"
              ? "SCROLL"
              : lm
                ? "ACTIVO"
                : "SIN MANO";
        status.textContent = `${state} · ${Math.round(fpsRef.current)} fps`;
        status.style.color = decision?.pinching ? "#f43f5e" : lm ? "#22d3ee" : "#8b8fa3";
      }
    },
    [],
  );

  const openHud = useCallback(async () => {
    if (pipRef.current || !window.documentPictureInPicture) return;
    let pip: Window;
    try {
      pip = await window.documentPictureInPicture.requestWindow({ width: 336, height: 236 });
    } catch {
      return; // sin gesto de usuario o bloqueado: seguimos sin HUD
    }
    const doc = pip.document;
    doc.title = "Hermes · Gestos";
    doc.body.style.cssText =
      "margin:0;background:#07070d;font-family:ui-monospace,monospace;overflow:hidden;user-select:none";
    const canvas = doc.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    canvas.style.cssText = "display:block;width:100%;border-bottom:1px solid #26263a";
    const bar = doc.createElement("div");
    bar.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:8px 10px";
    const status = doc.createElement("span");
    status.style.cssText = "font-size:11px;letter-spacing:0.08em;color:#8b8fa3";
    status.textContent = "INICIANDO…";
    const off = doc.createElement("button");
    off.textContent = "APAGAR";
    off.style.cssText =
      "font:inherit;font-size:10px;letter-spacing:0.1em;color:#f43f5e;background:transparent;border:1px solid rgba(244,63,94,0.5);border-radius:3px;padding:3px 8px;cursor:pointer";
    off.onclick = () => stop();
    bar.append(status, off);
    doc.body.append(canvas, bar);
    hudCtxRef.current = canvas.getContext("2d");
    hudStatusRef.current = status;
    pipRef.current = pip;
    setHudOpen(true);
    // El usuario cerró la ventanita: el tracking sigue en la pestaña (y se
    // pausará si la ocultan — el watchdog del agente cubre el resto).
    pip.addEventListener("pagehide", () => {
      if (pipRef.current !== pip) return;
      pipRef.current = null;
      hudCtxRef.current = null;
      hudStatusRef.current = null;
      setHudOpen(false);
    });
  }, [stop]);

  // ── Loop: un paso = inferir → decidir → filtrar → mandar al agente ──────
  const scheduleFrame = useCallback((cb: FrameRequestCallback) => {
    // El rAF corre en la ventana PiP cuando existe: nunca está oculta, así
    // que el tracking sobrevive a cambiar de pestaña o minimizar el browser.
    const w = pipRef.current && !pipRef.current.closed ? pipRef.current : window;
    rafWindowRef.current = w;
    rafRef.current = w.requestAnimationFrame(cb);
  }, []);

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!aliveRef.current || !video || !landmarker) return;

    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastFrameTsRef.current) {
      lastFrameTsRef.current = video.currentTime;
      const result = landmarker.detectForVideo(video, now);
      const lm = (result.landmarks?.[0] as Landmark[] | undefined) ?? null;

      if (!lm) {
        // Mano perdida: soltar pinza si estaba y congelar el cursor donde va.
        if (sentPinchRef.current) {
          send({ t: "pinch", down: false });
          sentPinchRef.current = false;
        }
        engineRef.current.reset();
        filterX.current.reset();
        filterY.current.reset();
        fistSinceRef.current = null;
        scrollLastYRef.current = null;
        if (handVisibleRef.current) {
          handVisibleRef.current = false;
          setHandVisible(false);
          setPinching(false);
          pinchingRef.current = false;
        }
        drawHud(null, null, now);
        emitFrame({ landmarks: null, decision: null, fps: fpsRef.current });
      } else {
        if (!handVisibleRef.current) {
          handVisibleRef.current = true;
          setHandVisible(true);
        }
        const decision = engineRef.current.decide(lm, now);

        // Kill switch: puño sostenido apaga el control entero.
        if (decision.pose === "fist") {
          if (fistSinceRef.current === null) fistSinceRef.current = now;
          else if (now - fistSinceRef.current > FIST_KILL_MS) {
            stop();
            return;
          }
        } else {
          fistSinceRef.current = null;
        }

        // Acciones discretas (copiar/pegar/Spaces/Mission Control).
        if (decision.action) {
          send({ t: "key", action: decision.action });
          lastActionRef.current = { label: ACTION_LABEL[decision.action], at: now };
        }

        if (decision.pose === "scroll") {
          const y = lm[8].y;
          if (scrollLastYRef.current !== null) {
            // Mano sube (y baja) → contenido sube: scroll "natural".
            scrollAccRef.current += (scrollLastYRef.current - y) * SCROLL_GAIN * 10;
            const ticks = Math.trunc(scrollAccRef.current);
            if (ticks !== 0) {
              send({ t: "scroll", dy: ticks });
              scrollAccRef.current -= ticks;
            }
          }
          scrollLastYRef.current = y;
        } else {
          scrollLastYRef.current = null;
        }

        if (decision.cursor) {
          send({
            t: "move",
            x: filterX.current.filter(decision.cursor.x, now),
            y: filterY.current.filter(decision.cursor.y, now),
          });
        }

        if (decision.pinching !== sentPinchRef.current) {
          sentPinchRef.current = decision.pinching;
          send({ t: "pinch", down: decision.pinching });
          setPinching(decision.pinching);
          pinchingRef.current = decision.pinching;
        }

        drawHud(lm, decision, now);
        emitFrame({ landmarks: lm, decision, fps: fpsRef.current });
      }

      // FPS con media móvil exponencial (HUD + página de QA).
      const last = lastTickRef.current;
      if (last) fpsRef.current = fpsRef.current * 0.9 + (1000 / (now - last)) * 0.1;
      lastTickRef.current = now;
    }
    scheduleFrame(processFrame);
  }, [drawHud, emitFrame, scheduleFrame, send, stop]);

  const connectWs = useCallback(() => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(gesturesWsUrl());
    } catch {
      fail("No se pudo abrir el WS con el agente.");
      return;
    }
    wsRef.current = ws;
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      let msg: {
        t: string;
        armed?: boolean;
        available?: boolean;
        accessibility?: boolean | null;
        error?: string | null;
      };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === "hello") {
        if (!msg.available) {
          fail(`El agente no puede inyectar mouse (robotjs): ${msg.error ?? "no cargó"}`);
          return;
        }
        setAccessibility(msg.accessibility ?? null);
        send({ t: "arm" }); // el server re-verifica Accessibility al armar
      } else if (msg.t === "status") {
        setArmed(msg.armed === true);
        armedRef.current = msg.armed === true;
        if (msg.accessibility !== undefined) setAccessibility(msg.accessibility);
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (!aliveRef.current) return;
      if (ev.code === 4001) fail("Otra pestaña tomó el control por gestos.");
      else if (ev.code === 4403) fail("El control por gestos está desactivado en el agente.");
      else fail("Se perdió la conexión con el agente.");
    };
  }, [fail, send]);

  const start = useCallback(
    async (opts?: { hud?: boolean }) => {
      if (aliveRef.current) return;
      setPhase("starting");
      setError(null);
      aliveRef.current = true;

      // El HUD flotante se pide ANTES de cualquier await largo: Document PiP
      // exige un gesto de usuario vigente (el click del comando ⌘K). Desde la
      // voz no hay gesto → falla silencioso y se sigue sin HUD.
      if (opts?.hud !== false) await openHud();

      try {
        // 1. Cámara (el permiso del browser es el primer gate).
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

        // 2. MediaPipe: assets locales primero (offline), CDN de fallback.
        const { FilesetResolver, HandLandmarker } = await import("@mediapipe/tasks-vision");
        const localWasmOk = await fetch(`${WASM_LOCAL}/vision_wasm_internal.wasm`, {
          method: "HEAD",
        })
          .then((r) => r.ok)
          .catch(() => false);
        const vision = await FilesetResolver.forVisionTasks(localWasmOk ? WASM_LOCAL : WASM_CDN);
        const createLandmarker = (modelAssetPath: string) =>
          HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath, delegate: "GPU" },
            runningMode: "VIDEO",
            numHands: 1,
          });
        landmarkerRef.current = await createLandmarker(MODEL_LOCAL).catch(() =>
          createLandmarker(MODEL_CDN),
        );
        if (!aliveRef.current) {
          teardown();
          return;
        }

        // 3. WS al agente + loop de inferencia.
        connectWs();
        setPhase("tracking");
        scheduleFrame(processFrame);
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        fail(
          name === "NotAllowedError"
            ? "Permiso de cámara denegado — actívalo en el navegador."
            : `No se pudo iniciar el tracking: ${err instanceof Error ? err.message : err}`,
        );
      }
    },
    [connectWs, fail, openHud, processFrame, scheduleFrame, teardown],
  );

  // Desmontaje del provider (recarga de la app): apagar todo.
  useEffect(() => () => teardown(), [teardown]);

  const value = useMemo<GestureControlValue>(
    () => ({
      phase,
      armed,
      accessibility,
      error,
      handVisible,
      pinching,
      active: phase === "tracking" || phase === "starting",
      hudSupported: typeof window !== "undefined" && !!window.documentPictureInPicture,
      hudOpen,
      start,
      stop,
      openHud,
      getStream: () => streamRef.current,
      subscribeFrame: (cb) => {
        subscribersRef.current.add(cb);
        return () => subscribersRef.current.delete(cb);
      },
    }),
    [phase, armed, accessibility, error, handVisible, pinching, hudOpen, start, stop, openHud],
  );

  return <GestureControlContext.Provider value={value}>{children}</GestureControlContext.Provider>;
}

export function useGestureControl(): GestureControlValue {
  const ctx = useContext(GestureControlContext);
  if (!ctx) throw new Error("useGestureControl requiere GestureControlProvider");
  return ctx;
}
