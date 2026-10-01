// El personaje de la Oficina: un frijol con audífonos y una antena cuya
// bombilla dice su estado desde el otro lado del piso. Actúa su última tool
// (leer = papeles, editar = teclear encorvado, tests = recostado con las manos
// en la nuca, web = un globo girando), cruza los brazos si un guardrail lo
// bloquea, se lleva la mano a la barbilla si piensa, LEVANTA LA MANO si espera
// tu permiso y da un giro al terminar.
//
// Basado en agent-office (AgentSystemLabs, MIT — clase Worker de
// src/client/world/character.ts): mismo cuerpo, mismas poses y mismo mezclado
// de posturas. Recortado a lo que usa Hermes (sin disfraces, baile ni PRs) y
// con estados propios (pensando/bloqueado) y colores del tema.

import * as THREE from "three";
import { formatUsd, officeModeLabel, type OfficeAction, type OfficeWorker, type OfficeWorkerStatus } from "@hermes/shared";
import { cardSprite, disposeSprite, mesh, toon, toonUnique } from "./toon";
import type { OfficePalette } from "./palette";

/** Lo que hace el cuerpo: reposo, brazos arriba, brazos cruzados, pensar, teclear o la tool. */
type Act = "rest" | "up" | "waiting" | "think" | "type" | "hand" | OfficeAction;

/** Una postura, que se mezcla con la siguiente en un momento. */
interface Stance {
  armLx: number;
  armRx: number;
  armLz: number;
  armRz: number;
  reach: number;
  drop: number;
  lean: number;
  turn: number;
  roll: number;
  lift: number;
  tap: number;
  kick: number;
  lid: number;
  look: number;
}

const STANCE_KEYS = ["armLx", "armRx", "armLz", "armRz", "reach", "drop", "lean", "turn", "roll", "lift", "tap", "kick", "lid", "look"] as const;

function stanceOf(act: Act, t: number, s: Stance): Stance {
  s.armLx = s.armRx = -0.3;
  s.armLz = s.armRz = s.reach = s.drop = s.lean = s.turn = s.roll = s.tap = s.kick = s.look = 0;
  s.lift = Math.sin(t * 2) * 0.015;
  s.lid = 1;
  switch (act) {
    case "up":
      s.armLx = s.armRx = -2.6;
      s.lift = 0;
      break;
    case "type":
      s.armLx = -1.2 + Math.sin(t * 22) * 0.25;
      s.armRx = -1.2 + Math.sin(t * 22 + 1.7) * 0.25;
      s.lift = Math.abs(Math.sin(t * 11)) * 0.02;
      break;
    case "edit":
      s.armLx = -1.25 + Math.sin(t * 34) * 0.34;
      s.armRx = -1.25 + Math.sin(t * 34 + 1.9) * 0.34;
      s.lean = 0.16;
      s.lift = Math.abs(Math.sin(t * 17)) * 0.035;
      s.look = -0.02;
      break;
    case "read":
      s.armLx = s.armRx = -2.05;
      s.armLz = 0.3;
      s.armRz = -0.3;
      s.lean = -0.06;
      s.look = -0.01 - ((t * 0.9) % 1) * 0.03;
      break;
    case "test":
      s.armLx = s.armRx = -3.3;
      s.armLz = 0.55;
      s.armRz = -0.55;
      s.lean = -0.32;
      s.roll = Math.sin(t * 1.3) * 0.04;
      s.kick = 0.08;
      s.look = 0.025;
      s.lift = 0;
      break;
    case "web":
      s.armLx = -1.2 + Math.sin(t * 9) * 0.15;
      s.armRx = -0.8;
      s.lean = -0.1;
      s.look = 0.03;
      break;
    case "failing":
      s.armLx = s.armRx = -2;
      s.armLz = 0.45;
      s.armRz = -0.45;
      s.reach = 1;
      s.lean = 0.38;
      s.turn = Math.sin(t * 2.4) * 0.16;
      s.lid = 0.55;
      s.look = -0.035;
      s.lift = 0;
      break;
    case "waiting": {
      const tap = Math.max(0, Math.sin(t * 16));
      s.armLx = -1.05;
      s.armRx = -1.2;
      s.armLz = 1;
      s.armRz = -1;
      s.reach = 1;
      s.drop = 0.11;
      s.roll = 0.07;
      s.tap = tap;
      s.lift = tap * 0.012;
      s.lid = 0.6;
      break;
    }
    case "hand":
      // Te necesita: medio se pone de pie y la mano larga (raisedHand) saluda
      // por encima de la cabeza, con un rebote corto de "¡aquí!".
      s.armLx = -0.25;
      s.lean = -0.08;
      s.look = 0.035;
      s.lift = 0.12 + Math.abs(Math.sin(t * 3.5)) * 0.05;
      s.roll = Math.sin(t * 3.5) * 0.04;
      break;
    case "think":
      // Hermes: una mano a la barbilla, mirando arriba, meciéndose despacio.
      s.armLx = -0.35;
      s.armRx = -2.2;
      s.armRz = -0.55;
      s.reach = 0.45;
      s.lean = -0.05;
      s.roll = Math.sin(t * 0.9) * 0.05;
      s.look = 0.03;
      s.lid = 0.85;
      break;
  }
  return s;
}

