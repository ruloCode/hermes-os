import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Medios de Composición: lo que protege el disco (rutas dentro de la carpeta
 * de la sesión), lo que el <video> necesita (Range/206/416), los args exactos
 * de la transposición y la detección de cámaras por DCIM — todo con carpetas
 * temporales y archivos falsos, sin tocar el disco real.
 */

let dir: string;
let media: typeof import("./media.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-media-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "raiz");
  media = await import("./media.js");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("parseRange", () => {
  it("tramo cerrado, abierto y sufijo", () => {
    assert.deepEqual(media.parseRange("bytes=0-99", 1000), { kind: "range", start: 0, end: 99 });
    assert.deepEqual(media.parseRange("bytes=500-", 1000), { kind: "range", start: 500, end: 999 });
    assert.deepEqual(media.parseRange("bytes=-100", 1000), { kind: "range", start: 900, end: 999 });
  });

  it("el final se recorta al tamaño (el browser pide de más)", () => {
    assert.deepEqual(media.parseRange("bytes=900-5000", 1000), { kind: "range", start: 900, end: 999 });
    assert.deepEqual(media.parseRange("bytes=-5000", 1000), { kind: "range", start: 0, end: 999 });
  });

  it("imposibles → 416", () => {
    assert.equal(media.parseRange("bytes=1000-", 1000).kind, "unsatisfiable");
    assert.equal(media.parseRange("bytes=50-10", 1000).kind, "unsatisfiable");
    assert.equal(media.parseRange("bytes=-0", 1000).kind, "unsatisfiable");
  });

  it("sin header, multi-rango o basura → se sirve completo", () => {
    assert.equal(media.parseRange(undefined, 1000).kind, "none");
    assert.equal(media.parseRange("bytes=0-1,5-9", 1000).kind, "none");
    assert.equal(media.parseRange("items=0-1", 1000).kind, "none");
    assert.equal(media.parseRange("bytes=-", 1000).kind, "none");
  });
});

describe("resolveMediaFile: nada sale de la carpeta de la sesión", () => {
  let sess: string;
  before(async () => {
    sess = join(dir, "raiz", "s1");
    await mkdir(join(sess, "analisis", "P01"), { recursive: true });
    await writeFile(join(sess, "analisis", "P01", "mezcla.wav"), "RIFF");
    await writeFile(join(dir, "secreto.txt"), "no");
    // Symlink que ESCAPA y symlink que se queda adentro.
    await symlink(join(dir, "secreto.txt"), join(sess, "fuga.txt"));
    await symlink(join(sess, "analisis", "P01", "mezcla.wav"), join(sess, "atajo.wav"));
  });

  it("una ruta relativa válida resuelve al archivo real", async () => {
    const p = await media.resolveMediaFile(sess, "analisis/P01/mezcla.wav");
    assert.match(p, /analisis\/P01\/mezcla\.wav$/);
  });

  it("rechaza .. , absolutas, ~ y NUL", async () => {
    for (const bad of ["../secreto.txt", "analisis/../../secreto.txt", "/etc/passwd", "~/x", "a\0b", ""]) {
      await assert.rejects(media.resolveMediaFile(sess, bad), (e: unknown) => {
        assert.ok(e instanceof media.FileAccessError, `debió rechazar ${JSON.stringify(bad)}`);
        assert.equal((e as InstanceType<typeof media.FileAccessError>).status, 400);
        return true;
      });
    }
  });

  it("un symlink que escapa → 403; uno interno vale", async () => {
    await assert.rejects(media.resolveMediaFile(sess, "fuga.txt"), (e: unknown) => {
      assert.equal((e as InstanceType<typeof media.FileAccessError>).status, 403);
      return true;
    });
    assert.match(await media.resolveMediaFile(sess, "atajo.wav"), /mezcla\.wav$/);
  });

  it("lo que no existe → 404; una carpeta no es un archivo", async () => {
    await assert.rejects(media.resolveMediaFile(sess, "nada.wav"), (e: unknown) => {
      assert.equal((e as InstanceType<typeof media.FileAccessError>).status, 404);
      return true;
    });
    await assert.rejects(media.resolveMediaFile(sess, "analisis"), (e: unknown) => {
      assert.equal((e as InstanceType<typeof media.FileAccessError>).status, 400);
      return true;
    });
  });
});

describe("fileResponse: Range para el <video>", () => {
  let file: string;
  before(async () => {
    file = join(dir, "clip.mp4");
    await writeFile(file, Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256)));
  });

  it("206 con Content-Range y solo los bytes pedidos", async () => {
    const res = await media.fileResponse(file, "bytes=10-19");
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("Content-Range"), "bytes 10-19/1000");
    assert.equal(res.headers.get("Content-Length"), "10");
    assert.equal(res.headers.get("Accept-Ranges"), "bytes");
    assert.equal(res.headers.get("Content-Type"), "video/mp4");
    const body = new Uint8Array(await res.arrayBuffer());
    assert.deepEqual([...body], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it("sin Range: 200 completo anunciando Accept-Ranges", async () => {
    const res = await media.fileResponse(file, null);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("Accept-Ranges"), "bytes");
    assert.equal((await res.arrayBuffer()).byteLength, 1000);
  });

  it("fuera del archivo: 416 con bytes */tamaño", async () => {
    const res = await media.fileResponse(file, "bytes=2000-");
    assert.equal(res.status, 416);
    assert.equal(res.headers.get("Content-Range"), "bytes */1000");
  });
});

