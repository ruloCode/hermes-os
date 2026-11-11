import { env } from "../env.js";

/**
 * TeKer IA (el asistente de operación de TeKer Salud) como herramienta de
 * consulta. Habla el formato de OpenAI (Open WebUI): POST /chat/completions con
 * streaming SSE. Guía: <TEKER_IA_URL>/docs/api. La URL del servidor va en el .env
 * (TEKER_IA_URL) y no aquí: es infraestructura de un cliente y el repo es público.
 *
 * La llave (TEKER_IA_API_KEY) vive SOLO en esta Mac: la guía de TeKer prohíbe
 * usarla desde una app, así que Hermes Phone llega por la tool del agente.
 * El proceso hijo de Claude Code no la hereda (child-env.ts).
 *
 * Sus cifras salen de consultas fijas a la copia de análisis: se citan tal cual
 * con su línea de "Fuente" y corte, nunca se recalculan.
 */

/** Medido por TeKer: redacción 50-75 s, la primera tras un reinicio ~80 s. */
const TIMEOUT_MS = 180_000;

export const TEKER_MODELS = ["asistente_operacion", "teker_ia_dev"] as const;
export type TekerModel = (typeof TEKER_MODELS)[number];

/**
 * Lo que parece dato de un paciente: correo, celular colombiano o un número
 * de documento (6-10 dígitos, con o sin puntos). TeKer IA también lo bloquea,
 * pero esto no sale de la Mac. Prefiere falsos negativos con los años y las
 * cifras de citas: un año tiene 4 dígitos y una fecha lleva separadores.
 * Los nombres no se pueden detectar: eso lo cuida la descripción de la tool.
 */
export function patientDataIn(text: string): string | null {
  if (/[\w.+-]+@[\w-]+\.[\w.]+/.test(text)) return "un correo";
  if (/(?:\+?57[\s-]?)?\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/.test(text)) return "un teléfono";
  if (/\b\d{1,3}(?:\.\d{3}){2,3}\b/.test(text) || /\b\d{6,10}\b/.test(text)) return "un número de documento";
  return null;
}

/** Junta el texto de un stream SSE de OpenAI (`data: {...}` … `data: [DONE]`). */
export function sseContent(raw: string): string {
  let out = "";
  for (const line of raw.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const data = l.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data);
      out += chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content ?? "";
    } catch {
      // Una línea partida o un comentario del servidor: no es texto.
    }
  }
  return out;
}

export type TekerAnswer = { ok: true; text: string; model: TekerModel } | { ok: false; error: string };

export type TekerTurn = { role: "user" | "assistant"; content: string };

/**
 * La API no guarda historial: para un seguimiento ("¿y la semana pasada?") se
 * mandan los turnos anteriores en `history`, como en OpenAI. Solo se revisa la
 * pregunta nueva: lo anterior ya pasó por aquí.
 */
export async function askTekerIa(
  question: string,
  model: TekerModel = "asistente_operacion",
  history: TekerTurn[] = [],
): Promise<TekerAnswer> {
  const key = env.TEKER_IA_API_KEY.trim();
  if (!key) return { ok: false, error: "falta TEKER_IA_API_KEY en el .env de esta Mac" };
  const base = env.TEKER_IA_URL.trim().replace(/\/+$/, "");
  if (!base) return { ok: false, error: "falta TEKER_IA_URL en el .env de esta Mac (la URL del servidor de TeKer IA, sin /api)" };
  const pii = patientDataIn(question);
  if (pii) return { ok: false, error: `la pregunta trae ${pii}; TeKer IA no maneja datos de pacientes` };

  let res: Response;
  try {
    res = await fetch(`${base}/api/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true, messages: [...history, { role: "user", content: question }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return { ok: false, error: timeout ? "no respondió en 3 minutos" : `no se pudo conectar (${(err as Error).message})` };
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    const why =
      res.status === 401 ? "la llave no sirve (401: mal copiada o revocada)"
      : res.status === 403 ? "la llave no tiene permiso para esto (403)"
      : /model not found/i.test(body) ? `el modelo ${model} no está disponible para esta llave`
      : `respondió HTTP ${res.status}`;
    return { ok: false, error: why };
  }

  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return { ok: false, error: "se cortó la respuesta a mitad (más de 3 minutos)" };
  }
  const text = sseContent(raw).trim();
  if (!text) return { ok: false, error: "respondió vacío" };
  // Así avisa Open WebUI que el modelo local estaba cargando o con cola.
  if (/^No pude responder con el modelo local/i.test(text)) return { ok: false, error: "el modelo local estaba cargando o con cola" };
  return { ok: true, text, model };
}
