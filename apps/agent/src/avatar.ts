// Avatar "versión Terminator" a partir de una foto de la cámara (demo).
//
// Dos proveedores, uno solo activo:
//  - higgsfield: si hay HIGGSFIELD_API_KEY_ID + _SECRET. Flujo REST real de
//    su API (docs.higgsfield.ai): (1) presigned upload de la foto →
//    public_url, (2) POST al modelo con image_urls, (3) polling de status_url
//    hasta completed → images[0].url. Modelo: Grok Imagine Image 2.0 — es el
//    de su catálogo que acepta imagen de referencia para EDITAR (SOUL es
//    texto-a-imagen). Async por diseño: nada de esperar en el POST inicial.
//  - openai: fallback con la OPENAI_API_KEY que ya vive en el .env
//    (gpt-image-1 /images/edits, síncrono, devuelve base64). Así el demo corre
//    HOY sin pegar keys nuevas; al aparecer las de Higgsfield, manda Higgsfield.
//
// El resultado se guarda en ~/.hermes-os/avatars/ (foto original + avatar) y
// se devuelve como data URL: la web lo pinta en un <img> sin pelear con el
// Bearer del agente (un <img src> no manda headers).

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { env } from "./env.js";

export type AvatarProvider = "higgsfield" | "openai";

export const AVATAR_DIR = join(homedir(), ".hermes-os", "avatars");

// El prompt es el producto: conserva la identidad (es "cada quien", no un
// Terminator genérico) y pide el look de la película, no una caricatura.
//
// OJO con el filtro de OpenAI: la primera versión decía "cara dañada, piel
// rasgada, quemaduras" y con un rostro REAL el clasificador lo marcó como
// `violence` (400 image_generation_user_error). El mismo look se describe como
// maquillaje/prostético de cyborg —cromo que se ve, ojo rojo, chaqueta— sin
// una sola palabra de herida, y pasa. Si aun así salta, hay un segundo prompt
// de "cosplay" todavía más suave (ver viaOpenAI).
const TERMINATOR_PROMPT = [
  "Turn this exact person into a cinematic Terminator-style cyborg portrait.",
  "Keep their face, identity, skin tone, hair and expression clearly recognizable —",
  "it must still look like them. On one side of the face, a seamless chrome",
  "metal cyborg endoskeleton shows through like a prosthetic makeup effect, with a",
  "glowing red robotic eye. Black leather jacket. Cinematic movie-still lighting,",
  "dark smoky background, cool blue rim light, slight film grain. Photorealistic,",
  "not cartoon, not anime.",
].join(" ");

// Fallback para el filtro: mismo icono, cero cromo "bajo la piel".
const COSPLAY_PROMPT = [
  "Portrait of this exact person in a Terminator cosplay: keep their face and",
  "identity fully recognizable. Black leather jacket, dark sunglasses pushed up on",
  "the forehead, a small glowing red LED accent near one eye like a costume prop,",
  "dramatic cinematic studio lighting, dark smoky background, film grain.",
  "Photorealistic.",
].join(" ");

export type AvatarResult =
  | { ok: true; provider: AvatarProvider; image: string; file: string; ms: number }
  | { ok: false; error: string };

/** Qué proveedor va a responder (null = ninguno configurado). */
export function avatarProvider(): AvatarProvider | null {
  if (env.HIGGSFIELD_API_KEY_ID && env.HIGGSFIELD_API_KEY_SECRET) return "higgsfield";
  if (env.OPENAI_API_KEY) return "openai";
  return null;
}

