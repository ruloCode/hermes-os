/**
 * Etapas del Estudio (proyecto RuloCodeShow) — la definición ÚNICA del
 * pipeline de creación de contenido: qué significa cada estado, qué trabajo
 * se hace ahí y qué tiene que cumplirse para pasar al siguiente.
 *
 * Regla del modelo: el estado es la FASE EN CURSO, no un hito cumplido.
 * Una pieza en `grabacion` es la que toca grabar; una en `edicion` es la que
 * toca editar. Así "¿qué grabo el sábado?" se responde con un filtro.
 *
 * Los criterios de salida (`stageGates`) se calculan SIEMPRE sobre el dato
 * real de la pieza (guion, tomas, puntos de edición, variantes) — nunca son
 * checkboxes manuales que se puedan marcar sin haber hecho el trabajo.
 * Vive en shared porque lo usan el agente (voz/chat) y el dashboard.
 */
import type {
  ContentPiece,
  ContentPublication,
  ContentStatus,
  PublishProvider,
  PublishState,
} from "./types.js";
import { CTA_RE, parseScript } from "./script-beats.js";

export interface ContentStageDef {
  status: ContentStatus;
  label: string;
  /** Qué significa que una pieza esté en esta etapa. */
  meaning: string;
  /** El trabajo concreto que se hace aquí. */
  work: string;
  /** Siguiente etapa del flujo (null = terminal). */
  next: ContentStatus | null;
  /** Días razonables en la etapa; más = atascada. null = sin SLA. */
  sla: number | null;
}

/** Orden del flujo (descartada vive aparte: no es una etapa, es una salida). */
export const CONTENT_STAGES: ContentStatus[] = [
  "idea",
  "guion",
  "grabacion",
  "edicion",
  "programado",
  "publicado",
];

export const STAGES: Record<ContentStatus, ContentStageDef> = {
  idea: {
    status: "idea",
    label: "Idea",
    meaning: "Capturada, todavía sin compromiso: puede morir aquí sin costo.",
    work: "Decidir el ángulo, el pilar, para qué red es y cuándo saldría.",
    next: "guion",
    sla: 21,
  },
  guion: {
    status: "guion",
    label: "Guion",
    meaning: "Comprometida: entró al calendario y se está escribiendo.",
    work: "Escribir hook (0-3s), estructura y CTA. Aquí ayuda ✦ Generar con Hermes.",
    next: "grabacion",
    sla: 7,
  },
  grabacion: {
    status: "grabacion",
    label: "Grabación",
    meaning: "El guion está listo; falta el material. Esto es lo que se graba en el próximo batch.",
    work: "Grabar las tomas y marcar el veredicto de cada una (buena / revisar / descartada).",
    next: "edicion",
    sla: 10,
  },
  edicion: {
    status: "edicion",
    label: "Edición",
    meaning: "Hay material crudo; se está armando el corte.",
    work: "Vincular los crudos, marcar puntos de edición y correr la edición automática (OpenMontage) o exportar el master a mano.",
    next: "programado",
    sla: 7,
  },
  programado: {
    status: "programado",
    label: "Programado",
    meaning: "El video está terminado y esperando su fecha. Es el colchón del calendario.",
    work: "Escribir el copy por red (el hook se reescribe SIEMPRE) y dejar la fecha puesta.",
    next: "publicado",
    sla: null,
  },
  publicado: {
    status: "publicado",
    label: "Publicado",
    meaning: "Salió. Solo queda leer cómo se comportó.",
    work: "Marcar cada variante como publicada y anotar qué funcionó para el radar.",
    next: null,
    sla: null,
  },
  descartada: {
    status: "descartada",
    label: "Descartada",
    meaning: "Muerta a propósito. Se queda archivada para no volver a proponerla.",
    work: "Nada — si vuelve a servir, restáurala a idea.",
    next: null,
    sla: null,
  },
};

/** Criterio de salida de una etapa: comprobado contra el dato real. */
export interface StageGate {
  label: string;
  done: boolean;
  /** Dónde se resuelve en la UI (tab del workspace o campo del header). */
  where: string;
}

const words = (md: string | null): number => (md?.trim() ? md.trim().split(/\s+/).length : 0);

