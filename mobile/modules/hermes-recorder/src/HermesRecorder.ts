/**
 * Grabador nativo de juntas (Android). Ver RecorderCore.kt: la grabación vive
 * en un foreground service, no en React, y escribe AAC ADTS que sobrevive a un
 * cierre abrupto.
 */
import { NativeModule, requireOptionalNativeModule } from "expo";

export type RecorderStatus = "idle" | "recording" | "paused";

/** Grabación terminada que el JS todavía no indexó (diario nativo). */
export interface FinishedRecording {
  id: string;
  project: string;
  projectName?: string;
  path: string;
  uri: string;
  filename: string;
  sizeBytes: number;
  durationMs: number;
  startedAt: number;
  endedAt: number;
  /** stopped = botón · notification = desde la notificación · interrupted = la app murió · error = falló el grabador */
  reason: "stopped" | "notification" | "interrupted" | "error";
  error?: string;
}

export interface RecorderState {
  status: RecorderStatus;
  id: string | null;
  project: string | null;
  projectName: string | null;
  startedAt: number | null;
  elapsedMs: number;
  /** 0..1, perceptual (dB normalizado). */
  level: number;
  /** Android 10+: una llamada u otra app tomó el micrófono → entra silencio. */
  silencedByOtherApp: boolean;
  /** ms sin superar el umbral de sonido (para avisar "no se oye nada"). */
  silentForMs: number;
  /** El foreground service confirmó: la grabación sobrevive al segundo plano. */
  background: boolean;
  backgroundError: string | null;
  error: string | null;
  bytes: number;
  finished: FinishedRecording[];
}

export interface RecorderChecks {
  microphone: boolean;
  notifications: boolean;
  batteryUnrestricted: boolean;
  manufacturer: string;
  sdk: number;
  freeBytes: number;
}

type Events = { onStatus: (state: RecorderState) => void };

declare class HermesRecorderNative extends NativeModule<Events> {
  getState(): RecorderState;
  start(id: string, project: string, projectName: string): Promise<RecorderState>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<FinishedRecording | null>;
  cancel(): Promise<void>;
  ack(ids: string[]): void;
  checks(): RecorderChecks;
  requestBatteryUnrestricted(): void;
  openNotificationSettings(): void;
  openAppSettings(): void;
}

/** null fuera de Android (o en un APK viejo sin el módulo). */
export const HermesRecorder = requireOptionalNativeModule<HermesRecorderNative>("HermesRecorder");