/** Tiempo mínimo actuando algo antes de pasar a lo siguiente (tools rápidas no parpadean). */
const ACT_MIN = 1.2;
/** La cabeza entre las manos dura al menos esto, para que se alcance a ver. */
const DESPAIR_MIN = 4;
const TWIRL_TIME = 0.9;
const VANISH_TIME = 0.7;

const ease = (x: number) => x * x * (3 - 2 * x);
const popIn = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);

const CHIP: Record<OfficeWorkerStatus, string> = {
  starting: "⏳ arrancando",
  working: "⌨️ trabajando",
  thinking: "💭 pensando",
  blocked: "⛔ bloqueado",
  needs_you: "✋ te necesita",
  done: "✅ listo",
  error: "❌ error",
};

function papers(): { group: THREE.Group; page: THREE.Group } {
  const group = new THREE.Group();
  const W = 0.34;
  const H = 0.44;
  const paper = toon("#fffaf3");
  const ink = toon("#8d99ae");
  ["#f1ece2", "#f7f3ea", "#fffaf3"].forEach((c, i) => {
    const sheet = mesh(new THREE.BoxGeometry(W, H, 0.008), toon(c), (i - 1) * 0.012, -H / 2 - i * 0.006, 0.02 - i * 0.012, false);
    sheet.rotation.z = (i - 1) * 0.04;
    group.add(sheet);
  });
  const lines = (on: THREE.Object3D, z: number) => {
    for (let i = 0; i < 6; i++) {
      const short = i % 3 === 2;
      on.add(mesh(new THREE.BoxGeometry(W * (short ? 0.45 : 0.72), 0.018, 0.004), ink, short ? -W * 0.135 : 0, -0.07 - i * 0.055, z, false));
    }
  };
  lines(group, -0.01);
  const page = new THREE.Group();
  page.add(mesh(new THREE.BoxGeometry(W, H, 0.008), paper, 0, -H / 2, -0.016, false));
  lines(page, -0.022);
  group.add(page);
  group.add(mesh(new THREE.BoxGeometry(W * 0.5, 0.05, 0.05), toon("#adb5bd"), 0, 0, 0, false));
  return { group, page };
}

/**
 * La mano levantada de "te necesita". El brazo del frijol es corto: arriba
 * llega a 0,81 m y la cabeza termina en 0,98, así que desde atrás o desde
 * arriba no se veía. Este es un brazo largo con un guante blanco de caricatura
 * que asoma por encima de la cabeza y saluda.
 */
