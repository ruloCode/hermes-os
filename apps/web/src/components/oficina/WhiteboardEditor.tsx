"use client";

// Editor de la pizarra libre de la Oficina: se dibuja con el mouse, el
// trackpad o el dedo, y "Guardar" la deja en el agente (PUT /office/whiteboard)
// para que la vea cualquiera que abra la oficina. Esc cierra (si hay trazos sin
// guardar, pregunta). Sin dependencias: canvas 2D y pointer events.

import { useEffect, useRef, useState } from "react";

const W = 1600;
const H = 1000;
const COLORS = ["#2b2d42", "#ef476f", "#3a86ff", "#2a9d8f", "#f4a261", "#9d4edd"];
const SIZES = [4, 10, 22];

const glass = "border border-line bg-panel/95 shadow-xl backdrop-blur-md";

export function WhiteboardEditor({
  image,
  saving,
  onSave,
  onClose,
}: {
  image: string | null;
  saving: boolean;
  onSave: (image: string | null) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [eraser, setEraser] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [empty, setEmpty] = useState(!image);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Arranca con el dibujo guardado.
  useEffect(() => {
    const g = canvasRef.current?.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fbfbf8";
    g.fillRect(0, 0, W, H);
    if (!image) return;
    const img = new Image();
    img.onload = () => g.drawImage(img, 0, 0, W, H);
    img.src = image;
  }, [image]);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (!dirtyRef.current || window.confirm("Hay trazos sin guardar. ¿Cerrar igual?")) closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const at = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const stroke = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const g = canvasRef.current?.getContext("2d");
    if (!g) return;
    g.strokeStyle = eraser ? "#fbfbf8" : color;
    g.lineWidth = eraser ? size * 3 : size;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(from.x, from.y);
    g.lineTo(to.x, to.y);
    g.stroke();
  };

  const clear = () => {
    const g = canvasRef.current?.getContext("2d");
    if (!g) return;
    g.fillStyle = "#fbfbf8";
    g.fillRect(0, 0, W, H);
    setDirty(true);
    setEmpty(true);
  };

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-bg/50 p-4 backdrop-blur-sm">
      <section role="dialog" aria-label="Pizarra libre" className={`flex w-[min(72rem,100%)] flex-col gap-3 rounded-2xl p-4 ${glass}`}>
        <header className="flex flex-wrap items-center gap-2">
          <h2 className="mr-2 text-base font-semibold text-text">Pizarra libre</h2>
          <div className="flex items-center gap-1" role="group" aria-label="Color">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Color ${c}`}
                aria-pressed={!eraser && color === c}
                onClick={() => {
                  setColor(c);
                  setEraser(false);
                }}
                className={`h-7 w-7 rounded-full border-2 ${!eraser && color === c ? "border-accent ring-2 ring-accent/30" : "border-line"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-1" role="group" aria-label="Grosor">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                aria-label={`Grosor ${s}`}
                aria-pressed={size === s}
                onClick={() => setSize(s)}
                className={`grid h-8 w-8 place-items-center rounded-lg ${size === s ? "bg-accent/15" : "hover:bg-panel-2"}`}
              >
                <span className="rounded-full bg-text" style={{ width: Math.max(3, s / 2), height: Math.max(3, s / 2) }} />
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={eraser}
            onClick={() => setEraser((v) => !v)}
            className={`rounded-lg px-2.5 py-1.5 text-sm ${eraser ? "bg-accent text-white" : "text-text-dim hover:bg-panel-2 hover:text-text"}`}
          >
            Borrador
          </button>
          <button type="button" onClick={clear} className="rounded-lg px-2.5 py-1.5 text-sm text-text-dim hover:bg-panel-2 hover:text-text">
            Limpiar
          </button>
          <span className="ml-auto text-xs text-text-faint">{dirty ? "sin guardar" : "guardada en el agente"}</span>
          <button
            type="button"
            disabled={saving || !dirty}
            onClick={() => {
              onSave(empty ? null : (canvasRef.current?.toDataURL("image/png") ?? null));
              setDirty(false);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!dirty || window.confirm("Hay trazos sin guardar. ¿Cerrar igual?")) onClose();
            }}
            className="rounded-md px-1.5 text-text-dim hover:text-text"
            aria-label="Cerrar"
          >
            ✕
          </button>
        </header>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="aspect-[16/10] w-full touch-none rounded-xl border border-line bg-[#fbfbf8]"
          style={{ cursor: "crosshair" }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = at(e);
            last.current = p;
            stroke(p, p);
            setDirty(true);
            if (!eraser) setEmpty(false);
          }}
          onPointerMove={(e) => {
            if (!last.current) return;
            const p = at(e);
            stroke(last.current, p);
            last.current = p;
          }}
          onPointerUp={() => (last.current = null)}
          onPointerCancel={() => (last.current = null)}
        />
        <p className="text-xs text-text-faint">Se guarda en el agente: la ve cualquiera que abra la oficina. Esc cierra.</p>
      </section>
    </div>
  );
}
