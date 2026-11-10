/**
 * Una pasada del pulso: recolectar → diff contra la foto anterior → reglas →
 * (si queda algo que pide juicio, hay presupuesto y no es de noche) UNA llamada
 * al modelo → validar → bandeja → (solo con HERMES_PULSE=notify) aviso.
 *
 * Todo lo externo entra por `deps`: los tests no tocan el disco real, el
 * modelo ni el teléfono. El canal de aviso real solo se usa con `notify`.
 */
import {
  addCards,
  callsToday,
  carryOver,
  decideNotice,
  diffState,
  modelCards,
  planPass,
  pulseLocal,
  quietHours,
  ruleCard,
  situations,
  stateSummary,
  sweepInbox,
  type ModelCardInput,
  type PendingSituation,
  type PulseCard,
  type PulseInbox,
  type PulseMode,
  type PulseSituation,
  type PulseState,
} from "@hermes/shared";
import type { PulseLogLine, PulseRun, PulseStore } from "./store.js";

export interface JudgeInput {
  /** Solo lo que cambió y pide juicio, numerado s1…sN. */
  situations: PulseSituation[];
  /** Resumen corto del estado (conteos). */
  summary: string;
}

export interface PulseDeps {
  store: PulseStore;
  collect: () => Promise<PulseState>;
  /** Llama al modelo. Devuelve las tarjetas que propone (vacío = «nada»). Lanza si no pudo. */
  judge: (input: JudgeInput) => Promise<ModelCardInput[]>;
  /** Canal de aviso. Solo se llama con mode=notify. */
  notify: (card: PulseCard) => Promise<{ sent: boolean; reason?: string }>;
  /** Avisos que quedan hoy en el presupuesto del teléfono. */
  noticesLeft: () => Promise<number>;
  now: () => Date;
  tz: string;
  mode: PulseMode;
  maxCalls: number;
}

export interface PulseResult {
  ok: true;
  skipped?: string;
  dryRun: boolean;
  /** Qué fuentes respondieron y cuáles fallaron. */
  sources?: { ok: string[]; failed: string[] };
  added: string[];
  resolved: string[];
  model: PulseLogLine["model"] | null;
  /** Tarjetas que entraron (o entrarían, en dryRun). */
  cards: PulseCard[];
  inbox: { live: number; urgent: number };
}

/** Una pasada a la vez: el job y un POST /pulse/run no se pisan. */
let running: Promise<PulseResult> | null = null;

export function runPulse(deps: PulseDeps, opts: { dryRun?: boolean; fresh?: boolean; model?: boolean } = {}): Promise<PulseResult> {
  if (deps.mode === "off") {
    return Promise.resolve({ ok: true, skipped: "apagado (HERMES_PULSE=off)", dryRun: !!opts.dryRun, added: [], resolved: [], model: null, cards: [], inbox: { live: 0, urgent: 0 } });
  }
  if (running) return running;
  running = pass(deps, opts).finally(() => {
    running = null;
  });
  return running;
}

