/**
 * Parser PURO de los correos "New job alert" de Upwork (donotreply@upwork.com).
 *
 * Se lee la parte text/plain, que viene con una forma estable:
 *
 *   <título cortado...>: https://www.upwork.com/jobs/~<id>?...
 *     Fixed: $100.00 · Est. time: Less than 1 month · Posted Mon, Nov 02
 *     (o)   Hourly: $20.00 - $30.00 · Est. time: 1 to 3 months · Posted …
 *   <descripción cortada>... more: https://…
 *   Skills:
 *   <skill>: https://…
 *   +4 more
 *   Payment verified · 5.0 stars · $2K spent · Canada
 *
 * Sin parte de texto se cae al HTML aplanado: el id sale igual (del link) y lo
 * demás por las mismas expresiones sobre el texto.
 *
 * El aviso NO trae cuántas propuestas lleva la oferta ni cuántos Connects
 * cuesta: eso solo está en la página de la oferta.
 */

export type UpworkBudget =
  | { type: "hourly"; min: number | null; max: number | null }
  | { type: "fixed"; amount: number };

export interface UpworkJob {
  jobId: string;
  url: string;
  title: string;
  budget: UpworkBudget | null;
  /** "Less than 1 month", "1 to 3 months"… tal cual lo dice Upwork. */
  estTime: string | null;
  description: string;
  skills: string[];
  /** El "+N more" de skills que el correo no lista. */
  moreSkills: number;
  paymentVerified: boolean | null;
  rating: number | null;
  /** Gasto histórico del cliente en USD ("$2K" → 2000). */
  spent: number | null;
  country: string | null;
}

const JOB_RE = /https:\/\/www\.upwork\.com\/jobs\/~(\d+)/;
const MONEY = String.raw`\$([\d,]+(?:\.\d+)?)`;

const money = (s: string) => Number(s.replace(/,/g, ""));

/** "$2K" → 2000 · "$2M" → 2000000 · "$637" → 637. */
export function parseSpent(s: string): number | null {
  const m = /\$([\d.,]+)\s*([KkMm])?/.exec(s);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const mult = m[2]?.toLowerCase() === "m" ? 1_000_000 : m[2]?.toLowerCase() === "k" ? 1_000 : 1;
  return Math.round(n * mult);
}

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** HTML → texto con saltos de línea donde había bloques (respaldo sin text/plain). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(p|div|tr|td|h\d|li|table)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|tr|td|h\d|li|table)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

const stripEllipsis = (s: string) => s.replace(/(\.\.\.|…)\s*$/, "").trim();

function parseBudget(line: string): UpworkBudget | null {
  const fixed = new RegExp(String.raw`Fixed(?:-price)?\s*[:•·]\s*${MONEY}`, "i").exec(line);
  if (fixed) return { type: "fixed", amount: money(fixed[1]) };
  const hourly = new RegExp(String.raw`Hourly\s*[:•·]\s*${MONEY}(?:\s*-\s*${MONEY})?`, "i").exec(line);
  if (hourly) {
    const min = money(hourly[1]);
    const max = hourly[2] ? money(hourly[2]) : min;
    // "$0.00 - $0.00" = el cliente no puso tarifa: no es un dato, es un hueco.
    if (min === 0 && max === 0) return { type: "hourly", min: null, max: null };
    return { type: "hourly", min, max };
  }
  if (/^\s*Hourly\b/i.test(line)) return { type: "hourly", min: null, max: null };
  return null;
}

/**
 * Parsea un aviso. `subject` ("New job alert: <título>") sirve de respaldo y,
 * si es más largo que el del cuerpo, gana (los dos llegan cortados).
 * Devuelve null si no hay id de oferta.
 */
