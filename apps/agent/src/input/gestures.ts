import type { WSContext } from "hono/ws";
import { emit } from "../events.js";
import {
  checkAccessibility,
  isKeyAction,
  mouseStatus,
  moveTo,
  releaseAll,
  scrollBy,
  setButton,
  syncActiveDisplayToCursor,
  tapAction,
} from "./mouse.js";
import {
  dragGrabbed,
  getDisplays,
  grabWindowUnderCursor,
  releaseGrabbed,
  releaseGrabIfAny,
  type ThrowDir,
} from "./windows.js";
import { runSystemSignAction } from "./sign-actions.js";
import { isSystemSignAction } from "@hermes/shared";

/**
 * Sesión de control por gestos: UN cliente a la vez (el dashboard). El
 * browser corre MediaPipe y manda por WS posiciones ya suavizadas + cambios
 * de pinza; aquí solo se traduce a eventos del sistema con tres guardas:
 *
 *  - "armed": el cliente arma/desarma explícitamente — conectar el WS no
 *    basta para mover el mouse. Desarmar (o desconectar) suelta el botón.
 *  - Cliente único: una pestaña nueva desplaza a la anterior (código 4001,
 *    mismo contrato que la junta EN VIVO) — dos manos peleando por un cursor
 *    no es un escenario, es un bug.
 *  - Watchdog: si hay botón presionado y no llegan mensajes en 2s (pestaña
 *    congelada, WS zombie), se suelta solo. Un drag fantasma que no puedes
 *    soltar es la peor falla posible de esta feature.
 */

type GestureClientMessage =
  | { t: "arm" }
  | { t: "disarm" }
  | { t: "move"; x: number; y: number }
  | { t: "pinch"; down: boolean }
  | { t: "scroll"; dy: number }
  | { t: "key"; action: string }
  | { t: "sign"; action: string }
  | { t: "grab"; x: number; y: number }
  | { t: "drag"; x: number; y: number }
  | { t: "release"; mode: "drop" | "throw"; dir?: ThrowDir };

const KEY_ACTION_LABEL: Record<string, string> = {
  copy: "copiar (⌘C)",
  paste: "pegar (⌘V)",
  mission_control: "Mission Control",
  space_left: "Space anterior",
  space_right: "Space siguiente",
};

interface GestureSession {
  ws: WSContext;
  armed: boolean;
  lastMessageAt: number;
}

let session: GestureSession | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

const WATCHDOG_MS = 2_000;
const PING_MS = 15_000;

function send(ws: WSContext, ev: object): void {
  try {
    ws.send(JSON.stringify(ev));
  } catch {
    /* cliente ido: el onClose lo limpia */
  }
}

function stopTimers(): void {
  if (watchdog) clearInterval(watchdog);
  if (pingTimer) clearInterval(pingTimer);
  watchdog = null;
  pingTimer = null;
}

function startTimers(): void {
  stopTimers();
  // El watchdog solo protege el estado peligroso (botón presionado): si la
  // pestaña se congela a mitad de un drag, lo soltamos nosotros.
  watchdog = setInterval(() => {
    if (!session) return;
    if (Date.now() - session.lastMessageAt > WATCHDOG_MS) releaseAll();
  }, WATCHDOG_MS);
  pingTimer = setInterval(() => {
    if (session) send(session.ws, { t: "ping" });
  }, PING_MS);
}

export async function attachGestureClient(ws: WSContext): Promise<void> {
  // La pestaña nueva gana: la vieja recibe 4001 y NO reintenta (contrato
  // compartido con la junta EN VIVO).
  if (session) {
    releaseAll();
    try {
      session.ws.close(4001, "otra pestaña tomó el control por gestos");
    } catch {
      /* noop */
    }
  }
  const mine: GestureSession = { ws, armed: false, lastMessageAt: Date.now() };
  session = mine;
  startTimers();
  const status = await mouseStatus(); // el self-check tarda ~15-75ms
  if (session === mine) send(ws, { t: "hello", ...status });
}

export function detachGestureClient(ws: WSContext): void {
  if (!session || session.ws !== ws) return;
  const wasArmed = session.armed;
  session = null;
  stopTimers();
  releaseAll();
  releaseGrabIfAny();
  if (wasArmed) emit({ kind: "gestures", detail: "control por gestos desconectado" });
}

