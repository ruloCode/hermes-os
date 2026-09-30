"use client";

// HUD de la Oficina: estado (arriba a la izquierda), barra de vista y
// herramientas (arriba a la derecha), lista del equipo (derecha), atajos
// (abajo) y avisos de llegada/cierre (arriba al centro). Todo con los tokens
// del tema y datos reales; lo simulado se marca como tal.

import Link from "next/link";
import { useState } from "react";
import type { OfficeWorker, OfficeWorkerStatus } from "@hermes/shared";
import type { OfficeMode } from "@/lib/oficina/office-world";
import { HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, SKIN_TONES, type OwnerLook } from "@/lib/oficina/look";
import { PadGlyph } from "./VoiceComposer";

export type Feed = "connecting" | "live" | "offline";

export const STATUS_DOT: Record<OfficeWorkerStatus, string> = {
  starting: "bg-text-faint",
  working: "bg-amber",
  thinking: "bg-cyan",
  blocked: "bg-red",
  needs_you: "bg-accent",
  done: "bg-green",
  error: "bg-red",
};

const COUNT_STYLE = [
  { key: "needs_you", label: "te necesitan" },
  { key: "working", label: "trabajando" },
  { key: "thinking", label: "pensando" },
  { key: "blocked", label: "bloqueados" },
  { key: "done", label: "listos" },
  { key: "error", label: "con error" },
  { key: "starting", label: "arrancando" },
] as const;

const glass = "border border-line bg-panel/85 shadow-lg backdrop-blur-md";

