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
import { getDisplays } from "./windows.js";

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
  | { t: "key"; action: string };

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
  }
}
