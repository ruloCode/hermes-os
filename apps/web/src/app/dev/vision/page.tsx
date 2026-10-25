"use client";

// Visión en vivo con la cámara del navegador: el mismo /vision/ws que usarán
// las gafas Ray-Ban Meta vía Hermes Phone (docs/gafas-meta.md). Sirve para
// probar el agente y los prompts sin las gafas: la app Android solo cambia de
// dónde salen los cuadros.
//
// Cuadros: miniatura de 32×24 cada 600 ms; si la escena cambió (frameDiff)
// sube un JPEG de 640 px. Al preguntar sube uno nítido de 1280 px justo
// después de la pregunta, que es el que el agente mira. Nada se guarda.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASK_FRAME_PX,
  DEFAULT_VISION_QUESTION,
  NARRATE_FRAME_PX,
  SCENE_CHANGE_MIN,
  frameDiff,
  toGray,
  type VisionMode,
  type VisionReplyKind,
  type VisionServerEvent,
} from "@hermes/shared";
import { visionWsUrl } from "@/lib/hermes";
import { spanishVoice } from "@/lib/oficina/speech";
import { useOfficeDictation } from "@/hooks/useOfficeDictation";

type Phase = "idle" | "starting" | "live" | "error";

interface Line {
  id: string;
  kind: VisionReplyKind;
  text: string;
  ms?: number;
  question?: string;
}

const THUMB_W = 32;
const THUMB_H = 24;
const SAMPLE_MS = 600;
const MAX_LINES = 30;

const CLOSE_REASONS: Record<number, string> = {
  4001: "Otra pestaña o el teléfono abrió la visión: esta se cerró.",
  4403: "La visión está apagada en el agente (HERMES_VISION=off).",
};

