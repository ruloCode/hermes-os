// Sonido de ambiente de la Oficina, TODO procedural con WebAudio: ni samples
// descargados ni audio con derechos. Arranca APAGADO; el AudioContext nace con
// el clic en "Sonido" (gesto real: política de autoplay) y se suspende con la
// pestaña oculta. Con una llamada activa (Hermes o el equipo) baja solo, para
// no tapar las voces.
//
// Qué suena y cuándo:
//   · Tono de sala por piso: equipos (rumor grave muy suave), café (murmullo
//     filtrado), azotea (viento y algo de ciudad). Se cruzan al cambiar de piso.
//   · Teclado: SOLO los agentes con status "working", posicional (más fuerte
//     cerca), a lo sumo 6 a la vez y solo en el piso 1 a la vista.
//   · Cafetera: vapor y molino de vez en cuando, posicional, en la barra del café.
//   · Minijuegos: golpe, rebote, punto, error, lanzamiento y fin de partida.
//   · Pasos del dueño al caminar o correr.
//   · Un tono cuando un agente te necesita y otro cuando alguien termina.

import * as THREE from "three";
import type { GameEvent } from "./games";

const VOLUME_KEY = "hermes-oficina-volumen";
const MAX_TYPISTS = 6;
const TYPING_RANGE = 18;

export interface AudioSource {
  id: string;
  pos: THREE.Vector3;
}

export interface AudioFrame {
  camera: THREE.Camera;
  /** Piso que se ve (0 equipos · 1 café · 2 azotea). */
  floor: number;
  owner: { pos: THREE.Vector3; speed: number; grounded: boolean; running: boolean };
  /** Agentes trabajando (posición de su escritorio). */
  typists: AudioSource[];
  /** La cafetera (mundo), si el piso del café existe. */
  espresso: THREE.Vector3 | null;
}

export function readVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.6;
  } catch {
    return 0.6;
  }
}

function saveVolume(v: number) {
  try {
    localStorage.setItem(VOLUME_KEY, String(v));
  } catch {
    /* modo privado */
  }
}

/** Ruido blanco en un buffer (2 s, en loop): la materia prima de casi todo. */
function noiseBuffer(ctx: AudioContext, seconds = 2, brown = false): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    } else d[i] = w;
  }
  return buf;
}

interface Bed {
  gain: GainNode;
  stop: () => void;
}

