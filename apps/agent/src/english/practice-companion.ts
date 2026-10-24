/**
 * Compañera en "Practicar ahora": las mismas tarjetas de la clase en vivo
 * (corregir · andamio · explicar · frase) sobre la práctica por voz con la
 * tutora de IA. Aquí no hay audio ni STT: ElevenLabs ya transcribe y el
 * browser sube cada línea final por WS (`/english/practice/ws`).
 *
 * Ayuda automática (frase/andamio/nada) cuando la tutora pregunta: la elige
 * el browser con {type:"config"} — puede llegar antes que el controller.
 *
 * Diferencias con la clase:
 * - Una compañera viva a la vez (cada una sostiene dos procesos CLI): abrir
 *   otra pestaña cierra la anterior.
 * - Las correcciones no se guardan aquí: el browser las suma a los `errors`
 *   de la sesión que guarda la tutora (end_practice_session).
 */
import {
  correctionText,
  parseCorrection,
  type AutoHelpMode,
  type LiveHelpIntent,
  type LiveSuggestion,
  type PracticeCompanionEvent,
  type PracticeCompanionMessage,
} from "@hermes/shared";
import { createFastEngine, type FastCopilotEvent } from "../meetings/live-copilot.js";
import {
  buildCorrectionSystemPrompt,
  buildHelpSystemPrompt,
  ClassCompanionController,
  CORRECTION_ID_PREFIX,
} from "./class-companion.js";
import { loadCompanionKnowledge } from "./companion-knowledge.js";
import { hasReadableText, SuggestionStreamGate, type GateOut } from "../meetings/stream-gate.js";

const SELF = "yo";
const TUTOR = "tutora";

export class PracticeCompanion {
  private controller: ClassCompanionController | null = null;
  private readonly startedAt = Date.now();
  private seq = 0;
  private closed = false;
  private autoHelp: AutoHelpMode = "full";
  private readonly gate = new SuggestionStreamGate<PracticeCompanionEvent>();

  constructor(private readonly send: (ev: PracticeCompanionEvent) => void) {}

  async init(): Promise<void> {
    const knowledge = await loadCompanionKnowledge();
    if (this.closed) return;
    const onEvent = (ev: FastCopilotEvent) => this.handleEvent(ev);
    const correct = createFastEngine(buildCorrectionSystemPrompt(knowledge, "tutor"), onEvent, {
      interrupt: false,
      maxQueue: 2,
      warmup: 'Práctica iniciada. Responde únicamente "—".',
    });
    const help = createFastEngine(buildHelpSystemPrompt(knowledge, "tutor"), onEvent, {
      warmup: 'Práctica iniciada. Responde únicamente "OK".',
    });
    if (!correct || !help) {
      correct?.destroy();
      help?.destroy();
      this.send({ type: "ready", enabled: false, reason: "capa rápida apagada (HERMES_COPILOT=off)" });
      return;
    }
    this.controller = new ClassCompanionController(correct, help, {
      autoHelp: this.autoHelp,
      otherName: "Tutora",
    });
    this.send({ type: "ready", enabled: true });
  }

  handleMessage(raw: string): void {
    let msg: PracticeCompanionMessage;
    try {
      msg = JSON.parse(raw) as PracticeCompanionMessage;
    } catch {
      return;
    }
    if (msg.type === "turn" && typeof msg.text === "string" && msg.text.trim()) {
      this.turn(msg.role === "user" ? SELF : TUTOR, msg.text.trim());
    } else if (msg.type === "partial" && typeof msg.text === "string") {
      this.controller?.onPartialOther(msg.text);
    } else if (msg.type === "help") {
      this.help(msg.intent);
    } else if (msg.type === "config" && isAutoHelp(msg.autoHelp)) {
      this.autoHelp = msg.autoHelp;
      this.controller?.setAutoHelp(msg.autoHelp);
    }
  }

  close(): void {
    this.closed = true;
    this.controller?.destroy();
    this.controller = null;
  }

  private turn(speaker: string, text: string): void {
    this.seq += 1;
    const atMs = Date.now() - this.startedAt;
    this.controller?.onTurn(
      { key: `p-${this.seq}`, speaker, text, startMs: atMs, endMs: atMs, final: true, endOfTurn: true },
      SELF,
    );
  }

  private help(intent: LiveHelpIntent | undefined): void {
    this.controller?.triggerNow(undefined, intent);
  }

  private emitGated(id: string, out: GateOut<PracticeCompanionEvent>[]): void {
    for (const o of out) {
      if (o.type === "start") this.send(o.start);
      else if (o.type === "delta") this.send({ type: "suggestion_delta", id, text: o.text });
      else this.send({ type: "suggestion_aborted", id });
    }
  }

  private handleEvent(ev: FastCopilotEvent): void {
    if (this.closed) return;
    const atMs = Date.now() - this.startedAt;
    if ("id" in ev && ev.id.startsWith(CORRECTION_ID_PREFIX)) {
      if (ev.type !== "done") return;
      const e = parseCorrection(ev.text, ev.trigger);
      if (!e) {
        // "—" = bien dicho; cualquier otra cosa es formato roto (se registra).
        if (ev.text.trim() === "—") this.send({ type: "checked", said: ev.trigger });
        else console.log(`[práctica] sin corrección: ${ev.text.slice(0, 160).replace(/\n/g, " ⏎ ")}`);
        return;
      }
      const suggestion: LiveSuggestion = {
        id: ev.id,
        kind: "corregir",
        text: correctionText(e),
        why: e.note_es ?? "",
        atMs,
        source: "fast",
      };
      this.send({ type: "suggestion", suggestion });
      return;
    }
    // Igual que en la clase: la tarjeta se abre con el primer texto legible (stream-gate.ts).
    if (ev.type === "start") {
      this.gate.start(ev.id, {
        type: "suggestion_start",
        id: ev.id,
        kind: ev.kind ?? "decir",
        trigger: ev.trigger,
        atMs,
      });
    } else if (ev.type === "delta") {
      this.emitGated(ev.id, this.gate.delta(ev.id, ev.text));
    } else if (ev.type === "aborted") {
      this.emitGated(ev.id, this.gate.aborted(ev.id));
    } else if (ev.type === "done") {
      const text = ev.text.trim();
      const shown = this.gate.done(ev.id);
      if (!hasReadableText(text)) {
        if (shown) this.send({ type: "suggestion_aborted", id: ev.id });
        return;
      }
      this.send({
        type: "suggestion_done",
        suggestion: {
          id: ev.id,
          kind: ev.kind ?? "decir",
          text,
          why: ev.trigger,
          atMs,
          manual: ev.manual || undefined,
          source: "fast",
        },
      });
    } else if (ev.type === "error") {
      console.error("[práctica]", ev.message);
    }
  }
}

export function isAutoHelp(v: unknown): v is AutoHelpMode {
  return v === "full" || v === "scaffold" || v === "off";
}

/** Una sola compañera viva: abrir otra cierra la anterior. */
let current: PracticeCompanion | null = null;

export function openPracticeCompanion(
  send: (ev: PracticeCompanionEvent) => void,
): PracticeCompanion {
  current?.close();
  const companion = new PracticeCompanion(send);
  current = companion;
  void companion.init();
  return companion;
}

export function closePracticeCompanion(companion: PracticeCompanion): void {
  companion.close();
  if (current === companion) current = null;
}
