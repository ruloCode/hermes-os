"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatSessionSummary, ChatToolStep } from "@hermes/shared";
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
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useWorkspace } from "@/state/WorkspaceContext";
import { ClaudeExecBar, claudeModelLabel } from "./ClaudeExecBar";
import { HermesMark } from "./shell/HermesMark";
import { AgentSteps } from "./AgentSteps";
import { PanelState } from "@/components/ui/PanelState";
import { useLocalLlm } from "@/lib/local-llm";

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
  /**
   * Pasos agénticos por índice de mensaje del asistente. Van APARTE de
   * `messages` a propósito: el historial que se manda al agente es solo
   * role/content — los pasos son presentación del turno en vivo.
   */
  steps: Record<number, ChatToolStep[]>;
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
  steps: {},
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

/** Acción bajo una respuesta terminada (copiar · reintentar). */
function TurnAction({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-xs px-2 py-1 text-2xs text-text-faint transition-colors hover:bg-hover hover:text-text"
    >
      {children}
    </button>
  );
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
  externalDraft,
  onExternalDraftConsumed,
  onEmptyChange,
  hideEmptyHint,
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
  /** Borrador externo (chips/palette): se vuelca al input del tab activo. */
  externalDraft?: string | null;
  onExternalDraftConsumed?: () => void;
  /** Conversación vacía → el home muestra el hero (orbe + saludo); con
   *  mensajes el orbe se va al muelle y manda la respuesta. */
  onEmptyChange?: (empty: boolean) => void;
  /** El hero del home ya da la bienvenida: no la repitas dentro. */
  hideEmptyHint?: boolean;
}) {
  const [state, setState] = useState<TabsState>(freshState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Entrada CANÓNICA a la voz (patrón ChatGPT/Pi: la llamada vive en el
  // composer). El orbe del header queda como indicador de estado.
  const voice = useVoiceConnect();
  const ws = useWorkspace();
  // Modo avión: el chat lo responde el modelo local (el agente decide la ruta;
  // aquí solo se muestra y se apaga lo que sin internet no funciona).
  const local = useLocalLlm();
  const offline = !!local.status?.enabled;

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

  // El home necesita saber si la conversación está vacía para decidir entre
  // hero (orbe grande + saludo) y hilo (orbe en el muelle).
  const empty = active.messages.length === 0;
  const onEmptyRef = useRef(onEmptyChange);
  onEmptyRef.current = onEmptyChange;
  useEffect(() => {
    onEmptyRef.current?.(empty);
  }, [empty]);

  // Borrador externo (chips /planificar día, palette): se vuelca al draft del
  // tab activo, enfoca el input y se consume una sola vez.
  useEffect(() => {
    if (externalDraft == null) return;
    setState((s) => ({
      ...s,
      tabs: s.tabs.map((t) => (t.key === s.active ? { ...t, draft: externalDraft } : t)),
    }));
    onExternalDraftConsumed?.();
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalDraft]);

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
      // El historial del jsonl se lee como role/content: una sesión reabierta
      // no trae pasos (solo los turnos vividos en vivo los tienen).
      steps: {},
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
    // Índice del mensaje del asistente que este turno va a escribir: ancla
    // de sus pasos (los tool_use llegan antes que el primer delta de texto).
    const replyIdx = history.length;
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
          onTool: (step) => {
            updateTab(tabKey, (t) => ({
              ...t,
              steps: { ...t.steps, [replyIdx]: [...(t.steps[replyIdx] ?? []), step] },
            }));
            scrollDown();
          },
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
        setClaudeNote(
          `▶ Terminal.app abierta (${claudeModelLabel(claudeConfig.model)} · ${claudeConfig.effort}).`,
        );
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
      {/* Tira de tabs: en el hero estorba (una sola conversación vacía no
          necesita gestor de pestañas). Reaparece al primer mensaje. */}
      <div
        className={`relative mb-1.5 items-center gap-1.5 border-b border-line pb-1.5 ${
          hideEmptyHint && empty ? "hidden" : "flex"
        }`}
      >
        <button
          type="button"
          title="Historial de conversaciones (las mismas que ve Claude Code en este repo)"
          aria-label="Historial de conversaciones"
          aria-expanded={histOpen}
          onClick={() => void toggleHist()}
          className={`grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs transition-colors hover:bg-hover ${
            histOpen ? "bg-selected text-text" : "text-text-faint hover:text-text"
          }`}
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
                className={`group flex h-7 max-w-[180px] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-xs px-2 text-xs transition-colors ${
                  isActive
                    ? "bg-selected font-medium text-text"
                    : "text-text-dim hover:bg-hover hover:text-text"
                }`}
              >
                {t.busy && <span className="pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-amber" />}
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
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-xs text-text-faint transition-colors hover:bg-hover hover:text-text"
          >
            +
          </button>
        </div>

        {/* Desplegable del historial (sesiones reales del repo en foco) */}
        {histOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setHistOpen(false)} />
            <div className="absolute top-9 left-0 z-20 max-h-80 w-[26rem] max-w-full overflow-y-auto rounded-md border border-line bg-panel p-1 shadow-[var(--shadow-pop)]">
              <p className="px-2 pt-1.5 pb-1.5 text-2xs font-medium text-text-faint">
                Sesiones de {selectedProject ? (projectName ?? selectedProject) : "Hermes (vault)"} · ~/.claude
              </p>
              {histError ? (
                <PanelState kind="error" compact title="No se pudo leer el historial" />
              ) : hist === null ? (
                <PanelState kind="loading" compact />
              ) : hist.length === 0 ? (
                <PanelState kind="empty" compact title="Sin conversaciones previas" />
              ) : (
                hist.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => void openSession(s.id)}
                    title={s.title}
                    className="flex w-full cursor-pointer items-baseline gap-2 rounded-xs px-2 py-1.5 text-left transition-colors hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-text">
                      {s.title}
                    </span>
                    <span className="shrink-0 text-2xs text-text-faint tabular-nums">
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
        className={
          // Con hero y sin mensajes el área colapsa: así el composer queda
          // JUSTO bajo el saludo en vez de clavado al fondo del viewport.
          hideEmptyHint && empty
            ? "hidden"
            : "hud-scroll-hide min-h-0 flex-1 space-y-6 overflow-y-auto pr-1"
        }
      >
        {/* Con hero (home vacío) el saludo ya dice todo esto: repetirlo aquí
            era ruido duplicado. */}
        {active.messages.length === 0 && !hideEmptyHint && (
          <div className="pt-10 text-center">
            <p className="text-sm font-medium text-text">
              {online
                ? selectedProject
                  ? `Conversación nueva sobre ${projectName ?? selectedProject}`
                  : "Conversación nueva con Hermes"
                : "El agente está desconectado"}
            </p>
            <p className="mt-1 text-xs text-text-faint">
              {online
                ? "Enter envía · Shift+Enter salto de línea · el reloj abre el historial del repo"
                : "Arráncalo con `pnpm dev:agent` (o revisa el servicio de launchd)."}
            </p>
          </div>
        )}
        {/* Asimetría deliberada (patrón ChatGPT · Claude · Copilot): el turno
            del USUARIO es un objeto discreto (píldora a la derecha); el del
            asistente NO lleva contenedor — es el contenido de la página. Darles
            el mismo peso visual aplana la jerarquía del hilo. */}
        {active.messages.map((m, i) => {
          const steps = active.steps[i] ?? [];
          const streaming = active.busy && i === active.messages.length - 1;

          if (m.role === "user") {
            return (
              <div key={i} className="flex justify-end">
                <div className="max-w-[78%] rounded-lg bg-panel-2 px-3.5 py-2.5 text-base leading-relaxed whitespace-pre-wrap text-text">
                  {m.content}
                </div>
              </div>
            );
          }

          const ultimo = i === active.messages.length - 1;
          return (
            <div key={i} className="flex flex-col gap-2.5">
              <span className="flex items-center gap-2 text-xs font-medium text-text-dim">
                <HermesMark size={18} />
                Hermes
              </span>
              {/* Pasos del turno ANTES del texto: el trabajo se ve mientras
                  ocurre y la respuesta aterriza debajo (patrón Replit). */}
              {steps.length > 0 && <AgentSteps steps={steps} busy={streaming} />}
              <div className="text-base leading-relaxed whitespace-pre-wrap text-text">
                {m.content ||
                  // "pensando…" solo hasta el primer paso: a partir de ahí los
                  // pasos ya cuentan qué está haciendo.
                  (streaming && steps.length === 0 ? (
                    <span className="pulse-dot">pensando…</span>
                  ) : (
                    ""
                  ))}
              </div>
              {/* Acciones SOLO al terminar (patrón Claude · ChatGPT · Bard):
                  durante el stream la respuesta aún no es copiable ni final. */}
              {!streaming && m.content && (
                <div className="flex gap-1">
                  <TurnAction onClick={() => void navigator.clipboard?.writeText(m.content)}>
                    copiar
                  </TurnAction>
                  {ultimo && (
                    <TurnAction
                      onClick={() => {
                        // Reintentar = devolver la orden anterior al composer.
                        // No re-dispara sola: mandar tokens sin que lo pidas es
                        // peor que un clic extra.
                        const prev = [...active.messages.slice(0, i)]
                          .reverse()
                          .find((x) => x.role === "user");
                        if (!prev) return;
                        updateTab(active.key, (t) => ({ ...t, draft: prev.content }));
                        setTimeout(() => inputRef.current?.focus(), 40);
                      }}
                    >
                      reintentar
                    </TurnAction>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Chip de foco de proyecto */}
      {selectedProject && (
        <div className="mt-2 flex h-7 items-center gap-2 self-start rounded-full border border-line bg-panel pr-1 pl-2.5 text-xs text-text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          <span>
            Hablando de <b className="font-medium text-text">{projectName ?? selectedProject}</b>
          </span>
          <button
            type="button"
            title="Quitar foco de proyecto"
            aria-label="Quitar foco de proyecto"
            className="grid h-5 w-5 cursor-pointer place-items-center rounded-full text-text-faint transition-colors hover:bg-hover hover:text-text"
            onClick={onClearProject}
          >
            ✕
          </button>
        </div>
      )}

      {claudeNote && <p className="mt-2 text-xs text-text-dim">{claudeNote}</p>}

      {/* Modo avión: qué modelo responde y si ya cargó */}
      {offline && local.status && (
        <div className="mt-2 flex items-center gap-2 self-start rounded-full border border-line bg-panel px-2.5 py-1 text-xs text-text-dim">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              local.status.phase === "ready"
                ? "bg-green"
                : local.status.phase === "error"
                  ? "bg-red"
                  : "animate-pulse bg-amber"
            }`}
          />
          <span>
            Modo avión · <b className="font-medium text-text">{local.status.model.label}</b> ·{" "}
            {local.status.phase === "ready"
              ? "listo"
              : local.status.phase === "error"
                ? (local.status.error ?? "error")
                : "cargando el modelo…"}
          </span>
          {/* Rápido (2B) o Mejor (4B): cambiar recarga el modelo en ~10 s. */}
          {local.status.models.filter((m) => m.available).length > 1 && (
            <span className="ml-1 flex items-center rounded-full border border-line p-0.5">
              {local.status.models
                .filter((m) => m.available)
                .map((m) => {
                  const on = m.id === local.status?.model.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      title={`${m.label}${m.sizeGb ? ` · ${m.sizeGb} GB` : ""}`}
                      aria-pressed={on}
                      disabled={local.busy || active.busy}
                      onClick={() => void local.setModel(m.id)}
                      className={`cursor-pointer rounded-full px-2 py-px transition-colors disabled:cursor-default ${
                        on ? "bg-selected text-text" : "text-text-dim hover:text-text"
                      }`}
                    >
                      {m.hint}
                    </button>
                  );
                })}
            </span>
          )}
        </div>
      )}

      {/* Input: textarea auto-crecible · Enter envía · mic · enviar */}
      {/* Composer como CAJA, no como línea con borde superior: es el objeto
          más importante de la vista, así que se lee como objeto. El anillo de
          foco vive aquí (focus-within), no en el textarea. */}
      {/* v5: UNA caja (patrón Claude/ChatGPT/Cursor) — el texto arriba y la
          barra de herramientas abajo, dentro. Antes la config de Claude Code
          era otra caja encima del composer y competía con él. */}
      <form
        className="hud-field mt-3 flex flex-col gap-2 rounded-lg border border-line-2 bg-panel px-3.5 pt-3 pb-2 shadow-[var(--shadow-card)] transition-colors focus-within:border-text-faint/60"
        onSubmit={(e) => {
          e.preventDefault();
          void send(active.key);
        }}
      >
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
                : offline
                  ? "Modo avión: pregúntale al modelo local…"
                  : selectedProject
                  ? `Pregunta sobre ${projectName ?? selectedProject}…`
                  : "Pídele algo a Hermes…"
          }
          className="max-h-[160px] min-h-[24px] w-full resize-none bg-transparent px-0.5 text-base leading-relaxed text-text outline-none placeholder:text-text-faint"
          disabled={active.busy}
        />

        <div className="flex items-center gap-1">
          {/* Selector de ejecución de Claude Code (modelo · esfuerzo · permisos) */}
          {/* Sin internet Claude Code no corre: la barra se esconde en modo avión. */}
          {!offline && (
            <ClaudeExecBar
              config={claudeConfig}
              onChange={onClaudeConfigChange}
              onRun={(mode) => void runClaude(mode)}
              disabled={active.busy || claudeBusy}
            />
          )}
          <span className="flex-1" />

        {/* Modo avión (modelo local). Sin la ruta en el agente no se muestra. */}
        {local.status && (
          <button
            type="button"
            title={
              offline
                ? "Apagar modo avión (volver a Claude)"
                : `Modo avión: responder con ${local.status.model.label} en esta Mac, sin internet`
            }
            aria-label={offline ? "Apagar modo avión" : "Prender modo avión"}
            aria-pressed={offline}
            onClick={() => void local.toggle()}
            disabled={local.busy || active.busy}
            className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors disabled:opacity-40 ${
              offline ? "bg-accent/10 text-accent" : "text-text-dim hover:bg-hover hover:text-text"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M10.5 4.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V9l7 4v2l-7-2v4.5l2.5 2V21L12 20l-4 1v-1.5l2.5-2V13l-7 2v-2l7-4V4.5Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        {/* Llamada de voz con Hermes (entrada canónica; conectada = ir a Voz) */}
        {voice.configured && !offline && (
          <button
            type="button"
            title={
              voice.connected
                ? "Colgar la llamada"
                : voice.connecting
                  ? "Conectando la llamada…"
                  : "Hablar con Hermes (llamada de voz)"
            }
            aria-label={voice.connected ? "Colgar la llamada" : "Hablar con Hermes"}
            onClick={() => {
              // No navega: la llamada ocurre aquí mismo. Conectado = colgar.
              if (voice.connected) void voice.disconnect();
              else if (!voice.connecting) void voice.connect();
            }}
            className={`grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors ${
              voice.connected
                ? "bg-green/10 text-green"
                : voice.connecting
                  ? "animate-pulse text-amber"
                  : "text-text-dim hover:bg-hover hover:text-text"
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 13a8 8 0 0 1 16 0M4 13v4a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Zm16 0v4a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

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
            className={`relative grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full transition-colors disabled:opacity-40 ${
              listening ? "bg-red/10 text-red" : "text-text-dim hover:bg-hover hover:text-text"
            }`}
          >
            {listening && (
              <span className="absolute inset-0 animate-ping rounded-full bg-red/35" />
            )}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="relative">
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
          className="ml-0.5 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-accent-solid text-on-accent transition-colors disabled:cursor-default disabled:bg-selected disabled:text-text-faint"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 19V5M6 11l6-6 6 6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        </div>
      </form>
    </div>
  );
}
