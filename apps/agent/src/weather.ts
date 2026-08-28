/**
 * Clima para el dashboard vía Open-Meteo (https://open-meteo.com, sin API key).
 *
 * El agente actúa de proxy con cache central: N tabs/Macs consultan
 * GET /stats y todas comparten UN solo fetch upstream cada 20 minutos.
 * Lazy on-demand con lock de in-flight (llamadas concurrentes esperan la
 * misma promesa, patrón "running" de vault/knowledge-sync.ts).
 * Coordenadas y nombre del lugar salen de env (WEATHER_LAT/LON/PLACE).
 */
import type { WeatherDay, WeatherNow, WeatherReport } from "@hermes/shared";
import { env } from "./env.js";

const BASE_URL = "https://api.open-meteo.com/v1/forecast";
const TTL_MS = 20 * 60 * 1000; // 20 min: el clima no cambia más rápido que eso

/** Shape mínimo de la respuesta de Open-Meteo (solo lo que consumimos). */
interface OpenMeteoResponse {
  current?: Record<string, unknown>;
  daily?: {
    time?: unknown[];
    temperature_2m_max?: unknown[];
    temperature_2m_min?: unknown[];
    precipitation_probability_max?: unknown[];
    weather_code?: unknown[];
  };
}

let cache: WeatherReport | null = null;
let cachedAt = 0;
// Fetch en curso: las llamadas concurrentes esperan esta misma promesa.
let inFlight: Promise<WeatherReport | null> | null = null;

function buildUrl(): string {
  const params = new URLSearchParams({
    latitude: String(env.WEATHER_LAT),
    longitude: String(env.WEATHER_LON),
    current:
      "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "America/Bogota",
    forecast_days: "3",
  });
  return `${BASE_URL}?${params}`;
}

/** Número defensivo: Open-Meteo puede traer null/undefined en cualquier campo. */
function num(v: unknown): number {
  return Number(v) || 0;
}

/** Mapea la respuesta cruda de Open-Meteo al shape WeatherReport compartido. */
function toReport(data: OpenMeteoResponse): WeatherReport {
  const c = data.current ?? {};
  const now: WeatherNow = {
    tempC: num(c.temperature_2m),
    feelsLikeC: num(c.apparent_temperature),
    humidityPct: num(c.relative_humidity_2m),
    precipitationMm: num(c.precipitation),
    windKmh: num(c.wind_speed_10m),
    weatherCode: num(c.weather_code),
  };

  // daily viene como arrays paralelos: emparejamos por índice.
  const d = data.daily ?? {};
  const daily: WeatherDay[] = (d.time ?? []).map((date, i) => {
    const prob = d.precipitation_probability_max?.[i];
    return {
      date: String(date),
      minC: num(d.temperature_2m_min?.[i]),
      maxC: num(d.temperature_2m_max?.[i]),
      // null se preserva: "sin dato" ≠ "0% de probabilidad de lluvia".
      precipProbPct: prob == null ? null : num(prob),
      weatherCode: num(d.weather_code?.[i]),
    };
  });

  return {
    place: env.WEATHER_PLACE,
    fetchedAt: new Date().toISOString(),
    stale: false,
    now,
    daily,
  };
}

async function fetchWeather(): Promise<WeatherReport | null> {
  try {
    const res = await fetch(buildUrl());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as OpenMeteoResponse;
    const report = toReport(data);
    cache = report;
    cachedAt = Date.now();
    return report;
  } catch (err) {
    console.error(
      "[hermes] weather fetch",
      err instanceof Error ? err.message : err,
    );
    // Fallo upstream: mejor cache viejo marcado stale que nada; null si nunca hubo.
    return cache ? { ...cache, stale: true } : null;
  }
}

/** Clima actual + 3 días con cache central de 20 min. Nunca lanza. */
export async function getWeather(): Promise<WeatherReport | null> {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  if (!inFlight) {
    inFlight = fetchWeather().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
