/**
 * Provider de publicación: YouTube (Shorts).
 *
 * Sin librería de Google, igual que google-calendar.ts: se pide un access token
 * por fetch al token endpoint y se llama la REST API directamente. Comparte las
 * credenciales OAuth con el calendario — UN solo consentimiento cubre ambos
 * scopes (calendar.events + youtube.upload), ver scripts/google-oauth.ts.
 *
 * Subida = resumable en dos pasos: primero los metadatos (devuelve una URL de
 * sesión en el header Location), después los bytes por PUT en streaming (nunca
 * se carga el mp4 entero en memoria).
 *
 * Programación: YouTube la hace NATIVA con status.publishAt, y exige que el
 * video se suba como `private`. Eso es una ventaja real — subimos apenas la
 * pieza entra a "programado" (temprano, con margen para arreglar problemas) y
 * el Mac puede estar apagado a la hora de salida.
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { env } from "../../env.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_URL = "https://www.googleapis.com/youtube/v3/videos";

/** Categoría 28 = "Science & Technology" (la del canal). */
const CATEGORY_ID = "28";
/** Límites duros de la API: títulos >100 o con <> los rechaza de plano. */
const TITLE_MAX = 100;
const DESC_MAX = 5000;

export function isConfigured(): boolean {
  return Boolean(
    env.GOOGLE_OAUTH_CLIENT_ID &&
      env.GOOGLE_OAUTH_CLIENT_SECRET &&
      env.GOOGLE_OAUTH_REFRESH_TOKEN,
  );
}

// ── Access token (cacheado hasta ~1 min antes de expirar) ──────────────
// Exportado: youtube-analytics.ts (bucle de resultados) usa el MISMO token.
let tokenCache: { token: string; expMs: number } | null = null;

export async function getAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expMs) return tokenCache.token;
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = await res.text();
  if (!res.ok) {
    // invalid_grant = el refresh token murió (revocado, o la pantalla de
    // consentimiento volvió a "Testing" y Google lo caduca a los 7 días).
    const dead = body.includes("invalid_grant");
    throw new Error(
      dead
        ? "el refresh token de Google ya no sirve — vuelve a correr `pnpm --filter @hermes/agent google:auth` y revisa que la pantalla de consentimiento esté en In production"
        : `OAuth HTTP ${res.status} ${body.slice(0, 160)}`,
    );
  }
  const json = JSON.parse(body) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, expMs: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

/** Descripción de un error de la API de Google, en una línea legible. */
function apiError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = j.error?.errors?.[0]?.reason;
    const msg = j.error?.message ?? body.slice(0, 160);
    return reason ? `${reason}: ${msg}` : msg;
  } catch {
    return `HTTP ${status} ${body.slice(0, 160)}`;
  }
}

/** 4xx (salvo 408/429) = culpa nuestra: reintentar solo quema cuota. */
export function isPermanent(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

export interface UploadInput {
  filePath: string;
  title: string;
  description: string;
  /** ISO. Si viene y es futuro, el video sale a esa hora (privado hasta entonces). */
  publishAt: string | null;
  tags?: string[];
}

export interface UploadResult {
  id: string;
  url: string;
  /** Cómo quedó realmente en YouTube (private mientras espera su publishAt). */
  privacyStatus: string;
  /** true = YouTube lo dejó bloqueado por proyecto sin auditar. */
  lockedPrivate: boolean;
  scheduledFor: string | null;
}

export class YouTubeError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "YouTubeError";
  }
}

/**
 * Sube el archivo y devuelve el video creado. Lanza YouTubeError con
 * `permanent` para que el orquestador sepa si vale la pena reintentar.
 */
