import { env } from "./env.js";

/**
 * Embeddings con OpenAI text-embedding-3-small (1536 dims).
 * Si no hay OPENAI_API_KEY devolvemos null y la búsqueda cae a recencia/ILIKE.
 */
export async function embed(text: string): Promise<number[] | null> {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    if (!res.ok) {
      console.error("[hermes] embeddings error", res.status, await res.text());
      return null;
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data[0]?.embedding ?? null;
  } catch (err) {
    console.error("[hermes] embeddings fetch failed", err);
    return null;
  }
}
