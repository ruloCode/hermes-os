// El personaje del dueño: un humano chibi que camina por la Oficina entre sus
// agentes. Cabeza grande, ojos, cejas, mejillas y sonrisa; pelo con ocho
// peinados (rulos por defecto, con volumen arriba y reflejos); barba, gafas y
// accesorios opcionales; brazos y piernas en pivotes que se balancean al caminar.
//
// Basado en agent-office (AgentSystemLabs, MIT — clase Person de
// src/client/world/character.ts): mismo cuerpo, mismos peinados y la misma
// caminata. Recortado a lo que usa la oficina (sin tazas, cartas, libros,
// golf ni disfraces). Adelante es +z.

import * as THREE from "three";
import { HAIR_COLORS, HAIR_STYLES, HAT_STYLES, PANTS_COLORS, SHIRT_COLORS, SKIN_TONES, type OwnerLook } from "./look";
import { mesh, toon, toonUnique } from "./toon";

/** Cadera sobre los pies (de pie). */
const HIPS = 0.42;
/** Base del torso sobre los pies: sentado, esto es lo que apoya en el asiento. */
export const PERSON_SEAT_OFFSET = 0.32;

/**
 * Pose en reposo (la gente de ambiente; el dueño siempre está de pie):
 * sentado, con una taza, con la raqueta, con las manos en un juego, señalando,
 * mirando arriba, lanzando un dardo o mirando por la ventana.
 */
export type PersonPose = "stand" | "sit" | "cup" | "sitcup" | "paddle" | "hands" | "point" | "lookup" | "throw" | "window" | "dance" | "eat" | "talk" | "listen" | "clap";

/** Sombra de contacto compartida por todas las personas: un gradiente bajo los pies (una textura, una geometría). */
let blobAssets: { geo: THREE.PlaneGeometry; mat: THREE.MeshBasicMaterial } | null = null;
function blobShadow(): THREE.Mesh {
  if (!blobAssets) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(0,0,0,0.42)");
    grad.addColorStop(0.6, "rgba(0,0,0,0.18)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const geo = new THREE.PlaneGeometry(0.9, 0.9);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    mat.userData.outlineParameters = { visible: false };
    blobAssets = { geo, mat };
  }
  const m = new THREE.Mesh(blobAssets.geo, blobAssets.mat);
  m.position.y = 0.015;
  m.renderOrder = 1;
  return m;
}

export class Person {
  /** Sombras de contacto prendidas (las enciende la capa "Texturas y arte"). */
  static contactShadows = true;
  readonly root = new THREE.Group();
  /** Sombra de contacto: se queda en el piso aunque el cuerpo rebote o se siente. */
  private blob: THREE.Mesh;
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
  /** Reflejo cobrizo de algunos rulos (sale del color del pelo). */
  private hairHi: THREE.MeshToonMaterial;
  private collarMat: THREE.MeshToonMaterial;
  /** Barba, gafas y accesorios: se rearman al cambiar la apariencia. */
  private features = new THREE.Group();
  private chest = new THREE.Group();
  private walkPhase = 0;
  private waveT = -1;
  private look: OwnerLook;
  private pose: PersonPose = "stand";
  /** Taza o raqueta en la mano derecha (solo en esas poses). */
  private prop: THREE.Object3D | null = null;
  /** Desfase propio de las animaciones en reposo: dos personas no se mueven al unísono. */
  private phase = Math.random() * 10;
  /** Sonrisa y boca abierta: al hablar, la boca se abre con el volumen de su voz. */
  private smile: THREE.Mesh | null = null;
  private mouth: THREE.Mesh | null = null;
  private talkLevel = 0;