export default function VisionPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastThumb = useRef<Uint8Array | null>(null);
  const voiceOnRef = useRef(true);
  /** Pregunta de cada turno (id → texto), para mostrarla junto a su respuesta. */
  const questions = useRef(new Map<string, string>());

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [mode, setMode] = useState<VisionMode>("narrar");
  const [voiceOn, setVoiceOn] = useState(true);
  const [lines, setLines] = useState<Line[]>([]);
  const [current, setCurrent] = useState<Line | null>(null);
  const [frames, setFrames] = useState(0);
  const [quiet, setQuiet] = useState(0);
  const [question, setQuestion] = useState("");
  const dictation = useOfficeDictation("es-CO");

  useEffect(() => {
    voiceOnRef.current = voiceOn;
    if (!voiceOn) window.speechSynthesis?.cancel();
  }, [voiceOn]);

  const speak = useCallback((text: string) => {
    if (!voiceOnRef.current || !window.speechSynthesis) return;
    // Lo más reciente gana: una descripción vieja ya no es lo que tienes delante.
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = spanishVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "es-CO";
    u.rate = 1.07;
    window.speechSynthesis.speak(u);
  }, []);

  /** Dibuja el video a `px` de lado mayor y lo sube como JPEG. */
  const sendFrame = useCallback(async (px: number) => {
    const video = videoRef.current;
    const ws = wsRef.current;
    if (!video || !ws || ws.readyState !== WebSocket.OPEN || !video.videoWidth) return;
    const scale = Math.min(1, px / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.7));
    if (!blob || ws.readyState !== WebSocket.OPEN) return;
    ws.send(await blob.arrayBuffer());
    setFrames((n) => n + 1);
  }, []);

  /** Cada SAMPLE_MS: si la escena cambió, sube un cuadro para narrar. */
  const sample = useCallback(() => {
    const video = videoRef.current;
    if (!video?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, THUMB_W, THUMB_H);
    const thumb = toGray(ctx.getImageData(0, 0, THUMB_W, THUMB_H).data);
    const prev = lastThumb.current;
    if (prev && frameDiff(prev, thumb) < SCENE_CHANGE_MIN) return;
    lastThumb.current = thumb;
    void sendFrame(NARRATE_FRAME_PX);
  }, [sendFrame]);

  const onEvent = useCallback(
    (ev: VisionServerEvent) => {
      switch (ev.t) {
        case "ready":
          setModel(ev.model);
          setMode(ev.mode);
          break;
        case "start":
          if (ev.question) questions.current.set(ev.id, ev.question);
          setCurrent({ id: ev.id, kind: ev.kind, text: "", question: ev.question });
          break;
        case "delta":
          setCurrent((c) => (c && c.id === ev.id ? { ...c, text: c.text + ev.text } : c));
          break;
        case "say": {
          const q = questions.current.get(ev.id);
          questions.current.delete(ev.id);
          setCurrent(null);
          setLines((ls) => [{ id: ev.id, kind: ev.kind, text: ev.text, ms: ev.ms, question: q }, ...ls].slice(0, MAX_LINES));
          speak(ev.text);
          break;
        }
        case "quiet":
          setCurrent(null);
          setQuiet((n) => n + 1);
          break;
        case "error":
          setCurrent(null);
          setLines((ls) => [{ id: `err-${Date.now()}`, kind: "respuesta" as const, text: `✕ ${ev.message}` }, ...ls].slice(0, MAX_LINES));
          speak(ev.message);
          break;
      }
    },
    [speak],
  );

  const stop = useCallback(() => {
    if (loopRef.current) clearInterval(loopRef.current);
    loopRef.current = null;
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    lastThumb.current = null;
    window.speechSynthesis?.cancel();
    setCurrent(null);
    setPhase((p) => (p === "error" ? p : "idle"));
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPhase("starting");
    try {
      // "environment" = la cámara trasera en un teléfono; en la Mac, la webcam.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      setError(`No pude abrir la cámara: ${(e as Error).message}`);
      setPhase("error");
      return;
    }
    const ws = new WebSocket(visionWsUrl());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    ws.onopen = () => {
      setPhase("live");
      loopRef.current = setInterval(sample, SAMPLE_MS);
    };
    ws.onmessage = (m) => {
      if (typeof m.data !== "string") return;
      try {
        onEvent(JSON.parse(m.data) as VisionServerEvent);
      } catch {
        /* frame malformado: se ignora */
      }
    };
    ws.onclose = (e) => {
      if (wsRef.current !== ws) return; // la cerramos nosotros
      setError(CLOSE_REASONS[e.code] ?? "Se cortó la conexión con el agente.");
      setPhase("error");
      stop();
    };
  }, [onEvent, sample, stop]);

  useEffect(() => stop, [stop]);

  const ask = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      window.speechSynthesis?.cancel();
      ws.send(JSON.stringify({ t: "ask", text: text.trim() || DEFAULT_VISION_QUESTION }));
      void sendFrame(ASK_FRAME_PX); // el cuadro nítido que se mira
      setQuestion("");
    },
    [sendFrame],
  );

  const changeMode = (m: VisionMode) => {
    setMode(m);
    wsRef.current?.send(JSON.stringify({ t: "mode", mode: m }));
  };

  // Dictado: al callarte, la frase se manda como pregunta.
  useEffect(() => {
    if (dictation.state !== "ready" || !dictation.text.trim()) return;
    const said = dictation.text;
    dictation.cancel();
    ask(said);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictation.state, dictation.text]);

  const live = phase === "live";
  const listening = dictation.state === "listening" || dictation.state === "transcribing";

  return (
    <main className="flex min-h-screen flex-col items-center bg-bg px-4 py-8 text-text sm:px-6">
      <header className="mb-6 flex w-full max-w-[1100px] flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-medium">Visión en vivo</h1>
          <p className="mt-1 text-sm text-text-dim">
            Lo mismo que harán las gafas: Hermes mira por la cámara y te dice lo que tienes delante.
          </p>
        </div>
        {model && (
          <span className="rounded-full border border-line px-2.5 py-1 text-xs text-text-dim">
            modelo · <b className="font-medium text-text">{model}</b>
          </span>
        )}
      </header>

      <section className="grid w-full max-w-[1100px] grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <figure className="relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-panel">
          <video ref={videoRef} muted playsInline className={`h-full w-full object-cover ${live ? "" : "hidden"}`} />
          {!live && (
            <div className="absolute inset-0 grid place-items-center p-6">
              {phase === "starting" ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-center">
                  {error && <p className="max-w-[90%] text-sm text-red">{error}</p>}
                  <button
                    type="button"
                    onClick={start}
                    className="cursor-pointer rounded-sm border border-accent bg-accent/10 px-5 py-2.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20"
                  >
                    Abrir la cámara
                  </button>
                  <p className="text-xs text-text-faint">Los cuadros no se guardan.</p>
                </div>
              )}
            </div>
          )}
          {live && (
            <figcaption className="absolute bottom-2 left-3 flex items-center gap-2 rounded-xs bg-bg/70 px-2 py-0.5 text-xs text-text-dim">
              <span className="h-1.5 w-1.5 rounded-full bg-red" />
              {frames} cuadros enviados · calló {quiet} {quiet === 1 ? "vez" : "veces"}
            </figcaption>
          )}
        </figure>

        <div className="flex min-h-0 flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-sm border border-line p-0.5 text-sm">
              {(
                [
                  ["narrar", "Narrar"],
                  ["manual", "Solo si pregunto"],
                ] as const
              ).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  disabled={!live}
                  onClick={() => changeMode(m)}
                  className={`cursor-pointer rounded-xs px-3 py-1 transition-colors disabled:cursor-default disabled:opacity-50 ${
                    mode === m ? "bg-accent/15 text-accent" : "text-text-dim hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-dim">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />
              Decirlo en voz alta
            </label>
            {live && (
              <button
                type="button"
                onClick={stop}
                className="ml-auto cursor-pointer rounded-sm border border-line px-3 py-1 text-sm text-text-dim transition-colors hover:text-text"
              >
                Apagar
              </button>
            )}
          </div>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              ask(question);
            }}
          >
            <input
              value={listening ? [dictation.text, dictation.interim].filter(Boolean).join(" ") : question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={!live || listening}
              placeholder={listening ? "Te escucho…" : "¿Qué dice ese letrero?"}
              className="min-w-0 flex-1 rounded-sm border border-line bg-panel px-3 py-2 text-sm text-text placeholder:text-text-faint focus:border-accent focus:outline-none disabled:opacity-60"
            />
            <button
              type="button"
              disabled={!live}
              onClick={() => (listening ? dictation.stop() : (window.speechSynthesis?.cancel(), dictation.start()))}
              aria-label={listening ? "Dejar de escuchar" : "Preguntar con la voz"}
              className={`cursor-pointer rounded-sm border px-3 py-2 text-sm transition-colors disabled:cursor-default disabled:opacity-50 ${
                listening ? "border-accent bg-accent/15 text-accent" : "border-line text-text-dim hover:text-text"
              }`}
            >
              {listening ? "Escuchando" : "Hablar"}
            </button>
            <button
              type="submit"
              disabled={!live}
              className="cursor-pointer rounded-sm bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90 disabled:cursor-default disabled:opacity-50"
            >
              {question.trim() ? "Preguntar" : "¿Qué ves?"}
            </button>
          </form>
          {dictation.error && <p className="text-xs text-red">{dictation.error}</p>}

          <ol className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            {current && (
              <li className="text-base text-text">
                {current.question && <p className="text-xs text-text-dim">{current.question}</p>}
                {current.text || <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />}
              </li>
            )}
            {lines.map((l, i) => (
              <li key={l.id} className={i === 0 && !current ? "text-base text-text" : "text-sm text-text-dim"}>
                {l.question && <p className="text-xs text-text-dim">{l.question}</p>}
                <span>{l.text}</span>
                {l.ms != null && (
                  <span className="ml-2 text-xs tabular-nums text-text-dim">
                    {l.kind === "narrar" ? "narró" : "respondió"} en {(l.ms / 1000).toFixed(1)} s
                  </span>
                )}
              </li>
            ))}
            {live && !current && lines.length === 0 && (
              <li className="text-sm text-text-dim">Mueve la cámara o pregunta algo: aquí aparece lo que dice.</li>
            )}
          </ol>
        </div>
      </section>
    </main>
  );
}
