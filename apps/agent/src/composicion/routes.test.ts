import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

/**
 * Rutas de Composición montadas en una app Hono aislada (sin levantar el
 * agente): contrato de errores, tablero, archivo con Range y la guarda de
 * rutas. Estado y medios en carpetas temporales, fijadas ANTES de importar.
 */

let dir: string;
let app: Hono;
let store: typeof import("./store.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-routes-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios");
  store = await import("./store.js");
  const { mountComposicionRoutes } = await import("./routes.js");
  app = new Hono();
  mountComposicionRoutes(app);

  const mediaDir = join(dir, "medios", "s-rutas");
  await mkdir(join(mediaDir, "analisis", "P01"), { recursive: true });
  await writeFile(join(mediaDir, "analisis", "P01", "mezcla.wav"), Buffer.alloc(4096, 7));
  await writeFile(join(dir, "fuera.txt"), "secreto");
  const now = new Date().toISOString();
  await store.createSessionRecord({
    id: "s-rutas",
    title: "Rutas",
    createdAt: now,
    updatedAt: now,
    source: { path: join(mediaDir, "crudos", "x.wav"), name: "x.wav", bytes: 1, kind: "archivo" },
    mediaDir,
    mediaRoot: "disco",
    files: {},
    language: "es",
    status: "lista",
    stages: store.freshStages(),
    speakers: [{ id: "speaker_0", name: "Voz 1", seconds: 3, singingSeconds: 0 }],
    passages: [
      {
        id: "P01",
        label: "P01",
        start: 1,
        end: 4,
        text: "tralo mivena",
        kind: "letra",
        confidence: 0.6,
        group: "probable",
        evidence: [],
        origin: "auto",
        status: "pendiente",
      },
    ],
  });
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

const body = (r: Response) => r.json() as Promise<any>;

const json = (payload: unknown) => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

describe("rutas: tablero", () => {
  it("GET sin tablero → 404 {error:'sin tablero'}", async () => {
    const res = await app.request("/composicion/board");
    assert.equal(res.status, 404);
    assert.deepEqual(await body(res), { error: "sin tablero" });
  });

  it("PUT inválido → 400 con motivo; válido → 200 y GET lo devuelve", async () => {
    const bad = await app.request("/composicion/board", json({ songs: "no" }));
    assert.equal(bad.status, 400);
    assert.match((await body(bad)).error, /songs/);
    const ok = await app.request("/composicion/board", json({ songs: [], refs: [], notebook: [] }));
    assert.equal(ok.status, 200);
    const got = await app.request("/composicion/board");
    assert.equal(got.status, 200);
    assert.equal((await body(got)).version, 1);
  });

  it("concurrencia optimista: baseUpdatedAt viejo → 409 con el vigente y NO escribe; el vigente → 200", async () => {
    const song = (title: string) => ({ id: "s-concurrente", title, key: { tonic: 0, mode: "major" }, sections: [] });
    const seen = await body(await app.request("/composicion/board"));
    // Otra pestaña guarda primero (con la base correcta).
    const first = await app.request(
      "/composicion/board",
      json({ songs: [song("desde la pestaña A")], refs: [], notebook: [], baseUpdatedAt: seen.updatedAt }),
    );
    assert.equal(first.status, 200);
    const afterA = await body(first);
    assert.ok(afterA.updatedAt > seen.updatedAt, "cada escritura sella un updatedAt NUEVO");
    assert.equal("baseUpdatedAt" in afterA, false, "la base no se guarda en el tablero");

    // La pestaña B todavía tiene la foto vieja.
    const stale = await app.request(
      "/composicion/board",
      json({ songs: [song("desde la pestaña B")], refs: [], notebook: [], baseUpdatedAt: seen.updatedAt }),
    );
    assert.equal(stale.status, 409);
    const conflict = await body(stale);
    assert.equal(conflict.error, "el tablero cambió");
    assert.equal(conflict.board.updatedAt, afterA.updatedAt);
    assert.equal(conflict.board.songs[0].title, "desde la pestaña A", "el 409 trae el vigente para fusionar");
    assert.equal((await body(await app.request("/composicion/board"))).songs[0].title, "desde la pestaña A", "nada se pisó");

    // Con la base vigente, entra.
    const retry = await app.request(
      "/composicion/board",
      json({ songs: [song("B fusionada")], refs: [], notebook: [], baseUpdatedAt: conflict.board.updatedAt }),
    );
    assert.equal(retry.status, 200);
    assert.equal((await body(retry)).songs[0].title, "B fusionada");
  });

  it("lo que escribe el AGENTE también mueve la base; sin baseUpdatedAt se acepta (compatibilidad)", async () => {
    const seen = await body(await app.request("/composicion/board"));
    await store.updateBoard((b) => void b.notebook.push({ id: "n-agente", kind: "frase", text: "vela", at: seen.updatedAt }));
    const stale = await app.request("/composicion/board", json({ ...seen, baseUpdatedAt: seen.updatedAt }));
    assert.equal(stale.status, 409);
    assert.ok((await body(stale)).board.notebook.some((n: { id: string }) => n.id === "n-agente"));
    const legacy = await app.request("/composicion/board", json({ songs: [], refs: [], notebook: [] }));
    assert.equal(legacy.status, 200);
    const bad = await app.request("/composicion/board", json({ songs: [], refs: [], notebook: [], baseUpdatedAt: 7 }));
    assert.equal(bad.status, 400);
  });

  it("dos escrituras en el mismo milisegundo no comparten sello", async () => {
    const stamps = await Promise.all(
      Array.from({ length: 5 }, () => store.writeBoard({ songs: [], refs: [], notebook: [] }).then((b) => b.updatedAt)),
    );
    assert.equal(new Set(stamps).size, 5);
  });
});

