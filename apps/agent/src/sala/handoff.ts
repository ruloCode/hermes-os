import { randomBytes } from "node:crypto";

/**
 * "Sigue en tu celular": el tótem guarda lo que acaba de pasar (la ruta, el
 * idioma, un resumen de la charla) bajo un token corto, muestra el QR y el
 * viajero abre la misma conversación en su teléfono.
 *
 * En MEMORIA a propósito: es un pase de 15 minutos para cruzar un andén, no
 * un registro. No lleva nada de quién es el viajero, se borra al reiniciar el
 * agente y se barre solo. Un token se puede leer varias veces (el celular
 * recarga, la página se comparte con quien viaja al lado) pero muere con su
 * plazo.
 */

export interface HandoffPayload {
  /** Resumen hablado de la conversación, para reabrirla sin repetir todo. */
  summary: string;
  language: string;
  /** El plan tal como lo pintó el tótem (misma forma que /metro/route). */
  route?: unknown;
  /** Estación donde estaba plantado el tótem. */
  station?: string;
}

export interface HandoffEntry extends HandoffPayload {
  token: string;
  createdAt: number;
  expiresAt: number;
}

export const HANDOFF_TTL_MS = 15 * 60 * 1000;
const MAX_ENTRIES = 200;

const store = new Map<string, HandoffEntry>();

function sweep(now = Date.now()): void {
  for (const [token, entry] of store) if (entry.expiresAt <= now) store.delete(token);
  // Tope duro: si algo se desbocara, se van los más viejos primero.
  while (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    store.delete(oldest[0]);
  }
}

/** Token corto y legible en voz alta si hace falta (sin caracteres ambiguos). */
function newToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function createHandoff(payload: HandoffPayload, now = Date.now()): HandoffEntry {
  sweep(now);
  const token = newToken();
  const entry: HandoffEntry = {
    token,
    summary: payload.summary.slice(0, 1200),
    language: (payload.language || "es").slice(0, 5),
    ...(payload.route !== undefined ? { route: payload.route } : {}),
    ...(payload.station ? { station: payload.station.slice(0, 120) } : {}),
    createdAt: now,
    expiresAt: now + HANDOFF_TTL_MS,
  };
  store.set(token, entry);
  return entry;
}

/** null = no existe o ya venció (el celular lo dice y ofrece volver a la pantalla). */
export function readHandoff(token: string, now = Date.now()): HandoffEntry | null {
  sweep(now);
  const entry = store.get(token);
  if (!entry || entry.expiresAt <= now) return null;
  return entry;
}

/** Cuántos pases vivos hay (diagnóstico). */
export function handoffCount(now = Date.now()): number {
  sweep(now);
  return store.size;
}

/** Tests: deja el almacén limpio. */
export function clearHandoffs(): void {
  store.clear();
}
