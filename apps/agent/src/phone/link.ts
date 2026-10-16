import { randomUUID } from "node:crypto";
import { env } from "../env.js";
import { emit } from "../events.js";
import { fileDeviceStore, lastSeenDevice, touchDevice, upsertDevice, type DeviceStore, type PhoneDeviceRecord } from "./registry.js";
import {
  admitNotice,
  deliverable,
  fileNoticeStore,
  markAcked,
  markSent,
  sweepNotices,
  usedToday,
  type NoticeInput,
  type NoticeStore,
  type PhoneNotice,
} from "./notices.js";
import {
  GROWTH_CAPABILITY,
  NOTIFY_CAPABILITY,
  parsePhoneMessage,
  type PhoneCallResult,
  type PhoneCapability,
  type PhoneDeviceInfo,
  type PhoneInbound,
  type PhoneOutbound,
} from "./protocol.js";

/**
 * Enlace con el teléfono (canal "cuerpo" de Hermes Phone, GET /phone/ws).
 *
 * - UN dispositivo activo a la vez: un `hello` desde otro socket reemplaza al
 *   anterior, que se cierra con 4001 "reemplazado" (mismo contrato que la
 *   junta en vivo y los gestos: el viejo NO reintenta).
 * - `callPhone(tool, args)` manda un `call` y espera su `result` por id. Si el
 *   socket se cierra, las llamadas pendientes se resuelven con error — nunca
 *   quedan colgadas hasta el timeout.
 * - La confirmación humana de acciones con efectos vive EN EL TELÉFONO: aquí
 *   solo se espera (por eso tap tiene un timeout largo).
 *
 * - Avisos (agente → teléfono, `notify`): ver notices.ts. Se mandan solo a una
 *   app que anuncia "notify" en su hello; el resto espera en cola.
 *
 * `createPhoneLink` recibe store y emisor para que los tests no toquen disco
 * ni Supabase; el módulo exporta el singleton real.
 */

/** Lo mínimo que se usa de un WSContext de Hono (los tests pasan un doble). */
export interface PhoneSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface PhoneStatus {
  connected: boolean;
  device?: {
    id: string;
    model: string;
    android: string;
    sdk?: number | null;
    app?: string;
    capabilities?: string[];
    first_seen: string;
    connected_at?: string;
  };
  last_seen?: string;
}

interface Active {
  ws: PhoneSocket;
  device: PhoneDeviceInfo;
  capabilities: string[];
  firstSeen: string;
  connectedAt: string;
}

