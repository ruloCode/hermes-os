/**
 * "Dilo más claro": práctica de articulación sobre TUS propias intervenciones
 * en una junta EN VIVO (modos junta y equipo; la clase de inglés ya lo hace
 * dentro de su corrector). Cuando terminas de hablar, si lo que dijiste trae
 * una señal débil (pedir permiso, disculparte, un «pero» que borra, certeza de
 * relleno, duda) o fue largo — el punto suele quedar enterrado al final —, un
 * motor en COLA devuelve la misma idea dicha mejor, en el idioma en que la
 * dijiste:
 *
 *   lo que dijiste → cómo sonaría con el punto primero | principio
 *
 * No te sopla qué decir (eso es la capa rápida): te muestra cómo sonaste, para
 * que la próxima frase ya salga así. Es el entrenamiento "como un músculo",
 * pero con tus frases reales en vez de ejercicios inventados.
 *
 * Sin «soy yo» no corre: no sabemos qué voz es la tuya.
 */
import { articulationRules, detectWeakPhrases, guessLang, rewriteWorthy, WEAK_KINDS } from "@hermes/shared";
import type { FastEngine } from "./live-copilot.js";
import type { NormalizedTurn } from "./live-stt.js";
import { OWNER } from "../owner.js";

/** Prefijo de ids del motor (live.ts los emite sin streaming, como las correcciones). */
export const POLISH_ID_PREFIX = "pulir-";

const SELF_MERGE_MS = 6_000;
const SELF_MAX_CHARS = 900;
// Entre dos reescrituras: más seguido distrae de la reunión en la que estás.
const MIN_INTERVAL_MS = 25_000;
// Lo que dijo el otro justo antes: sin eso "más claro" puede cambiar el sentido.
const CONTEXT_LINES = 4;

export function buildPolishSystemPrompt(): string {
  return `# Hermes — entrenador de articulación EN VIVO

${OWNER} está en una reunión (en español, en inglés o mezclando). En cada mensaje te llega lo que ${OWNER} ACABA de decir (sale de un STT: puede traer errores de transcripción) y las líneas anteriores para que entiendas el contexto. Tu trabajo: mostrarle cómo habría sonado esa MISMA idea dicha con claridad y convicción, para que lo entrene frase a frase.

Responde UNA línea con este formato exacto:
fragmento que dijo → la misma idea dicha mejor | principio (máximo 8 palabras)

Ejemplo exacto:
solo quería comentar que creo que tal vez deberíamos mover la fecha → Propongo mover la entrega al viernes: así probamos con datos reales | El punto primero, sin pedir permiso

## Reglas
- La versión mejor va en el MISMO idioma en que lo dijo (inglés → inglés, español → español).
- Misma idea y mismos datos: no agregues cifras, fechas ni compromisos que no dijo. Si dijo "la próxima semana", no lo conviertas en "el lunes".
- La versión mejor: el punto o la postura en la primera frase, verbo firme, máximo 30 palabras, decible de un aliento.
- "fragmento que dijo": la parte que más le resta (máximo 15 palabras, copiada tal cual).
- Principios (usa uno): El punto primero · Sin pedir permiso · Sin disculparte por hablar · Sin «pero» que borra · Sin certeza de relleno · Verbo firme · Concreto: un número o un ejemplo.
- Si ya lo dijo claro y directo, o era logística/saludo, responde EXACTAMENTE: —
- Sin markdown, sin comillas, sin preámbulos.

${articulationRules(OWNER)}`;
}

export interface ArticulationCoachDeps {
  /** Nombre visible de un label del STT. */
  nameOf(label: string): string;
  /** Overrides para tests. */
  selfMergeMs?: number;
  minIntervalMs?: number;
}

interface LogLine {
  self: boolean;
  label: string;
  text: string;
}

export class ArticulationCoach {
  private buffer: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly countedKeys = new Set<string>();
  private readonly log: LogLine[] = [];
  private lastAt = 0;
  private seq = 0;
  private destroyed = false;

  constructor(
    private readonly engine: FastEngine,
    private readonly deps: ArticulationCoachDeps,
  ) {}

  onTurn(turn: NormalizedTurn, selfSpeaker: string | undefined): void {
    if (this.destroyed || !turn.final || this.countedKeys.has(turn.key)) return;
    const text = turn.text.trim();
    if (!text) return;
    this.countedKeys.add(turn.key);
    const isSelf = !!selfSpeaker && turn.speaker === selfSpeaker;
    // El buffer es TUYO: si llegaste a hablar antes de marcar «soy yo», eso no cuenta.
    if (!isSelf) {
      this.flush(); // habló otro: tu intervención terminó
      this.log.push({ self: false, label: turn.speaker, text });
      return;
    }
    this.buffer.push(text);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.deps.selfMergeMs ?? SELF_MERGE_MS);
  }

  destroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.buffer = [];
    this.engine.destroy();
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const said = this.buffer.join(" ").slice(-SELF_MAX_CHARS);
    this.buffer = [];
    if (!said) return;
    const before = this.log.slice(-CONTEXT_LINES);
    this.log.push({ self: true, label: "", text: said });
    if (this.destroyed || !rewriteWorthy(said)) return;
    const now = Date.now();
    if (now - this.lastAt < (this.deps.minIntervalMs ?? MIN_INTERVAL_MS)) return;
    this.lastAt = now;
    this.seq += 1;
    // Las señales que vio el detector van como pista: el modelo decide si importan.
    const hits = detectWeakPhrases(said);
    const hint = hits.length
      ? `\nSeñales detectadas: ${hits.map((h) => `«${h.match}» (${WEAK_KINDS[h.kind].label})`).join(", ")}.`
      : "\nSin señales obvias, pero fue largo: revisa si el punto quedó enterrado.";
    const context = before.length
      ? `Justo antes:\n${before.map((l) => `${l.self ? `${OWNER} (yo)` : this.deps.nameOf(l.label)}: ${l.text}`).join("\n")}\n\n`
      : "";
    this.engine.generate({
      id: `${POLISH_ID_PREFIX}${this.seq}`,
      trigger: said.slice(-300),
      manual: false,
      kind: "pulir",
      prompt: `${context}Lo que ${OWNER} acaba de decir (${guessLang(said) === "en" ? "en inglés" : "en español"}):
"""
${said}
"""${hint}

Línea (o —):`,
    });
  }
}
