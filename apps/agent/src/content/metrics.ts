/**
 * Bucle de resultados del Estudio (migración 022): trae métricas REALES de las
 * publicaciones y las guarda como snapshots idempotentes. Nada estimado — si
 * la API no da el dato, la fila no existe y la UI no pinta nada.
 *
 * Dos fuentes YouTube, con semántica DISTINTA (la columna `source` las separa):
 *  - 'youtube-data'      → acumulado del video AL DÍA de la fila (videos.list,
 *                          scope youtube.readonly, ya consentido → funciona hoy).
 *  - 'youtube-analytics' → incrementos POR día + retención media (Analytics API,
 *                          scope yt-analytics.readonly — exige re-consentir una
 *                          vez; hasta entonces el sync lo salta con aviso).
 *
 * El job `content-metrics-sync` sigue el patrón de publishSweep: estado en
 * Postgres, upsert por (remote_id, source, day) — correr dos veces el mismo
 * día no duplica nada y un reinicio no pierde nada.
 */
import { effectiveTitle } from "@hermes/shared";
import type {
  ContentMetricRow,
  ContentPiece,
  HookPerformanceRow,
  PieceMetrics,
} from "@hermes/shared";
import { supabase } from "../supabase.js";
import { getPiece, listPieces } from "./store.js";
import * as youtube from "./providers/youtube.js";
import * as analytics from "./providers/youtube-analytics.js";

/** Publicaciones que tienen algo que medir: subidas por el provider de YouTube. */
function measurable(piece: ContentPiece): { pubId: string; platform: string; remoteId: string }[] {
  return piece.publications
    .filter((p) => p.remote_id && (p.platform === "youtube" || p.platform === "shorts"))
    .map((p) => ({ pubId: p.id, platform: p.platform, remoteId: p.remote_id as string }));
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Día desde el que pedir Analytics: 2 días antes del último sincronizado
 *  (los datos recientes llegan tarde y se corrigen), o el día de la pieza. */
async function analyticsStart(remoteId: string, piece: ContentPiece): Promise<string> {
  if (supabase) {
    const { data } = await supabase
      .from("content_metrics")
      .select("day")
      .eq("remote_id", remoteId)
      .eq("source", "youtube-analytics")
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.day) {
      const d = new Date(String(data.day));
      d.setDate(d.getDate() - 2);
      return d.toISOString().slice(0, 10);
    }
  }
  return (piece.publish_at ?? piece.created_at).slice(0, 10);
}

export interface MetricsSweepResult {
  videos: number;
  rows: number;
  retentionPoints: number;
  /** null = Analytics corrió; si no, el porqué accionable (falta el scope…). */
  analyticsSkipped: string | null;
  /** Fallo de la Data API (acumulado), accionable — p.ej. token sin scopes. */
  dataError: string | null;
}

