"use client";

// Ventanita flotante de la junta en vivo (Document Picture-in-Picture de
// Chrome): queda ENCIMA de la llamada (Meet, Teams). En la clase de inglés y
// en reuniones: el historial (lo nuevo arriba, nada se pisa), si tu voz está
// entrando y los pedidos a mano (Ayúdame… / Aportar · Pregunta · ¿De qué hablan?). Es un portal de React
// a la ventana PiP (los eventos funcionan: React escucha en el contenedor del
// portal), con los estilos y el tema del dashboard copiados al abrir.
//
// Un solo dueño en el shell (providers.tsx): la vista en vivo puede estar
// montada en /ingles y en Reuniones a la vez, y no debe abrir dos ventanas.
// Abrirla exige un gesto del usuario: por eso es un botón aparte del inicio
// (el arranque ya gasta su gesto en pedir el mic y la pestaña de Meet).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { teamWindows, type LiveHelpIntent } from "@hermes/shared";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";
import { AutoHelpToggle } from "@/components/ingles/AutoHelpToggle";
import { MeetingHelpFeed, TEAM_HELP } from "./LiveSuggestionsRail";
import { ClassHelpFeed } from "./ClassHelpFeed";
import { LiveSourceMeters, MicWarningBanner } from "./MicControls";

// window.documentPictureInPicture ya está tipado en GestureControlProvider.

interface ClassPipValue {
  /** Chrome con Document PiP. */
  supported: boolean;
  open: boolean;
  openPip(): Promise<void>;
  closePip(): void;
}

const ClassPipContext = createContext<ClassPipValue>({
  supported: false,
  open: false,
  openPip: async () => undefined,
  closePip: () => undefined,
});

export const useClassPip = () => useContext(ClassPipContext);

/** Copia estilos, clases (fuentes de next/font) y tema del documento principal. */
function mirrorDocument(target: Window): () => void {
  const doc = target.document;
  for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
    doc.head.appendChild(node.cloneNode(true));
  }
  doc.documentElement.className = document.documentElement.className;
  doc.body.className = document.body.className;
  const syncTheme = () => {
    const theme = document.documentElement.getAttribute("data-theme");
    if (theme) doc.documentElement.setAttribute("data-theme", theme);
    else doc.documentElement.removeAttribute("data-theme");
  };
  syncTheme();
  // El tema puede cambiar con la ventanita abierta.
  const obs = new MutationObserver(syncTheme);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}

export function ClassPipProvider({ children }: { children: ReactNode }) {
  const live = useLiveMeeting();
  const [win, setWin] = useState<Window | null>(null);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(!!window.documentPictureInPicture);
  }, []);

  const closePip = useCallback(() => {
    win?.close();
    setWin(null);
  }, [win]);

  const openPip = useCallback(async () => {
    if (win && !win.closed) return;
    const dpip = window.documentPictureInPicture;
    if (!dpip) return;
    let w: Window;
    try {
      w = await dpip.requestWindow({ width: 400, height: 560 });
    } catch {
      return; // sin gesto de usuario o bloqueado: la vista del dashboard sigue
    }
    w.document.title = live.isClass ? "Hermes · Clase de inglés" : "Hermes · Reunión";
    const stopMirror = mirrorDocument(w);
    w.addEventListener("pagehide", () => {
      stopMirror();
      setWin((cur) => (cur === w ? null : cur));
    });
    setWin(w);
  }, [win, live.isClass]);

  // La junta (o la clase) terminó: la ventanita sobra.
  const keep = live.active && live.phase !== "processing";
  useEffect(() => {
    if (!keep && win) {
      win.close();
      setWin(null);
    }
  }, [keep, win]);

  const value = useMemo(
    () => ({ supported, open: !!win, openPip, closePip }),
    [supported, win, openPip, closePip],
  );

  return (
    <ClassPipContext.Provider value={value}>
      {children}
      {win &&
        createPortal(live.isClass ? <ClassPipContent /> : <MeetingPipContent />, win.document.body)}
    </ClassPipContext.Provider>
  );
}

const HELP: { intent: LiveHelpIntent; label: string }[] = [
  { intent: "scaffold", label: "Ayúdame" },
  { intent: "explain", label: "¿Qué dijo?" },
  { intent: "full", label: "Dame la frase" },
];

/**
 * Lo que se ve encima de Meet: el historial de ayudas (lo más nuevo arriba,
 * nada se pisa), si tu voz está entrando, y los botones siempre a mano.
 */
