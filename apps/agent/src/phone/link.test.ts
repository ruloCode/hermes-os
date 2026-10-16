import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPhoneLink, NO_PHONE_ERROR, PHONE_GONE_ERROR, type PhoneSocket } from "./link.js";
import { parsePhoneMessage } from "./protocol.js";
import { lastSeenDevice, parseDevices, touchDevice, upsertDevice, type DeviceStore, type PhoneDeviceRecord } from "./registry.js";
import { habitPendingToday, pickNextEvent, pickToday } from "./home.js";
import type { CalendarEvent, HabitToday } from "@hermes/shared";

/**
 * Contrato del canal "cuerpo" con el teléfono: un solo dispositivo activo, el
 * nuevo cierra al viejo con 4001, una llamada pendiente nunca queda colgada
 * cuando el socket se cae, y el registro conserva first_seen.
 */

class FakeSocket implements PhoneSocket {
  sent: any[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string) {
    this.closed = { code, reason };
  }
  last(t: string) {
    return [...this.sent].reverse().find((m) => m.t === t);
  }
}

function memStore(initial: PhoneDeviceRecord[] = []): DeviceStore & { data: PhoneDeviceRecord[] } {
  const s = {
    data: initial,
    async load() {
      return s.data;
    },
    async save(d: PhoneDeviceRecord[]) {
      s.data = d;
    },
  };
  return s;
}

const hello = (id: string, model = "Pixel 8") =>
  JSON.stringify({
    t: "hello",
    device: { id, model, android: "16", sdk: 36, app: "0.1.0" },
    capabilities: ["list_apps", "open_app", "read_screen", "tap", "type", "global", "scroll"],
  });

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("phone link", () => {
  it("sin teléfono, callPhone responde el error en español sin lanzar", async () => {
    const link = createPhoneLink({ store: memStore() });
    assert.deepEqual(await link.callPhone("open_app", { app: "x" }), { ok: false, error: NO_PHONE_ERROR });
  });

  it("hello → welcome con first_seen; call → result de ida y vuelta", async () => {
    const events: string[] = [];
    const store = memStore();
    const link = createPhoneLink({ store, onEvent: (d) => events.push(d) });
    const ws = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    await link.flush();
    await tick();
    const welcome = ws.last("welcome");
    assert.equal(welcome.device_id, "dev-1");
    assert.ok(Date.parse(welcome.first_seen));
    assert.equal(store.data.length, 1);
    assert.ok(events.some((e) => e.includes("conectado")));

    const p = link.callPhone("open_app", { app: "whatsapp" });
    const call = ws.last("call");
    assert.equal(call.tool, "open_app");
    assert.deepEqual(call.args, { app: "whatsapp" });
    link.handleMessage(ws, JSON.stringify({ t: "result", id: call.id, ok: true, data: { opened: { label: "WhatsApp", package: "com.whatsapp" } } }));
    assert.deepEqual(await p, { ok: true, data: { opened: { label: "WhatsApp", package: "com.whatsapp" } } });
  });

  it("un error del teléfono llega tal cual", async () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    const p = link.callPhone("tap", { target: "n3" });
    const call = ws.last("call");
    link.handleMessage(ws, JSON.stringify({ t: "result", id: call.id, ok: false, error: "Negado por el usuario" }));
    assert.deepEqual(await p, { ok: false, error: "Negado por el usuario" });
  });

  it("ping → pong", () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    link.handleMessage(ws, JSON.stringify({ t: "ping" }));
    assert.deepEqual(ws.sent, [{ t: "pong" }]);
  });

  it("un hello desde otro socket reemplaza: el viejo se cierra con 4001 y sus pendientes fallan", async () => {
    let t = Date.parse("2026-10-13T10:00:00Z");
    const store = memStore();
    const link = createPhoneLink({ store, now: () => new Date((t += 1000)) });
    const a = new FakeSocket();
    const b = new FakeSocket();
    link.handleMessage(a, hello("dev-1"));
    const pending = link.callPhone("read_screen", {});
    link.handleMessage(b, hello("dev-2", "Galaxy"));
    assert.deepEqual(a.closed, { code: 4001, reason: "reemplazado" });
    assert.deepEqual(await pending, { ok: false, error: PHONE_GONE_ERROR });
    // El close tardío del viejo no suelta al nuevo.
    link.handleClose(a);
    assert.equal(link.isConnected(), true);
    const st = await link.status();
    assert.equal(st.device?.id, "dev-2");
    await link.flush();
    const old = store.data.find((d) => d.id === "dev-1");
    assert.ok(old && old.last_seen > old.first_seen, "el reemplazado queda con last_seen del reemplazo");
  });

  it("cerrar el socket rechaza lo pendiente de inmediato y deja de estar conectado", async () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    const p = link.callPhone("tap", { target: "Enviar" }, { timeoutMs: 60_000 });
    link.handleClose(ws);
    assert.deepEqual(await p, { ok: false, error: PHONE_GONE_ERROR });
    assert.equal(link.isConnected(), false);
    await link.flush();
    const st = await link.status();
    assert.equal(st.connected, false);
    assert.equal(st.device?.id, "dev-1");
    assert.ok(st.last_seen);
  });

  it("timeout: la llamada se resuelve con error y un result tardío se ignora", async () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    const r = await link.callPhone("list_apps", {}, { timeoutMs: 10 });
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /no respondió/);
    link.handleMessage(ws, JSON.stringify({ t: "result", id: ws.last("call").id, ok: true, data: [] }));
  });

  it("un result de otro socket no resuelve la llamada", async () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    const intruder = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    const p = link.callPhone("open_app", { app: "x" }, { timeoutMs: 30 });
    link.handleMessage(intruder, JSON.stringify({ t: "result", id: ws.last("call").id, ok: true, data: "falso" }));
    assert.equal((await p).ok, false);
  });

  it("una capacidad que el teléfono no anunció no se le pide", async () => {
    const link = createPhoneLink({ store: memStore() });
    const ws = new FakeSocket();
    link.handleMessage(ws, JSON.stringify({ t: "hello", device: { id: "d" }, capabilities: ["open_app"] }));
    const r = await link.callPhone("tap", { target: "n1" });
    assert.equal(r.ok, false);
    assert.equal(ws.last("call"), undefined);
  });

  it("first_seen se conserva entre reconexiones", async () => {
    const store = memStore([{ id: "dev-1", model: "Pixel 8", android: "15", first_seen: "2026-01-01T00:00:00.000Z", last_seen: "2026-01-02T00:00:00.000Z" }]);
    const link = createPhoneLink({ store });
    const ws = new FakeSocket();
    link.handleMessage(ws, hello("dev-1"));
    await link.flush();
    await tick();
    assert.equal(ws.last("welcome").first_seen, "2026-01-01T00:00:00.000Z");
    assert.equal(store.data[0].android, "16");
  });
});

