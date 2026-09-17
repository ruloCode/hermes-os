// Llamadas de la Sala de Agentes: UNA sesión de ElevenLabs por agente, todas
// vivas a la vez, sobre @elevenlabs/client (sin el ConversationProvider del
// shell, que solo sabe de una). Reglas:
//
//  - FOCO = a quién le habla el micrófono. Levantar la mano hacia un agente
//    lo enfoca; los demás quedan con el mic silenciado (setMicMuted) pero
//    siguen conectados: bajar la mano NO cuelga a nadie. Cambiar de foco es
//    instantáneo (no hay reconexión).
//  - TERTULIA (a tres voces): lo que dice el humano y lo que responde el
//    agente enfocado se les cuenta a los otros por sendContextualUpdate; y por
//    cada turno del humano, cuando el enfocado TERMINA de hablar (modo
//    listening), se le pide a UN compañero que comente (sendUserMessage con
//    el marco "[tertulia] X acaba de decir…"). Su comentario vuelve al
//    enfocado solo como contexto: un comentario por turno, sin ping-pong
//    infinito, y nunca dos voces encima.
//  - Sin React: la página la crea una vez y escucha eventos; el pulso de las
//    figuras lee volume(key) por rAF.

import { VoiceConversation, type Mode, type Status } from "@elevenlabs/client";
import type { SalaAgentPublic } from "@hermes/shared";

export type SalaCallStatus = "idle" | "connecting" | Status | "error";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SalaCallEvent {
  key: string;
  kind: "status" | "message" | "mode" | "error";
  status?: SalaCallStatus;
  mode?: Mode;
  role?: "user" | "agent";
  text?: string;
}

export interface SalaCallsOptions {
  /** Token efímero del agente (ruta Next: /api/elevenlabs/token?agent=…). */
  fetchToken: (agent: SalaAgentPublic) => Promise<{ conversationToken?: string; signedUrl?: string; error?: string }>;
  /** Client tools compartidas por todas las sesiones. */
  clientTools: Record<string, (p: Record<string, unknown>) => Promise<string> | string>;
  /** Nombre del humano (para el marco de la tertulia). */
  owner: string;
  onEvent: (ev: SalaCallEvent) => void;
}

interface Line {
  conv: VoiceConversation;
  agent: SalaAgentPublic;
  status: SalaCallStatus;
  mode: Mode;
  lastAgentText: string;
}

export class SalaCalls {
  private readonly lines = new Map<string, Line>();
  private focused: string | null = null;
  private connecting = new Set<string>();
  tertulia = false;
  topic: string | null = null;
  /** Acciones que disparan una voz, en espera de que NADIE esté hablando. */
  private quietQueue: (() => void)[] = [];
  /** Comentario pendiente de la tertulia (uno por turno del humano). */
  private pendingComment: { to: string; text: string } | null = null;
  /** Primer mensaje recibido por línea (para no pisar el saludo al conectar en secuencia). */
  private readonly greeted = new Set<string>();
  /** El humano habló desde el último comentario: el próximo turno del enfocado merece réplica. */
  private roundOpen = false;
  /** Debounce del "terminó de hablar": el modo parpadea speaking/listening entre frases. */
  private quietTimer: ReturnType<typeof setTimeout> | null = null;
  /** Último texto del humano (dedupe entre say() y un eco del SDK). */
  private lastUser: { text: string; t: number } | null = null;
  /** Re-aplica los mutes tras un "listening" del compañero (parpadea entre frases). */
  private muteTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cinturón de seguridad: los mutes se re-aplican periódicamente (el SDK ignora el mute si la sala aún no está conectada). */
  private readonly muteInterval = setInterval(() => this.applyMutes(), 1500);

  constructor(private readonly opts: SalaCallsOptions) {}

  keys(): string[] {
    return [...this.lines.keys()];
  }

  status(key: string): SalaCallStatus {
    if (this.connecting.has(key)) return "connecting";
    return this.lines.get(key)?.status ?? "idle";
  }

  isConnected(key: string): boolean {
    return this.lines.get(key)?.status === "connected";
  }