function raisedHand(skin: THREE.Material): { group: THREE.Group } {
  const group = new THREE.Group();
  group.position.set(0.3, 0.6, 0.05);
  group.add(mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), skin, 0, 0.26, 0));
  const glove = toon("#ffffff");
  const palm = mesh(new THREE.SphereGeometry(0.11, 14, 10), glove, 0, 0.6, 0);
  palm.scale.set(1, 1.15, 0.55);
  group.add(palm);
  for (const [x, len] of [[-0.06, 0.1], [-0.02, 0.12], [0.02, 0.12], [0.06, 0.1]] as const) {
    group.add(mesh(new THREE.CapsuleGeometry(0.022, len, 4, 6), glove, x, 0.72 + len / 2, 0));
  }
  const thumb = mesh(new THREE.CapsuleGeometry(0.024, 0.07, 4, 6), glove, -0.11, 0.62, 0);
  thumb.rotation.z = 0.9;
  group.add(thumb);
  group.visible = false;
  return { group };
}

function globe(): { group: THREE.Group; ball: THREE.Group; ring: THREE.Mesh } {
  const group = new THREE.Group();
  const ball = new THREE.Group();
  const r = 0.26;
  ball.add(mesh(new THREE.SphereGeometry(r, 20, 14), toon("#4cc9f0"), 0, 0, 0, false));
  const land = toon("#6fcf6a");
  for (const [lat, lon, size] of [
    [0.5, 0.2, 0.5],
    [0.1, 0.9, 0.4],
    [-0.4, 0.5, 0.45],
    [0.3, 2.4, 0.6],
    [-0.2, 3.3, 0.4],
    [0.6, 4.4, 0.45],
    [-0.5, 5.2, 0.35],
  ]) {
    const blob = mesh(
      new THREE.SphereGeometry(size * r, 10, 8),
      land,
      Math.cos(lat) * Math.sin(lon) * r * 0.86,
      Math.sin(lat) * r * 0.86,
      Math.cos(lat) * Math.cos(lon) * r * 0.86,
      false,
    );
    blob.scale.set(1.2, 0.8, 1.2);
    ball.add(blob);
  }
  ball.rotation.z = 0.41;
  group.add(ball);
  const ring = mesh(new THREE.TorusGeometry(r * 1.35, 0.016, 6, 32), toon("#ffd166", { emissive: "#7a5b00" }), 0, 0, 0, false);
  ring.rotation.x = Math.PI / 2 - 0.2;
  group.add(ring);
  return { group, ball, ring };
}

export class OfficeCharacter {
  readonly root = new THREE.Group();
  readonly id: string;
  /** Caja invisible para el raycast del clic. */
  readonly hitbox: THREE.Mesh;
  private body = new THREE.Group();
  private skin: THREE.MeshToonMaterial;
  private bulb: THREE.MeshToonMaterial;
  private bulbMesh: THREE.Mesh;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private feet: THREE.Mesh[] = [];
  private eyes: THREE.Mesh[] = [];
  private pupils: THREE.Mesh[] = [];
  private papers: ReturnType<typeof papers>;
  private globe: ReturnType<typeof globe>;
  private hand: ReturnType<typeof raisedHand>;
  private bubble: THREE.Sprite | null = null;
  private bubbleKey = "";
  private status: OfficeWorkerStatus = "starting";
  private nextAction: OfficeAction | undefined;
  private action: OfficeAction | undefined;
  private actionT = 0;
  private acts = new Map<Act, number>();
  private stance = {} as Stance;
  private blend = {} as Stance;
  private blinkAt = Math.random() * 4;
  private spawnT = 0;
  private cheerT = 0;
  private bounceT = 0;
  private twirlT = -1;
  private flipT = 0;
  private turnY = 0;
  private vanishT = -1;
  private selected = false;
  private readonly spot = new THREE.Vector3(-0.95, 1.15, 1.25);
  private readonly palette: OfficePalette;