interface Pending {
  ws: PhoneSocket;
  tool: PhoneCapability;
  resolve: (r: PhoneCallResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const PHONE_DEFAULT_TIMEOUT_MS = 20_000;
/** Para que un ping no reescriba devices.json cada 15 s. */
const TOUCH_EVERY_MS = 60_000;

export const NO_PHONE_ERROR = "No hay un teléfono conectado";
export const PHONE_GONE_ERROR = "El teléfono se desconectó";

export const NOTICES_PER_DAY_DEFAULT = 3;

/** Frames del compañero que el teléfono manda de vuelta (los consume growth/). */
export type GrowthFrame = Extract<PhoneInbound, { t: "reply" | "feedback" | "shown" | "vetoed" | "call_result" }>;

export function createPhoneLink(opts: {
  store: DeviceStore;
  onEvent?: (detail: string) => void;
  now?: () => Date;
  notices?: NoticeStore;
  /** Avisos al día (P8). Se lee en cada aviso: cambiarlo no exige reiniciar la cola. */
  noticesPerDay?: () => number;
  tz?: string;
  newId?: () => string;
}) {
  const now = opts.now ?? (() => new Date());
  const onEvent = opts.onEvent ?? (() => {});
  let active: Active | null = null;
  const pending = new Map<string, Pending>();
  let lastTouch = 0;
  // Escrituras del registro en serie: load→modificar→save sin pisarse.
  let writes: Promise<unknown> = Promise.resolve();
  const mutate = <T>(fn: (d: PhoneDeviceRecord[]) => { devices: PhoneDeviceRecord[]; out: T }): Promise<T> => {
    const run = writes.then(async () => {
      const { devices, out } = fn(await opts.store.load());
      await opts.store.save(devices);
      return out;
    });
    writes = run.catch((err) => console.error("[phone] registro:", err instanceof Error ? err.message : err));
    return run;
  };

  const send = (ws: PhoneSocket, msg: PhoneOutbound) => {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket roto: su close limpia */
    }
  };

  const label = (d: PhoneDeviceInfo) => d.model || d.id.slice(0, 8);

  // ── Avisos ──
  const noticeStore = opts.notices;
  const tz = opts.tz ?? "America/Bogota";
  const newId = opts.newId ?? randomUUID;
  const perDay = () => {
    const n = opts.noticesPerDay?.() ?? NOTICES_PER_DAY_DEFAULT;
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : NOTICES_PER_DAY_DEFAULT;
  };
  // Cola en serie, aparte del registro: un aviso no espera a que se escriba devices.json.
  let noticeWrites: Promise<unknown> = Promise.resolve();
  const mutateNotices = <T>(fn: (n: PhoneNotice[]) => { notices: PhoneNotice[]; out: T }): Promise<T> => {
    if (!noticeStore) return Promise.reject(new Error("sin cola de avisos"));
    const run = noticeWrites.then(async () => {
      const { notices, out } = fn(sweepNotices(await noticeStore.load(), now().toISOString()));
      await noticeStore.save(notices);
      return out;
    });
    noticeWrites = run.catch((err) => console.error("[phone] avisos:", err instanceof Error ? err.message : err));
    return run;
  };
  const canNotify = (a: Active | null): a is Active => !!a && a.capabilities.includes(NOTIFY_CAPABILITY);
  const canGrow = (a: Active | null): a is Active => !!a && a.capabilities.includes(GROWTH_CAPABILITY);

  // Quien escucha las respuestas del compañero y la llegada de un teléfono (growth/ se suscribe).
  const frameListeners = new Set<(f: GrowthFrame) => void>();
  const helloListeners = new Set<() => void>();
  const fire = <T>(set: Set<(x: T) => void>, x: T) => {
    for (const fn of set) {
      try {
        fn(x);
      } catch (err) {
        console.error("[phone] listener:", err instanceof Error ? err.message : err);
      }
    }
  };

  /**
   * Manda al socket activo lo pendiente. `resend` (al reconectar) incluye lo
   * enviado sin ack — pudo perderse con el socket viejo; el teléfono deduplica
   * por id. Sin `resend` (aviso nuevo, mismo socket) solo sale lo que está en cola.
   */
  async function flushNotices(target: Active, resend: boolean): Promise<number> {
    if (!noticeStore || !canNotify(target)) return 0;
    const sent = await mutateNotices((list) => {
      const out = deliverable(list).filter((n) => resend || n.status === "queued");
      if (active !== target) return { notices: list, out: [] as PhoneNotice[] };
      for (const n of out) {
        send(target.ws, {
          t: "notify",
          id: n.id,
          title: n.title,
          body: n.body,
          source: n.source,
          created_at: n.created_at,
          ...(n.extra ? { kind: n.extra.kind, why: n.extra.why, replies: n.extra.replies, not_after: n.extra.not_after } : {}),
        });
      }
      return { notices: markSent(list, out.map((n) => n.id), now().toISOString()), out };
    }).catch(() => [] as PhoneNotice[]);
    return sent.length;
  }

  function rejectPendingOf(ws: PhoneSocket, error: string): void {
    for (const [id, p] of pending) {
      if (p.ws !== ws) continue;
      clearTimeout(p.timer);
      pending.delete(id);
      p.resolve({ ok: false, error });
    }
  }

  async function handleHello(ws: PhoneSocket, device: PhoneDeviceInfo, capabilities: string[]): Promise<void> {
    const prev = active;
    if (prev && prev.ws !== ws) {
      rejectPendingOf(prev.ws, PHONE_GONE_ERROR);
      try {
        prev.ws.close(4001, "reemplazado");
      } catch {
        /* ya cerrado */
      }
    }
    const nowIso = now().toISOString();
    if (prev && prev.ws !== ws && prev.device.id !== device.id) {
      // El reemplazado se vio por última vez AHORA (su close tardío ya no lo toca).
      const oldId = prev.device.id;
      void mutate((d) => ({ devices: touchDevice(d, oldId, nowIso), out: null })).catch(() => {});
    }
    // Activo YA (antes del disco): un call justo después del hello no debe fallar.
    const mine: Active = { ws, device, capabilities, firstSeen: nowIso, connectedAt: nowIso };
    active = mine;
    let firstSeen = nowIso;
    try {
      firstSeen = await mutate((d) => {
        const r = upsertDevice(d, device, nowIso);
        return { devices: r.devices, out: r.record.first_seen };
      });
    } catch {
      /* sin disco: el welcome lleva "ahora" (el log ya dijo por qué) */
    }
    mine.firstSeen = firstSeen;
    lastTouch = Date.now();
    if (active !== mine) return; // otro hello ganó mientras escribíamos
    send(ws, { t: "welcome", device_id: device.id, first_seen: firstSeen });
    onEvent(`teléfono conectado: ${label(device)}${device.android ? ` · Android ${device.android}` : ""}`);
    // Lo que se acumuló mientras no estaba (con su hora original: el teléfono dice si llegó tarde).
    const n = await flushNotices(mine, true);
    if (n) onEvent(`${n} aviso${n === 1 ? "" : "s"} pendiente${n === 1 ? "" : "s"} entregado${n === 1 ? "" : "s"} al teléfono`);
    if (active === mine) fire(helloListeners as Set<(x: undefined) => void>, undefined);
  }

  return {
    /** Frame de texto entrante de un socket (conectado o no). */
    handleMessage(ws: PhoneSocket, raw: string): void {
      const msg = parsePhoneMessage(raw);
      if (!msg) return;
      if (msg.t === "ping") {
        send(ws, { t: "pong" });
        if (active?.ws === ws && Date.now() - lastTouch > TOUCH_EVERY_MS) {
          lastTouch = Date.now();
          const id = active.device.id;
          const iso = now().toISOString();
          void mutate((d) => ({ devices: touchDevice(d, id, iso), out: null })).catch(() => {});
        }
        return;
      }
      if (msg.t === "hello") {
        void handleHello(ws, msg.device, msg.capabilities);
        return;
      }
      if (msg.t === "ack") {
        if (active?.ws !== ws || !noticeStore) return;
        const iso = now().toISOString();
        void mutateNotices((list) => ({ notices: markAcked(list, msg.id, iso), out: null })).catch(() => {});
        return;
      }
      if (msg.t === "reply" || msg.t === "feedback" || msg.t === "shown" || msg.t === "vetoed" || msg.t === "call_result") {
        // Solo cuenta lo que manda el teléfono activo: un socket viejo no responde por el dueño.
        if (active?.ws === ws) fire(frameListeners, msg);
        return;
      }
      // result: solo cuenta si lo manda el MISMO socket al que se le pidió.
      const p = pending.get(msg.id);
      if (!p || p.ws !== ws) return;
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: msg.error });
    },

