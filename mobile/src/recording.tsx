/**
 * Estado de la grabación de juntas para React. La grabación NO vive aquí: la
 * maneja el módulo nativo `hermes-recorder` (foreground service + AAC ADTS),
 * así que sobrevive a salir de la app, bloquear la pantalla, deslizar Hermes
 * desde Recientes o que React se recree. Este provider solo refleja su estado
 * (evento `onStatus`, ~5/s) y manda órdenes.
 *
 * Al detener (aquí, desde la píldora o desde la notificación) la grabación
 * queda en el diario nativo y el motor de entrega (`meeting-queue.ts`) la
 * indexa y la sube solo.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, PermissionsAndroid, Platform } from "react-native";
import { requestRecordingPermissionsAsync } from "expo-audio";
import {
  HermesRecorder,
  type RecorderChecks,
  type RecorderState,
} from "../modules/hermes-recorder";
import { kick } from "./meeting-queue";

/** Muestras de nivel para la onda (≈10 s a 5/s). */
const LEVEL_HISTORY = 50;

interface RecordingStore {
  /** false = APK sin el módulo nativo (hay que reinstalar). */
  available: boolean;
  status: RecorderState["status"];
  /** Hay una grabación abierta (grabando o en pausa). */
  isRecording: boolean;
  paused: boolean;
  /** true mientras stop está en curso (bloquea doble stop). */
  stopping: boolean;
  durationSec: number;
  project: string | null;
  projectName: string | null;
  /** Historial de nivel 0..1, el último es el actual. */
  levels: number[];
  silencedByOtherApp: boolean;
  silentForSec: number;
  /** Confirmado por el service: sigue grabando fuera de la app. */
  background: boolean;
  backgroundError: string | null;
  error: string | null;
  bytes: number;
  checks: RecorderChecks | null;
  refreshChecks: () => void;
  /** Devuelve un mensaje de error o null si todo bien. */
  start: (project: string, projectName: string) => Promise<string | null>;
  stop: () => Promise<string | null>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Descarta la grabación en curso (solo para los primeros segundos). */
  cancel: () => Promise<void>;
}

const Ctx = createContext<RecordingStore | null>(null);

const IDLE: RecorderState = {
  status: "idle",
  id: null,
  project: null,
  projectName: null,
  startedAt: null,
  elapsedMs: 0,
  level: 0,
  silencedByOtherApp: false,
  silentForMs: 0,
  background: false,
  backgroundError: null,
  error: null,
  bytes: 0,
  finished: [],
};

/** Lecturas del módulo nativo que NUNCA tumban la pantalla. */
function safeState(): RecorderState {
  try {
    return HermesRecorder?.getState() ?? IDLE;
  } catch (e) {
    return { ...IDLE, error: `No pude leer el grabador: ${e instanceof Error ? e.message : String(e)}` };
  }
}
function safeChecks(): RecorderChecks | null {
  try {
    return HermesRecorder?.checks() ?? null;
  } catch {
    return null;
  }
}

const newId = () =>
  `rec-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}-${Math.random().toString(36).slice(2, 7)}`;

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<RecorderState>(safeState);
  const [levels, setLevels] = useState<number[]>([]);
  const [stopping, setStopping] = useState(false);
  const [checks, setChecks] = useState<RecorderChecks | null>(safeChecks);
  const stoppingRef = useRef(false);

  const refreshChecks = useCallback(() => {
    setChecks(safeChecks());
  }, []);

  useEffect(() => {
    if (!HermesRecorder) return;
    const sub = HermesRecorder.addListener("onStatus", (s) => {
      setState(s);
      if (s.status === "recording") {
        setLevels((prev) => [...prev.slice(-(LEVEL_HISTORY - 1)), s.level]);
      } else if (s.status === "idle") {
        setLevels([]);
      }
    });
    // Volver a la app: re-leer (el JS pudo estar dormido) y re-chequear
    // permisos (el usuario pudo cambiarlos en Ajustes).
    const app = AppState.addEventListener("change", (st) => {
      if (st !== "active") return;
      setState(safeState());
      refreshChecks();
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, [refreshChecks]);

  const start = useCallback(
    async (project: string, projectName: string): Promise<string | null> => {
      if (!HermesRecorder) {
        return "Esta versión de la app no trae el grabador nuevo. Instala el APK actualizado.";
      }
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) return "Sin permiso de micrófono no puedo grabar.";
        // Sin notificaciones el service corre igual, pero no ves la
        // notificación con el cronómetro: se pide, sin bloquear.
        if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(
            () => null,
          );
        }
        const s = await HermesRecorder.start(newId(), project, projectName);
        setState(s);
        refreshChecks();
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "No pude iniciar la grabación.";
      }
    },
    [refreshChecks],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    if (!HermesRecorder || stoppingRef.current) return null;
    stoppingRef.current = true;
    setStopping(true);
    try {
      const done = await HermesRecorder.stop();
      setState(safeState());
      kick(); // indexar + subir ya
      return done ? null : "La grabación quedó vacía (no entró audio).";
    } catch (e) {
      return e instanceof Error ? e.message : "No pude detener la grabación.";
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  }, []);

  const pause = useCallback(async () => {
    await HermesRecorder?.pause();
  }, []);
  const resume = useCallback(async () => {
    await HermesRecorder?.resume();
  }, []);
  const cancel = useCallback(async () => {
    await HermesRecorder?.cancel();
    setState(safeState());
  }, []);

  const value: RecordingStore = {
    available: !!HermesRecorder,
    status: state.status,
    isRecording: state.status !== "idle",
    paused: state.status === "paused",
    stopping,
    durationSec: Math.floor(state.elapsedMs / 1000),
    project: state.project,
    projectName: state.projectName,
    levels,
    silencedByOtherApp: state.silencedByOtherApp,
    silentForSec: Math.floor(state.silentForMs / 1000),
    background: state.background,
    backgroundError: state.backgroundError,
    error: state.error,
    bytes: state.bytes,
    checks,
    refreshChecks,
    start,
    stop,
    pause,
    resume,
    cancel,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecording(): RecordingStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecording fuera de RecordingProvider");
  return v;
}
