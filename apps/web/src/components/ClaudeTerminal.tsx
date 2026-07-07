"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClaudeSessionSummary } from "@hermes/shared";
import {
  claudeRunStreamUrl,
  listClaudeSessions,
  getClaudeSession,
  deleteClaudeSession,
} from "@/lib/hermes";

interface Line {
  t: number;
  kind: string;
  text: string;
}

const STYLE: Record<string, { color: string; glyph: string }> = {
  init: { color: "var(--text-dim)", glyph: "●" },
  text: { color: "var(--text)", glyph: "" },
  tool: { color: "var(--cyan)", glyph: "⎿" },
  result: { color: "var(--text-dim)", glyph: "  ⤷" },
  done: { color: "var(--green)", glyph: "✓" },
  error: { color: "var(--red)", glyph: "⚠" },
  raw: { color: "var(--text-dim)", glyph: "·" },
};

const MODEL_LABEL: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku" };

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
}: {
  project?: string | null;
  runId: string | null;
  sessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [loadError, setLoadError] = useState(false);
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          setStatus((s) => (s === "running" ? "error" : s));
          es.close();
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
            className="flex min-w-0 items-center gap-1.5 text-[10px] tracking-[0.14em]"
            style={{ color: "var(--violet)" }}
          >
            <span className="shrink-0 opacity-70" style={{ color: "var(--text-dim)" }}>
              ⌘
            </span>
            <span className="truncate" style={{ maxWidth: 200 }}>
              {activeTitle}
            </span>
            <span className="shrink-0" style={{ color: "var(--text-dim)" }}>
              {menuOpen ? "▴" : "▾"}
            </span>
          </button>

          {menuOpen && (
            <div
              id="cc-session-menu"
              role="menu"
              aria-label="Sesiones de Claude Code"
              className="absolute left-0 top-full z-30 mt-1 max-h-[300px] w-[300px] overflow-y-auto border shadow-lg"
              style={{ background: "rgba(10,12,26,0.98)", borderColor: "var(--line-bright)" }}
            >
              {sessions.length === 0 && (
                <p
                  className="px-3 py-3 text-center text-[10px] tracking-[0.2em]"
                  style={{ color: "var(--text-dim)" }}
                >
                  SIN SESIONES AÚN
                </p>
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
                    className="group flex cursor-pointer items-start gap-2 border-b px-2.5 py-2 outline-none transition-colors focus-visible:bg-[rgba(167,139,250,0.12)]"
                    style={{
                      borderColor: "var(--line)",
                      background: isActive ? "rgba(167,139,250,0.1)" : "transparent",
                    }}
                  >
                    <span
                      className="mt-1 shrink-0"
                      style={{
                        color:
                          s.status === "running"
                            ? "var(--amber)"
                            : s.status === "error"
                              ? "var(--red)"
                              : "var(--green)",
                      }}
                    >
                      ◈
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="truncate text-[11px] leading-snug"
                        style={{ color: isActive ? "var(--violet-hot)" : "var(--text)" }}
                      >
                        {s.title || "Sin título"}
                      </p>
                      <p className="text-[8.5px] tracking-[0.12em] uppercase" style={{ color: "var(--text-dim)" }}>
                        {relTime(s.updatedAt)} · {MODEL_LABEL[s.model] ?? s.model} · {s.lineCount} líneas
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => armDelete(s.id, e)}
                      title={confirming ? "Confirmar borrado" : "Borrar esta sesión"}
                      aria-label={confirming ? "Confirmar borrado de la sesión" : "Borrar esta sesión"}
                      className={`shrink-0 whitespace-nowrap text-[9px] tracking-[0.15em] uppercase transition-opacity focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-70 [@media(hover:none)]:opacity-70 ${
                        confirming ? "opacity-100" : "opacity-0"
                      }`}
                      style={{ color: "var(--red)" }}
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
          <button
            type="button"
            onClick={() => {
              onNewSession();
              setMenuOpen(false);
            }}
            title="Empezar una conversación nueva"
            className="rounded-sm border px-2 py-0.5 text-[9px] tracking-[0.15em] uppercase transition-colors hover:opacity-100"
            style={{ borderColor: "var(--line-bright)", color: "var(--violet)" }}
          >
            + Nueva
          </button>
          <span
            className="text-[9px] tracking-[0.2em] uppercase"
            style={{
              color:
                status === "running"
                  ? "var(--amber)"
                  : status === "done"
                    ? "var(--green)"
                    : status === "error"
                      ? "var(--red)"
                      : "var(--text-dim)",
            }}
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
        className="min-h-0 flex-1 overflow-y-auto rounded-sm p-2 text-[11.5px] leading-relaxed"
        style={{ background: "rgba(4,5,12,0.6)", fontFamily: "var(--font-mono), monospace" }}
      >
        {lines.length === 0 && status !== "running" && (
          <p className="pt-6 text-center text-[11px] leading-relaxed tracking-[0.2em]" style={{ color: loadError ? "var(--red)" : "var(--text-dim)" }}>
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
            <div key={i} className="whitespace-pre-wrap break-words" style={{ color: st.color }}>
              {st.glyph && <span className="mr-1.5 opacity-80">{st.glyph}</span>}
              {l.text}
            </div>
          );
        })}
        {status === "running" && (
          <div className="cursor-blink mt-1" style={{ color: "var(--violet)" }}>
            ▋
          </div>
        )}
      </div>
    </div>
  );
}
