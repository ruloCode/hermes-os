"use client";

/**
 * Chat de UNA pieza (panel derecho del takeover) — al estándar de la
 * industria (Mobbin):
 *  · v0 / ChatGPT Codex: cada mutación del agente es una TARJETA inline en el
 *    hilo ("✓ Guion · Hook") — el cambio se ve, no se intuye.
 *  · ChatGPT: botón Stop mientras corre (aborta el turno DE VERDAD, el
 *    signal llega hasta el SDK), estado "pensando" animado.
 *  · Bard / Copilot: empty state con tarjetas de sugerencia (label + qué hace).
 *  · Grok: acciones al hover (copiar) en las respuestas.
 * Autoscroll inteligente: solo pega al fondo si YA estabas abajo; si subiste
 * a leer, aparece la píldora ↓ (nunca te roba el scroll).
 *
 * El agente solo puede leer/modificar esta pieza (tools acotadas). Cada
 * evento `piece` del stream refresca el board al instante vía mergePiece.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentChatMessage, ContentPiece } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { hermesFetch, hermesGet } from "@/lib/hermes";
import { Markdown } from "@/components/Markdown";

/** Sugerencias del empty state: qué pide + qué va a pasar (patrón Bard). */
const SUGGESTIONS: { label: string; hint: string }[] = [
  { label: "Mejora el hook", hint: "Lo reescribe con más gancho, sin sobreprometer" },
  { label: "Dame 5 versiones del hook", hint: "Ángulos distintos directo al pool de versiones" },
  { label: "Acorta el guion", hint: "Aprieta los bloques conservando cues y CTA" },
  { label: "Escribe los copies por red", hint: "Título + copy por plataforma, hook reescrito" },
];

/** Campo del update_piece → etiqueta humana de la tarjeta de cambio. */
const FIELD_LABELS: Record<string, string> = {
  hook: "Hook",
  script_md: "Guion",
  takes: "Tomas",
  edit_points: "Edición",
  publications: "Publicación",
  variants: "Versiones",
  status: "Etapa",
  publish_at: "Fecha",
  title: "Título",
  notes: "Notas",
  platforms: "Plataformas",
  format: "Formato",
  week_label: "Semana",
};

interface LocalMsg {
  role: "user" | "assistant";
  content: string;
  /** Mutaciones aplicadas durante el turno (tarjetas ✓, en orden). */
  applied?: string[][];
  /** true = el turno sigue streameando. */
  live?: boolean;
  /** El agente está dentro de una tool ("editando la pieza…"). */
  working?: boolean;
  /** El turno cerró con error (habilita Reintentar). */
  failed?: boolean;
}