/** Qué le falta a la pieza para salir de su etapa actual. */
export function stageGates(piece: ContentPiece): StageGate[] {
  switch (piece.status) {
    case "idea":
      return [
        {
          label: "Plataforma destino elegida",
          done: piece.platforms.length > 0,
          where: "cabecera",
        },
        { label: "Fecha objetivo puesta", done: Boolean(piece.publish_at), where: "cabecera" },
        {
          label: "Ángulo escrito (hook o nota)",
          done: Boolean(piece.hook?.trim() || piece.notes?.trim()),
          where: "tab Guion",
        },
      ];
    case "guion": {
      // Vertical: cuentan las palabras HABLADAS (parser de beats), no todo el
      // markdown — la espec es ~90-120 dichas a cámara (system prompt de
      // generate.ts) y contar marcas de tiempo y cues inflaba el número.
      // Piso en 80: los guiones reales al aire rondan 82-185 habladas.
      // Pilar/post/carrusel se escriben como esquema o texto: ahí manda el total.
      const isVertical = piece.format === "vertical";
      const parsed = isVertical ? parseScript(piece.script_md) : null;
      // CTA sobre el CIERRE real, no sobre todo el guion: un "## CTA" vacío ya
      // no pasa, y la pregunta final a comentarios (el CTA del mes 1 de la
      // estrategia) ya no falla. En formatos sin beats confiables se mantiene
      // la búsqueda en todo el texto.
      const closing = parsed
        ? parsed.beats
            .filter((b) => b.say.length)
            .slice(-2)
            .map((b) => b.say.join(" "))
            .join(" ")
        : (piece.script_md ?? "");
      const ctaDone = closing
        ? CTA_RE.test(closing) || (parsed != null && /[?？]|👇/.test(closing))
        : false;
      return [
        { label: "Hook de 0-3s escrito", done: Boolean(piece.hook?.trim()), where: "tab Guion" },
        parsed
          ? {
              label: "Guion completo (≥80 palabras habladas)",
              done: parsed.words >= 80,
              where: "tab Guion",
            }
          : {
              label: "Guion completo (≥120 palabras)",
              done: words(piece.script_md) >= 120,
              where: "tab Guion",
            },
        { label: "Cierra con CTA", done: ctaDone, where: "tab Guion" },
      ];
    }
    case "grabacion":
      return [
        { label: "Tomas registradas", done: piece.takes.length > 0, where: "tab Tomas" },
        {
          label: "Al menos una toma buena",
          done: piece.takes.some((t) => t.verdict === "buena"),
          where: "tab Tomas",
        },
      ];
    case "edicion":
      return [
        {
          label: "Crudos vinculados",
          done: piece.raw_clips.length > 0,
          where: "tab Edición",
        },
        {
          label: "Puntos de edición marcados",
          done: piece.edit_points.length > 0,
          where: "tab Edición",
        },
        {
          label: "Ninguna toma sin revisar",
          done: piece.takes.length > 0 && !piece.takes.some((t) => t.verdict === "revisar"),
          where: "tab Tomas",
        },
        {
          // El master lo sella el agente SOLO tras verificarlo en disco: sin
          // video no hay nada que programar ni que publicar.
          label: "Master renderizado",
          done: Boolean(piece.master_path),
          where: "tab Edición",
        },
      ];
    case "programado":
      return [
        {
          // Elegir las plataformas ya crea la fila de cada red (publicationRows):
          // el criterio real es tener a dónde publicar, no haber tecleado nada.
          label: "Al menos una red destino",
          done: piece.platforms.length > 0,
          where: "cabecera",
        },
        {
          // El título se hereda del hook si no escribiste uno propio, así que
          // esto solo falla si la pieza no tiene NI hook NI título.
          label: "Hay título para publicar",
          done: Boolean(piece.hook?.trim() || piece.title.trim()),
          where: "tab Guion",
        },
        {
          // La descripción NO se hereda (effectiveCopy respalda con "") y así
          // salió un Short sin descripción (TFYDBmye6nI, 2026-08-10). La regla
          // transmedia deja de ser un consejo de prompt: es un criterio.
          label: "Copy propio en cada red automática",
          done: publicationRows(piece)
            .filter((p) => PLATFORM_PROVIDER[p.platform] !== "manual")
            .every((p) => Boolean(p.copy?.trim())),
          where: "tab Publicación",
        },
        { label: "Fecha de publicación puesta", done: Boolean(piece.publish_at), where: "cabecera" },
      ];
    case "publicado":
      return [
        {
          label: "Todas las redes marcadas como publicadas",
          done:
            piece.publications.length > 0 &&
            piece.publications.every((p) => p.status === "publicada"),
          where: "tab Publicación",
        },
        {
          // Solo cuenta lo que una API confirmó (o lo que el dueño subió a mano y
          // marcó). Una variante en error o a medio subir NO cierra la pieza.
          label: "Ninguna red en error",
          done: !piece.publications.some(
            (p) => p.publish_state === "error" || p.publish_state === "subiendo",
          ),
          where: "tab Publicación",
        },
      ];
    default:
      return [];
  }
}

