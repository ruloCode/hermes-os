/**
 * Guion de la LENTE sin junta (`/lente?sim=1`): sugerencias de ejemplo que
 * pasan por el MISMO `toCue` que las reales — incluida una que llega por
 * streaming —, para probar la pantalla y mostrarla sin gastar STT ni modelo.
 * Contenido genérico a propósito: el repo es público.
 */
import { OPENING_WHY, type LiveSuggestion } from "@hermes/shared";

export interface SimStep {
  /** ms desde que arranca el guion. */
  at: number;
  suggestion: LiveSuggestion;
  /** Llega por streaming en trozos antes de terminar. */
  stream?: boolean;
}

const s = (id: string, over: Partial<LiveSuggestion> & Pick<LiveSuggestion, "kind" | "text">): LiveSuggestion => ({
  id,
  why: "",
  atMs: 0,
  ...over,
});

export const LENS_SIM: SimStep[] = [
  {
    at: 1_000,
    stream: true,
    suggestion: s("sim-1", {
      kind: "decir",
      source: "fast",
      why: "¿Para cuándo lo tienen?",
      text: "Para el jueves, si hoy cerramos el alcance de los reportes.",
    }),
  },
  {
    at: 11_000,
    suggestion: s("sim-2", {
      kind: "entender",
      text: "Idempotencia — repetir la misma llamada no cambia el resultado: un pago reintentado no se cobra dos veces.",
    }),
  },
  {
    at: 13_000,
    suggestion: s("sim-3", {
      kind: "aportar",
      angle: "Riesgo",
      why: OPENING_WHY.problem,
      text: "Sin reintentos en la cola, una caída del proveedor nos deja pagos sin confirmar.",
    }),
  },
  {
    at: 24_000,
    suggestion: s("sim-4", {
      kind: "aportar",
      angle: "Responde",
      why: OPENING_WHY.named,
      text: "Yo me encargo de la integración; necesito las credenciales de pruebas hoy.",
    }),
  },
  {
    at: 34_000,
    suggestion: s("sim-5", { kind: "dato", text: "La propuesta aprobada habla de 6 semanas, no de 4." }),
  },
  {
    at: 45_000,
    suggestion: s("sim-6", {
      kind: "pulir",
      text: "no sé si tal vez podríamos revisar el alcance → Propongo revisar el alcance hoy.",
    }),
  },
  {
    at: 54_000,
    suggestion: s("sim-7", {
      kind: "rumbo",
      text: "Llevan diez minutos en el diseño del login; el objetivo de hoy era fechar la entrega. Trae la conversación a la fecha.",
    }),
  },
];

/** Duración del guion: al terminar vuelve a empezar. */
export const LENS_SIM_LOOP_MS = 66_000;