describe("transposición del audio real", () => {
  it("+12 = doble de frecuencia y la mitad de tempo para compensar", () => {
    const args = media.transposeArgs("in.wav", "out.wav", 12, 44100);
    assert.deepEqual(args, [
      "-i",
      "in.wav",
      "-af",
      "asetrate=44100*2.000000,aresample=44100,atempo=0.500000",
      "-c:a",
      "pcm_s16le",
      "out.wav",
    ]);
  });

  it("−5 st: factor 2^(−5/12) y su inverso en atempo", () => {
    const af = media.transposeArgs("a", "b", -5, 48000)[3];
    assert.equal(af, "asetrate=48000*0.749154,aresample=48000,atempo=1.334840");
  });

  it("fuera de rango o fraccionario se rechaza", () => {
    assert.throws(() => media.transposeArgs("a", "b", 13, 44100), /rango/);
    assert.throws(() => media.transposeArgs("a", "b", 1.5, 44100), /rango/);
  });

  it("el nombre del render lleva el signo", () => {
    assert.equal(media.transposedName("voz", 2), "voz_+2.wav");
    assert.equal(media.transposedName("mezcla", -3), "mezcla_-3.wav");
  });
});

describe("detectCameras: volúmenes con DCIM", () => {
  let vols: string;
  before(async () => {
    vols = join(dir, "Volumes");
    const clips = join(vols, "SD_1", "DCIM", "100CAM");
    await mkdir(clips, { recursive: true });
    await writeFile(join(clips, "VIEJO.MP4"), "x");
    await writeFile(join(clips, "NUEVO.MOV"), "x");
    await writeFile(join(clips, "._NUEVO.MOV"), "x"); // AppleDouble de exFAT
    await writeFile(join(clips, "notas.txt"), "x");
    const old = new Date("2026-01-01T00:00:00Z");
    await utimes(join(clips, "VIEJO.MP4"), old, old);
    await mkdir(join(vols, "Backup", "fotos"), { recursive: true }); // sin DCIM
    await mkdir(join(vols, "SD_2", "DCIM", "vacio"), { recursive: true }); // DCIM sin videos
  });

  it("lista solo volúmenes con videos en DCIM, lo más reciente primero, sin ._", async () => {
    const cams = await media.detectCameras(vols);
    assert.equal(cams.length, 1);
    assert.equal(cams[0].volume, join(vols, "SD_1"));
    assert.equal(cams[0].dir, join(vols, "SD_1", "DCIM", "100CAM"));
    assert.deepEqual(
      cams[0].files.map((f) => f.name),
      ["NUEVO.MOV", "VIEJO.MP4"],
    );
    assert.ok(cams[0].files.every((f) => f.kind === "video"));
  });

  it("sin /Volumes legible → lista vacía (no revienta)", async () => {
    assert.deepEqual(await media.detectCameras(join(dir, "no-existe")), []);
  });
});

describe("raíz de medios y adopción", () => {
  it("un archivo en <raíz>/<carpeta>/crudos/ se adopta sin copiar", async () => {
    const crudos = join(dir, "raiz", "2026-01-02-ensayo", "crudos");
    await mkdir(crudos, { recursive: true });
    await writeFile(join(crudos, "CLIP.MP4"), "x");
    const a = await media.adoptableFolder(join(crudos, "CLIP.MP4"));
    assert.equal(a?.folder, "2026-01-02-ensayo");
    assert.equal(a?.kind, "disco");
  });

  it("fuera de crudos/ o fuera de la raíz no se adopta", async () => {
    await writeFile(join(dir, "raiz", "suelto.mp4"), "x");
    assert.equal(await media.adoptableFolder(join(dir, "raiz", "suelto.mp4")), null);
    assert.equal(await media.adoptableFolder(join(dir, "clip.mp4")), null);
  });

  it("la raíz configurada fuera de /Volumes cuenta como conectada si su carpeta madre existe", () => {
    const r = media.mediaRoot();
    assert.equal(r.kind, "disco");
    assert.equal(r.root, join(dir, "raiz"));
  });
});

describe("separación reanudable", () => {
  it("isSeparated: voz.wav + stems.json sin error; con error o sin voz, no", async () => {
    const p = join(dir, "sep", "analisis", "P01");
    await mkdir(p, { recursive: true });
    assert.equal(await media.isSeparated(p), false);
    await writeFile(join(p, "voz.wav"), "x");
    assert.equal(await media.isSeparated(p), false, "sin stems.json no cuenta");
    await writeFile(join(p, "stems.json"), JSON.stringify({ error: "falló" }));
    assert.equal(await media.isSeparated(p), false, "un stems.json con error se reintenta");
    await writeFile(join(p, "stems.json"), JSON.stringify({ tuningCents: -19, at: "x" }));
    assert.equal(await media.isSeparated(p), true);
  });

  it("cleanOrphanSepInputs borra solo las entradas del separador", async () => {
    const root = join(dir, "sep2");
    for (const id of ["P01", "P02", "P03"]) await mkdir(join(root, "analisis", id), { recursive: true });
    await writeFile(join(root, "analisis", "P01", media.SEP_INPUT), "x");
    await writeFile(join(root, "analisis", "P02", media.SEP_INPUT), "x");
    await writeFile(join(root, "analisis", "P02", "voz.wav"), "x");
    assert.equal(await media.cleanOrphanSepInputs(root), 2);
    assert.equal(await media.isSeparated(join(root, "analisis", "P02")), false);
    const { existsSync } = await import("node:fs");
    assert.ok(existsSync(join(root, "analisis", "P02", "voz.wav")), "los stems no se tocan");
    assert.equal(await media.cleanOrphanSepInputs(join(dir, "no-existe")), 0, "disco desmontado: nada");
  });
});
