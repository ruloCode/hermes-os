"use client";

// LENTE — página suelta (fuera del shell) que muestra las sugerencias de la
// junta EN VIVO como las AI Cues de unas gafas con pantalla: una tarjeta
// corta, que se va sola. Pensada para el teléfono apoyado en la mesa, una
// segunda pantalla o una ventana pequeña encima de Meet/Teams. Es un
// ESPECTADOR: entra al WS como viewer y nunca toca el micrófono.
//
// Se ve verde sobre negro siempre (como la pantalla de las Even G2), en los
// dos temas: es la imitación de una lente, no una vista del dashboard.
//
// Controles: tocar la tarjeta / Espacio / → = siguiente · "¿Qué digo?" / A =
// pedir ayuda ahora · C = calma · S = subtítulos · H = historial.
// `?sim=1` reproduce un guion sin junta. Guía: docs/lente-gafas.md.

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { isLensLevel, LENS_TYPE_LABEL, type LensCue, type LensLevel } from "@hermes/shared";
import { useLens, type LensLink } from "@/hooks/useLens";

const LEVEL_KEY = "hermes-lente-level";
const CAPTIONS_KEY = "hermes-lente-captions";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* modo privado: la preferencia dura lo que la pestaña */
  }
}

/** Verde de la lente: el de la micro-LED, y sus atenuados. Locales a la página. */
const LENS_VARS = {
  ["--lens-fg" as string]: "#8dffb0",
  ["--lens-mid" as string]: "#58c47e",
  ["--lens-dim" as string]: "#2f6b45",
  ["--lens-line" as string]: "#173824",
} as React.CSSProperties;

const TYPE_GLYPH: Record<LensCue["type"], string> = {
  sugerencia: "›",
  respuesta: "=",
  concepto: "?",
  "dilo-asi": "↻",
  persona: "@",
  "dato-ojo": "!",
  traduccion: "⇄",
  punto: "□",
};

function linkLabel(link: LensLink): string {
  switch (link.state) {
    case "offline":
      return "Sin conexión con Hermes";
    case "waiting":
      return "Esperando una junta en vivo";
    case "connecting":
      return "Conectando…";
    case "live":
      return link.title ? `En vivo · ${link.title}` : "En vivo";
    case "ended":
      return link.title ? `Terminó · ${link.title}` : "La junta terminó";
    case "sim":
      return "Simulación";
  }
}

// useSearchParams exige un Suspense para que el build no falle al prerenderizar.
export default function LentePageRoot() {
  return (
    <Suspense>
      <LentePage />
    </Suspense>
  );
}

