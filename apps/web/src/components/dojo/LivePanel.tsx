"use client";

// EN VIVO: la máquina se mueve con TU código mientras escribes. Al parar de
// teclear (~0,6 s) el código corre con el ejemplo elegido bajo el trazador del
// harness y la máquina repite paso a paso lo que hizo, con tus variables reales
// — también cuando está mal: ver dónde se tuerce es la mitad de la lección. El
// editor marca la línea del paso que se está mirando.
//
// La reproducción dura ~5 s sea cual sea el número de pasos; ←/→ (con el panel
// enfocado) y la barra permiten ir paso a paso.

import { useCallback, useEffect, useRef, useState } from "react";
import { pyCall, pyRepr, traceRepr, type DojoItem, type DojoTrace } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { traceFunction } from "@/lib/dojo/python";
import { DojoFigure } from "./figures/DojoFigure";
import { PyErrorBox, Stdout } from "./RunOutput";

const DEBOUNCE_MS = 600;
const PLAY_TOTAL_MS = 5_000;

type Done = Extract<DojoTrace, { phase: "done" }>;
type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "trace"; trace: Done }
  | { kind: "broken"; trace: Exclude<DojoTrace, { phase: "done" }> }
  | { kind: "timeout" }
  | { kind: "error"; message: string };

