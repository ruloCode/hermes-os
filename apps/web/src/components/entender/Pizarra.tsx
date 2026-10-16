"use client";

// Pizarra del tutor: pinta UN diagrama Mermaid (el que llegó por la tool
// draw_diagram), con los colores del tema, zoom y clic en un nodo para
// preguntar por él. Mermaid se carga solo aquí (import dinámico): el resto del
// dashboard no paga su peso. securityLevel "strict": el texto del diagrama
// viene de un modelo que leyó archivos de terceros.

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
      const text = readToken("--color-text", "#f0ede6");
      const dim = readToken("--color-text-dim", "#b5afa5");
      const faint = readToken("--color-text-faint", "#8f8a80");
      const panel = readToken("--color-panel-2", "#232120");
      const bg = readToken("--color-panel", "#1a1917");
      const accent = readToken("--color-accent", "#d97757");
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
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
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm leading-relaxed text-text-dim">
          Aquí aparecen los diagramas mientras el tutor explica. Haz clic en cualquier nodo para que
          te explique esa pieza.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base text-text">{diagram.title}</h2>
          {diagram.caption && <p className="mt-0.5 text-xs text-text-dim">{diagram.caption}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(0.4, +(s - 0.2).toFixed(1)))}
            className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:border-line-2 hover:text-text"
            aria-label="Alejar"
          >
            −
          </button>
          <span className="w-10 text-center text-xs text-text-dim tabular-nums">
            {Math.round(scale * 100)} %
          </span>
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(3, +(s + 0.2).toFixed(1)))}
            className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:border-line-2 hover:text-text"
            aria-label="Acercar"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setScale(1)}
            className="rounded-sm border border-line px-2 py-0.5 text-xs text-text-dim hover:border-line-2 hover:text-text"
          >
            Ajustar
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {error && (
          <div className="space-y-2">
            <p className="text-sm text-amber">No se pudo dibujar este diagrama: {error}</p>
            <pre className="overflow-auto rounded-sm border border-line p-3 font-mono text-xs text-text-dim">
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
          <p className="mb-1 text-xs text-text-dim">Fuentes</p>
          <ul className="flex flex-wrap gap-1.5">
            {diagram.sources.map((s, i) => (
              <li
                key={`${s.ref}-${i}`}
                title={s.ref}
                className="max-w-full truncate rounded-sm border border-line px-2 py-0.5 font-mono text-xs text-text-dim"
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