  constructor(look: OwnerLook) {
    this.look = { ...look };
    this.shirt = toonUnique(SHIRT_COLORS[look.shirt]);
    const skin = (this.skin = toonUnique(SKIN_TONES[look.skin]));
    this.hairMat = toonUnique(HAIR_COLORS[look.hair]);
    this.hairMat.side = THREE.DoubleSide;
    this.hairHi = toonUnique(highlightOf(HAIR_COLORS[look.hair]));
    this.collarMat = toonUnique(collarOf(SHIRT_COLORS[look.shirt]));
    const pants = toon(PANTS_COLORS[look.pants ?? 0] ?? PANTS_COLORS[0]);
    const shoes = toon("#2b2d42");
    const ink = toon("#1d1d1d");

    this.root.add(this.body);
    this.blob = blobShadow();
    this.root.add(this.blob);
    this.body.add(mesh(new THREE.CapsuleGeometry(0.26, 0.28, 6, 12), this.shirt, 0, 0.72, 0));
    // Cuello de la camiseta, para que se lea como ropa.
    const collar = mesh(new THREE.TorusGeometry(0.15, 0.035, 6, 16), this.collarMat, 0, 1.02, 0, false);
    collar.rotation.x = Math.PI / 2;
    this.body.add(collar);

    const head = this.head;
    head.position.y = 1.32;
    head.add(mesh(new THREE.SphereGeometry(0.34, 24, 18), skin));
    head.add(this.hair);
    const shine = toon("#ffffff");
    for (const sx of [-1, 1]) {
      head.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), ink, sx * 0.12, 0.02, 0.3, false));
      // Brillo en el ojo: la mirada se lee viva.
      head.add(mesh(new THREE.SphereGeometry(0.017, 6, 5), shine, sx * 0.12 + 0.018, 0.04, 0.345, false));
      head.add(mesh(new THREE.SphereGeometry(0.05, 10, 8), toon("#ff9f9f"), sx * 0.2, -0.08, 0.27, false));
      // Orejas.
      head.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), skin, sx * 0.33, -0.02, 0, false));
    }
    const smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.08, 0.32, false);
    smile.rotation.z = Math.PI;
    head.add(smile);
    this.smile = smile;
    // Boca abierta (oculta en reposo): un óvalo oscuro que crece con la voz.
    const mouth = mesh(new THREE.SphereGeometry(0.05, 12, 8), toon("#5a1f1f"), 0, -0.1, 0.305, false);
    mouth.scale.set(1.1, 0.05, 0.4);
    mouth.visible = false;
    head.add(mouth);
    this.mouth = mouth;
    // Cejas gruesas, del color del pelo.
    for (const sx of [-1, 1]) {
      const brow = mesh(new THREE.CapsuleGeometry(0.02, 0.07, 4, 6), this.hairMat, sx * 0.125, 0.11, 0.315, false);
      brow.rotation.z = Math.PI / 2 + sx * 0.12;
      head.add(brow);
    }
    head.add(this.features);
    this.body.add(this.chest);
    this.body.add(head);
    this.buildHair();
    this.buildFeatures();

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
    const refeature = look.beard !== this.look.beard || look.glasses !== this.look.glasses || look.extras !== this.look.extras || look.hat !== this.look.hat;
    this.look = { ...look };
    this.skin.color.set(SKIN_TONES[look.skin]);
    this.hairMat.color.set(HAIR_COLORS[look.hair]);
    this.hairHi.color.set(highlightOf(HAIR_COLORS[look.hair]));
    this.shirt.color.set(SHIRT_COLORS[look.shirt]);
    this.collarMat.color.set(collarOf(SHIRT_COLORS[look.shirt]));
    if (restyle) this.buildHair();
    if (refeature) this.buildFeatures();
  }

  /** Barba (bigote + mentón + mandíbula), gafas y accesorios (collar con dije y arete). */
  private buildFeatures() {
    for (const g of [this.features, this.chest]) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      g.clear();
    }
    const hair = this.hairMat;
    if (this.look.beard) {
      // Cascarones apenas más grandes que la cabeza (0,34): mentón al frente y mandíbula a los lados.
      const front = Math.PI / 2; // en SphereGeometry, phi = π/2 mira a +z
      // Mentón (debajo de la boca) y una línea de mandíbula fina a cada lado; las mejillas quedan a la vista.
      this.features.add(mesh(new THREE.SphereGeometry(0.352, 24, 10, front - 0.95, 1.9, Math.PI * 0.63, Math.PI * 0.27), hair, 0, 0, 0, false));
      for (const s of [-1, 1]) {
        const phi = s < 0 ? front + 0.7 : front - 1.5;
        this.features.add(mesh(new THREE.SphereGeometry(0.35, 12, 8, phi, 0.8, Math.PI * 0.58, Math.PI * 0.14), hair, 0, 0, 0, false));
      }
      // Bigote en arco sobre la sonrisa.
      const stache = mesh(new THREE.TorusGeometry(0.075, 0.022, 6, 14, Math.PI), hair, 0, -0.06, 0.33, false);
      stache.scale.set(1, 0.45, 1);
      this.features.add(stache);
    }
    if (this.look.glasses) {
      const frame = toon("#e4ecf1", { opacity: 0.9 });
      const temple = toon("#3a86ff");
      const lens = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.16, depthWrite: false });
      for (const sx of [-1, 1]) {
        const rim = mesh(new THREE.TorusGeometry(0.078, 0.013, 6, 24), frame, sx * 0.128, 0.02, 0.365, false);
        rim.scale.set(1.12, 0.92, 1);
        this.features.add(rim);
        const glass = new THREE.Mesh(new THREE.CircleGeometry(0.076, 20), lens);
        glass.position.set(sx * 0.128, 0.02, 0.368);
        glass.scale.set(1.12, 0.92, 1);
        this.features.add(glass);
        // Patilla azul: del borde del marco (x ±0,22, z 0,36) hacia atrás hasta la oreja (x ±0,34, z 0).
        const arm = mesh(new THREE.BoxGeometry(0.018, 0.018, 0.38), temple, sx * 0.285, 0.035, 0.18, false);
        arm.rotation.y = -sx * 0.32;
        this.features.add(arm);
      }
      this.features.add(mesh(new THREE.CapsuleGeometry(0.012, 0.05, 4, 6), frame, 0, 0.04, 0.37, false));
      this.features.children[this.features.children.length - 1].rotation.z = Math.PI / 2;
    }
    const hat = HAT_STYLES[this.look.hat ?? 0];
    const style = HAIR_STYLES[this.look.style];
    // Gorra o gorro: no sobre puntas ni moño (se atraviesan).
    if (hat !== "ninguno" && style !== "Puntas" && style !== "Moño" && style !== "Rulos" && style !== "Rizado") {
      const color = toon(`#${new THREE.Color(SHIRT_COLORS[this.look.shirt]).lerp(new THREE.Color(hat === "gorra" ? "#ffffff" : "#000000"), 0.3).getHexString()}`);
      const crown = mesh(new THREE.SphereGeometry(0.372, 20, 10, 0, Math.PI * 2, 0, Math.PI * (hat === "gorro" ? 0.47 : 0.4)), color, 0, 0.03, -0.01, false);
      crown.rotation.x = -0.18;
      this.features.add(crown);
      if (hat === "gorra") {
        const brim = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.025, 16, 1, false, -Math.PI / 2, Math.PI), color, 0, 0.17, 0.3, false);
        brim.scale.set(1.25, 1, 1.2);
        brim.rotation.x = 0.12;
        this.features.add(brim);
      } else {
        const fold = mesh(new THREE.TorusGeometry(0.345, 0.04, 6, 24), color, 0, 0.12, -0.02, false);
        fold.rotation.x = Math.PI / 2 - 0.18;
        this.features.add(fold);
        this.features.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), color, 0, 0.42, -0.08, false));
      }
    }
    if (this.look.extras) {
      // Arete en la oreja izquierda (el personaje mira a +z: su izquierda es +x).
      this.features.add(mesh(new THREE.SphereGeometry(0.022, 8, 6), toon("#d9d9d9"), 0.36, -0.09, 0.03, false));
      // Collar negro con dije azul sobre la camiseta.
      // Cordón en V: de los lados del cuello, por encima de la camiseta, hasta el dije.
      const cordMat = toon("#1d1d1d");
      const gemAt = new THREE.Vector3(0, 0.87, 0.262);
      for (const sx of [-1, 1]) {
        const from = new THREE.Vector3(sx * 0.13, 1.03, 0.1);
        const len = from.distanceTo(gemAt);
        const cord = mesh(new THREE.CylinderGeometry(0.009, 0.009, len, 5), cordMat, (from.x + gemAt.x) / 2, (from.y + gemAt.y) / 2, (from.z + gemAt.z) / 2 + 0.012, false);
        cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), gemAt.clone().sub(from).normalize());
        this.chest.add(cord);
      }
      const gem = mesh(new THREE.OctahedronGeometry(0.045), toon("#4cc9f0", { emissive: "#1b6fa3" }), 0, 0.84, 0.27, false);
      gem.scale.set(0.8, 1.3, 0.6);
      this.chest.add(gem);
    }
  }

  /** Pose en reposo; se aplica mientras no camina. Cambia la utilería de la mano. */
  setPose(pose: PersonPose) {
    if (pose === this.pose) return;
    this.pose = pose;
    if (this.prop) {
      this.armR.remove(this.prop);
      this.prop.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      this.prop = null;
    }
    if (pose === "cup" || pose === "sitcup" || pose === "paddle") {
      const g = new THREE.Group();
      if (pose === "cup" || pose === "sitcup") {
        g.add(mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.11, 10), toon("#f4f1ea"), 0, -0.43, 0.07, false));
        g.add(mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.01, 10), toon("#6f4e37"), 0, -0.375, 0.07, false));
      } else {
        g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6), toon("#8a5a3b"), 0, -0.48, 0, false));
        const face = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 14), toon("#d62828"), 0, -0.6, 0, false);
        face.rotation.x = Math.PI / 2;
        g.add(face);
      }
      g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
      this.armR.add(g);
      this.prop = g;
    }
  }

  /** Habla: `level` 0..1 (0 = callado). La boca se abre y la cabeza acompaña. */
  setTalking(level: number) {
    this.talkLevel = Math.max(0, Math.min(1, level));
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
      case "Rulos": {
        // Lados cortos (un casquete bajo) y arriba volumen: dos capas de rulos,
        // algunos con reflejo cobrizo, y ricitos sobre la frente.
        // Sin la franja del frente (φ = π/2 mira a +z): la cara queda libre.
        add(new THREE.SphereGeometry(0.352, 20, 12, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0, Math.PI * 0.55), 0, 0.01, -0.02, -0.2);
        const curl = (r: number, x: number, y: number, z: number, hi: boolean) => {
          const part = mesh(new THREE.SphereGeometry(r, 9, 7), hi ? this.hairHi : m, x, y, z);
          this.hair.add(part);
        };
        const layer = (n: number, radius: number, minY: number, size: number, lift: number) => {
          for (let i = 0; i < n; i++) {
            const y = 1 - (i / (n - 1)) * 2;
            if (y < minY) continue;
            const rr = Math.sqrt(1 - y * y);
            const th = i * 2.39996;
            const px = Math.cos(th) * rr;
            const pz = Math.sin(th) * rr;
            // La frente queda despejada: nada muy adelante y bajo.
            if (pz > 0.45 && y < 0.62) continue;
            const wobble = 0.85 + ((i * 37) % 7) / 20;
            curl(size * wobble, px * radius, y * radius * 1.05 + lift, pz * radius - 0.03, i % 3 === 0);
          }
        };
        layer(90, 0.37, 0.18, 0.085, 0.03);
        layer(46, 0.43, 0.5, 0.1, 0.08);
        // Ricitos al borde de la frente: anillos que miran al frente.
        for (let i = 0; i < 6; i++) {
          const x = -0.22 + i * 0.088;
          const ring = mesh(new THREE.TorusGeometry(0.042, 0.02, 6, 10), i % 2 ? this.hairHi : m, x, 0.3 - Math.abs(x) * 0.25, 0.24 - Math.abs(x) * 0.25);
          ring.rotation.x = -0.5;
          this.hair.add(ring);
        }
        break;
      }
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
    this.head.rotation.x = 0;
    this.head.rotation.y = 0;
    if (!moving && !airborne && this.pose !== "stand") this.applyPose(t + this.phase);
    if (this.waveT >= 0) {
      this.waveT += dt;
      const w = Math.min(1, this.waveT / 0.2) * Math.min(1, Math.max(0, (1.2 - this.waveT) / 0.2));
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 2.6 + Math.sin(this.waveT * 14) * 0.35, w);
      if (this.waveT > 1.2) this.waveT = -1;
    }
    // Rebote al caminar y respiración en reposo.
    this.body.position.y = moving && !airborne ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(t * 2) * 0.008;
    if (!moving && this.pose === "paddle") this.body.position.y = Math.abs(Math.sin((t + this.phase) * 5)) * 0.04;
    if (!moving && this.pose === "dance") this.body.position.y = Math.abs(Math.sin((t + this.phase) * 7)) * 0.08;
    this.head.rotation.z = moving ? Math.sin(this.walkPhase) * 0.04 : 0;
    this.blob.visible = Person.contactShadows && !airborne;
    // Quien la crea suele recorrer el cuerpo con castShadow = true: la mancha nunca proyecta (sería un cuadro).
    this.blob.castShadow = false;
    // La boca sigue a la voz (con un mínimo para que se lea "está hablando" aunque la síntesis no dé volumen).
    if (this.mouth && this.smile) {
      const open = this.talkLevel > 0.01 ? 0.25 + this.talkLevel * (0.6 + 0.4 * Math.abs(Math.sin(t * 17 + this.phase))) : 0;
      this.mouth.visible = open > 0;
      this.smile.visible = open === 0;
      if (open) {
        this.mouth.scale.set(1.1, open, 0.4);
        this.head.rotation.x += Math.sin(t * 9 + this.phase) * 0.04 * this.talkLevel;
      }
    }
  }

  /** Brazos, piernas y cabeza de cada pose (t ya trae el desfase propio). */
  private applyPose(t: number) {
    const { armL, armR, legL, legR, head } = this;
    const ease = (x: number) => x * x * (3 - 2 * x);
    switch (this.pose) {
      case "sit":
        legL.rotation.x = legR.rotation.x = -1.35;
        armL.rotation.set(-0.55, 0, -0.12);
        armR.rotation.set(-0.55, 0, 0.12);
        head.rotation.y = Math.sin(t * 0.4) * 0.25;
        break;
      case "sitcup": {
        // Sentado con la taza: piernas de "sit" y sorbos de "cup".
        legL.rotation.x = legR.rotation.x = -1.35;
        const k = t % 6;
        const sip = k < 1.4 ? ease(Math.sin((k / 1.4) * Math.PI)) : 0;
        armR.rotation.set(-1.0 - sip * 1.2, 0, 0.18 - sip * 0.1);
        armL.rotation.set(-0.55, 0, -0.12);
        head.rotation.x = sip * 0.2;
        break;
      }
      case "dance": {
        // Baile propio: brazos que suben por turnos y rebote con las piernas.
        const b = t * 7;
        armL.rotation.set(0, 0, -1.3 - Math.sin(b) * 1.1);
        armR.rotation.set(0, 0, 1.3 - Math.sin(b + Math.PI) * 1.1);
        legL.rotation.x = Math.max(0, Math.sin(b)) * 0.45;
        legR.rotation.x = Math.max(0, Math.sin(b + Math.PI)) * 0.45;
        head.rotation.z = Math.sin(b) * 0.15;
        this.body.position.y = Math.abs(Math.sin(b)) * 0.08;
        break;
      }
      case "eat": {
        // Un snack: la mano a la boca, mordisco a mordisco.
        const k = (t * 1.6) % 1;
        armR.rotation.set(-1.9 + Math.sin(k * Math.PI) * 0.5, 0, 0.35);
        armL.rotation.set(-0.5, 0, -0.1);
        head.rotation.x = Math.sin(k * Math.PI * 2) * 0.06;
        break;
      }
      case "cup": {
        // Taza a la altura del pecho y, cada tanto, un sorbo.
        const k = t % 7;
        const sip = k < 1.4 ? ease(Math.sin((k / 1.4) * Math.PI)) : 0;
        armR.rotation.set(-1.0 - sip * 1.2, 0, 0.18 - sip * 0.1);
        armL.rotation.set(0, 0, -0.1);
        head.rotation.x = sip * 0.2;
        break;
      }
      case "paddle":
        armR.rotation.set(-0.9 + Math.sin(t * 5) * 0.55, 0, 0.35);
        armL.rotation.set(-0.4, 0, -0.25);
        legL.rotation.x = Math.sin(t * 5) * 0.15;
        legR.rotation.x = -Math.sin(t * 5) * 0.15;
        break;
      case "hands":
        armL.rotation.set(-1.2 + Math.sin(t * 8) * 0.12, 0, -0.05);
        armR.rotation.set(-1.2 + Math.cos(t * 7) * 0.12, 0, 0.05);
        break;
      case "point":
        armR.rotation.set(-1.45, 0, 0.15 + Math.sin(t * 1.3) * 0.12);
        armL.rotation.set(0, 0, -0.1);
        head.rotation.y = Math.sin(t * 0.7) * 0.15;
        break;
      case "lookup":
        head.rotation.x = -0.32;
        head.rotation.y = Math.sin(t * 0.35) * 0.4;
        armL.rotation.set(0.25, 0, -0.08);
        armR.rotation.set(0.25, 0, 0.08);
        break;
      case "throw": {
        // Apunta, echa el brazo atrás y lanza, cada 3,5 s.
        const k = (t % 3.5) / 3.5;
        const back = k < 0.6 ? 0 : k < 0.8 ? ease((k - 0.6) / 0.2) : 1 - ease((k - 0.8) / 0.2);
        armR.rotation.set(-1.5 - back * 0.9, 0, 0.1);
        armL.rotation.set(-0.3, 0, -0.1);
        break;
      }
      case "talk": {
        // Gesticula: una mano y luego la otra, a ritmo de conversación.
        const a = Math.sin(t * 3.1);
        const b = Math.sin(t * 2.3 + 1.7);
        armR.rotation.set(-0.7 - Math.max(0, a) * 0.6, 0, 0.25 + a * 0.15);
        armL.rotation.set(-0.35 - Math.max(0, b) * 0.45, 0, -0.2 - b * 0.12);
        head.rotation.y = Math.sin(t * 0.9) * 0.12;
        break;
      }
      case "listen":
        // Escucha: asiente despacio con las manos atrás.
        armL.rotation.set(0.3, 0, -0.06);
        armR.rotation.set(0.3, 0, 0.06);
        head.rotation.x = Math.max(0, Math.sin(t * 2.2)) * 0.12;
        head.rotation.z = Math.sin(t * 0.7) * 0.06;
        break;
      case "clap": {
        // Aplaude: las manos se juntan frente al pecho.
        const k = Math.abs(Math.sin(t * 9));
        armL.rotation.set(-1.25, 0, -0.55 + k * 0.4);
        armR.rotation.set(-1.25, 0, 0.55 - k * 0.4);
        this.body.position.y = Math.abs(Math.sin(t * 4.5)) * 0.03;
        break;
      }
      case "window":
        armL.rotation.set(0.35, 0, -0.06);
        armR.rotation.set(0.35, 0, 0.06);
        head.rotation.y = Math.sin(t * 0.3) * 0.35;
        break;
    }
  }

  dispose() {
    this.prop = null;
    this.root.remove(this.blob); // compartida: no se libera con la persona
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.shirt.dispose();
    this.skin.dispose();
    this.hairMat.dispose();
    this.hairHi.dispose();
    this.collarMat.dispose();
  }
}

/** El reflejo de los rulos: el color del pelo hacia un cobrizo. */
function highlightOf(hair: string): string {
  return `#${new THREE.Color(hair).lerp(new THREE.Color("#b5652b"), 0.45).getHexString()}`;
}

/** El cuello de la camiseta: un tono más oscuro que ella, para que se lea sobre el blanco. */
function collarOf(shirt: string): string {
  return `#${new THREE.Color(shirt).lerp(new THREE.Color("#000000"), 0.14).getHexString()}`;
}

function roundedShoe(): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(0.075, 0.12, 4, 8);
  g.rotateX(Math.PI / 2);
  return g;
}