    /** Cierre del socket: rechaza lo pendiente y, si era el activo, lo suelta. */
    handleClose(ws: PhoneSocket): void {
      rejectPendingOf(ws, PHONE_GONE_ERROR);
      if (!active || active.ws !== ws) return;
      const gone = active;
      active = null;
      const iso = now().toISOString();
      void mutate((d) => ({ devices: touchDevice(d, gone.device.id, iso), out: null })).catch(() => {});
      onEvent(`teléfono desconectado: ${label(gone.device)}`);
    },

    /** Pide una acción al teléfono activo. Nunca lanza: el error viene en el resultado. */
    callPhone(
      tool: PhoneCapability,
      args: Record<string, unknown> = {},
      callOpts: { timeoutMs?: number } = {},
    ): Promise<PhoneCallResult> {
      const target = active;
      if (!target) return Promise.resolve({ ok: false, error: NO_PHONE_ERROR });
      if (target.capabilities.length && !target.capabilities.includes(tool)) {
        return Promise.resolve({
          ok: false,
          error: `El teléfono conectado no sabe hacer "${tool}" (versión de la app ${target.device.app || "desconocida"}).`,
        });
      }
      const timeoutMs = callOpts.timeoutMs ?? PHONE_DEFAULT_TIMEOUT_MS;
      const id = randomUUID();
      return new Promise<PhoneCallResult>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: `El teléfono no respondió a tiempo (${Math.round(timeoutMs / 1000)} s).` });
        }, timeoutMs);
        pending.set(id, { ws: target.ws, tool, resolve, timer });
        send(target.ws, { t: "call", id, tool, args });
      });
    },

    async status(): Promise<PhoneStatus> {
      if (active) {
        const { device, capabilities, firstSeen, connectedAt } = active;
        return {
          connected: true,
          device: {
            id: device.id,
            model: device.model,
            android: device.android,
            sdk: device.sdk,
            app: device.app,
            capabilities,
            first_seen: firstSeen,
            connected_at: connectedAt,
          },
          last_seen: now().toISOString(),
        };
      }
      const last = lastSeenDevice(await opts.store.load());
      if (!last) return { connected: false };
      return {
        connected: false,
        device: { id: last.id, model: last.model, android: last.android, first_seen: last.first_seen },
        last_seen: last.last_seen,
      };
    },

    isConnected(): boolean {
      return active !== null;
    },

    /**
     * Hermes avisa primero. Nunca lanza: devuelve el aviso con su estado
     * (`dropped` con motivo si se pasó del presupuesto, `queued` si no hay
     * teléfono que sepa mostrarlo, `sent` si salió ya).
     */
    async notify(input: NoticeInput): Promise<PhoneNotice | null> {
      if (!noticeStore) return null;
      try {
        const notice = await mutateNotices((list) => {
          const r = admitNotice(list, input, { id: newId(), nowIso: now().toISOString(), tz, budget: perDay() });
          return { notices: r.notices, out: r.notice };
        });
        if (notice.status === "dropped") {
          onEvent(`aviso descartado (${notice.reason}): ${notice.title}`);
          return notice;
        }
        const target = active;
        if (canNotify(target)) await flushNotices(target, false);
        const list = await noticeStore.load();
        return list.find((n) => n.id === notice.id) ?? notice;
      } catch {
        return null;
      }
    },

    /** Suscribirse a las respuestas del compañero. Devuelve cómo desuscribirse. */
    onFrame(fn: (f: GrowthFrame) => void): () => void {
      frameListeners.add(fn);
      return () => frameListeners.delete(fn);
    },

    /** Avisa cada vez que un teléfono termina de conectarse (para mandarle la llamada agendada). */
    onHello(fn: () => void): () => void {
      helloListeners.add(fn);
      return () => helloListeners.delete(fn);
    },

    /** La próxima llamada semanal (o su cancelación). Solo a una app que anuncia "growth". */
    sendCallSchedule(next: { id: string; at: string; reason: string } | null): boolean {
      const target = active;
      if (!canGrow(target)) return false;
      send(target.ws, next ? { t: "call_schedule", ...next } : { t: "call_cancel" });
      return true;
    },

    /** Estado de los avisos para el dashboard y el QA: presupuesto, usados hoy y los últimos. */
    async notices(limit = 20): Promise<{ per_day: number; used_today: number; items: PhoneNotice[] }> {
      const list = noticeStore ? sweepNotices(await noticeStore.load(), now().toISOString()) : [];
      return {
        per_day: perDay(),
        used_today: usedToday(list, now().toISOString(), tz),
        items: list.slice(-limit).reverse(),
      };
    },

    /** Para los tests: esperar a que el registro termine de escribir. */
    flush(): Promise<unknown> {
      return Promise.all([writes, noticeWrites]);
    },
  };
}

export type PhoneLink = ReturnType<typeof createPhoneLink>;

/** El enlace real: registro en ~/.hermes-os/phone/devices.json + bus de actividad. */
export const phoneLink: PhoneLink = createPhoneLink({
  store: fileDeviceStore(),
  onEvent: (detail) => emit({ kind: "phone", detail }),
  notices: fileNoticeStore(),
  noticesPerDay: () => env.PHONE_NOTICES_PER_DAY,
  tz: env.SCHEDULED_TZ,
});

export const callPhone: PhoneLink["callPhone"] = (tool, args, o) => phoneLink.callPhone(tool, args, o);