export function LivePanel({
  item,
  code,
  enabled,
  reveal,
  onActiveLine,
}: {
  item: DojoItem;
  code: string;
  enabled: boolean;
  reveal: boolean;
  onActiveLine: (line: number | null) => void;
}) {
  const p = item.problem!;
  const examples = p.cases.filter((c) => !c.hidden && c.args);
  const [ex, setEx] = useState(0);
  const [state, setState] = useState<State>({ kind: "idle" });
  const gen = useRef(0);

  // Correr al parar de teclear (o al cambiar de ejemplo).
  useEffect(() => {
    if (!enabled) return;
    const my = ++gen.current;
    const t = setTimeout(async () => {
      setState({ kind: "running" });
      const r = await traceFunction(code, p.fn, examples[ex]?.args ?? []);
      if (my !== gen.current) return; // llegó otra edición mientras tanto
      if (r.kind === "ok") {
        if (r.trace.phase === "done") setState({ kind: "trace", trace: r.trace });
        else setState({ kind: "broken", trace: r.trace });
      } else if (r.kind === "timeout") setState({ kind: "timeout" });
      else setState({ kind: "error", message: r.message });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // examples se deriva de p; ex y code son lo que cambia
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, ex, enabled, p.fn]);

  const trace = state.kind === "trace" ? state.trace : null;
  const expected = examples[ex] ? pyRepr(examples[ex].expected) : undefined;

  if (!enabled) {
    return (
      <p className="px-4 py-6 text-center text-sm text-text-faint">
        La máquina se mueve con tu código cuando abras el editor.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs text-text-faint">Con el ejemplo</span>
        {examples.map((c, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setEx(i)}
            aria-pressed={ex === i}
            className={`cursor-pointer rounded-sm border px-2 py-0.5 font-mono text-xs transition-colors ${
              ex === i ? "border-accent bg-selected text-text" : "border-line text-text-dim hover:border-line-2"
            }`}
          >
            {pyCall(p.fn, c.args ?? [])}
          </button>
        ))}
        {state.kind === "running" && <span className="ml-auto text-xs text-text-faint">Corriendo tu código…</span>}
      </div>

      {state.kind === "broken" &&
        (state.trace.phase === "missing" ? (
          <p className="text-sm text-text-dim">
            Todavía no hay una función <code className="font-mono">{state.trace.fn}</code>: la máquina arranca cuando la
            definas.
          </p>
        ) : (
          <PyErrorBox error={state.trace.error} />
        ))}
      {state.kind === "timeout" && <p className="text-sm text-amber">Una operación no terminó en 5 s y la corté.</p>}
      {state.kind === "error" && <p className="text-sm text-amber">{state.message}</p>}

      {trace && (
        <TraceView
          key={trace.steps.length + ":" + trace.stdout.length + ":" + JSON.stringify(trace.result)}
          trace={trace}
          fn={p.fn}
          code={code}
          itemId={item.id}
          reveal={reveal}
          expected={expected}
          onActiveLine={onActiveLine}
        />
      )}
    </div>
  );
}

/**
 * La máquina reproduciendo UNA traza: paso a paso en ~5 s, con ◀ ▶, barra y
 * ←/→ con el foco puesto. La usan el modo en vivo de los problemas y los
 * ejemplos de las lecciones (ahí sin ejercicio: siempre la mesa de trabajo).
 */
export function TraceView({
  trace,
  fn,
  code,
  itemId = "mesa",
  reveal = true,
  expected,
  onActiveLine,
  autoplay = true,
  theme,
}: {
  trace: Done;
  fn: string | null;
  code: string;
  itemId?: string;
  reveal?: boolean;
  expected?: string;
  onActiveLine?: (line: number | null) => void;
  autoplay?: boolean;
  /** Forzar tema (QA). */
  theme?: "light" | "dark";
}) {
  const n = trace.steps.length;
  const [step, setStep] = useState(autoplay ? 0 : Math.max(0, n - 1));
  const [playing, setPlaying] = useState(autoplay && n > 1);

  useEffect(() => {
    if (!playing || !n) return;
    const every = Math.max(70, Math.min(450, PLAY_TOTAL_MS / n));
    const t = setInterval(() => {
      setStep((s) => {
        if (s >= n - 1) {
          setPlaying(false);
          return s;
        }
        return s + 1;
      });
    }, every);
    return () => clearInterval(t);
  }, [playing, n]);

  useEffect(() => {
    onActiveLine?.(trace.steps[step]?.line ?? null);
  }, [trace, step, onActiveLine]);
  useEffect(() => () => onActiveLine?.(null), [onActiveLine]);

  const go = useCallback(
    (d: number) => {
      setPlaying(false);
      setStep((s) => Math.max(0, Math.min(n - 1, s + d)));
    },
    [n],
  );

  const got = !trace.error && !trace.truncated && fn ? traceRepr(trace.result ?? undefined) : null;
  const atEnd = step >= n - 1;

  return (
    <div
      className="flex flex-col gap-3 outline-none"
      tabIndex={0}
      aria-label="Tu código, paso a paso"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "ArrowRight") (e.preventDefault(), go(1));
        else if (e.key === "ArrowLeft") (e.preventDefault(), go(-1));
        else if (e.key === " ") (e.preventDefault(), setPlaying((v) => !v));
      }}
    >
      {n > 0 && <DojoFigure itemId={itemId} reveal={reveal} theme={theme} live={{ trace, step, fn, expected, code }} />}
      {n > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="xs" onClick={() => go(-1)} aria-label="Paso anterior" disabled={step === 0}>
            ◀
          </Button>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => {
              if (atEnd) setStep(0);
              setPlaying((v) => !v || atEnd);
            }}
          >
            {playing ? "Pausa" : atEnd ? "Otra vez" : "Seguir"}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => go(1)} aria-label="Paso siguiente" disabled={atEnd}>
            ▶
          </Button>
          <input
            type="range"
            min={0}
            max={Math.max(0, n - 1)}
            value={step}
            onChange={(e) => {
              setPlaying(false);
              setStep(Number(e.target.value));
            }}
            aria-label="Paso"
            className="min-w-0 flex-1 accent-[var(--color-accent)]"
          />
          <span className="shrink-0 text-xs text-text-faint tabular-nums">
            {step + 1}/{n}
          </span>
        </div>
      )}
      {trace.truncated ? (
        <p className="text-sm text-amber">Tu código no terminó en {n} pasos: ¿un bucle cuya condición nunca se vuelve falsa?</p>
      ) : trace.error ? (
        <PyErrorBox error={trace.error} />
      ) : fn ? (
        <p className="font-mono text-sm">
          <span className="text-text-faint">devuelve </span>
          <span className={got === expected ? "text-green" : "text-text"}>{got}</span>
          {expected != null && (
            <span className="text-text-faint">
              {" "}
              · esperado {expected} {got === expected ? "✓" : ""}
            </span>
          )}
        </p>
      ) : null}
      <Stdout text={trace.stdout.slice(0, trace.steps[step]?.out ?? trace.stdout.length)} label="Imprimió hasta aquí" />
    </div>
  );
}
