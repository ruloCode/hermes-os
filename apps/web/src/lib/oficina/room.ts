// La sala de la Oficina de agentes: el lugar alrededor de los pods. Piso de
// madera, paredes con ventanas, frente abierto (muro bajo de vidrio con la
// entrada, para que la cámara siempre vea adentro), cocina, lounge con TV,
// estantería, plantas y lámparas con luz cálida real.
//
// Todo lo que muestra datos es REAL: la TV pinta el feed de actividad del
// agente, el reloj marca la hora local, el cielo de las ventanas sigue esa hora
// y el letrero lleva el nombre del dueño (NEXT_PUBLIC_HERMES_OWNER_NAME).
//
// Muebles recreados a partir de agent-office (AgentSystemLabs, MIT —
// src/client/world/office.ts: piso de tablones, ventanas, sofá, cocina,
// plantas, lámparas), con otra planta y colores del tema.

import * as THREE from "three";
import type { OfficeLayout } from "@hermes/shared";
import { mesh, roundedBox, toon } from "./toon";
import type { OfficePalette } from "./palette";
import type { Collider } from "./player";

export const WALL_H = 3.4;
const WALL_T = 0.24;
const PARTITION_H = 1.0;
const DOOR_HALF = 2;

export interface FeedLine {
  time: string;
  kind: string;
  text: string;
  tone: "tool" | "done" | "error" | "start" | "text";
}

export interface Daylight {
  /** 0 noche · 1 día. */
  day: number;
  skyTop: string;
  skyBottom: string;
  label: string;
}

export interface BoardStat {
  label: string;
  value: number;
  color: string;
}

export interface Room {
  group: THREE.Group;
  colliders: Collider[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { x: number; z: number; facing: number };
  lamps: THREE.PointLight[];
  /** Clave de tamaño: si cambia, la sala se reconstruye. */
  key: string;
  setFeed(lines: FeedLine[]): void;
  /** Pizarra con los conteos del momento (datos reales de la oficina). */
  setBoard(stats: BoardStat[]): void;
  /** Reloj y cielo con la hora local real. Devuelve la luz del momento. */
  tick(now: Date): Daylight;
  dispose(): void;
}

function box(w: number, h: number, d: number) {
  return new THREE.BoxGeometry(w, h, d);
}

function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}

/** Luz del día según la hora local: noche, amanecer/atardecer y día, con transición suave. */
export function daylightAt(now: Date): Daylight {
  const h = now.getHours() + now.getMinutes() / 60;
  // 0 a medianoche, 1 entre 8 y 17, rampas de 6→8 y 17→19.
  const day = h < 6 || h >= 19 ? 0 : h < 8 ? (h - 6) / 2 : h < 17 ? 1 : 1 - (h - 17) / 2;
  const dusk = day > 0 && day < 1 ? 1 - Math.abs(day - 0.5) * 2 : 0;
  const top = mix(mix("#0b1330", "#6fb1ff", day), "#f08a5d", dusk * 0.6);
  const bottom = mix(mix("#1c2a52", "#dff1ff", day), "#ffd6a5", dusk * 0.8);
  return { day, skyTop: top, skyBottom: bottom, label: day >= 1 ? "día" : day <= 0 ? "noche" : h < 12 ? "amanecer" : "atardecer" };
}

// ── Texturas pintadas en canvas ─────────────────────────────────────────

function planksTexture(base: string, dark: boolean, w: number, d: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const alt = mix(base, dark ? "#000000" : "#8a5a3b", 0.12);
  const seam = mix(base, "#000000", dark ? 0.35 : 0.22);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    const offset = (row % 2) * 128;
    for (let col = -1; col < 3; col++) {
      const x = col * 256 + offset;
      g.fillStyle = (row + col) % 3 === 0 ? alt : base;
      g.fillRect(x + 2, row * 64 + 2, 252, 60);
      // Veta suave.
      g.strokeStyle = mix(base, "#000000", 0.08);
      g.lineWidth = 1;
      for (let v = 0; v < 3; v++) {
        g.beginPath();
        const y = row * 64 + 14 + v * 16 + ((col * 7 + row * 3) % 5);
        g.moveTo(x + 10, y);
        g.bezierCurveTo(x + 90, y - 4, x + 170, y + 4, x + 246, y);
        g.stroke();
      }
    }
    g.fillStyle = seam;
    g.fillRect(0, row * 64, 512, 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 5, d / 5);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function tilesTexture(a: string, b: string, w: number, d: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? a : b;
      g.fillRect(i * 64, j * 64, 64, 64);
    }
  g.strokeStyle = mix(a, "#000000", 0.25);
  g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 256);
    g.moveTo(0, i * 64);
    g.lineTo(256, i * 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 2.4, d / 2.4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ── Muebles ─────────────────────────────────────────────────────────────

function plant(scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.5, 14), toon("#c8694b"), 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.06, 14), toon("#a4533a"), 0, 0.49, 0));
  g.add(mesh(new THREE.SphereGeometry(0.42, 14, 10), toon("#5fb760"), 0, 0.85, 0));
  g.add(mesh(new THREE.SphereGeometry(0.3, 12, 10), toon("#3f8f45"), 0.22, 1.1, 0.1));
  g.add(mesh(new THREE.SphereGeometry(0.26, 12, 10), toon("#5fb760"), -0.2, 1.15, -0.08));
  g.add(mesh(new THREE.SphereGeometry(0.2, 12, 10), toon("#74c776"), 0.05, 1.35, 0.12));
  g.scale.setScalar(scale);
  return g;
}

