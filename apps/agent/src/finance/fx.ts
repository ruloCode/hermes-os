/**
 * Tasa USD→COP para el resumen combinado (sumar ambas monedas en una sola).
 * Fuente: open.er-api.com — gratuita, sin key, actualiza a diario. Caché en
 * memoria 6h + last-known-good: si la API falla se usa la última tasa
 * conocida antes que romper el combinado (y null solo si nunca hubo tasa).
 */

export interface FxRate {
  /** COP por 1 USD. */
  rate: number;
  /** Fecha de la tasa según la API (RFC 1123). */
  as_of: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;

let cache: (FxRate & { fetchedAt: number }) | null = null;

export async function getUsdCopRate(): Promise<FxRate | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return { rate: cache.rate, as_of: cache.as_of };
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`http ${res.status}`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_utc?: string;
    };
    const rate = data.rates?.COP;
    if (data.result !== "success" || !rate || !Number.isFinite(rate)) {
      throw new Error("respuesta sin tasa COP");
    }
    cache = {
      rate,
      as_of: data.time_last_update_utc ?? new Date().toUTCString(),
      fetchedAt: Date.now(),
    };
    return { rate: cache.rate, as_of: cache.as_of };
  } catch (e) {
    console.error("[finance] fx USD→COP:", (e as Error).message);
    return cache ? { rate: cache.rate, as_of: cache.as_of } : null;
  }
}