  speaking(key: string): boolean {
    return this.lines.get(key)?.mode === "speaking";
  }

  volume(key: string): number {
    const l = this.lines.get(key);
    if (!l || l.status !== "connected") return 0;
    const v = l.conv.getOutputVolume();
    return Number.isFinite(v) ? v : 0;
  }

  focusedKey(): string | null {
    return this.focused;
  }

  /** Marco común que reciben todos al conectar (y el tema, si hay). */
  private framing(agent: SalaAgentPublic, others: SalaAgentPublic[]): string {
    const names = others.map((o) => o.name).join(", ");
    const parts = [
      `Estás en la Sala de Agentes 3D de ${this.opts.owner}. Eres ${agent.name} (proyecto "${agent.project}"). ${this.opts.owner} elige con quién habla levantando la mano; cuando te toque, responde tú.`,
    ];
    if (names) {
      parts.push(
        `También están conectados: ${names}. Lo que ellos digan te llegará como contexto ("X dijo: …"); los mensajes que empiecen con "[tertulia]" te piden que comentes en 1 o 2 frases lo que acaba de decir el otro agente, dirigiéndote a él o a ${this.opts.owner}. No repitas lo que ya se dijo; aporta algo nuevo.`,
      );
    }
    if (this.topic) parts.push(`Tema de la conversación: ${this.topic}.`);
    parts.push(
      "Respuestas cortas y habladas (1 a 3 frases). Es una conversación en vivo entre tres. Habla SOLO por ti: nunca digas lo que respondería el otro agente ni pongas palabras en su boca — tiene su propia voz y responderá él. Si te preguntan a los dos, di solo tu parte. Si hay una pausa, espera en silencio; no preguntes si siguen ahí.",
    );
    return parts.join("\n");
  }

  /** Conecta un agente (idempotente). Queda con el mic silenciado hasta focus(). */
  async connect(agent: SalaAgentPublic, extraDynamicVariables: Record<string, string> = {}): Promise<void> {
    const key = agent.key;
    if (this.lines.has(key) || this.connecting.has(key)) return;
    this.connecting.add(key);
    this.opts.onEvent({ key, kind: "status", status: "connecting" });
    try {
      const creds = await this.opts.fetchToken(agent);
      if (creds.error || (!creds.conversationToken && !creds.signedUrl)) {
        throw new Error(creds.error ?? "Sin credenciales de ElevenLabs");
      }
      const others = [...this.lines.values()].map((l) => l.agent);
      const framing = this.framing(agent, others);
      const today = new Intl.DateTimeFormat("es-CO", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date());
      const dynamicVariables: Record<string, string> = {
        today,
        // Hermes y los agentes propios leen {{session_scope}}; el tutor lee
        // {{practice_context}} — se mandan ambas, la que no exista se ignora.
        session_scope: framing,
        practice_context: framing,
        ...extraDynamicVariables,
      };
      const common = {
        clientTools: this.opts.clientTools,
        dynamicVariables,
        onStatusChange: ({ status }: { status: Status }) => this.setStatus(key, status),
        onModeChange: ({ mode }: { mode: Mode }) => this.setMode(key, mode),
        onMessage: ({ message, role, source }: { message: string; role?: string; source?: string }) => {
          const r = (role ?? source) === "user" ? "user" : "agent";
          this.onMessage(key, r, message);
        },
        onError: (message: string) => this.opts.onEvent({ key, kind: "error", text: message }),
        onDisconnect: () => this.setStatus(key, "disconnected"),
      };
      const conv = creds.conversationToken
        ? await VoiceConversation.startSession({ ...common, conversationToken: creds.conversationToken, connectionType: "webrtc" })
        : await VoiceConversation.startSession({ ...common, signedUrl: creds.signedUrl!, connectionType: "websocket" });
      const line: Line = { conv, agent, status: "connected", mode: "listening", lastAgentText: "" };
      this.lines.set(key, line);
      // Mic: solo el enfocado escucha; el nuevo entra callado salvo que sea el
      // primero. applyMutes se repite al conectar de verdad y cada 1,5 s: el
      // SDK descarta setMicMuted si la sala WebRTC aún no está lista.
      if (this.focused === null) this.focused = key;
      this.applyMutes();
      // Presentar al recién llegado a los que ya estaban.
      for (const other of this.lines.values()) {
        if (other.agent.key === key) continue;
        this.safeContext(other, `Se conectó ${agent.name} (proyecto "${agent.project}") a la conversación.`);
      }
      this.opts.onEvent({ key, kind: "status", status: "connected" });
    } catch (err) {
      this.opts.onEvent({ key, kind: "error", text: err instanceof Error ? err.message : String(err) });
      this.opts.onEvent({ key, kind: "status", status: "error" });
    } finally {
      this.connecting.delete(key);
    }
  }

