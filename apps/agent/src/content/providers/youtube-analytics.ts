/**
 * YouTube Analytics API v2 — la fuente FINA del bucle de resultados: métricas
 * por día (views, engagedViews, retención media, subs ganados…) y la curva de
 * retención por video (elapsedVideoTimeRatio, 100 puntos), que dice el segundo
 * exacto del abandono.
 *
 * Comparte el token OAuth del provider de subida (providers/youtube.ts) —
 * mismo refresh token, un scope más: `yt-analytics.readonly`. Si el token
 * vigente no lo tiene, la API responde 403 y aquí se traduce a un error
 * ACCIONABLE (re-correr `pnpm google:auth`); el sync degrada sin romper nada
 * y la Data API (youtube.readonly, ya consentido) sigue dando el acumulado.
 *
 * Docs: https://developers.google.com/youtube/analytics/reference/reports/query
 */
import { getAccessToken, isConfigured as uploaderConfigured } from "./youtube.js";

const QUERY_URL = "https://youtubeanalytics.googleapis.com/v2/reports";

export function isConfigured(): boolean {
  return uploaderConfigured();
}

/** Fila diaria del reporte de video (incrementos del día, no acumulados). */
export interface DailyRow {
  day: string;
  views: number | null;
  engagedViews: number | null;
  watchTimeSeconds: number | null;
  averageViewDuration: number | null;
  averageViewPercentage: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  subscribersGained: number | null;
}

export interface RetentionRow {
  elapsedRatio: number;
  watchRatio: number | null;
  relativePerformance: number | null;
}

/**
 * 403 con causa ACCIONABLE: o el token no tiene el scope (re-consentir) o la
 * API está deshabilitada en el proyecto GCP (un clic en la consola). El sync
 * la usa para reportar el porqué en el resultado del job en vez de reintentar.
 */
export class AnalyticsScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalyticsScopeError";
  }
}

function scopeError(body: string): AnalyticsScopeError {
  if (/accessNotConfigured|SERVICE_DISABLED/i.test(body))
    return new AnalyticsScopeError(
      "la YouTube Analytics API está deshabilitada en el proyecto GCP — habilítala (1 clic): https://console.developers.google.com/apis/api/youtubeanalytics.googleapis.com/overview?project=495604530384",
    );
  return new AnalyticsScopeError(
    "falta el scope yt-analytics.readonly en el token de Google — vuelve a correr `pnpm --filter @hermes/agent google:auth` y pega el refresh token nuevo",
  );
}

interface ApiReport {
  columnHeaders?: { name: string }[];
  rows?: (string | number | null)[][];
}

async function runQuery(params: Record<string, string>): Promise<ApiReport> {
  const token = await getAccessToken();
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params });
  const res = await fetch(`${QUERY_URL}?${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body = await res.text();
  if (res.status === 403) throw scopeError(body);
  if (!res.ok) throw new Error(`Analytics HTTP ${res.status} ${body.slice(0, 160)}`);
  return JSON.parse(body) as ApiReport;
}

/** Proyecta las filas posicionales de la API a objetos por nombre de columna. */
function byHeader(report: ApiReport): Record<string, string | number | null>[] {
  const headers = (report.columnHeaders ?? []).map((h) => h.name);
  return (report.rows ?? []).map((row) =>
    Object.fromEntries(headers.map((name, i) => [name, row[i] ?? null])),
  );
}

const num = (v: string | number | null | undefined): number | null =>
  v == null || v === "" ? null : Number(v);

/** Métricas por día de UN video, en [startDate, endDate] (YYYY-MM-DD). */
export async function fetchDailyMetrics(
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<DailyRow[]> {
  const report = await runQuery({
    dimensions: "day",
    metrics:
      "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,likes,comments,shares,subscribersGained",
    filters: `video==${videoId}`,
    startDate,
    endDate,
    sort: "day",
  });
  return byHeader(report).map((r) => ({
    day: String(r.day),
    views: num(r.views),
    engagedViews: num(r.engagedViews),
    watchTimeSeconds:
      num(r.estimatedMinutesWatched) == null
        ? null
        : Math.round((num(r.estimatedMinutesWatched) as number) * 60),
    averageViewDuration: num(r.averageViewDuration),
    averageViewPercentage: num(r.averageViewPercentage),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    subscribersGained: num(r.subscribersGained),
  }));
}

/**
 * Curva de retención del video (100 puntos, 0.01…1.00). El rango de fechas es
 * obligatorio para la API pero la curva es del video completo hasta hoy.
 */
export async function fetchRetention(
  videoId: string,
  startDate: string,
  endDate: string,
): Promise<RetentionRow[]> {
  const report = await runQuery({
    dimensions: "elapsedVideoTimeRatio",
    metrics: "audienceWatchRatio,relativeRetentionPerformance",
    filters: `video==${videoId};audienceType==ORGANIC`,
    startDate,
    endDate,
  });
  return byHeader(report).map((r) => ({
    elapsedRatio: Number(r.elapsedVideoTimeRatio),
    watchRatio: num(r.audienceWatchRatio),
    relativePerformance: num(r.relativeRetentionPerformance),
  }));
}
