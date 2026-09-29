// El personaje del dueño: un humano chibi que camina por la Oficina entre sus
// agentes. Cabeza grande, ojos, mejillas y sonrisa; pelo con siete peinados;
// brazos y piernas en pivotes que se balancean al caminar.
//
// Basado en agent-office (AgentSystemLabs, MIT — clase Person de
// src/client/world/character.ts): mismo cuerpo, mismos peinados y la misma
// caminata. Recortado a lo que usa la oficina (sin tazas, cartas, libros,
// golf ni disfraces). Adelante es +z.

import * as THREE from "three";
import { HAIR_COLORS, HAIR_STYLES, SHIRT_COLORS, SKIN_TONES, type OwnerLook } from "./look";
import { mesh, toon, toonUnique } from "./toon";

/** Cadera sobre los pies (de pie). */
const HIPS = 0.42;

export class Person {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private hair = new THREE.Group();
  private legL: THREE.Object3D;
  private legR: THREE.Object3D;
  private armL: THREE.Object3D;
  private armR: THREE.Object3D;
  private shirt: THREE.MeshToonMaterial;
  private skin: THREE.MeshToonMaterial;
  private hairMat: THREE.MeshToonMaterial;
  private walkPhase = 0;
  private waveT = -1;
  private look: OwnerLook;