export function PieceChat({ piece }: { piece: ContentPiece }) {
  const { mergePiece } = useEstudioContext();
  const [messages, setMessages] = useState<LocalMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [copiedAt, setCopiedAt] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const lastUserRef = useRef("");

  // Historial persistido de ESTA pieza (cambiar de pieza cambia el hilo).
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setMessages([]);
    hermesGet<{ messages: ContentChatMessage[] }>(`/content/pieces/${piece.id}/chat`)
      .then((r) => {
        if (alive) setMessages(r.messages.map((m) => ({ role: m.role, content: m.content })));
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
      abortRef.current?.abort();
    };
  }, [piece.id]);

  /** Pega al fondo SOLO si el usuario ya estaba abajo (no roba el scroll). */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottomRef.current) setShowJump(false);
  };

  const jumpToBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    nearBottomRef.current = true;
    setShowJump(false);
  };

  /** Actualiza el mensaje vivo (el último, mientras streamea). */
  const patchLive = useCallback((fn: (prev: LocalMsg) => LocalMsg) => {
    setMessages((m) => m.map((x, i) => (i === m.length - 1 && x.live ? fn(x) : x)));
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      lastUserRef.current = message;
      setBusy(true);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      nearBottomRef.current = true;
      setMessages((m) => [
        ...m,
        { role: "user", content: message },
        { role: "assistant", content: "", live: true },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await hermesFetch(`/content/pieces/${piece.id}/chat`, {
          method: "POST",
          signal: ctrl.signal,
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const handle = (raw: string) => {
          const data = raw
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (!data) return;
          try {
            const ev = JSON.parse(data) as {
              delta?: string;
              tool?: string;
              piece?: ContentPiece;
              applied?: string[];
              done?: boolean;
              error?: boolean;
            };
            if (ev.delta) patchLive((p) => ({ ...p, content: p.content + ev.delta }));
            // El agente entró a una tool: "aplicando…" hasta que llegue el piece.
            if (ev.tool) patchLive((p) => ({ ...p, working: true }));
            if (ev.piece) {
              mergePiece(ev.piece); // el board se refresca YA, sin esperar el poll
              const fields = ev.applied ?? [];
              patchLive((p) => ({ ...p, working: false, applied: [...(p.applied ?? []), fields] }));
            }
            if (ev.done && ev.error)
              patchLive((p) => ({
                ...p,
                failed: true,
                content: p.content || "El turno terminó con error.",
              }));
          } catch {
            /* keep-alive */
          }
        };
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) !== -1) {
            handle(buffer.slice(0, sep));
            buffer = buffer.slice(sep + 2);
          }
        }
        if (buffer.trim()) handle(buffer);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // Stop: lo streameado vale; el server también abortó el turno.
          patchLive((p) => ({ ...p, content: p.content || "(detenido)" }));
        } else {
          patchLive((p) => ({
            ...p,
            failed: true,
            content: p.content || `No pude hablar con el agente: ${String(err).slice(0, 120)}`,
          }));
        }
      } finally {
        setMessages((m) => m.map((x) => (x.live ? { ...x, live: false, working: false } : x)));
        setBusy(false);
        abortRef.current = null;
      }
    },
    [busy, piece.id, mergePiece, patchLive],
  );

  const stop = () => abortRef.current?.abort();

  const copyMsg = (content: string, i: number) => {
    void navigator.clipboard?.writeText(content);
    setCopiedAt(i);
    setTimeout(() => setCopiedAt((c) => (c === i ? null : c)), 1500);
  };

  /** Composer auto-crecible (1 línea → tope ~6). */
  const autoGrow = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  };

  const empty = loaded && !messages.length;

  return (
    /* h-full: el body del Panel es un div BLOCK (no flex) — flex-1 aquí no
       hace nada y el composer quedaba flotando a media altura. Con altura
       definida, los mensajes scrollean y el composer queda FIJO abajo. */
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-1"
      >
        {/* Empty state (patrón Bard/Copilot): qué es + sugerencias con hint. */}
        {empty && (
          <div className="flex flex-col gap-2 px-1 py-3">
            <p className="text-xs leading-relaxed text-text-dim">
              Este chat solo ve y modifica <span className="text-text">esta pieza</span> — pide el
              cambio y lo aplica directo: lo ves actualizarse al lado.
            </p>
            <div className="mt-1 flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  onClick={() => void send(s.label)}
                  className="group rounded-sm border border-line bg-panel-2/40 px-2.5 py-2 text-left transition-colors hover:border-violet/50 hover:bg-violet/6"
                >
                  <span className="block text-xs text-text group-hover:text-violet">
                    {s.label}
                  </span>
                  <span className="mt-0.5 block text-2xs leading-snug text-text-faint">
                    {s.hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className="group mb-2.5">
            {m.role === "user" ? (
              /* Usuario: burbuja compacta a la derecha (estándar universal). */
              <div className="flex justify-end pl-8">
                <p className="max-w-full rounded-md rounded-br-xs bg-violet/14 px-2.5 py-1.5 text-xs leading-relaxed break-words text-text">
                  {m.content}
                </p>
              </div>
            ) : (
              <div className="pr-2">
                {/* Tarjetas de cambio aplicado (patrón v0): la mutación es un
                    artefacto del hilo, con QUÉ tocó. */}
                {m.applied?.map((fields, j) => (
                  <div
                    key={j}
                    className="mb-1.5 flex items-center gap-2 rounded-sm border border-green/30 bg-green/6 px-2 py-1"
                  >
                    <span className="text-2xs text-green">✓</span>
                    <span className="min-w-0 flex-1 truncate text-2xs text-text-dim">
                      Pieza actualizada
                      {fields.length > 0 && (
                        <span className="text-green">
                          {" "}
                          · {fields.map((f) => FIELD_LABELS[f] ?? f).join(" · ")}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
                {m.working && (
                  <div className="mb-1.5 flex items-center gap-2 rounded-sm border border-line bg-panel-2/50 px-2 py-1">
                    <span className="animate-pulse text-2xs text-violet">◌</span>
                    <span className="text-2xs text-text-faint">editando la pieza…</span>
                  </div>
                )}

                {m.content ? (
                  <div className="px-0.5 text-xs leading-relaxed">
                    <Markdown source={m.content} project="rulocodeshow" />
                  </div>
                ) : m.live ? (
                  /* Pensando: tres puntos con pulso escalonado (Base44). */
                  <span className="flex gap-1 px-1 py-1" aria-label="Hermes está pensando">
                    {[0, 150, 300].map((d) => (
                      <span
                        key={d}
                        className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet/70"
                        style={{ animationDelay: `${d}ms` }}
                      />
                    ))}
                  </span>
                ) : null}

                {/* Acciones al hover (Grok): copiar · reintentar si falló. */}
                {!m.live && m.content && (
                  <div className="mt-0.5 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => copyMsg(m.content, i)}
                      className="text-2xs text-text-faint hover:text-text-dim"
                    >
                      {copiedAt === i ? "✓ copiado" : "⧉ copiar"}
                    </button>
                    {m.failed && (
                      <button
                        onClick={() => void send(lastUserRef.current)}
                        className="text-2xs text-amber hover:text-text"
                      >
                        ↻ reintentar
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Píldora ↓: hay contenido nuevo abajo y el usuario está leyendo arriba. */}
      {showJump && (
        <button
          onClick={jumpToBottom}
          className="absolute bottom-16 left-1/2 z-10 -translate-x-1/2 rounded-full border border-line-2 bg-panel-2 px-2.5 py-1 text-2xs text-text-dim shadow-lg hover:border-violet hover:text-text"
          aria-label="Ir a lo último"
        >
          ↓ lo último
        </button>
      )}

      {/* Composer: textarea auto-crecible + enviar/stop (ChatGPT). */}
      <div className="flex shrink-0 items-end gap-1.5 border-t border-line px-1 pt-1.5">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="Pídele un cambio a esta pieza…"
          className="min-w-0 flex-1 resize-none rounded-md border border-line bg-panel-2/40 px-2.5 py-2 text-xs leading-relaxed text-text placeholder:text-text-faint focus:border-violet focus:outline-none"
        />
        {busy ? (
          <button
            onClick={stop}
            title="Detener el turno (lo aplicado hasta aquí se queda)"
            aria-label="Detener"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red/50 bg-red/10 text-xs text-red hover:bg-red/20"
          >
            ■
          </button>
        ) : (
          <button
            onClick={() => void send(input)}
            disabled={!input.trim()}
            aria-label="Enviar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet/60 bg-violet/14 text-sm text-violet transition-colors hover:bg-violet/25 disabled:border-line disabled:bg-transparent disabled:text-text-faint"
          >
            ↑
          </button>
        )}
      </div>
      <p className="shrink-0 px-1 pt-1 text-2xs text-text-faint">
        Enter envía · Shift+Enter salto · los cambios se aplican directo
      </p>
    </div>
  );
}