export async function handleGestureMessage(ws: WSContext, raw: string): Promise<void> {
  if (!session || session.ws !== ws) return;
  session.lastMessageAt = Date.now();

  let msg: GestureClientMessage;
  try {
    msg = JSON.parse(raw) as GestureClientMessage;
  } catch {
    return;
  }

  switch (msg.t) {
    case "arm": {
      // Re-chequear el permiso AL ARMAR (no solo en el hello): el grant de
      // Accessibility puede haberse revocado con el agente ya corriendo.
      const granted = await checkAccessibility();
      if (!session || session.ws !== ws) return; // se desconectó durante el check
      if (!granted) {
        send(ws, { t: "status", armed: false, accessibility: granted });
        return;
      }
      session.armed = true;
      // Multi-monitor: refresca la geometría real de displays (helper nativo)
      // y ancla el cursor gestual al display donde está el cursor físico.
      await getDisplays().catch(() => []);
      syncActiveDisplayToCursor();
      send(ws, { t: "status", armed: true, accessibility: true });
      emit({ kind: "gestures", detail: "control por gestos ARMADO (mano → cursor)" });
      break;
    }
    case "disarm":
      session.armed = false;
      releaseAll();
      releaseGrabIfAny();
      send(ws, { t: "status", armed: false, accessibility: null });
      emit({ kind: "gestures", detail: "control por gestos desarmado" });
      break;
    case "move":
      if (session.armed && Number.isFinite(msg.x) && Number.isFinite(msg.y)) {
        moveTo(msg.x, msg.y);
      }
      break;
    case "pinch":
      if (session.armed) setButton(msg.down === true);
      break;
    case "scroll":
      if (session.armed && Number.isFinite(msg.dy)) scrollBy(Math.trunc(msg.dy));
      break;
    case "key":
      // Allowlist estricta: solo acciones semánticas, jamás teclas crudas.
      if (session.armed && isKeyAction(msg.action) && tapAction(msg.action)) {
        emit({ kind: "gestures", detail: `gesto: ${KEY_ACTION_LABEL[msg.action] ?? msg.action}` });
      }
      break;
    // ── Agarrar con el puño: grab (ventana bajo el cursor) → drag (palma
    // normalizada) → release drop/throw. El agente responde grab_result y
    // release_result para que el HUD diga qué ventana y qué pasó.
    case "grab": {
      if (!session.armed || !Number.isFinite(msg.x) || !Number.isFinite(msg.y)) break;
      const r = await grabWindowUnderCursor(msg.x, msg.y);
      if (!session || session.ws !== ws) break;
      send(ws, { t: "grab_result", ok: !("error" in r), detail: "error" in r ? r.error : r.app });
      if (!("error" in r)) emit({ kind: "gestures", detail: `ventana agarrada: ${r.app}` });
      break;
    }
    case "drag":
      if (session.armed && Number.isFinite(msg.x) && Number.isFinite(msg.y)) dragGrabbed(msg.x, msg.y);
      break;
    case "release": {
      if (!session.armed) break;
      const mode = msg.mode === "throw" ? "throw" : "drop";
      const dir = ["left", "right", "up", "down"].includes(msg.dir ?? "") ? msg.dir : undefined;
      const r = await releaseGrabbed(mode, dir);
      if (!session || session.ws !== ws) break;
      send(ws, {
        t: "release_result",
        ok: !("error" in r),
        detail: "error" in r ? r.error : `${r.app}: ${r.detail}`,
      });
      if (!("error" in r)) emit({ kind: "gestures", detail: `ventana ${r.app}: ${r.detail}` });
      break;
    }
    case "sign": {
      // Seña configurable → acción de SISTEMA del catálogo compartido (las
      // de browser nunca llegan aquí). El resultado vuelve al cliente para
      // que el HUD diga qué pasó — "no hay ventana bajo el cursor" es
      // información, no un fallo silencioso.
      if (!session.armed || typeof msg.action !== "string" || !isSystemSignAction(msg.action)) break;
      const result = await runSystemSignAction(msg.action);
      if (!session || session.ws !== ws) break;
      send(ws, {
        t: "sign_result",
        action: msg.action,
        ok: result.ok,
        detail: result.ok ? result.detail : result.error,
      });
      emit({
        kind: "gestures",
        detail: result.ok ? `seña: ${result.detail}` : `seña ${msg.action}: ${result.error}`,
      });
      break;
    }
  }
}
