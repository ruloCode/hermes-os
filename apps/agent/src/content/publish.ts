/**
 * Publicación automática de piezas del Estudio (fase 1: YouTube Shorts).
 *
 * El disparo lo hace un HUMANO al mover la pieza a "programado"
 * (store.ts → `moved`), igual que syncLinearState. A partir de ahí:
 *
 *   1. `schedulePublications` valida y encola las variantes automáticas.
 *   2. El job `content-publish` barre Postgres cada 5 min y sube lo pendiente.
 *   3. YouTube programa la salida NATIVA con status.publishAt, así que subimos
 *      apenas se encola (temprano, con margen) en vez de esperar la hora.
 *
 * La cola vive en la BD y NUNCA en memoria: `registerJob` se resetea con cada
 * reinicio del agente (jobs.ts), así que el barrido tiene que ser un simple
 * "escanea y actúa" — self-healing, como code-graph-update.
 *
 * Idempotencia: `remote_id` es el candado. Subir el mismo video dos veces es el
 * fallo caro (dos videos en el canal), así que una variante con remote_id no se
 * vuelve a tocar jamás, pase lo que pase.
 */
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { PLATFORM_PROVIDER, effectiveCopy, effectiveTitle, isPublishable } from "@hermes/shared";
import type {
  ContentPiece,
  ContentPublication,
  ContentPublishJob,
  PublishProviderStatus,
} from "@hermes/shared";
import { emit } from "../events.js";
import { supabase } from "../supabase.js";
import { getPiece, listPieces, updatePiece } from "./store.js";
import { sealMaster } from "./media.js";
import * as youtube from "./providers/youtube.js";

/** Tope de reintentos antes de dejar la variante en error definitivo. */
const MAX_ATTEMPTS = 5;
/** Backoff por número de intentos ya hechos: 1 → 5 → 25 → 60 min. */
const BACKOFF_MIN = [1, 5, 25, 60, 60];

/** Un run por pieza: evita que el barrido y el botón se pisen. */
const running = new Set<number>();

// ── Estado de los providers (lo pinta la UI) ───────────────────────────

export function providerStatuses(): PublishProviderStatus[] {
  return [
    {
      provider: "youtube",
      label: "YouTube / Shorts",
      configured: youtube.isConfigured(),
      hint: youtube.isConfigured()
        ? null
        : "faltan GOOGLE_OAUTH_* en el .env — corre `pnpm --filter @hermes/agent google:auth`",
    },
    {
      provider: "instagram",
      label: "Instagram Reels",
      configured: false,
      hint: "fase 2 — necesita el mp4 en una URL pública (túnel con dominio fijo)",
    },
    {
      provider: "tiktok",
      label: "TikTok",
      configured: false,
      hint: "fase 3 — bloqueada por la auditoría de TikTok (sin ella los posts salen privados)",
    },
  ];
}

// ── Helpers de variante ────────────────────────────────────────────────

function patchPub(
  pubs: ContentPublication[],
  id: string,
  patch: Partial<ContentPublication>,
): ContentPublication[] {
  return pubs.map((p) => (p.id === id ? { ...p, ...patch } : p));
}

