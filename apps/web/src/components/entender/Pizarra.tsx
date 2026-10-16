"use client";

// Pizarra del tutor: pinta UN diagrama Mermaid (el que llegó por la tool
// draw_diagram), con los colores del tema, zoom y clic en un nodo para
// preguntar por él. Mermaid se carga solo aquí (import dinámico): el resto del
// dashboard no paga su peso. securityLevel "strict": el texto del diagrama
// viene de un modelo que leyó archivos de terceros.
//
// v5: la letra del diagrama es la de la app (se lee del <body>: antes estaba
// fija en Inter, que ya no se carga), los controles de zoom son un grupo de
// botones fantasma y el vacío dice qué va a pasar con un icono, centrado.

import { useEffect, useRef, useState } from "react";
import type { TutorDiagram } from "@hermes/shared";
import { readToken } from "@/components/ui/tones";
import { useTheme } from "@/state/ThemeProvider";

type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | null = null;
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import("mermaid").then((m) => m.default);
  return mermaidPromise;
}

let seq = 0;

const CLICKABLE = "g.node, g[id^='entity-'], rect.actor, text.actor";

/** Etiqueta del nodo bajo el clic (flowchart, actor de secuencia o entidad), o null. */
function clickedLabel(target: Element): string | null {
  const clean = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const node = target.closest("g.node, g[id^='entity-']");
  if (node) return clean(node.textContent) || null;
  const actorText = target.closest("text.actor");
  if (actorText) return clean(actorText.textContent) || null;
  if (target.matches("rect.actor")) {
    const text = target.parentElement?.querySelector("text.actor");
    return clean(text?.textContent) || null;
  }
  return null;
}

export function Pizarra({
  diagram,
  onAsk,
}: {
  diagram: TutorDiagram | null;
  /** Clic en un nodo: el tutor explica esa pieza. */
  onAsk?: (label: string) => void;
}) {
  const theme = useTheme();
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const onAskRef = useRef(onAsk);
  onAskRef.current = onAsk;

  useEffect(() => {
    setScale(1);
  }, [diagram?.id]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !diagram) return;
    let cancelled = false;
    setError(null);
    void (async () => {
      const mermaid = await loadMermaid();
      const text = readToken("--color-text", "#eceef1");
      const dim = readToken("--color-text-dim", "#a3a7b0");
      const faint = readToken("--color-text-faint", "#8a8e97");
      const panel = readToken("--color-panel-2", "#1f2025");
      const bg = readToken("--color-panel", "#18191d");
      const accent = readToken("--color-accent", "#7c7ff5");
      const fontFamily =
        getComputedStyle(document.body).fontFamily || "ui-sans-serif, system-ui, sans-serif";
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily,
        themeVariables: {
          darkMode: theme.resolved === "dark",
          background: bg,
          primaryColor: panel,
          primaryTextColor: text,
          primaryBorderColor: faint,
          secondaryColor: bg,
          tertiaryColor: bg,
          lineColor: dim,
          textColor: text,
          mainBkg: panel,
          nodeBorder: faint,
          clusterBkg: bg,
          clusterBorder: faint,
          edgeLabelBackground: bg,
          actorBkg: panel,
          actorBorder: faint,
          actorTextColor: text,
          signalColor: dim,
          signalTextColor: text,
          labelBoxBkgColor: panel,
          noteBkgColor: panel,
          noteTextColor: text,
          cScale0: accent,
          fontSize: "14px",
        },
      });
      try {
        seq += 1;
        const { svg } = await mermaid.render(`pizarra-${seq}`, diagram.mermaid);
        if (cancelled) return;
        host.innerHTML = svg;
        const el = host.querySelector("svg");
        if (el) {
          el.style.maxWidth = "100%";
          el.style.height = "auto";
        }
        // Clic en un nodo = "explícame esto". Mermaid strict no deja callbacks:
        // UN listener delegado sobre el SVG ya pintado (en secuencias el texto
        // del actor tapa su rectángulo: el clic cae en cualquiera de los dos).
        for (const node of host.querySelectorAll(CLICKABLE))
          (node as SVGElement).style.cursor = "pointer";
        host.onclick = (e) => {
          const label = clickedLabel(e.target as Element);
          if (label) onAskRef.current?.(label);
        };
      } catch (err) {
        if (cancelled) return;
        host.innerHTML = "";
        setError(String((err as Error)?.message ?? err).slice(0, 300));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [diagram, theme.resolved]);

  if (!diagram) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <span
          aria-hidden
          className="mb-1 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel-2 text-text-faint"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="6" rx="1.5" />
            <rect x="14" y="15" width="7" height="6" rx="1.5" />
            <path d="M6.5 9v3a3 3 0 0 0 3 3h4.5" />
          </svg>
        </span>
        <p className="text-sm font-medium text-text">La pizarra está vacía</p>
        <p className="max-w-[40ch] text-sm leading-relaxed text-text-faint">
          Aquí aparecen los diagramas mientras el tutor explica. Haz clic en cualquier nodo para que
          te explique esa pieza.
        </p>
      </div>
    );
  }

  const zoomBtn =
    "grid h-7 min-w-7 cursor-pointer place-items-center rounded-xs px-1.5 text-sm text-text-dim transition-colors hover:bg-hover hover:text-text";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-text">{diagram.title}</h2>
          {diagram.caption && (
            <p className="mt-0.5 text-xs leading-snug text-text-dim">{diagram.caption}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 rounded-sm border border-line bg-panel p-0.5">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}
            className={zoomBtn}
            aria-label="Alejar"
            title="Alejar"
          >
            −
          </button>
          <span className="w-11 text-center text-xs text-text-dim tabular-nums">
            {Math.round(scale * 100)} %
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
            className={zoomBtn}
            aria-label="Acercar"
            title="Acercar"
          >
            +
          </button>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-line" />
          <button type="button" onClick={() => setScale(1)} className={`${zoomBtn} text-xs`}>
            Ajustar
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="space-y-2">
            <p className="flex items-start gap-2 text-sm text-text-dim">
              <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />
              No se pudo dibujar este diagrama: {error}
            </p>
            <pre className="overflow-auto rounded-sm border border-line bg-panel-2 p-3 font-mono text-xs text-text-dim">
              {diagram.mermaid}
            </pre>
          </div>
        )}
        {/* Siempre montado: el siguiente diagrama necesita dónde pintarse aunque este falle. */}
        <div
          ref={hostRef}
          className={`mx-auto origin-top transition-transform ${error ? "hidden" : ""}`}
          style={{ transform: `scale(${scale})` }}
        />
      </div>

      {diagram.sources.length > 0 && (
        <div className="shrink-0 border-t border-line px-4 py-2.5">
          <p className="mb-1.5 text-xs font-medium text-text-faint">Fuentes</p>
          <ul className="flex flex-wrap gap-1.5">
            {diagram.sources.map((s, i) => (
              <li
                key={`${s.ref}-${i}`}
                title={s.ref}
                className="max-w-full truncate rounded-xs border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-2xs text-text-dim"
              >
                {s.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