function floorLamp(shade: string): { group: THREE.Group; bulbAt: THREE.Vector3 } {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.05, 16), toon("#2b2d42"), 0, 0.025, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.7, 8), toon("#2b2d42"), 0, 0.88, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.38, 18, 1, true), toon(shade), 0, 1.78, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), toon("#fff7d6", { emissive: "#ffe08a" }), 0, 1.7, 0, false));
  return { group: g, bulbAt: new THREE.Vector3(0, 1.7, 0) };
}

function couch(color: string): THREE.Group {
  const g = new THREE.Group();
  const m = toon(color);
  const dark = toon(mix(color, "#000000", 0.2));
  g.add(mesh(roundedBox(1.0, 0.42, 3.6, 0.18), m, 0, 0.3, 0));
  g.add(mesh(roundedBox(0.3, 0.85, 3.6, 0.14), m, -0.45, 0.55, 0));
  for (const s of [-1, 1]) g.add(mesh(roundedBox(1.0, 0.62, 0.3, 0.14), dark, 0, 0.42, s * 1.75));
  // Cojines del asiento.
  for (const s of [-1, 1]) g.add(mesh(roundedBox(0.8, 0.14, 1.55, 0.1), m, 0.05, 0.56, s * 0.8));
  ["#ffd166", "#ef476f"].forEach((c, i) => g.add(mesh(roundedBox(0.2, 0.42, 0.5, 0.1), toon(c), -0.22, 0.82, i ? 0.95 : -0.95)));
  return g;
}

function bookshelf(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon("#a86b44");
  g.add(mesh(box(2.2, 2.1, 0.45), wood, 0, 1.05, 0));
  const inner = toon("#6e4429");
  for (let r = 0; r < 4; r++) g.add(mesh(box(2.0, 0.42, 0.4), inner, 0, 0.3 + r * 0.5, 0.04));
  const colors = ["#e63946", "#457b9d", "#f4a261", "#2a9d8f", "#e9c46a", "#8d99ae", "#b388eb", "#06d6a0"];
  for (let r = 0; r < 4; r++) {
    let x = -0.92;
    let i = r * 3;
    while (x < 0.85) {
      const w = 0.07 + ((i * 37) % 5) * 0.012;
      const h = 0.3 + ((i * 13) % 4) * 0.025;
      if ((i * 7) % 11 === 0) {
        x += 0.15;
        i++;
        continue;
      }
      const b = mesh(box(w, h, 0.28), toon(colors[i % colors.length]), x + w / 2, 0.12 + r * 0.5 + h / 2, 0.1, false);
      if (i % 9 === 4) b.rotation.z = 0.18;
      g.add(b);
      x += w + 0.012;
      i++;
    }
  }
  return g;
}

function coffeeMachine(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.55, 0.65, 0.45, 0.08), toon("#343a40"), 0, 0.33, 0));
  g.add(mesh(box(0.35, 0.05, 0.25), toon("#6c757d"), 0, 0.05, 0.14, false));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.12, 10), toon("#ffffff"), 0, 0.13, 0.12));
  g.add(mesh(new THREE.SphereGeometry(0.04, 8, 8), toon("#ef476f", { emissive: "#ef476f" }), 0.17, 0.52, 0.23, false));
  return g;
}