/**
 * Avance de TODO el pipeline (idea → publicado), honesto con el modelo:
 * las etapas ya pasadas cuentan completas (pasarlas fue una decisión humana)
 * y la etapa actual aporta su fracción REAL de criterios cumplidos — nunca
 * un porcentaje inventado. `null` = descartada (no está en el pipeline).
 */
export function pipelineProgress(piece: ContentPiece): number | null {
  if (piece.status === "descartada") return null;
  const idx = CONTENT_STAGES.indexOf(piece.status);
  if (idx < 0) return null;
  const { done, total } = stageProgress(piece);
  const fraction = total > 0 ? done / total : 0;
  return Math.min(1, (idx + fraction) / CONTENT_STAGES.length);
}

/** true = cumple todo lo necesario para avanzar a la siguiente etapa. */
export function stageReady(piece: ContentPiece): boolean {
  const gates = stageGates(piece);
  return gates.length > 0 && gates.every((g) => g.done);
}

export function stageProgress(piece: ContentPiece): { done: number; total: number } {
  const gates = stageGates(piece);
  return { done: gates.filter((g) => g.done).length, total: gates.length };
}

export function nextStage(status: ContentStatus): ContentStatus | null {
  return STAGES[status].next;
}

/** Días (con decimal) que lleva la pieza en su etapa actual. */
export function daysInStage(piece: ContentPiece, now = Date.now()): number | null {
  const since = piece.status_since ?? piece.stage_history.at(-1)?.at ?? null;
  if (!since) return null;
  const ms = now - new Date(since).getTime();
  return ms < 0 ? 0 : ms / 86_400_000;
}

/** Historial con la duración de cada etapa ya cerrada (la última sigue viva). */
export function stageDurations(
  piece: ContentPiece,
  now = Date.now(),
): { status: ContentStatus; at: string; days: number; current: boolean }[] {
  const h = piece.stage_history;
  return h.map((entry, i) => {
    const end = i + 1 < h.length ? new Date(h[i + 1].at).getTime() : now;
    return {
      status: entry.status,
      at: entry.at,
      days: Math.max(0, (end - new Date(entry.at).getTime()) / 86_400_000),
      current: i === h.length - 1,
    };
  });
}

/** Días de idea → publicado (solo con historial real de ambas puntas). */
export function leadTimeDays(piece: ContentPiece): number | null {
  const first = piece.stage_history[0];
  const published = piece.stage_history.find((e) => e.status === "publicado");
  if (!first || !published) return null;
  return (new Date(published.at).getTime() - new Date(first.at).getTime()) / 86_400_000;
}

// ── Publicación ────────────────────────────────────────────────────────

/**
 * Qué provider publica cada plataforma. Vive en shared porque lo necesitan el
 * orquestador del agente y la UI (para saber qué fila es automática).
 *
 * `youtube` y `shorts` son la MISMA subida: un vertical de ~40s en YouTube ES
 * un Short (lo decide el propio YouTube por duración y relación de aspecto,
 * no un flag de la API). Las demás siguen en manual hasta sus fases.
 */
export const PLATFORM_PROVIDER: Record<ContentPublication["platform"], PublishProvider> = {
  youtube: "youtube",
  shorts: "youtube",
  reels: "manual", // fase 2 — necesita URL pública del mp4
  tiktok: "manual", // fase 3 — bloqueada por la auditoría de TikTok
  linkedin: "manual",
  x: "manual",
};

/**
 * Crea una variante con TODOS los campos de publicación puestos. Única fábrica
 * — la usan la UI (＋ Variante), el generador del kit y el chat de la pieza, de
 * modo que ninguna fila nazca sin su estado de máquina.
 */
