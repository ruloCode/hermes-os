// Las voces de la gente del edificio (capa "Gente viva" + interruptor "Voces
// de la gente"). Cada persona habla con SU voz del sistema (assignVoices, en
// shared: única entre los vivos y pegajosa) y, si hay, con su voz pregrabada
// para las frases fijas de las charlas (nivel 2, clips en public/oficina/voces).
//
// Reglas que no se negocian:
//  - Una sola voz a la vez. Si ya suena alguien (otra persona, la respuesta
//    de un agente con speech.ts), la frase nueva no suena: su globo sí sale.
//  - Nunca encima de una llamada con Hermes o el equipo (`setBlocked`).
//  - Solo con el Sonido prendido (su AudioContext nace con un clic: eso ya es
//    el gesto del usuario que pide el autoplay) y con "Voces de la gente".
//  - Más bajo cuanto más lejos: una charla se oye solo si estás cerca.

import { assignVoices, voiceTimbre, type PersonVoice, type SystemVoice, type VoiceRequest } from "@hermes/shared";

const KEY = "hermes-oficina-voces-gente";

export function peopleVoicesEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setPeopleVoicesEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* modo privado */
  }
}

/** Una frase pregrabada (nivel 2): voz premium × id de línea fija → URL del clip. */
export interface PremiumClips {
  /** Voces premium disponibles (las que tienen clips). */
  voices: string[];
  /** Timbre de cada una ("f"/"m"): una barba no habla con voz femenina. */
  gender: Record<string, "f" | "m">;
  url(voice: string, line: string): string | null;
}

/** Lee public/oficina/voces/manifest.json (null si no existe: solo voces del sistema). */
export async function loadPremiumClips(): Promise<PremiumClips | null> {
  try {
    const r = await fetch("/oficina/voces/manifest.json");
    if (!r.ok) return null;
    const m = (await r.json()) as { voices: Record<string, { gender: "f" | "m"; lines: string[] }> };
    const has = new Map(Object.entries(m.voices).map(([v, x]) => [v, new Set(x.lines)]));
    return {
      voices: [...has.keys()],
      gender: Object.fromEntries(Object.entries(m.voices).map(([v, x]) => [v, x.gender])),
      url: (voice, line) => (has.get(voice)?.has(line) ? `/oficina/voces/${voice}/${line}.mp3` : null),
    };
  } catch {
    return null;
  }
}

export interface SayOptions {
  /** 0..1 (por distancia). Bajo 0,05 no se dice nada. */
  volume: number;
  /** Id de frase fija: si la persona tiene voz premium y existe el clip, suena el clip. */
  line?: string;
  /** Panorámica −1..1 (solo para los clips: speechSynthesis no tiene paneo). */
  pan?: number;
  onEnd?: () => void;
}

export class PeopleVoices {
  private catalog: SystemVoice[] = [];
  private byName = new Map<string, SpeechSynthesisVoice>();
  private assigned = new Map<string, PersonVoice>();
  private premiumOf = new Map<string, string>();
  private enabled = peopleVoicesEnabled();
  private soundOn = false;
  private blocked = false;
  private override: SystemVoice[] | null = null;
  private speakingId: string | null = null;
  private level = 0;
  private clip: { src: AudioBufferSourceNode; analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> } | null = null;
  private ctx: AudioContext | null = null;
  private premium: PremiumClips | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  /** QA: lo que se dijo (o se habría dicho) y por qué no. */
  readonly log: { id: string; text: string; voice: string; via: "sistema" | "clip" | "mudo"; why?: string; at: number }[] = [];
  private onChange: (() => void) | null = null;

