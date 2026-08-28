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

  return (
    <div className="flex h-full flex-col">
      {/* ── Barra: selector de sesión + nueva + estado ── */}
      <div className="mb-2 flex items-center justify-between gap-2">
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
            className="flex min-w-0 items-center gap-1.5 text-2xs tracking-label text-violet"
          >
            <span className="shrink-0 text-text-dim opacity-70">⌘</span>
            <span className="max-w-[200px] truncate">{activeTitle}</span>
            <span className="shrink-0 text-text-dim">{menuOpen ? "▴" : "▾"}</span>
          </button>

          {menuOpen && (
            <div
              id="cc-session-menu"
              role="menu"
              aria-label="Sesiones de Claude Code"
              className="elev-2 absolute left-0 top-full z-30 mt-1 max-h-[300px] w-[300px] overflow-y-auto border border-line-2 bg-panel-2 backdrop-blur-md"
            >
              {sessions.length === 0 && (
                <PanelState kind="empty" title="Sin sesiones aún" compact />
              )}
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
                    className={`group flex cursor-pointer items-start gap-2 border-b border-line px-2.5 py-2 outline-none transition-colors focus-visible:bg-violet/10 ${
                      isActive ? "bg-violet/10" : "bg-transparent"
                    }`}
                  >
                    <span
                      className={`mt-1 shrink-0 ${
                        s.status === "running"
                          ? "text-amber"
                          : s.status === "error"
                            ? "text-red"
                            : "text-green"
                      }`}
                    >
                      ◈
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-xs leading-snug ${
                          isActive ? "text-violet-hot" : "text-text"
                        }`}
                      >
                        {s.title || "Sin título"}
                      </p>
                      <p className="text-2xs tracking-label text-text-dim uppercase">
                        {relTime(s.updatedAt)} · {MODEL_LABEL[s.model] ?? s.model} · {s.lineCount} líneas
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => armDelete(s.id, e)}
                      title={confirming ? "Confirmar borrado" : "Borrar esta sesión"}
                      aria-label={confirming ? "Confirmar borrado de la sesión" : "Borrar esta sesión"}
                      className={`shrink-0 whitespace-nowrap text-2xs tracking-label text-red uppercase transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-70 [@media(hover:none)]:opacity-70 ${
                        confirming ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      {confirming ? "¿borrar?" : "✕"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {status === "running" && runId && (
            <button
              type="button"
              onClick={() => {
                setStopping(true);
                void claudeKillRun(runId).finally(() => setStopping(false));
              }}
              disabled={stopping}
              title="Detener la ejecución (kill del proceso)"
              className="rounded-sm border border-red px-2 py-0.5 text-2xs tracking-label text-red uppercase transition-opacity hover:opacity-100 disabled:opacity-40"
            >
              {stopping ? "…" : "⏹ Detener"}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onNewSession();
              setMenuOpen(false);
            }}
            title="Empezar una conversación nueva"
            className="rounded-sm border border-line-2 px-2 py-0.5 text-2xs tracking-label text-violet uppercase transition-colors hover:opacity-100"
          >
            + Nueva
          </button>
          <span
            className={`text-2xs tracking-label uppercase ${
              status === "running"
                ? "text-amber"
                : status === "done"
                  ? "text-green"
                  : status === "error"
                    ? "text-red"
                    : "text-text-dim"
            }`}
          >
            {status === "running"
              ? "◌ EJECUTANDO"
              : status === "done"
                ? "✓ LISTO"
                : status === "error"
                  ? "⚠ ERROR"
                  : "EN ESPERA"}
          </span>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-sm bg-bg/60 p-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 && status !== "running" && (
          <p
            className={`pt-6 text-center text-xs leading-relaxed tracking-label ${
              loadError ? "text-red" : "text-text-dim"
            }`}
          >
            {loadError
              ? "⚠ NO SE PUDO CARGAR EL TRANSCRIPT — ¿AGENTE OFFLINE? VUELVE A ABRIR LA SESIÓN"
              : sessionId
                ? "SESIÓN VACÍA — ESCRIBE UN PROMPT EN LA PESTAÑA CONSOLA Y EJECUTA CON “▣ PANEL”"
                : "NUEVA CONVERSACIÓN — DESDE LA PESTAÑA CONSOLA EJECUTA CON “▣ PANEL”, O ABRE ▾ PARA VOLVER A UNA SESIÓN"}
          </p>
        )}
        {lines.map((l, i) => {
          const st = STYLE[l.kind] ?? STYLE.raw;
          return (
            <div key={i} className={`whitespace-pre-wrap break-words ${st.className}`}>
              {st.glyph && <span className="mr-1.5 opacity-80">{st.glyph}</span>}
              {l.text}
            </div>
          );
        })}
        {status === "running" && <div className="cursor-blink mt-1 text-violet">▋</div>}
      </div>

      {/* ── Composer: seguir instruyendo como en un chat ── */}
      {onSend && (
        <div className="mt-2 flex shrink-0 items-end gap-2">
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
            className="min-w-0 flex-1 resize-none rounded-sm border border-line bg-transparent px-2 py-1.5 text-xs text-text outline-none transition-colors focus:border-line-2 disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.trim() || status === "running" || sending}
            className="cmd-btn !w-auto !border-violet !text-violet disabled:opacity-40"
          >
            {sending ? "…" : "Enviar ↵"}
          </button>
        </div>
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
