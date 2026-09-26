import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * TTS de la guía cantada con `fetch` SIMULADO (jamás sale a la red): forma
 * del pedido, caché por texto (la segunda vez 0 caracteres), reintento sin
 * language_code, errores legibles sin filtrar la clave, y la lista de voces
 * genéricas. Estado en una carpeta temporal fijada ANTES de importar; la
 * clave es falsa a propósito (así dotenv no carga la real del .env).
 */

const FAKE_KEY = "clave-de-prueba-no-real";
let dir: string;
let tts: typeof import("./tts.js");
const realFetch = globalThis.fetch;
let calls: { url: string; init?: RequestInit }[] = [];
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;

/** PCM16 LE sintético: un seno de 200 Hz de `sec` segundos a 24 kHz, en base64. */
function pcmBase64(sec: number): string {
  const n = Math.round(sec * 24000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 200 * i) / 24000)), i * 2);
  return buf.toString("base64");
}

/** Alineación inventada: cada carácter dura 80 ms. */
function alignmentOf(text: string) {
  const characters = [...text];
  return {
    characters,
    character_start_times_seconds: characters.map((_, i) => i * 0.08),
    character_end_times_seconds: characters.map((_, i) => (i + 1) * 0.08),
  };
}

function ttsOk(text: string, cost?: number): Response {
  return new Response(JSON.stringify({ audio_base64: pcmBase64(0.08 * text.length), alignment: alignmentOf(text) }), {
    status: 200,
    headers: { "content-type": "application/json", ...(cost !== undefined ? { "character-cost": String(cost) } : {}) },
  });
}

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "hermes-composicion-tts-"));
  process.env.HERMES_COMPOSICION_DIR = join(dir, "estado");
  process.env.ELEVENLABS_API_KEY = FAKE_KEY;
  process.env.COMPOSICION_TTS_MODEL = "eleven_multilingual_v2";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return respond(url, init);
  }) as typeof fetch;
  tts = await import("./tts.js");
});

after(async () => {
  globalThis.fetch = realFetch;
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  calls = [];
  respond = () => {
    throw new Error("fetch inesperado");
  };
});

const VOICE = "AbCdEf0123456789XyZw";

