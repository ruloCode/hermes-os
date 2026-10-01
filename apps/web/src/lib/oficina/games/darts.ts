// Dardos en la diana de la azotea: la mira oscila sola (el pulso de la mano)
// alrededor de donde apuntas; al lanzar, el dardo vuela hasta ese punto y el
// puntaje sale del sector y el anillo REALES de la diana pintada (dartScore).
// 9 dardos en tres rondas de 3.

import * as THREE from "three";
import { DARTS_PER_GAME, dartAim, dartScore, type GameInput } from "@hermes/shared";
import { mesh, toon } from "../toon";
import type { GameCtx, GameEvent, MiniGame } from "./types";

/** Radio del borde del doble en metros (la cara mide 0,3 m y el doble llega a 106/128 de ella). */
const R = 0.3 * (106 / 128);
const FLIGHT = 0.38;

interface Flying {
  obj: THREE.Group;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  points: number;
  label: string;
}

function dartMesh(color: string): THREE.Group {
  const g = new THREE.Group();
  // A lo largo de +x local: la punta adelante (−x en la diana, que mira a +x).
  const body = mesh(new THREE.CylinderGeometry(0.005, 0.008, 0.15, 8), toon("#c9ced6"), 0, 0, 0, false);
  body.rotation.z = Math.PI / 2;
  g.add(body);
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.05, 0.004), toon(color), 0.08, 0, 0, false));
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.004, 0.05), toon(color), 0.08, 0, 0, false));
  return g;
}

export class DartsGame implements MiniGame {
  readonly id = "darts" as const;
  readonly group = new THREE.Group();
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  private readonly center: THREE.Vector3;
  private readonly reticle: THREE.Mesh;
  private base = { x: 0, y: 0 };
  private t = 0;
  private thrown = 0;
  private total = 0;
  private last = "";
  private flying: Flying | null = null;
  private stuck: THREE.Group[] = [];
  private finished = false;

  constructor(ctx: GameCtx) {
    const a = ctx.spot.anchor;
    this.center = new THREE.Vector3(a.x, a.y, a.z);
    // La diana mira a +x: la cámara se para enfrente, a 1,5 m, a la altura del ojo.
    this.camera = { pos: new THREE.Vector3(a.x + 1.55, a.y + 0.12, a.z), target: this.center.clone() };
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.026, 24), new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, depthTest: false, transparent: true }));
    ring.rotation.y = Math.PI / 2;
    ring.renderOrder = 10;
    (ring.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.reticle = ring;
    this.group.add(ring);
  }

  get score() {
    return this.total;
  }
  get over() {
    return this.finished;
  }

  /** Punto normalizado de la diana (y hacia arriba) → mundo: la derecha del que mira es −z. */
  private toWorld(p: { x: number; y: number }, out = new THREE.Vector3()) {
    return out.set(this.center.x + 0.012, this.center.y + p.y * R, this.center.z - p.x * R);
  }

  update(dt: number, input: GameInput): GameEvent | null {
    this.t += dt;
    let ev: GameEvent | null = null;
    // Mover la mira (lento: apuntar es fino) dentro de la diana.
    this.base.x = Math.max(-1, Math.min(1, this.base.x + input.x * 0.7 * dt));
    this.base.y = Math.max(-1, Math.min(1, this.base.y + input.y * 0.7 * dt));
    const aim = dartAim(this.t, this.base);
    this.toWorld(aim, this.reticle.position);
    this.reticle.visible = !this.finished && !this.flying;
    if (this.flying) {
      const f = this.flying;
      f.t = Math.min(1, f.t + dt / FLIGHT);
      f.obj.position.lerpVectors(f.from, f.to, f.t);
      f.obj.position.y += Math.sin(f.t * Math.PI) * 0.12;
      if (f.t >= 1) {
        this.total += f.points;
        this.last = f.label;
        this.stuck.push(f.obj);
        this.flying = null;
        ev = f.points > 0 ? "score" : "miss";
        if (this.thrown >= DARTS_PER_GAME) {
          this.finished = true;
          ev = "over";
        }
      }
    } else if (input.pressed && !this.finished) {
      // Nueva ronda: los dardos de la anterior se recogen.
      if (this.thrown % 3 === 0) this.clearStuck();
      const { points, label } = dartScore(aim.x, aim.y);
      const obj = dartMesh(["#e63946", "#3a86ff", "#ffd166"][this.thrown % 3]);
      this.group.add(obj);
      const to = this.toWorld(aim).add(new THREE.Vector3(0.06, 0, 0));
      this.flying = { obj, from: this.camera.pos.clone().add(new THREE.Vector3(-0.2, -0.15, 0.12)), to, t: 0, points, label };
      this.thrown += 1;
      ev = "throw";
    }
    return ev;
  }

  private clearStuck() {
    for (const d of this.stuck) d.removeFromParent();
    this.stuck = [];
  }

  hud() {
    return {
      title: "Dardos",
      score: this.total,
      status: this.finished
        ? `Fin · ${this.total} puntos en ${DARTS_PER_GAME} dardos`
        : `Dardo ${Math.min(this.thrown + (this.flying ? 0 : 1), DARTS_PER_GAME)} de ${DARTS_PER_GAME}${this.last ? ` · último: ${this.last}` : ""}`,
      over: this.finished,
    };
  }

  restart() {
    this.clearStuck();
    this.thrown = 0;
    this.total = 0;
    this.last = "";
    this.finished = false;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    (this.reticle.material as THREE.Material).dispose();
    this.group.removeFromParent();
  }
}