async function pass(deps: PulseDeps, opts: { dryRun?: boolean; fresh?: boolean; model?: boolean }): Promise<PulseResult> {
  const dryRun = !!opts.dryRun;
  const now = deps.now();
  const today = pulseLocal(now, deps.tz).date;
  const memory = await deps.store.loadMemory();
  let inbox: PulseInbox = await deps.store.loadInbox();
  const prev = opts.fresh ? null : memory.snapshot;

  const next = carryOver(prev, await deps.collect());
  const diff = diffState(prev, next, deps.tz);
  const current = situations(next, deps.tz);
  inbox = sweepInbox(inbox, now, diff.resolved);

  const quiet = quietHours(now, deps.tz);
  const used = callsToday(memory.calls, today);
  const plan = planPass({
    diff,
    current,
    pending: opts.fresh ? [] : memory.pending,
    inbox,
    quiet,
    callsToday: used,
    maxCalls: opts.model === false ? 0 : deps.maxCalls,
  });

  const incoming: PulseCard[] = plan.rule.map((s) => ruleCard(s, now)).filter((c): c is PulseCard => !!c);
  let pending: PendingSituation[] = plan.pending;
  let model: PulseLogLine["model"] = {
    called: false,
    reason: opts.model === false && plan.holdReason === "tope" ? "modelo apagado en esta pasada" : plan.holdReason,
    waiting: pending.map((p) => p.key),
  };
  let calls = memory.calls && memory.calls.day === today ? memory.calls : { day: today, count: 0 };

  if (plan.judge.length) {
    const t0 = Date.now();
    calls = { day: today, count: calls.count + 1 };
    try {
      const raw = await deps.judge({ situations: plan.judge, summary: stateSummary(next, deps.tz) });
      const { cards, rejected } = modelCards(raw, plan.judge, now);
      incoming.push(...cards);
      model = { called: true, keys: plan.judge.map((s) => s.key), ms: Date.now() - t0, cards: cards.map((c) => c.key), rejected };
    } catch (err) {
      // Lo que no se pudo revisar vuelve a esperar (con tope de intentos en planPass).
      pending = [...plan.judge.map((s) => ({ ...s, attempts: s.attempts + 1 })), ...pending];
      model = { called: true, keys: plan.judge.map((s) => s.key), ms: Date.now() - t0, cards: [], rejected: [], error: String((err as Error)?.message ?? err).slice(0, 200) };
    }
  }

  const { inbox: withCards, added } = addCards(inbox, incoming);
  inbox = withCards;

  // Aviso: solo lo urgente, solo con notify, solo con presupuesto. En dryRun nunca.
  const notices: PulseLogLine["notices"] = [];
  if (deps.mode === "notify" && !dryRun) {
    let left = added.some((c) => c.urgent) ? await deps.noticesLeft().catch(() => 0) : 0;
    for (const card of added) {
      if (!card.urgent) continue;
      const d = decideNotice({ mode: deps.mode, card, quiet, noticesLeft: left });
      let sent = false;
      let reason = d.reason;
      if (d.send) {
        const r = await deps.notify(card).catch((err) => ({ sent: false, reason: String((err as Error)?.message ?? err) }));
        sent = r.sent;
        if (sent) left--;
        else reason = r.reason ?? "el canal no lo aceptó";
      }
      card.notice = { sent, reason };
      const live = inbox.cards.find((c) => c.id === card.id);
      if (live) live.notice = card.notice;
      notices.push({ key: card.key, sent, reason });
    }
  } else {
    for (const card of added.filter((c) => c.urgent)) {
      const reason = dryRun ? "ensayo (dryRun): no se avisa" : decideNotice({ mode: deps.mode, card, quiet, noticesLeft: 0 }).reason;
      notices.push({ key: card.key, sent: false, reason });
    }
  }

  const line: PulseLogLine = {
    at: now.toISOString(),
    mode: deps.mode,
    dryRun,
    sources: next.sources,
    added: diff.added.map((s) => s.key),
    resolved: diff.resolved,
    rule: plan.rule.map((s) => s.key),
    model,
    notices,
  };
  const run: PulseRun = {
    at: now.toISOString(),
    model: model.called,
    ...(model.called ? (model.error ? { reason: `falló: ${model.error}` } : {}) : model.reason ? { reason: model.reason } : {}),
    added: diff.added.length,
    cards: added.length,
  };

  if (!dryRun) {
    await deps.store.saveInbox(inbox);
    await deps.store.saveMemory({ snapshot: next, pending, calls, lastRun: run });
    await deps.store.appendLog(line);
  }

  return {
    ok: true,
    dryRun,
    sources: next.sources,
    added: line.added,
    resolved: line.resolved,
    model,
    cards: added,
    inbox: { live: inbox.cards.length, urgent: inbox.cards.filter((c) => c.urgent).length },
  };
}
