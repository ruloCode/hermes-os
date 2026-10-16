"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeSessionSummary } from "@hermes/shared";
import {
  claudeKillRun,
  claudeRunStreamUrl,
  listClaudeSessions,
  getClaudeSession,
  deleteClaudeSession,
} from "@/lib/hermes";
import { PanelState } from "@/components/ui/PanelState";
import { ViewHeader } from "@/components/ui/ViewHeader";
import { Button } from "@/components/ui/Button";
import { CLAUDE_MODELS } from "@/components/ClaudeExecBar";

interface Line {
  t: number;
  kind: string;
  text: string;
}

// Estilo por tipo de línea del stream: clase de token en vez de color inline.
const STYLE: Record<string, { className: string; glyph: string }> = {
  init: { className: "text-text-dim", glyph: "●" },
  text: { className: "text-text", glyph: "" },
  tool: { className: "text-cyan", glyph: "⎿" },
  result: { className: "text-text-dim", glyph: "  ⤷" },
  done: { className: "text-green", glyph: "✓" },
  error: { className: "text-red", glyph: "⚠" },
  raw: { className: "text-text-dim", glyph: "·" },
};

// Etiqueta del modelo en sesiones guardadas: IDs vigentes (fuente única en
// ClaudeExecBar) + los alias con los que se guardaron las corridas viejas.
const MODEL_LABEL: Record<string, string> = {
  ...Object.fromEntries(CLAUDE_MODELS.map((m) => [m.value, m.label])),
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  fable: "Fable",
};

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "ahora";
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return "ayer";
  if (d < 7) return `hace ${d} d`;
  return iso.slice(5, 10);
}

type Status = "running" | "done" | "error" | "idle";

/**
 * Panel de Claude Code (CLI): transmite en vivo una corrida `claude -p`
 * (stream-json → SSE, con reconexión apoyada en el replay del backend) y permite
 * volver a cualquier sesión anterior del proyecto (dropdown) o empezar una nueva.
 * El resume real lo hace el CLI con --resume.
 */