export async function uploadVideo(input: UploadInput): Promise<UploadResult> {
  if (!isConfigured())
    throw new YouTubeError("faltan las credenciales GOOGLE_OAUTH_* en el .env", true);
  if (!existsSync(input.filePath))
    throw new YouTubeError(`el master ya no está en disco: ${input.filePath}`, true);

  const size = statSync(input.filePath).size;
  if (size === 0) throw new YouTubeError(`el master está vacío: ${basename(input.filePath)}`, true);

  const token = await getAccessToken();

  // publishAt en el pasado hace que YouTube publique de inmediato: si la fecha
  // ya pasó, no la mandamos y el video queda privado esperando decisión humana.
  const future = input.publishAt && new Date(input.publishAt).getTime() > Date.now();
  const publishAt = future ? new Date(input.publishAt as string).toISOString() : null;

  const metadata = {
    snippet: {
      title: cleanTitle(input.title),
      description: input.description.slice(0, DESC_MAX),
      categoryId: CATEGORY_ID,
      ...(input.tags?.length ? { tags: input.tags.slice(0, 15) } : {}),
    },
    status: {
      // Siempre private: es requisito de publishAt, y sin auditoría YouTube lo
      // dejaría privado igual. Se vuelve público solo cuando toca.
      privacyStatus: "private",
      selfDeclaredMadeForKids: false,
      ...(publishAt ? { publishAt } : {}),
    },
  };

  // 1) Abrir la sesión resumable (los metadatos van en el cuerpo).
  const init = await fetch(`${UPLOAD_URL}?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(30_000),
  });
  if (!init.ok) {
    const body = await init.text().catch(() => "");
    throw new YouTubeError(apiError(init.status, body), isPermanent(init.status));
  }
  const session = init.headers.get("location");
  if (!session) throw new YouTubeError("YouTube no devolvió la URL de subida", false);

  // 2) Mandar los bytes. Streaming (duplex half) para no cargar el mp4 en RAM;
  //    un master de 40s son ~25 MB, pero uno largo puede ser de gigas.
  const stream = Readable.toWeb(createReadStream(input.filePath)) as ReadableStream;
  const put = await fetch(session, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: stream,
    // undici exige duplex:"half" cuando el body es un stream.
    duplex: "half",
    // Subir 25 MB por una conexión doméstica puede tardar: sin tope agresivo.
    signal: AbortSignal.timeout(20 * 60_000),
  });
  const putBody = await put.text().catch(() => "");
  if (!put.ok) throw new YouTubeError(apiError(put.status, putBody), isPermanent(put.status));

  const video = JSON.parse(putBody) as {
    id: string;
    status?: { privacyStatus?: string; publishAt?: string; uploadStatus?: string; rejectionReason?: string };
  };
  if (!video.id) throw new YouTubeError("YouTube aceptó la subida pero no devolvió id", false);
  if (video.status?.rejectionReason)
    throw new YouTubeError(`YouTube rechazó el video: ${video.status.rejectionReason}`, true);

  const privacyStatus = video.status?.privacyStatus ?? "private";
  return {
    id: video.id,
    url: `https://www.youtube.com/watch?v=${video.id}`,
    privacyStatus,
    // Sin publishAt y en privado = el bloqueo del proyecto sin auditar
    // (o simplemente que la pieza no traía fecha). En ambos casos hay que
    // rematar a mano en Studio, así que la UI lo dice igual.
    lockedPrivate: !video.status?.publishAt && privacyStatus === "private",
    scheduledFor: video.status?.publishAt ?? null,
  };
}

/**
 * Estado actual del video en YouTube. Requiere scope de lectura
 * (`youtube.readonly`): sin él devuelve null en vez de romper el barrido —
 * la subida no depende de esto, solo la verificación posterior.
 */
export async function fetchVideoStatus(
  videoId: string,
): Promise<{ privacyStatus: string; publishAt: string | null } | null> {
  if (!isConfigured()) return null;
  try {
    const token = await getAccessToken();
    const res = await fetch(`${API_URL}?part=status&id=${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null; // 403 = falta youtube.readonly; no es un fallo del flujo
    const j = (await res.json()) as {
      items?: { status?: { privacyStatus?: string; publishAt?: string } }[];
    };
    const st = j.items?.[0]?.status;
    if (!st) return null;
    return { privacyStatus: st.privacyStatus ?? "private", publishAt: st.publishAt ?? null };
  } catch {
    return null;
  }
}

/**
 * Estadísticas ACUMULADAS de la Data API (`videos.list part=statistics`):
 * viewCount/likeCount/commentCount al día de hoy. Es el dato barato del bucle
 * de resultados — funciona con el scope `youtube.readonly` ya consentido,
 * sin esperar el re-consentimiento de Analytics. Hasta 50 ids por llamada.
 */
export async function fetchVideoStats(
  videoIds: string[],
): Promise<Map<string, { views: number; likes: number | null; comments: number | null }>> {
  const out = new Map<string, { views: number; likes: number | null; comments: number | null }>();
  if (!isConfigured() || !videoIds.length) return out;
  const token = await getAccessToken();
  for (let i = 0; i < videoIds.length; i += 50) {
    const ids = videoIds.slice(i, i + 50).join(",");
    const res = await fetch(`${API_URL}?part=statistics&id=${encodeURIComponent(ids)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new YouTubeError(apiError(res.status, body), isPermanent(res.status));
    }
    const j = (await res.json()) as {
      items?: { id: string; statistics?: { viewCount?: string; likeCount?: string; commentCount?: string } }[];
    };
    for (const item of j.items ?? []) {
      const s = item.statistics;
      if (!s) continue;
      out.set(item.id, {
        views: Number(s.viewCount ?? 0),
        likes: s.likeCount != null ? Number(s.likeCount) : null,
        comments: s.commentCount != null ? Number(s.commentCount) : null,
      });
    }
  }
  return out;
}

/** Título apto para YouTube: sin <>, sin saltos y recortado a 100. */
function cleanTitle(raw: string): string {
  const clean = raw.replace(/[<>]/g, "").replace(/\s+/g, " ").trim() || "Sin título";
  return clean.length > TITLE_MAX ? `${clean.slice(0, TITLE_MAX - 1)}…` : clean;
}
