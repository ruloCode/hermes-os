import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * ffmpeg/ffprobe procesan archivos NO confiables (una tarjeta, lo que suba el
 * navegador): su entorno no puede traer las claves del .env. Se prueba de
 * verdad: FFMPEG_BIN apunta a un ffmpeg FALSO (un script que vuelca su
 * entorno a un archivo) y al lado vive un ffprobe falso igual. Claves
 * inventadas; nada sale del equipo.
 */

const SECRETS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: "secreto-supabase-de-prueba",
  OPENAI_API_KEY: "secreto-openai-de-prueba",
  ELEVENLABS_API_KEY: "secreto-eleven-de-prueba",
  LINEAR_API_KEY: "secreto-linear-de-prueba",
  HERMES_API_KEY: "secreto-hermes-de-prueba",
  ANTHROPIC_API_KEY: "secreto-anthropic-de-prueba",
  ASSEMBLYAI_API_KEY: "secreto-assembly-de-prueba",
};

let dir: string;
let dumps: string;
let media: typeof import("./media.js");

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-env-"));
  dumps = join(dir, "entornos");
  await mkdir(dumps, { recursive: true });
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "ffmpeg"), `#!/bin/sh\n/usr/bin/env > "${dumps}/ffmpeg.$$.env"\nexit 0\n`);
  await writeFile(join(bin, "ffprobe"), `#!/bin/sh\n/usr/bin/env > "${dumps}/ffprobe.$$.env"\necho '{}'\n`);
  await chmod(join(bin, "ffmpeg"), 0o755);
  await chmod(join(bin, "ffprobe"), 0o755);
  process.env.FFMPEG_BIN = join(bin, "ffmpeg");
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.COMPOSICION_MEDIA_ROOT = join(dir, "medios");
  Object.assign(process.env, SECRETS);
  media = await import("./media.js");
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function envsOf(prefix: string): Promise<string[]> {
  const files = (await readdir(dumps)).filter((f) => f.startsWith(prefix));
  return Promise.all(files.map((f) => readFile(join(dumps, f), "utf8")));
}

describe("medios: los procesos hijo no heredan las claves", () => {
  it("toolEnv: PATH sí; ninguna clave del .env, ni la de Anthropic; `extra` explícito sí", () => {
    const e = media.toolEnv({ PYTHONUNBUFFERED: "1" });
    assert.ok(e.PATH, "PATH para que el binario encuentre lo suyo");
    for (const k of Object.keys(SECRETS)) assert.equal(e[k], undefined, `${k} no debe pasar`);
    assert.equal(e.PYTHONUNBUFFERED, "1");
  });

  it("ffmpeg (runFfmpeg y decodePcm) y ffprobe corren con el entorno saneado", async () => {
    assert.equal(media.FFMPEG, join(dir, "bin", "ffmpeg"), "el ffmpeg falso");
    const input = join(dir, "entrada.wav");
    await writeFile(input, Buffer.alloc(64));
    await media.runFfmpeg(["-i", input, join(dir, "salida.wav")]);
    await media.decodePcm(input);
    await media.probeMedia(input);

    const ffmpegEnvs = await envsOf("ffmpeg.");
    const ffprobeEnvs = await envsOf("ffprobe.");
    assert.equal(ffmpegEnvs.length, 2, "runFfmpeg + decodePcm");
    assert.equal(ffprobeEnvs.length, 1);
    for (const dump of [...ffmpegEnvs, ...ffprobeEnvs]) {
      assert.match(dump, /^PATH=/m);
      for (const [k, v] of Object.entries(SECRETS)) {
        assert.ok(!dump.includes(v), `${k} llegó al proceso hijo`);
        assert.ok(!new RegExp(`^${k}=`, "m").test(dump), `${k} llegó al proceso hijo`);
      }
    }
  });
});
