"use client";

// QA del control por gestos (hermana de /dev/ui): preview de la cámara con
// los 21 landmarks encima, estado de pinza/pose/fps y el estado real del
// agente (robotjs + Accessibility). Es la página para VALIDAR que el
// tracking se siente bien antes de usarlo sobre el sistema — y para
// diagnosticar el permiso de Accessibility cuando los eventos no llegan.

import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { StatusPill } from "@/components/ui/StatusPill";
import { DataRow } from "@/components/ui/DataRow";
import { useGestureControl, type GestureFrame } from "@/state/GestureControlProvider";

// Conexiones esqueléticas de la mano (índices de los 21 landmarks).
const BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export default function GesturesQA() {
  const g = useGestureControl();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [frame, setFrame] = useState<GestureFrame>({ landmarks: null, decision: null, fps: 0 });

  // Preview: mismo stream que usa el tracking (no abre otra cámara).
  useEffect(() => {
    if (g.phase !== "tracking") return;
    const video = videoRef.current;
    const stream = g.getStream();
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      void video.play();
    }
  }, [g, g.phase]);

  // Overlay de landmarks (canvas espejado igual que el video).
  useEffect(() => {
    const unsub = g.subscribeFrame((f) => {
      setFrame(f);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!f.landmarks) return;
      const px = (x: number) => (1 - x) * canvas.width; // espejo
      const py = (y: number) => y * canvas.height;
      ctx.strokeStyle = "rgba(139, 92, 246, 0.8)";
      ctx.lineWidth = 2;
      for (const [a, b] of BONES) {
        ctx.beginPath();
        ctx.moveTo(px(f.landmarks[a].x), py(f.landmarks[a].y));
        ctx.lineTo(px(f.landmarks[b].x), py(f.landmarks[b].y));
        ctx.stroke();
      }
      for (let i = 0; i < f.landmarks.length; i++) {
        const isPinchPoint = i === 4 || i === 8;
        ctx.fillStyle = isPinchPoint
          ? f.decision?.pinching
            ? "#f43f5e"
            : "#22d3ee"
          : "rgba(139, 92, 246, 0.9)";
        ctx.beginPath();
        ctx.arc(px(f.landmarks[i].x), py(f.landmarks[i].y), isPinchPoint ? 6 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    return unsub;
  }, [g]);

  const poseLabel =
    frame.decision?.pose === "scroll"
      ? "SCROLL (índice+medio)"
      : frame.decision?.pose === "fist"
        ? "PUÑO (sostén 1.2s = apagar)"
        : frame.decision
          ? "PUNTERO"
          : "—";

  // Flash de la última acción discreta (copiar/pegar/spaces/mission control).
  const [lastAction, setLastAction] = useState<{ label: string; at: number } | null>(null);
  useEffect(() => {
    const a = frame.decision?.action;
    if (a) setLastAction({ label: a.toUpperCase(), at: Date.now() });
  }, [frame]);
  const actionFresh = lastAction && Date.now() - lastAction.at < 1200;

  return (
    <main className="mx-auto grid max-w-[1100px] grid-cols-1 gap-3 p-4 lg:grid-cols-[2fr_1fr]">
      <Panel title="Cámara + landmarks" delay={0}>
        <div className="relative aspect-video w-full overflow-hidden rounded-sm border border-line bg-black">
          {g.phase === "tracking" ? (
            <>
              {/* El <video> va espejado para que se sienta como espejo. */}
              <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
              <canvas
                ref={canvasRef}
                width={640}
                height={360}
                className="absolute inset-0 h-full w-full"
              />
            </>
          ) : (
            <div className="grid h-full place-items-center text-2xs tracking-label text-text-dim uppercase">
              {g.phase === "starting" ? "Iniciando cámara + modelo…" : "Tracking apagado"}
            </div>
          )}
          {g.phase === "tracking" && (
            <div className="absolute top-2 left-2 flex gap-3 rounded-sm bg-black/50 px-2 py-1">
              <StatusPill
                status={frame.decision?.pinching ? "error" : g.handVisible ? "active" : "idle"}
                label={frame.decision?.pinching ? "PINZA" : poseLabel}
                pulse={frame.decision?.pinching}
              />
              <StatusPill status="ok" label={`${Math.round(frame.fps)} FPS`} />
            </div>
          )}
        </div>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => (g.active ? g.stop() : void g.start({ hud: false }))}
            className={`rounded-sm border px-3 py-1.5 text-2xs tracking-label uppercase transition-colors ${
              g.active
                ? "border-red/60 bg-red/10 text-red"
                : "border-violet/60 bg-violet/10 text-violet"
            }`}
          >
            {g.active ? "Apagar" : "Encender control por gestos"}
          </button>
          {g.active && g.hudSupported && !g.hudOpen && (
            <button
              type="button"
              onClick={() => void g.openHud()}
              className="rounded-sm border border-cyan/60 bg-cyan/10 px-3 py-1.5 text-2xs tracking-label text-cyan uppercase"
            >
              Despegar HUD flotante
            </button>
          )}
        </div>
        {g.error && <p className="mt-2 text-2xs text-red">{g.error}</p>}
        {g.accessibility === false && (
          <p className="mt-2 text-2xs leading-relaxed text-amber">
            El agente NO tiene permiso de Accessibility: el cursor no se moverá. Ve a Ajustes del
            Sistema → Privacidad y seguridad → Accesibilidad y agrega el binario de node del
            servicio (launchctl). Luego reintenta armar desde aquí.
          </p>
        )}
      </Panel>

      <Panel title="Estado" tone="cyan" delay={60}>
        <div className="flex flex-col gap-1.5">
          <DataRow label="FASE" value={g.phase.toUpperCase()} />
          <DataRow label="MANO" value={g.handVisible ? "VISIBLE" : "—"} />
          <DataRow label="POSE" value={poseLabel} />
          <DataRow
            label="PINCH RATIO"
            value={frame.decision ? frame.decision.pinchRatio.toFixed(3) : "—"}
          />
          <DataRow
            label="CURSOR"
            value={
              frame.decision?.cursor
                ? `${frame.decision.cursor.x.toFixed(2)} · ${frame.decision.cursor.y.toFixed(2)}`
                : "—"
            }
          />
          <DataRow label="ARMADO (agente)" value={g.armed ? "SÍ" : "NO"} />
          <DataRow
            label="ACCESSIBILITY"
            value={g.accessibility === null ? "?" : g.accessibility ? "OK" : "FALTA"}
          />
          <DataRow
            label="ÚLTIMA ACCIÓN"
            tone={actionFresh ? "cyan" : "neutral"}
            value={lastAction ? lastAction.label : "—"}
          />
          <DataRow label="HUD FLOTANTE" value={g.hudOpen ? "ABIERTO" : g.hudSupported ? "disponible" : "no soportado"} />
        </div>
        <div className="mt-4 flex flex-col gap-1 text-2xs leading-relaxed text-text-dim">
          <p>· Mano abierta = mover cursor (zona activa central del encuadre).</p>
          <p>· Pinza pulgar+índice = click; sostenida + mover = drag.</p>
          <p>· Pinza pulgar+MEÑIQUE = copiar (⌘C) · pulgar+ANULAR = pegar (⌘V).</p>
          <p>· Índice+medio = scroll vertical · swipe horizontal rápido = cambiar Space.</p>
          <p>· Palma abierta empujando hacia la cámara = Mission Control.</p>
          <p>· Empujar el cursor contra el borde ~300ms = cruzar al otro monitor.</p>
          <p>· Puño sostenido 1.2s = apagar todo (kill switch).</p>
          <p>· Umbral pinzas: cierra &lt;0.28 · abre &gt;0.42 (histéresis).</p>
        </div>
      </Panel>
    </main>
  );
}
