// Partículas sutiles de la Oficina (capa "Exterior"): polvo que flota en la
// luz del día adentro y hojas que caen en la azotea. UN Points por sistema
// (una draw call cada uno, sin contorno), animado en CPU (unas pocas centenas
// de puntos) y solo en el piso que se ve. No es un dato: es aire.

import * as THREE from "three";
import { mulberry32 } from "@hermes/shared";

const DUST = 160;
const LEAVES = 70;

function dotTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Hoja: un óvalo con su nervio, para que se lea "hoja" y no "punto". */
function leafTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.translate(32, 32);
  g.rotate(0.6);
  g.fillStyle = "#ffffff";
  g.beginPath();
  g.ellipse(0, 0, 26, 12, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-22, 0);
  g.lineTo(22, 0);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class OfficeParticles {
  readonly group = new THREE.Group();
  private readonly dust: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly leaves: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly dustV: Float32Array;
  private readonly leafV: Float32Array;
  private readonly rng = mulberry32(42);
  private bounds: Bounds = { minX: -10, maxX: 10, minZ: -6, maxZ: 6 };
  private floorY = [0, 3.6, 7.2];
  private dustFloor = -1;
  /** QA: cuántas partículas se ven ahora. */
  visibleCount = 0;

  constructor() {
    const mk = (n: number, tex: THREE.Texture, size: number, color: string, opacity: number, additive: boolean) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const colors = new Float32Array(n * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.PointsMaterial({
        map: tex,
        size,
        sizeAttenuation: true,
        transparent: true,
        opacity,
        depthWrite: false,
        vertexColors: true,
        color,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      });
      mat.userData.outlineParameters = { visible: false };
      const p = new THREE.Points(geo, mat);
      p.frustumCulled = false;
      p.renderOrder = 2;
      return p;
    };
    this.dust = mk(DUST, dotTexture(), 0.07, "#ffffff", 0.0, true);
    this.leaves = mk(LEAVES, leafTexture(), 0.22, "#ffffff", 0.95, false);
    this.dustV = new Float32Array(DUST * 3);
    this.leafV = new Float32Array(LEAVES * 3);
    const lc = this.leaves.geometry.attributes.color as THREE.BufferAttribute;
    const greens = ["#7cb86a", "#5fb760", "#e9c46a", "#d98c3f", "#b5563a"].map((c) => new THREE.Color(c));
    for (let i = 0; i < LEAVES; i++) {
      const c = greens[Math.floor(this.rng() * greens.length)];
      lc.setXYZ(i, c.r, c.g, c.b);
    }
    const dc = this.dust.geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < DUST; i++) dc.setXYZ(i, 1, 0.92, 0.75);
    this.group.add(this.dust, this.leaves);
  }

  setWorld(bounds: Bounds, floorY: readonly number[]) {
    this.bounds = bounds;
    this.floorY = [...floorY];
    this.dustFloor = -1;
    this.seedLeaves();
  }

  private seedDust(floor: number) {
    const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
    const b = this.bounds;
    const y0 = this.floorY[floor] ?? 0;
    for (let i = 0; i < DUST; i++) {
      pos.setXYZ(i, b.minX + this.rng() * (b.maxX - b.minX), y0 + 0.3 + this.rng() * 2.8, b.minZ + this.rng() * (b.maxZ - b.minZ));
      this.dustV[i * 3] = (this.rng() - 0.5) * 0.06;
      this.dustV[i * 3 + 1] = (this.rng() - 0.5) * 0.03;
      this.dustV[i * 3 + 2] = (this.rng() - 0.5) * 0.06;
    }
    pos.needsUpdate = true;
  }

  private seedLeaves() {
    const pos = this.leaves.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < LEAVES; i++) this.respawnLeaf(pos, i, true);
    pos.needsUpdate = true;
  }

  private respawnLeaf(pos: THREE.BufferAttribute, i: number, anyHeight: boolean) {
    const b = this.bounds;
    const top = (this.floorY[2] ?? 7.2) + 5;
    pos.setXYZ(i, b.minX - 4 + this.rng() * (b.maxX - b.minX + 8), anyHeight ? (this.floorY[2] ?? 7.2) + this.rng() * 5 : top, b.minZ - 4 + this.rng() * (b.maxZ - b.minZ + 8));
    this.leafV[i * 3] = 0.25 + this.rng() * 0.35; // viento hacia +x
    this.leafV[i * 3 + 1] = -(0.25 + this.rng() * 0.3);
    this.leafV[i * 3 + 2] = (this.rng() - 0.5) * 0.2;
  }

  /**
   * Cada frame. `shownFloor`: piso a la vista (el polvo vive ahí, las hojas en
   * la azotea); `day`: 0..1 (el polvo se ve en la luz del día).
   */
  update(dt: number, t: number, shownFloor: number, day: number) {
    const indoor = shownFloor < 2;
    if (indoor && shownFloor !== this.dustFloor) {
      this.dustFloor = shownFloor;
      this.seedDust(shownFloor);
    }
    this.dust.visible = indoor && day > 0.05;
    this.dust.material.opacity = 0.55 * day;
    this.leaves.visible = shownFloor === 2;
    this.visibleCount = (this.dust.visible ? DUST : 0) + (this.leaves.visible ? LEAVES : 0);
    if (this.dust.visible) {
      const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
      const b = this.bounds;
      const y0 = this.floorY[shownFloor] ?? 0;
      for (let i = 0; i < DUST; i++) {
        let x = pos.getX(i) + (this.dustV[i * 3] + Math.sin(t * 0.3 + i) * 0.01) * dt;
        let y = pos.getY(i) + (this.dustV[i * 3 + 1] + Math.sin(t * 0.5 + i * 1.7) * 0.012) * dt;
        let z = pos.getZ(i) + this.dustV[i * 3 + 2] * dt;
        if (x < b.minX) x = b.maxX;
        if (x > b.maxX) x = b.minX;
        if (z < b.minZ) z = b.maxZ;
        if (z > b.maxZ) z = b.minZ;
        if (y < y0 + 0.2) y = y0 + 3;
        if (y > y0 + 3.2) y = y0 + 0.3;
        pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
    if (this.leaves.visible) {
      const pos = this.leaves.geometry.attributes.position as THREE.BufferAttribute;
      const ground = this.floorY[2] ?? 7.2;
      for (let i = 0; i < LEAVES; i++) {
        const sway = Math.sin(t * 1.6 + i * 2.1) * 0.35;
        const x = pos.getX(i) + (this.leafV[i * 3] + sway) * dt;
        const y = pos.getY(i) + this.leafV[i * 3 + 1] * dt;
        const z = pos.getZ(i) + (this.leafV[i * 3 + 2] + Math.cos(t * 1.1 + i) * 0.15) * dt;
        if (y < ground + 0.02 || x > this.bounds.maxX + 6) this.respawnLeaf(pos, i, false);
        else pos.setXYZ(i, x, y, z);
      }
      pos.needsUpdate = true;
    }
  }

  dispose() {
    for (const p of [this.dust, this.leaves]) {
      p.geometry.dispose();
      p.material.map?.dispose();
      p.material.dispose();
    }
    this.group.removeFromParent();
  }
}
