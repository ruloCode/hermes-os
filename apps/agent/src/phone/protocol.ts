/**
 * Protocolo del canal "cuerpo" de Hermes Phone (GET /phone/ws, frames JSON de
 * texto). El teléfono Android habla EXACTAMENTE esto — cambiarlo rompe la app.
 *
 * Teléfono → agente:
 *   {"t":"hello","device":{id,model,android,sdk,app},"capabilities":[...]}
 *   {"t":"result","id":"<call id>","ok":true,"data":<json>}
 *   {"t":"result","id":"<call id>","ok":false,"error":"texto en español"}
 *   {"t":"ping"}
 *   {"t":"ack","id":"<notice id>"}            (el aviso ya se mostró)
 *   Compañero (solo una app que anuncia "growth"):
 *   {"t":"reply","id":"<notice id>","choice":"Hecho"}       (respondió el check-in)
 *   {"t":"feedback","id":"<notice id>","value":"up|down|later|never"}
 *   {"t":"shown","id":"<notice id>","at":"ISO"}             (salió en un momento libre)
 *   {"t":"vetoed","id":"<notice id>","reason":"…"}          (se cerró la ventana bajo un veto)
 *   {"t":"call_result","id":"<call id>","outcome":"answered|declined|missed|failed","reason"?}
 * Agente → teléfono:
 *   {"t":"welcome","device_id":"...","first_seen":"ISO"}
 *   {"t":"call","id":"<uuid>","tool":"open_app","args":{...}}
 *   {"t":"pong"}
 *   {"t":"notify","id","title","body","source","created_at", kind?, why?, replies?, not_after?}   (solo si el hello trae "notify")
 *   {"t":"call_schedule","id","at":"ISO","reason"}   (la próxima llamada semanal; solo con "growth")
 *   {"t":"call_cancel"}                              (ya no hay llamada agendada)
 *
 * Lógica pura: parsear y validar lo que llega. Un frame malformado devuelve
 * null y se ignora (el teléfono no recibe error: el protocolo no lo define).
 */

/** Lo que el teléfono sabe hacer. `tool` de un `call` es SIEMPRE uno de estos. */
export const PHONE_CAPABILITIES = [
  "list_apps",
  "open_app",
  "read_screen",
  "tap",
  "type",
  "global",
  "scroll",
  // Sesiones de foco: el reloj y las reglas viven en el teléfono (funcionan sin la Mac).
  "focus",
  // Grabar una junta: el micrófono y la grabación viven en el teléfono (graban sin la Mac).
  "meeting",
] as const;
export type PhoneCapability = (typeof PHONE_CAPABILITIES)[number];

export interface PhoneDeviceInfo {
  id: string;
  model: string;
  android: string;
  sdk: number | null;
  app: string;
}

export type PhoneInbound =
  | { t: "hello"; device: PhoneDeviceInfo; capabilities: string[] }
  | { t: "result"; id: string; ok: true; data: unknown }
  | { t: "result"; id: string; ok: false; error: string }
  | { t: "ping" }
  | { t: "ack"; id: string }
  | { t: "reply"; id: string; choice: string }
  | { t: "feedback"; id: string; value: "up" | "down" | "later" | "never" }
  | { t: "shown"; id: string; at: string }
  | { t: "vetoed"; id: string; reason: string }
  | { t: "call_result"; id: string; outcome: "answered" | "declined" | "missed" | "failed"; reason?: string };

export type PhoneOutbound =
  | { t: "welcome"; device_id: string; first_seen: string }
  | { t: "call"; id: string; tool: PhoneCapability; args: Record<string, unknown> }
  | { t: "pong" }
  | {
      t: "notify";
      id: string;
      title: string;
      body: string;
      source: string;
      created_at: string;
      kind?: string;
      why?: string;
      replies?: string[];
      not_after?: string;
    }
  | { t: "call_schedule"; id: string; at: string; reason: string }
  | { t: "call_cancel" };

/** Capacidad que anuncia una app que sabe mostrar avisos (las anteriores no la mandan). */
export const NOTIFY_CAPABILITY = "notify";
/** Capacidad del compañero: respuestas a los check-ins y la llamada semanal. */
export const GROWTH_CAPABILITY = "growth";

/** Resultado que devuelve callPhone (y que reciben las tools). */
export type PhoneCallResult = { ok: true; data: unknown } | { ok: false; error: string };

const str = (v: unknown, max = 200): string =>
  typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "";

export function parsePhoneMessage(raw: string): PhoneInbound | null {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  switch (m.t) {
    case "ping":
      return { t: "ping" };
    case "ack": {
      const id = str(m.id, 100);
      return id ? { t: "ack", id } : null;
    }
    case "reply": {
      const id = str(m.id, 100);
      const choice = str(m.choice, 40);
      return id && choice ? { t: "reply", id, choice } : null;
    }
    case "feedback": {
      const id = str(m.id, 100);
      const value = m.value;
      return id && (value === "up" || value === "down" || value === "later" || value === "never")
        ? { t: "feedback", id, value }
        : null;
    }
    case "shown": {
      const id = str(m.id, 100);
      const at = str(m.at, 40);
      return id ? { t: "shown", id, at: at && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString() } : null;
    }
    case "vetoed": {
      const id = str(m.id, 100);
      return id ? { t: "vetoed", id, reason: str(m.reason, 200) || "sin motivo" } : null;
    }
    case "call_result": {
      const id = str(m.id, 100);
      const o = m.outcome;
      if (!id || (o !== "answered" && o !== "declined" && o !== "missed" && o !== "failed")) return null;
      const reason = str(m.reason, 300);
      return { t: "call_result", id, outcome: o, ...(reason ? { reason } : {}) };
    }
    case "hello": {
      const d = (m.device ?? {}) as Record<string, unknown>;
      const id = str(d.id, 100);
      if (!id) return null; // sin id estable no hay registro posible
      const sdk = typeof d.sdk === "number" && Number.isFinite(d.sdk) ? d.sdk : null;
      const capabilities = Array.isArray(m.capabilities)
        ? m.capabilities.filter((c): c is string => typeof c === "string").slice(0, 50)
        : [];
      return {
        t: "hello",
        device: { id, model: str(d.model), android: str(d.android, 40), sdk, app: str(d.app, 40) },
        capabilities,
      };
    }
    case "result": {
      const id = str(m.id, 100);
      if (!id) return null;
      if (m.ok === true) return { t: "result", id, ok: true, data: m.data ?? null };
      const error = str(m.error, 2000) || "El teléfono no pudo completar la acción (sin motivo).";
      return { t: "result", id, ok: false, error };
    }
    default:
      return null;
  }
}
