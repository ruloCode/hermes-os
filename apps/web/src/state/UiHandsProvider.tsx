"use client";

// Manos sobre TODA la UI de Hermes (todas las páginas, el shell persiste):
// webcam → useGraphHands (HandLandmarker 2 manos + GraphGestureEngine, el
// MISMO motor probado del grafo 3D) → capa DOM:
//  - mano abierta      → cursor de mano + anillo de foco magnético sobre lo
//                        clicable bajo el cursor (estilo visionOS)
//  - pinza RÁPIDA      → CLIC real sobre el elemento enfocado (.click()+focus)
//  - pinza sostenida   → AGARRAR y arrastrar = scroll del contenedor bajo la
//                        mano (como touchscreen: el contenido sigue la mano)
//  - dos pinzas        → (reservado; el zoom es del grafo)
// 100% local al browser: sin agente, sin robotjs — el efecto es solo DOM.
// Seguridad: se enciende SOLO por comando explícito (⌘K o chip), exclusión
// mutua con el control por gestos del SISTEMA y con las manos del grafo
// (hand-owner), y el chip del TopBar lo hace siempre visible.

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
import { useGraphHands, type GraphHandsPhase } from "@/hooks/useGraphHands";
import type { GraphGestureDecision } from "@/lib/gestures/graph-engine";
import { useGestureControl } from "@/state/GestureControlProvider";
import { claimHands, releaseHands } from "@/lib/gestures/hand-owner";

interface UiHandsValue {
  phase: GraphHandsPhase;
  error: string | null;
  active: boolean;
  /** Mano visible en el encuadre (para el chip). */
  handVisible: boolean;
  pinching: boolean;
  start: () => Promise<void>;
  stop: () => void;
}

const UiHandsContext = createContext<UiHandsValue | null>(null);

// Qué cuenta como clicable para el anillo de foco y el tap.
const CLICKABLE = 'a,button,[role="button"],input,select,textarea,summary,label';

// El contenido sigue la mano: 10% del encuadre ≈ 14% del viewport de scroll.
const SCROLL_GAIN = 1.4;

/** Elemento clicable bajo el punto (px de viewport), o null. */
function clickableAt(x: number, y: number): HTMLElement | null {
  const el = document.elementFromPoint(x, y);
  const c = el?.closest<HTMLElement>(CLICKABLE) ?? null;
  if (!c || (c as HTMLButtonElement).disabled) return null;
  return c;
}

