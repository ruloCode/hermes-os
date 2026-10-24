"use client";

// Ventanita flotante de la junta en vivo (Document Picture-in-Picture de
// Chrome): queda ENCIMA de la llamada (Meet, Teams) con lo urgente. En la
// clase de inglés: la ayuda que está llegando, las 2 últimas correcciones y
// los botones. En reuniones: el aporte vigente en grande, los conceptos que
// acaban de salir y Aportar · Pregunta · ¿De qué hablan? Es un portal de React
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
import { teamWindows, type LiveHelpIntent, type LiveSuggestion } from "@hermes/shared";
import { fmtLiveClock, useLiveMeeting } from "@/state/LiveMeetingProvider";
import { AutoHelpToggle } from "@/components/ingles/AutoHelpToggle";
import { splitStreamingAngle, TEAM_HELP } from "./LiveSuggestionsRail";
import { MicPicker } from "./MicPicker";

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
      w = await dpip.requestWindow({ width: 380, height: live.isClass ? 360 : 420 });
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

const HELP_LABEL: Record<string, string> = {
  andamio: "Para responder",
  explicar: "Qué dijo",
  decir: "Dilo así",
};

/** Lo que se ve encima de Meet: lo urgente arriba, los botones siempre a mano. */
function ClassPipContent() {
  const live = useLiveMeeting();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const visible = live.suggestions.filter((s) => !live.dismissed.has(s.id));
  const corrections = visible.filter((s) => s.kind === "corregir").slice(-2).reverse();
  const lastHelp: LiveSuggestion | undefined = [...visible]
    .reverse()
    .find((s) => s.kind === "andamio" || s.kind === "explicar" || s.kind === "decir");
  const streaming = live.streamingSuggestion;
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
        {cls && (
          <span
            className={`text-xs tabular-nums ${cls.selfShare < 0.4 ? "text-amber" : "text-green"}`}
          >
            hablas {Math.round(cls.selfShare * 100)} % · {cls.corrections} correcciones
          </span>
        )}
      </div>

      {/* Tu mic mudo: lo urgente va aquí, donde miras durante la llamada. */}
      {live.micSilent && (
        <div className="flex shrink-0 flex-col gap-1.5 rounded-sm border border-red/30 bg-red/5 px-2 py-1.5 text-xs leading-snug">
          <span className="flex items-center gap-1.5 font-medium text-text">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red" />
            No se oye tu micrófono — elige el que usas:
          </span>
          <MicPicker className="max-w-full" />
        </div>
      )}

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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {streaming ? (
          <div className="rounded-md border border-cyan/40 bg-cyan/5 px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
                  <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
              {HELP_LABEL[streaming.kind] ?? "Ayuda"}
            </p>
            <p className="mt-0.5 text-base leading-snug whitespace-pre-line">
              {streaming.text || "pensando…"}
              <span className="text-text-faint">▍</span>
            </p>
          </div>
        ) : lastHelp ? (
          <div className="rounded-md border border-line bg-panel px-2.5 py-2">
            <p className="text-xs font-medium text-text-dim">{HELP_LABEL[lastHelp.kind] ?? "Ayuda"}</p>
            <p className="mt-0.5 text-base leading-snug whitespace-pre-line">{lastHelp.text}</p>
          </div>
        ) : null}

        {corrections.map((c) => {
          const [said, better] = c.text.split(" → ");
          return (
            <div key={c.id} className="rounded-md border border-line bg-panel px-2.5 py-2">
              <p className="text-xs leading-snug text-text-dim line-through">{said}</p>
              <p className="text-sm leading-snug">{better ?? c.text}</p>
              {c.why && <p className="mt-0.5 text-xs leading-snug text-text-faint">{c.why}</p>}
            </div>
          );
        })}

        {!streaming && !lastHelp && corrections.length === 0 && (
          <p className="text-xs leading-snug text-text-faint">
            {live.selfSpeaker
              ? "Habla tranquilo: te ayudo cuando la profe pregunte y corrijo cuando termines."
              : "Marca cuál voz es la tuya para recibir correcciones."}
          </p>
        )}
      </div>

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

/** Un aporte de hace más de esto ya no es de "este momento": se atenúa. */
const STALE_MS = 60_000;

const MAIN_KINDS = new Set(["aportar", "preguntar", "decir", "entender"]);

const MAIN_LABEL: Record<string, string> = {
  aportar: "Aporta",
  preguntar: "Pregunta",
  decir: "Dilo así",
  entender: "De qué hablan",
};

/** Reunión (equipo o entrevista): lo que dirías ahora, en grande; lo demás, chico. */
function MeetingPipContent() {
  const live = useLiveMeeting();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const nowMs = live.startedAt ? Date.now() - live.startedAt : 0;
  const visible = live.suggestions.filter((s) => !live.dismissed.has(s.id));
  // El principal: lo último que es para DECIR (los conceptos automáticos van abajo).
  const main = [...visible]
    .reverse()
    .find((s) => MAIN_KINDS.has(s.kind) && !(s.kind === "entender" && !s.manual));
  const concepts = visible
    .filter((s) => s.kind === "entender" && !s.manual)
    .slice(-2)
    .reverse();
  const streaming = live.streamingSuggestion;
  const windows = live.isTeam ? teamWindows(live.suggestions, live.segments, live.selfSpeaker) : [];
  const spoke = windows.filter((w) => w.spoke).length;
  const self = live.selfSpeaker ? live.coachMetrics?.bySpeaker[live.selfSpeaker] : undefined;
  const totalTalk = Object.values(live.coachMetrics?.bySpeaker ?? {}).reduce((a, b) => a + b.talkMs, 0);
  const share = self && totalTalk ? Math.round((self.talkMs / totalTalk) * 100) : null;

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
        <span className="text-xs text-text-dim tabular-nums">
          {windows.length > 0 &&
            `${windows.length} ventana${windows.length === 1 ? "" : "s"}${live.selfSpeaker ? ` · hablaste en ${spoke}` : ""}`}
          {share !== null && `${windows.length ? " · " : ""}hablas ${share} %`}
        </span>
      </div>

      {/* Tu mic mudo: lo urgente va aquí, donde miras durante la llamada. */}
      {live.micSilent && (
        <div className="flex shrink-0 flex-col gap-1.5 rounded-sm border border-red/30 bg-red/5 px-2 py-1.5 text-xs leading-snug">
          <span className="flex items-center gap-1.5 font-medium text-text">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-red" />
            No se oye tu micrófono — elige el que usas:
          </span>
          <MicPicker className="max-w-full" />
        </div>
      )}

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

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {streaming ? (
          (() => {
            const { angle, body } = splitStreamingAngle(streaming.kind, streaming.text);
            return (
              <div className="rounded-md border border-cyan/40 bg-cyan/5 px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-xs font-medium text-text-dim">
                  <span aria-hidden className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-cyan" />
                  {MAIN_LABEL[streaming.kind] ?? "Ayuda"}
                  {angle ? ` · ${angle}` : ""} · {streaming.trigger}
                </p>
                <p className="mt-0.5 text-base leading-snug whitespace-pre-line">
                  {body || "pensando…"}
                  <span className="text-text-faint">▍</span>
                </p>
              </div>
            );
          })()
        ) : main ? (
          <div
            className={`rounded-md border border-line bg-panel px-2.5 py-2 ${
              nowMs - main.atMs > STALE_MS ? "opacity-50" : ""
            }`}
          >
            <p className="text-xs text-text-dim">
              {MAIN_LABEL[main.kind] ?? "Ayuda"}
              {main.angle ? ` · ${main.angle}` : ""} · {main.why} · hace{" "}
              {Math.max(0, Math.round((nowMs - main.atMs) / 1000))} s
            </p>
            <p className="mt-0.5 text-base leading-snug whitespace-pre-line">{main.text}</p>
          </div>
        ) : null}

        {concepts.map((c) => {
          const [term, ...rest] = c.text.split(" — ");
          return (
            <div key={c.id} className="rounded-md border border-line bg-panel px-2.5 py-2">
              <p className="text-xs leading-snug">
                <span className="font-semibold">{term}</span>
                {rest.length > 0 && <span className="text-text-dim"> — {rest.join(" — ")}</span>}
              </p>
            </div>
          );
        })}

        {!streaming && !main && concepts.length === 0 && (
          <p className="text-xs leading-snug text-text-faint">
            {live.isTeam
              ? "Escucho la reunión: te aviso cuando se abra una ventana para aportar y te explico lo nuevo."
              : "Escucho la junta: te sopla la respuesta cuando te pregunten."}
          </p>
        )}
      </div>

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
          disabled={!live.wsConnected || !!streaming}
          className="h-8 shrink-0 cursor-pointer rounded-sm border border-line bg-panel px-1.5 text-xs font-medium text-text transition-colors hover:border-line-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          Soplar ahora
        </button>
      )}
    </div>
  );
}
