"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSessionSummary } from "@hermes/shared";
import {
  streamChat,
  listChatSessions,
  getChatSession,
  claudeOpenTerminal,
  claudeStartRun,
  type ChatMessage,
  type ClaudeExecConfig,
} from "@/lib/hermes";
import { useSpeechDictation } from "@/hooks/useSpeechDictation";
import { ClaudeExecBar } from "./ClaudeExecBar";

/**
 * Consola con TABS: cada tab es una conversación (una sesión del Agent SDK).
 * El historial se lee DIRECTO de ~/.claude/projects — la misma fuente que ve
 * `claude` abierto en Cursor dentro del repo del proyecto en foco.
 */

// ── Modelo de tab ───────────────────────────────────────────────────────
interface ChatTab {
  /** id del tab; también viaja como X-Hermes-Session-Id (clave por tab). */
  key: string;
  /** sesión SDK que este tab resume (uuid del jsonl); null = aún sin crear. */
  sdkSessionId: string | null;
  title: string;
  messages: ChatMessage[];
  draft: string;
  busy: boolean;
}

interface TabsState {
  tabs: ChatTab[];
  active: string;
}

const newTab = (): ChatTab => ({
  key: crypto.randomUUID(),
  sdkSessionId: null,
  title: "",
  messages: [],
  draft: "",
  busy: false,
});

const freshState = (): TabsState => {
  const t = newTab();
  return { tabs: [t], active: t.key };
};

