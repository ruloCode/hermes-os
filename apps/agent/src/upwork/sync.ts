/**
 * Barrido de avisos de Upwork en Gmail → oportunidades puntuadas → aviso de
 * las mejores al teléfono (con borrador de propuesta).
 *
 * - Lee `from:donotreply@upwork.com subject:"New job alert" newer_than:2d`.
 * - Una oferta se guarda UNA vez (por jobId); los correos ya vistos ni se bajan.
 * - Avisa solo lo que pasa el umbral, llegó hace poco (las primeras propuestas
 *   son las que se leen) y cabe en el tope diario (3). El presupuesto general
 *   de avisos del teléfono también manda: lo que se pasa queda descartado ahí.
 * - Nunca aplica ni envía nada en Upwork.
 *
 * `dryRun`: puntúa y guarda (en el store que le pases) sin avisar ni escribir
 * borradores — para QA.
 */
import { dayKey } from "../phone/notices.js";
import { getMessage, isConfigured as gmailConfigured, listMessageIds } from "../google-gmail.js";
import { budgetLabel, parseJobAlert } from "./parse.js";
import { NOTIFY_MIN_DEFAULT, scoreJob } from "./score.js";
import { fileOpportunityStore, type Opportunity, type OpportunityStore, type ProposalDraft } from "./store.js";

export const UPWORK_QUERY = 'from:donotreply@upwork.com subject:"New job alert" newer_than:2d';
export const MAX_NOTICES_PER_DAY = 3;
/** Un aviso que llegó hace más de esto ya no se manda (la oferta se llena en horas). */
export const NOTIFY_WINDOW_MS = 6 * 60 * 60_000;

export interface PickOptions {
  nowMs: number;
  tz: string;
  min?: number;
  maxPerDay?: number;
  windowMs?: number;
}

/** Cuáles avisar ahora (puro): nuevas, sobre el umbral, recientes, dentro del tope del día; las de más puntaje primero. */
export function pickToNotify(all: readonly Opportunity[], o: PickOptions): Opportunity[] {
  const min = o.min ?? NOTIFY_MIN_DEFAULT;
  const maxPerDay = o.maxPerDay ?? MAX_NOTICES_PER_DAY;
  const windowMs = o.windowMs ?? NOTIFY_WINDOW_MS;
  const today = dayKey(new Date(o.nowMs).toISOString(), o.tz);
  const usedToday = all.filter((x) => x.notifiedAt && dayKey(x.notifiedAt, o.tz) === today).length;
  const room = Math.max(0, maxPerDay - usedToday);
  return all
    .filter((x) => x.status === "nueva" && x.score >= min && o.nowMs - x.receivedAt <= windowMs)
    .sort((a, b) => b.score - a.score || b.receivedAt - a.receivedAt)
    .slice(0, room);
}

/** El aviso del teléfono: título corto + presupuesto, motivos y link. */
export function noticeFor(o: Opportunity): { title: string; body: string } {
  const j = o.job;
  const client = [j.spent != null ? `$${j.spent} gastados` : null, j.country].filter(Boolean).join(" · ");
  const body = [
    `${budgetLabel(j.budget)}${client ? ` · ${client}` : ""}`,
    ...o.reasons.slice(0, 2).map((r) => `• ${r}`),
    "Antes de aplicar mira propuestas y Connects en la página.",
    o.draft ? `\nBorrador:\n${o.draft.text}` : "",
    j.url,
  ]
    .filter(Boolean)
    .join("\n");
  return { title: `Upwork ${o.score} · ${j.title}`.slice(0, 120), body };
}

export interface SyncDeps {
  store?: OpportunityStore;
  dryRun?: boolean;
  tz: string;
  min?: number;
  /** Manda el aviso (teléfono + Mac). Sin él, no se avisa. */
  notify?: (o: Opportunity, n: { title: string; body: string }) => Promise<void>;
  /** Escribe el borrador. Sin él (o si falla) el aviso sale sin borrador. */
  draft?: (o: Opportunity) => Promise<ProposalDraft>;
  /** Para tests: en vez de Gmail. */
  fetchAlerts?: (known: Set<string>) => Promise<{ id: string; receivedAt: number; subject: string; plain: string; html: string }[]>;
  now?: () => number;
}

export interface SyncResult {
  fetched: number;
  saved: number;
  notified: number;
  drafted: number;
  errors: string[];
  top: { jobId: string; score: number; verdict: string; title: string; budget: string; reasons: string[] }[];
}

async function gmailAlerts(known: Set<string>) {
  const ids = await listMessageIds(UPWORK_QUERY, 60);
  const out = [];
  for (const id of ids) {
    if (known.has(id)) continue;
    out.push(await getMessage(id));
  }
  return out;
}

export async function syncUpwork(deps: SyncDeps): Promise<SyncResult | null> {
  if (!deps.fetchAlerts && !gmailConfigured()) return null;
  const store = deps.store ?? fileOpportunityStore();
  const now = deps.now ?? Date.now;
  const before = await store.all();
  const knownMail = new Set(before.map((o) => o.mailId));
  const knownJob = new Set(before.map((o) => o.jobId));
  const mails = await (deps.fetchAlerts ?? gmailAlerts)(knownMail);

  const res: SyncResult = { fetched: mails.length, saved: 0, notified: 0, drafted: 0, errors: [], top: [] };
  for (const m of mails) {
    const job = parseJobAlert(m);
    if (!job || knownJob.has(job.jobId)) continue;
    const s = scoreJob(job);
    const o: Opportunity = {
      jobId: job.jobId,
      mailId: m.id,
      receivedAt: m.receivedAt,
      job,
      score: s.score,
      verdict: s.verdict,
      reasons: s.reasons,
      status: s.verdict === "descartar" ? "descartada" : "nueva",
      updatedAt: new Date(now()).toISOString(),
    };
    await store.put(o);
    knownJob.add(job.jobId);
    res.saved++;
  }

  const all = await store.all();
  if (!deps.dryRun && deps.notify) {
    for (const o of pickToNotify(all, { nowMs: now(), tz: deps.tz, min: deps.min })) {
      let next: Opportunity = { ...o };
      if (deps.draft) {
        try {
          next.draft = await deps.draft(o);
          res.drafted++;
        } catch (err) {
          res.errors.push(`borrador ${o.jobId}: ${String(err).slice(0, 120)}`);
        }
      }
      try {
        await deps.notify(next, noticeFor(next));
        next = { ...next, status: "avisada", notifiedAt: new Date(now()).toISOString(), updatedAt: new Date(now()).toISOString() };
        res.notified++;
      } catch (err) {
        res.errors.push(`aviso ${o.jobId}: ${String(err).slice(0, 120)}`);
      }
      await store.put(next);
    }
  }

  res.top = all
    .filter((o) => o.receivedAt >= now() - 2 * 24 * 60 * 60_000)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((o) => ({ jobId: o.jobId, score: o.score, verdict: o.verdict, title: o.job.title, budget: budgetLabel(o.job.budget), reasons: o.reasons.slice(0, 3) }));
  return res;
}
