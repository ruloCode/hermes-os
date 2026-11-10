/**
 * El pulso real: disco en ~/.hermes-os/pulso, fuentes de verdad del agente,
 * modelo barato vía trackedQuery("pulse") y, SOLO con HERMES_PULSE=notify, el
 * aviso al teléfono (presupuesto diario de phone/notices).
 */
import { maxCalls, pulseMode, type PulseCard } from "@hermes/shared";
import { env } from "../env.js";
import { collectPulseState } from "./collect.js";
import { judgeWithModel } from "./model.js";
import { runPulse, type PulseDeps } from "./pulse.js";
import { filePulseStore } from "./store.js";

export const pulseStore = filePulseStore();

/** Se lee en cada pasada: cambiar la variable y reiniciar basta. */
export const currentMode = () => pulseMode(process.env.HERMES_PULSE);
export const currentMaxCalls = () => maxCalls(process.env.HERMES_PULSE_MAX_CALLS);

async function noticesLeft(): Promise<number> {
  const { fileNoticeStore, usedToday: used } = await import("../phone/notices.js");
  const list = await fileNoticeStore().load();
  return Math.max(0, env.PHONE_NOTICES_PER_DAY - used(list, new Date().toISOString(), env.SCHEDULED_TZ));
}

async function notify(card: PulseCard): Promise<{ sent: boolean; reason?: string }> {
  // Import perezoso: el enlace del teléfono solo se toca si de verdad se avisa.
  const { phoneLink } = await import("../phone/link.js");
  const n = await phoneLink.notify({ title: card.title, body: `${card.text}\n\n${card.why}`, source: "agent", ref: `pulse:${card.key}` });
  if (!n) return { sent: false, reason: "sin cola de avisos" };
  if (n.status === "dropped") return { sent: false, reason: n.reason ?? "descartado" };
  return { sent: true, reason: n.status === "queued" ? "en cola hasta que el teléfono se conecte" : undefined };
}

export function realPulseDeps(): PulseDeps {
  return {
    store: pulseStore,
    collect: () => collectPulseState(new Date()),
    judge: judgeWithModel,
    notify,
    noticesLeft,
    now: () => new Date(),
    tz: env.SCHEDULED_TZ,
    mode: currentMode(),
    maxCalls: currentMaxCalls(),
  };
}

export function runRealPulse(opts: { dryRun?: boolean; fresh?: boolean; model?: boolean } = {}) {
  return runPulse(realPulseDeps(), opts);
}