// "hace 3 h" a partir de un ISO string (última actividad de una sesión).
function timeAgo(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function ChatPanel({
  online,
  selectedProject,
  projectName,
  onClearProject,
  claudeConfig,
  onClaudeConfigChange,
  onClaudeRun,
  claudeSessionId,
}: {
  online: boolean;
  selectedProject?: string | null;
  projectName?: string;
  onClearProject?: () => void;
  claudeConfig: ClaudeExecConfig;
  onClaudeConfigChange: (cfg: ClaudeExecConfig) => void;
  onClaudeRun: (runId: string, sessionId: string) => void;
  /** Sesión de Claude Code activa a resumir (null = corrida nueva). */
  claudeSessionId?: string | null;
}) {
  const [state, setState] = useState<TabsState>(freshState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Tabs por proyecto: al cambiar el foco se guardan y restauran (en memoria).
  const byProject = useRef(new Map<string, TabsState>());
  const projKey = selectedProject || "general";
  const prevProj = useRef(projKey);

  const [histOpen, setHistOpen] = useState(false);
  const [hist, setHist] = useState<ChatSessionSummary[] | null>(null);
  const [histError, setHistError] = useState(false);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeNote, setClaudeNote] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const claudeInFlight = useRef(false);
  // Dictado: texto base y tab destino capturados al arrancar el mic.
  const dictationBaseRef = useRef("");
  const dictationTabRef = useRef("");

  const active = state.tabs.find((t) => t.key === state.active) ?? state.tabs[0];

  // ── Helpers de estado ─────────────────────────────────────────────────
  // Actualiza un tab por key aunque su proyecto ya no esté en foco (los
  // streams siguen escribiendo en el snapshot guardado en byProject). El
  // updater de React queda PURO (StrictMode lo invoca dos veces).
  const updateTab = (key: string, fn: (t: ChatTab) => ChatTab) => {
    if (stateRef.current.tabs.some((t) => t.key === key)) {
      setState((s) =>
        s.tabs.some((t) => t.key === key)
          ? { ...s, tabs: s.tabs.map((t) => (t.key === key ? fn(t) : t)) }
          : s,
      );
      return;
    }
    for (const [pk, ps] of byProject.current) {
      if (ps.tabs.some((t) => t.key === key)) {
        byProject.current.set(pk, {
          ...ps,
          tabs: ps.tabs.map((t) => (t.key === key ? fn(t) : t)),
        });
        return;
      }
    }
  };

  const scrollDown = (force = false) => {
    if (!force && !nearBottom.current) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  // Textarea auto-crecible (hasta ~5 líneas).
  const resizeInput = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Cambio de proyecto en foco: guarda los tabs actuales y restaura los suyos.
  useEffect(() => {
    if (prevProj.current === projKey) return;
    byProject.current.set(prevProj.current, stateRef.current);
    prevProj.current = projKey;
    setState(byProject.current.get(projKey) ?? freshState());
    setHistOpen(false);
    setHist(null);
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projKey]);

  // Al cambiar de tab: scroll abajo y recalcular alto del input.
  useEffect(() => {
    nearBottom.current = true;
    scrollDown(true);
    resizeInput();
    inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, projKey]);

  // El draft puede cambiar por fuera del onChange (enviar, dictado): re-mide.
  useEffect(() => {
    resizeInput();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.draft]);

  const { supported: micSupported, listening, error: micError, start: micStart, stop: micStop } =
    useSpeechDictation({
      onTranscript: (text) => {
        const base = dictationBaseRef.current;
        const sep = base && !base.endsWith(" ") ? " " : "";
        updateTab(dictationTabRef.current, (t) => ({ ...t, draft: base + sep + text }));
      },
    });

  const toggleMic = () => {
    if (listening) {
      micStop();
      return;
    }
    dictationBaseRef.current = active.draft.trimEnd();
    dictationTabRef.current = active.key;
    micStart();
    inputRef.current?.focus();
  };

  // ── Tabs ──────────────────────────────────────────────────────────────
  const addTab = () => {
    const t = newTab();
    setState((s) => ({ tabs: [...s.tabs, t], active: t.key }));
    setHistOpen(false);
  };

  const closeTab = (key: string) => {
    setState((s) => {
      const idx = s.tabs.findIndex((t) => t.key === key);
      const tabs = s.tabs.filter((t) => t.key !== key);
      if (tabs.length === 0) return freshState();
      const active =
        s.active === key ? tabs[Math.max(0, idx - 1)].key : s.active;
      return { tabs, active };
    });
  };

  // ── Historial (sesiones reales de ~/.claude/projects) ────────────────
  const toggleHist = async () => {
    if (histOpen) {
      setHistOpen(false);
      return;
    }
    setHistOpen(true);
    setHist(null);
    setHistError(false);
    try {
      setHist(await listChatSessions(selectedProject));
    } catch {
      setHistError(true);
    }
  };

  const openSession = async (id: string) => {
    // Si ya está abierta en un tab, solo actívalo.
    const existing = stateRef.current.tabs.find((t) => t.sdkSessionId === id);
    if (existing) {
      setState((s) => ({ ...s, active: existing.key }));
      setHistOpen(false);
      return;
    }
    const detail = await getChatSession(selectedProject, id);
    if (!detail) {
      setHistError(true);
      return;
    }
    const t: ChatTab = {
      key: crypto.randomUUID(),
      sdkSessionId: detail.id,
      title: detail.title.slice(0, 60),
      messages: detail.transcript,
      draft: "",
      busy: false,
    };
    setState((s) => ({ tabs: [...s.tabs, t], active: t.key }));
    setHistOpen(false);
  };

  // ── Enviar (por tab, con resume de SU sesión SDK) ─────────────────────
  const send = async (tabKey: string) => {
    const all = [
      ...stateRef.current.tabs,
      ...[...byProject.current.values()].flatMap((s) => s.tabs),
    ];
    const tab = all.find((t) => t.key === tabKey);
    if (!tab) return;
    const content = tab.draft.trim();
    if (!content || tab.busy) return;
    if (listening && dictationTabRef.current === tabKey) micStop();

    const history: ChatMessage[] = [...tab.messages, { role: "user", content }];
    updateTab(tabKey, (t) => ({
      ...t,
      draft: "",
      busy: true,
      title: t.title || content.slice(0, 40),
      messages: [...history, { role: "assistant", content: "" }],
    }));
    resizeInput();
    scrollDown(true);

    try {
      await streamChat(
        history,
        (delta) => {
          updateTab(tabKey, (t) => {
            const msgs = [...t.messages];
            const last = msgs[msgs.length - 1];
            msgs[msgs.length - 1] = { ...last, content: last.content + delta };
            return { ...t, messages: msgs };
          });
          scrollDown();
        },
        {
          project: selectedProject,
          sessionKey: tabKey,
          resume: tab.sdkSessionId,
          // El tab adopta la sesión SDK apenas nace → los próximos turnos
          // resumen ese MISMO jsonl (visible también desde Cursor).
          onSession: (sid) =>
            updateTab(tabKey, (t) => ({ ...t, sdkSessionId: t.sdkSessionId ?? sid })),
        },
      );
    } catch (err) {
      updateTab(tabKey, (t) => {
        const msgs = [...t.messages];
        msgs[msgs.length - 1] = {
          role: "assistant",
          content: `⚠ ${err instanceof Error ? err.message : String(err)}`,
        };
        return { ...t, messages: msgs };
      });
    } finally {
      updateTab(tabKey, (t) => ({ ...t, busy: false }));
      scrollDown();
    }
  };

  // Enviar el prompt al CLI real de Claude Code (Terminal.app o panel embebido).
  const runClaude = async (mode: "terminal" | "embedded") => {
    const content = active.draft.trim();
    if (!content) {
      setClaudeNote("Escribe un prompt primero.");
      return;
    }
    if (claudeInFlight.current) return; // ya hay una en curso
    claudeInFlight.current = true;
    setClaudeBusy(true);
    if (listening) micStop();
    try {
      if (mode === "terminal") {
        await claudeOpenTerminal(content, claudeConfig, selectedProject);
        setClaudeNote(`▶ Terminal.app abierta (${claudeConfig.model} · ${claudeConfig.effort}).`);
      } else {
        const { runId, sessionId } = await claudeStartRun(
          content,
          claudeConfig,
          selectedProject,
          claudeSessionId,
        );
        onClaudeRun(runId, sessionId);
        setClaudeNote("");
      }
      updateTab(active.key, (t) => ({ ...t, draft: "" }));
      resizeInput();
    } catch (err) {
      setClaudeNote(`⚠ ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      claudeInFlight.current = false;
      setClaudeBusy(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col">
      {/* Barra de tabs: historial · tabs (una conversación c/u) · nuevo */}
      <div className="relative mb-1.5 flex items-center gap-1.5 border-b pb-1.5" style={{ borderColor: "var(--line)" }}>
        <button
          type="button"
          title="Historial de conversaciones (las mismas que ve Claude Code en este repo)"
          aria-label="Historial de conversaciones"
          aria-expanded={histOpen}
          onClick={() => void toggleHist()}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm transition-colors"
          style={{ color: histOpen ? "var(--violet)" : "var(--text-dim)" }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path
              d="M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5M12 7v5l3.5 2"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {state.tabs.map((t) => {
            const isActive = t.key === state.active;
            return (
              <div
                key={t.key}
                onClick={() => setState((s) => ({ ...s, active: t.key }))}
                title={t.title || "Conversación nueva"}
                className="group flex max-w-[160px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] leading-none transition-colors"
                style={{
                  borderColor: isActive ? "var(--violet)" : "var(--line)",
                  color: isActive ? "var(--text)" : "var(--text-dim)",
                  background: isActive ? "rgba(167,139,250,0.08)" : "transparent",
                }}
              >
                {t.busy && (
                  <span className="pulse-dot shrink-0" style={{ color: "var(--amber)" }}>
                    ●
                  </span>
                )}
                <span className="truncate">{t.title || "nueva"}</span>
                <button
                  type="button"
                  title="Cerrar conversación"
                  aria-label="Cerrar conversación"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.key);
                  }}
                  className="shrink-0 opacity-40 transition-opacity hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            );
          })}
          <button
            type="button"
            title="Nueva conversación"
            aria-label="Nueva conversación"
            onClick={addTab}
            className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border border-dashed transition-colors hover:opacity-100"
            style={{ borderColor: "var(--line)", color: "var(--text-dim)" }}
          >
            +
          </button>
        </div>

        {/* Desplegable del historial (sesiones reales del repo en foco) */}
        {histOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setHistOpen(false)} />
            <div
              className="absolute top-8 left-0 z-20 max-h-80 w-[26rem] max-w-full overflow-y-auto rounded-sm border p-1"
              style={{
                borderColor: "var(--line-bright)",
                background: "rgba(8,10,22,0.96)",
                backdropFilter: "blur(8px)",
              }}
            >
              <p className="px-2 pt-1 pb-1.5 text-[8.5px] tracking-[0.22em] uppercase" style={{ color: "var(--text-dim)" }}>
                Sesiones de {selectedProject ? (projectName ?? selectedProject) : "Hermes (vault)"} · ~/.claude
              </p>
              {histError ? (
                <p className="px-2 py-3 text-center text-[10px] tracking-[0.2em]" style={{ color: "var(--red)" }}>
                  ⚠ NO SE PUDO LEER EL HISTORIAL
                </p>
              ) : hist === null ? (
                <p className="px-2 py-3 text-center text-[10px] tracking-[0.25em] pulse-dot" style={{ color: "var(--text-dim)" }}>
                  CARGANDO…
                </p>
              ) : hist.length === 0 ? (
                <p className="px-2 py-3 text-center text-[10px] tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
                  SIN CONVERSACIONES PREVIAS
                </p>
              ) : (
                hist.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void openSession(s.id)}
                    title={s.title}
                    className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left transition-colors hover:bg-[rgba(122,132,255,0.1)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[10.5px]" style={{ color: "var(--text)" }}>
                      {s.title}
                    </span>
                    <span className="shrink-0 text-[9px] tabular-nums" style={{ color: "var(--text-dim)" }}>
                      {timeAgo(s.updatedAt)} · {s.messages} msg
                    </span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Mensajes del tab activo */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current;
          if (!el) return;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1"
      >
        {active.messages.length === 0 && (
          <p className="pt-6 text-center text-[11px] leading-relaxed tracking-[0.2em]" style={{ color: "var(--text-dim)" }}>
            {online
              ? selectedProject
                ? `CONVERSACIÓN NUEVA SOBRE ${(projectName ?? selectedProject).toUpperCase()}`
                : "CONSOLA DIRECTA AL AGENTE — escribe una orden"
              : "AGENTE OFFLINE — corre `pnpm dev:agent`"}
            <br />
            <span className="text-[9px] tracking-[0.15em] opacity-70">
              Enter envía · Shift+Enter salto de línea · ⟲ abre el historial del repo
            </span>
          </p>
        )}
        {active.messages.map((m, i) => (
          <div key={i} className="text-[12.5px] leading-relaxed">
            <span
              className="mr-2 text-[9px] font-semibold tracking-[0.2em]"
              style={{ color: m.role === "user" ? "var(--cyan)" : "var(--violet)" }}
            >
              {m.role === "user" ? "RULO ›" : "HERMES ›"}
            </span>
            <span className="whitespace-pre-wrap">
              {m.content ||
                (active.busy && i === active.messages.length - 1 ? (
                  <span className="pulse-dot">pensando…</span>
                ) : (
                  ""
                ))}
            </span>
          </div>
        ))}
      </div>

      {/* Chip de foco de proyecto */}
      {selectedProject && (
        <div
          className="mt-2 flex items-center gap-2 self-start rounded-sm border px-2 py-1 text-[9px] tracking-[0.2em] uppercase"
          style={{ borderColor: "var(--cyan)", color: "var(--cyan)", background: "rgba(103,232,249,0.06)" }}
        >
          <span style={{ boxShadow: "0 0 8px var(--cyan)" }}>◈</span>
          <span>Hablando de {projectName ?? selectedProject}</span>
          <button
            type="button"
            title="Quitar foco de proyecto"
            className="opacity-60 hover:opacity-100"
            onClick={onClearProject}
          >
            ✕
          </button>
        </div>
      )}

      {/* Selector de ejecución de Claude Code (modelo · esfuerzo · permisos) */}
      <ClaudeExecBar
        config={claudeConfig}
        onChange={onClaudeConfigChange}
        onRun={(mode) => void runClaude(mode)}
        disabled={active.busy || claudeBusy}
      />
      {claudeNote && (
        <p className="mt-1 text-[9.5px] tracking-[0.1em]" style={{ color: "var(--text-dim)" }}>
          {claudeNote}
        </p>
      )}

      {/* Input: textarea auto-crecible · Enter envía · mic · enviar */}
      <form
        className="mt-2 flex items-end gap-2 border-t pt-2"
        style={{ borderColor: "var(--line)" }}
        onSubmit={(e) => {
          e.preventDefault();
          void send(active.key);
        }}
      >
        <span className="pb-1" style={{ color: "var(--violet)" }}>
          {active.busy ? "◌" : "❯"}
        </span>
        <textarea
          ref={inputRef}
          value={active.draft}
          rows={1}
          onChange={(e) => {
            const v = e.target.value;
            updateTab(active.key, (t) => ({ ...t, draft: v }));
            resizeInput();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(active.key);
            }
          }}
          placeholder={
            active.busy
              ? "Hermes está trabajando… (podés escribir en otro tab)"
              : listening
                ? "Escuchando… habla ahora"
                : selectedProject
                  ? `pregunta sobre ${projectName ?? selectedProject}…`
                  : "ordena algo…"
          }
          className="max-h-[120px] flex-1 resize-none bg-transparent text-[12.5px] leading-snug outline-none placeholder:opacity-40"
          disabled={active.busy}
        />

        {/* Micrófono (dictado voz → texto) */}
        {micSupported && (
          <button
            type="button"
            title={
              micError
                ? `Dictado: ${micError}`
                : listening
                  ? "Detener dictado"
                  : "Dictar por voz"
            }
            aria-label={listening ? "Detener dictado" : "Dictar por voz"}
            aria-pressed={listening}
            onClick={toggleMic}
            disabled={active.busy}
            className="relative grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40"
            style={{
              color: listening ? "var(--red)" : "var(--text-dim)",
              background: listening ? "rgba(251,113,133,0.12)" : "transparent",
            }}
          >
            {listening && (
              <span
                className="absolute inset-0 animate-ping rounded-full"
                style={{ background: "rgba(251,113,133,0.35)" }}
              />
            )}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="relative">
              <path
                d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        <button
          type="submit"
          title="Enviar (Enter)"
          aria-label="Enviar"
          disabled={active.busy || !active.draft.trim()}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-sm border transition-opacity disabled:opacity-30"
          style={{ borderColor: "var(--violet)", color: "var(--violet)", background: "rgba(167,139,250,0.06)" }}
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
      </form>
    </div>
  );
}
