/**
 * Contratos de Hermes Phone como cliente de la junta EN VIVO: roles del WS,
 * saneo de `client`, índice durable sesión→acta y la decisión del job que
 * completa la junta con el archivo del teléfono.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = await mkdtemp(join(tmpdir(), "hermes-live-phone-"));
process.env.HERMES_LIVE_INDEX_PATH = join(tmp, "live-sessions.json");
process.env.HERMES_MEETING_UPLOADS_DIR = join(tmp, "uploads");

const { LiveClientSet, clientsChanged, parseClientKind, parseClientRole } = await import(
  "./live-clients.js"
);
const { claimCompletion, getLiveOutcome, recordLiveOutcome, releaseCompletion } = await import(
  "./live-index.js"
);
const { GAP_REINGEST_MS, LIVE_WAIT_TIMEOUT_MS, planLiveCompletion } = await import(
  "./live-completion-plan.js"
);

// ── Roles del WS ───────────────────────────────────────────────────────

test("un audio nuevo desplaza SOLO al audio anterior, nunca a los viewers", () => {
  const set = new LiveClientSet<string>();
  assert.deepEqual(set.add("web", { role: "audio", client: "web" }), []);
  assert.deepEqual(set.add("tablet", { role: "viewer", client: "web" }), []);
  const displaced = set.add("phone", { role: "audio", client: "phone" });
  assert.deepEqual(displaced, ["web"]);
  assert.deepEqual(set.all().sort(), ["phone", "tablet"]);
  assert.deepEqual(set.summary(), { audioClient: "phone", viewers: 1 });
});

test("un viewer nunca desplaza a nadie, ni siquiera a otro viewer", () => {
  const set = new LiveClientSet<string>();
  set.add("phone", { role: "audio", client: "phone" });
  set.add("v1", { role: "viewer", client: "web" });
  assert.deepEqual(set.add("v2", { role: "viewer", client: "phone" }), []);
  assert.equal(set.size, 3);
  assert.deepEqual(set.summary(), { audioClient: "phone", viewers: 2 });
});

test("el binario de un viewer (o de un audio ya desplazado) no llega al STT", () => {
  const set = new LiveClientSet<string>();
  set.add("web", { role: "audio", client: "web" });
  set.add("viewer", { role: "viewer", client: "phone" });
  assert.equal(set.canSendAudio("web"), true);
  assert.equal(set.canSendAudio("viewer"), false);
  set.add("phone", { role: "audio", client: "phone" });
  assert.equal(set.canSendAudio("web"), false, "el desplazado ya no manda aunque su close llegue tarde");
  assert.equal(set.canSendAudio("phone"), true);
  assert.equal(set.remove("web"), false, "su close tardío no saca a nadie");
});

test("sin dueño del audio el resumen lo dice; el evento clients solo sale si algo cambió", () => {
  const set = new LiveClientSet<string>();
  set.add("v", { role: "viewer", client: "web" });
  const before = set.summary();
  assert.deepEqual(before, { audioClient: undefined, viewers: 1 });
  set.add("a", { role: "audio", client: "phone" });
  assert.equal(clientsChanged(before, set.summary()), true);
  assert.equal(clientsChanged(set.summary(), set.summary()), false);
});

test("saneo de role y client: lo desconocido cae al default (audio + web)", () => {
  assert.equal(parseClientRole("viewer"), "viewer");
  assert.equal(parseClientRole(undefined), "audio");
  assert.equal(parseClientRole("admin"), "audio");
  assert.equal(parseClientKind("phone"), "phone");
  assert.equal(parseClientKind(" Phone "), "phone");
  assert.equal(parseClientKind(undefined), "web");
  assert.equal(parseClientKind("ios"), "web");
  assert.equal(parseClientKind(42), "web");
});

// ── Índice durable sesión → acta ───────────────────────────────────────

test("el índice recuerda el acta de cada sesión y fusiona escrituras", async () => {
  await recordLiveOutcome("abc12345", { status: "pending", project: "demo", coachMode: "junta" });
  await recordLiveOutcome("abc12345", { status: "done", meetingId: "2026-10-14-1200-x", project: "demo" });
  const e = await getLiveOutcome("abc12345");
  assert.equal(e?.status, "done");
  assert.equal(e?.meetingId, "2026-10-14-1200-x");
  assert.equal(e?.coachMode, "junta", "lo anterior se conserva");
  assert.equal(await getLiveOutcome("nadaaaaa"), undefined);
});

test("escrituras concurrentes no se pisan", async () => {
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      recordLiveOutcome(`conc-${i}`, { status: "done", meetingId: `m-${i}` }),
    ),
  );
  for (let i = 0; i < 8; i++) assert.equal((await getLiveOutcome(`conc-${i}`))?.meetingId, `m-${i}`);
});

test("una sola completación por sesión: el segundo complete recibe el job del primero", async () => {
  assert.equal(await claimCompletion("sess0001", "job-a"), "job-a");
  assert.equal(await claimCompletion("sess0001", "job-b"), "job-a");
  assert.equal(await claimCompletion("sess0001", "job-a"), "job-a");
  assert.equal(await claimCompletion("sess0002", "job-b"), "job-b");
});

test("si el job no llegó a nacer, el reclamo se suelta (y solo el dueño lo suelta)", async () => {
  assert.equal(await claimCompletion("sess0003", "job-x"), "job-x");
  await releaseCompletion("sess0003", "job-otro");
  assert.equal(await claimCompletion("sess0003", "job-y"), "job-x");
  await releaseCompletion("sess0003", "job-x");
  assert.equal(await claimCompletion("sess0003", "job-y"), "job-y");
});

// ── Decisión del job de completación ───────────────────────────────────

const base = { orphanSnapshot: false, gapMs: 0, waitedMs: 0 };

test("sesión aún viva o ingestando → espera; pasado el tope → junta nueva", () => {
  for (const status of ["live", "stopping", "ingesting"] as const) {
    assert.equal(planLiveCompletion({ ...base, session: { status } }).action, "wait");
  }
  const late = planLiveCompletion({
    ...base,
    session: { status: "ingesting" },
    waitedMs: LIVE_WAIT_TIMEOUT_MS,
  });
  assert.equal(late.action, "new_meeting");
});

test("acta lista y hueco < 3 s → adjuntar a ESA acta (cero STT)", () => {
  const p = planLiveCompletion({
    ...base,
    session: { status: "done", meetingId: "m1" },
    gapMs: GAP_REINGEST_MS - 1,
  });
  assert.deepEqual(p, { action: "attach", meetingId: "m1" });
});

test("acta lista y hueco ≥ 3 s → re-ingestar sobre el MISMO meetingId", () => {
  const p = planLiveCompletion({ ...base, session: { status: "done", meetingId: "m1" }, gapMs: 3_000 });
  assert.deepEqual(p, { action: "reingest", meetingId: "m1" });
});

test("el agente olvidó la sesión (10 min o reinicio): manda el índice durable", () => {
  const p = planLiveCompletion({
    ...base,
    indexed: { status: "done", meetingId: "m2" },
    gapMs: 12_000,
  });
  assert.deepEqual(p, { action: "reingest", meetingId: "m2" });
});

test("clase de inglés: con hueco solo se adjunta y se dice por qué", () => {
  const p = planLiveCompletion({
    ...base,
    indexed: { status: "done", meetingId: "english-7", coachMode: "clase-ingles" },
    gapMs: 9_000,
  });
  assert.equal(p.action, "attach");
  assert.ok(p.action === "attach" && p.meetingId === "english-7" && /no se re-ingesta/.test(p.note ?? ""));
});

test("sin acta (junta corta / fallida) o sesión desconocida → flujo normal", () => {
  assert.equal(planLiveCompletion({ ...base, session: { status: "error" } }).action, "new_meeting");
  assert.equal(planLiveCompletion({ ...base, indexed: { status: "error" } }).action, "new_meeting");
  assert.equal(planLiveCompletion(base).action, "new_meeting");
});

test("ingesta pendiente del recover del boot → espera (no duplica la junta)", () => {
  assert.equal(planLiveCompletion({ ...base, indexed: { status: "pending" } }).action, "wait");
  assert.equal(
    planLiveCompletion({ ...base, session: { status: "error" }, orphanSnapshot: true }).action,
    "wait",
  );
});

test("un gap inválido no fuerza re-ingesta", () => {
  const p = planLiveCompletion({ ...base, session: { status: "done", meetingId: "m1" }, gapMs: NaN });
  assert.equal(p.action, "attach");
});

// ── Subida: campos nuevos ──────────────────────────────────────────────

test("la subida valida liveSessionId y gapMs, y un init repetido actualiza el gap", async () => {
  const { UploadError, initUpload } = await import("./uploads.js");
  const up = { project: "demo", mime: "audio/aac", filename: "x.aac", durationSec: 60, size: 10 };
  await assert.rejects(
    initUpload({ ...up, id: "rec-live-bad1", liveSessionId: "../x" }),
    (e: unknown) => e instanceof UploadError && e.status === 400,
  );
  await assert.rejects(
    initUpload({ ...up, id: "rec-live-bad2", liveSessionId: "abcd1234", gapMs: -5 }),
    (e: unknown) => e instanceof UploadError && e.status === 400,
  );
  await initUpload({ ...up, id: "rec-live-ok", client: "phone", liveSessionId: "abcd1234", gapMs: 0 });
  await initUpload({ ...up, id: "rec-live-ok", client: "phone", liveSessionId: "abcd1234", gapMs: 4200 });
  const { readFile } = await import("node:fs/promises");
  const meta = JSON.parse(await readFile(join(tmp, "uploads", "rec-live-ok", "meta.json"), "utf8"));
  assert.equal(meta.gapMs, 4200);
  assert.equal(meta.client, "phone");
  assert.equal(meta.liveSessionId, "abcd1234");
});

test("el bloque ## de un acta se extrae completo (con sus ###) para conservarlo", async () => {
  const { extractH2Block } = await import("./store.js");
  const md = `# T\n\n## Resumen\nx\n\n## Repaso\n\n### Ventanas para aportar (2)\n\n- a\n\n### Para estudiar\n\n- b\n\n## Transcripción\nhola\n`;
  const block = extractH2Block(md, /Repaso/);
  assert.ok(block.startsWith("## Repaso"));
  assert.ok(block.includes("### Para estudiar"));
  assert.ok(!block.includes("Transcripción"));
  assert.equal(extractH2Block(md, /Sugerencias en vivo/), "");
});

test("una junta SIN «soy yo» se puede escribir: el coach con llaves undefined no rompe el YAML", async () => {
  const { yamlSafe } = await import("./store.js");
  const matter = (await import("gray-matter")).default;
  // Lo que llegaba al acta de una junta presencial sin marcar quién eres (el caso típico del teléfono).
  const fm = {
    titulo: "Junta",
    coach: { metrics: { atMs: 1, bySpeaker: { A: { talkMs: 1, words: 1, wpm: 60, fillers: 0 } }, selfSpeaker: undefined }, performance: undefined },
    lista: [1, undefined, 2],
  };
  assert.throws(() => matter.stringify("cuerpo", fm), /unacceptable kind/, "sin limpiar, gray-matter lanza y el acta se pierde");
  const out = matter.stringify("cuerpo", yamlSafe(fm));
  const back = matter(out).data;
  assert.equal(back.titulo, "Junta");
  assert.deepEqual(back.coach.metrics.bySpeaker.A.wpm, 60, "lo que sí tiene valor se conserva");
  assert.equal("selfSpeaker" in back.coach.metrics, false);
  assert.deepEqual(back.lista, [1, 2]);
});
