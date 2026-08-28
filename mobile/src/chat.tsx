/**
 * Controlador del chat de texto con Hermes. Vive en la RAÍZ (como VoiceProvider)
 * para que el stream sobreviva al navegar entre tabs. Habla el contrato Hermes
 * (/v1/chat/completions SSE) contra el agente — por LAN o por el túnel, igual.
 *
 * Memoria en dos capas:
 *  - sessionKey (cliente) + sdkSession (uuid del SDK): los turnos siguientes
 *    RESUMEN la misma conversación del Agent SDK en la Mac.
 *  - AsyncStorage: el hilo local sobrevive a cerrar la app.
 *
 * Las llamadas de voz se pliegan aquí al colgar (addVoiceLines): el hilo queda
 * unificado, como en ChatGPT ("voice chat ended" dentro del thread).
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as api from "./hermes";
import { useApp } from "./store";
import type { ChatToolStep } from "./types";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  /** Vino de una llamada de voz (se pliega al colgar). */
  via?: "voz";
  /** Pasos agénticos del turno (solo assistant). */
  tools?: ChatToolStep[];
  at: number;
}

interface ChatState {
  messages: ChatMsg[];
  streaming: boolean;
  /** Hubo un error en el último turno (se muestra inline en el hilo). */
  error: string | null;
  /** Proyecto al que quedó atada la conversación (foco al primer mensaje). */
  project: string | null;
  send: (text: string) => void;
  stop: () => void;
  newChat: () => void;
  /** Pliega el transcript de una llamada de voz al hilo (al colgar). */
  addVoiceLines: (lines: { who: "TÚ" | "HERMES"; text: string }[]) => void;
}

const Ctx = createContext<ChatState | null>(null);
export function useChat(): ChatState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useChat fuera de ChatProvider");
  return v;
}

const STORE_KEY = "hermes.chat.v1";
const MAX_MSGS = 120;

const randomKey = () =>
  `movil-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

interface Persisted {
  messages: ChatMsg[];
  sessionKey: string;
  sdkSession: string | null;
  project: string | null;
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);

  const sessionKeyRef = useRef(randomKey());
  const sdkSessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Voz plegada mientras un stream de texto está en curso: se encola y se
  // vuelca al terminar el turno (patchDraft asume que el draft es el ÚLTIMO
  // mensaje; insertar en medio corrompería el hilo).
  const pendingVoiceRef = useRef<ChatMsg[]>([]);
  const hydratedRef = useRef(false);
  // Espejo del estado para persistir/leer fuera del ciclo de render.
  const messagesRef = useRef<ChatMsg[]>([]);
  const projectRef = useRef<string | null>(null);
  messagesRef.current = messages;
  projectRef.current = project;

  const persist = useCallback(() => {
    const data: Persisted = {
      messages: messagesRef.current.slice(-MAX_MSGS),
      sessionKey: sessionKeyRef.current,
      sdkSession: sdkSessionRef.current,
      project: projectRef.current,
    };
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(data)).catch(() => {});
  }, []);

  // Hidratación al arrancar: el hilo y la sesión SDK sobreviven a cerrar la app.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw) as Persisted;
        if (Array.isArray(data.messages)) setMessages(data.messages.slice(-MAX_MSGS));
        if (data.sessionKey) sessionKeyRef.current = data.sessionKey;
        sdkSessionRef.current = data.sdkSession ?? null;
        setProject(data.project ?? null);
      } catch {
        /* primer arranque */
      }
    })();
  }, []);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || abortRef.current) return;
      setError(null);

      // La conversación queda atada al proyecto en foco de su PRIMER mensaje
      // (el agente corre la sesión SDK en ese repo); no se cambia a mitad.
      let convProject = projectRef.current;
      if (!messagesRef.current.some((m) => m.role === "user" && !m.via)) {
        convProject = app.focused;
        setProject(convProject);
        projectRef.current = convProject;
      }

      const userMsg: ChatMsg = { role: "user", content: text, at: Date.now() };
      const draft: ChatMsg = { role: "assistant", content: "", tools: [], at: Date.now() };
      setMessages((prev) => [...prev.slice(-(MAX_MSGS - 2)), userMsg, draft]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const patchDraft = (fn: (m: ChatMsg) => ChatMsg) => {
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") next[next.length - 1] = fn(last);
          return next;
        });
      };

      void api
        .streamChat([{ role: "user", content: text }], {
          sessionKey: sessionKeyRef.current,
          resume: sdkSessionRef.current,
          project: convProject,
          signal: ctrl.signal,
          onDelta: (delta) => patchDraft((m) => ({ ...m, content: m.content + delta })),
          onSession: (sid) => {
            sdkSessionRef.current = sid;
          },
          onTool: (step) => patchDraft((m) => ({ ...m, tools: [...(m.tools ?? []), step] })),
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return; // stop del usuario: se queda lo parcial
          setError(e instanceof Error ? e.message : "No pude hablar con Hermes.");
        })
        .finally(() => {
          abortRef.current = null;
          setStreaming(false);
          // Un draft que quedó vacío (error antes del primer delta) se retira,
          // y la voz que colgó a mitad del turno se vuelca ahora, en orden.
          const queued = pendingVoiceRef.current;
          pendingVoiceRef.current = [];
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const base =
              last?.role === "assistant" && !last.content && !last.tools?.length
                ? prev.slice(0, -1)
                : prev;
            return queued.length ? [...base, ...queued].slice(-MAX_MSGS) : base;
          });
          setTimeout(persist, 0);
        });
    },
    [app.focused, persist],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const newChat = useCallback(() => {
    abortRef.current?.abort();
    sessionKeyRef.current = randomKey();
    sdkSessionRef.current = null;
    setMessages([]);
    setError(null);
    setProject(null);
    projectRef.current = null;
    messagesRef.current = [];
    setTimeout(persist, 0);
  }, [persist]);

  const addVoiceLines = useCallback(
    (lines: { who: "TÚ" | "HERMES"; text: string }[]) => {
      if (!lines.length) return;
      const now = Date.now();
      const folded: ChatMsg[] = lines.map((l) => ({
        role: l.who === "TÚ" ? "user" : "assistant",
        content: l.text,
        via: "voz",
        at: now,
      }));
      // Con un stream de texto en vuelo, el plegado espera al fin del turno.
      if (abortRef.current) {
        pendingVoiceRef.current.push(...folded);
        return;
      }
      setMessages((prev) => [...prev, ...folded].slice(-MAX_MSGS));
      setTimeout(persist, 0);
    },
    [persist],
  );

  const value: ChatState = {
    messages,
    streaming,
    error,
    project,
    send,
    stop,
    newChat,
    addVoiceLines,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