function ClassPipContent() {
  const live = useLiveMeeting();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const cls = live.coachMetrics?.class;

  return (
    <div className="flex h-screen flex-col gap-2 bg-bg p-2.5 text-text">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" />
          Clase{" "}
          <span className="font-mono tabular-nums">
            {live.startedAt ? fmtLiveClock(Date.now() - live.startedAt) : ""}
          </span>
        </span>
        <LiveSourceMeters />
      </div>
      {cls && (
        <p
          className={`-mt-1 shrink-0 text-xs tabular-nums ${cls.selfShare < 0.4 ? "text-amber" : "text-text-dim"}`}
        >
          hablas {Math.round(cls.selfShare * 100)} % · {cls.corrections} correcciones
        </p>
      )}

      <MicWarningBanner compact />

      {!live.selfSpeaker && live.speakerOrder.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-text">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber" />
            ¿Cuál eres tú?
          </span>
          {live.speakerOrder.slice(0, 3).map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => live.markSelf(label)}
              className="h-6 cursor-pointer rounded-xs border border-line bg-panel px-2 text-xs text-text hover:border-line-2 hover:bg-hover"
            >
              Voz {i + 1}
            </button>
          ))}
        </div>
      )}

      <ClassHelpFeed compact />

      <div className="flex shrink-0 justify-center">
        <AutoHelpToggle />
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        {HELP.map((h) => (
          <button
            key={h.intent}
            type="button"
            onClick={() => live.suggestNow(h.intent)}
            disabled={!live.wsConnected || !live.fastCopilot}
            className="h-8 cursor-pointer rounded-sm border border-line bg-panel px-1.5 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Reunión (equipo o entrevista): el historial de sugerencias (lo más nuevo
 * arriba, nada se pisa), si tu voz está entrando, y los pedidos a mano.
 */
function MeetingPipContent() {
  const live = useLiveMeeting();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const nowMs = live.startedAt ? Date.now() - live.startedAt : 0;
  const windows = live.isTeam ? teamWindows(live.suggestions, live.segments, live.selfSpeaker) : [];
  const spoke = windows.filter((w) => w.spoke).length;
  const self = live.selfSpeaker ? live.coachMetrics?.bySpeaker[live.selfSpeaker] : undefined;
  const totalTalk = Object.values(live.coachMetrics?.bySpeaker ?? {}).reduce((a, b) => a + b.talkMs, 0);
  const share = self && totalTalk ? Math.round((self.talkMs / totalTalk) * 100) : null;
  const stats = [
    windows.length > 0
      ? `${windows.length} ventana${windows.length === 1 ? "" : "s"}${live.selfSpeaker ? ` · hablaste en ${spoke}` : ""}`
      : "",
    share !== null ? `hablas ${share} %` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex h-screen flex-col gap-2 bg-bg p-2.5 text-text">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-text-dim">
          <span aria-hidden className="pulse-dot h-1.5 w-1.5 rounded-full bg-green" />
          {live.isTeam ? "Reunión" : "Junta"}{" "}
          <span className="font-mono tabular-nums">
            {live.startedAt ? fmtLiveClock(nowMs) : ""}
          </span>
        </span>
        <LiveSourceMeters />
      </div>
      {stats && <p className="-mt-1 shrink-0 text-xs text-text-dim tabular-nums">{stats}</p>}

      <MicWarningBanner compact />

      {!live.selfSpeaker && live.speakerOrder.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-text">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber" />
            ¿Cuál eres tú?
          </span>
          {live.speakerOrder.slice(0, 4).map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => live.markSelf(label)}
              className="h-6 cursor-pointer rounded-xs border border-line bg-panel px-2 text-xs text-text hover:border-line-2 hover:bg-hover"
            >
              Voz {i + 1}
            </button>
          ))}
        </div>
      )}

      <MeetingHelpFeed compact />

      {live.isTeam ? (
        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          {TEAM_HELP.map((h) => (
            <button
              key={h.intent}
              type="button"
              onClick={() => live.suggestNow(h.intent)}
              disabled={!live.wsConnected || !live.fastCopilot}
              title={h.title}
              className="h-8 cursor-pointer rounded-sm border border-line bg-panel px-1.5 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              {h.label}
            </button>
          ))}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => live.suggestNow()}
          disabled={!live.wsConnected}
          className="h-8 shrink-0 cursor-pointer rounded-sm border border-line bg-panel px-1.5 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Soplar ahora
        </button>
      )}
    </div>
  );
}
