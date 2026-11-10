/**
 * Puntaje PURO de una oferta de Upwork contra el nicho del dueño (0-100) con
 * motivos legibles en español.
 *
 * Reglas (de la guía de propuestas, que vive fuera del repo):
 * - Nicho: agentes de IA, RAG, MCP, Claude/Claude Code, rescatar apps hechas
 *   con IA (Lovable, Bolt, Replit, v0, Cursor) y Next.js + Supabase.
 * - Precio: nunca bajo $30/h; precio fijo chico y cerrado ($150-500) sirve
 *   para las primeras reseñas; $5-20 (o cualquier fijo < $50) se descarta.
 * - Fuera de lo que vende: apps móviles nativas, WordPress/PHP/Shopify de
 *   plantilla, data entry, SEO, ventas/soporte.
 * - Pruebas gratis = descarte.
 *
 * Las palabras clave son genéricas (no hay datos personales aquí): el perfil y
 * las cifras del dueño solo entran al borrador, leídos de ~/.hermes-os/upwork.
 *
 * Lo que el correo no trae (propuestas, entrevistas, Connects) NO se adivina:
 * se revisa en la página antes de aplicar.
 */
import type { UpworkJob } from "./parse.js";

export type UpworkVerdict = "aplicar" | "revisar" | "descartar";

export interface UpworkScore {
  score: number;
  verdict: UpworkVerdict;
  /** Por qué, en orden de peso: primero lo que suma, luego lo que resta. */
  reasons: string[];
  /** Grupos de nicho que encajaron (ids estables). */
  niche: string[];
  /** Algo que la descarta por sí solo. */
  discard: string | null;
}

interface NicheGroup {
  id: string;
  label: string;
  weight: number;
  terms: RegExp;
}

// \b no funciona bien con "next.js" o "v0": cada término lleva sus bordes.
const NICHE: NicheGroup[] = [
  {
    id: "agentes",
    label: "agentes de IA",
    weight: 15,
    terms: /\b(ai agents?|agentic|multi-?agent|agent architect|llm|langgraph|langchain|openai|anthropic|claude(?! code))\b/i,
  },
  { id: "claude-code", label: "Claude Code / coding agents", weight: 12, terms: /\b(claude code|coding agents?|ai[- ]native|codex)\b/i },
  { id: "rag", label: "RAG / chatbot", weight: 12, terms: /\b(rag|retrieval|vector (db|database|store)|embeddings?|pgvector|chatbots?|chat with (your )?(docs|documents))\b/i },
  { id: "mcp", label: "MCP", weight: 15, terms: /\b(mcp|model context protocol)\b/i },
  {
    id: "rescate",
    label: "llevar a producción una app hecha con IA",
    weight: 15,
    terms: /\b(lovable|bolt(\.new)?|replit|v0|cursor|vibe[- ]cod\w*|ai[- ](built|generated)|prototypes? (in|to) production|production[- ]ready|to production|finish (two|the|our)? ?\w* ?apps?|80% ?(built|done))\b/i,
  },
  {
    id: "seguridad",
    label: "seguridad / endurecer (RLS, auditoría)",
    weight: 12,
    terms: /\b(rls|row[- ]level security|security (audit|review)|harden(ing)?|vulnerabilit(y|ies)|owasp|code audit)\b/i,
  },
  { id: "salud", label: "salud / educación", weight: 8, terms: /\b(healthcare|clinical|hospital|patients?|lms|e-?learning|education platform)\b/i },
  { id: "rendimiento", label: "rendimiento / checkout", weight: 8, terms: /\b(core web vitals|lighthouse|page speed|performance optimi[sz]ation|checkout)\b/i },
  { id: "automatizacion", label: "automatización (n8n)", weight: 6, terms: /\b(n8n|workflow automation)\b/i },
];

const STACK = /\b(next\.?js|supabase|typescript|react|postgres(ql)?|vercel|tailwind|node\.?js)\b/gi;