export function parseJobAlert(input: { plain?: string; html?: string; subject?: string }): UpworkJob | null {
  const text = input.plain?.trim() ? input.plain : htmlToText(input.html ?? "");
  const idMatch = JOB_RE.exec(text) ?? JOB_RE.exec(input.html ?? "");
  if (!idMatch) return null;
  const jobId = idMatch[1];
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  // Título: la línea "<título>: https://www.upwork.com/jobs/~id…".
  const titleLine = lines.find((l) => JOB_RE.test(l) && /^\S.*:\s*https:\/\//.test(l) && !/^View job/i.test(l) && !/more:\s*https/i.test(l));
  let title = titleLine ? stripEllipsis(titleLine.replace(/:\s*https:\/\/\S+.*$/, "")) : "";
  const fromSubject = stripEllipsis(decodeEntities((input.subject ?? "").replace(/^New job alert:\s*/i, "")));
  if (fromSubject.length > title.length) title = fromSubject;

  const budgetIdx = lines.findIndex((l) => /^(Fixed|Hourly)\b/i.test(l));
  const budgetLine = budgetIdx >= 0 ? lines[budgetIdx] : "";
  const budget = parseBudget(budgetLine);
  const est = /Est\.?\s*time:\s*([^·•]+)/i.exec(budgetLine);

  // Descripción: lo que sigue a la línea del presupuesto hasta "Skills:" o el pie.
  let description = "";
  if (budgetIdx >= 0) {
    const rest: string[] = [];
    for (const l of lines.slice(budgetIdx + 1)) {
      if (/^Skills:?$/i.test(l) || /^Payment (un)?verified/i.test(l) || /^-{3,}$/.test(l)) break;
      if (l) rest.push(l);
    }
    description = stripEllipsis(rest.join(" ").replace(/\s*more:\s*https:\/\/\S+/i, "").replace(/\s+more\s*$/i, ""));
  }

  // Skills: líneas "<skill>: https://…/search/…" después de "Skills:".
  const skills: string[] = [];
  let moreSkills = 0;
  const skillsIdx = lines.findIndex((l) => /^Skills:?$/i.test(l));
  if (skillsIdx >= 0) {
    for (const l of lines.slice(skillsIdx + 1)) {
      const more = /^\+(\d+)\s+more$/i.exec(l);
      if (more) {
        moreSkills = Number(more[1]);
        continue;
      }
      const sk = /^(.+?):\s*https:\/\//.exec(l);
      if (sk) skills.push(decodeEntities(sk[1].trim()));
      else if (l) break;
    }
  }

  // Cliente: "Payment verified · 5.0 stars · $2K spent · Canada".
  const clientLine = lines.find((l) => /^Payment (un)?verified/i.test(l)) ?? "";
  const parts = clientLine.split(/\s*[·•]\s*/).filter(Boolean);
  const paymentVerified = clientLine ? /^Payment verified/i.test(clientLine) : null;
  const ratingPart = parts.find((p) => /stars?$/i.test(p));
  const rating = ratingPart ? Number(ratingPart.replace(/[^\d.]/g, "")) || null : null;
  const spentPart = parts.find((p) => /spent$/i.test(p));
  const spent = spentPart ? parseSpent(spentPart) : null;
  const last = parts.at(-1);
  const country = last && !/^Payment|stars?$|spent$/i.test(last) ? last : null;

  return {
    jobId,
    url: `https://www.upwork.com/jobs/~${jobId}`,
    title,
    budget,
    estTime: est ? est[1].trim() : null,
    description,
    skills,
    moreSkills,
    paymentVerified,
    rating,
    spent,
    country,
  };
}

/** Presupuesto en una línea legible: "$20–30/h", "fijo $500", "por hora (sin tarifa)". */
export function budgetLabel(b: UpworkBudget | null): string {
  if (!b) return "sin presupuesto";
  if (b.type === "fixed") return `fijo $${b.amount.toLocaleString("en-US")}`;
  if (b.min == null || b.max == null) return "por hora (sin tarifa)";
  return b.min === b.max ? `$${b.max}/h` : `$${b.min}–${b.max}/h`;
}
