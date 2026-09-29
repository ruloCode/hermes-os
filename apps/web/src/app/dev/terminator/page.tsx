"use client";

// DEMO: tu versión Terminator a partir de la cámara.
//
// Página suelta fuera del shell (hermana de /dev/ui y /dev/gestos): activas la
// cámara, capturas un frame, el agente lo manda al proveedor de imagen
// (Higgsfield si hay keys, gpt-image si no — ver apps/agent/src/avatar.ts) y
// aparece el avatar al lado de la foto. Un solo estado a la vez, sin paneles.
//
// El frame se captura con canvas a 1024px de lado mayor y JPEG 0.92: es lo que
// el modelo necesita y cuesta ~150 KB, no los 3 MB del frame crudo.

import { useCallback, useEffect, useRef, useState } from "react";
import { hermesFetch } from "@/lib/hermes";

type Phase = "idle" | "live" | "countdown" | "generating" | "done" | "error";

type Result = { image: string; provider: string; ms: number; file: string };

export default function TerminatorDemo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(3);
  const [photo, setPhoto] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Qué proveedor va a responder: dato real del agente, o "ninguno".
  useEffect(() => {
    hermesFetch("/avatar/provider")
      .then((r) => r.json())
      .then((j: { provider: string | null }) => setProvider(j.provider ?? "ninguno"))
      .catch(() => setProvider("agente fuera de línea"));
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("live");
    } catch (e) {
      setError(`No pude abrir la cámara: ${(e as Error).message}`);
      setPhase("error");
    }
  };

  /** Frame actual → JPEG (lado mayor 1024). Espejado como en el preview. */
  const grabFrame = (): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const v = videoRef.current;
      if (!v || !v.videoWidth) return reject(new Error("la cámara aún no entrega video"));
      const scale = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext("2d")!;
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("canvas vacío"))), "image/jpeg", 0.92);
    });

  const capture = async () => {
    if (phase !== "live") return;
    setPhase("countdown");
    for (let n = 3; n >= 1; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 700));
    }
    let blob: Blob;
    try {
      blob = await grabFrame();
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
      return;
    }
    setPhoto(URL.createObjectURL(blob));
    setPhase("generating");
    setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const form = new FormData();
      form.append("photo", blob, "foto.jpg");
      const res = await hermesFetch("/avatar/terminator", { method: "POST", body: form });
      const j = (await res.json()) as ({ ok: true } & Result) | { ok: false; error: string };
      if (!j.ok) throw new Error(j.error);
      setResult(j);
      setPhase("done");
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    } finally {
      clearInterval(tick);
    }
  };

  const again = () => {
    setResult(null);
    setPhoto(null);
    setError(null);
    setPhase(streamRef.current ? "live" : "idle");
  };

  // Espacio = capturar (fuera de botones, que ya reciben Space solos).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || (e.target as HTMLElement)?.tagName === "BUTTON") return;
      e.preventDefault();
      if (phase === "live") void capture();
      else if (phase === "done" || phase === "error") again();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const showVideo = phase === "idle" || phase === "live" || phase === "countdown";

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-6 py-10 text-text">
      <header className="mb-8 flex w-full max-w-[1100px] items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-medium">Versión Terminator</h1>
          <p className="mt-1 text-sm text-text-dim">
            Actívate la cámara, captura, y Hermes te devuelve tu T-800.
          </p>
        </div>
        {provider && (
          <span className="rounded-full border border-line px-2.5 py-1 text-xs text-text-dim">
            proveedor · <b className="font-medium text-text">{provider}</b>
          </span>
        )}
      </header>

      <section className="grid w-full max-w-[1100px] grid-cols-1 gap-6 md:grid-cols-2">
        {/* Izquierda: cámara o la foto capturada */}
        <figure className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-panel">
          <video
            ref={videoRef}
            playsInline
            muted
            className={`h-full w-full -scale-x-100 object-cover ${showVideo ? "" : "hidden"}`}
          />
          {!showVideo && photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="Tu foto" className="h-full w-full object-cover" />
          )}
          {phase === "idle" && (
            <div className="absolute inset-0 grid place-items-center">
              <button
                type="button"
                onClick={startCamera}
                className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
              >
                Activar cámara
              </button>
            </div>
          )}
          {phase === "countdown" && (
            <div className="absolute inset-0 grid place-items-center bg-bg/40">
              <span className="text-[120px] font-light tabular-nums text-text">{count}</span>
            </div>
          )}
          <figcaption className="absolute bottom-2 left-3 text-xs text-text-faint">
            {phase === "live" ? "en vivo" : phase === "idle" ? "" : "tu foto"}
          </figcaption>
        </figure>

        {/* Derecha: el avatar */}
        <figure className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-panel">
          {result ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={result.image} alt="Tu versión Terminator" className="h-full w-full object-cover" />
          ) : (
            <div className="absolute inset-0 grid place-items-center">
              {phase === "generating" ? (
                <div className="flex flex-col items-center gap-3">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
                  <p className="text-sm text-text-dim">
                    Construyendo el endoesqueleto… <span className="tabular-nums">{elapsed}s</span>
                  </p>
                  <p className="text-xs text-text-faint">suele tardar 20–60 s</p>
                </div>
              ) : phase === "error" ? (
                <p className="max-w-[80%] text-center text-sm text-red">{error}</p>
              ) : (
                <p className="text-sm text-text-faint">Aquí aparece tu T-800</p>
              )}
            </div>
          )}
          {result && (
            <figcaption className="absolute bottom-2 left-3 text-xs text-text-faint">
              {result.provider} · {(result.ms / 1000).toFixed(1)}s
            </figcaption>
          )}
        </figure>
      </section>

      <div className="mt-6 flex items-center gap-3">
        {phase === "live" && (
          <button
            type="button"
            onClick={() => void capture()}
            className="cursor-pointer rounded-sm bg-accent px-6 py-2.5 text-sm font-medium text-bg transition-opacity hover:opacity-90"
          >
            Capturar
            <kbd className="ml-2 rounded-xs border border-bg/30 px-1 font-sans text-2xs">espacio</kbd>
          </button>
        )}
        {(phase === "done" || phase === "error") && (
          <>
            <button
              type="button"
              onClick={again}
              className="cursor-pointer rounded-sm border border-line px-5 py-2.5 text-sm text-text transition-colors hover:border-line-2"
            >
              Otra vez
            </button>
            {result && (
              <a
                href={result.image}
                download="terminator.png"
                className="rounded-sm border border-line px-5 py-2.5 text-sm text-text transition-colors hover:border-line-2"
              >
                Descargar
              </a>
            )}
          </>
        )}
      </div>

      {result && (
        <p className="mt-4 font-mono text-2xs text-text-faint">guardado en {result.file}</p>
      )}
    </main>
  );
}