export function StatusCard({
  title,
  machine,
  feed,
  simulated,
  total,
  tally,
  daylight,
}: {
  title: string;
  machine: string;
  feed: Feed;
  simulated: boolean;
  total: number;
  tally: Record<OfficeWorkerStatus, number>;
  daylight: string;
}) {
  return (
    <section className={`pointer-events-auto rounded-xl px-4 py-3 ${glass}`}>
      <div className="flex items-center gap-2">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        {simulated ? (
          <span className="rounded-full bg-amber/20 px-2 py-0.5 text-xs text-amber">simulación</span>
        ) : (
          <span
            className={`relative flex h-2.5 w-2.5 rounded-full ${feed === "live" ? "bg-green" : feed === "connecting" ? "bg-amber" : "bg-red"}`}
            title={feed === "live" ? "conectado al agente" : feed === "connecting" ? "conectando…" : "sin conexión con el agente"}
          >
            {feed === "live" ? <span className="absolute inset-0 animate-ping rounded-full bg-green opacity-50" /> : null}
          </span>
        )}
      </div>
      <p className="mt-0.5 text-xs text-text-dim">
        {[machine, daylight].filter(Boolean).join(" · ")}
        {" · "}
        {total === 0
          ? feed === "offline" && !simulated
            ? "sin conexión con el agente"
            : "nadie trabajando ahora"
          : `${total} ${total === 1 ? "sesión" : "sesiones"}`}
      </p>
      {total ? (
        <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
          {COUNT_STYLE.filter((c) => tally[c.key] > 0).map((c) => (
            <li key={c.key} className="flex items-center gap-1.5 rounded-full bg-panel-2 px-2 py-0.5 text-text-dim">
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[c.key]}`} />
              <span className="font-medium tabular-nums text-text">{tally[c.key]}</span> {c.label}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ToolButton({
  children,
  onClick,
  active,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
        active ? "bg-accent text-white" : "text-text-dim hover:bg-panel-2 hover:text-text"
      }`}
    >
      {children}
    </button>
  );
}

export function Toolbar({
  mode,
  onMode,
  showAll,
  onShowAll,
  onFrame,
  lookOpen,
  onLook,
  themeIcon,
  onTheme,
  pad,
  replyVoice,
  onReplyVoice,
  hermesCall,
  callLabel = "Hermes",
  onHermesCall,
}: {
  mode: OfficeMode;
  onMode: (m: OfficeMode) => void;
  showAll: boolean;
  onShowAll: () => void;
  onFrame: () => void;
  lookOpen: boolean;
  onLook: () => void;
  themeIcon: string;
  onTheme: () => void;
  pad: { connected: boolean; label: string };
  replyVoice: boolean;
  onReplyVoice: () => void;
  hermesCall: "off" | "connecting" | "on" | "unavailable";
  /** A quién llama el botón: "Hermes" o "Equipo" (el elenco de la oficina). */
  callLabel?: string;
  onHermesCall: () => void;
}) {
  return (
    <nav className="pointer-events-auto flex flex-wrap items-center justify-end gap-2">
      {pad.connected ? (
        <span className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-text ${glass}`} title="Control conectado (Gamepad API)">
          <span className="h-2 w-2 rounded-full bg-green" />🎮 {pad.label}
        </span>
      ) : null}
      <div className={`flex items-center gap-0.5 rounded-xl p-1 ${glass}`}>
        {hermesCall !== "unavailable" ? (
          <ToolButton active={hermesCall === "on"} onClick={onHermesCall} title={`Llamar a ${callLabel} por voz (Y en el control)`}>
            {hermesCall === "on" ? "📞 Colgar" : hermesCall === "connecting" ? "📞 Conectando…" : `📞 ${callLabel}`}
          </ToolButton>
        ) : null}
        <ToolButton active={replyVoice} onClick={onReplyVoice} title="Leer en voz alta la respuesta del agente al que le hablaste">
          {replyVoice ? "🔊 Respuestas" : "🔇 Respuestas"}
        </ToolButton>
      </div>
      <div className={`flex items-center gap-0.5 rounded-xl p-1 ${glass}`} role="tablist" aria-label="Vista">
        <ToolButton active={mode === "explore"} onClick={() => onMode("explore")} title="Caminar por la oficina (V)">
          🚶 Explorar
        </ToolButton>
        <ToolButton active={mode === "aerial"} onClick={() => onMode("aerial")} title="Ver toda la oficina desde arriba (V)">
          🛰 Vista aérea
        </ToolButton>
      </div>
      <div className={`flex items-center gap-0.5 rounded-xl p-1 ${glass}`}>
        {mode === "aerial" ? <ToolButton onClick={onFrame}>Encuadrar</ToolButton> : null}
        <ToolButton active={showAll} onClick={onShowAll} title="Mostrar también los proyectos activos donde no hay nadie">
          Todos los proyectos
        </ToolButton>
        <ToolButton active={lookOpen} onClick={onLook} title="Cambiar la apariencia de tu personaje">
          Tu personaje
        </ToolButton>
        <ToolButton onClick={onTheme} title="Cambiar apariencia">
          {themeIcon}
        </ToolButton>
        <Link href="/" className="rounded-lg px-2.5 py-1.5 text-sm text-text-dim hover:bg-panel-2 hover:text-text">
          ← Dashboard
        </Link>
      </div>
    </nav>
  );
}

export function TeamRoster({
  workers,
  projectName,
  selectedId,
  onPick,
}: {
  workers: OfficeWorker[];
  projectName: (slug: string) => string;
  selectedId: string | null;
  onPick: (w: OfficeWorker) => void;
}) {
  const [open, setOpen] = useState(true);
  if (!workers.length) return null;
  return (
    <section className={`pointer-events-auto w-72 overflow-hidden rounded-xl ${glass}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm font-medium text-text hover:bg-panel-2/60"
      >
        Equipo <span className="text-xs text-text-faint">{open ? "ocultar" : `${workers.length} · ver`}</span>
      </button>
      {open ? (
        <ul className="max-h-[46vh] overflow-y-auto border-t border-line py-1">
          {workers.map((w) => (
            <li key={w.id}>
              <button
                type="button"
                onClick={() => onPick(w)}
                className={`flex w-full items-start gap-2.5 px-4 py-2 text-left hover:bg-panel-2/70 ${selectedId === w.id ? "bg-panel-2" : ""}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[w.status]} ${w.status === "working" ? "animate-pulse" : ""}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text">{w.name}</span>
                  <span className="block truncate text-xs text-text-faint">
                    {projectName(w.project)}
                    {w.task.summary ? ` · ${w.task.summary}` : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid min-w-6 place-items-center rounded-md border border-line-2 bg-panel-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-text">
      {children}
    </kbd>
  );
}

export function ControlsHint({ mode, pad, padConnected }: { mode: OfficeMode; pad: boolean; padConnected: boolean }) {
  const padItems: [React.ReactNode, string][] = [
    [<Key key="k">stick izq.</Key>, "caminar"],
    [<PadGlyph key="k" b="RT" />, "correr"],
    [<PadGlyph key="k" b="A" />, "hablar / contratar"],
    [<PadGlyph key="k" b="X" />, "saltar"],
    [<PadGlyph key="k" b="Y" />, "llamar por voz"],
    [
      <span key="k" className="flex gap-0.5">
        <PadGlyph b="LB" />
        <PadGlyph b="RB" />
      </span>,
      "otro agente",
    ],
    [<PadGlyph key="k" b="View" />, mode === "explore" ? "vista aérea" : "explorar"],
    [<PadGlyph key="k" b="Menu" />, "ayuda"],
  ];
  const items: [React.ReactNode, string][] = pad
    ? padItems
    : mode === "explore"
      ? [
          [
            <span key="k" className="flex gap-0.5">
              <Key>W</Key>
              <Key>A</Key>
              <Key>S</Key>
              <Key>D</Key>
            </span>,
            "caminar",
          ],
          [<Key key="k">Shift</Key>, "correr"],
          [<Key key="k">Espacio</Key>, "saltar"],
          [<Key key="k">E</Key>, "interactuar"],
          [<Key key="k">arrastra</Key>, "cámara"],
          [<Key key="k">V</Key>, "vista aérea"],
        ]
      : [
          [<Key key="k">clic</Key>, "agente o +"],
          [<Key key="k">arrastra</Key>, "orbitar"],
          [<Key key="k">rueda</Key>, "zoom"],
          [<Key key="k">V</Key>, "explorar"],
        ];
  return (
    <div className={`pointer-events-none flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 rounded-xl px-3 py-2 text-xs text-text-dim ${glass}`}>
      {items.map(([k, label], i) => (
        <span key={i} className="flex items-center gap-1.5">
          {k}
          {label}
        </span>
      ))}
      {!padConnected ? <span className="text-text-faint">· 🎮 ¿control? presiona cualquier botón</span> : null}
    </div>
  );
}

const HELP: [string[], string][] = [
  [["stick izq."], "Caminar (más inclinado, más rápido)"],
  [["RT"], "Correr"],
  [["stick der."], "Mover la cámara"],
  [["↑", "↓"], "Acercar / alejar la cámara"],
  [["LT"], "Recentrar la cámara"],
  [["A"], "Hablar con el agente o contratar en el escritorio cercano · en la conversación: escuchar, parar y enviar"],
  [["X"], "Saltar · en la conversación: volver a hablar"],
  [["B"], "Cancelar / cerrar"],
  [["Y"], "Llamar por voz al equipo (o a Hermes) y colgar"],
  [["LB", "RB"], "Ir al agente anterior / siguiente"],
  [["View"], "Vista aérea / explorar · en la conversación: cambiar de modo (Auto, Editar, Plan, Preguntar)"],
  [["Menu"], "Esta ayuda"],
];

export function ControllerHelp({ label, onClose }: { label: string; onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-bg/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <section className={`w-full max-w-xl rounded-2xl p-6 ${glass}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">🎮 {label || "Control"}</h2>
          <span className="flex items-center gap-1.5 text-xs text-text-faint">
            <PadGlyph b="B" /> cerrar
          </span>
        </div>
        <ul className="mt-4 divide-y divide-line">
          {HELP.map(([keys, what]) => (
            <li key={what} className="flex items-center gap-4 py-2 text-sm">
              <span className="flex w-28 shrink-0 gap-1">
                {keys.map((k) =>
                  ["A", "B", "X", "Y", "LB", "RB", "RT", "LT", "View", "Menu"].includes(k) ? (
                    <PadGlyph key={k} b={k as "A"} />
                  ) : (
                    <Key key={k}>{k}</Key>
                  ),
                )}
              </span>
              <span className="text-text-dim">{what}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: string[]; value: number; onChange: (i: number) => void; label: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs text-text-dim">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c, i) => (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${i + 1}`}
            onClick={() => onChange(i)}
            className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${value === i ? "border-accent ring-2 ring-accent/30" : "border-line"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
    </div>
  );
}

export function LookPicker({ look, onChange, onClose }: { look: OwnerLook; onChange: (l: OwnerLook) => void; onClose: () => void }) {
  return (
    <section className={`pointer-events-auto w-80 space-y-3.5 rounded-xl p-4 ${glass}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tu personaje</h2>
        <button type="button" onClick={onClose} className="rounded-md px-1.5 text-text-dim hover:text-text" aria-label="Cerrar">
          ✕
        </button>
      </div>
      <Swatches label="Piel" colors={SKIN_TONES} value={look.skin} onChange={(skin) => onChange({ ...look, skin })} />
      <Swatches label="Pelo" colors={HAIR_COLORS} value={look.hair} onChange={(hair) => onChange({ ...look, hair })} />
      <div>
        <p className="mb-1.5 text-xs text-text-dim">Peinado</p>
        <div className="flex flex-wrap gap-1.5">
          {HAIR_STYLES.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange({ ...look, style: i })}
              className={`rounded-full border px-2.5 py-1 text-xs ${look.style === i ? "border-accent bg-accent/15 text-text" : "border-line text-text-dim hover:text-text"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <Swatches label="Camiseta" colors={SHIRT_COLORS} value={look.shirt} onChange={(shirt) => onChange({ ...look, shirt })} />
      <div>
        <p className="mb-1.5 text-xs text-text-dim">Rasgos</p>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["beard", "Barba"],
              ["glasses", "Gafas"],
              ["extras", "Collar y arete"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={look[key]}
              onClick={() => onChange({ ...look, [key]: !look[key] })}
              className={`rounded-full border px-2.5 py-1 text-xs ${look[key] ? "border-accent bg-accent/15 text-text" : "border-line text-text-dim hover:text-text"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-text-faint">Se guarda en este navegador.</p>
    </section>
  );
}

export interface Toast {
  id: number;
  tone: "start" | "done" | "error";
  text: string;
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none absolute top-20 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm text-text ${glass}`}>
          <span className={`h-2 w-2 rounded-full ${t.tone === "done" ? "bg-green" : t.tone === "error" ? "bg-red" : "bg-amber"}`} />
          {t.text}
        </div>
      ))}
    </div>
  );
}