describe("rutas: sesiones", () => {
  it("la lista trae el resumen liviano", async () => {
    const res = await app.request("/composicion/sessions");
    const list = await body(res);
    assert.equal(list[0].id, "s-rutas");
    assert.equal(list[0].probable, 1);
  });

  it("sesión inexistente → 404 {error}", async () => {
    const res = await app.request("/composicion/sessions/nope");
    assert.equal(res.status, 404);
    assert.ok((await body(res)).error);
  });

  it("PATCH renombra una voz; una voz desconocida → 400", async () => {
    const ok = await app.request("/composicion/sessions/s-rutas", {
      ...json({ speakers: [{ id: "speaker_0", name: "Primera" }] }),
      method: "PATCH",
    });
    assert.equal(ok.status, 200);
    assert.equal((await body(ok)).speakers[0].name, "Primera");
    const bad = await app.request("/composicion/sessions/s-rutas", {
      ...json({ speakers: [{ id: "speaker_9", name: "x" }] }),
      method: "PATCH",
    });
    assert.equal(bad.status, 400);
  });

  it("process con etapa inválida → {ok:false} 400; stop sin nada corriendo → 409", async () => {
    const p = await app.request("/composicion/sessions/s-rutas/process", { ...json({ from: "cocinar" }), method: "POST" });
    assert.equal(p.status, 400);
    assert.equal((await body(p)).ok, false);
    const s = await app.request("/composicion/sessions/s-rutas/stop", { method: "POST" });
    assert.equal(s.status, 409);
    assert.equal((await body(s)).ok, false);
  });

  it("análisis que no existe todavía → 404; letras vacías → 200", async () => {
    assert.equal((await app.request("/composicion/sessions/s-rutas/passages/P01")).status, 404);
    const l = await app.request("/composicion/sessions/s-rutas/passages/P01/lyrics");
    assert.equal(l.status, 200);
    assert.deepEqual((await body(l)).versions, []);
  });

  it("transponer sin voz aislada → 404; semitonos fuera de rango → 400", async () => {
    const post = (b: unknown) => app.request("/composicion/sessions/s-rutas/passages/P01/transpose", { ...json(b), method: "POST" });
    assert.equal((await post({ semitones: 2, source: "voz" })).status, 404);
    assert.equal((await post({ semitones: 30, source: "mezcla" })).status, 400);
    const zero = await post({ semitones: 0, source: "mezcla" });
    assert.equal(zero.status, 200);
    assert.equal((await body(zero)).path, "analisis/P01/mezcla.wav");
  });
});

describe("rutas: archivo con Range", () => {
  const url = (p: string) => `/composicion/sessions/s-rutas/file?path=${encodeURIComponent(p)}`;

  it("206 con el tramo pedido", async () => {
    const res = await app.request(url("analisis/P01/mezcla.wav"), { headers: { Range: "bytes=0-9" } });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("Content-Range"), "bytes 0-9/4096");
    assert.equal((await res.arrayBuffer()).byteLength, 10);
  });

  it("escapar de la carpeta → 400", async () => {
    const res = await app.request(url("../../fuera.txt"));
    assert.equal(res.status, 400);
    assert.ok((await body(res)).error);
  });

  it("absoluta → 400; inexistente → 404", async () => {
    assert.equal((await app.request(url(join(dir, "fuera.txt")))).status, 400);
    assert.equal((await app.request(url("analisis/P01/nada.wav"))).status, 404);
  });
});

describe("privacidad: solo red local", () => {
  it("lo que llega por el túnel (cabeceras de Cloudflare) → 403; la red local pasa", async () => {
    const tunnel: Record<string, string>[] = [
      { "cf-connecting-ip": "1.2.3.4" },
      { "cf-ray": "8a1b-BOG" },
      { "cdn-loop": "cloudflare" },
    ];
    for (const h of tunnel) {
      const r = await app.request("/composicion/sessions", { headers: h });
      assert.equal(r.status, 403, JSON.stringify(h));
      assert.match(((await r.json()) as { error: string }).error, /privada/);
    }
    const ok = await app.request("/composicion/sessions");
    assert.equal(ok.status, 200);
  });

  it("GET /composicion/privacy dice qué sale del equipo", async () => {
    const r = await app.request("/composicion/privacy");
    assert.equal(r.status, 200);
    const info = (await r.json()) as { lanOnly: boolean; external: { to: string }[]; local: string[] };
    assert.equal(info.lanOnly, true);
    assert.ok(info.external.some((e) => /Claude/.test(e.to)));
    assert.ok(info.local.length > 0);
  });
});

