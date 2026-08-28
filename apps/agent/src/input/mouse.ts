import { createRequire } from "node:module";

/**
 * Inyección de eventos de mouse en macOS vía @jitsi/robotjs (CGEventPost).
 * Es la mitad "manos" del control por gestos: el browser detecta la mano con
 * MediaPipe y manda posiciones normalizadas por WS; aquí se traducen a
 * eventos reales del sistema.
 *
 * Dos realidades de macOS que gobiernan este módulo:
 *  - El addon es nativo (prebuild darwin universal). Si no carga (Node raro,
 *    prebuild ausente), la feature degrada a "no disponible" — jamás tumba
 *    el agente. Por eso el require es lazy y está envuelto.
 *  - Sin permiso de Accessibility, CGEventPost descarta los eventos EN
 *    SILENCIO (sin error). El único diagnóstico fiable es empírico: mover el
 *    cursor 2px y leer si de verdad se movió (checkAccessibility). El grant
 *    se le da al binario de node del LaunchAgent y puede caducar con un
 *    upgrade de node — por eso el status se re-chequea, no se cachea eterno.
 */

interface RobotJs {
  moveMouse(x: number, y: number): void;
  mouseClick(button?: "left" | "right" | "middle", double?: boolean): void;
  mouseToggle(down: "down" | "up", button?: "left" | "right" | "middle"): void;
  scrollMouse(x: number, y: number): void;
  getMousePos(): { x: number; y: number };
  getScreenSize(): { width: number; height: number };
  setMouseDelay(ms: number): void;
  keyTap(key: string, modifier?: string | string[]): void;
}

const require = createRequire(import.meta.url);

let robot: RobotJs | null = null;
let loadError: string | null = null;

function loadRobot(): RobotJs | null {
  if (robot || loadError) return robot;
  try {
    robot = require("@jitsi/robotjs") as RobotJs;
    // Default 10ms de sleep SÍNCRONO por evento — a 30-60 ev/s bloquearía el
    // event loop del server entero. CGEventPost no necesita pausa.
    robot.setMouseDelay(0);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
    console.error("[gestures] robotjs no cargó:", loadError);
  }
  return robot;
}

export interface MouseStatus {
  available: boolean;
  error: string | null;
  accessibility: boolean | null;
  screen: { width: number; height: number } | null;
}

/** true mientras NOSOTROS tenemos el botón presionado (para releaseAll). */
let buttonDown = false;

