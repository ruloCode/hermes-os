// Control del personaje del dueño en tercera persona, estilo RPG: WASD o
// flechas mueven relativo a la cámara, Shift corre, Espacio salta; arrastrar
// orbita la cámara que lo sigue y la rueda acerca o aleja. Choca con muebles y
// paredes (círculo contra cajas), puede subirse de un salto a un escritorio y
// sube escaleras solo (cada escalón es una caja más alta que la anterior, por
// debajo del paso automático). Las cajas tienen base: debajo de la losa del
// piso de arriba se camina.
//
// La idea y las constantes vienen de agent-office (AgentSystemLabs, MIT —
// src/client/player.ts); el código es propio y más corto (sin primera
// persona, escaleras, asientos ni pointer lock).

import * as THREE from "three";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Altura de la parte de arriba (sobre ella se puede estar de pie). */
  top: number;
  /** Altura de la base (default 0): una losa del piso de arriba no estorba al caminar debajo. */
  bottom?: number;
}

const RADIUS = 0.3;
const STEP = 0.35;
/** Altura del personaje: una caja estorba solo si se cruza con esta franja vertical. */
const BODY_H = 1.7;
const WALK = 4.4;
const RUN = 7.4;
const JUMP_V = 6.4;
const GRAVITY = 18;
/** Altura a la que mira la cámara (el pecho del personaje). */
const LOOK_Y = 1.25;

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "ShiftLeft", "ShiftRight"]);

/** Escribir en un campo no mueve al personaje. */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}

function overlaps(c: Collider, x: number, z: number, r: number): boolean {
  const cx = Math.max(c.minX, Math.min(x, c.maxX));
  const cz = Math.max(c.minZ, Math.min(z, c.maxZ));
  return (x - cx) ** 2 + (z - cz) ** 2 < r * r;
}

export class PlayerController {
  readonly pos = new THREE.Vector3();
  vy = 0;
  facing = Math.PI;
  grounded = true;
  /** 0 quieto · 1 caminando · RUN/WALK corriendo (para la animación). */
  speed = 0;
  camYaw = 0;
  camPitch = 0.42;
  camDist = 7;
  enabled = true;
  colliders: Collider[] = [];
  /** Donde la cámara no debe salir (la sala; el frente queda abierto). */
  bounds = { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  private keys = new Set<string>();
  /** Control de juego: stick izquierdo (x derecha, y abajo), correr con RT, salto pedido por botón. */
  private pad = { x: 0, y: 0, run: false };
  private jumpWanted = false;
  private readonly camPos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private snapped = false;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!MOVE_KEYS.has(e.code)) return;
    this.keys.add(e.code);
    if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private onBlur = () => this.keys.clear();

  /** Entrada del control, cada frame. El stick manda sobre el teclado si está inclinado. */
  setPad(x: number, y: number, run: boolean) {
    this.pad = this.enabled ? { x, y, run } : { x: 0, y: 0, run: false };
  }