export function ClaudeTerminal({
  project,
  runId,
  sessionId,
  onSelectSession,
  onNewSession,
  onStatus,
  onSend,
  embedded = false,
}: {
  project?: string | null;
  runId: string | null;
  sessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  /** Notifica el estado de la corrida (para gatear acciones como "continuar"). */
  onStatus?: (s: Status) => void;
  /**
   * Composer de chat: enviar más instrucciones a la conversación (resume la
   * sesión con un run nuevo). El padre decide la ruta (continueTask para
   * tareas de Linear · claudeStartRun para sesiones sueltas) y actualiza el
   * run activo. Sin onSend, el terminal es solo-lectura (comportamiento previo).
   */
  onSend?: (prompt: string) => Promise<{ runId: string; sessionId: string } | null>;
  /**
   * Dentro de otra pieza (detalle de tarea): sin ViewHeader propio — la vista
   * que lo contiene ya tiene cabecera. Solo la vista Consola abre con la suya.
   */
  embedded?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notifica el estado hacia arriba sin re-suscribir al cambiar la identidad del callback.
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  useEffect(() => {
    onStatusRef.current?.(status);
  }, [status]);

  const refreshSessions = useCallback(() => {
    void listClaudeSessions(project).then(setSessions);
  }, [project]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  // Cierra el menú al hacer clic afuera.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  useEffect(() => () => {
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
  }, []);

  // Display: corrida en vivo (runId) · sesión guardada (sessionId) · vacío.
  useEffect(() => {
    setLoadError(false);

    // ── LIVE: stream SSE de la corrida (con reconexión) ──
    if (runId) {
      setLines([]);
      setStatus("running");
      const es = new EventSource(claudeRunStreamUrl(runId));
      let errCount = 0;

      // El backend re-transmite TODO el buffer en cada (re)conexión → limpiar en
      // cada apertura evita duplicar líneas al reconectar tras un corte.
      es.onopen = () => {
        errCount = 0;
        setLines([]);
      };
      es.addEventListener("line", (e: MessageEvent) => {
        try {
          const line = JSON.parse(e.data) as Line;
          setLines((prev) => [...prev, line]);
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
          });
        } catch {
          /* ignora */
        }
      });
      es.addEventListener("status", (e: MessageEvent) => {
        try {
          const s = JSON.parse(e.data) as { status: "done" | "error" };
          setStatus(s.status);
          refreshSessions();
        } catch {
          /* ignora */
        }
      });
      es.addEventListener("end", () => {
        es.close();
        refreshSessions();
      });
      // No errorizar en el primer corte: EventSource reintenta solo (readyState
      // CONNECTING) y el backend re-transmite. Solo damos error si ya cerró de
      // forma permanente o si varios reintentos seguidos fallan.
      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED || ++errCount >= 4) {
          es.close();
          // El run ya no vive (evictado / agente reiniciado): cae al transcript
          // persistido de la sesión, así SIEMPRE se ve la conversación abierta.
          if (sessionId) {
            void getClaudeSession(project, sessionId).then((d) => {
              if (!d) {
                setStatus((s) => (s === "running" ? "error" : s));
                return;
              }
              setLines(d.lines);
              setStatus(d.status === "running" ? "idle" : d.status);
            });
          } else {
            setStatus((s) => (s === "running" ? "error" : s));
          }
          refreshSessions();
        }
      };
      return () => es.close();
    }

    // ── HISTORY: transcript guardado de una sesión anterior ──
    if (sessionId) {
      let alive = true;
      setLines([]);
      setStatus("idle");
      void getClaudeSession(project, sessionId).then((d) => {
        if (!alive) return;
        if (!d) {
          setLoadError(true);
          return;
        }
        setLines(d.lines);
        // "running" en disco = corrida en curso o interrumpida (server caído):
        // aquí no hay stream, así que se muestra como no-viva.
        setStatus(d.status === "running" ? "idle" : d.status);
      });
      return () => {
        alive = false;
      };
    }

    // ── EMPTY ──
    setLines([]);
    setStatus("idle");
  }, [runId, sessionId, project, refreshSessions]);

  const doDelete = useCallback(
    async (id: string) => {
      await deleteClaudeSession(project, id);
      refreshSessions();
      if (id === sessionId) onNewSession();
    },
    [project, sessionId, onNewSession, refreshSessions],
  );

  // Borrado en dos pasos: el primer clic arma (✕ → "¿borrar?"), el segundo borra.
  const armDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    if (confirmDelete === id) {
      setConfirmDelete(null);
      void doDelete(id);
    } else {
      setConfirmDelete(id);
      confirmTimer.current = setTimeout(() => setConfirmDelete(null), 3000);
    }
  };

  const selectSession = (id: string) => {
    onSelectSession(id);
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const active = sessions.find((s) => s.id === sessionId);
  const activeTitle = active?.title ?? (runId ? "Ejecutando…" : "Nueva conversación");

  // Selector de sesión: un botón-menú con el título de la conversación abierta.
  // En la vista Consola va en la cabecera (es lo que cambia QUÉ ves); dentro
  // de una tarea (embedded) va en una barra compacta propia.
  const sessionPicker = (
    <div
      ref={menuRef}
      className="relative flex min-w-0 items-center"
      onKeyDown={(e) => {
        if (e.key === "Escape" && menuOpen) {
          setMenuOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-controls="cc-session-menu"
        title="Sesiones de Claude Code de este proyecto"
        className={`flex h-7 min-w-0 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs transition-colors hover:bg-hover hover:text-text ${
          menuOpen ? "bg-hover text-text" : "text-text-dim"
        }`}
      >
        <span className="max-w-[260px] truncate">{activeTitle}</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-text-faint transition-transform ${menuOpen ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {menuOpen && (
        <div
          id="cc-session-menu"
          role="menu"
          aria-label="Sesiones de Claude Code"
          className="absolute top-full left-0 z-30 mt-1 max-h-[360px] w-[380px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-[var(--shadow-pop)]"
        >
          {sessions.length === 0 && <PanelState kind="empty" title="Sin sesiones aún" compact />}
          {sessions.map((s) => {
            const isActive = s.id === sessionId;
            const confirming = confirmDelete === s.id;
            return (
              <div
                key={s.id}
                role="menuitem"
                tabIndex={0}
                onClick={() => selectSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    selectSession(s.id);
                  }
                }}
                className={`group flex cursor-pointer items-start gap-2.5 rounded-sm px-2 py-1.5 outline-none transition-colors hover:bg-hover focus-visible:bg-hover ${
                  isActive ? "bg-selected" : ""
                }`}
              >
                {/* El color va en el punto: estado de la última corrida. */}
                <span
                  aria-hidden
                  className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                    s.status === "running"
                      ? "bg-cyan"
                      : s.status === "error"
                        ? "bg-red"
                        : "bg-green"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm leading-snug text-text">
                    {s.title || "Sin título"}
                  </p>
                  <p className="truncate text-2xs text-text-faint">
                    {relTime(s.updatedAt)} · {MODEL_LABEL[s.model] ?? s.model} ·{" "}
                    <span className="tabular-nums">{s.lineCount}</span> líneas
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => armDelete(s.id, e)}
                  title={confirming ? "Confirmar borrado" : "Borrar esta sesión"}
                  aria-label={confirming ? "Confirmar borrado de la sesión" : "Borrar esta sesión"}
                  className={`mt-0.5 grid h-6 shrink-0 cursor-pointer place-items-center rounded-xs px-1.5 text-2xs whitespace-nowrap transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-70 ${
                    confirming
                      ? "bg-red/10 text-red opacity-100"
                      : "text-text-faint opacity-0 hover:bg-hover hover:text-red"
                  }`}
                >
                  {confirming ? (
                    "¿Borrar?"
                  ) : (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // Estado de la corrida: el color va en el punto (cyan = en curso), el texto
  // en gris. Antes eran mayúsculas de color con glifos (◌ ✓ ⚠).
  const statusMeta: Record<Status, { dot: string; label: string }> = {
    running: { dot: "bg-cyan pulse-dot", label: "Ejecutando" },
    done: { dot: "bg-green", label: "Listo" },
    error: { dot: "bg-red", label: "Error" },
    idle: { dot: "bg-text-faint", label: "En espera" },
  };
  const statusBadge = (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-text-dim">
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${statusMeta[status].dot}`} />
      {statusMeta[status].label}
    </span>
  );

  const controls = (
    <>
      {statusBadge}
      {status === "running" && runId && (
        <Button
          variant="danger"
          onClick={() => {
            setStopping(true);
            void claudeKillRun(runId).finally(() => setStopping(false));
          }}
          disabled={stopping}
          title="Detener la ejecución (kill del proceso)"
          icon={
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="5" y="5" width="14" height="14" rx="2" />
            </svg>
          }
        >
          {stopping ? "Deteniendo…" : "Detener"}
        </Button>
      )}
      <Button
        onClick={() => {
          onNewSession();
          setMenuOpen(false);
        }}
        title="Empezar una conversación nueva"
        icon={
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        }
      >
        Nueva
      </Button>
    </>
  );

  const empty = lines.length === 0 && status !== "running";

  return (
    <div className="flex h-full min-h-0 flex-col">
      {embedded ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          {sessionPicker}
          <div className="flex shrink-0 items-center gap-2">{controls}</div>
        </div>
      ) : (
        <ViewHeader
          title="Consola"
          meta={project ?? undefined}
          tabs={sessionPicker}
          actions={controls}
        />
      )}

      {empty ? (
        // Vacío en sans y con salida: qué hacer para llenar esto, y el atajo a
        // las sesiones guardadas si existen.
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-10 text-center">
          <span
            aria-hidden
            className="mb-3 grid h-10 w-10 place-items-center rounded-full border border-line bg-panel-2 text-text-faint"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
              <path d="m7.5 9.5 2.8 2.5-2.8 2.5M13 15h3.5" />
            </svg>
          </span>
          {loadError ? (
            <>
              <p className="text-sm font-medium text-text">No se pudo cargar la conversación</p>
              <p className="mt-1 max-w-[44ch] text-xs text-text-faint">
                ¿El agente está desconectado? Vuelve a abrir la sesión cuando responda.
              </p>
            </>
          ) : sessionId ? (
            <>
              <p className="text-sm font-medium text-text">Esta sesión está vacía</p>
              <p className="mt-1 max-w-[44ch] text-xs text-text-faint">
                {onSend
                  ? "Escribe abajo para seguir instruyendo a Claude Code."
                  : "Escribe un pedido en Inicio y ejecútalo con «Consola»."}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-text">Sin ejecución abierta</p>
              <p className="mt-1 max-w-[46ch] text-xs text-text-faint">
                Escribe un pedido en Inicio y ejecútalo con «Consola», o retoma una sesión
                anterior de Claude Code.
              </p>
            </>
          )}
          {!loadError && sessions.length > 0 && (
            <Button className="mt-4" onClick={() => setMenuOpen(true)}>
              Ver sesiones ({sessions.length})
            </Button>
          )}
        </div>
      ) : (
        // El log SÍ va en mono: es salida de un programa (rutas, comandos, código).
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto rounded-md border border-line bg-panel px-4 py-3 font-mono text-xs leading-relaxed"
        >
          {lines.map((l, i) => {
            const st = STYLE[l.kind] ?? STYLE.raw;
            return (
              <div key={i} className={`whitespace-pre-wrap break-words ${st.className}`}>
                {st.glyph && <span className="mr-1.5 opacity-80">{st.glyph}</span>}
                {l.text}
              </div>
            );
          })}
          {status === "running" && <div className="cursor-blink mt-1" />}
        </div>
      )}

      {/* ── Composer: seguir instruyendo como en un chat. Misma caja que el
          composer de Inicio (borde, radio, botón redondo índigo) para que se
          lea como el mismo gesto. ── */}
      {onSend && (
        <form
          className="hud-field mt-3 flex shrink-0 items-end gap-2 rounded-lg border border-line-2 bg-panel py-2 pr-2 pl-3.5 shadow-[var(--shadow-card)] transition-colors focus-within:border-text-faint/60"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={draft.includes("\n") ? 3 : 1}
            placeholder={
              status === "running"
                ? "Ejecutando… detén el run o espera para enviar más instrucciones"
                : "Escribe más instrucciones (Enter envía · Shift+Enter salto)…"
            }
            disabled={status === "running" || sending}
            className="min-w-0 flex-1 resize-none self-center bg-transparent py-1 text-sm leading-relaxed text-text outline-none placeholder:text-text-faint disabled:opacity-50"
          />
          <button
            type="submit"
            title="Enviar (Enter)"
            aria-label="Enviar"
            disabled={!draft.trim() || status === "running" || sending}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors disabled:cursor-default disabled:bg-selected disabled:text-text-faint"
          >
            {sending ? (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current pulse-dot" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M12 19V5M6 11l6-6 6 6"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            )}
          </button>
        </form>
      )}
    </div>
  );

  async function send() {
    const prompt = draft.trim();
    if (!prompt || !onSend || status === "running" || sending) return;
    setSending(true);
    try {
      const run = await onSend(prompt);
      if (run) setDraft("");
    } finally {
      setSending(false);
    }
  }
}
