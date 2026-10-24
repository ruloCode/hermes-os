"use client";

// TECLEAR SOBRE EL FANTASMA: el código se ve en gris y lo escribes encima,
// carácter por carácter, como en typing.io pero con Python real. Una tecla
// equivocada NO avanza (el código tiene que quedar exacto) y cuenta como error;
// la sangría al empezar cada línea se pone sola, como en el editor, y no cuenta
// como tecleada. `blind` = de memoria: lo que falta no se ve.
//
// La entrada es un <textarea> invisible y no keydown sueltos: así las tildes
// (tecla muerta + vocal) y la ñ del teclado en español llegan ya compuestas.

import { useEffect, useMemo, useRef, useState } from "react";
import { typedChars, typingAccuracy, typingTarget, typingWpm } from "@hermes/shared";
import { gameKey } from "@/lib/dojo/game";

export interface TypeResult {
  chars: number;
  errors: number;
  ms: number;
  blind: boolean;
  maxCombo: number;
}

export function TypeOver({
  code,
  blind = false,
  fontSize = 15,
  autoFocus = false,
  onDone,
  onLine,
}: {
  code: string;
  blind?: boolean;
  fontSize?: number;
  autoFocus?: boolean;
  onDone: (r: TypeResult) => void;
  /** Cada línea completada: lo tecleado hasta ahí (para la mesa en vivo). */
  onLine?: (typed: string) => void;
}) {
  const target = useMemo(() => typingTarget(code), [code]);
  const total = useMemo(() => typedChars(target), [target]);
  // La verdad vive en refs (una tecla = un efecto, también en StrictMode); el
  // estado solo pinta.
  const posRef = useRef(0);
  const errorsRef = useRef(0);
  const comboRef = useRef(0);
  const maxComboRef = useRef(0);
  const [pos, setPos] = useState(0);
  const [errors, setErrors] = useState(0);
  const [missed, setMissed] = useState<Set<number>>(() => new Set());
  const [focused, setFocused] = useState(false);
  const [now, setNow] = useState(0);
  const startRef = useRef<number | null>(null);
  const doneRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const cursorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Reloj para el PPM en vivo, solo mientras se escribe.
  useEffect(() => {
    if (startRef.current == null || doneRef.current) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [pos]);

  useEffect(() => {
    cursorRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pos]);

  /** Salta la sangría que sigue a un salto de línea (la pone el "editor"). */
  const skipIndent = (p: number) => {
    if (p > 0 && target[p - 1] === "\n") while (target[p] === " ") p++;
    return p;
  };

  const press = (ch: string) => {
    if (doneRef.current) return;
    if (startRef.current == null) startRef.current = Date.now();
    const p = posRef.current;
    if (target[p] === ch) {
      gameKey(true);
      comboRef.current += 1;
      maxComboRef.current = Math.max(maxComboRef.current, comboRef.current);
      const next = skipIndent(p + 1);
      posRef.current = next;
      setPos(next);
      if (ch === "\n") onLine?.(target.slice(0, p));
      if (next >= target.length) {
        doneRef.current = true;
        onDone({
          chars: total,
          errors: errorsRef.current,
          ms: Date.now() - startRef.current,
          blind,
          maxCombo: maxComboRef.current,
        });
      }
      return;
    }
    gameKey(false);
    comboRef.current = 0;
    errorsRef.current += 1;
    setErrors(errorsRef.current);
    setMissed((m) => new Set(m).add(p));
  };

  const onInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const v = e.currentTarget.value;
    e.currentTarget.value = "";
    for (const ch of v) press(ch === "\r" ? "\n" : ch);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      press("\n");
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  const done = pos >= target.length;
  const elapsed = startRef.current ? (done ? 0 : now) - startRef.current : 0;
  const correct = useMemo(() => typedChars(target.slice(0, pos)), [target, pos]);
  const wpm = startRef.current && !done && elapsed > 1500 ? typingWpm(correct, elapsed) : null;

  return (
    <div
      className={`relative cursor-text overflow-hidden rounded-md border bg-panel transition-colors ${
        focused ? "border-accent" : "border-line"
      }`}
      onClick={() => inputRef.current?.focus()}
    >
      <textarea
        ref={inputRef}
        onInput={onInput}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="Teclea el código"
        className="absolute h-px w-px opacity-0"
      />
      <pre
        className="overflow-x-auto px-4 py-3 font-mono leading-[1.65]"
        style={{ fontSize }}
        aria-hidden
      >
        {[...target].map((ch, i) => {
          if (i < pos) {
            return (
              <span key={i} className={missed.has(i) ? "text-amber" : "text-text"}>
                {ch}
              </span>
            );
          }
          if (i === pos) {
            return (
              <span
                key={i}
                ref={cursorRef}
                className={`rounded-[2px] ${missed.has(i) ? "bg-red/30" : focused ? "bg-accent/35" : "bg-selected"} ${
                  blind ? "text-transparent" : "text-text-dim"
                }`}
              >
                {ch === "\n" ? "↵\n" : ch === " " ? " " : ch}
              </span>
            );
          }
          if (blind) return ch === "\n" ? <span key={i}>{"\n"}</span> : null;
          return (
            <span key={i} className="text-text-faint/55">
              {ch}
            </span>
          );
        })}
      </pre>
      <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-1.5 text-xs text-text-faint tabular-nums">
        <span>
          {!startRef.current
            ? focused
              ? "Empieza a teclear. Enter = salto de línea; la sangría se pone sola."
              : "Haz clic aquí y teclea."
            : done
              ? "Listo."
              : `${Math.round((correct / Math.max(1, total)) * 100)} %`}
        </span>
        <span className="flex items-center gap-3">
          {wpm != null && <span className="text-text-dim">{wpm} ppm</span>}
          {startRef.current && <span>{typingAccuracy(correct, errors)} % precisión</span>}
          {errors > 0 && <span className="text-amber">{errors} {errors === 1 ? "error" : "errores"}</span>}
        </span>
      </div>
    </div>
  );
}
