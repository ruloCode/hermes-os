/**
 * Controlador de voz de Hermes. Vive en la RAÍZ (siempre montado, no atado a un
 * tab) para que la llamada y las client tools sobrevivan al navegar. Expone su
 * estado por contexto (useVoice) y la UI (VoiceScreen) solo lo consume.
 *
 * Las client tools corren EN EL TELÉFONO (igual que en el browser del dashboard)
 * y llaman al agente en :8650. Se registran con los MISMOS nombres que espera el
 * agente "Hermes" de ElevenLabs, así que el mismo agente funciona desde el móvil.
 */
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import { useConversation, type ConversationStatus } from "@elevenlabs/react-native";
// El wrapper RN no reexporta este hook, pero @elevenlabs/react (que el propio
// wrapper embebe) sí — y comparte el MISMO ConversationProvider/contexto.
import { useConversationClientTool } from "@elevenlabs/react";
// AudioSession nativa de LiveKit (enruta el audio en el dispositivo). Import
// defensivo: si el nombre no existe en esta versión, queda undefined y se ignora.
import { AudioSession } from "@livekit/react-native";
import * as api from "./hermes";
import { useApp, type Tab } from "./store";

export interface Line {
  who: "TÚ" | "HERMES";
  text: string;
}

interface VoiceState {
  status: ConversationStatus;
  connected: boolean;
  connecting: boolean;
  isSpeaking: boolean;
  transcript: Line[];
  error: string | null;
  action: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const Ctx = createContext<VoiceState | null>(null);
export function useVoice(): VoiceState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useVoice fuera de VoiceProvider");
  return v;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

async function ensureMic(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: "Micrófono",
        message: "Hermes necesita el micrófono para hablar contigo en tiempo real.",
        buttonPositive: "Permitir",
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const [transcript, setTranscript] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const connectedBefore = useRef(false);

  // Ref a la conversación para poder usarla dentro de sus propios callbacks
  // (onConnect) sin caer en la zona muerta temporal del const.
  const convRef = useRef<ReturnType<typeof useConversation> | null>(null);

  const pushLine = useCallback((l: Line) => {
    setTranscript((prev) => [...prev.slice(-60), l]);
  }, []);

  const flashAction = useCallback((label: string, ms = 1600) => {
    setAction(label);
    setTimeout(() => setAction((a) => (a === label ? null : a)), ms);
  }, []);

  // Hook combinado: nos da startSession/endSession/status/isSpeaking y registra
  // los callbacks (onMessage, etc.) con el provider.
  const conv = useConversation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onMessage: (m: any) => {
      const text = str(m?.message) ?? str(m?.text);
      if (!text) return;
      const src = m?.source ?? m?.role;
      pushLine({ who: src === "user" ? "TÚ" : "HERMES", text });
    },
    onConnect: () => {
      setError(null);
      // Reconexión sin recargar: reinyecta contexto para no perder el hilo.
      if (connectedBefore.current && transcript.length) {
        const recap = transcript
          .slice(-20)
          .map((l) => `${l.who}: ${l.text}`)
          .join("\n");
        try {
          convRef.current?.sendContextualUpdate(
            `[Continuidad de sesión] El usuario reactivó la voz: es la MISMA conversación. Retoma el hilo con naturalidad, sin volver a saludar. Lo último que hablamos:\n${recap}`.slice(
              0,
              1600,
            ),
          );
        } catch {
          /* aún sin canal listo */
        }
      }
      connectedBefore.current = true;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (msg: any) => setError(typeof msg === "string" ? msg : "Error de la llamada."),
  });
  convRef.current = conv;

  // ── Registro de client tools (mismos nombres que el agente de voz) ─────
  useConversationClientTool("focus_project", async (p: any) => {
    const raw = str(p?.project);
    if (!raw) {
      app.setFocused(null);
      app.setTab("proyectos");
      return "Listo, quité el foco.";
    }
    const slug = app.resolveSlug(raw);
    if (!slug) return `No tengo un proyecto que coincida con "${raw}".`;
    app.setFocused(slug);
    app.setTab("proyectos");
    flashAction(`Enfocando ${slug}`);
    return `Enfocando ${slug}.`;
  });

  useConversationClientTool("show_panel", async (p: any) => {
    const raw = (str(p?.panel) ?? "").toLowerCase();
    const tab: Tab | null = raw.includes("reuni") || raw.includes("junta") || raw.includes("meet")
      ? "reuniones"
      : raw.includes("tarea") || raw.includes("task") || raw.includes("mision") || raw.includes("misión")
        ? "tareas"
        : raw.includes("proyect") || raw.includes("project")
          ? "proyectos"
          : raw.includes("voz") || raw.includes("voice")
            ? "voz"
            : null;
    if (!tab) return `No conozco el panel "${raw}".`;
    app.setTab(tab);
    return `Mostrando ${tab}.`;
  });

