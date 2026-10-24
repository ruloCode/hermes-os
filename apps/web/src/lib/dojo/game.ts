"use client";

// La capa de JUEGO del Dojo, fuera de React (un singleton como lib/dojo/python):
// el combo de teclas seguidas sin error, los avisos que flotan ("+45 XP",
// "Combo ×50", "Nivel 4") y los sonidos. Nada aquí inventa números: el XP que
// se anuncia es la diferencia real del total que devuelve el agente.
//
// Sonidos con WebAudio, procedurales (sin archivos), apagados por defecto: el
// contexto de audio nace con la primera tecla, que ya es un gesto del usuario.

export type PopTone = "xp" | "combo" | "level" | "miss";
export interface GamePop {
  id: number;
  text: string;
  tone: PopTone;
}

interface GameState {
  combo: number;
  pops: GamePop[];
  sound: boolean;
}

const COMBO_MARKS = [25, 50, 100, 200, 400];
const SOUND_KEY = "hermes-dojo-sound";

let state: GameState = { combo: 0, pops: [], sound: false };
let seq = 0;
const listeners = new Set<() => void>();
let ctx: AudioContext | null = null;

function set(next: Partial<GameState>) {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

export function subscribeGame(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function gameState(): GameState {
  return state;
}

function pop(text: string, tone: PopTone) {
  const p = { id: ++seq, text, tone };
  set({ pops: [...state.pops.slice(-4), p] });
  setTimeout(() => set({ pops: state.pops.filter((x) => x.id !== p.id) }), 1800);
}

// ── Sonido ──

function audio(): AudioContext | null {
  if (!state.sound) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, at: number, dur: number, gain: number, type: OscillatorType = "sine") {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** Clic de tecla: un golpe de ruido corto, filtrado, con algo de variación. */
function click() {
  const a = audio();
  if (!a) return;
  const len = Math.floor(a.sampleRate * 0.018);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.value = 2600 + Math.random() * 900;
  const g = a.createGain();
  g.gain.value = 0.22;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

// ── API ──

export function initGameSound() {
  try {
    set({ sound: localStorage.getItem(SOUND_KEY) === "on" });
  } catch {
    /* sin storage: queda apagado */
  }
}

export function setGameSound(on: boolean) {
  set({ sound: on });
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* la preferencia dura la sesión */
  }
  if (on) tone(880, 0, 0.12, 0.05);
}

/** Una tecla del modo tecleo: suma combo o lo rompe. */
export function gameKey(ok: boolean) {
  if (ok) {
    const combo = state.combo + 1;
    set({ combo });
    click();
    if (COMBO_MARKS.includes(combo)) {
      pop(`Combo ×${combo}`, "combo");
      tone(660, 0, 0.09, 0.05, "triangle");
      tone(990, 0.07, 0.12, 0.05, "triangle");
    }
  } else {
    if (state.combo >= 10) pop(`Combo roto en ${state.combo}`, "miss");
    set({ combo: 0 });
    tone(130, 0, 0.12, 0.08, "square");
  }
}

export function resetCombo() {
  if (state.combo) set({ combo: 0 });
}

/** XP ganado de verdad (diferencia del total del agente). */
export function gameAward(xp: number, label?: string) {
  if (xp <= 0) return;
  pop(`+${xp} XP${label ? ` · ${label}` : ""}`, "xp");
  tone(784, 0, 0.12, 0.06, "triangle");
  tone(1175, 0.09, 0.18, 0.06, "triangle");
}

export function gameLevelUp(level: number) {
  pop(`¡Nivel ${level}!`, "level");
  [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, 0.07, "triangle"));
}
