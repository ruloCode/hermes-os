import { env } from "./env.js";

/**
 * Embeddings con OpenAI text-embedding-3-small (1536 dims).
 * Si no hay OPENAI_API_KEY devolvemos null y la búsqueda cae a recencia/ILIKE.
 */
export async function embed(text: string): Promise<number[] | null> {
  const [vector] = await embedBatch([text]);
  return vector ?? null;
}

/**
 * Vectoriza varios textos en una sola llamada (la API acepta arrays).
 * Devuelve un array paralelo al input; null en las posiciones que fallaron.
 * Un lote fallido no tumba los demás.
 */
export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  if (!env.OPENAI_API_KEY || texts.length === 0) return texts.map(() => null);
  const out: (number[] | null)[] = [];
  const BATCH = 64;
  for (let i = 0; i < texts.length; i += BATCH) {
    // La API rechaza strings vacíos dentro de un array: un espacio los salva.
    const chunk = texts.slice(i, i + BATCH).map((t) => (t || " ").slice(0, 8000));
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
        console.error("[hermes] embeddings error", res.status, await res.text());
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