describe("protocolo", () => {
  it("descarta JSON roto, tipos desconocidos y hello sin id", () => {
    assert.equal(parsePhoneMessage("{no"), null);
    assert.equal(parsePhoneMessage(JSON.stringify({ t: "otra" })), null);
    assert.equal(parsePhoneMessage(JSON.stringify({ t: "hello", device: {} })), null);
    assert.equal(parsePhoneMessage(JSON.stringify({ t: "result", ok: true })), null);
  });

  it("un result fallido sin texto lleva un motivo genérico, nunca vacío", () => {
    const r = parsePhoneMessage(JSON.stringify({ t: "result", id: "x", ok: false }));
    assert.ok(r && r.t === "result" && !r.ok && r.error.length > 0);
  });
});

describe("registro", () => {
  it("upsert conserva first_seen y actualiza last_seen; touch ignora desconocidos", () => {
    const a = upsertDevice([], { id: "x", model: "M", android: "15" }, "2026-01-01T00:00:00Z");
    const b = upsertDevice(a.devices, { id: "x", model: "M", android: "16" }, "2026-02-01T00:00:00Z");
    assert.equal(b.record.first_seen, "2026-01-01T00:00:00Z");
    assert.equal(b.record.last_seen, "2026-02-01T00:00:00Z");
    assert.equal(b.devices.length, 1);
    assert.deepEqual(touchDevice(b.devices, "otro", "2027-01-01T00:00:00Z"), b.devices);
  });

  it("lastSeenDevice elige el más reciente y parseDevices descarta filas rotas", () => {
    const devs = parseDevices({
      devices: [
        { id: "a", first_seen: "2026-01-01T00:00:00Z", last_seen: "2026-01-05T00:00:00Z" },
        { id: "b", first_seen: "2026-01-02T00:00:00Z", last_seen: "2026-03-01T00:00:00Z" },
        { model: "sin id" },
        "basura",
      ],
    });
    assert.equal(devs.length, 2);
    assert.equal(lastSeenDevice(devs)?.id, "b");
    assert.equal(lastSeenDevice([]), null);
  });
});

describe("home del teléfono", () => {
  const habit = (p: Partial<HabitToday>): HabitToday => ({
    id: 1,
    name: "Meditar",
    cadence: "daily",
    times_per_week: 1,
    active: true,
    created_at: "",
    done_today: false,
    streak: 0,
    week_count: 0,
    week_dates: [],
    ...p,
  });

  it("un hábito semanal con la cuota cumplida ya no está pendiente", () => {
    assert.equal(habitPendingToday(habit({})), true);
    assert.equal(habitPendingToday(habit({ done_today: true })), false);
    assert.equal(habitPendingToday(habit({ cadence: "weekly", times_per_week: 3, week_count: 3 })), false);
    assert.equal(habitPendingToday(habit({ cadence: "weekly", times_per_week: 3, week_count: 1 })), true);
  });

  it("today: hábitos primero, tareas rellenan, máximo 3", () => {
    const out = pickToday([habit({ name: "A" }), habit({ name: "B", done_today: true })], ["T1", "T2", "T3"]);
    assert.deepEqual(out, [
      { kind: "habit", title: "A" },
      { kind: "task", title: "T1" },
      { kind: "task", title: "T2" },
    ]);
    assert.deepEqual(pickToday([], []), []);
  });

  it("next_event: el más cercano que aún no empezó; sin eventos, null", () => {
    const ev = (title: string, start: string, startsInMin: number, location: string | null = null): CalendarEvent => ({
      id: title,
      title,
      start,
      end: null,
      allDay: false,
      location,
      description: null,
      startsInMin,
    });
    assert.deepEqual(
      pickNextEvent([
        ev("En curso", "2026-10-13T10:00:00Z", -30),
        ev("Luego", "2026-10-13T15:00:00Z", 200),
        ev("Pronto", "2026-10-13T12:00:00Z", 20, "Oficina"),
      ]),
      { title: "Pronto", start: "2026-10-13T12:00:00Z", location: "Oficina" },
    );
    assert.equal(pickNextEvent([]), null);
  });
});
