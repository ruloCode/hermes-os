import { env } from "./env.js";
import { isQuotaError, openaiCooling, startCooldown } from "./memoria/cooldown.js";

/**
 * Embeddings con OpenAI text-embedding-3-small (1536 dims) para las columnas
 * `embedding` de Supabase (pgvector, RPC match_knowledge).
 *
 * Solo OpenAI a propósito: las columnas son de 1.536 y el motor local de la
 * memoria v2 da 1.024 — un vector de otro modelo en esa columna rompería el
 * RPC. La búsqueda que sí funciona sin OpenAI es la del índice local
 * (memoria/), que guarda sus propios vectores.
 *
 * Sin OPENAI_API_KEY, o con la cuenta sin crédito (enfriamiento de 6 h en
 * disco, memoria/cooldown.ts), devuelve null sin llamar a nadie.
 */
export async function embed(text: string): Promise<number[] | null> {
  const [vector] = await embedBatch([text]);
  return vector ?? null;
}

/**
 * Vectoriza varios textos en una sola llamada (la API acepta arrays).
 * Devuelve un array paralelo al input; null en las posiciones que fallaron.
 * Un lote fallido no tumba los demás; uno sin crédito corta todo el resto.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!env.OPENAI_API_KEY || texts.length === 0 || openaiCooling()) return texts.map(() => null);
  const out: (number[] | null)[] = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    // La API rechaza strings vacíos dentro de un array: un espacio los salva.
    const chunk = texts.slice(i, i + BATCH).map((t) => (t || " ").slice(0, 8000));
    if (openaiCooling()) {
      out.push(...chunk.map(() => null));
      continue;
    }
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: "text-embedding-3-small", input: chunk }),
      });
      if (!res.ok) {
        const body = await res.text();
        // Sin crédito: enfría y avisa UNA vez (no una línea por lote ni por búsqueda).
        if (isQuotaError(res.status, body)) startCooldown(`HTTP ${res.status} insufficient_quota`);
        else console.error("[hermes] embeddings error", res.status, body.slice(0, 300));
        out.push(...chunk.map(() => null));
        continue;
      }
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      const byIndex = new Map(json.data.map((d) => [d.index, d.embedding]));
      chunk.forEach((_, j) => out.push(byIndex.get(j) ?? null));
    } catch (err) {
      console.error("[hermes] embeddings fetch failed", err);
      out.push(...chunk.map(() => null));
    }
  }
  return out;
}