export function newPublication(
  input: Partial<ContentPublication> & { platform: ContentPublication["platform"] },
): ContentPublication {
  return {
    id: input.id ?? Math.random().toString(36).slice(2, 9),
    platform: input.platform,
    title: input.title ?? null,
    copy: input.copy ?? null,
    scheduled_at: input.scheduled_at ?? null,
    status: input.status ?? "borrador",
    provider: input.provider ?? PLATFORM_PROVIDER[input.platform],
    publish_state:
      input.publish_state ??
      (PLATFORM_PROVIDER[input.platform] === "manual" ? "manual" : "pendiente"),
    remote_id: input.remote_id ?? null,
    remote_url: input.remote_url ?? null,
    attempts: input.attempts ?? 0,
    last_attempt_at: input.last_attempt_at ?? null,
    last_error: input.last_error ?? null,
  };
}

/**
 * El texto que REALMENTE se manda a la plataforma.
 *
 * Elegir las plataformas y la fecha tiene que bastar para programar: si no
 * escribiste un título propio para esa red, se hereda del hook de la pieza (y
 * si no hay hook, del título). No es inventar nada — es material que ya
 * escribiste. La UI marca lo heredado y el modal de revisión muestra el texto
 * exacto antes de confirmar, así "heredado" nunca es una sorpresa.
 */
export function effectiveTitle(piece: ContentPiece, pub: ContentPublication): string {
  return pub.title?.trim() || piece.hook?.trim() || piece.title.trim();
}

/** La descripción: la de la red, o el guion como respaldo (puede ir vacía). */
export function effectiveCopy(piece: ContentPiece, pub: ContentPublication): string {
  return pub.copy?.trim() || "";
}

/** true = el texto de esta red es heredado de la pieza, no propio. */
export function isInherited(pub: ContentPublication): boolean {
  return !pub.title?.trim();
}

/**
 * Las filas que se muestran por red: las plataformas de la pieza SIEMPRE
 * tienen fila (aunque nadie la haya creado), más las publicaciones que ya
 * existen. Las virtuales se materializan al editarlas o al publicar — así
 * abrir el tab no escribe en la base por el simple hecho de mirarla.
 */
export function publicationRows(piece: ContentPiece): ContentPublication[] {
  const rows = [...piece.publications];
  for (const platform of piece.platforms) {
    const p = platform as ContentPublication["platform"];
    if (!PLATFORM_PROVIDER[p]) continue; // plataforma desconocida: se ignora
    if (rows.some((r) => r.platform === p)) continue;
    rows.push(newPublication({ platform: p, scheduled_at: piece.publish_at }));
  }
  // Primero las que se suben solas: son las que de verdad hay que revisar.
  return rows.sort(
    (a, b) =>
      Number(PLATFORM_PROVIDER[b.platform] !== "manual") -
      Number(PLATFORM_PROVIDER[a.platform] !== "manual"),
  );
}

/** Estados desde los que TIENE sentido reintentar/disparar una subida. */
const LAUNCHABLE: PublishState[] = ["pendiente", "error"];

/**
 * ¿Esta variante se puede publicar automáticamente ahora?
 * `remote_id` manda sobre todo lo demás: si ya se subió, jamás se repite.
 */
export function isPublishable(
  pub: ContentPublication,
  piece?: ContentPiece | null,
): boolean {
  if (pub.remote_id) return false;
  if (PLATFORM_PROVIDER[pub.platform] === "manual") return false;
  // Con la pieza a mano se acepta el título heredado (hook → título): elegir
  // plataforma y fecha basta. Sin ella, se exige texto propio.
  const hasText = piece
    ? Boolean(effectiveTitle(piece, pub))
    : Boolean(pub.title?.trim() || pub.copy?.trim());
  if (!hasText) return false;
  return LAUNCHABLE.includes(pub.publish_state);
}

/** Resumen por estado real para la cabecera del tab Publicación. */
export function publishSummary(piece: ContentPiece): Record<PublishState, number> {
  const out: Record<PublishState, number> = {
    pendiente: 0,
    subiendo: 0,
    programada: 0,
    publicada: 0,
    error: 0,
    manual: 0,
  };
  for (const p of piece.publications) out[p.publish_state] = (out[p.publish_state] ?? 0) + 1;
  return out;
}

/** Atascada = lleva más del SLA de su etapa sin moverse (o ya se le pasó la fecha). */
export function isStuck(piece: ContentPiece, now = Date.now()): boolean {
  if (piece.status === "publicado" || piece.status === "descartada") return false;
  if (piece.publish_at && new Date(piece.publish_at).getTime() < now) return true;
  const sla = STAGES[piece.status].sla;
  const days = daysInStage(piece, now);
  return sla != null && days != null && days > sla;
}