/** Barrido completo: todas las piezas con publicaciones remotas. */
export async function metricsSweep(): Promise<MetricsSweepResult | null> {
  if (!supabase || !youtube.isConfigured()) return null;
  const targets = (await listPieces())
    .flatMap((piece) => measurable(piece).map((m) => ({ piece, ...m })))
    // Un video puede estar en dos variantes (youtube+shorts son la misma subida):
    // se mide una sola vez por remote_id.
    .filter((t, i, all) => all.findIndex((x) => x.remoteId === t.remoteId) === i);
  if (!targets.length)
    return { videos: 0, rows: 0, retentionPoints: 0, analyticsSkipped: null, dataError: null };

  const result: MetricsSweepResult = {
    videos: targets.length,
    rows: 0,
    retentionPoints: 0,
    analyticsSkipped: null,
    dataError: null,
  };
  const day = today();

  // 1) Acumulado barato (Data API): una llamada para todos los videos.
  try {
    const stats = await youtube.fetchVideoStats(targets.map((t) => t.remoteId));
    for (const t of targets) {
      const s = stats.get(t.remoteId);
      if (!s) continue;
      const { error } = await supabase.from("content_metrics").upsert(
        {
          piece_id: t.piece.id,
          publication_id: t.pubId,
          platform: t.platform,
          remote_id: t.remoteId,
          source: "youtube-data",
          day,
          views: s.views,
          likes: s.likes,
          comments: s.comments,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "remote_id,source,day" },
      );
      if (error) console.error("[content] metrics upsert:", error.message);
      else result.rows++;
    }
  } catch (err) {
    // El caso típico: token consentido antes de ampliar scopes → falta
    // youtube.readonly. Se dice en el resultado del job, no solo en el log.
    result.dataError = /insufficient/i.test(String(err))
      ? "el token de Google no tiene youtube.readonly — corre `pnpm --filter @hermes/agent google:auth` y pega el refresh token nuevo"
      : String(err).slice(0, 160);
    console.error("[content] metrics data-api:", String(err).slice(0, 160));
  }

  // 2) Lo fino (Analytics API): por día + curva de retención. Si el token no
  //    tiene el scope, se anota el porqué y se sigue — la parte 1 ya corrió.
  for (const t of targets) {
    if (result.analyticsSkipped) break;
    try {
      const start = await analyticsStart(t.remoteId, t.piece);
      const daily = await analytics.fetchDailyMetrics(t.remoteId, start, day);
      for (const row of daily) {
        const { error } = await supabase.from("content_metrics").upsert(
          {
            piece_id: t.piece.id,
            publication_id: t.pubId,
            platform: t.platform,
            remote_id: t.remoteId,
            source: "youtube-analytics",
            day: row.day,
            views: row.views,
            engaged_views: row.engagedViews,
            avg_view_duration_s: row.averageViewDuration,
            avg_view_pct: row.averageViewPercentage,
            watch_time_s: row.watchTimeSeconds,
            likes: row.likes,
            comments: row.comments,
            shares: row.shares,
            subs_gained: row.subscribersGained,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "remote_id,source,day" },
        );
        if (error) console.error("[content] metrics upsert:", error.message);
        else result.rows++;
      }

      const curve = await analytics.fetchRetention(
        t.remoteId,
        (t.piece.publish_at ?? t.piece.created_at).slice(0, 10),
        day,
      );
      if (curve.length) {
        const { error } = await supabase.from("content_retention").upsert(
          curve.map((p) => ({
            remote_id: t.remoteId,
            elapsed_ratio: p.elapsedRatio,
            watch_ratio: p.watchRatio,
            rel_performance: p.relativePerformance,
            fetched_at: new Date().toISOString(),
          })),
          { onConflict: "remote_id,elapsed_ratio" },
        );
        if (error) console.error("[content] retention upsert:", error.message);
        else result.retentionPoints += curve.length;
      }
    } catch (err) {
      if (err instanceof analytics.AnalyticsScopeError) {
        result.analyticsSkipped = err.message;
      } else {
        console.error("[content] metrics analytics:", String(err).slice(0, 160));
      }
    }
  }
  return result;
}

