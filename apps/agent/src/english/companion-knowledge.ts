/**
 * Lo que la compañera de inglés (clase y práctica) sabe de ti al arrancar:
 * tus errores repetidos, quién eres (SOUL.md "Quién soy" — con esto la frase
 * usa tus datos reales en vez de [huecos]) y cómo va tu práctica. Cada fuente
 * degrada sola: sin Supabase o sin SOUL.md la compañera arranca igual.
 */
import type { CompanionKnowledge } from "./class-companion.js";
import { soulSection } from "../owner.js";
import { buildPracticeContext, recentEnglishErrors } from "./store.js";

export async function loadCompanionKnowledge(): Promise<CompanionKnowledge> {
  const [recurring, practice] = await Promise.all([
    recentEnglishErrors(8).catch(() => [] as string[]),
    buildPracticeContext().catch(() => ""),
  ]);
  return { recurring, about: soulSection("Quién soy"), practice };
}
