"use client";

import { useEffect, useRef, useState } from "react";
import { streamChat, type ChatMessage } from "@/lib/hermes";
import { Markdown } from "@/components/Markdown";

// Sin datos del stream por este tiempo = turno colgado → se aborta solo.
// Holgado a propósito: el asesor corre tools reales (consultas de finanzas).
const STALL_MS = 120_000;

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
 * ⏹ detener (abort real), un watchdog corta streams colgados (agente
 * reiniciado a mitad de turno, red dormida) y un error deja el mensaje con
 * ↻ reintentar en vez de tragárselo.
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
  /** Último mensaje que falló (para el chip ↻ reintentar). */
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
          out[out.length - 1] = { ...last, content: `${last.content} ⏹` };
        } else {
          out[out.length - 1] = {
            role: "assistant",
            content: aborted
              ? "⏹ detenido"
              : `⚠ ${err instanceof Error ? err.message : String(err)}`,
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
        className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-4 text-center">
            <span className="text-xs leading-relaxed tracking-label text-text-dim">
              {online ? "TU ASESOR FINANCIERO — con tu saldo y gastos a la vista" : "AGENTE OFFLINE"}
            </span>
            <div className="flex flex-wrap justify-center gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-sm border border-line px-2 py-1 text-2xs text-text-dim transition-colors hover:border-violet hover:text-violet"
                >
                  “{s}”
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="text-sm leading-relaxed">
            <span
              className={`mr-2 text-2xs font-semibold tracking-label ${
                m.role === "user" ? "text-cyan" : "text-violet"
              }`}
            >
              {m.role === "user" ? "RULO ›" : "ASESOR ›"}
            </span>
            {m.role === "assistant" && m.content && !m.content.startsWith("⚠") ? (
              <div className="mt-0.5">
                <Markdown source={m.content} />
              </div>
            ) : (
              <span className={`whitespace-pre-wrap ${m.content.startsWith("⚠") ? "text-amber" : ""}`}>
                {m.content ||
                  (busy && i === messages.length - 1 ? (
                    <span className="pulse-dot">pensando…</span>
                  ) : (
                    ""
                  ))}
              </span>
            )}
          </div>
        ))}
        {failed && !busy && (
          <button
            type="button"
            onClick={retry}
            className="rounded-sm border border-line px-2 py-1 text-2xs text-text-dim transition-colors hover:border-violet hover:text-violet"
          >
            ↻ Reintentar
          </button>
        )}
      </div>

      {/* Input: nunca se deshabilita — si hay turno en vuelo, el botón detiene. */}
      <form
        className="mt-2 flex items-end gap-2 border-t border-line pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <span className="pb-1 text-violet">{busy ? "◌" : "❯"}</span>
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
          placeholder={busy ? "el asesor responde… (⏹ para detener)" : "pregúntale a tu asesor…"}
          className="max-h-24 flex-1 resize-none bg-transparent text-sm leading-snug outline-none placeholder:opacity-40"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            title="Detener respuesta"
            aria-label="Detener respuesta"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-amber bg-amber/5 text-amber transition-opacity"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
              <rect x="5" y="5" width="14" height="14" rx="1.5" />
            </svg>
          </button>
        ) : (
          <button
            type="submit"
            title="Enviar (Enter)"
            aria-label="Enviar"
            disabled={!draft.trim()}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-violet bg-violet/5 text-violet transition-opacity disabled:opacity-30"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 12h14M13 6l6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </form>
    </div>
  );
}
