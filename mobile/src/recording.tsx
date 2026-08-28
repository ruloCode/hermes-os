/**
 * Grabación de reuniones como servicio global (patrón Fabric/Granola/Otter):
 * este provider —montado en la raíz, igual que VoiceProvider— es el dueño del
 * recorder de expo-audio, del timer y del proyecto asociado. Las pantallas se
 * desmontan al cambiar de tab, pero el provider no: la junta sobrevive a la
 * navegación.
 *
 * Al detener, la grabación se mueve a almacenamiento durable (recordings.ts)
 * y queda en `handoff`: la pantalla de reuniones la consume y ejecuta la
 * subida — un solo flujo de stop→persistir→subir venga de donde venga el stop
 * (botón de la pantalla o píldora global).
 *
 * Android: intenta grabar con el foreground service de expo-audio
 * (`allowsBackgroundRecording` → notificación sticky del sistema; la grabación
 * aguanta segundo plano y pantalla bloqueada). Los APK construidos sin
 * `enableBackgroundRecording` en app.json no traen ese service en el manifest
 * y el prepare falla: se reintenta sin servicio, donde keep-awake evita que la
 * pantalla se apague pero salir de la app corta el micrófono (restricción de
 * Android sin foreground service).
 */
import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { PermissionsAndroid, Platform } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as rec from "./recordings";

const KEEP_AWAKE_TAG = "hermes-meeting-recording";

interface RecordingStore {
  isRecording: boolean;
  /** true mientras stop+persistencia están en curso (bloquea doble stop). */
  stopping: boolean;
  /** Segundos transcurridos de la grabación en curso. */
  durationSec: number;
  /** Proyecto fijado al arrancar: cambiar de chip a mitad de junta no lo mueve. */
  project: string | null;
  /** URI del recorder, para excluirla del rescate de huérfanas. */
  recorderUri: string | null;
  /** true si ESTA grabación corre con el foreground service de Android. */
  backgroundCapable: boolean;
  /** Arranca a grabar. Devuelve un mensaje de error o null si todo bien. */
  start: (project: string) => Promise<string | null>;
  /**
   * Detiene y persiste a almacenamiento durable ANTES de cualquier red.
   * La entrada queda en `handoff` para que la pantalla de reuniones la suba.
   * Devuelve un mensaje de error o null si todo bien.
   */
  stop: () => Promise<string | null>;
  /** Grabación recién persistida esperando subida (la consume MeetingsScreen). */
  handoff: rec.PendingRecording | null;
  consumeHandoff: () => rec.PendingRecording | null;
}

const Ctx = createContext<RecordingStore | null>(null);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);
  const [project, setProject] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [backgroundCapable, setBackgroundCapable] = useState(false);
  const [handoff, setHandoffState] = useState<rec.PendingRecording | null>(null);
  const startedAt = useRef(0);
  // Refs espejo: stop() es un callback estable y leería estado viejo.
  const projectRef = useRef<string | null>(null);
  const stoppingRef = useRef(false);
  const handoffRef = useRef<rec.PendingRecording | null>(null);

  const setHandoff = (v: rec.PendingRecording | null) => {
    handoffRef.current = v;
    setHandoffState(v);
  };

  const start = useCallback(
    async (proj: string): Promise<string | null> => {
      try {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) return "Sin permiso de micrófono no puedo grabar.";
        // El foreground service exige POST_NOTIFICATIONS en Android 13+.
        // Best-effort: si lo niegan, el prepare falla y caemos al modo clásico.
        if (Platform.OS === "android" && Number(Platform.Version) >= 33) {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          ).catch(() => null);
        }
        let bg = true;
        try {
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            allowsBackgroundRecording: true,
          });
          await recorder.prepareToRecordAsync();
        } catch {
          // APK sin AudioRecordingService en el manifest (build previo a
          // enableBackgroundRecording en app.json) o notificaciones negadas.
          bg = false;
          await setAudioModeAsync({
            playsInSilentMode: true,
            allowsRecording: true,
            allowsBackgroundRecording: false,
          });
          await recorder.prepareToRecordAsync();
        }
        recorder.record();
        startedAt.current = Date.now();
        projectRef.current = proj;
        setProject(proj);
        setBackgroundCapable(bg);
        // Sin foreground service, pantalla apagada = junta muerta; con él,
        // igual evita que el teléfono se bloquee solo a mitad de junta.
        await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => null);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : "No pude iniciar la grabación.";
      }
    },
    [recorder],
  );

  const stop = useCallback(async (): Promise<string | null> => {
    if (stoppingRef.current) return null;
    stoppingRef.current = true;
    setStopping(true);
    try {
      const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) return "La grabación quedó vacía.";
      const proj = projectRef.current;
      if (!proj) return "La grabación no tiene proyecto asociado.";
      // Primero a puerto seguro (documents/), después la red.
      const entry = await rec.stashRecording({ uri, project: proj, durationSec });
      setHandoff(entry);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : "No pude guardar la grabación.";
    } finally {
      stoppingRef.current = false;
      setStopping(false);
      projectRef.current = null;
      setProject(null);
      setBackgroundCapable(false);
      void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => null);
    }
  }, [recorder]);

  const consumeHandoff = useCallback((): rec.PendingRecording | null => {
    const h = handoffRef.current;
    if (h) {
      handoffRef.current = null;
      setHandoffState(null);
    }
    return h;
  }, []);

  const value: RecordingStore = {
    isRecording: recState.isRecording,
    stopping,
    durationSec: Math.max(0, Math.floor(recState.durationMillis / 1000)),
    project,
    recorderUri: recorder.uri ?? null,
    backgroundCapable,
    start,
    stop,
    handoff,
    consumeHandoff,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRecording(): RecordingStore {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRecording fuera de RecordingProvider");
  return v;
}