/** Posición real del cursor; {-1,-1} si robotjs no cargó. */
export function getMousePosSafe(): { x: number; y: number } {
  const r = loadRobot();
  return r ? r.getMousePos() : { x: -1, y: -1 };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Self-check empírico del permiso Accessibility: mueve el cursor 2px y lee
 * si aterrizó EXACTAMENTE donde lo mandamos. Dos trampas verificadas en vivo:
 *  - Comparar contra el DESTINO, no contra "¿cambió de donde estaba?" — la
 *    versión ingenua daba falso positivo con la mano del usuario en el mouse.
 *  - getMousePos refleja el CGEvent ~50ms DESPUÉS del post — leer inmediato
 *    da falso negativo con el permiso concedido. De ahí el retry con sleep.
 * Solo restaura si el movimiento fue nuestro (jamás teletransportar un
 * cursor que el usuario está usando).
 */
export async function checkAccessibility(): Promise<boolean | null> {
  const r = loadRobot();
  if (!r) return null;
  try {
    const before = r.getMousePos();
    const target = { x: before.x > 2 ? before.x - 2 : before.x + 2, y: before.y };
    r.moveMouse(target.x, target.y);
    for (let i = 0; i < 5; i++) {
      await sleep(15);
      const after = r.getMousePos();
      if (after.x === target.x && after.y === target.y) {
        r.moveMouse(before.x, before.y);
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export async function mouseStatus(): Promise<MouseStatus> {
  const r = loadRobot();
  return {
    available: r !== null,
    error: loadError,
    accessibility: r ? await checkAccessibility() : null,
    screen: r ? r.getScreenSize() : null,
  };
}

// ── Multi-monitor ────────────────────────────────────────────────────────
// robotjs solo conoce el display principal (getScreenSize), pero moveMouse
// acepta coordenadas GLOBALES de cualquier display (verificado en vivo). El
// helper de ventanas (windows.ts) inyecta la lista real de displays con
// setDisplays(); el cursor gestual entonces mapea 0-1 al display ACTIVO y
// salta al vecino cuando lo empujas contra el borde compartido ~300ms —
// como cruzar monitores con un mouse físico.

export interface DisplayRect {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  main: boolean;
}

let displays: DisplayRect[] = [];
let activeDisplay: DisplayRect | null = null;
let edgeSince: { dir: "left" | "right" | "up" | "down"; t: number } | null = null;
const EDGE_JUMP_MS = 300;

export function setDisplays(list: DisplayRect[]): void {
  displays = list;
  if (activeDisplay) {
    activeDisplay = displays.find((d) => d.id === activeDisplay?.id) ?? null;
  }
}

/** El display que contiene el cursor real (arranque de cada sesión armada). */
export function syncActiveDisplayToCursor(): void {
  const r = loadRobot();
  if (!r || displays.length === 0) return;
  const pos = r.getMousePos();
  activeDisplay =
    displays.find(
      (d) => pos.x >= d.x && pos.x < d.x + d.w && pos.y >= d.y && pos.y < d.y + d.h,
    ) ?? displays.find((d) => d.main) ?? displays[0];
}

export function getActiveDisplay(): DisplayRect | null {
  return activeDisplay;
}

/** Salta el cursor gestual a otro display (p.ej. siguiendo un teleport). */
export function setActiveDisplay(id: number): void {
  const d = displays.find((x) => x.id === id);
  if (d) activeDisplay = d;
}

function currentBounds(): { x: number; y: number; w: number; h: number } {
  if (activeDisplay) return activeDisplay;
  const r = loadRobot();
  const s = r ? r.getScreenSize() : { width: 1920, height: 1080 };
  return { x: 0, y: 0, w: s.width, h: s.height };
}

function neighborAt(px: number, py: number): DisplayRect | null {
  return (
    displays.find(
      (d) => d !== activeDisplay && px >= d.x && px < d.x + d.w && py >= d.y && py < d.y + d.h,
    ) ?? null
  );
}

/** Mueve el cursor a una posición NORMALIZADA (0-1) del display activo. */
export function moveTo(nx: number, ny: number): void {
  const r = loadRobot();
  if (!r) return;
  const cnx = Math.min(Math.max(nx, 0), 1);
  const cny = Math.min(Math.max(ny, 0), 1);
  const b = currentBounds();
  const x = Math.round(b.x + cnx * (b.w - 1));
  const y = Math.round(b.y + cny * (b.h - 1));
  r.moveMouse(x, y);

  // Edge-jump: sostener el cursor contra un borde con vecino = cruzar. El
  // One Euro nunca entrega 1.0 exacto — tolerancia de 0.5% al borde.
  if (displays.length < 2 || !activeDisplay) return;
  const dir =
    cnx >= 0.995 ? "right" : cnx <= 0.005 ? "left" : cny >= 0.995 ? "down" : cny <= 0.005 ? "up" : null;
  if (!dir) {
    edgeSince = null;
    return;
  }
  const probe =
    dir === "right"
      ? { px: b.x + b.w + 20, py: y }
      : dir === "left"
        ? { px: b.x - 20, py: y }
        : dir === "down"
          ? { px: x, py: b.y + b.h + 20 }
          : { px: x, py: b.y - 20 };
  const neighbor = neighborAt(probe.px, probe.py);
  if (!neighbor) {
    edgeSince = null;
    return;
  }
  const now = Date.now();
  if (!edgeSince || edgeSince.dir !== dir) {
    edgeSince = { dir, t: now };
    return;
  }
  if (now - edgeSince.t >= EDGE_JUMP_MS) {
    activeDisplay = neighbor;
    edgeSince = null;
  }
}

// ── Teclado gestual ──────────────────────────────────────────────────────
// SOLO acciones semánticas de una allowlist — el WS jamás transporta teclas
// crudas (un cliente comprometido podría escribir comandos). Cada acción
// tiene cooldown server-side además del debounce del cliente.

const KEY_ACTIONS = {
  copy: { key: "c", modifiers: ["command"] },
  paste: { key: "v", modifiers: ["command"] },
  mission_control: { key: "up", modifiers: ["control"] },
  space_left: { key: "left", modifiers: ["control"] },
  space_right: { key: "right", modifiers: ["control"] },
} as const;

export type KeyAction = keyof typeof KEY_ACTIONS;

const KEY_COOLDOWN_MS = 350;
const lastKeyAt = new Map<KeyAction, number>();

export function isKeyAction(a: string): a is KeyAction {
  return a in KEY_ACTIONS;
}

/** Dispara una acción de teclado. Devuelve false si no aplicó (cooldown). */
export function tapAction(action: KeyAction): boolean {
  const r = loadRobot();
  if (!r) return false;
  const now = Date.now();
  const last = lastKeyAt.get(action) ?? 0;
  if (now - last < KEY_COOLDOWN_MS) return false;
  lastKeyAt.set(action, now);
  const { key, modifiers } = KEY_ACTIONS[action];
  r.keyTap(key, [...modifiers]);
  return true;
}

/**
 * Pinza = botón izquierdo. down/up separados para que el OS interprete solo:
 * pinza rápida → click, pinza sostenida + mover → drag, dos pinzas → doble.
 */
export function setButton(down: boolean): void {
  const r = loadRobot();
  if (!r || buttonDown === down) return;
  r.mouseToggle(down ? "down" : "up", "left");
  buttonDown = down;
}

/** Scroll vertical (dy en unidades de robotjs; positivo = contenido baja). */
export function scrollBy(dy: number): void {
  const r = loadRobot();
  if (!r || dy === 0) return;
  r.scrollMouse(0, dy);
}

/**
 * Red de seguridad: suelta el botón si quedó presionado. Se llama al
 * desconectar/desarmar el WS — sin esto, perder la conexión a mitad de un
 * drag deja el sistema "agarrado" hasta un click físico.
 */
export function releaseAll(): void {
  if (buttonDown) setButton(false);
}