export async function terminatorAvatar(photo: Blob): Promise<AvatarResult> {
  const provider = avatarProvider();
  if (!provider) {
    return {
      ok: false,
      error:
        "Sin proveedor: pon HIGGSFIELD_API_KEY_ID + HIGGSFIELD_API_KEY_SECRET (o OPENAI_API_KEY) en el .env.",
    };
  }
  const t0 = Date.now();
  await mkdir(AVATAR_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const original = join(AVATAR_DIR, `${stamp}-foto.jpg`);
  await writeFile(original, Buffer.from(await photo.arrayBuffer()));

  try {
    const png =
      provider === "higgsfield" ? await viaHiggsfield(photo) : await viaOpenAI(photo);
    const file = join(AVATAR_DIR, `${stamp}-terminator.png`);
    await writeFile(file, png);
    return {
      ok: true,
      provider,
      image: `data:image/png;base64,${png.toString("base64")}`,
      file,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ── Higgsfield ─────────────────────────────────────────────────────────

const HF = "https://api.higgsfield.ai";
const hfAuth = () => ({
  Authorization: `Key ${env.HIGGSFIELD_API_KEY_ID}:${env.HIGGSFIELD_API_KEY_SECRET}`,
});

async function viaHiggsfield(photo: Blob): Promise<Buffer> {
  // 1. Presigned upload → public_url (la API no acepta base64 ni multipart).
  const contentType = photo.type || "image/jpeg";
  const pre = await fetch(`${HF}/files/generate-upload-url`, {
    method: "POST",
    headers: { ...hfAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({ content_type: contentType }),
  });
  if (!pre.ok) throw new Error(`Higgsfield upload-url ${pre.status}: ${(await pre.text()).slice(0, 200)}`);
  const { upload_url, upload_headers, public_url } = (await pre.json()) as {
    upload_url: string;
    upload_headers?: Record<string, string>;
    public_url: string;
  };
  const up = await fetch(upload_url, {
    method: "PUT",
    headers: { "Content-Type": contentType, ...(upload_headers ?? {}) },
    body: photo,
  });
  if (!up.ok) throw new Error(`Higgsfield upload ${up.status}`);

  // 2. Generación (async): devuelve request_id + status_url al instante.
  const gen = await fetch(`${HF}/xai/grok-imagine-image-2.0`, {
    method: "POST",
    headers: { ...hfAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: TERMINATOR_PROMPT,
      image_urls: [public_url],
      resolution: "1k",
      aspect_ratio: "auto",
      quality: "medium",
    }),
  });
  if (!gen.ok) throw new Error(`Higgsfield generate ${gen.status}: ${(await gen.text()).slice(0, 200)}`);
  const { status_url } = (await gen.json()) as { request_id: string; status_url: string };

  // 3. Polling. La doc dice "usa las URLs de la respuesta, no las construyas".
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await fetch(status_url, { headers: hfAuth() });
    if (!st.ok) throw new Error(`Higgsfield status ${st.status}`);
    const j = (await st.json()) as {
      status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";
      images?: { url: string }[];
      error?: string | null;
    };
    if (j.status === "completed") {
      const url = j.images?.[0]?.url;
      if (!url) throw new Error("Higgsfield completó sin imagen.");
      const img = await fetch(url);
      if (!img.ok) throw new Error(`descarga del resultado ${img.status}`);
      return Buffer.from(await img.arrayBuffer());
    }
    if (j.status === "failed" || j.status === "canceled") throw new Error(`Higgsfield: ${j.error ?? j.status}`);
    if (j.status === "nsfw") throw new Error("Higgsfield rechazó la imagen (filtro NSFW).");
  }
  throw new Error("Higgsfield: tiempo agotado esperando el resultado.");
}

// ── OpenAI (fallback) ──────────────────────────────────────────────────

async function viaOpenAI(photo: Blob): Promise<Buffer> {
  try {
    return await openAIEdit(photo, TERMINATOR_PROMPT);
  } catch (e) {
    // El clasificador es sensible con rostros reales y no siempre consistente:
    // el mismo prompt pasa con una cara y falla con otra. Un segundo intento
    // con la versión "cosplay" salva la demo en vez de dejarla en un 400.
    if (!isSafetyReject(e as Error)) throw e;
    return await openAIEdit(photo, COSPLAY_PROMPT);
  }
}

/** ¿El 400 vino del filtro de contenido y no de la petición? */
function isSafetyReject(e: Error): boolean {
  return /safety|moderation|content_policy/i.test(e.message);
}

async function openAIEdit(photo: Blob, prompt: string): Promise<Buffer> {
  const form = new FormData();
  form.append("model", "gpt-image-1");
  form.append("image", photo, "foto.jpg");
  form.append("prompt", prompt);
  form.append("size", "1024x1024");
  form.append("n", "1");
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` }, // NO Content-Type manual
    body: form,
  });
  if (!res.ok) {
    const raw = await res.text();
    // El JSON de error de OpenAI es ruido en pantalla: saca solo el mensaje.
    let msg = raw.slice(0, 300);
    try {
      msg = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* no era JSON: se queda el texto crudo */
    }
    if (/safety|moderation|content_policy/i.test(msg)) {
      throw new Error(`El filtro de contenido rechazó la imagen. ${msg}`);
    }
    throw new Error(`OpenAI ${res.status}: ${msg}`);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI devolvió sin imagen.");
  return Buffer.from(b64, "base64");
}