function LentePage() {
  const params = useSearchParams();
  const sim = params.get("sim") === "1";
  const [level, setLevel] = useState<LensLevel>("normal");
  const [captions, setCaptions] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const l = readPref(LEVEL_KEY);
    if (isLensLevel(l)) setLevel(l);
    setCaptions(readPref(CAPTIONS_KEY) === "1");
  }, []);

  const lens = useLens({ level, sim });
  const { link, view, caption, history, next, askHelp } = lens;

  const toggleLevel = useCallback(() => {
    setLevel((l) => {
      const n: LensLevel = l === "calma" ? "normal" : "calma";
      writePref(LEVEL_KEY, n);
      return n;
    });
  }, []);

  const toggleCaptions = useCallback(() => {
    setCaptions((c) => {
      writePref(CAPTIONS_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 2_500);
  }, []);

  const help = useCallback(async () => {
    const r = await askHelp();
    if (r === "ok") flash("Pidiendo ayuda…");
    else if (r === "busy") flash("Ya viene una");
    else if (r === "unavailable") flash(sim ? "En la simulación no hay junta" : "No hay junta en vivo");
    else flash("No pude pedirla");
  }, [askHelp, flash, sim]);

  // Teclado (segunda pantalla / ventana pequeña).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " " || k === "arrowright") {
        e.preventDefault();
        next();
      } else if (k === "a") void help();
      else if (k === "c") toggleLevel();
      else if (k === "s") toggleCaptions();
      else if (k === "h") setShowHistory((v) => !v);
      else if (k === "escape") setShowHistory(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, help, toggleLevel, toggleCaptions]);

  // Pantalla siempre encendida mientras la lente está abierta (solo existe en
  // contexto seguro: por http://<ip> el teléfono hay que dejarlo sin bloqueo).
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } };
    if (!nav.wakeLock) return;
    let sentinel: Sentinel | null = null;
    const acquire = () => {
      if (document.visibilityState !== "visible") return;
      nav.wakeLock?.request("screen").then((s) => (sentinel = s)).catch(() => undefined);
    };
    acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  const cue = view.cue;
  const live = link.state === "live" || link.state === "sim";

  return (
    <div
      style={LENS_VARS}
      className="fixed inset-0 flex flex-col bg-black text-[var(--lens-fg)] select-none"
    >
      {/* Estado: una línea tenue arriba. */}
      <header className="flex items-center gap-2 px-4 pt-3 text-xs text-[var(--lens-mid)]">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${live ? "bg-[var(--lens-fg)]" : "bg-[var(--lens-dim)]"}`}
        />
        <span className="min-w-0 flex-1 truncate">{linkLabel(link)}</span>
        {level === "calma" && <span>calma</span>}
      </header>

      {/* La tarjeta. Tocarla = siguiente. */}
      <button
        type="button"
        onClick={next}
        aria-label="Siguiente tarjeta"
        className="flex min-h-0 flex-1 items-center justify-center px-6 text-left outline-none"
      >
        {cue ? (
          <CueCard cue={cue} remaining={view.remaining} queued={view.queued} />
        ) : (
          <p className="text-center text-sm text-[var(--lens-dim)]">
            {link.state === "live" || link.state === "sim"
              ? level === "calma"
                ? "Solo aparece lo que va dirigido a ti"
                : "Escuchando"
              : link.state === "offline"
                ? "Revisa que el agente esté corriendo"
                : link.state === "waiting"
                  ? "Abre una junta en vivo desde Reuniones y aparecerá aquí"
                  : ""}
          </p>
        )}
      </button>

      {captions && caption && (
        <p
          className="truncate px-6 pb-2 text-sm text-[var(--lens-mid)]"
          aria-live="off"
          title={caption.text}
        >
          {caption.speaker ? `${caption.speaker}: ` : ""}
          {caption.text}
        </p>
      )}

      {notice && (
        <p role="status" className="px-6 pb-2 text-center text-xs text-[var(--lens-fg)]">
          {notice}
        </p>
      )}

      {/* Controles: tenues, para no competir con la tarjeta. */}
      <footer className="flex items-center gap-2 border-t border-[var(--lens-line)] px-3 py-2 text-xs">
        <LensButton onClick={() => void help()} strong>
          ¿Qué digo?
        </LensButton>
        <span className="flex-1" />
        <LensButton onClick={toggleLevel} pressed={level === "calma"} title="Solo lo dirigido a ti (C)">
          Calma
        </LensButton>
        <LensButton onClick={toggleCaptions} pressed={captions} title="Subtítulos (S)">
          Subtítulos
        </LensButton>
        <LensButton onClick={() => setShowHistory(true)} title="Historial (H)">
          Historial
        </LensButton>
      </footer>

      {showHistory && <History cues={history} onClose={() => setShowHistory(false)} />}
    </div>
  );
}

function CueCard({ cue, remaining, queued }: { cue: LensCue; remaining: number; queued: number }) {
  return (
    <div className="w-full max-w-[34ch]" style={{ fontSize: "clamp(24px, 7.2vw, 44px)" }}>
      <div className="mb-3 flex items-baseline gap-2 text-[0.42em] text-[var(--lens-mid)]">
        <span aria-hidden className="font-mono">
          {TYPE_GLYPH[cue.type]}
        </span>
        <span>{LENS_TYPE_LABEL[cue.type]}</span>
        {cue.title && <span className="text-[var(--lens-fg)]">· {cue.title}</span>}
        {queued > 0 && <span className="ml-auto font-mono">+{queued}</span>}
      </div>
      <p
        className={`leading-[1.2] font-medium ${cue.urgent ? "" : "opacity-85"}`}
        aria-live="polite"
      >
        {cue.text}
      </p>
      <div className="mt-4 h-0.5 w-full bg-[var(--lens-line)]">
        <div
          className={`h-full bg-[var(--lens-mid)] ${cue.pending ? "animate-pulse" : ""}`}
          style={{ width: `${Math.round(remaining * 100)}%` }}
        />
      </div>
    </div>
  );
}

function LensButton({
  children,
  onClick,
  pressed,
  strong,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  strong?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={pressed}
      className={`rounded-sm border px-3 py-1.5 transition-colors ${
        strong || pressed
          ? "border-[var(--lens-mid)] text-[var(--lens-fg)]"
          : "border-[var(--lens-line)] text-[var(--lens-mid)] hover:text-[var(--lens-fg)]"
      }`}
    >
      {children}
    </button>
  );
}

function History({ cues, onClose }: { cues: LensCue[]; onClose: () => void }) {
  return (
    <div className="absolute inset-0 flex flex-col bg-black">
      <header className="flex items-center px-4 py-3 text-sm text-[var(--lens-mid)]">
        <span className="flex-1">Lo que salió en esta lente</span>
        <button type="button" onClick={onClose} className="px-2 text-[var(--lens-fg)]">
          Cerrar
        </button>
      </header>
      <ol className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-6">
        {cues.length === 0 && <li className="text-sm text-[var(--lens-dim)]">Todavía nada.</li>}
        {cues.map((c) => (
          <li key={c.id} className="border-l border-[var(--lens-line)] pl-3">
            <p className="text-xs text-[var(--lens-mid)]">
              {formatAt(c.atMs)} · {LENS_TYPE_LABEL[c.type]}
              {c.title ? ` · ${c.title}` : ""}
            </p>
            <p className="text-base text-[var(--lens-fg)]">{c.full ?? c.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}

function formatAt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
