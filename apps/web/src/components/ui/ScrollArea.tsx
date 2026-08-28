"use client";

import { useEffect, useRef, type ReactNode } from "react";

// Máscaras de fade por eje: el degradado a transparente en los bordes
// señala visualmente que hay más contenido para scrollear.
const MASKS: Record<"y" | "x", string> = {
  y: "linear-gradient(180deg, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
  x: "linear-gradient(90deg, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)",
};

/**
 * ScrollArea — contenedor scrolleable con fade en los bordes y riel propio.
 *
 * El mask-image desvanece el contenido en los extremos del eje de scroll
 * como pista de "hay más"; `fade="none"` lo desactiva.
 *
 * `rail` dibuja un scrollbar PROPIO (hairline + pulgar violeta con auto-hide).
 * No es capricho: desde Chrome 121 la propiedad estándar `scrollbar-width`
 * ANULA los ::-webkit-scrollbar, así que el híbrido no da control real. El riel
 * se inyecta como HERMANO del scrollable — dentro, la máscara de fade lo
 * difuminaría junto al contenido.
 */
export function ScrollArea({
  children,
  className = "",
  fade = "y",
  rail = false,
}: {
  children: ReactNode;
  className?: string;
  fade?: "y" | "x" | "none";
  rail?: boolean;
}) {
  const mask = fade === "none" ? undefined : MASKS[fade];
  const elRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = elRef.current;
    const railEl = railRef.current;
    const thumb = thumbRef.current;
    if (!rail || !el || !railEl || !thumb) return;

    const PAD = 8;
    const MIN = 30;
    let hideT: ReturnType<typeof setTimeout> | undefined;
    let track = 0;
    let maxScroll = 0;

    const sync = () => {
      const need = el.scrollHeight > el.clientHeight + 2;
      railEl.style.display = need ? "block" : "none";
      if (!need) return;
      railEl.style.top = `${el.offsetTop + PAD}px`;
      railEl.style.height = `${el.clientHeight - PAD * 2}px`;
      railEl.style.left = `${el.offsetLeft + el.clientWidth - 5}px`;
      track = el.clientHeight - PAD * 2;
      maxScroll = el.scrollHeight - el.clientHeight;
      const h = Math.max(MIN, track * (el.clientHeight / el.scrollHeight));
      const y = maxScroll ? (el.scrollTop / maxScroll) * (track - h) : 0;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translateY(${y}px)`;
    };

    const onScroll = () => {
      sync();
      railEl.classList.add("is-live");
      clearTimeout(hideT);
      hideT = setTimeout(() => railEl.classList.remove("is-live"), 900);
    };
    el.addEventListener("scroll", onScroll, { passive: true });

    // Arrastrar el pulgar
    let dragging = false;
    let startY = 0;
    let startTop = 0;
    const onDown = (e: PointerEvent) => {
      e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      startTop = el.scrollTop;
      thumb.setPointerCapture(e.pointerId);
      railEl.classList.add("is-live");
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const h = thumb.offsetHeight;
      el.scrollTop = startTop + ((e.clientY - startY) / Math.max(1, track - h)) * maxScroll;
    };
    const onUp = () => {
      dragging = false;
    };
    thumb.addEventListener("pointerdown", onDown);
    thumb.addEventListener("pointermove", onMove);
    thumb.addEventListener("pointerup", onUp);
    thumb.addEventListener("pointercancel", onUp);

    const ro = new ResizeObserver(sync);
    ro.observe(el);
    const mo = new MutationObserver(sync);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    sync();

    return () => {
      clearTimeout(hideT);
      el.removeEventListener("scroll", onScroll);
      thumb.removeEventListener("pointerdown", onDown);
      thumb.removeEventListener("pointermove", onMove);
      thumb.removeEventListener("pointerup", onUp);
      thumb.removeEventListener("pointercancel", onUp);
      ro.disconnect();
      mo.disconnect();
    };
  }, [rail]);

  const scroller = (
    <div
      ref={elRef}
      className={`overflow-auto overscroll-contain ${rail ? "hud-scroll-hide" : ""} ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
    >
      {children}
    </div>
  );

  if (!rail) return scroller;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {scroller}
      <div ref={railRef} className="hud-rail" aria-hidden>
        <div ref={thumbRef} className="hud-rail-thumb" />
      </div>
    </div>
  );
}
