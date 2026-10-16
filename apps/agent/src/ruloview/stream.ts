/**
 * Stream de RuloView: UNA conexión al servidor RuView, compartida por todas
 * las pestañas que miran /ruloview (GET /ruloview/events es SSE).
 *
 * El navegador no habla con el servidor directo: el token vive en el agente
 * (docker/.env) y el WS del servidor exige Bearer o ticket. Aquí se pide un
 * ticket (`POST /api/v1/ws-ticket`, el mismo camino que usa su UI) y se abre
 * `/ws/sensing`. Si el WS cae, se pasa a polling de `/api/v1/sensing/latest`
 * cada 250 ms y se reintenta el WS cada 2 s. Cada mensaje sale recortado
 * (`trimSensing`): la UI no depende de la forma completa del servidor.
 *
 * Sin nadie mirando se cierra todo: el servidor no tiene por qué pagar el
 * stream de una página que nadie tiene abierta.
 */
import { trimEdgeVitals, trimSensing, type RuStreamMsg, type RuStreamState } from "@hermes/shared";
import { ruviewToken, ruviewUrl } from "./server.js";

type Listener = (msg: RuStreamMsg) => void;
const listeners = new Set<Listener>();

let ws: WebSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let state: RuStreamState = "down";
let lastError: string | undefined;

function broadcast(msg: RuStreamMsg) {
  for (const l of listeners) l(msg);
}

function setState(next: RuStreamState, error?: string) {
  if (next === state && error === lastError) return;
  state = next;
  lastError = error;
  broadcast({ type: "link", state, error });
}

function handle(raw: unknown) {
  const d = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (d.type === "edge_vitals") {
    const v = trimEdgeVitals(d);
    if (v) broadcast({ type: "vitals", v });
    return;
  }
  if (d.type && d.type !== "sensing_update") return;
  const s = trimSensing(d);
  if (s) broadcast({ type: "sensing", d: s });
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const res = await fetch(`${ruviewUrl()}/api/v1/sensing/latest`, {
        headers: { Authorization: `Bearer ${ruviewToken()}` },
        signal: AbortSignal.timeout(1500),
      });
      if (!res.ok) throw new Error(res.status === 401 ? "token rechazado (401)" : `HTTP ${res.status}`);
      handle(await res.json());
      if (state !== "ws") setState("poll");
    } catch (err) {
      setState("down", err instanceof Error ? err.message : String(err));
    }
  }, 250);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

async function connect() {
  retryTimer = null;
  if (!listeners.size || ws) return;
  startPolling();
  try {
    const res = await fetch(`${ruviewUrl()}/api/v1/ws-ticket`, {
      method: "POST",
      headers: { Authorization: `Bearer ${ruviewToken()}` },
      signal: AbortSignal.timeout(2000),
    });
    const ticket = res.ok ? ((await res.json()) as { ticket?: string }).ticket : null;
    if (!listeners.size) return;
    const url = new URL(`${ruviewUrl()}/ws/sensing`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    if (ticket) url.searchParams.set("ticket", ticket);
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => {
      stopPolling();
      setState("ws");
    };
    sock.onmessage = (e) => {
      try {
        handle(JSON.parse(String(e.data)));
      } catch {
        /* mensaje que no es JSON: se ignora */
      }
    };
    sock.onclose = () => {
      if (ws === sock) ws = null;
      if (!listeners.size) return;
      startPolling();
      retryTimer ??= setTimeout(connect, 2000);
    };
    sock.onerror = () => sock.close();
  } catch {
    retryTimer ??= setTimeout(connect, 3000);
  }
}

function teardown() {
  stopPolling();
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  const sock = ws;
  ws = null;
  sock?.close();
  state = "down";
  lastError = undefined;
}

/** Se suscribe al stream; devuelve el estado actual y la función para salir. */
export function subscribeRuloview(fn: Listener): { state: RuStreamState; error?: string; leave: () => void } {
  listeners.add(fn);
  if (listeners.size === 1) void connect();
  return {
    state,
    error: lastError,
    leave: () => {
      listeners.delete(fn);
      if (!listeners.size) teardown();
    },
  };
}