  constructor(id: string, color: string, palette: OfficePalette) {
    this.id = id;
    this.palette = palette;
    const skin = (this.skin = toonUnique(color));
    skin.emissive = new THREE.Color(palette.accent);
    skin.emissiveIntensity = 0;
    const white = toon("#ffffff");
    const ink = toon("#1d1d1d");
    const gear = toon("#2b2d42");

    this.root.add(this.body);
    this.body.add(mesh(new THREE.CapsuleGeometry(0.28, 0.3, 8, 16), skin, 0, 0.55, 0));
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.09, 12, 10), white, sx * 0.11, 0.7, 0.23, false);
      eye.scale.z = 0.6;
      this.body.add(eye);
      const pupil = mesh(new THREE.SphereGeometry(0.045, 10, 8), ink, sx * 0.11, 0.7, 0.29, false);
      this.body.add(pupil);
      this.eyes.push(eye, pupil);
      this.pupils.push(pupil);
    }
    const band = mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 20, Math.PI), gear, 0, 0.72, 0, false);
    band.rotation.y = Math.PI / 2;
    this.body.add(band);
    for (const sx of [-1, 1]) this.body.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), gear, sx * 0.29, 0.72, 0, false));
    this.body.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), gear, 0, 1.07, 0, false));
    this.bulb = toonUnique(palette.bulb.starting);
    this.bulb.emissive = new THREE.Color(palette.bulb.starting).multiplyScalar(0.6);
    this.bulbMesh = mesh(new THREE.SphereGeometry(0.075, 12, 10), this.bulb, 0, 1.2, 0, false);
    this.body.add(this.bulbMesh);

    const arm = (x: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.55, 0.05);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), skin, 0, -0.12, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.armL = arm(-0.3);
    this.armR = arm(0.3);
    for (const sx of [-1, 1]) {
      const foot = mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05);
      this.body.add(foot);
      this.feet.push(foot);
    }

    this.papers = papers();
    this.papers.group.position.set(0, 0.86, 0.4);
    this.papers.group.rotation.x = 0.35;
    this.body.add(this.papers.group);
    this.globe = globe();
    for (const prop of [this.papers.group, this.globe.group]) prop.visible = false;
    this.hand = raisedHand(skin);
    this.body.add(this.hand.group);
    this.root.add(this.globe.group);

    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.8), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitbox.position.y = 0.7;
    this.hitbox.userData.workerId = id;
    this.root.add(this.hitbox);
  }

  /** Aplica el estado real del personaje (lo que dice el agente). `voice` = la voz que presta en el elenco de la oficina. */
  setState(w: OfficeWorker, voice?: string, nick?: string) {
    const was = this.status;
    this.status = w.status;
    this.nextAction = w.status === "working" ? w.action : undefined;
    if (w.status === "done" && was !== "done") this.celebrate();
    this.paintBulb();
    // El modo va en el chip solo si no es Auto (el default): así se ve quién está en Plan o Preguntar.
    this.modeTag = w.mode && w.mode !== "auto" ? ` · ${officeModeLabel(w.mode)}` : "";
    // El costo va en el chip solo cuando es final (el result del CLI): los tokens
    // parciales cambian cada segundo y se ven en el monitor y en el panel.
    if (w.spend?.final && w.spend.costUsd !== undefined) this.modeTag += ` · ${formatUsd(w.spend.costUsd)}`;
    // El apodo es cómo se llama el personaje; la tarea real va al lado.
    const name = nick ? `${nick} · ${w.name}` : w.name;
    this.drawBubble(voice ? `🎙 ${voice} · ${name}` : name, w.task.summary);
  }

  private talk = 0;
  private talkTarget = 0;

  /** Su voz suena en la llamada del equipo: el cuerpo late con el volumen real. */
  setTalking(level: number) {
    this.talkTarget = Math.max(0, Math.min(1, level));
  }

  private cardScale = 1;

  /** Tamaño y visibilidad de la tarjeta (en explorar se achica y las lejanas se ocultan). */
  setCard(scale: number, visible: boolean) {
    this.cardScale = scale;
    if (this.bubble) this.bubble.visible = visible;
  }

  setSelected(on: boolean) {
    this.selected = on;
    this.skin.emissiveIntensity = on ? 0.28 : 0;
  }

  /** Terminó: un giro y unos saltos de alegría. */
  celebrate() {
    this.twirlT = 0;
    this.cheerT = 1.6;
  }

  /** Se va (terminó la gracia): se encoge y desaparece. */
  vanish() {
    if (this.vanishT < 0) this.vanishT = 0;
  }

  get gone(): boolean {
    return this.vanishT >= VANISH_TIME;
  }

  private paintBulb() {
    const c = this.palette.bulb[this.status];
    this.bulb.color.set(c);
    this.bulb.emissive.set(c).multiplyScalar(0.7);
  }

  private modeTag = "";

  private drawBubble(name: string, summary: string) {
    const key = `${this.status}|${this.modeTag}|${name}|${summary}`;
    if (key === this.bubbleKey) return;
    this.bubbleKey = key;
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    const p = this.palette;
    const bulb = p.bulb[this.status];
    this.bubble = cardSprite({
      chip: { text: CHIP[this.status] + this.modeTag, bg: bulb, color: "#1d1d1d" },
      title: name,
      body: summary || undefined,
      bg: p.card[this.status],
      border: p.dark ? p.faint : "#2b2d42",
      ink: p.ink,
      dim: p.dim,
      maxWidth: 380,
    });
    this.bubble.userData.base = this.bubble.scale.clone();
    this.root.add(this.bubble);
  }

  update(dt: number, t: number) {
    if (this.vanishT >= 0) {
      this.vanishT += dt;
      const k = Math.max(0.001, 1 - ease(Math.min(1, this.vanishT / VANISH_TIME)));
      this.root.scale.setScalar(k);
      return;
    }
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;
    this.cheerT = Math.max(0, this.cheerT - dt);
    const hopping = this.cheerT > 0;
    if (hopping) this.bounceT += dt * 7;
    else this.bounceT = 0;

    this.actionT += dt;
    if (this.nextAction !== this.action && this.actionT >= (this.action === "failing" ? DESPAIR_MIN : ACT_MIN)) {
      this.action = this.nextAction;
      this.actionT = 0;
    }
    const act: Act = hopping
      ? "up"
      : this.status === "needs_you"
        ? "hand"
        : this.status === "blocked"
        ? "waiting"
        : this.status === "thinking"
          ? "think"
          : this.status === "error"
            ? "failing"
            : this.status === "working"
              ? (this.action ?? "type")
              : "rest";
    const s = this.pose(act, dt, t);

    this.armL.rotation.set(s.armLx, 0, s.armLz);
    this.armR.rotation.set(s.armRx, 0, s.armRz);
    this.armL.position.set(-0.3 + s.reach * 0.07, 0.55 - s.drop, 0.05 + s.reach * 0.12);
    this.armR.position.set(0.3 - s.reach * 0.07, 0.55 - s.drop + s.reach * 0.04, 0.05 + s.reach * 0.14);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2 + (i ? s.tap * 0.07 : 0), 0.05 + s.kick + (i ? s.tap * 0.03 : 0)));
    for (const p of this.pupils) p.position.y = 0.7 + s.look;
    this.body.rotation.x = s.lean;

    let twirl = 0;
    if (this.twirlT >= 0) {
      this.twirlT += dt;
      twirl = ease(Math.min(1, this.twirlT / TWIRL_TIME)) * Math.PI * 2;
      if (this.twirlT >= TWIRL_TIME) this.twirlT = -1;
    }
    let lift = s.lift;
    if (hopping) {
      const h = Math.abs(Math.sin(this.bounceT));
      lift = h * 0.45;
      const squash = h < 0.15 ? 1 - (0.15 - h) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.turnY = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.body.scale.setScalar(pop);
      this.turnY += (s.turn - this.turnY) * Math.min(1, dt * 6);
    }
    // Hablando: late con el volumen y se ilumina (sin pisar el brillo de "seleccionado").
    this.talk += (this.talkTarget - this.talk) * Math.min(1, dt * 12);
    if (this.talk > 0.01) {
      const beat = 1 + this.talk * (0.06 + Math.abs(Math.sin(t * 14)) * 0.08);
      this.body.scale.set(this.body.scale.x * (2 - beat) ** 0.3, this.body.scale.y * beat, this.body.scale.z * (2 - beat) ** 0.3);
      this.skin.emissiveIntensity = Math.max(this.selected ? 0.28 : 0, this.talk * 0.35);
    } else if (!this.selected && this.skin.emissiveIntensity !== 0) this.skin.emissiveIntensity = 0;
    this.body.position.y = lift;
    this.body.rotation.y = this.turnY + twirl;
    this.body.rotation.z = s.roll;
    this.props(dt, t);
    this.blink(dt, s.lid);
    // La bombilla late cuando algo pide atención (bloqueado, te necesita) y respira cuando trabaja.
    const beat = this.status === "blocked" || this.status === "needs_you" ? Math.abs(Math.sin(t * 8)) * 0.5 : this.status === "working" ? Math.abs(Math.sin(t * 3)) * 0.12 : 0;
    this.bulbMesh.scale.setScalar(1 + beat + (this.selected ? 0.15 : 0));
    if (this.bubble) {
      // A un lado: los dos de una pareja espalda con espalda quedan girados 180°, así sus tarjetas no se enciman.
      this.bubble.position.x = 0.55;
      if (this.cardScale !== 1 && this.bubble.userData.base === undefined) this.bubble.userData.base = this.bubble.scale.clone();
      const base = this.bubble.userData.base as THREE.Vector3 | undefined;
      if (base) this.bubble.scale.copy(base).multiplyScalar(this.cardScale);
      this.bubble.position.y = 1.74 + lift + Math.sin(t * 3) * 0.03;
    }
  }

  private pose(act: Act, dt: number, t: number): Stance {
    const k = Math.min(1, dt * 8);
    if (!this.acts.has(act)) this.acts.set(act, 0);
    const out = this.blend;
    for (const key of STANCE_KEYS) out[key] = 0;
    let total = 0;
    for (const [a, w0] of this.acts) {
      const w = w0 + ((a === act ? 1 : 0) - w0) * k;
      if (a !== act && w < 0.01) {
        this.acts.delete(a);
        continue;
      }
      this.acts.set(a, w);
      const s = stanceOf(a, t, this.stance);
      for (const key of STANCE_KEYS) out[key] += s[key] * w;
      total += w;
    }
    for (const key of STANCE_KEYS) out[key] /= total || 1;
    return out;
  }

  private props(dt: number, t: number) {
    const show = (prop: THREE.Object3D, act: Act) => {
      const w = this.acts.get(act) ?? 0;
      prop.visible = w > 0.02;
      if (prop.visible) prop.scale.setScalar(Math.max(0.001, popIn(w)));
      return prop.visible;
    };
    if (show(this.papers.group, "read")) {
      this.flipT = (this.flipT + dt) % 1.1;
      const f = Math.min(1, this.flipT / 0.45);
      this.papers.page.rotation.x = -ease(f) * Math.PI * 1.1;
      this.papers.page.visible = f < 1;
    }
    if (show(this.hand.group, "hand")) {
      // El brazo corto se esconde mientras la mano larga está arriba (no dos brazos derechos).
      this.hand.group.rotation.z = -0.3 + Math.sin(t * 7) * 0.28;
      this.armR.visible = (this.acts.get("hand") ?? 0) < 0.5;
    } else this.armR.visible = true;
    if (show(this.globe.group, "web")) {
      this.globe.group.position.copy(this.spot).y += Math.sin(t * 2) * 0.03;
      this.globe.ball.rotation.y = t * 2.2;
      this.globe.ring.rotation.z = t * 0.6;
    }
  }

  private blink(dt: number, lid = 1) {
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : lid;
  }

  dispose() {
    if (this.bubble) disposeSprite(this.bubble);
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.skin.dispose();
    this.bulb.dispose();
    (this.hitbox.material as THREE.Material).dispose();
  }
}