  /**
   * Conecta varios EN SECUENCIA esperando a que cada uno termine su saludo
   * (first_message) antes de meter al siguiente: si no, dos voces arrancan
   * encima. Tope de espera por agente para no colgarse si nunca habla.
   */
  async connectAll(agents: SalaAgentPublic[], waitMs = 12000): Promise<void> {
    for (const a of agents) {
      if (this.isConnected(a.key)) continue;
      await this.connect(a);
      const t0 = performance.now();
      // Espera su primer mensaje (el saludo puede tardar varios segundos en
      // arrancar) y luego a que TODOS callen; tope para no colgarse.
      while (performance.now() - t0 < waitMs && !this.greeted.has(a.key)) await sleep(100);
      while (performance.now() - t0 < waitMs && this.anySpeaking()) await sleep(100);
      await sleep(400);
    }
  }

  private anySpeaking(): boolean {
    return [...this.lines.values()].some((l) => l.mode === "speaking");
  }

  /** Ejecuta `fn` ahora si nadie habla; si no, cuando llegue el silencio (700 ms seguidos). */
  private whenQuiet(fn: () => void): void {
    if (!this.anySpeaking()) fn();
    else this.quietQueue.push(fn);
  }

  private flushQuiet(): void {
    if (this.anySpeaking()) return;
    const q = this.quietQueue;
    this.quietQueue = [];
    // Una sola voz por silencio: la primera dispara, el resto espera al próximo.
    const first = q.shift();
    if (q.length) this.quietQueue = q;
    first?.();
  }

  /** A quién le habla el micrófono. Los demás siguen conectados, en silencio. */
  focus(key: string): void {
    if (!this.lines.has(key)) return;
    this.focused = key;
    this.applyMutes();
    this.opts.onEvent({ key, kind: "status", status: this.status(key) });
  }

  /**
   * Regla de los micrófonos, en UN solo sitio: solo el enfocado escucha, y
   * NADIE escucha mientras un compañero habla — si no, el enfocado oye el TTS
   * del otro por los parlantes y le contesta encima. Idempotente.
   */
  private applyMutes(): void {
    const partnerSpeaking = [...this.lines].some(([k, l]) => k !== this.focused && l.mode === "speaking");
    for (const [k, l] of this.lines) {
      if (l.status !== "connected") continue;
      l.conv.setMicMuted(partnerSpeaking || k !== this.focused);
    }
  }

  /** Texto del humano al agente enfocado (QA sin micrófono; también para chips). */
  say(text: string): boolean {
    const l = this.focused ? this.lines.get(this.focused) : undefined;
    if (!l || l.status !== "connected") return false;
    // Nunca encima de una voz: si alguien habla, sale al primer silencio.
    this.whenQuiet(() => {
      if (l.status !== "connected") return;
      l.conv.sendUserMessage(text);
      // El SDK no emite onMessage(user) para lo que mandamos por texto: se
      // procesa aquí como si el humano lo hubiera dicho (contexto + ronda).
      this.onMessage(l.agent.key, "user", text);
    });
    return true;
  }

  async hangup(key: string): Promise<void> {
    const l = this.lines.get(key);
    if (!l) return;
    this.lines.delete(key);
    this.greeted.delete(key);
    if (this.focused === key) this.focused = this.lines.keys().next().value ?? null;
    if (this.focused) this.focus(this.focused);
    await l.conv.endSession().catch(() => undefined);
    this.opts.onEvent({ key, kind: "status", status: "disconnected" });
  }