  constructor() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => this.setCatalog(window.speechSynthesis.getVoices());
    load();
    // Las voces llegan después (Chrome las carga async): sin esto, la primera vez no hay ninguna.
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
  }

  private setCatalog(voices: SpeechSynthesisVoice[]) {
    this.byName = new Map(voices.map((v) => [v.name, v]));
    if (!this.override) this.catalog = voices.map((v) => ({ name: v.name, lang: v.lang }));
    this.onChange?.();
  }

  /** QA: un catálogo de mentira (headless no tiene voces). null vuelve al del sistema. */
  setOverride(voices: SystemVoice[] | null) {
    this.override = voices;
    this.catalog = voices ?? [...this.byName.values()].map((v) => ({ name: v.name, lang: v.lang }));
    this.onChange?.();
  }

  /** Avisa cuando cambia el catálogo (hay que reasignar). */
  onCatalog(fn: (() => void) | null) {
    this.onChange = fn;
  }

  setPremium(p: PremiumClips | null) {
    this.premium = p;
  }

  /** Reparte voces entre quienes están vivos ahora (pegajoso). Devuelve el reparto. */
  assign(people: VoiceRequest[]): Map<string, PersonVoice> {
    this.assigned = assignVoices(people, this.catalog, this.assigned);
    // Voz premium: se reparte en orden y también es única (si hay menos que personas, el resto no tiene).
    const premium = this.premium?.voices ?? [];
    const used = new Set<string>();
    const next = new Map<string, string>();
    for (const [id, v] of this.premiumOf) if (this.assigned.has(id) && premium.includes(v) && !used.has(v)) (next.set(id, v), used.add(v));
    // La voz premium sigue el timbre de su voz del sistema (la misma persona no cambia de voz grave a aguda
    // entre una charla y un saludo). Si no queda una premium de ese timbre, esa persona habla solo con la del sistema.
    const gender = this.premium?.gender ?? {};
    for (const p of people) {
      if (next.has(p.id) || p.role) continue;
      const sys = this.assigned.get(p.id);
      const t = sys ? voiceTimbre(sys.voice) : "neutral";
      const want = t === "low" ? "m" : t === "high" ? "f" : p.low ? "m" : "f";
      const free = premium.find((v) => !used.has(v) && gender[v] === want);
      if (!free) continue;
      next.set(p.id, free);
      used.add(free);
    }
    this.premiumOf = next;
    return this.assigned;
  }

  voiceOf(id: string): PersonVoice | undefined {
    return this.assigned.get(id);
  }

  premiumVoiceOf(id: string): string | undefined {
    return this.premiumOf.get(id);
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    setPeopleVoicesEnabled(on);
    if (!on) this.stop();
  }

  get isEnabled() {
    return this.enabled;
  }

  /** El sonido de la oficina (y su AudioContext, nacido con un clic). */
  setSound(on: boolean, ctx: AudioContext | null) {
    this.soundOn = on;
    this.ctx = ctx;
    if (!on) this.stop();
  }

  /** Hay una llamada con Hermes o el equipo: callados. */
  setBlocked(on: boolean) {
    this.blocked = on;
    if (on) this.stop();
  }

  get allowed(): boolean {
    return this.enabled && this.soundOn && !this.blocked;
  }

  get speaking(): string | null {
    return this.speakingId;
  }

  /** Nivel 0..1 de la voz que suena (para la boca y el cuerpo). */
  levelOf(id: string): number {
    if (id !== this.speakingId) return 0;
    if (this.clip) {
      this.clip.analyser.getByteTimeDomainData(this.clip.data);
      let peak = 0;
      for (const v of this.clip.data) peak = Math.max(peak, Math.abs(v - 128));
      return Math.min(1, peak / 60);
    }
    // speechSynthesis no da volumen: cada palabra es un golpe que decae.
    this.level *= 0.9;
    return 0.25 + this.level * 0.75;
  }

  /**
   * Dice `text` con la voz de `id`. Devuelve si sonó. Si no puede (apagado,
   * llamada, ya habla alguien, muy lejos), no suena y lo deja en el log.
   */
  say(id: string, text: string, o: SayOptions): boolean {
    const v = this.assigned.get(id);
    const note = (via: "sistema" | "clip" | "mudo", why?: string) => {
      this.log.push({ id, text, voice: via === "clip" ? `premium:${this.premiumOf.get(id)}` : (v?.voice ?? ""), via, why, at: Date.now() });
      if (this.log.length > 60) this.log.shift();
    };
    if (!this.allowed) return note("mudo", !this.enabled ? "voces apagadas" : !this.soundOn ? "sonido apagado" : "llamada"), false;
    if (o.volume < 0.05) return note("mudo", "lejos"), false;
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (this.speakingId || synth?.speaking) return note("mudo", "ya habla alguien"), false;
    const premium = this.premiumOf.get(id);
    const url = o.line && premium ? this.premium?.url(premium, o.line) : null;
    if (url && this.ctx) {
      this.speakingId = id;
      note("clip");
      void this.playClip(url, o).finally(() => {
        if (this.speakingId === id) this.speakingId = null;
        o.onEnd?.();
      });
      return true;
    }
    if (!synth || !v) return note("mudo", "sin síntesis"), false;
    const u = new SpeechSynthesisUtterance(text);
    const sv = this.byName.get(v.voice);
    if (sv) u.voice = sv;
    u.lang = sv?.lang ?? v.lang;
    u.pitch = v.pitch;
    u.rate = v.rate;
    u.volume = Math.min(1, o.volume);
    u.onboundary = () => (this.level = 1);
    const done = () => {
      if (this.speakingId === id) this.speakingId = null;
      o.onEnd?.();
    };
    u.onend = done;
    u.onerror = done;
    this.speakingId = id;
    note("sistema");
    synth.speak(u);
    return true;
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    let b = this.buffers.get(url);
    if (!b) {
      const ctx = this.ctx!;
      b = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
        .then((a) => ctx.decodeAudioData(a))
        .catch(() => null);
      this.buffers.set(url, b);
    }
    return b;
  }

  private async playClip(url: string, o: SayOptions) {
    const ctx = this.ctx!;
    const buf = await this.buffer(url);
    if (!buf || !this.allowed) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, o.volume);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, o.pan ?? 0));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(gain).connect(pan).connect(analyser).connect(ctx.destination);
    this.clip = { src, analyser, data: new Uint8Array(new ArrayBuffer(analyser.fftSize)) };
    await new Promise<void>((res) => {
      src.onended = () => res();
      src.start();
    });
    this.clip = null;
  }

  stop() {
    const wasClip = !!this.clip;
    if (this.clip) {
      try {
        this.clip.src.stop();
      } catch {
        /* ya terminó */
      }
      this.clip = null;
    }
    // Solo cancela la síntesis si la estaba usando la gente (no corta la respuesta de un agente).
    if (this.speakingId && !wasClip && typeof window !== "undefined") window.speechSynthesis?.cancel();
    this.speakingId = null;
  }

  debug() {
    return {
      enabled: this.enabled,
      allowed: this.allowed,
      soundOn: this.soundOn,
      blocked: this.blocked,
      catalog: this.catalog.filter((v) => v.lang.toLowerCase().startsWith("es")).length,
      override: !!this.override,
      speaking: this.speakingId,
      premium: this.premium?.voices.length ?? 0,
      assigned: Object.fromEntries([...this.assigned].map(([id, v]) => [id, { voice: v.voice, key: v.key, pitch: v.pitch, rate: v.rate, premium: this.premiumOf.get(id) ?? null }])),
      log: this.log.slice(-12),
    };
  }
}
