import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CalendarEvent } from "@hermes/shared";
import { createPhoneLink, type PhoneSocket } from "./link.js";
import {
  admitNotice,
  clipBody,
  NOTICE_BODY_MAX,
  dayKey,
  deliverable,
  markAcked,
  markSent,
  memNoticeStore,
  parseNotices,
  sweepNotices,
  usedToday,
  type PhoneNotice,
} from "./notices.js";
import type { DeviceStore, PhoneDeviceRecord } from "./registry.js";
import { agendaLine, statusLine } from "../brief.js";

/**
 * Contrato de los avisos al teléfono: el presupuesto descarta (no encola), lo
 * que llega sin teléfono sale al reconectar UNA vez, el ack es idempotente, lo
 * viejo vence, y una app que no anuncia "notify" nunca recibe un frame que no
 * entiende.
 */

const TZ = "America/Bogota";
const input = (title: string) => ({ title, body: `cuerpo de ${title}`, source: "scheduled" as const });

describe("avisos · lógica pura", () => {
  it("el día se cuenta en la zona del dueño, no en UTC", () => {
    // 2026-10-15 03:00 UTC = 2026-10-14 22:00 en Bogotá.
    assert.equal(dayKey("2026-10-15T03:00:00Z", TZ), "2026-10-14");
  });

  it("el aviso que pasa el presupuesto se descarta con motivo y no cuenta", () => {
    let list: PhoneNotice[] = [];
    const statuses: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const r = admitNotice(list, input(`a${i}`), { id: `n${i}`, nowIso: `2026-10-14T1${i}:00:00Z`, tz: TZ, budget: 3 });
      list = r.notices;
      statuses.push(r.notice.status);
    }
    assert.deepEqual(statuses, ["queued", "queued", "queued", "dropped"]);
    assert.match(list[3].reason ?? "", /presupuesto/);
    assert.equal(usedToday(list, "2026-10-14T20:00:00Z", TZ), 3);
    // Al día siguiente el presupuesto vuelve.
    const next = admitNotice(list, input("mañana"), { id: "n5", nowIso: "2026-10-15T12:00:00Z", tz: TZ, budget: 3 });
    assert.equal(next.notice.status, "queued");
  });

  it("presupuesto 0 = Hermes nunca habla primero", () => {
    const r = admitNotice([], input("x"), { id: "n1", nowIso: "2026-10-14T12:00:00Z", tz: TZ, budget: 0 });
    assert.equal(r.notice.status, "dropped");
  });

  it("se entrega lo que está en cola o enviado sin ack, del más viejo al más nuevo", () => {
    const base = { title: "t", body: "b", source: "agent" as const };
    const list: PhoneNotice[] = [
      { ...base, id: "c", created_at: "2026-10-14T12:00:00Z", status: "sent" },
      { ...base, id: "a", created_at: "2026-10-14T10:00:00Z", status: "queued" },
      { ...base, id: "x", created_at: "2026-10-14T09:00:00Z", status: "acked" },
      { ...base, id: "d", created_at: "2026-10-14T08:00:00Z", status: "dropped" },
    ];
    assert.deepEqual(deliverable(list).map((n) => n.id), ["a", "c"]);
  });

  it("ack es idempotente y no revive un descartado", () => {
    const base = { title: "t", body: "b", source: "agent" as const, created_at: "2026-10-14T10:00:00Z" };
    let list: PhoneNotice[] = [
      { ...base, id: "a", status: "queued" },
      { ...base, id: "d", status: "dropped" },
    ];
    list = markSent(list, ["a"], "2026-10-14T10:00:01Z");
    list = markAcked(list, "a", "2026-10-14T10:00:02Z");
    const again = markAcked(list, "a", "2026-10-14T11:00:00Z");
    assert.equal(again[0].acked_at, "2026-10-14T10:00:02Z");
    assert.equal(markAcked(list, "d", "2026-10-14T10:00:03Z")[1].status, "dropped");
    assert.deepEqual(markAcked(list, "desconocido", "2026-10-14T10:00:03Z"), list);
  });

  it("lo no entregado en 24 h vence; lo de hace más de una semana se olvida", () => {
    const base = { title: "t", body: "b", source: "agent" as const };
    const list: PhoneNotice[] = [
      { ...base, id: "viejo", created_at: "2026-10-13T09:00:00Z", status: "queued" },
      { ...base, id: "reciente", created_at: "2026-10-14T09:00:00Z", status: "queued" },
      { ...base, id: "historia", created_at: "2026-10-01T09:00:00Z", status: "acked" },
    ];
    const out = sweepNotices(list, "2026-10-14T10:00:00Z");
    assert.deepEqual(out.map((n) => [n.id, n.status]), [["viejo", "expired"], ["reciente", "queued"]]);
  });

  it("una fila rota del disco se descarta sin tumbar la cola", () => {
    const ok = { id: "a", title: "t", body: "b", source: "agent", created_at: "2026-10-14T10:00:00Z", status: "queued" };
    const out = parseNotices({ notices: [ok, { id: "b" }, null, { ...ok, id: "c", status: "raro" }] });
    assert.deepEqual(out.map((n) => n.id), ["a"]);
  });
});

