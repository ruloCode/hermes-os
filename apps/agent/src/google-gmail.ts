/**
 * Gmail API (SOLO lectura, scope gmail.readonly): listar y leer mensajes.
 *
 * Reusa el access token de Google que ya mintea el uploader de YouTube (un
 * solo consentimiento cubre calendario, YouTube y Gmail — ver
 * scripts/google-oauth.ts). Sin librería de Google: REST v1 por fetch.
 * Si el refresh token es viejo (sin el scope), Gmail responde 403 y el error
 * lo dice para volver a correr `google:auth`.
 */
import { getAccessToken, isConfigured as googleConfigured } from "./content/providers/youtube.js";

const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export function isConfigured(): boolean {
  return googleConfigured();
}

export interface GmailMessage {
  id: string;
  /** Epoch ms en que Gmail recibió el mensaje. */
  receivedAt: number;
  subject: string;
  from: string;
  /** Parte text/plain decodificada ("" si no trae). */
  plain: string;
  /** Parte text/html decodificada ("" si no trae). */
  html: string;
}

async function gmailFetch<T>(path: string): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) {
    const scope = res.status === 403 && /insufficient|scope|has not been used|disabled/i.test(body);
    throw new Error(
      scope
        ? "Gmail no autorizado: habilita la Gmail API en Google Cloud y vuelve a correr `pnpm --filter @hermes/agent google:auth`"
        : `Gmail HTTP ${res.status} ${body.slice(0, 160)}`,
    );
  }
  return JSON.parse(body) as T;
}

/** Ids de los mensajes que cumplen la búsqueda de Gmail (`q`, misma sintaxis que la barra). */
export async function listMessageIds(q: string, max = 50): Promise<string[]> {
  const params = new URLSearchParams({ q, maxResults: String(Math.min(max, 500)) });
  const r = await gmailFetch<{ messages?: { id: string }[] }>(`/messages?${params}`);
  return (r.messages ?? []).map((m) => m.id);
}

interface GPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GPart[];
  headers?: { name: string; value: string }[];
}

function* walk(p: GPart): Generator<GPart> {
  yield p;
  for (const c of p.parts ?? []) yield* walk(c);
}

const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

export async function getMessage(id: string): Promise<GmailMessage> {
  const m = await gmailFetch<{ id: string; internalDate: string; payload: GPart }>(
    `/messages/${encodeURIComponent(id)}?format=full`,
  );
  const header = (n: string) =>
    m.payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
  let plain = "";
  let html = "";
  for (const p of walk(m.payload)) {
    const data = p.body?.data;
    if (!data) continue;
    if (p.mimeType === "text/plain" && !plain) plain = b64url(data);
    else if (p.mimeType === "text/html" && !html) html = b64url(data);
  }
  return {
    id: m.id,
    receivedAt: Number(m.internalDate),
    subject: header("subject"),
    from: header("from"),
    plain,
    html,
  };
}
