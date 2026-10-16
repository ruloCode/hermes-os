/**
 * Conexiones al WS de una junta EN VIVO, con rol. Lógica pura (genérica sobre
 * el tipo del socket) para poder probarla sin Hono ni red.
 *
 * Reglas (Hermes Phone es cliente además del dashboard):
 * - `audio` = dueño del micrófono. Uno solo: el nuevo desplaza SOLO al audio
 *   anterior (que recibe 4001). Los viewers quedan intactos.
 * - `viewer` = mira y controla. Nunca desplaza a nadie y sus frames binarios
 *   se ignoran (dos fuentes de audio mezcladas en el STT romperían los tiempos).
 * - Defaults (`role=audio`, `client=web`): el dashboard no cambia de comportamiento.
 */
import type { LiveClientKind, LiveClientRole } from "@hermes/shared";

export interface LiveClientInfo {
  role: LiveClientRole;
  client: LiveClientKind;
}

/** `?role=` → rol; cualquier otra cosa = audio (lo que siempre hizo el WS). */
export function parseClientRole(v: unknown): LiveClientRole {
  return v === "viewer" ? "viewer" : "audio";
}

/** `client` del start/upload/WS → "web" | "phone" (default web). */
export function parseClientKind(v: unknown): LiveClientKind {
  return typeof v === "string" && v.trim().toLowerCase() === "phone" ? "phone" : "web";
}

export interface LiveClientsSummary {
  audioClient?: LiveClientKind;
  viewers: number;
}

export class LiveClientSet<T> {
  private readonly clients = new Map<T, LiveClientInfo>();

  /**
   * Registra una conexión. Devuelve los sockets DESPLAZADOS (ya fuera del set):
   * el caller los cierra con 4001. Solo un `audio` desplaza, y solo al `audio`.
   */
  add(ws: T, info: LiveClientInfo): T[] {
    const displaced: T[] = [];
    if (info.role === "audio") {
      for (const [other, i] of this.clients) {
        if (i.role === "audio" && other !== ws) displaced.push(other);
      }
      for (const d of displaced) this.clients.delete(d);
    }
    this.clients.set(ws, info);
    return displaced;
  }

  /** false si ya no estaba (p.ej. un desplazado cuyo close llega después). */
  remove(ws: T): boolean {
    return this.clients.delete(ws);
  }

  /** Solo el dueño vigente del audio alimenta el STT. */
  canSendAudio(ws: T): boolean {
    return this.clients.get(ws)?.role === "audio";
  }

  summary(): LiveClientsSummary {
    let audioClient: LiveClientKind | undefined;
    let viewers = 0;
    for (const i of this.clients.values()) {
      if (i.role === "audio") audioClient = i.client;
      else viewers += 1;
    }
    return { audioClient, viewers };
  }

  get size(): number {
    return this.clients.size;
  }

  all(): T[] {
    return [...this.clients.keys()];
  }

  clear(): void {
    this.clients.clear();
  }
}

/** ¿Cambió lo que el resto de clientes necesita saber? (evento `clients`). */
export function clientsChanged(a: LiveClientsSummary, b: LiveClientsSummary): boolean {
  return a.audioClient !== b.audioClient || a.viewers !== b.viewers;
}