class FakeSocket implements PhoneSocket {
  sent: any[] = [];
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  all(t: string) {
    return this.sent.filter((m) => m.t === t);
  }
}

const memDevices = (): DeviceStore => {
  let d: PhoneDeviceRecord[] = [];
  return { load: async () => d, save: async (x) => void (d = x) };
};

const hello = (caps: string[]) =>
  JSON.stringify({ t: "hello", device: { id: "dev-1", model: "S25", android: "16", sdk: 36, app: "0.2.0" }, capabilities: caps });

const CAPS = ["list_apps", "open_app", "read_screen", "tap", "type", "global", "scroll"];
const tick = () => new Promise((r) => setTimeout(r, 5));

function makeLink(perDay = 3) {
  let t = Date.parse("2026-10-14T12:00:00Z");
  let n = 0;
  const notices = memNoticeStore();
  const link = createPhoneLink({
    store: memDevices(),
    notices,
    noticesPerDay: () => perDay,
    tz: TZ,
    now: () => new Date((t += 1000)),
    newId: () => `n${++n}`,
  });
  return { link, notices };
}

describe("avisos · enlace", () => {
  it("con el teléfono conectado, el aviso sale al instante y el ack lo cierra", async () => {
    const { link, notices } = makeLink();
    const ws = new FakeSocket();
    link.handleMessage(ws, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    const notice = await link.notify(input("Brief"));
    assert.equal(notice?.status, "sent");
    const frame = ws.all("notify")[0];
    assert.deepEqual(
      { t: frame.t, id: frame.id, title: frame.title, body: frame.body, source: frame.source },
      { t: "notify", id: "n1", title: "Brief", body: "cuerpo de Brief", source: "scheduled" },
    );
    assert.ok(Date.parse(frame.created_at));
    link.handleMessage(ws, JSON.stringify({ t: "ack", id: "n1" }));
    await link.flush();
    assert.equal(notices.data[0].status, "acked");
  });

  it("sin teléfono queda en cola y sale UNA vez al reconectar, con su hora original", async () => {
    const { link, notices } = makeLink();
    const queued = await link.notify(input("A las 7"));
    assert.equal(queued?.status, "queued");
    const created = notices.data[0].created_at;

    const ws = new FakeSocket();
    link.handleMessage(ws, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    const frames = ws.all("notify");
    assert.equal(frames.length, 1);
    assert.equal(frames[0].created_at, created);

    // Ack perdido + reconexión: se reenvía (el teléfono deduplica por id) — y tras el ack, nunca más.
    const ws2 = new FakeSocket();
    link.handleClose(ws);
    link.handleMessage(ws2, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    assert.equal(ws2.all("notify").length, 1);
    link.handleMessage(ws2, JSON.stringify({ t: "ack", id: "n1" }));
    await link.flush();
    const ws3 = new FakeSocket();
    link.handleClose(ws2);
    link.handleMessage(ws3, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    assert.equal(ws3.all("notify").length, 0);
  });

  it("una app que no anuncia notify no recibe el frame: el aviso espera en cola", async () => {
    const { link } = makeLink();
    const ws = new FakeSocket();
    link.handleMessage(ws, hello(CAPS));
    await link.flush();
    await tick();
    const notice = await link.notify(input("x"));
    assert.equal(notice?.status, "queued");
    assert.equal(ws.all("notify").length, 0);
  });

  it("el cuarto aviso del día con presupuesto 3 no llega y queda registrado", async () => {
    const { link } = makeLink(3);
    const ws = new FakeSocket();
    link.handleMessage(ws, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    for (const t of ["1", "2", "3", "4"]) await link.notify(input(t));
    assert.equal(ws.all("notify").length, 3);
    const st = await link.notices();
    assert.equal(st.used_today, 3);
    assert.equal(st.items[0].status, "dropped");
  });

  it("un ack de otro socket se ignora", async () => {
    const { link, notices } = makeLink();
    const ws = new FakeSocket();
    link.handleMessage(ws, hello([...CAPS, "notify"]));
    await link.flush();
    await tick();
    await link.notify(input("x"));
    link.handleMessage(new FakeSocket(), JSON.stringify({ t: "ack", id: "n1" }));
    await link.flush();
    assert.equal(notices.data[0].status, "sent");
  });
});

describe("brief · agenda de hoy", () => {
  const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
    id: o.title ?? "e",
    title: "Evento",
    start: "2026-10-14T15:00:00Z",
    end: null,
    allDay: false,
    location: null,
    description: null,
    startsInMin: 0,
    ...o,
  });
  const now = "2026-10-14T12:00:00Z"; // 7:00 a. m. en Bogotá

  it("solo lo de hoy que no terminó, en orden, con lugar", () => {
    const line = agendaLine(
      [
        ev({ title: "Junta", start: "2026-10-14T20:00:00Z", location: "Calle 93" }),
        ev({ title: "Daily", start: "2026-10-14T14:00:00Z" }),
        ev({ title: "Mañana", start: "2026-10-15T14:00:00Z" }),
        ev({ title: "Ya pasó", start: "2026-10-14T11:00:00Z", end: "2026-10-14T11:30:00Z" }),
      ],
      now,
      TZ,
    );
    assert.ok(line);
    assert.match(line!, /^Agenda de hoy: /);
    assert.ok(line!.indexOf("Daily") < line!.indexOf("Junta"));
    assert.match(line!, /Junta \(Calle 93\)/);
    assert.doesNotMatch(line!, /Mañana|Ya pasó/);
  });

  it("el evento que acabó el día anterior en UTC pero es de hoy en Bogotá cuenta", () => {
    // 2026-10-15 02:00 UTC = 2026-10-14 21:00 en Bogotá.
    const line = agendaLine([ev({ title: "Noche", start: "2026-10-15T02:00:00Z" })], now, TZ);
    assert.match(line ?? "", /Noche/);
  });

  it("sin eventos no inventa un día libre", () => {
    assert.equal(agendaLine([], now, TZ), null);
  });
});

describe("brief · estado de un proyecto", () => {
  it("salta la cabecera del callout y toma el texto real", () => {
    assert.equal(statusLine("> [!note] Hermes · 2026-07-06 (git verificado)\n> Registro clínico a medias."), "Registro clínico a medias");
  });
  it("quita viñetas y el punto final (la plantilla pone el suyo)", () => {
    assert.equal(statusLine("- 2026-07-26 — Proyecto creado. Pendiente entrevista.."), "2026-07-26 — Proyecto creado. Pendiente entrevista");
  });
  it("solo una cabecera, o vacío = sin estado", () => {
    assert.equal(statusLine("> [!note] Hermes · 2026-09-16"), "");
    assert.equal(statusLine(""), "");
  });
});

describe("avisos · cuerpo largo", () => {
  it("corta en un salto de línea, no a mitad de palabra, y avisa que se recortó", () => {
    const body = Array.from({ length: 400 }, (_, i) => `Línea ${i} con su texto`).join("\n");
    const out = clipBody(body);
    assert.ok(out.length <= NOTICE_BODY_MAX);
    assert.match(out, /_\(recortado\)_$/);
    assert.match(out.split("\n\n_(recortado)_")[0], /texto$/);
  });
  it("un cuerpo corto pasa intacto", () => {
    assert.equal(clipBody("  hola  "), "hola");
  });
});
