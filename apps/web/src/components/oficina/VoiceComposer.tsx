"use client";

// Conversación por voz con un agente de la Oficina: al abrirla ya está
// escuchando; ves tu frase en vivo; al callarte queda lista para enviar (y se
// puede corregir a mano). Con control: A escucha/para/envía, X vuelve a
// grabar, B cancela. Con teclado: el botón del micrófono, Enter envía.

import type { OfficeDictation } from "@/hooks/useOfficeDictation";

export function PadGlyph({ b }: { b: "A" | "B" | "X" | "Y" | "LB" | "RB" | "RT" | "LT" | "View" | "Menu" }) {
  const color: Record<string, string> = {
    A: "bg-[#5cb85c] text-white",
    B: "bg-[#e5534b] text-white",
    X: "bg-[#3a86ff] text-white",
    Y: "bg-[#f0b429] text-[#1d1d1d]",
  };
  const round = b.length === 1;
  return (
    <span
      className={`inline-grid h-6 min-w-6 place-items-center px-1 font-mono text-xs font-bold ${
        round ? `rounded-full ${color[b]}` : "rounded-md border border-line-2 bg-panel-2 text-text"
      }`}
    >
      {b}
    </span>
  );
}

export function VoiceComposer({
  voice,
  padConnected,
  sendLabel,
  sending,
  blockedReason,
  placeholder,
  onSend,
}: {
  voice: OfficeDictation;
  padConnected: boolean;
  sendLabel: string;
  sending: boolean;
  /** Si no se puede enviar ahora (el agente sigue trabajando…), por qué. */
  blockedReason?: string | null;
  placeholder: string;
  onSend: () => void;
}) {
  const { state, text, interim, engine, error } = voice;
  const listening = state === "listening";
  const transcribing = state === "transcribing";
  const canSend = state === "ready" && !!text.trim() && !sending && !blockedReason;

  const label = listening
    ? engine === "hermes"
      ? "Te escucho… (grabando para Hermes)"
      : "Te escucho…"
    : transcribing
      ? "Transcribiendo con Hermes…"
      : state === "ready"
        ? "¿Lo envío?"
        : state === "error"
          ? `No te entendí: ${error ?? "error"}`
          : "Dile la instrucción con tu voz";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => (listening ? voice.stop() : voice.start())}
          aria-label={listening ? "Dejar de escuchar" : "Hablar"}
          className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-lg text-white transition-colors ${
            listening ? "bg-red" : "bg-accent hover:brightness-110"
          }`}
        >
          {listening ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-red opacity-40" />
              <span className="absolute -inset-1.5 animate-pulse rounded-full border-2 border-red/50" />
            </>
          ) : null}
          <span className="relative">{listening ? "■" : "🎙"}</span>
        </button>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${state === "error" ? "text-red" : "text-text"}`}>{label}</p>
          <p className="text-xs text-text-faint">
            {engine === "navegador" ? "dictado del navegador · español" : "transcripción de Hermes (Scribe → Whisper → local)"}
          </p>
        </div>
      </div>

      {state === "ready" || state === "idle" || state === "error" ? (
        <textarea
          value={text}
          onChange={(e) => voice.edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              onSend();
            }
          }}
          rows={3}
          placeholder={placeholder}
          className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-text-faint"
        />
      ) : (
        <p className="min-h-[4.5rem] rounded-lg border border-accent/40 bg-panel-2 px-3 py-2 text-base leading-snug text-text">
          {text}
          {interim ? <span className="text-text-dim"> {interim}</span> : null}
          {!text && !interim ? <span className="text-text-faint">…</span> : null}
          {listening ? <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle" /> : null}
        </p>
      )}

      {blockedReason ? <p className="text-xs text-amber">{blockedReason}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canSend}
          onClick={onSend}
          className="flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {padConnected ? <PadGlyph b="A" /> : null}
          {sending ? "Enviando…" : sendLabel}
        </button>
        <button
          type="button"
          onClick={() => voice.start()}
          className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-sm text-text-dim hover:text-text"
        >
          {padConnected ? <PadGlyph b="X" /> : null}
          Volver a hablar
        </button>
        {padConnected ? (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-text-faint">
            <PadGlyph b="B" /> cancelar
          </span>
        ) : (
          <span className="ml-auto text-xs text-text-faint">Enter envía · Esc cancela</span>
        )}
      </div>
    </div>
  );
}