  constructor(look: OwnerLook) {
    this.look = { ...look };
    this.shirt = toonUnique(SHIRT_COLORS[look.shirt]);
    const skin = (this.skin = toonUnique(SKIN_TONES[look.skin]));
    this.hairMat = toonUnique(HAIR_COLORS[look.hair]);
    this.hairMat.side = THREE.DoubleSide;
    const pants = toon("#3d405b");
    const shoes = toon("#2b2d42");
    const ink = toon("#1d1d1d");

    this.root.add(this.body);
    this.body.add(mesh(new THREE.CapsuleGeometry(0.26, 0.28, 6, 12), this.shirt, 0, 0.72, 0));
    // Cuello de la camiseta, para que se lea como ropa.
    const collar = mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 16), toon("#ffffff"), 0, 1.02, 0, false);
    collar.rotation.x = Math.PI / 2;
    this.body.add(collar);

    const head = this.head;
    head.position.y = 1.32;
    head.add(mesh(new THREE.SphereGeometry(0.34, 24, 18), skin));
    head.add(this.hair);
    for (const sx of [-1, 1]) {
      head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
      head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon("#ff9f9f"), sx * 0.2, -0.08, 0.27, false));
      // Orejas.
      head.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), skin, sx * 0.33, -0.02, 0, false));
    }
    const smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false);
    smile.rotation.z = Math.PI;
    head.add(smile);
    this.body.add(head);
    this.buildHair();

    const limb = (len: number, r: number, mat: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, -len / 2 - r / 2, 0));
      this.body.add(pivot);
      return pivot;
    };
    this.legL = limb(0.22, 0.1, pants, -0.12, HIPS);
    this.legR = limb(0.22, 0.1, pants, 0.12, HIPS);
    for (const leg of [this.legL, this.legR]) leg.add(mesh(roundedShoe(), shoes, 0, -0.39, 0.05));
    this.armL = limb(0.24, 0.08, this.shirt, -0.33, 0.9);
    this.armR = limb(0.24, 0.08, this.shirt, 0.33, 0.9);
    for (const arm of [this.armL, this.armR]) arm.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), skin, 0, -0.38, 0));
  }

  setLook(look: OwnerLook) {
    const restyle = look.style !== this.look.style;
    this.look = { ...look };
    this.skin.color.set(SKIN_TONES[look.skin]);
    this.hairMat.color.set(HAIR_COLORS[look.hair]);
    this.shirt.color.set(SHIRT_COLORS[look.shirt]);
    if (restyle) this.buildHair();
  }

  /** Saludo con la mano (al interactuar con algo). */
  wave() {
    this.waveT = 0;
  }

  /** El pelo son formas sobre la cabeza (centro 0,0,0; la cara mira a +z). */
  private buildHair() {
    for (const o of this.hair.children) (o as THREE.Mesh).geometry.dispose();
    this.hair.clear();
    const m = this.hairMat;
    const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
      const part = mesh(geo, m, x, y, z);
      part.rotation.set(rx, 0, rz);
      this.hair.add(part);
      return part;
    };
    const cap = () => add(new THREE.SphereGeometry(0.355, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), 0, 0.02, -0.02, -0.25);
    switch (HAIR_STYLES[this.look.style]) {
      case "Corto":
        cap();
        break;
      case "Largo": {
        cap();
        const back = add(new THREE.SphereGeometry(0.37, 20, 14, Math.PI * 0.93, Math.PI * 1.14, Math.PI * 0.3, Math.PI * 0.5), 0, -0.06, -0.03);
        back.scale.set(1.02, 1.35, 1);
        break;
      }
      case "Moño":
        cap();
        add(new THREE.SphereGeometry(0.14, 14, 12), 0, 0.3, -0.2);
        break;
      case "Puntas":
        cap();
        for (const [row, n, z, tilt] of [
          [0, 5, 0.08, 0.35],
          [1, 4, -0.12, -0.3],
        ] as const) {
          for (let i = 0; i < n; i++) {
            const a = -0.85 + (i / (n - 1)) * 1.7;
            const spike = add(new THREE.ConeGeometry(0.1, 0.3, 8), Math.sin(a) * 0.24, 0.33 - Math.abs(a) * 0.08 - row * 0.02, z);
            spike.rotation.set(tilt, 0, -a * 0.9);
          }
        }
        break;
      case "Rizado": {
        const n = 70;
        for (let i = 0; i < n; i++) {
          const y = 1 - (i / (n - 1)) * 2;
          const r = Math.sqrt(1 - y * y);
          const th = i * 2.39996;
          const px = Math.cos(th) * r;
          const pz = Math.sin(th) * r;
          if (y < -0.15 || (pz > 0.35 && y < 0.55)) continue;
          add(new THREE.SphereGeometry(0.1, 8, 6), px * 0.36, y * 0.36 + 0.04, pz * 0.36 - 0.02);
        }
        break;
      }
      case "Cola": {
        cap();
        add(new THREE.SphereGeometry(0.075, 10, 8), 0, 0.12, -0.34);
        const tail = add(new THREE.CapsuleGeometry(0.085, 0.3, 6, 10), 0, -0.1, -0.42, 0.35);
        tail.scale.set(1, 1, 0.8);
        break;
      }
      case "Calvo":
        break;
    }
  }

  /** `speed` 0 quieto · 1 caminando · ~1.6 corriendo. */
  update(dt: number, t: number, speed: number, airborne: boolean) {
    const moving = speed > 0.05;
    this.walkPhase += dt * 11 * Math.max(speed, moving ? 1 : 0);
    const k = moving ? Math.min(1, speed) : 0;
    const swing = Math.sin(this.walkPhase) * 0.7 * k;
    if (airborne) {
      this.legL.rotation.x = -0.5;
      this.legR.rotation.x = 0.3;
      this.armL.rotation.set(0, 0, -2.4);
      this.armR.rotation.set(0, 0, 2.4);
    } else {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing;
      this.armR.rotation.x = swing;
      this.armL.rotation.z = THREE.MathUtils.lerp(this.armL.rotation.z, -0.1, 0.3);
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 0.1, 0.3);
    }
    if (this.waveT >= 0) {
      this.waveT += dt;
      const w = Math.min(1, this.waveT / 0.2) * Math.min(1, Math.max(0, (1.2 - this.waveT) / 0.2));
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 2.6 + Math.sin(this.waveT * 14) * 0.35, w);
      if (this.waveT > 1.2) this.waveT = -1;
    }
    // Rebote al caminar y respiración en reposo.
    this.body.position.y = moving && !airborne ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(t * 2) * 0.008;
    this.head.rotation.z = moving ? Math.sin(this.walkPhase) * 0.04 : 0;
  }

  dispose() {
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.shirt.dispose();
    this.skin.dispose();
    this.hairMat.dispose();
  }
}

function roundedShoe(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.075, 0.12, 4, 8);
  g.rotateX(Math.PI / 2);
  return g;
}
