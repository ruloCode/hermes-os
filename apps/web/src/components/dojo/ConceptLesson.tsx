"use client";

// LECCIÓN DE CONCEPTO, toda con el teclado: cada ejemplo se TECLEA sobre el
// texto fantasma y recién entonces corre (lo que se escribe con los dedos se
// queda distinto que lo que se lee), y cada pregunta se responde ESCRIBIENDO.
// El foco salta solo al siguiente bloque: la lección se hace sin tocar el
// mouse, y al final Enter la cierra.

import { useEffect, useRef, useState } from "react";
import { checkAnswer, type DojoBlock, type DojoItem, type DojoTrace, type PyError } from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { Kbd } from "@/components/ui/Kbd";
import { runPython, traceProgram } from "@/lib/dojo/python";
import { TraceView } from "./LivePanel";
import type { AttemptInput, TypingInput } from "@/hooks/useDojo";
import { CodeEditor } from "./CodeEditor";
import { Prose, inline } from "./Prose";
import { PyErrorBox, Stdout } from "./RunOutput";
import { TypeOver, type TypeResult } from "./TypeOver";
import { DojoFigure, hasDojoFigure } from "./figures/DojoFigure";

type Out = { stdout: string; error: PyError | null } | { notice: string };

function Snippet({
  code: original,
  note,
  fontSize,
  active,
  canSkip,
  onTyped,
}: {
  code: string;
  note?: string;
  fontSize: number;
  active: boolean;
  canSkip: boolean;
  onTyped: (r: TypeResult | null) => void;
}) {
  const [typed, setTyped] = useState(false);
  const [code, setCode] = useState(original);
  const [out, setOut] = useState<Out | null>(null);
  const [running, setRunning] = useState(false);
  // La mesa: lo que hace el código tecleado hasta ahora. Solo si la traza
  // entera cabe en el tope de pasos — un ejemplo que mide tiempos con un
  // millón de vueltas se corre de verdad, pero no se pinta a medias.
  const [mesa, setMesa] = useState<{ trace: Extract<DojoTrace, { phase: "done" }>; play: boolean; code: string } | null>(
    null,
  );
  const lineTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const traceForMesa = async (src: string, play: boolean) => {
    const r = await traceProgram(src);
    if (r.kind !== "ok" || r.trace.phase !== "done") return;
    if (r.trace.truncated || !r.trace.steps.length) {
      if (play) setMesa(null);
      return;
    }
    setMesa({ trace: r.trace, play, code: src });
  };

  const run = async (src = code) => {
    if (running) return;
    setRunning(true);
    const r = await runPython(src);
    setRunning(false);
    if (r.kind === "ok") setOut(r.run);
    else if (r.kind === "timeout")
      setOut({ notice: `No terminó en ${r.seconds} s y lo corté. ¿Un while cuya condición nunca se vuelve falsa?` });
    else setOut({ notice: r.message });
    void traceForMesa(src, true);
  };

  const finish = (r: TypeResult | null) => {
    setTyped(true);
    onTyped(r);
    void run(original);
  };

  return (
    <figure className="flex flex-col gap-2">
      {!typed ? (
        <>
          <TypeOver
            code={original}
            fontSize={fontSize}
            autoFocus={active}
            onDone={(r) => finish(r)}
            onLine={(prefix) => {
              if (lineTimer.current) clearTimeout(lineTimer.current);
              lineTimer.current = setTimeout(() => void traceForMesa(prefix, false), 150);
            }}
          />
          {canSkip && (
            <button
              type="button"
              onClick={() => finish(null)}
              className="cursor-pointer self-end text-xs text-text-faint hover:text-text-dim"
            >
              Ya lo tecleé antes: solo correrlo
            </button>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-md border border-line bg-panel">
          <CodeEditor value={code} onChange={setCode} onRun={() => void run()} fontSize={fontSize} />
          <div className="flex items-center justify-between gap-2 border-t border-line px-2 py-1.5">
            <span className="px-1 text-xs text-text-faint">
              Ahora es tuyo: cámbialo y vuelve a correrlo · <Kbd>⌘↵</Kbd>
            </span>
            <span className="flex items-center gap-1.5">
              {code !== original && (
                <Button variant="ghost" size="xs" onClick={() => setCode(original)}>
                  Restaurar
                </Button>
              )}
              <Button variant="secondary" size="xs" onClick={() => void run()} disabled={running}>
                {running ? "Corriendo…" : "Correr"}
              </Button>
            </span>
          </div>
        </div>
      )}
      {out &&
        ("notice" in out ? (
          <p className="text-sm text-amber">{out.notice}</p>
        ) : (
          <div className="flex flex-col gap-2">
            <Stdout text={out.stdout} />
            {out.error && <PyErrorBox error={out.error} />}
            {!out.stdout && !out.error && <p className="text-sm text-text-faint">Corrió sin imprimir nada.</p>}
          </div>
        ))}
      {mesa && (
        <TraceView
          key={`${mesa.play ? "play" : "still"}-${mesa.trace.steps.length}-${mesa.trace.stdout.length}`}
          trace={mesa.trace}
          fn={null}
          code={mesa.code}
          autoplay={mesa.play}
        />
      )}
      {note && <figcaption className="text-sm text-text-faint">{inline(note)}</figcaption>}
    </figure>
  );
}

type CheckState = { tries: string[]; solved: boolean };

function Check({
  block,
  state,
  onTry,
  fontSize,
  active,
}: {
  block: Extract<DojoBlock, { kind: "check" }>;
  state: CheckState;
  onTry: (answer: string) => void;
  fontSize: number;
  active: boolean;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const wrongs = state.tries.filter((t) => !checkAnswer(t, block)).length;
  // Dos fallos y se muestra: adivinar sin fin no enseña.
  const reveal = state.solved || wrongs >= 2;
  useEffect(() => {
    if (active && !reveal) inputRef.current?.focus({ preventScroll: false });
  }, [active, reveal]);

  const submit = () => {
    if (!value.trim() || reveal) return;
    onTry(value);
    setValue("");
  };

  return (
    <div className={`rounded-md border bg-panel p-4 ${active && !reveal ? "border-line-2" : "border-line"}`}>
      <p className="text-xs text-text-faint">Comprueba · escribe la respuesta</p>
      <p className="mt-1 text-md font-medium text-text">{inline(block.question)}</p>
      {block.code && (
        <div className="mt-3 overflow-hidden rounded-sm border border-line">
          <CodeEditor value={block.code} readOnly fontSize={fontSize - 1} />
        </div>
      )}
      {!reveal ? (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <span aria-hidden className="font-mono text-accent">
            &gt;
          </span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            aria-label="Tu respuesta"
            className="min-w-0 flex-1 rounded-sm border border-line bg-bg px-3 py-1.5 font-mono text-md text-text focus:border-accent focus:outline-none"
          />
          <Kbd>↵</Kbd>
        </form>
      ) : null}
      {!reveal && wrongs === 1 && (
        <p className="mt-2 text-sm text-text-dim">
          «<span className="font-mono">{state.tries.at(-1)}</span>» no es. Léelo otra vez, línea por línea.
        </p>
      )}
      {reveal && (
        <p className="mt-3 text-sm text-text-dim">
          {state.solved ? (
            <span className="text-green">
              <span className="font-mono">{block.answer}</span> · bien.{" "}
            </span>
          ) : (
            <span className="text-text">
              Era <span className="font-mono">{block.answer}</span>.{" "}
            </span>
          )}
          {inline(block.why)}
        </p>
      )}
    </div>
  );
}

export function ConceptLesson({
  item,
  done,
  fontSize,
  onSave,
  onTyping,
  next,
  onNext,
}: {
  item: DojoItem;
  done: boolean;
  fontSize: number;
  onSave: (input: AttemptInput) => Promise<{ ok: boolean; error?: string }>;
  onTyping: (input: TypingInput) => void;
  next: DojoItem | null;
  onNext: () => void;
}) {
  const blocks = item.blocks ?? [];
  // Los bloques que se HACEN (teclear o responder), en orden.
  const steps = blocks.flatMap((b, i) => (b.kind === "text" ? [] : [i]));
  const checkIdx = blocks.flatMap((b, i) => (b.kind === "check" ? [i] : []));
  const [checks, setChecks] = useState<Record<number, CheckState>>({});
  const [typedIdx, setTypedIdx] = useState<Set<number>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const checkDone = (i: number) => {
    const s = checks[i];
    const b = blocks[i] as Extract<DojoBlock, { kind: "check" }>;
    return Boolean(s && (s.solved || s.tries.filter((t) => !checkAnswer(t, b)).length >= 2));
  };
  const stepDone = (i: number) => (blocks[i].kind === "check" ? checkDone(i) : typedIdx.has(i));
  const active = steps.find((i) => !stepDone(i)) ?? null;
  const pending = steps.filter((i) => !stepDone(i)).length;
  const finished = pending === 0;
  const firstTry = checkIdx.filter((i) => {
    const t = checks[i]?.tries[0];
    return t != null && checkAnswer(t, blocks[i] as Extract<DojoBlock, { kind: "check" }>);
  }).length;

  useEffect(() => {
    if (finished && !saved) finishRef.current?.focus();
  }, [finished, saved]);
  useEffect(() => {
    if (saved) nextRef.current?.focus();
  }, [saved]);

  const tryCheck = (i: number, answer: string) =>
    setChecks((c) => {
      const s = c[i] ?? { tries: [], solved: false };
      const b = blocks[i] as Extract<DojoBlock, { kind: "check" }>;
      return { ...c, [i]: { tries: [...s.tries, answer], solved: s.solved || checkAnswer(answer, b) } };
    });

  const typed = (i: number, r: TypeResult | null) => {
    setTypedIdx((s) => new Set(s).add(i));
    if (r) onTyping({ itemId: item.id, source: "ejemplo", ...r });
  };

  const finish = async () => {
    setSaving(true);
    setError(null);
    const r = await onSave({ itemId: item.id, passed: true, checks: { correct: firstTry, total: checkIdx.length } });
    setSaving(false);
    if (r.ok) setSaved(true);
    else setError(r.error ?? "No se guardó.");
  };

  return (
    <ScrollArea fade="y" className="min-h-0 flex-1">
      <article className="mx-auto flex max-w-[72ch] flex-col gap-5 px-1 pt-1 pb-16">
        {hasDojoFigure(item.id) && <DojoFigure itemId={item.id} reveal />}
        <p className="text-sm text-text-faint">
          Todo con el teclado: teclea cada ejemplo sobre el gris para correrlo y escribe cada respuesta.
        </p>
        {blocks.map((b, i) =>
          b.kind === "text" ? (
            <Prose key={i} text={b.text} />
          ) : b.kind === "code" ? (
            <Snippet
              key={i}
              code={b.code}
              note={b.note}
              fontSize={fontSize}
              active={active === i}
              canSkip={done}
              onTyped={(r) => typed(i, r)}
            />
          ) : (
            <Check
              key={i}
              block={b}
              state={checks[i] ?? { tries: [], solved: false }}
              onTry={(a) => tryCheck(i, a)}
              fontSize={fontSize}
              active={active === i}
            />
          ),
        )}

        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          {saved ? (
            <p className="text-sm text-text">
              <span className="text-green">Lección terminada.</span>{" "}
              {checkIdx.length > 0 && `${firstTry} de ${checkIdx.length} al primer intento.`}
            </p>
          ) : (
            <p className="text-sm text-text-faint">
              {finished
                ? "Listo: Enter cierra la lección."
                : pending === 1
                  ? "Te falta 1 bloque."
                  : `Te faltan ${pending} bloques por teclear o responder.`}
            </p>
          )}
          <span className="flex items-center gap-2">
            {error && <span className="text-sm text-red">{error}</span>}
            {!saved && (
              <Button ref={finishRef} variant="primary" size="md" onClick={() => void finish()} disabled={!finished || saving}>
                {saving ? "Guardando…" : "Terminar lección"}
              </Button>
            )}
            {next && saved && (
              <Button ref={nextRef} variant="primary" size="md" onClick={onNext}>
                Siguiente: {next.title} <span className="ml-1 text-2xs text-on-accent/75">↵</span>
              </Button>
            )}
          </span>
        </footer>
      </article>
    </ScrollArea>
  );
}
