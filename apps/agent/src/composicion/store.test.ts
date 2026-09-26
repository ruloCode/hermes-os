import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComposeSession, Passage } from "@hermes/shared";

/**
 * La persistencia de Composición se prueba contra archivos REALES en un
 * directorio temporal: lo que importa es el comportamiento en disco (escritura
 * atómica, candado por sesión, validación). Las rutas se fijan ANTES de
 * importar (env.ts las lee al cargar).
 */

let dir: string;
let store: typeof import("./store.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-store-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios");
  store = await import("./store.js");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

function session(id: string, over: Partial<ComposeSession> = {}): ComposeSession {
  const now = new Date().toISOString();
  return {
    id,
    title: `Prueba ${id}`,
    createdAt: now,
    updatedAt: now,
    source: { path: "/tmp/x.wav", name: "x.wav", bytes: 10, kind: "archivo" },
    mediaDir: join(dir, "medios", id),
    mediaRoot: "local",
    files: {},
    language: "es",
    status: "procesando",
    stages: store.freshStages(),
    speakers: [],
    passages: [],
    ...over,
  };
}

function passage(n: number, group: Passage["group"]): Passage {
  const id = `P${String(n).padStart(2, "0")}`;
  return {
    id,
    label: id,
    start: n * 10,
    end: n * 10 + 5,
    text: "tralo mivena",
    kind: "letra",
    confidence: 0.5,
    group,
    evidence: [],
    origin: "auto",
    status: "pendiente",
  };
}

describe("composición: tablero", () => {
  it("sin board.json devuelve null (la web cae a su mock)", async () => {
    assert.equal(await store.readBoard(), null);
  });

  it("PUT valida: una canción sin tonalidad no se escribe", async () => {
    await assert.rejects(
      store.writeBoard({ songs: [{ id: "s1", title: "x", key: { tonic: "La" }, sections: [] }], refs: [], notebook: [] }),
      /tonalidad/,
    );
    assert.equal(await store.readBoard(), null);
  });

  it("escribe atómico y relee lo mismo (sin .tmp colgando)", async () => {
    const board = await store.writeBoard({
      songs: [{ id: "s1", title: "Sonda", key: { tonic: 9, mode: "minor" }, sections: [] }],
      refs: [],
      notebook: [],
    });
    const again = await store.readBoard();
    assert.equal(again?.songs[0].title, "Sonda");
    assert.equal(again?.updatedAt, board.updatedAt);
    const files = await readdir(join(dir, "estado"));
    assert.deepEqual(files.filter((f) => f.endsWith(".tmp")), []);
  });

  it("updateBoard serializa: diez altas concurrentes no se pisan", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.updateBoard((b) => {
          b.notebook.push({ id: `n${i}`, kind: "frase", text: `vela ${i}`, at: new Date().toISOString() });
        }),
      ),
    );
    assert.equal((await store.readBoard())?.notebook.length, 10);
  });
});

describe("composición: sesiones", () => {
  it("ids con rutas raras no llegan al disco", () => {
    assert.equal(store.isSafeId("2026-09-23-prueba"), true);
    assert.equal(store.isSafeId("../etc"), false);
    assert.equal(store.isSafeId("a/b"), false);
    assert.equal(store.isSafeId(""), false);
    assert.equal(store.isSafeId(".oculta"), false);
  });

  it("alta, lectura y alta duplicada rechazada", async () => {
    await store.createSessionRecord(session("s-alta"));
    assert.equal((await store.readSession("s-alta"))?.title, "Prueba s-alta");
    await assert.rejects(store.createSessionRecord(session("s-alta")), /ya existe/);
  });

  it("el candado por sesión: 25 parches concurrentes llegan todos", async () => {
    await store.createSessionRecord(session("s-candado"));
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        store.patchSession("s-candado", (s) => {
          s.passages.push(passage(i + 1, "probable"));
        }),
      ),
    );
    const s = await store.readSession("s-candado");
    assert.equal(s?.passages.length, 25);
  });

  it("parchar una sesión que no existe lanza NotFound", async () => {
    await assert.rejects(store.patchSession("no-existe", () => {}), store.ComposicionNotFoundError);
  });

  it("la lista es liviana y cuenta probables sin descartados", async () => {
    await store.createSessionRecord(
      session("s-lista", {
        passages: [passage(1, "probable"), passage(2, "dudoso"), passage(3, "descartado")],
        stages: store.freshStages().map((st) =>
          st.stage === "audio" ? { ...st, status: "corriendo" as const, detail: "extrayendo 40 %" } : st,
        ),
      }),
    );
    const list = await store.listSessions();
    const item = list.find((x) => x.id === "s-lista");
    assert.ok(item);
    assert.equal(item.passages, 2);
    assert.equal(item.probable, 1);
    assert.equal(item.stage?.stage, "audio");
    assert.equal("stages" in item, false);
  });
});

describe("composición: transcripción, análisis y letras", () => {
  it("transcripción ida y vuelta", async () => {
    await store.createSessionRecord(session("s-trans"));
    await store.writeTranscript("s-trans", [{ text: "tralo", start: 1, end: 1.4, type: "word", speaker: "speaker_0" }]);
    assert.equal((await store.readTranscript("s-trans"))?.[0].text, "tralo");
  });

  it("un tablero de letras vacío existe sin haber generado nada", async () => {
    const b = await store.readLyrics("s-trans", "P01");
    assert.deepEqual(b.versions, []);
    assert.equal(b.melismaMode, "respetar");
    assert.equal(await store.hasLyrics("s-trans", "P01"), false);
  });

  it("patchLyrics serializa y agrega (no pisa versiones anteriores)", async () => {
    await Promise.all(
      [1, 2, 3].map((n) =>
        store.patchLyrics("s-trans", "P01", (b) => {
          b.versions.push({ id: `v${n}`, angle: `ángulo ${n}`, lines: [], createdAt: "", melismaMode: "respetar" });
        }),
      ),
    );
    const b = await store.readLyrics("s-trans", "P01");
    assert.deepEqual(b.versions.map((v) => v.id).sort(), ["v1", "v2", "v3"]);
    assert.equal(await store.hasLyrics("s-trans", "P01"), true);
  });

  it("un pid con ruta rara no se lee ni se escribe", async () => {
    assert.equal(await store.readAnalysis("s-trans", "../P01"), null);
    await assert.rejects(store.readLyrics("s-trans", "../../x"), store.ComposicionNotFoundError);
  });
});