function fridge(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(1.0, 2.1, 0.9, 0.1), toon("#e9ecef"), 0, 1.05, 0));
  g.add(mesh(roundedBox(0.92, 1.2, 0.05, 0.06), toon("#f8f9fa"), 0, 1.42, 0.45));
  g.add(mesh(roundedBox(0.92, 0.7, 0.05, 0.06), toon("#f1f3f5"), 0, 0.43, 0.45));
  g.add(mesh(roundedBox(0.08, 0.4, 0.08, 0.025), toon("#6c757d"), -0.33, 1.2, 0.5));
  g.add(mesh(roundedBox(0.08, 0.28, 0.08, 0.025), toon("#6c757d"), -0.33, 0.6, 0.5));
  // Imanes.
  ["#ef476f", "#ffd166", "#06d6a0"].forEach((c, i) => g.add(mesh(box(0.08, 0.08, 0.02), toon(c), 0.1 + i * 0.12, 1.6 - i * 0.1, 0.48, false)));
  return g;
}

function waterCooler(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.45, 1.0, 0.45, 0.06), toon("#dee2e6"), 0, 0.5, 0));
  const bottle = new THREE.MeshToonMaterial({ color: "#8ecae6", transparent: true, opacity: 0.7 });
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.5, 16), bottle, 0, 1.28, 0));
  g.add(mesh(box(0.06, 0.06, 0.06), toon("#3a86ff"), -0.08, 0.8, 0.24, false));
  g.add(mesh(box(0.06, 0.06, 0.06), toon("#ef476f"), 0.08, 0.8, 0.24, false));
  return g;
}

function stool(color: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), toon(color), 0, 0.72, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), toon("#8d99ae"), 0, 0.36, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.03, 12), toon("#8d99ae"), 0, 0.02, 0));
  return g;
}

// ── Pantallas con datos reales ──────────────────────────────────────────

function screenCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return { canvas, ctx: canvas.getContext("2d")!, tex };
}

// ── La sala ─────────────────────────────────────────────────────────────

