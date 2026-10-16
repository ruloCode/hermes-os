"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/hermes";
import { Markdown } from "@/components/Markdown";
import { Button } from "@/components/ui/Button";
import { IconArrowUp } from "./kit";

// Sin datos del stream por este tiempo = turno colgado → se aborta solo.
// Holgado a propósito: el asesor corre tools reales (consultas de finanzas).
const STALL_MS = 120_000;

// Marca interna de un turno fallido: se pinta como error, nunca se muestra.
const ERROR_MARK = "\u26a0 ";

// Preguntas de arranque: chips clicables (patrón asistente de finanzas).
const STARTERS = [
  "¿cómo voy este mes?",
  "¿en qué estoy gastando de más?",
  "gasté 20 mil del nequi en un taxi",
];

/**
 * Chat directo con el ASESOR FINANCIERO: usa el contrato Hermes
 * (/v1/chat/completions) con scope "vida" — el agente arma en cada turno el
 * contexto fresco (saldo por billetera, resumen del mes, hábitos, metas) y
 * tiene las tools reales de finanzas, así que puede registrar gastos,
 * recalibrar saldos y analizar con cifras vivas desde el chat.
 *
 * Robustez (el input JAMÁS se bloquea): durante un turno el botón se vuelve
 * detener (abort real), un watchdog corta streams colgados (agente
 * reiniciado a mitad de turno, red dormida) y un error deja el mensaje con
 * "Reintentar" en vez de tragárselo.
 *
 * v5: hilo tranquilo, patrón ChatGPT/Claude — lo tuyo en una burbuja gris a la
 * derecha, la respuesta como texto corrido. Antes cada línea abría con
 * el nombre del dueño en cyan y "ASESOR ›" en el acento (el nombre
 * escrito a mano en el código); los arranques eran chips cuadrados que se teñían de
 * acento al pasar el mouse.
 */
export function AdvisorChat({
  online,
  onDataChanged,
}: {
  online: boolean;
  /** El asesor puede escribir datos (log_transaction…) → refresca los paneles. */
  onDataChanged?: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  /** Último mensaje que falló (para el botón Reintentar). */
  const [failed, setFailed] = useState<string | null>(null);
  // Sesión: una clave estable por montaje; el SDK session id llega en el
  // primer turno y los siguientes resumen ESA conversación.
  const sessionKey = useRef(crypto.randomUUID());
  const sdkSession = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = (force = false) => {
    if (!force && !nearBottom.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  };

  useEffect(resizeInput, [draft]);
  // Al desmontar (cambiar de vista) se corta el stream en vuelo.
  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = () => abortRef.current?.abort();

  const send = (text?: string) => sendWith(messages, text ?? draft);

  /** Manda `content` sobre un historial explícito (retry lo recorta antes). */
  const sendWith = async (prior: ChatMessage[], text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: ChatMessage[] = [...prior, { role: "user", content }];
    setDraft("");
    setFailed(null);
    setBusy(true);
    setMessages([...history, { role: "assistant", content: "" }]);
    scrollDown(true);

    const controller = new AbortController();
    abortRef.current = controller;
    // Watchdog: si el stream se queda mudo (turno colgado), se aborta solo.
    let stall: ReturnType<typeof setTimeout> | null = null;
    const armWatchdog = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => controller.abort(), STALL_MS);
    };
    armWatchdog();

    try {
      await streamChat(
        history,
        (delta) => {
          armWatchdog();
          setMessages((msgs) => {
            const out = [...msgs];
            const last = out[out.length - 1];
            out[out.length - 1] = { ...last, content: last.content + delta };
            return out;
          });
          scrollDown();
        },
        {
          project: "vida",
          signal: controller.signal,
          sessionKey: sessionKey.current,
          resume: sdkSession.current,
          onSession: (sid) => {
            sdkSession.current = sdkSession.current ?? sid;
          },
        },
      );
      // El asesor pudo registrar/corregir datos: refresca saldo y paneles.
      onDataChanged?.();
    } catch (err) {
      const aborted = controller.signal.aborted;
      setMessages((msgs) => {
        const out = [...msgs];
        const last = out[out.length - 1];
        if (aborted && last.content) {
          // Se detuvo a mitad de respuesta: se conserva lo que alcanzó a decir.
          out[out.length - 1] = { ...last, content: `${last.content}\n\n_(detenido)_` };
        } else {
          out[out.length - 1] = {
            role: "assistant",
            content: aborted
              ? "_Respuesta detenida._"
              : `${ERROR_MARK}${err instanceof Error ? err.message : String(err)}`,
          };
        }
        return out;
      });
      if (!aborted) setFailed(content);
    } finally {
      if (stall) clearTimeout(stall);
      abortRef.current = null;
      setBusy(false);
      scrollDown();
      inputRef.current?.focus();
    }
  };

  /** Reintenta el último mensaje fallido (quita su fila de error primero). */
  const retry = () => {
    if (!failed || busy) return;
    // fila de error del asistente + el user que la provocó (sendWith los re-crea)
    const base = [...messages];
    if (base[base.length - 1]?.role === "assistant") base.pop();
    if (base[base.length - 1]?.role === "user") base.pop();
    void sendWith(base, failed);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Mensajes */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2"
      >
        {messages.length === 0 && (
          <div className="flex flex-col gap-3 pt-1">
            <p className="text-sm text-text-dim">
              {online
                ? "Pregúntale con tu saldo y tus gastos a la vista; también registra movimientos."
                : "El agente está fuera de línea: el asesor vuelve cuando se conecte."}
            </p>
            {online && (
              <div className="flex flex-wrap gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="h-7 cursor-pointer rounded-full border border-line px-3 text-xs text-text-dim transition-colors hover:border-line-2 hover:bg-hover hover:text-text"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => {
          const isError = m.role === "assistant" && m.content.startsWith(ERROR_MARK);
          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] rounded-md bg-selected px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap text-text">
                  {m.content}
                </p>
              </div>
            );
          }
          return (
            <div key={i} className="text-sm leading-relaxed text-text">
              {isError ? (
                <p className="text-red">{m.content.slice(ERROR_MARK.length)}</p>
              ) : m.content ? (
                <Markdown source={m.content} />
              ) : busy && i === messages.length - 1 ? (
                <span className="pulse-dot text-text-faint">Pensando…</span>
              ) : null}
            </div>
          );
        })}
        {failed && !busy && (
          <Button variant="secondary" onClick={retry}>
            Reintentar
          </Button>
        )}
      </div>

      {/* Composer: nunca se deshabilita — si hay turno en vuelo, el botón detiene. */}
      <form
        className="hud-field mt-3 flex items-end gap-2 rounded-md border border-line bg-panel py-1.5 pr-1.5 pl-3 transition-colors focus-within:border-accent/60"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={inputRef}
          value={draft}
          rows={1}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          aria-label="Mensaje al asesor"
          placeholder={busy ? "El asesor responde…" : "Pregúntale a tu asesor…"}
          className="max-h-24 min-h-7 flex-1 resize-none bg-transparent py-1 text-sm leading-snug text-text outline-none placeholder:text-text-faint"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            title="Detener respuesta"
            aria-label="Detener respuesta"
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-text text-bg transition-opacity hover:opacity-85"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            title="Enviar (Enter)"
            aria-label="Enviar"
            disabled={!draft.trim()}
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors disabled:cursor-default disabled:bg-selected disabled:text-text-faint"
          >
            <IconArrowUp size={14} />
          </button>
        )}
      </form>
    </div>
  );
}
