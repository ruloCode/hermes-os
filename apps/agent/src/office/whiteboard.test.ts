import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Archivo temporal: el test no toca la pizarra real.
process.env.HERMES_WHITEBOARD_PATH = join(mkdtempSync(join(tmpdir(), "pizarra-")), "pizarra.png");

// 1×1 PNG transparente.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("pizarra de la oficina", () => {
  let wb: typeof import("./whiteboard.js");
  before(async () => {
    wb = await import("./whiteboard.js");
  });

  it("sin archivo no hay imagen", async () => {
    assert.deepEqual(await wb.readWhiteboard(), { image: null, updatedAt: null });
  });

  it("guarda y devuelve el mismo PNG", async () => {
    const res = await wb.writeWhiteboard(PNG);
    assert.equal(res.ok, true);
    assert.equal((await wb.readWhiteboard()).image, PNG);
  });

  it("rechaza lo que no es PNG", async () => {
    assert.equal((await wb.writeWhiteboard("data:image/jpeg;base64,/9j/4AAQ")).ok, false);
    assert.equal((await wb.writeWhiteboard("data:image/png;base64,aGVsbG8gbXVuZG8=")).ok, false);
  });
});