/** Métricas de UNA pieza para la sección Resultados del tab Publicación. */
export async function getPieceMetrics(pieceId: number): Promise<PieceMetrics | null> {
  if (!supabase) return null;
  const piece = await getPiece(pieceId);
  if (!piece) return null;
  const available = youtube.isConfigured();
  const remoteIds = [...new Set(measurable(piece).map((m) => m.remoteId))];
  if (!remoteIds.length)
    return {
      available,
      rows: [],
      retention: [],
      hint: "la pieza no tiene publicaciones con id remoto todavía",
    };

  const [rowsRes, retRes] = await Promise.all([
    supabase
      .from("content_metrics")
      .select("*")
      .eq("piece_id", pieceId)
      .order("day", { ascending: true }),
    supabase
      .from("content_retention")
      .select("remote_id,elapsed_ratio,watch_ratio,rel_performance")
      .in("remote_id", remoteIds)
      .order("elapsed_ratio", { ascending: true }),
  ]);
  const rows = (rowsRes.data ?? []).map(rowToMetric);
  return {
    available,
    rows,
    retention: (retRes.data ?? []).map((r: Record<string, unknown>) => ({
      elapsed_ratio: Number(r.elapsed_ratio),
      watch_ratio: r.watch_ratio == null ? null : Number(r.watch_ratio),
      rel_performance: r.rel_performance == null ? null : Number(r.rel_performance),
    })),
    hint: rows.length
      ? null
      : available
        ? "sin datos todavía — el sync corre cada 6 h; si AUTOMATIZACIONES marca scopes faltantes, corre `pnpm --filter @hermes/agent google:auth`"
        : "faltan GOOGLE_OAUTH_* en el .env — corre `pnpm --filter @hermes/agent google:auth`",
  };
}

function rowToMetric(r: Record<string, unknown>): ContentMetricRow {
  const n = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    day: String(r.day),
    source: r.source as ContentMetricRow["source"],
    platform: String(r.platform),
    remote_id: String(r.remote_id),
    views: n(r.views),
    engaged_views: n(r.engaged_views),
    avg_view_duration_s: n(r.avg_view_duration_s),
    avg_view_pct: n(r.avg_view_pct),
    watch_time_s: n(r.watch_time_s),
    likes: n(r.likes),
    comments: n(r.comments),
    shares: n(r.shares),
    saves: n(r.saves),
    subs_gained: n(r.subs_gained),
    fetched_at: String(r.fetched_at),
  };
}

const normText = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Biblioteca de hooks con dato: qué hook SALIÓ realmente a cada red (título
 * efectivo de la variante publicada) y cómo le fue. El `hook_kind` se resuelve
 * contra el pool de variantes de la pieza (la que coincide con el texto que
 * quedó activo); sin coincidencia queda null — jamás se inventa la etiqueta.
 */
export async function hookPerformance(): Promise<HookPerformanceRow[]> {
  if (!supabase) return [];
  const pieces = await listPieces();
  const targets = pieces.flatMap((piece) =>
    piece.publications
      .filter((p) => p.remote_id)
      .map((p) => ({ piece, pub: p, remoteId: p.remote_id as string })),
  );
  if (!targets.length) return [];

  const { data } = await supabase
    .from("content_metrics")
    .select("*")
    .in("remote_id", [...new Set(targets.map((t) => t.remoteId))])
    .order("day", { ascending: false });
  // La fila más fresca por (remote_id), prefiriendo Analytics sobre el acumulado.
  const latest = new Map<string, ContentMetricRow>();
  for (const raw of data ?? []) {
    const row = rowToMetric(raw as Record<string, unknown>);
    const prev = latest.get(row.remote_id);
    if (!prev || (prev.source !== "youtube-analytics" && row.source === "youtube-analytics"))
      latest.set(row.remote_id, row);
  }

  const out: HookPerformanceRow[] = [];
  for (const t of targets) {
    const m = latest.get(t.remoteId);
    if (!m) continue; // sin dato no hay fila: nada de tarjetas vacías
    const hook = effectiveTitle(t.piece, t.pub);
    const variant = t.piece.variants.find(
      (v) => v.part === "hook" && normText(v.text) === normText(hook),
    );
    out.push({
      piece_id: t.piece.id,
      title: t.piece.title,
      hook,
      hook_kind: variant?.hook_kind ?? null,
      platform: t.pub.platform,
      remote_id: t.remoteId,
      day: m.day,
      views: m.views,
      engaged_views: m.engaged_views,
      avg_view_pct: m.avg_view_pct,
      subs_gained: m.subs_gained,
    });
  }
  return out.sort((a, b) => (b.engaged_views ?? b.views ?? 0) - (a.engaged_views ?? a.views ?? 0));
}
