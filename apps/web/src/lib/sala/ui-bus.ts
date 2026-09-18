// Lo que una client tool descubrió, para que la PANTALLA lo pinte.
//
// El modelo de voz decide qué decir; la tarjeta de la ruta no puede depender
// de que su texto venga bien formado. Así que cada tool emite aquí el payload
// ESTRUCTURADO que le devolvió el agente local, y la vista se suscribe. Bus
// mínimo en memoria (sin dependencias, sin React): las tools son un mapa plano
// que vive fuera del árbol de componentes.

export interface UiRoutePlan {
  from: string;
  to: string;
  minutes: number;
  rideMinutes: number;
  transferMinutes: number;
  transfers: number;
  transferEstimated: boolean;
  legs: {
    line: string;
    lineName: string;
    color: string;
    kind: string;
    from: string;
    to: string;
    headsign: string | null;
    stations: string[];
    stops: number;
    minutes: number;
  }[];
}

export interface UiNotice {
  line: string;
  text: string;
  severity: string;
  delayMin: number | null;
}

export interface UiPlace {
  name: string;
  station: string;
  walkMinutes: number;
  hours: string | null;
  note: string | null;
  source: string | null;
  url: string | null;
  category: string | null;
}

export type UiEvent =
  | { kind: "route"; plan: UiRoutePlan; notices: UiNotice[]; next: { line: string; headsign: string; inMinutes: number[] }[]; scheduleStale: boolean }
  | { kind: "route_failed"; query: string; error: string; suggestions: string[] }
  | { kind: "places"; station: string; places: UiPlace[] }
  | { kind: "status"; notices: UiNotice[] }
  | { kind: "language"; language: string }
  | { kind: "clear" };

type Listener = (ev: UiEvent) => void;

const listeners = new Set<Listener>();

export function onUiEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitUiEvent(ev: UiEvent): void {
  for (const fn of [...listeners]) {
    try {
      fn(ev);
    } catch {
      /* un suscriptor roto no tumba a los demás */
    }
  }
}
