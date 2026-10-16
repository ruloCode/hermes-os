import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HERMES_MEETING_UPLOADS_DIR = await mkdtemp(join(tmpdir(), "hermes-uploads-"));
const { UploadError, appendChunk, initUpload, safeUploadId } = await import("./uploads.js");

const base = { project: "demo", mime: "audio/aac", filename: "x.aac", durationSec: 60 };

test("el id de la subida no puede escapar de su carpeta", () => {
  assert.equal(safeUploadId("rec-2026-10-08T10-00-00"), "rec-2026-10-08T10-00-00");
  assert.equal(safeUploadId("../../etc"), null);
  assert.equal(safeUploadId("a/b"), null);
  assert.equal(safeUploadId(""), null);
});

test("reanudar: init repetido devuelve lo ya recibido y las partes se encadenan", async () => {
  const id = "rec-resume-1";
  assert.deepEqual(await initUpload({ ...base, id, size: 10 }), { received: 0 });
  assert.equal(await appendChunk(id, 0, Buffer.from("abcd")), 4);
  // El teléfono se reinició: vuelve a preguntar y sigue desde 4.
  assert.equal((await initUpload({ ...base, id, size: 10 })).received, 4);
  assert.equal(await appendChunk(id, 4, Buffer.from("efghij")), 10);
});

test("una parte repetida no duplica bytes; un hueco responde 409 con lo recibido", async () => {
  const id = "rec-dup-1";
  await initUpload({ ...base, id, size: 8 });
  await appendChunk(id, 0, Buffer.from("1234"));
  // Reintento de la MISMA parte (no vio la respuesta): no cambia nada.
  assert.equal(await appendChunk(id, 0, Buffer.from("1234")), 4);
  await assert.rejects(appendChunk(id, 6, Buffer.from("78")), (e: unknown) => {
    assert.ok(e instanceof UploadError);
    assert.equal(e.status, 409);
    assert.equal(e.received, 4);
    return true;
  });
});

test("misma id con otro tamaño no pisa la subida existente", async () => {
  const id = "rec-size-1";
  await initUpload({ ...base, id, size: 5 });
  await assert.rejects(initUpload({ ...base, id, size: 6 }), (e: unknown) => e instanceof UploadError && e.status === 409);
});

test("no se aceptan más bytes que los declarados", async () => {
  const id = "rec-over-1";
  await initUpload({ ...base, id, size: 3 });
  await assert.rejects(appendChunk(id, 0, Buffer.from("1234")), (e: unknown) => e instanceof UploadError && e.status === 400);
});

test("una transcripción sin voz real no cuenta como junta", async () => {
  const { spokenWords, MIN_SPOKEN_WORDS } = await import("./ingest.js");
  assert.ok(spokenWords("**Hablante 0:** Mm-hmm.\n\n**Hablante 1:** (silencio)") < MIN_SPOKEN_WORDS);
  assert.ok(spokenWords("") < MIN_SPOKEN_WORDS);
  const real =
    "**Hablante 0:** Bueno, arrancamos con el alcance del proyecto y lo que falta definir esta semana.\n\n**Hablante 1:** Listo, yo reviso los pagos.";
  assert.ok(spokenWords(real) >= MIN_SPOKEN_WORDS);
});