describe("tts: elevenTts", () => {
  it("pide with-timestamps en pcm_24000 con los campos del contrato y decodifica el PCM", async () => {
    respond = (_url, init) => ttsOk(JSON.parse(String(init?.body)).text, 13);
    const r = await tts.elevenTts("  la luna  sale ", VOICE);
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, `https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=pcm_24000`);
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["xi-api-key"], FAKE_KEY);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text, "la luna sale", "el texto va normalizado");
    assert.equal(body.model_id, "eleven_multilingual_v2");
    assert.equal(body.language_code, "es");
    assert.deepEqual(body.voice_settings, { stability: 0.6, speed: 0.9 });
    assert.ok(Number.isInteger(body.seed), "semilla fija");
    assert.equal(r.sr, 24000);
    assert.equal(r.chars, 13, "lo cobrado sale de la cabecera character-cost");
    assert.equal(r.cached, false);
    assert.equal(r.pcm.length, Math.round(0.08 * 12 * 24000));
    assert.ok(Math.max(...r.pcm.slice(0, 2000)) > 0.2, "el PCM llega como float −1..1");
    assert.equal(r.alignment.characters.join(""), "la luna sale");
  });

  it("la segunda vez sale de la caché: 0 caracteres y sin red", async () => {
    respond = (_url, init) => ttsOk(JSON.parse(String(init?.body)).text);
    const first = await tts.elevenTts("dime que sí", VOICE);
    assert.equal(first.chars, "dime que sí".length, "sin cabecera, lo cobrado = el largo del texto");
    const again = await tts.elevenTts("dime que sí", VOICE);
    assert.equal(calls.length, 1, "la segunda no llama a la API");
    assert.equal(again.chars, 0);
    assert.equal(again.cached, true);
    assert.equal(again.pcm.length, first.pcm.length);
    assert.deepEqual(again.alignment, first.alignment);
    const files = await readdir(join(dir, "estado", "tts-cache"));
    assert.ok(files.some((f) => f.endsWith(".json")) && files.some((f) => f.endsWith(".pcm")));
    assert.ok(!files.some((f) => f.endsWith(".tmp")), "sin temporales colgando");
    // Otra voz = otro audio: no comparte caché.
    await tts.elevenTts("dime que sí", "ZyXw9876543210VuTsRq");
    assert.equal(calls.length, 2);
  });

  it("si el modelo no acepta language_code, reintenta UNA vez sin él", async () => {
    respond = (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.language_code)
        return new Response(JSON.stringify({ detail: { status: "unsupported_language", message: "language_code is not supported for this model" } }), {
          status: 400,
        });
      return ttsOk(body.text);
    };
    const r = await tts.elevenTts("otra noche más", VOICE);
    assert.equal(calls.length, 2);
    assert.equal(JSON.parse(String(calls[1].init?.body)).language_code, undefined);
    assert.equal(r.cached, false);
  });

  it("errores de la API → mensaje claro, con status, y sin la clave", async () => {
    respond = () => new Response(JSON.stringify({ detail: { status: "invalid_api_key", message: "Invalid API key" } }), { status: 401 });
    await assert.rejects(tts.elevenTts("hola", VOICE), (err: unknown) => {
      assert.ok(err instanceof tts.TtsError);
      assert.equal(err.status, 503);
      assert.match(err.message, /rechazó la API key/);
      assert.ok(!err.message.includes(FAKE_KEY));
      return true;
    });
    respond = () => new Response(JSON.stringify({ detail: { status: "quota_exceeded", message: "not enough credits" } }), { status: 401 });
    await assert.rejects(tts.elevenTts("hola otra", VOICE), /sin caracteres o créditos/);
    respond = () => new Response("boom", { status: 500 });
    await assert.rejects(tts.elevenTts("hola de nuevo", VOICE), (err: unknown) => {
      assert.ok(err instanceof tts.TtsError);
      assert.equal(err.status, 502);
      assert.match(err.message, /ElevenLabs TTS falló \(500\)/);
      return true;
    });
    respond = () => new Response(JSON.stringify({ audio_base64: pcmBase64(0.2) }), { status: 200 });
    await assert.rejects(tts.elevenTts("sin alineación", VOICE), /alineación/);
    assert.ok(!existsSync(join(dir, "estado", "tts-cache", `${tts.ttsCacheKey("sin alineación", VOICE, "eleven_multilingual_v2")}.json`)), "un error no se cachea");
  });

  it("valida antes de gastar: texto vacío, voz rara, sin clave", async () => {
    await assert.rejects(tts.elevenTts("   ", VOICE), /no hay texto/);
    await assert.rejects(tts.elevenTts("hola", "../../etc"), /id de voz inválido/);
    const { env } = await import("../env.js");
    env.ELEVENLABS_API_KEY = "";
    try {
      await assert.rejects(tts.elevenTts("una línea nueva", VOICE), (err: unknown) => {
        assert.ok(err instanceof tts.TtsError);
        assert.equal(err.status, 503);
        assert.match(err.message, /ELEVENLABS_API_KEY/);
        return true;
      });
    } finally {
      env.ELEVENLABS_API_KEY = FAKE_KEY;
    }
    assert.equal(calls.length, 0);
  });
});

describe("tts: listVoices", () => {
  it("solo genéricas (sin clonadas ni famosas), español primero, con caché de 1 h", async () => {
    tts.resetVoicesCache();
    respond = (url) => {
      assert.equal(url, "https://api.elevenlabs.io/v1/voices");
      return new Response(
        JSON.stringify({
          voices: [
            { voice_id: "Premade00000000000001", name: "Zeta", category: "premade", labels: { gender: "female", accent: "american" } },
            { voice_id: "Cloned000000000000001", name: "Mi clon", category: "cloned", labels: {} },
            { voice_id: "Famous000000000000001", name: "Alguien famoso", category: "famous", labels: {} },
            { voice_id: "Library00000000000001", name: "Andina", category: "professional", labels: { gender: "female", accent: "colombian", language: "es" } },
            { voice_id: "Premade00000000000002", name: "Alfa", category: "premade", labels: { gender: "male" } },
            { voice_id: "../raro", name: "Rara", category: "premade" },
          ],
        }),
        { status: 200 },
      );
    };
    const voices = await tts.listVoices();
    assert.deepEqual(
      voices.map((v) => v.name),
      ["Andina", "Alfa", "Zeta"],
    );
    assert.deepEqual(voices[0], { id: "Library00000000000001", name: "Andina", gender: "female", accent: "colombian" });
    await tts.listVoices();
    assert.equal(calls.length, 1, "la segunda sale de la caché");
  });

  it("error de la API → TtsError legible", async () => {
    tts.resetVoicesCache();
    respond = () => new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401 });
    await assert.rejects(tts.listVoices(), /rechazó la API key/);
  });
});