// Lo que no vende: pesa fuerte si es el núcleo del trabajo.
const OFF_NICHE: { label: string; terms: RegExp }[] = [
  { label: "app móvil nativa", terms: /\b(flutter|swift(ui)?|kotlin|react native|ios app|android app|mobile app developer)\b/i },
  { label: "WordPress/PHP/Shopify", terms: /\b(wordpress|php|laravel|shopify|wix|webflow|elementor|woocommerce)\b/i },
  { label: "data entry / SEO / ventas", terms: /\b(data entry|seo specialist|cold calling|appointment setter|virtual assistant|lead generation)\b/i },
  { label: "stack ajeno (Python ML / .NET / Java / MERN genérico)", terms: /\b(django|\.net|c#|java(?!script)|spring boot|mern|mongodb|machine learning engineer)\b/i },
];

const FREE_WORK = /\b(unpaid|free (trial|test)|test task (is )?unpaid|trial (task|period) (is )?unpaid|without payment)\b/i;

export const NOTIFY_MIN_DEFAULT = 70;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function scoreJob(job: UpworkJob): UpworkScore {
  const text = `${job.title}\n${job.description}\n${job.skills.join(" · ")}`;
  const plus: string[] = [];
  const minus: string[] = [];
  let score = 30;
  let discard: string | null = null;

  // ── Nicho ───────────────────────────────────────────────────────────
  const niche: string[] = [];
  let nichePts = 0;
  for (const g of NICHE) {
    if (g.terms.test(text)) {
      niche.push(g.id);
      nichePts += g.weight;
    }
  }
  const stack = new Set((text.match(STACK) ?? []).map((s) => s.toLowerCase().replace(/\.?js$/, "js").replace("postgresql", "postgres")));
  if (stack.size >= 2) nichePts += 10;
  else if (stack.size === 1) nichePts += 5;
  nichePts = Math.min(nichePts, 50);
  score += nichePts;
  if (niche.length) plus.push(`Encaja con tu nicho: ${NICHE.filter((g) => niche.includes(g.id)).map((g) => g.label).join(", ")}`);
  if (stack.size) plus.push(`Tu stack: ${[...stack].join(", ")}`);
  if (!niche.length && stack.size === 0) minus.push("No toca tu nicho (agentes, RAG, MCP, rescate de apps con IA, Next.js/Supabase)");

  for (const o of OFF_NICHE) {
    if (o.terms.test(text)) {
      // Si además pide tu nicho, es secundario: resta menos.
      score -= niche.length ? 12 : 35;
      minus.push(`Pide ${o.label}`);
    }
  }

  // ── Precio ──────────────────────────────────────────────────────────
  const b = job.budget;
  if (b?.type === "fixed") {
    if (b.amount < 50) {
      discard = `Precio fijo de $${b.amount}: muy por debajo de lo que vale el trabajo`;
    } else if (b.amount < 150) {
      score -= 15;
      minus.push(`Fijo de $${b.amount}, bajo tu mínimo de $150`);
    } else if (b.amount <= 500) {
      score += 6;
      plus.push(`Fijo de $${b.amount}: chico y cerrado, bueno para las primeras reseñas`);
    } else {
      score += 6;
      plus.push(`Fijo de $${b.amount.toLocaleString("en-US")}`);
    }
  } else if (b?.type === "hourly") {
    if (b.max == null) {
      minus.push("Por hora sin tarifa publicada");
    } else if (b.max < 30) {
      discard = `Tope de $${b.max}/h, bajo tu piso de $30/h`;
    } else if (b.max >= 50) {
      score += 12;
      plus.push(`Paga hasta $${b.max}/h (tu tarifa es $40)`);
    } else if (b.max >= 40) {
      score += 8;
      plus.push(`Paga hasta $${b.max}/h (tu tarifa es $40)`);
    } else {
      minus.push(`Tope de $${b.max}/h, bajo tu tarifa de $40`);
    }
    // Un rango que arranca en $3-10/h atrae a la competencia más barata.
    if (!discard && b.min != null && b.min < 15) {
      score -= 6;
      minus.push(`Rango que arranca en $${b.min}/h: compite con ofertas muy baratas`);
    }
  }

  // ── Cliente ─────────────────────────────────────────────────────────
  if (job.paymentVerified === false) {
    score -= 20;
    minus.push("Pago sin verificar");
  }
  if (job.spent != null) {
    if (job.spent >= 10_000) {
      score += 12;
      plus.push(`Cliente con historial ($${fmtK(job.spent)} gastados)`);
    } else if (job.spent >= 1_000) {
      score += 8;
      plus.push(`Cliente con gasto previo ($${fmtK(job.spent)})`);
    } else if (job.spent < 100) {
      score -= 10;
      minus.push(`Cliente casi sin historial ($${job.spent} gastados)`);
    }
  }
  if (job.rating != null) {
    if (job.rating >= 4.8) score += 3;
    else if (job.rating < 4.5) {
      score -= 5;
      minus.push(`Calificación del cliente baja (${job.rating})`);
    }
  }

  // ── Alcance ─────────────────────────────────────────────────────────
  if (job.estTime && /less than 1 month/i.test(job.estTime)) {
    score += 4;
    plus.push("Se entrega en menos de un mes");
  }
  if (FREE_WORK.test(text)) discard = "Pide trabajo de prueba sin pago";

  if (discard) {
    return { score: Math.min(clamp(score), 15), verdict: "descartar", reasons: [discard, ...plus, ...minus], niche, discard };
  }
  const final = clamp(score);
  const verdict: UpworkVerdict = final >= NOTIFY_MIN_DEFAULT ? "aplicar" : final >= 45 ? "revisar" : "descartar";
  return { score: final, verdict, reasons: [...plus, ...minus], niche, discard: null };
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
  return String(n);
}