/** Contenedor scrolleable bajo el punto (walk-up), o el de la página. */
function scrollableAt(x: number, y: number): HTMLElement | null {
  let el = document.elementFromPoint(x, y) as HTMLElement | null;
  while (el && el !== document.body) {
    const s = getComputedStyle(el);
    if (
      (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(s.overflowY)) ||
      (el.scrollWidth > el.clientWidth + 4 && /(auto|scroll)/.test(s.overflowX))
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return (document.scrollingElement as HTMLElement | null) ?? null;
}

export function UiHandsProvider({ children }: { children: ReactNode }) {
  const sysGestures = useGestureControl();
  const [handVisible, setHandVisible] = useState(false);
  const [pinching, setPinching] = useState(false);

  const cursorRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  // Último punto del cursor (px) y estado del agarre; refs espejo para no
  // re-crear el callback del loop.
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const grabRef = useRef<HTMLElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const handVisibleRef = useRef(false);
  const pinchingRef = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  const hideOverlays = useCallback(() => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
    if (ringRef.current) ringRef.current.style.opacity = "0";
    targetRef.current = null;
    grabRef.current = null;
    lastPointRef.current = null;
  }, []);

  const onDecision = useCallback(
    (d: GraphGestureDecision) => {
      const cursor = cursorRef.current;
      const ring = ringRef.current;
      if (!cursor || !ring) return;

      // La mano que manda: la pinzada si hay, si no la primera visible.
      const hand = d.hands.find((h) => h.pinching) ?? d.hands[0] ?? null;
      if (!hand) {
        if (handVisibleRef.current) {
          handVisibleRef.current = false;
          setHandVisible(false);
          setPinching(false);
          pinchingRef.current = false;
        }
        hideOverlays();
        return;
      }
      if (!handVisibleRef.current) {
        handVisibleRef.current = true;
        setHandVisible(true);
      }
      if (hand.pinching !== pinchingRef.current) {
        pinchingRef.current = hand.pinching;
        setPinching(hand.pinching);
      }

      const px = hand.x * window.innerWidth;
      const py = hand.y * window.innerHeight;

      // Cursor de mano (DOM directo, rAF-rate).
      cursor.style.opacity = "1";
      cursor.style.transform = `translate(${px}px, ${py}px) translate(-50%, -50%) scale(${hand.pinching ? 0.7 : 1})`;
      cursor.dataset.pinch = hand.pinching ? "1" : "0";

      // ── CLIC (tap de pinza): elemento clicable en el punto del tap.
      if (d.click) {
        const cx = d.click.x * window.innerWidth;
        const cy = d.click.y * window.innerHeight;
        const target = targetRef.current ?? clickableAt(cx, cy);
        if (target) {
          // Ripple de confirmación en el cursor.
          cursor.animate(
            [
              { boxShadow: "0 0 0 0 rgba(34,211,238,0.55)" },
              { boxShadow: "0 0 0 26px rgba(34,211,238,0)" },
            ],
            { duration: 420, easing: "ease-out" },
          );
          target.focus?.({ preventScroll: true });
          target.click();
        }
      }

      // ── AGARRE: scroll del contenedor bajo el punto donde cerró la pinza.
      if (d.mode === "orbit") {
        if (!grabRef.current) {
          const at = lastPointRef.current ?? { x: px, y: py };
          grabRef.current = scrollableAt(at.x, at.y);
        }
        if (d.orbit && grabRef.current) {
          grabRef.current.scrollLeft -= d.orbit.dx * window.innerWidth * SCROLL_GAIN;
          grabRef.current.scrollTop -= d.orbit.dy * window.innerHeight * SCROLL_GAIN;
        }
        // Agarrando no hay foco: el anillo se apaga para no distraer.
        ring.style.opacity = "0";
        targetRef.current = null;
        return;
      }
      grabRef.current = null;

      // ── CURSOR: anillo de foco magnético sobre lo clicable.
      if (d.cursor) {
        lastPointRef.current = { x: px, y: py };
        const target = clickableAt(px, py);
        targetRef.current = target;
        if (target) {
          const r = target.getBoundingClientRect();
          ring.style.opacity = "1";
          ring.style.left = `${r.left - 4}px`;
          ring.style.top = `${r.top - 4}px`;
          ring.style.width = `${r.width + 8}px`;
          ring.style.height = `${r.height + 8}px`;
        } else {
          ring.style.opacity = "0";
        }
      }
    },
    [hideOverlays],
  );

  const hands = useGraphHands(onDecision, { simKey: "__hermesUiHandsSim" });
  const active = hands.phase === "tracking" || hands.phase === "starting";

  const stop = useCallback(() => {
    releaseHands("ui");
    stopRef.current();
    hideOverlays();
    setHandVisible(false);
    setPinching(false);
    handVisibleRef.current = false;
    pinchingRef.current = false;
  }, [hideOverlays]);
  stopRef.current = hands.stop;

  const start = useCallback(async () => {
    if (sysGestures.active) return; // el cursor del SISTEMA tiene prioridad
    claimHands("ui", stop);
    await hands.start();
  }, [hands, stop, sysGestures.active]);

  // Exclusión con el control por gestos del sistema (cursor del Mac).
  useEffect(() => {
    if (sysGestures.active && active) stop();
  }, [sysGestures.active, active, stop]);

  const value = useMemo<UiHandsValue>(
    () => ({
      phase: hands.phase,
      error: hands.error,
      active,
      handVisible,
      pinching,
      start,
      stop,
    }),
    [hands.phase, hands.error, active, handVisible, pinching, start, stop],
  );

  return (
    <UiHandsContext.Provider value={value}>
      {children}
      {/* Overlays SIEMPRE montados (opacity 0): DOM directo sin re-render. */}
      <div
        ref={ringRef}
        aria-hidden
        className="pointer-events-none fixed z-[190] rounded-md border-2 border-violet/80 opacity-0 shadow-[0_0_14px_rgba(139,92,246,0.35)]"
        style={{
          transition:
            "left 130ms ease-out, top 130ms ease-out, width 130ms ease-out, height 130ms ease-out, opacity 150ms",
        }}
      />
      <div
        ref={cursorRef}
        aria-hidden
        data-pinch="0"
        className="pointer-events-none fixed left-0 top-0 z-[191] h-6 w-6 rounded-full border-2 opacity-0 transition-opacity duration-200 data-[pinch=0]:border-cyan data-[pinch=1]:border-red"
        style={{ boxShadow: "0 0 12px rgba(34,211,238,0.45)" }}
      >
        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current text-cyan" />
      </div>
    </UiHandsContext.Provider>
  );
}

export function useUiHands(): UiHandsValue {
  const ctx = useContext(UiHandsContext);
  if (!ctx) throw new Error("useUiHands requiere UiHandsProvider");
  return ctx;
}