  async hangupAll(): Promise<void> {
    const keys = [...this.lines.keys()];
    await Promise.all(keys.map((k) => this.hangup(k)));
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (this.muteTimer) clearTimeout(this.muteTimer);
    this.muteTimer = null;
    this.pendingComment = null;
    this.quietQueue = [];
    this.greeted.clear();
    this.roundOpen = false;
  }

  /** Libera timers (al desmontar la página). */
  dispose(): void {
    clearInterval(this.muteInterval);
    void this.hangupAll();
  }

  // ── Internos ─────────────────────────────────────────────────────────

  private setStatus(key: string, status: Status): void {
    const l = this.lines.get(key);
    if (l) l.status = status;
    if (status === "connected") this.applyMutes();
    this.opts.onEvent({ key, kind: "status", status });
  }

  private setMode(key: string, mode: Mode): void {
    const l = this.lines.get(key);
    if (l) l.mode = mode;
    this.opts.onEvent({ key, kind: "mode", mode });
    // Mutes: al empezar a hablar alguien, todos callados YA; al callarse,
    // devolver el mic al enfocado tras 700 ms (entre frases parpadea).
    if (this.muteTimer) clearTimeout(this.muteTimer);
    this.muteTimer = null;
    if (mode === "speaking") this.applyMutes();
    else this.muteTimer = setTimeout(() => this.applyMutes(), 700);
    // Silencio REAL = nadie habla durante ~0,9 s (entre frase y frase el modo
    // parpadea): ahí sale UNA cosa de la cola (turno del compañero, texto…).
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = null;
    if (mode !== "listening" || this.anySpeaking()) return;
    this.quietTimer = setTimeout(() => {
      this.quietTimer = null;
      this.flushQuiet();
    }, 900);
  }

  private safeContext(line: Line, text: string): void {
    if (line.status !== "connected") return;
    try {
      line.conv.sendContextualUpdate(text);
    } catch {
      /* sesión cerrándose */
    }
  }

  private onMessage(key: string, role: "user" | "agent", text: string): void {
    const line = this.lines.get(key);
    if (!line) return;
    this.opts.onEvent({ key, kind: "message", role, text });
    const others = [...this.lines.values()].filter((l) => l.agent.key !== key);

    if (role === "user") {
      // "..." no es el humano: es el turn-timeout del servidor de ElevenLabs
      // (el agente se re-engancha solo). No se relata ni abre ronda.
      if (!text.replace(/[.…\s]/g, "").length) return;
      // Solo el enfocado tiene el mic abierto: una transcripción que llegue
      // por otra línea es ruido (audio previo al mute) y no abre ronda.
      if (key !== this.focused) return;
      const now = performance.now();
      if (this.lastUser && this.lastUser.text === text && now - this.lastUser.t < 3000) return;
      this.lastUser = { text, t: now };
      // Lo que dijo el humano lo saben todos (solo el enfocado lo oyó).
      for (const o of others) this.safeContext(o, `${this.opts.owner} dijo: "${text}"`);
      this.roundOpen = true;
      return;
    }

    line.lastAgentText = text;
    this.greeted.add(key);
    for (const o of others) this.safeContext(o, `${line.agent.name} dijo: "${text}"`);

    // Tertulia: una réplica de un compañero por turno del humano, y solo
    // cuando haya silencio (ver whenQuiet/flushQuiet).
    if (this.tertulia && this.roundOpen && key === this.focused && others.length && !this.pendingComment) {
      const partner = others[0];
      this.roundOpen = false;
      const pc = {
        to: partner.agent.key,
        text: `[tertulia] ${line.agent.name} acaba de decir: "${text}". Comenta en 1 o 2 frases, dirigiéndote a ${line.agent.name} o a ${this.opts.owner}. No repitas lo que dijo.`,
      };
      this.pendingComment = pc;
      this.whenQuiet(() => {
        this.pendingComment = null;
        const target = this.lines.get(pc.to);
        if (target && target.status === "connected") target.conv.sendUserMessage(pc.text);
      });
    }
  }
}