/** ¿Ya toca reintentar esta variante, según su backoff? */
function backoffReady(pub: ContentPublication, now = Date.now()): boolean {
  if (!pub.last_attempt_at || pub.attempts === 0) return true;
  const wait = BACKOFF_MIN[Math.min(pub.attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
  return now - new Date(pub.last_attempt_at).getTime() >= wait;
}

/**
 * Por qué esta variante NO se puede publicar, en español. null = se puede.
 * Se comprueba ANTES de encolar para que el error salga de una en la UI en vez
 * de esperar a un barrido que va a fallar igual.
 */
function blockedReason(piece: ContentPiece, pub: ContentPublication): string | null {
  if (PLATFORM_PROVIDER[pub.platform] === "manual")
    return `${pub.platform} todavía no tiene publicación automática — súbela tú`;
  if (!effectiveTitle(piece, pub))
    return "la pieza no tiene hook ni título: sin eso no hay qué publicar";
  // La descripción NO se hereda: sin copy propio el video sale pelado (pasó
  // con TFYDBmye6nI, 2026-08-10). Se bloquea aquí, antes de gastar la subida.
  if (!pub.copy?.trim())
    return `sin copy propio para ${pub.platform}: la descripción no se hereda — escríbela en el tab Publicación`;
  if (!piece.master_path) return "la pieza no tiene master renderizado";
  if (!existsSync(piece.master_path))
    return `el master ya no está en disco: ${basename(piece.master_path)}`;
  const status = providerStatuses().find((s) => s.provider === PLATFORM_PROVIDER[pub.platform]);
  if (status && !status.configured) return status.hint ?? `${status.label} sin configurar`;
  return null;
}

// ── Encolar (lo llama store.ts al entrar a "programado") ───────────────

/**
 * Valida y deja listas las variantes de la pieza. No sube nada: el barrido (o
 * el botón de la UI) lo hace. Sella el master de paso — si la edición fue
 * manual, este es el momento en que la BD se entera de que hay video.
 */
export async function schedulePublications(pieceId: number): Promise<ContentPiece | null> {
  const sealed = await sealMaster(pieceId);
  const piece = sealed.piece;
  if (!piece || !piece.publications.length) return piece;

  let pubs = piece.publications;
  let queued = 0;
  for (const pub of piece.publications) {
    if (pub.remote_id) continue; // ya subida: intocable
    const provider = PLATFORM_PROVIDER[pub.platform];
    if (provider === "manual") {
      if (pub.publish_state !== "manual")
        pubs = patchPub(pubs, pub.id, { provider, publish_state: "manual" });
      continue;
    }
    const blocked = blockedReason(piece, pub);
    pubs = patchPub(pubs, pub.id, {
      provider,
      publish_state: blocked ? "error" : "pendiente",
      last_error: blocked,
      // Un bloqueo de validación no consume intentos: no se reintenta solo,
      // se arregla y se vuelve a disparar.
      attempts: blocked ? pub.attempts : 0,
    });
    if (!blocked) queued++;
  }

  const updated = await updatePiece(pieceId, { publications: pubs });
  if (queued)
    emit({
      kind: "task_start",
      taskId: `content-publish-${pieceId}`,
      detail: `"${piece.title}": ${queued} variante(s) en cola para publicar`,
    });
  return updated;
}

// ── Publicar de verdad ─────────────────────────────────────────────────

/** Sube UNA variante. Devuelve el parche a aplicarle. */
async function publishOne(
  piece: ContentPiece,
  pub: ContentPublication,
): Promise<Partial<ContentPublication>> {
  const now = new Date().toISOString();
  const attempts = pub.attempts + 1;
  const provider = PLATFORM_PROVIDER[pub.platform];

  try {
    if (provider !== "youtube") throw new Error(`provider ${provider} no implementado`);
    const result = await youtube.uploadVideo({
      filePath: piece.master_path as string,
      title: effectiveTitle(piece, pub),
      description: effectiveCopy(piece, pub),
      publishAt: pub.scheduled_at ?? piece.publish_at,
    });
    return {
      remote_id: result.id,
      remote_url: result.url,
      attempts,
      last_attempt_at: now,
      last_error: result.lockedPrivate
        ? "YouTube lo dejó PRIVADO (proyecto sin auditar o sin fecha): dale público en Studio"
        : null,
      // Programada = YouTube lo tiene y saldrá a su hora. Privado sin fecha
      // significa que falta un paso humano, así que NO se marca publicada.
      publish_state: result.lockedPrivate
        ? "manual"
        : result.scheduledFor
          ? "programada"
          : "publicada",
      status: result.lockedPrivate ? pub.status : "programada",
    };
  } catch (err) {
    const permanent = err instanceof youtube.YouTubeError ? err.permanent : false;
    const detail = err instanceof Error ? err.message : String(err);
    const exhausted = attempts >= MAX_ATTEMPTS;
    return {
      attempts,
      last_attempt_at: now,
      last_error: permanent
        ? detail
        : exhausted
          ? `${detail} (${attempts} intentos, ya no se reintenta)`
          : `${detail} — reintento automático`,
      // Sin reintento posible → error definitivo; si no, vuelve a la cola.
      publish_state: permanent || exhausted ? "error" : "pendiente",
    };
  }
}

/**
 * Publica las variantes listas de una pieza. `only` limita a una variante
 * (el botón "Publicar" de una fila); sin él, va por todas las que apliquen.
 */
export async function publishPiece(
  pieceId: number,
  opts: { only?: string; ignoreBackoff?: boolean } = {},
): Promise<{ piece?: ContentPiece; error?: string; status?: number }> {
  if (running.has(pieceId)) return { error: "ya hay una publicación en curso", status: 409 };

  const sealed = await sealMaster(pieceId);
  const piece = sealed.piece;
  if (!piece) return { error: "pieza no encontrada", status: 404 };

  const targets = piece.publications.filter((p) => {
    if (opts.only && p.id !== opts.only) return false;
    if (p.remote_id) return false;
    if (PLATFORM_PROVIDER[p.platform] === "manual") return false;
    if (!opts.ignoreBackoff && !backoffReady(p)) return false;
    // El disparo manual relaja el BACKOFF y el estado 'error' — nunca el
    // contenido. Sin esta línea, un clic en ▶ Publicar sobre una variante
    // recién creada subía el video con el título de la pieza y SIN
    // descripción (pasó de verdad: TFYDBmye6nI, 2026-08-10).
    if (!effectiveTitle(piece, p)) return false;
    if (!p.copy?.trim()) return false;
    return isPublishable(p, piece) || opts.only != null;
  });

  if (!targets.length) {
    // Sin objetivos, el motivo importa más que el silencio.
    const one = opts.only ? piece.publications.find((p) => p.id === opts.only) : null;
    if (one?.remote_id) return { error: "esta variante ya se publicó", status: 409 };
    if (one) return { error: blockedReason(piece, one) ?? "nada que publicar", status: 400 };
    return { piece };
  }

  running.add(pieceId);
  const job: ContentPublishJob = {
    status: "running",
    detail: `subiendo ${targets.length} variante(s)…`,
    started_at: new Date().toISOString(),
    finished_at: null,
    ok: 0,
    failed: 0,
    error: null,
  };
  const queued =
    (await updatePiece(pieceId, {
      publishJob: job,
      publications: targets.reduce(
        (pubs, t) => patchPub(pubs, t.id, { publish_state: "subiendo", last_error: null }),
        piece.publications,
      ),
    })) ?? piece;

  emit({
    kind: "task_start",
    taskId: `content-publish-${pieceId}`,
    detail: `publicando "${piece.title}" (${targets.map((t) => t.platform).join(", ")})`,
  });

  void runPublish(pieceId, targets, job);
  return { piece: queued };
}

/** El trabajo real, fuera del ciclo de respuesta (la UI lo ve por el poll). */
async function runPublish(
  pieceId: number,
  targets: ContentPublication[],
  job: ContentPublishJob,
): Promise<void> {
  try {
    for (const target of targets) {
      // Se relee en cada vuelta: una subida puede tardar minutos y la pieza
      // pudo cambiar (o el master moverse) mientras tanto.
      const piece = await getPiece(pieceId);
      if (!piece) break;
      const pub = piece.publications.find((p) => p.id === target.id);
      if (!pub || pub.remote_id) continue;

      await updatePiece(pieceId, {
        publishJob: { ...job, detail: `subiendo a ${pub.platform}…` },
      });

      const patch = await publishOne(piece, pub);
      if (patch.remote_id) job.ok++;
      else if (patch.publish_state === "error") job.failed++;

      const fresh = await getPiece(pieceId);
      await updatePiece(pieceId, {
        publications: patchPub(fresh?.publications ?? piece.publications, pub.id, patch),
      });

      emit({
        kind: patch.remote_id ? "task_done" : "error",
        taskId: `content-publish-${pieceId}`,
        detail: patch.remote_id
          ? `${pub.platform}: ${patch.remote_url}`
          : `${pub.platform} falló: ${String(patch.last_error).slice(0, 140)}`,
      });
    }

    await updatePiece(pieceId, {
      publishJob: {
        ...job,
        status: job.failed && !job.ok ? "error" : "done",
        detail: `${job.ok} publicada(s), ${job.failed} con error`,
        finished_at: new Date().toISOString(),
        error: null,
      },
    });
    await closeIfAllDone(pieceId);
  } catch (err) {
    await updatePiece(pieceId, {
      publishJob: {
        ...job,
        status: "error",
        finished_at: new Date().toISOString(),
        error: String(err).slice(0, 300),
      },
    });
  } finally {
    running.delete(pieceId);
  }
}

/**
 * Si TODAS las variantes quedaron resueltas, la pieza pasa a "publicado".
 * Solo con dato real: una variante en error o a medio subir no cierra nada, y
 * las manuales cuentan únicamente si el humano ya las marcó publicadas.
 */
async function closeIfAllDone(pieceId: number): Promise<void> {
  const piece = await getPiece(pieceId);
  if (!piece || piece.status !== "programado" || !piece.publications.length) return;
  const allDone = piece.publications.every((p) =>
    p.publish_state === "manual" ? p.status === "publicada" : Boolean(p.remote_id),
  );
  if (!allDone) return;
  await updatePiece(pieceId, {
    status: "publicado",
    publications: piece.publications.map((p) =>
      p.remote_id && p.status !== "publicada" ? { ...p, status: "programada" as const } : p,
    ),
  });
}

// ── Barrido periódico (job content-publish) ────────────────────────────

export interface SweepResult {
  scanned: number;
  launched: number;
  verified: number;
}

/**
 * Escanea las piezas programadas y arranca lo que esté pendiente y con su
 * backoff cumplido. También verifica en YouTube las que ya salieron, para que
 * "publicada" en la UI signifique que la API lo confirmó — no una suposición.
 */
export async function publishSweep(): Promise<SweepResult | null> {
  if (!supabase) return null;
  const pieces = (await listPieces()).filter(
    (p) => p.status === "programado" || p.status === "publicado",
  );
  let launched = 0;
  let verified = 0;

  for (const piece of pieces) {
    const ready = piece.publications.filter(
      (p) => isPublishable(p, piece) && backoffReady(p) && p.attempts < MAX_ATTEMPTS,
    );
    if (ready.length && !running.has(piece.id)) {
      const blocked = ready.every((p) => blockedReason(piece, p));
      if (!blocked) {
        await publishPiece(piece.id);
        launched += ready.length;
        continue; // una pieza por vuelta: las subidas son lentas
      }
    }
    // Verificación posterior: ¿el publishAt ya disparó?
    for (const pub of piece.publications) {
      if (!pub.remote_id || pub.publish_state !== "programada") continue;
      const live = await youtube.fetchVideoStatus(pub.remote_id);
      if (live?.privacyStatus === "public") {
        const fresh = await getPiece(piece.id);
        if (!fresh) continue;
        await updatePiece(piece.id, {
          publications: patchPub(fresh.publications, pub.id, {
            publish_state: "publicada",
            status: "publicada",
            last_error: null,
          }),
        });
        verified++;
        emit({
          kind: "task_done",
          taskId: `content-publish-${piece.id}`,
          detail: `"${piece.title}" ya está en vivo: ${pub.remote_url}`,
        });
      }
    }
    await closeIfAllDone(piece.id);
  }
  return { scanned: pieces.length, launched, verified };
}