  useConversationClientTool("work_on_project", async (p: any) => {
    const slug = app.resolveSlug(str(p?.project));
    if (!slug) return `¿En qué proyecto? No reconocí "${str(p?.project) ?? ""}".`;
    const prompt = str(p?.prompt);
    if (!prompt) return "¿Qué quieres que haga Claude en el repo?";
    flashAction(`Claude · ${slug}`, 3000);
    try {
      const res = await api.startClaudeRun(slug, prompt);
      return `Va, Claude ya está trabajando en ${slug}. El run es ${res.run_id}.`;
    } catch {
      return "No pude lanzar a Claude: el agente no responde.";
    }
  });

  useConversationClientTool("run_task", async (p: any) => {
    const prompt = str(p?.prompt);
    if (!prompt) return "¿Qué tarea quieres que haga?";
    try {
      const res = await api.startTask(prompt);
      flashAction("Tarea en curso", 3000);
      return `Va, lo estoy preparando en segundo plano. El id es ${res.task_id}.`;
    } catch {
      return "No alcanzo al agente local ahora mismo.";
    }
  });

  useConversationClientTool("check_task", async (p: any) => {
    const id = str(p?.task_id);
    if (!id) return "¿De qué tarea? Necesito el identificador.";
    try {
      const t = await api.getAsyncTask(id);
      if (t.status === "running") return `Sigue en curso, ${t.toolCalls} acciones hasta ahora.`;
      if (t.status === "error") return `Falló: ${t.result?.slice(0, 200) ?? "sin detalle"}.`;
      return `Terminó. ${t.result?.slice(0, 300) ?? "Sin detalle."}`;
    } catch {
      /* probamos como run de Claude Code */
    }
    try {
      const runs = await api.claudeRuns();
      const run = runs.find((r) => r.id === id);
      if (!run) return `No encontré nada con el id ${id}.`;
      if (run.status === "running") return `Claude sigue trabajando en ${run.projectSlug}.`;
      if (run.status === "error") return `El run en ${run.projectSlug} falló.`;
      return `Terminó en ${run.projectSlug}. ${run.lastText ?? ""}`.trim();
    } catch {
      return `No pude consultar el id ${id}.`;
    }
  });

  useConversationClientTool("get_project_status", async (p: any) => {
    try {
      const data = await api.toolGetProjectStatus(str(p?.project));
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude leer el estado de los proyectos.";
    }
  });

  useConversationClientTool("search_memory", async (p: any) => {
    try {
      const data = await api.toolSearchMemory(str(p?.query) ?? "");
      return JSON.stringify(data).slice(0, 1500);
    } catch {
      return "No pude buscar en la memoria.";
    }
  });

  useConversationClientTool("save_memory", async (p: any) => {
    const content = str(p?.content);
    if (!content) return "¿Qué quieres que recuerde?";
    try {
      await api.toolSaveMemory(content, str(p?.type));
      return "Memoria guardada.";
    } catch {
      return "No pude guardar la memoria.";
    }
  });

  useConversationClientTool("get_daily_brief", async () => {
    try {
      const data = await api.toolDailyBrief();
      return data.brief;
    } catch {
      return "No pude armar el resumen del día.";
    }
  });

  // ── Conexión ───────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setError(null);
    const ok = await ensureMic();
    if (!ok) {
      setError("Sin permiso de micrófono no puedo escucharte.");
      return;
    }
    try {
      try {
        await AudioSession?.startAudioSession?.();
      } catch {
        /* algunos entornos la manejan solos */
      }
      const creds = await api.voiceToken();
      if (creds.error || creds.notConfigured) {
        setError(creds.error ?? "Voz no configurada en el agente.");
        return;
      }
      if (creds.conversationToken) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.startSession({
          conversationToken: creds.conversationToken,
          connectionType: "webrtc",
        } as any);
      } else if (creds.signedUrl) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        conv.startSession({ signedUrl: creds.signedUrl, connectionType: "websocket" } as any);
      } else {
        setError("El agente no devolvió credenciales de voz.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude conectar la voz.");
    }
  }, [conv]);

  const disconnect = useCallback(() => {
    try {
      conv.endSession();
    } catch {
      /* noop */
    }
    try {
      void AudioSession?.stopAudioSession?.();
    } catch {
      /* noop */
    }
  }, [conv]);

  const value: VoiceState = {
    status: conv.status,
    connected: conv.status === "connected",
    connecting: conv.status === "connecting",
    isSpeaking: conv.isSpeaking,
    transcript,
    error,
    action,
    connect,
    disconnect,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
