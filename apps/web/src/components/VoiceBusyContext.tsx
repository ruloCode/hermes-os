"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Estado compartido de "la voz está EJECUTANDO algo". Lo setea VoiceClientTools
 * cuando el agente invoca una client tool (p.ej. focus_project / work_on_project)
 * y lo leen el orbe del header y el panel de voz para mostrar el estado
 * EJECUTANDO con la etiqueta de la acción. Vive DENTRO del ConversationProvider.
 *
 * `action` = etiqueta de la acción en curso (null = la voz no está ejecutando).
 */
interface VoiceBusyValue {
  action: string | null;
  setAction: (action: string | null) => void;
}

const VoiceBusyContext = createContext<VoiceBusyValue>({
  action: null,
  setAction: () => {},
});

export function VoiceBusyProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<string | null>(null);
  return (
    <VoiceBusyContext.Provider value={{ action, setAction }}>
      {children}
    </VoiceBusyContext.Provider>
  );
}

export function useVoiceBusy(): VoiceBusyValue {
  return useContext(VoiceBusyContext);
}