export class OfficeAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private duck: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private beds: Bed[] = [];
  private typists = new Map<string, { panner: PannerNode; next: number }>();
  private espresso: { panner: PannerNode; next: number } | null = null;
  private stepAt = 0;
  private volume = readVolume();
  private ducked = false;
  private floor = -1;
  /** Cuántos sonidos se dispararon (QA: el sonido existe y responde). */
  events = 0;
  on = false;

  /** Prende el sonido. DEBE llamarse dentro de un gesto real (clic o tecla). */
  async start(): Promise<boolean> {
    if (this.on) return true;
    try {
      if (!this.ctx) this.build();
      await this.ctx!.resume();
      this.on = true;
      this.applyGain();
      document.addEventListener("visibilitychange", this.onVisibility);
      return true;
    } catch {
      return false;
    }
  }

  stop() {
    this.on = false;
    this.applyGain();
    void this.ctx?.suspend();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    saveVolume(this.volume);
    this.applyGain();
  }

  getVolume() {
    return this.volume;
  }

  /** Llamada activa: el ambiente baja para no tapar las voces. */
  setDucked(on: boolean) {
    if (on === this.ducked) return;
    this.ducked = on;
    if (this.ctx && this.duck) this.duck.gain.setTargetAtTime(on ? 0.18 : 1, this.ctx.currentTime, 0.3);
  }

  state() {
    return {
      on: this.on,
      context: this.ctx?.state ?? "sin crear",
      volume: this.volume,
      ducked: this.ducked,
      floor: this.floor,
      typists: this.typists.size,
      events: this.events,
    };
  }

  private onVisibility = () => {
    if (!this.ctx || !this.on) return;
    if (document.hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  };

  private applyGain() {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.on ? this.volume * 0.9 : 0, this.ctx.currentTime, 0.15);
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.duck = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    this.duck.connect(this.master).connect(comp).connect(ctx.destination);
    this.white = noiseBuffer(ctx, 2);
    this.brown = noiseBuffer(ctx, 4, true);
    this.beds = [this.roomBed(), this.cafeBed(), this.roofBed()];
  }

  private loop(buf: AudioBuffer): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.loopStart = Math.random();
    src.start(0, Math.random() * buf.duration);
    return src;
  }

  /** Piso 1: rumor grave de sala (aire acondicionado lejano). */
  private roomBed(): Bed {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = this.loop(this.brown!);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 280;
    src.connect(lp).connect(gain).connect(this.duck!);
    return { gain, stop: () => src.stop() };
  }

  /** Piso 2: murmullo del café (ruido en la banda de la voz, que respira lento). */
  private cafeBed(): Bed {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const src = this.loop(this.white!);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 520;
    bp.Q.value = 0.9;
    const breath = ctx.createGain();
    breath.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.21;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    lfo.connect(depth).connect(breath.gain);
    lfo.start();
    src.connect(bp).connect(breath).connect(gain).connect(this.duck!);
    return {
      gain,
      stop: () => {
        src.stop();
        lfo.stop();
      },
    };
  }

  /** Piso 3: viento (banda que sube y baja) y la ciudad abajo (rumor grave). */
  private roofBed(): Bed {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const wind = this.loop(this.white!);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 600;
    bp.Q.value = 1.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const sweep = ctx.createGain();
    sweep.gain.value = 260;
    lfo.connect(sweep).connect(bp.frequency);
    lfo.start();
    const city = this.loop(this.brown!);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 140;
    const cityGain = ctx.createGain();
    cityGain.gain.value = 0.7;
    wind.connect(bp).connect(gain);
    city.connect(lp).connect(cityGain).connect(gain);
    gain.connect(this.duck!);
    return {
      gain,
      stop: () => {
        wind.stop();
        city.stop();
        lfo.stop();
      },
    };
  }

  private panner(pos: THREE.Vector3): PannerNode {
    const p = this.ctx!.createPanner();
    p.panningModel = "equalpower";
    p.distanceModel = "inverse";
    p.refDistance = 1.5;
    p.rolloffFactor = 1.4;
    p.positionX.value = pos.x;
    p.positionY.value = pos.y;
    p.positionZ.value = pos.z;
    p.connect(this.duck!);
    return p;
  }

  /** Un golpecito de ruido filtrado (tecla, paso, vapor): `dur` en segundos. */
  private burst(dest: AudioNode, opts: { at?: number; dur: number; freq: number; type?: BiquadFilterType; gain: number; q?: number }) {
    const ctx = this.ctx!;
    const t = opts.at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? "bandpass";
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + Math.min(0.004, opts.dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5, opts.dur + 0.05);
  }

  /** Un tono con envolvente (campanitas, golpes de juego). */
  private tone(freq: number, opts: { at?: number; dur: number; gain: number; type?: OscillatorType; to?: number; dest?: AudioNode }) {
    const ctx = this.ctx!;
    const t = opts.at ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = opts.type ?? "sine";
    o.frequency.setValueAtTime(freq, t);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(opts.gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(opts.dest ?? this.duck!);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  /** Cada frame (lo llama el mundo): oyente, pisos, teclados, cafetera y pasos. */
  frame(f: AudioFrame) {
    if (!this.on || !this.ctx || this.ctx.state !== "running") return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    // El oyente es la cámara.
    const L = ctx.listener;
    const cam = f.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    if (L.positionX) {
      L.positionX.value = cam.position.x;
      L.positionY.value = cam.position.y;
      L.positionZ.value = cam.position.z;
      L.forwardX.value = fwd.x;
      L.forwardY.value = fwd.y;
      L.forwardZ.value = fwd.z;
    }
    // Tono de sala: el del piso que se ve.
    if (f.floor !== this.floor) {
      this.floor = f.floor;
      const levels = [0.05, 0.035, 0.05];
      this.beds.forEach((b, i) => b.gain.gain.setTargetAtTime(i === f.floor ? levels[i] : 0, now, 0.8));
    }
    // Teclados: los que trabajan, cerca y a la vista del piso 1.
    const want = f.floor === 0 ? f.typists.filter((t) => t.pos.distanceTo(cam.position) < TYPING_RANGE).sort((a, b) => a.pos.distanceTo(cam.position) - b.pos.distanceTo(cam.position)).slice(0, MAX_TYPISTS) : [];
    const keep = new Set(want.map((t) => t.id));
    for (const [id, t] of this.typists) {
      if (keep.has(id)) continue;
      t.panner.disconnect();
      this.typists.delete(id);
    }
    for (const t of want) {
      let v = this.typists.get(t.id);
      if (!v) {
        v = { panner: this.panner(t.pos.clone().setY(0.9)), next: now + Math.random() * 0.4 };
        this.typists.set(t.id, v);
      }
      if (now >= v.next) {
        // Ráfagas de 3 a 9 teclas y una pausa, como alguien que escribe de verdad.
        const keys = 3 + Math.floor(Math.random() * 7);
        for (let k = 0; k < keys; k++) this.burst(v.panner, { at: now + k * (0.07 + Math.random() * 0.06), dur: 0.025, freq: 2600 + Math.random() * 1600, gain: 0.22, q: 2.5 });
        v.next = now + keys * 0.1 + 0.35 + Math.random() * 1.4;
        this.events++;
      }
    }
    // La cafetera del café: vapor y molino de vez en cuando.
    if (f.floor === 1 && f.espresso) {
      if (!this.espresso) this.espresso = { panner: this.panner(f.espresso), next: now + 3 };
      if (now >= this.espresso.next) {
        if (Math.random() < 0.6) this.burst(this.espresso.panner, { dur: 1.6 + Math.random(), freq: 4200, type: "highpass", gain: 0.12 });
        else for (let k = 0; k < 14; k++) this.burst(this.espresso.panner, { at: now + k * 0.05, dur: 0.06, freq: 900 + Math.random() * 300, gain: 0.16, q: 4 });
        this.espresso.next = now + 9 + Math.random() * 12;
        this.events++;
      }
    } else if (this.espresso) {
      this.espresso.panner.disconnect();
      this.espresso = null;
    }
    // Pasos del dueño.
    if (f.owner.grounded && f.owner.speed > 0.6) {
      const every = f.owner.running ? 0.27 : 0.38;
      if (now - this.stepAt >= every) {
        this.stepAt = now;
        this.burst(this.duck!, { dur: 0.08, freq: 320 + Math.random() * 80, type: "lowpass", gain: 0.18 });
        this.events++;
      }
    }
  }

  /** Golpes de los minijuegos. */
  game(ev: GameEvent) {
    if (!this.on || !this.ctx) return;
    this.events++;
    switch (ev) {
      case "hit":
        this.tone(900, { dur: 0.08, gain: 0.35, to: 520 });
        this.burst(this.duck!, { dur: 0.03, freq: 3000, gain: 0.25, q: 3 });
        break;
      case "wall":
        this.tone(520, { dur: 0.06, gain: 0.18, to: 380 });
        break;
      case "throw":
        this.burst(this.duck!, { dur: 0.35, freq: 1200, gain: 0.15, q: 0.8 });
        break;
      case "miss":
        this.tone(160, { dur: 0.18, gain: 0.3, to: 90 });
        break;
      case "score":
        this.tone(660, { dur: 0.14, gain: 0.22, type: "triangle" });
        this.tone(990, { at: this.ctx.currentTime + 0.1, dur: 0.22, gain: 0.22, type: "triangle" });
        break;
      case "lose":
        this.tone(440, { dur: 0.2, gain: 0.2, type: "triangle", to: 260 });
        break;
      case "over":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, { at: this.ctx!.currentTime + i * 0.11, dur: 0.25, gain: 0.2, type: "triangle" }));
        break;
    }
  }

  /** Un agente te necesita (dos notas que preguntan) o alguien terminó (tres que celebran). */
  chime(kind: "needs" | "done") {
    if (!this.on || !this.ctx) return;
    this.events++;
    const t = this.ctx.currentTime;
    if (kind === "needs") {
      this.tone(880, { at: t, dur: 0.35, gain: 0.25, type: "sine" });
      this.tone(1319, { at: t + 0.18, dur: 0.5, gain: 0.25, type: "sine" });
    } else [784, 988, 1175].forEach((f, i) => this.tone(f, { at: t + i * 0.09, dur: 0.3, gain: 0.18, type: "triangle" }));
  }

  dispose() {
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const b of this.beds) {
      try {
        b.stop();
      } catch {
        /* ya parado */
      }
    }
    void this.ctx?.close();
    this.ctx = null;
  }
}
