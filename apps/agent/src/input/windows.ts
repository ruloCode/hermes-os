import { spawn, execFile, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getActiveDisplay,
  getMousePosSafe,
  moveTo,
  setActiveDisplay,
  setDisplays,
  type DisplayRect,
} from "./mouse.js";

/**
 * Puente al helper nativo de ventanas (native/window-helper.swift): displays
 * reales, ventana bajo un punto y teletransporte vía Accessibility API. El
 * helper es un proceso persistente hijo (NDJSON stdin/stdout) — hereda el
 * permiso de Accessibility del node del agente. Si el binario no existe se
 * compila UNA vez con swiftc; sin swiftc la feature degrada: el cursor
 * gestual queda limitado al display principal y la deixis a coordenadas.
 */

const agentRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const HELPER_BIN = resolve(agentRoot, "native/window-helper");
const BUILD_SCRIPT = resolve(agentRoot, "scripts/build-window-helper.sh");
const REQUEST_TIMEOUT_MS = 3_000;
const DISPLAYS_TTL_MS = 60_000;

export interface WindowInfo {
  pid: number;
  app: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Pending {
  resolve: (v: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

let child: ChildProcessWithoutNullStreams | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
let helperBroken = false;
let displaysCache: { list: DisplayRect[]; at: number } | null = null;

function buildHelper(): Promise<boolean> {
  return new Promise((done) => {
    execFile(BUILD_SCRIPT, { timeout: 120_000 }, (err) => {
      if (err) console.error("[windows] no se pudo compilar el helper:", err.message);
      done(!err);
    });
  });
}

async function ensureChild(): Promise<ChildProcessWithoutNullStreams | null> {
  if (child) return child;
  if (helperBroken) return null;
  if (!existsSync(HELPER_BIN)) {
    if (!(await buildHelper()) || !existsSync(HELPER_BIN)) {
      helperBroken = true;
      return null;
    }
  }
  const proc = spawn(HELPER_BIN, [], { stdio: ["pipe", "pipe", "pipe"] });
  let buffer = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      try {
        const msg = JSON.parse(line) as { id: number; ok: boolean; data?: unknown; error?: string };
        const p = pending.get(msg.id);
        if (p) {
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve(msg.ok ? (msg.data ?? true) : null);
        }
      } catch {
        /* línea rota: se ignora */
      }
    }
  });
  proc.on("exit", () => {
    if (child === proc) child = null;
    // Requests colgados: resolver a null (el caller degrada, no espera 3s).
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      p.resolve(null);
      pending.delete(id);
    }
  });
  proc.stderr.on("data", (d: Buffer) => console.error("[windows]", d.toString().trim()));
  child = proc;
  return proc;
}

async function request(cmd: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const proc = await ensureChild();
  if (!proc) return null;
  const id = nextId++;
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolvePromise(null);
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve: resolvePromise, timer });
    proc.stdin.write(`${JSON.stringify({ id, cmd, ...params })}\n`);
  });
}

/** Displays reales (cache 60s). También alimenta el mapeo del cursor gestual. */
export async function getDisplays(): Promise<DisplayRect[]> {
  const now = Date.now();
  if (displaysCache && now - displaysCache.at < DISPLAYS_TTL_MS) return displaysCache.list;
  const data = (await request("displays")) as DisplayRect[] | null;
  if (!data || data.length === 0) return displaysCache?.list ?? [];
  displaysCache = { list: data, at: now };
  setDisplays(data);
  return data;
}

export async function windowAt(x: number, y: number): Promise<WindowInfo | null> {
  return ((await request("windowAt", { x, y })) as WindowInfo | null) ?? null;
}

/**
 * Contexto de deixis para la voz: dónde está el cursor, en qué display y qué
 * ventana hay debajo — "esto"/"esta ventana" deja de ser ambiguo.
 */
export async function pointerContext(): Promise<{
  cursor: { x: number; y: number };
  display: DisplayRect | null;
  window: WindowInfo | null;
}> {
  const cursor = getMousePosSafe();
  const displays = await getDisplays();
  const display =
    displays.find(
      (d) => cursor.x >= d.x && cursor.x < d.x + d.w && cursor.y >= d.y && cursor.y < d.y + d.h,
    ) ?? null;
  const window = cursor.x >= 0 ? await windowAt(cursor.x, cursor.y) : null;
  return { cursor, display, window };
}

/**
 * Teletransporta la ventana bajo el cursor al siguiente display, conservando
 * su posición RELATIVA (una ventana centrada llega centrada). El cursor
 * gestual salta con ella (setActiveDisplay + moveTo al centro de la ventana).
 */
export async function teleportWindowUnderCursor(): Promise<
  { app: string; title: string; display: number } | { error: string }
> {
  const displays = await getDisplays();
  if (displays.length < 2) return { error: "solo hay un display" };
  const ctx = await pointerContext();
  if (!ctx.window) return { error: "no hay ventana bajo el cursor" };
  const from = ctx.display ?? displays[0];
  const idx = displays.findIndex((d) => d.id === from.id);
  const to = displays[(idx + 1) % displays.length];

  const win = ctx.window;
  const relX = (win.x - from.x) / from.w;
  const relY = (win.y - from.y) / from.h;
  // Clamp: que el título quede SIEMPRE alcanzable en el display destino.
  const toX = Math.round(to.x + Math.min(Math.max(relX, 0), 0.9) * to.w);
  const toY = Math.round(to.y + Math.min(Math.max(relY, 0), 0.9) * to.h);

  const moved = await request("moveWindow", {
    pid: win.pid,
    fromX: win.x,
    fromY: win.y,
    toX,
    toY,
  });
  if (!moved) return { error: "AX no pudo mover la ventana (¿permiso Accessibility?)" };

  await request("focus", { pid: win.pid, x: toX, y: toY });
  // El cursor gestual sigue a la ventana: display activo nuevo + centro.
  setActiveDisplay(to.id);
  if (getActiveDisplay()) {
    moveTo((toX + win.w / 2 - to.x) / to.w, (toY + win.h / 2 - to.y) / to.h);
  }
  return { app: win.app, title: win.title, display: to.id };
}
