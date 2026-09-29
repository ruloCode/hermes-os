"use client";

// Ejecutor de las acciones de DASHBOARD de las señas de mano. Sin render:
// registra en el GestureControlProvider un handler que sabe hablar con la
// voz, la palette y el registry ⌘K — cosas que viven en hooks del workspace
// y que el provider (más arriba en el árbol) no puede usar. Montado UNA vez
// en providers.tsx, así vale para todas las rutas (también /dev/gestos).

import { useEffect, useRef } from "react";
import { COMMAND_ACTION_PREFIX } from "@hermes/shared";
import { COMMANDS, useCommandContext } from "@/lib/commands";
import { useVoiceConnect } from "@/hooks/useVoiceConnect";
import { useWorkspace } from "@/state/WorkspaceContext";
import { useGestureControl, type SignActionHandler } from "@/state/GestureControlProvider";

export function SignActionsBridge() {
  const g = useGestureControl();
  const ctx = useCommandContext();
  const voice = useVoiceConnect();
  const ws = useWorkspace();

  // Refs espejo: el handler se registra una vez y lee el estado vigente.
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const wsRef = useRef(ws);
  wsRef.current = ws;

  const setHandler = g.setSignActionHandler;
  useEffect(() => {
    const handler: SignActionHandler = (action) => {
      const v = voiceRef.current;
      switch (action) {
        case "voice_toggle":
          if (v.connected || v.connecting) {
            v.disconnect();
            return { ok: true, text: "voz colgada" };
          }
          ctxRef.current.startVoiceCall();
          return { ok: true, text: "hablando con Hermes" };
        case "voice_start":
          if (v.connected || v.connecting) return { ok: true, text: "la voz ya está activa" };
          ctxRef.current.startVoiceCall();
          return { ok: true, text: "hablando con Hermes" };
        case "voice_stop":
          if (!v.connected && !v.connecting) return { ok: true, text: "la voz ya estaba colgada" };
          v.disconnect();
          return { ok: true, text: "voz colgada" };
        case "palette":
          wsRef.current.setPaletteOpen(true);
          return { ok: true, text: "⌘K" };
      }
      if (action.startsWith(COMMAND_ACTION_PREFIX)) {
        const id = action.slice(COMMAND_ACTION_PREFIX.length);
        const cmd = COMMANDS.find((c) => c.id === id);
        if (!cmd) return { ok: false, text: `comando desconocido: ${id}` };
        const c = ctxRef.current;
        if (cmd.requiresProject && !c.selectedProject) {
          return { ok: false, text: `${cmd.label}: necesita un proyecto en foco` };
        }
        if (cmd.requiresLiveMeeting && !c.liveMeetingActive) {
          return { ok: false, text: `${cmd.label}: no hay junta en vivo` };
        }
        void cmd.run(c);
        return { ok: true, text: cmd.label };
      }
      return { ok: false, text: `acción desconocida: ${action}` };
    };
    setHandler(handler);
    return () => setHandler(null);
  }, [setHandler]);

  return null;
}
