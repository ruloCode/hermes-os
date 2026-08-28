"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * Estado compartido de la VOZ, vive DENTRO del ConversationProvider. Reúne:
 *  - action:   qué client tool está EJECUTANDO ahora (null = nada) → orbe/panel.
 *  - transcript: la conversación acumulada. SOBREVIVE a pausar/reactivar la
 *    llamada mientras no se recargue la página → base de la "memoria de sesión"
 *    (VoiceSessionBridge la reenvía como contexto al reconectar).
 *  - artifact: el preview central en markdown de lo último que produjo la voz
 *    (p.ej. un reporte pedido por voz).
 */
export interface VoiceLine {
  who: "TÚ" | "HERMES" | "TUTOR";
  text: string;
}

/** Agente activo de la llamada: Hermes (default) o el tutor de inglés. */
export type VoiceMode = "hermes" | "tutor";

export interface VoiceArtifact {
  /** Título (el prompt/pedido que lo originó). */
  title: string;
  /** task_id de la tarea que lo genera (para traer el resultado completo). */
  taskId?: string;
  /** Contenido markdown a renderizar en el centro. */
  md: string;
  status: "running" | "done" | "error";
}

/** Proyecto en foco cuando arranca/está la llamada → scope de la voz. */
export interface VoiceScope {
  slug: string;
  name: string;
  /**
   * Contexto libre para el system prompt de la voz (dynamic var session_scope).
   * Si viene, REEMPLAZA el texto por defecto de "proyecto enfocado" — lo usa la
   * página /vida para inyectar el estado financiero real como asesor.
   */
  prompt?: string;
}

interface VoiceValue {
  action: string | null;
  setAction: (action: string | null) => void;
  transcript: VoiceLine[];
  pushLine: (line: VoiceLine) => void;
  clearTranscript: () => void;
  artifact: VoiceArtifact | null;
  startArtifact: (a: { title: string; taskId?: string }) => void;
  setArtifact: (a: VoiceArtifact | null) => void;
  /** Proyecto enfocado (o null = vista general). Lo sincroniza VoiceScopeSync. */
  scope: VoiceScope | null;
  setScope: (s: VoiceScope | null) => void;
  /** Con qué agente está (o estará) la llamada. Gatea scope/labels/UI. */
  mode: VoiceMode;
  setMode: (m: VoiceMode) => void;
}

const VoiceContext = createContext<VoiceValue>({
  action: null,
  setAction: () => {},
  transcript: [],
  pushLine: () => {},
  clearTranscript: () => {},
  artifact: null,
  startArtifact: () => {},
  setArtifact: () => {},
  scope: null,
  setScope: () => {},
  mode: "hermes",
  setMode: () => {},
});

export function VoiceBusyProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<VoiceLine[]>([]);
  const [artifact, setArtifact] = useState<VoiceArtifact | null>(null);
  const [scope, setScope] = useState<VoiceScope | null>(null);
  const [mode, setMode] = useState<VoiceMode>("hermes");

  const pushLine = useCallback((line: VoiceLine) => {
    // Cota alta: la memoria de sesión no necesita miles de líneas.
    setTranscript((prev) => [...prev.slice(-199), line]);
  }, []);
  const clearTranscript = useCallback(() => setTranscript([]), []);
  const startArtifact = useCallback(
    (a: { title: string; taskId?: string }) =>
      setArtifact({ title: a.title, taskId: a.taskId, md: "", status: "running" }),
    [],
  );

  return (
    <VoiceContext.Provider
      value={{
        action,
        setAction,
        transcript,
        pushLine,
        clearTranscript,
        artifact,
        startArtifact,
        setArtifact,
        scope,
        setScope,
        mode,
        setMode,
      }}
    >
      {children}
    </VoiceContext.Provider>
  );
}

export function useVoice(): VoiceValue {
  return useContext(VoiceContext);
}

/** Compat: consumidores que solo necesitan el estado EJECUTANDO. */
export function useVoiceBusy(): { action: string | null; setAction: (a: string | null) => void } {
  const { action, setAction } = useContext(VoiceContext);
  return { action, setAction };
}
