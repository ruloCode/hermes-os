// La gata de la oficina: decorado vivo del piso de los equipos. Atigrada,
// low-poly y propia (cuerpo, cabeza con orejas, cola que se mece), pasea entre
// puntos al azar de la rejilla de navegación, se sienta a lavarse un rato y
// sigue. Va con la gente de ambiente (interruptor "Ambiente"); no es un agente
// ni cuenta en nada.

import * as THREE from "three";
import type { NavGrid, NavPoint } from "@hermes/shared";
import { mesh, noOutline, toon } from "./toon";

const SPEED = 0.9;

export class OfficeCat {
  readonly root = new THREE.Group();
  readonly pos = new THREE.Vector3();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private tail = new THREE.Group();
  private legs: THREE.Object3D[] = [];
  private facing = 0;
  private path: NavPoint[] = [];
  private pathI = 0;
  private restUntil = 0;
  private phase = 0;
  private sitting = false;

  constructor(private readonly rng: () => number) {
    const fur = toon("#e89a4f");
    const stripe = toon("#b8662a");
    const cream = toon("#f6e3c8");
    const ink = toon("#1d1d1d");
    this.root.add(this.body);
    const torso = mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 10), fur, 0, 0.2, 0);
    torso.rotation.x = Math.PI / 2;
    this.body.add(torso);
    // Rayas del lomo.
    for (const z of [-0.09, 0, 0.09]) {
      const s = mesh(new THREE.TorusGeometry(0.105, 0.012, 4, 12, Math.PI), stripe, 0, 0.21, z, false);
      s.rotation.y = Math.PI / 2;
      this.body.add(s);
    }
    this.body.add(mesh(new THREE.SphereGeometry(0.075, 10, 8), cream, 0, 0.16, 0.16, false));
    this.head.position.set(0, 0.32, 0.2);
    this.head.add(mesh(new THREE.SphereGeometry(0.1, 14, 10), fur));
    this.head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), cream, 0, -0.035, 0.07, false));
    for (const sx of [-1, 1]) {
      const ear = mesh(new THREE.ConeGeometry(0.035, 0.07, 4), fur, sx * 0.055, 0.09, 0, false);
      ear.rotation.z = -sx * 0.25;
      this.head.add(ear);
      this.head.add(mesh(new THREE.SphereGeometry(0.014, 6, 5), ink, sx * 0.038, 0.015, 0.09, false));
    }
    this.head.add(mesh(new THREE.SphereGeometry(0.011, 6, 5), toon("#f28da0"), 0, -0.02, 0.105, false));
    this.body.add(this.head);
    this.tail.position.set(0, 0.24, -0.2);
    const t = mesh(new THREE.CapsuleGeometry(0.022, 0.22, 4, 6), fur, 0, 0.11, -0.03, false);
    t.rotation.x = -0.5;
    this.tail.add(t);
    this.tail.add(mesh(new THREE.SphereGeometry(0.026, 6, 5), stripe, 0, 0.22, -0.09, false));
    this.body.add(this.tail);
    for (const [x, z] of [
      [-0.06, 0.11],
      [0.06, 0.11],
      [-0.06, -0.11],
      [0.06, -0.11],
    ]) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.14, z);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.025, 0.08, 3, 6), z > 0 ? cream : fur, 0, -0.07, 0, false));
      this.body.add(pivot);
      this.legs.push(pivot);
    }
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
    noOutline(this.root);
  }

  place(p: NavPoint) {
    this.pos.set(p.x, p.y, p.z);
    this.root.position.copy(this.pos);
  }

  update(dt: number, t: number, nav: NavGrid, bounds: { minX: number; maxX: number; minZ: number; maxZ: number }, owner: THREE.Vector3) {
    const walking = this.pathI < this.path.length;
    if (!walking && t >= this.restUntil) {
      // Un punto al azar del piso 1; de vez en cuando, cerca del dueño (curiosa).
      const near = this.rng() < 0.3 && Math.abs(owner.y - this.pos.y) < 1;
      const x = near ? owner.x + (this.rng() - 0.5) * 3 : bounds.minX + 2 + this.rng() * (bounds.maxX - bounds.minX - 4);
      const z = near ? owner.z + (this.rng() - 0.5) * 3 : bounds.minZ + 2 + this.rng() * (bounds.maxZ - bounds.minZ - 4);
      const goal = nav.snap(0, x, z, 1.5);
      const path = goal ? nav.findPath({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, goal) : null;
      if (path) {
        this.path = path;
        this.pathI = 1;
        this.sitting = false;
      } else this.restUntil = t + 2;
    }
    if (this.pathI < this.path.length) {
      const target = this.path[this.pathI];
      const dx = target.x - this.pos.x;
      const dz = target.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const step = SPEED * dt;
      if (d <= step) {
        this.pos.x = target.x;
        this.pos.z = target.z;
        this.pathI++;
        if (this.pathI >= this.path.length) {
          // Llegó: se sienta entre 6 y 16 s.
          this.restUntil = t + 6 + this.rng() * 10;
          this.sitting = true;
        }
      } else {
        this.pos.x += (dx / d) * step;
        this.pos.z += (dz / d) * step;
        const want = Math.atan2(dx, dz);
        this.facing += Math.atan2(Math.sin(want - this.facing), Math.cos(want - this.facing)) * Math.min(1, dt * 8);
      }
      this.pos.y = nav.heightAt(this.pos.x, this.pos.z, this.pos.y);
    }
    // Patas al trote, cola que se mece; sentada, el lomo baja y la cabeza mira alrededor.
    const moving = this.pathI < this.path.length;
    this.phase += dt * (moving ? 14 : 0);
    this.legs.forEach((l, i) => (l.rotation.x = moving ? Math.sin(this.phase + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 : 0));
    this.tail.rotation.z = Math.sin(t * (moving ? 6 : 1.6)) * 0.35;
    this.body.rotation.x = this.sitting ? -0.35 : 0;
    this.body.position.y = this.sitting ? 0.05 : 0;
    this.head.rotation.y = this.sitting ? Math.sin(t * 0.5) * 0.6 : 0;
    this.head.rotation.x = this.sitting ? 0.25 : 0;
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
  }
}