export function buildRoom(layout: OfficeLayout, p: OfficePalette, ownerName: string): Room {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const disposables: { dispose(): void }[] = [];
  const lamps: THREE.PointLight[] = [];

  // Planta: pods al centro, cocina al oeste, lounge al este.
  const minX = Math.min(layout.floor.minX - 8, -19.5);
  const maxX = Math.max(layout.floor.maxX + 8, 19.5);
  const minZ = Math.min(layout.floor.minZ - 1.5, -7);
  const maxZ = Math.max(layout.floor.maxZ + 1.5, 15);
  const W = maxX - minX;
  const D = maxZ - minZ;
  const key = [minX, maxX, minZ, maxZ].map((n) => n.toFixed(1)).join(",");

  const wallColor = p.dark ? mix(p.bg, "#e8dccb", 0.2) : "#f3ede3";
  const wallMat = toon(wallColor);
  const trimMat = toon(p.dark ? mix(p.bg, p.accent, 0.35) : mix(p.accent, "#ffffff", 0.35));
  const frameMat = toon(p.dark ? "#d9d2c5" : "#ffffff");

  // Piso de tablones (adentro) y baldosas en la cocina.
  const woodBase = p.dark ? "#6b4f3a" : "#d9b48f";
  const floorTex = planksTexture(woodBase, p.dark, W, D);
  const floorMat = new THREE.MeshToonMaterial({ map: floorTex, color: "#ffffff" });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0.002, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  group.add(floor);
  disposables.push(floor.geometry, floorMat, floorTex);

  const kitchen = { minX: minX + 0.2, maxX: minX + 7.5, minZ: minZ + 0.2, maxZ: minZ + 11 };
  const kW = kitchen.maxX - kitchen.minX;
  const kD = kitchen.maxZ - kitchen.minZ;
  const tileTex = tilesTexture(p.dark ? "#3c4a55" : "#e9f1f5", p.dark ? "#2e3a44" : "#cfdde6", kW, kD);
  const tileMat = new THREE.MeshToonMaterial({ map: tileTex, color: "#ffffff" });
  const tiles = new THREE.Mesh(new THREE.PlaneGeometry(kW, kD), tileMat);
  tiles.rotation.x = -Math.PI / 2;
  tiles.position.set((kitchen.minX + kitchen.maxX) / 2, 0.004, (kitchen.minZ + kitchen.maxZ) / 2);
  tiles.receiveShadow = true;
  group.add(tiles);
  disposables.push(tiles.geometry, tileMat, tileTex);

  // ── Ventanas: el cielo afuera es un backdrop pintado con la hora real ──
  const sky = screenCanvas(256, 256);
  const skyMat = new THREE.MeshBasicMaterial({ map: sky.tex, toneMapped: false });
  disposables.push(sky.tex, skyMat);
  const paintSky = (d: Daylight) => {
    const g = sky.ctx;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, d.skyTop);
    grad.addColorStop(1, d.skyBottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    // Cerros lejanos y, de noche, ventanas encendidas de la ciudad.
    g.fillStyle = mix(d.skyBottom, d.day > 0.5 ? "#5b8c5a" : "#0a0f1f", 0.55);
    g.beginPath();
    g.moveTo(0, 200);
    for (let x = 0; x <= 256; x += 16) g.lineTo(x, 185 + Math.sin(x * 0.05) * 14 + Math.sin(x * 0.13) * 6);
    g.lineTo(256, 256);
    g.lineTo(0, 256);
    g.fill();
    const building = mix(d.skyBottom, "#1d2433", 0.7);
    for (let i = 0; i < 9; i++) {
      const bw = 18 + ((i * 23) % 14);
      const bh = 40 + ((i * 37) % 60);
      const bx = i * 29 - 4;
      g.fillStyle = building;
      g.fillRect(bx, 256 - bh, bw, bh);
      if (d.day >= 0.5) continue;
      // De noche, algunas ventanas de la ciudad encendidas.
      g.fillStyle = "#ffe08a";
      for (let wy = 256 - bh + 6; wy < 250; wy += 10)
        for (let wx = bx + 3; wx < bx + bw - 3; wx += 6) if ((wx * 7 + wy * 3 + i) % 5 === 0) g.fillRect(wx, wy, 3, 4);
    }
    if (d.day < 0.4) {
      g.fillStyle = "#ffffff";
      for (let i = 0; i < 30; i++) g.fillRect((i * 53) % 256, (i * 29) % 140, 1.5, 1.5);
    }
    sky.tex.needsUpdate = true;
  };
  const glassMat = new THREE.MeshBasicMaterial({ color: "#d6f1ff", transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(glassMat);

  /** Muro a lo largo de un eje con huecos de ventana. `at` es la línea del muro; `inward` el signo hacia adentro. */
  const wall = (axis: "x" | "z", at: number, from: number, to: number, windows: number[], inward: 1 | -1) => {
    const winW = 2.8;
    const y0 = 1.0;
    const y1 = 2.65;
    const piece = (u0: number, u1: number, v0: number, v1: number) => {
      if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
      const m =
        axis === "x"
          ? mesh(box(u1 - u0, v1 - v0, WALL_T), wallMat, (u0 + u1) / 2, (v0 + v1) / 2, at)
          : mesh(box(WALL_T, v1 - v0, u1 - u0), wallMat, at, (v0 + v1) / 2, (u0 + u1) / 2);
      group.add(m);
    };
    let u = from;
    for (const c of [...windows].sort((a, b) => a - b)) {
      const h0 = c - winW / 2;
      const h1 = c + winW / 2;
      piece(u, h0, 0, WALL_H);
      piece(h0, h1, 0, y0);
      piece(h0, h1, y1, WALL_H);
      u = h1;
      // Marco, parteluz, alféizar, vidrio y el cielo detrás.
      const win = new THREE.Group();
      const F = 0.08;
      const Dp = WALL_T + 0.04;
      win.add(mesh(box(winW, F, Dp), frameMat, 0, y1 - F / 2, 0, false));
      win.add(mesh(box(winW, F, Dp), frameMat, 0, y0 + F / 2, 0, false));
      for (const s of [-1, 1]) win.add(mesh(box(F, y1 - y0, Dp), frameMat, s * (winW / 2 - F / 2), (y0 + y1) / 2, 0, false));
      win.add(mesh(box(F * 0.8, y1 - y0 - 2 * F, 0.06), frameMat, 0, (y0 + y1) / 2, 0, false));
      win.add(mesh(box(winW + 0.2, 0.06, 0.22), frameMat, 0, y0 - 0.03, 0.16, false));
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(winW - 2 * F, y1 - y0 - 2 * F), glassMat);
      glass.position.set(0, (y0 + y1) / 2, 0);
      win.add(glass);
      const view = new THREE.Mesh(new THREE.PlaneGeometry(winW + 0.6, y1 - y0 + 0.6), skyMat);
      view.position.set(0, (y0 + y1) / 2, -0.35);
      win.add(view);
      // Construida a lo largo de x con el adentro hacia +z; se gira sobre su muro.
      if (axis === "x") {
        win.position.set(c, 0, at);
        win.rotation.y = inward === 1 ? 0 : Math.PI;
      } else {
        win.position.set(at, 0, c);
        win.rotation.y = inward === 1 ? Math.PI / 2 : -Math.PI / 2;
      }
      group.add(win);
    }
    piece(u, to, 0, WALL_H);
    // Rodapié y colisión.
    const base =
      axis === "x"
        ? mesh(box(to - from, 0.18, WALL_T + 0.04), trimMat, (from + to) / 2, 0.09, at, false)
        : mesh(box(WALL_T + 0.04, 0.18, to - from), trimMat, at, 0.09, (from + to) / 2, false);
    group.add(base);
    colliders.push(
      axis === "x"
        ? { minX: from, maxX: to, minZ: at - WALL_T / 2, maxZ: at + WALL_T / 2, top: 99 }
        : { minX: at - WALL_T / 2, maxX: at + WALL_T / 2, minZ: from, maxZ: to, top: 99 },
    );
  };

  const cx = (minX + maxX) / 2;
  wall("x", minZ, minX - WALL_T / 2, maxX + WALL_T / 2, [cx - 13, cx - 7.5, cx + 7.5, cx + 13], 1);
  wall("z", minX, minZ, maxZ, [minZ + 13, minZ + 19].filter((z) => z < maxZ - 2), 1);
  wall("z", maxX, minZ, maxZ, [minZ + 3.5, minZ + 18].filter((z) => z < maxZ - 2), -1);

  // Frente abierto: muro bajo con vidrio arriba y la entrada al centro.
  const partitionGlass = new THREE.MeshBasicMaterial({ color: "#d6f1ff", transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(partitionGlass);
  for (const [a, b] of [
    [minX - WALL_T / 2, cx - DOOR_HALF],
    [cx + DOOR_HALF, maxX + WALL_T / 2],
  ]) {
    group.add(mesh(box(b - a, PARTITION_H, WALL_T), wallMat, (a + b) / 2, PARTITION_H / 2, maxZ));
    group.add(mesh(box(b - a, 0.06, WALL_T + 0.06), frameMat, (a + b) / 2, PARTITION_H + 0.03, maxZ, false));
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.5), partitionGlass);
    gl.position.set((a + b) / 2, PARTITION_H + 0.3, maxZ);
    group.add(gl);
    colliders.push({ minX: a, maxX: b, minZ: maxZ - WALL_T / 2, maxZ: maxZ + WALL_T / 2, top: PARTITION_H + 0.5 });
  }
  // Tapete de bienvenida.
  group.add(mesh(roundedBox(2.6, 0.02, 1.4, 0.3), toon(p.accent), cx, 0.012, maxZ - 1.1, false));

  // ── Pared del fondo: letrero con el nombre del dueño y reloj real ──────
  const sign = screenCanvas(1024, 256);
  {
    const g = sign.ctx;
    g.fillStyle = "#3b2a20";
    g.beginPath();
    g.roundRect(8, 8, 1008, 240, 36);
    g.fill();
    g.strokeStyle = "#c98b5a";
    g.lineWidth = 10;
    g.stroke();
    g.fillStyle = "#fff7e6";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 88px ${p.font}`;
    g.fillText(ownerName ? `Oficina de ${ownerName}` : "Oficina de agentes", 512, 110);
    g.font = `500 40px ${p.font}`;
    g.fillStyle = p.accent;
    g.fillText("Hermes OS · agentes trabajando", 512, 190);
    sign.tex.needsUpdate = true;
  }
  const signMat = new THREE.MeshBasicMaterial({ map: sign.tex, toneMapped: false, transparent: true });
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), signMat);
  signMesh.position.set(cx, 2.55, minZ + WALL_T / 2 + 0.02);
  group.add(signMesh);
  disposables.push(sign.tex, signMat, signMesh.geometry);

  const clock = screenCanvas(256, 256);
  const clockMat = new THREE.MeshBasicMaterial({ map: clock.tex, toneMapped: false, transparent: true });
  const clockMesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), clockMat);
  clockMesh.position.set(cx + 4.2, 2.55, minZ + WALL_T / 2 + 0.03);
  group.add(clockMesh);
  group.add(mesh(new THREE.TorusGeometry(0.43, 0.04, 8, 40), toon("#2b2d42"), clockMesh.position.x, 2.55, minZ + WALL_T / 2 + 0.05, false));
  disposables.push(clock.tex, clockMat, clockMesh.geometry);
  let clockSecond = -1;
  const paintClock = (now: Date) => {
    const s = now.getSeconds();
    if (s === clockSecond) return;
    clockSecond = s;
    const g = clock.ctx;
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = "#fffaf0";
    g.beginPath();
    g.arc(128, 128, 124, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b2d42";
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = i % 3 === 0 ? 96 : 104;
      g.save();
      g.translate(128 + Math.sin(a) * r0, 128 - Math.cos(a) * r0);
      g.rotate(a);
      g.fillRect(-3, 0, 6, i % 3 === 0 ? 18 : 10);
      g.restore();
    }
    const hand = (a: number, len: number, w: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.sin(a) * len, 128 - Math.cos(a) * len);
      g.stroke();
    };
    const h = (now.getHours() % 12) + now.getMinutes() / 60;
    hand((h / 12) * Math.PI * 2, 58, 10, "#2b2d42");
    hand(((now.getMinutes() + s / 60) / 60) * Math.PI * 2, 88, 7, "#2b2d42");
    hand((s / 60) * Math.PI * 2, 96, 3, p.accent);
    g.fillStyle = p.accent;
    g.beginPath();
    g.arc(128, 128, 8, 0, Math.PI * 2);
    g.fill();
    clock.tex.needsUpdate = true;
  };

  // Pizarra blanca con marco de aluminio: los conteos reales del momento.
  const board = screenCanvas(768, 512);
  const boardMat = new THREE.MeshBasicMaterial({ map: board.tex, toneMapped: false });
  const boardMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), boardMat);
  boardMesh.position.set(cx - 4.6, 1.95, minZ + WALL_T / 2 + 0.04);
  group.add(boardMesh);
  group.add(mesh(box(2.52, 1.72, 0.04), toon("#adb5bd"), cx - 4.6, 1.95, minZ + WALL_T / 2 + 0.01, false));
  group.add(mesh(box(2.3, 0.05, 0.12), toon("#adb5bd"), cx - 4.6, 1.12, minZ + WALL_T / 2 + 0.07, false));
  ["#ef476f", "#3a86ff", "#06d6a0"].forEach((c, i) => group.add(mesh(box(0.14, 0.03, 0.03), toon(c), cx - 5.3 + i * 0.22, 1.16, minZ + WALL_T / 2 + 0.09, false)));
  disposables.push(board.tex, boardMat, boardMesh.geometry);
  let boardKey = "";
  const paintBoard = (stats: BoardStat[]) => {
    const key = stats.map((s) => `${s.label}:${s.value}`).join("|");
    if (key === boardKey) return;
    boardKey = key;
    const g = board.ctx;
    g.fillStyle = "#fbfbf8";
    g.fillRect(0, 0, 768, 512);
    g.fillStyle = "#2b2d42";
    g.font = `700 50px ${p.font}`;
    g.textBaseline = "middle";
    g.fillText("Ahora mismo", 40, 60);
    g.strokeStyle = "#2b2d42";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(40, 98);
    g.lineTo(330, 92);
    g.stroke();
    stats.forEach((s, i) => {
      const y = 160 + i * 66;
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(58, y, 14, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2b2d42";
      g.font = `500 40px ${p.font}`;
      g.fillText(s.label, 90, y);
      g.font = `700 46px ${p.font}`;
      g.textAlign = "right";
      g.fillText(String(s.value), 720, y);
      g.textAlign = "left";
    });
    board.tex.needsUpdate = true;
  };
  paintBoard([]);

  // ── Cocina (oeste) ─────────────────────────────────────────────────────
  const kx = minX + WALL_T / 2 + 0.55;
  const counter = new THREE.Group();
  counter.add(mesh(box(1.0, 0.92, 5), toon(p.dark ? "#3d5a80" : "#8ecae6"), 0, 0.46, 0));
  counter.add(mesh(box(1.1, 0.08, 5.1), toon(p.dark ? "#d9d2c5" : "#f7f3ea"), 0, 0.96, 0));
  const machine = coffeeMachine();
  machine.position.set(0, 1.0, -1.5);
  machine.rotation.y = Math.PI / 2;
  counter.add(machine);
  // Tazas y un frutero.
  ["#ef476f", "#ffd166", "#06d6a0"].forEach((c, i) => counter.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon(c), 0.1, 1.06, -0.6 + i * 0.18)));
  counter.add(mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.1, 14), toon("#c98b5a"), 0.05, 1.05, 1.2));
  ["#e63946", "#ffb703", "#8ac926"].forEach((c, i) => counter.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), toon(c), -0.05 + i * 0.07, 1.14, 1.15 + (i % 2) * 0.08)));
  counter.position.set(kx, 0, minZ + 3.2);
  group.add(counter);
  colliders.push({ minX: kx - 0.55, maxX: kx + 0.55, minZ: minZ + 0.7, maxZ: minZ + 5.7, top: 1.0 });
  const fr = fridge();
  fr.position.set(kx - 0.05, 0, minZ + 6.5);
  fr.rotation.y = Math.PI / 2;
  group.add(fr);
  colliders.push({ minX: kx - 0.5, maxX: kx + 0.45, minZ: minZ + 6, maxZ: minZ + 7, top: 2.1 });
  const cooler = waterCooler();
  cooler.position.set(kx - 0.1, 0, minZ + 8.2);
  group.add(cooler);
  colliders.push({ minX: kx - 0.35, maxX: kx + 0.15, minZ: minZ + 7.95, maxZ: minZ + 8.45, top: 1.5 });
  const tableAt = new THREE.Vector3(kitchen.minX + 4.4, 0, minZ + 4.5);
  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.07, 26), toon("#c98b5a"), 0, 0.78, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.75, 10), toon("#2b2d42"), 0, 0.39, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.04, 16), toon("#2b2d42"), 0, 0.02, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon("#ffffff"), 0.2, 0.87, 0.1));
  table.position.copy(tableAt);
  group.add(table);
  colliders.push({ minX: tableAt.x - 0.6, maxX: tableAt.x + 0.6, minZ: tableAt.z - 0.6, maxZ: tableAt.z + 0.6, top: 0.82 });
  [0, 1, 2].forEach((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    const s = stool(p.skins[i % p.skins.length]);
    s.position.set(tableAt.x + Math.cos(a) * 1.05, 0, tableAt.z + Math.sin(a) * 1.05);
    group.add(s);
  });

  // ── Lounge (este): TV con el feed real, sofá, mesa de centro, pufs ─────
  const lz = minZ + 11;
  const tvX = maxX - WALL_T / 2 - 0.08;
  const tv = screenCanvas(1024, 576);
  const tvMat = new THREE.MeshBasicMaterial({ map: tv.tex, toneMapped: false });
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(3.3, 0.12, 1.95, 0.1), toon("#1d1d1d"), 0, 0, 0));
  tvGroup.children[0].rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.75), tvMat);
  tvScreen.position.z = 0.07;
  tvGroup.add(tvScreen);
  tvGroup.position.set(tvX, 1.75, lz);
  tvGroup.rotation.y = -Math.PI / 2;
  group.add(tvGroup);
  disposables.push(tv.tex, tvMat, tvScreen.geometry);
  // Mueble bajo la TV.
  group.add(mesh(box(0.5, 0.5, 2.6), toon(p.dark ? "#4a3a30" : "#a86b44"), tvX - 0.3, 0.25, lz));
  colliders.push({ minX: tvX - 0.55, maxX: tvX, minZ: lz - 1.3, maxZ: lz + 1.3, top: 0.5 });

  let feed: FeedLine[] = [];
  const paintTv = () => {
    const g = tv.ctx;
    g.fillStyle = "#15161f";
    g.fillRect(0, 0, 1024, 576);
    g.fillStyle = "#1f2130";
    g.fillRect(0, 0, 1024, 76);
    g.fillStyle = "#ffffff";
    g.font = `700 38px ${p.font}`;
    g.textBaseline = "middle";
    g.fillText("Actividad en vivo", 36, 40);
    g.fillStyle = "#6ccb8f";
    g.beginPath();
    g.arc(990, 40, 10, 0, Math.PI * 2);
    g.fill();
    g.font = `500 28px ${p.mono}`;
    if (!feed.length) {
      g.fillStyle = "#7f849c";
      g.fillText("Sin actividad todavía", 36, 130);
    }
    const tone: Record<FeedLine["tone"], string> = { tool: p.accent, done: "#a6e3a1", error: "#f38ba8", start: "#89b4fa", text: "#cdd6f4" };
    feed.slice(-11).forEach((l, i) => {
      const y = 116 + i * 42;
      g.fillStyle = "#7f849c";
      g.fillText(l.time, 36, y);
      g.fillStyle = tone[l.tone];
      g.fillText(l.kind, 150, y);
      g.fillStyle = "#cdd6f4";
      let text = l.text;
      while (text.length > 3 && g.measureText(text).width > 1024 - 360) text = text.slice(0, -2);
      if (text !== l.text) text = `${text.slice(0, -1)}…`;
      g.fillText(text, 330, y);
    });
    tv.tex.needsUpdate = true;
  };
  paintTv();

  const rugAt = new THREE.Vector3(maxX - 4.4, 0, lz);
  group.add(mesh(roundedBox(6, 0.02, 5.6, 0.8), toon(p.dark ? mix(p.accent, p.bg, 0.55) : mix(p.accent, "#ffffff", 0.6)), rugAt.x, 0.012, rugAt.z, false));
  const sofa = couch(p.dark ? "#3d5a80" : "#5b8def");
  sofa.position.set(maxX - 6.6, 0, lz);
  group.add(sofa);
  colliders.push({ minX: maxX - 7.2, maxX: maxX - 6.1, minZ: lz - 1.9, maxZ: lz + 1.9, top: 0.55 });
  const ctable = new THREE.Group();
  ctable.add(mesh(roundedBox(1.0, 0.07, 1.6, 0.1), toon("#c98b5a"), 0, 0.42, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctable.add(mesh(box(0.06, 0.4, 0.06), toon("#2b2d42"), sx * 0.4, 0.2, sz * 0.7));
  ctable.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon("#ef476f"), 0.2, 0.52, -0.3));
  ctable.add(mesh(box(0.3, 0.04, 0.22), toon("#457b9d"), -0.1, 0.48, 0.3));
  ctable.position.set(maxX - 4.8, 0, lz);
  group.add(ctable);
  colliders.push({ minX: maxX - 5.3, maxX: maxX - 4.3, minZ: lz - 0.8, maxZ: lz + 0.8, top: 0.46 });
  [
    ["#06d6a0", maxX - 3.6, lz + 2.1],
    ["#ffd166", maxX - 3.6, lz - 2.1],
  ].forEach(([c, x, z]) => {
    const bean = mesh(new THREE.SphereGeometry(0.55, 18, 12), toon(c as string), x as number, 0.32, z as number);
    bean.scale.y = 0.6;
    group.add(bean);
    colliders.push({ minX: (x as number) - 0.45, maxX: (x as number) + 0.45, minZ: (z as number) - 0.45, maxZ: (z as number) + 0.45, top: 0.55 });
  });
  const shelf = bookshelf();
  shelf.position.set(maxX - 3.5, 0, minZ + WALL_T / 2 + 0.25);
  group.add(shelf);
  colliders.push({ minX: maxX - 4.6, maxX: maxX - 2.4, minZ: minZ, maxZ: minZ + 0.6, top: 2.1 });

  // ── Plantas y lámparas ─────────────────────────────────────────────────
  const plants: [number, number, number][] = [
    [minX + 0.8, maxZ - 0.9, 1.1],
    [maxX - 0.8, maxZ - 0.9, 1.1],
    [maxX - 0.8, minZ + 0.9, 1.0],
    [cx - 10.2, minZ + 0.8, 0.9],
    [cx + 6.3, minZ + 0.8, 0.9],
    [cx - DOOR_HALF - 0.7, maxZ - 0.7, 0.8],
    [cx + DOOR_HALF + 0.7, maxZ - 0.7, 0.8],
    [kitchen.maxX + 0.6, minZ + 0.9, 1.0],
  ];
  for (const [x, z, s] of plants) {
    const pl = plant(s);
    pl.position.set(x, 0, z);
    group.add(pl);
    const r = 0.3 * s;
    colliders.push({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s });
  }

  const lampSpots: [number, number, string][] = [
    [maxX - 7.4, lz + 2.4, "#ffd6a5"],
    [kitchen.maxX + 0.6, minZ + 8, "#ffe8b3"],
  ];
  for (const [x, z, shade] of lampSpots) {
    const l = floorLamp(shade);
    l.group.position.set(x, 0, z);
    group.add(l.group);
    colliders.push({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, top: 1.9 });
    const light = new THREE.PointLight("#ffc98a", 1, 9, 1.6);
    light.position.set(x, 1.75, z);
    group.add(light);
    lamps.push(light);
  }
  const kitchenLight = new THREE.PointLight("#ffd9a0", 1, 8, 1.6);
  kitchenLight.position.set(tableAt.x, 2.2, tableAt.z);
  group.add(kitchenLight);
  lamps.push(kitchenLight);

  let lastSky = "";
  return {
    group,
    colliders,
    bounds: { minX, maxX, minZ, maxZ },
    spawn: { x: cx, z: maxZ - 2.2, facing: Math.PI },
    lamps,
    key,
    setBoard: paintBoard,
    setFeed(lines) {
      const same = lines.length === feed.length && lines.every((l, i) => l.text === feed[i].text && l.time === feed[i].time);
      if (same) return;
      feed = lines.slice();
      paintTv();
    },
    tick(now) {
      paintClock(now);
      const d = daylightAt(now);
      const skyKey = `${d.skyTop}|${d.skyBottom}`;
      if (skyKey !== lastSky) {
        lastSky = skyKey;
        paintSky(d);
      }
      return d;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const d of disposables) d.dispose();
    },
  };
}