  /** Stick derecho: gira y levanta la cámara (rad/s a tope). */
  padLook(x: number, y: number, dt: number) {
    this.camYaw -= x * 2.6 * dt;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + y * 1.5 * dt, 0.08, 1.25);
  }

  jump() {
    if (this.enabled) this.jumpWanted = true;
  }

  /** La cámara vuelve detrás del personaje. */
  recenter() {
    this.camYaw = this.facing + Math.PI;
    this.camPitch = 0.42;
  }

  /** Deja de responder (vista aérea, diálogo abierto) y suelta las teclas apretadas. */
  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.keys.clear();
  }

  spawn(x: number, z: number, facing: number, y = 0) {
    this.pos.set(x, y, z);
    this.facing = facing;
    this.camYaw = facing + Math.PI;
    this.vy = 0;
    this.snapped = false;
  }

  orbit(dx: number, dy: number) {
    this.camYaw -= dx * 0.006;
    this.camPitch = THREE.MathUtils.clamp(this.camPitch + dy * 0.004, 0.08, 1.25);
  }

  zoom(deltaY: number) {
    this.camDist = THREE.MathUtils.clamp(this.camDist + deltaY * 0.01, 2.8, 16);
  }

  private blocked(x: number, z: number): boolean {
    for (const c of this.colliders) if (c.top > this.pos.y + STEP && (c.bottom ?? 0) < this.pos.y + BODY_H && overlaps(c, x, z, RADIUS)) return true;
    return false;
  }

  private tryMove(x: number, z: number) {
    if (!this.blocked(x, z)) {
      this.pos.x = x;
      this.pos.z = z;
    }
  }

  private groundAt(): number {
    let g = 0;
    for (const c of this.colliders) if (c.top <= this.pos.y + STEP && overlaps(c, this.pos.x, this.pos.z, RADIUS * 0.8)) g = Math.max(g, c.top);
    return g;
  }

  update(dt: number) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let ix = 0;
    let iz = 0;
    if (k.has("KeyW") || k.has("ArrowUp")) iz -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) iz += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) ix -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) ix += 1;
    // El stick analógico manda si está inclinado: su magnitud es la velocidad.
    let throttle = 1;
    const padMag = Math.hypot(this.pad.x, this.pad.y);
    if (padMag > 0.01) {
      ix = this.pad.x;
      iz = this.pad.y;
      throttle = Math.min(1, padMag);
    }
    const steering = ix !== 0 || iz !== 0;
    const running = k.has("ShiftLeft") || k.has("ShiftRight") || this.pad.run;
    if (steering) {
      const len = Math.hypot(ix, iz);
      ix /= len;
      iz /= len;
      // "Adelante" es hacia donde mira la cámara.
      const sin = Math.sin(this.camYaw);
      const cos = Math.cos(this.camYaw);
      const dx = ix * cos + iz * sin;
      const dz = -ix * sin + iz * cos;
      const v = (running ? RUN : WALK) * throttle * dt;
      this.tryMove(this.pos.x + dx * v, this.pos.z);
      this.tryMove(this.pos.x, this.pos.z + dz * v);
      const want = Math.atan2(dx, dz);
      const diff = Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing));
      this.facing += diff * Math.min(1, dt * 14);
    }
    this.speed += ((steering ? (running ? RUN / WALK : 1) * throttle : 0) - this.speed) * Math.min(1, dt * 12);

    const ground = this.groundAt();
    if ((k.has("Space") || this.jumpWanted) && this.grounded) {
      this.vy = JUMP_V;
      this.grounded = false;
    }
    this.jumpWanted = false;
    this.vy -= GRAVITY * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    } else if (this.pos.y > ground + 0.02) this.grounded = false;
    this.updateCamera();
  }

  /** Cámara detrás del personaje, suavizada, recortada para no salir de la sala. */
  private updateCamera() {
    this.target.set(this.pos.x, this.pos.y + LOOK_Y, this.pos.z);
    const cp = Math.cos(this.camPitch);
    const dir = new THREE.Vector3(Math.sin(this.camYaw) * cp, Math.sin(this.camPitch), Math.cos(this.camYaw) * cp);
    // Si la cámara quedaría fuera de la sala, se acerca por el mismo rayo.
    let dist = this.camDist;
    const b = this.bounds;
    const limit = (p: number, d: number, lo: number, hi: number) => {
      if (Math.abs(d) < 1e-6) return Infinity;
      const edge = d > 0 ? hi : lo;
      const t = (edge - p) / d;
      return t > 0 ? t : Infinity;
    };
    dist = Math.min(dist, limit(this.target.x, dir.x, b.minX + 0.4, b.maxX - 0.4), limit(this.target.z, dir.z, b.minZ + 0.4, b.maxZ + 30));
    dist = Math.max(1.6, dist);
    this.camPos.copy(this.target).addScaledVector(dir, dist);
    if (!this.snapped) {
      this.camera.position.copy(this.camPos);
      this.snapped = true;
    } else this.camera.position.lerp(this.camPos, 0.2);
    this.camera.lookAt(this.target);
  }

  dispose() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
  }
}