describe("rutas: temas", () => {
  const req = (method: string, path: string, payload?: unknown) =>
    app.request(path, {
      method,
      ...(payload !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
        : {}),
    });
  let id: string;

  it("POST crea (cuerpo vacío = tema en blanco) y GET lo lista", async () => {
    const blank = await app.request("/composicion/temas", { method: "POST" });
    assert.equal(blank.status, 200);
    const res = await req("POST", "/composicion/temas", { title: "Tema inventado" });
    assert.equal(res.status, 200);
    const tema = await body(res);
    id = tema.id;
    assert.equal(tema.title, "Tema inventado");
    assert.ok(Array.isArray(tema.track.sections) && tema.track.sections.length >= 1);
    const list = await body(await app.request("/composicion/temas"));
    const item = list.find((x: { id: string }) => x.id === id);
    assert.equal(item.takes, 0);
    assert.deepEqual(item.key, tema.track.key);
  });

  it("GET /temas/:id trae el detalle con candidatos y gates; inexistente → 404", async () => {
    const res = await app.request(`/composicion/temas/${id}`);
    assert.equal(res.status, 200);
    const d = await body(res);
    assert.equal(d.tema.id, id);
    assert.deepEqual(d.candidates, []);
    assert.equal(d.gates.length, 6);
    const nope = await app.request("/composicion/temas/no-existe");
    assert.equal(nope.status, 404);
    assert.ok((await body(nope)).error);
  });

  it("PATCH válido mezcla y valida el resultado", async () => {
    const res = await req("PATCH", `/composicion/temas/${id}`, {
      title: "Tema renombrado",
      intent: { about: "una idea inventada", convey: "calma" },
      track: { bpm: 100 },
      stage: "pista",
    });
    assert.equal(res.status, 200);
    const t = await body(res);
    assert.equal(t.title, "Tema renombrado");
    assert.equal(t.intent.about, "una idea inventada");
    assert.equal(t.track.bpm, 100);
    assert.equal(t.stage, "pista");
    assert.ok(t.track.sections.length >= 1, "el merge de track no pierde las secciones");
    assert.ok(t.updatedAt >= t.createdAt);
  });

  it("PATCH inválido → 400 y no escribe nada", async () => {
    for (const bad of [
      { track: { bpm: 500 } },
      { stage: "cocinar" },
      { title: "  " },
      { inventado: 1 },
      { track: { key: { tonic: 13, mode: "minor" } } },
    ]) {
      const res = await req("PATCH", `/composicion/temas/${id}`, bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.ok((await body(res)).error);
    }
    const t = (await body(await app.request(`/composicion/temas/${id}`))).tema;
    assert.equal(t.track.bpm, 100);
    assert.equal(t.title, "Tema renombrado");
    // Vincular una canción que no existe en el tablero → 404.
    assert.equal((await req("PATCH", `/composicion/temas/${id}`, { songId: "cancion-fantasma" })).status, 404);
  });

  it("POST de toma: tema inexistente → 404; sin audio o no-WAV → 400", async () => {
    const form = (audio?: Blob, meta?: string) => {
      const f = new FormData();
      if (audio) f.append("audio", audio, "toma.wav");
      if (meta !== undefined) f.append("meta", meta);
      return f;
    };
    const wavish = new Blob([new Uint8Array(64)], { type: "audio/wav" });
    const nope = await app.request("/composicion/temas/no-existe/takes", { method: "POST", body: form(wavish, "{}") });
    assert.equal(nope.status, 404);
    const noAudio = await app.request(`/composicion/temas/${id}/takes`, { method: "POST", body: form(undefined, "{}") });
    assert.equal(noAudio.status, 400);
    const notWav = await app.request(`/composicion/temas/${id}/takes`, {
      method: "POST",
      body: form(new Blob([new TextEncoder().encode("hola")]), "{}"),
    });
    assert.equal(notWav.status, 400);
    assert.match((await body(notWav)).error, /WAV/);
  });

  it("DELETE → {ok}; después 404", async () => {
    const res = await req("DELETE", `/composicion/temas/${id}`);
    assert.equal(res.status, 200);
    assert.deepEqual(await body(res), { ok: true });
    assert.equal((await app.request(`/composicion/temas/${id}`)).status, 404);
    const again = await req("DELETE", `/composicion/temas/${id}`);
    assert.equal(again.status, 404);
  });

  it("por el túnel también es privado", async () => {
    const r = await app.request("/composicion/temas", { headers: { "cf-connecting-ip": "1.2.3.4" } });
    assert.equal(r.status, 403);
  });
});
