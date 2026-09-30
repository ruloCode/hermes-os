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
  /** Animación ambiental de la sala (vapor de la cafetera), cada frame. */
  animate(t: number): void;
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

/** Cafetera espresso de dos grupos (el frente mira a +z). `steamAt` = sobre cada taza. */
function espressoMachine(): { group: THREE.Group; steamAt: THREE.Vector3[] } {
  const g = new THREE.Group();
  const steel = toon("#c9ced6");
  const dark = toon("#2b2d42");
  const black = toon("#1d1d1d");
  g.add(mesh(box(0.84, 0.08, 0.56), dark, 0, 0.04, 0));
  g.add(mesh(roundedBox(0.8, 0.55, 0.5, 0.06), steel, 0, 0.36, 0));
  g.add(mesh(box(0.84, 0.05, 0.54), dark, 0, 0.66, 0));
  // Barandita del calienta-tazas y dos tazas boca abajo.
  g.add(mesh(box(0.78, 0.04, 0.02), steel, 0, 0.72, 0.25, false));
  for (const x of [-0.12, 0.08]) g.add(mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.07, 10), toon("#fffaf0"), x, 0.72, -0.05, false));
  // Panel frontal con manómetro y luces de encendido.
  g.add(mesh(box(0.72, 0.18, 0.02), dark, 0, 0.52, 0.255, false));
  const gauge = mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 18), toon("#fffaf0"), 0, 0.52, 0.27, false);
  gauge.rotation.x = Math.PI / 2;
  g.add(gauge);
  g.add(mesh(box(0.006, 0.04, 0.005), toon("#e63946"), 0.012, 0.535, 0.282, false));
  g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), toon("#06d6a0", { emissive: "#06d6a0" }), -0.28, 0.52, 0.27, false));
  g.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), toon("#ffd166", { emissive: "#ffd166" }), 0.28, 0.52, 0.27, false));
  // Bandeja de goteo.
  g.add(mesh(box(0.7, 0.03, 0.2), black, 0, 0.095, 0.33, false));
  const steamAt: THREE.Vector3[] = [];
  for (const s of [-1, 1]) {
    const x = s * 0.18;
    g.add(mesh(new THREE.CylinderGeometry(0.065, 0.06, 0.07, 14), steel, x, 0.33, 0.29, false));
    g.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.04, 12), black, x, 0.28, 0.3, false));
    g.add(mesh(box(0.035, 0.03, 0.2), black, x, 0.28, 0.42, false));
    g.add(mesh(new THREE.CylinderGeometry(0.042, 0.034, 0.07, 12), toon("#fffaf0"), x, 0.145, 0.32, false));
    g.add(mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 12), toon("#5a3a22"), x, 0.179, 0.32, false));
    steamAt.push(new THREE.Vector3(x, 0.2, 0.32));
  }
  // Lanceta de vapor.
  const wand = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), steel, 0.36, 0.25, 0.3, false);
  wand.rotation.z = -0.25;
  g.add(wand);
  return { group: g, steamAt };
}

/** Molino de café con tolva de granos. */
function grinder(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(0.26, 0.3, 0.3, 0.04), toon("#2b2d42"), 0, 0.15, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 14), toon("#c9ced6"), 0, 0.34, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.14, 0.07, 0.24, 14), toon("#e9d8c4", { opacity: 0.55 }), 0, 0.5, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.11, 0.07, 0.14, 14), toon("#5a3a22"), 0, 0.45, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.03, 14), toon("#2b2d42"), 0, 0.63, 0, false));
  return g;
}

function vendingMachine(body: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(roundedBox(1.0, 1.95, 0.8, 0.06), toon(body), 0, 0.975, 0));
  const glass = new THREE.MeshToonMaterial({ color: "#a9d6ff", transparent: true, opacity: 0.28 });
  g.add(mesh(box(0.64, 1.22, 0.02), toon("#1d2433"), -0.12, 1.2, 0.395, false));
  const snacks = ["#ef476f", "#ffd166", "#06d6a0", "#3a86ff", "#f4a261", "#b388eb"];
  for (let r = 0; r < 4; r++) {
    g.add(mesh(box(0.6, 0.015, 0.06), toon("#adb5bd"), -0.12, 0.7 + r * 0.29, 0.39, false));
    for (let c = 0; c < 4; c++) {
      const h = 0.15 + ((r + c) % 3) * 0.02;
      g.add(mesh(box(0.11, h, 0.06), toon(snacks[(r * 4 + c * 3) % snacks.length]), -0.35 + c * 0.155, 0.71 + r * 0.29 + h / 2, 0.39, false));
    }
  }
  g.add(mesh(box(0.64, 1.22, 0.01), glass, -0.12, 1.2, 0.415, false));
  // Teclado, ranura de monedas y la bandeja de salida.
  g.add(mesh(box(0.2, 0.55, 0.02), toon("#2b2d42"), 0.33, 1.3, 0.405, false));
  for (let i = 0; i < 9; i++) g.add(mesh(box(0.035, 0.035, 0.015), toon("#e9ecef"), 0.28 + (i % 3) * 0.05, 1.45 - Math.floor(i / 3) * 0.06, 0.42, false));
  g.add(mesh(box(0.08, 0.02, 0.015), toon("#adb5bd"), 0.33, 1.16, 0.42, false));
  g.add(mesh(box(0.64, 0.2, 0.03), toon("#1d1d1d"), -0.12, 0.35, 0.405, false));
  g.add(mesh(box(0.9, 0.12, 0.02), toon("#fff7e6", { emissive: "#fff1d6" }), 0, 1.84, 0.405, false));
  return g;
}

/** Mesa de ping-pong a lo largo de x, con red, raquetas y pelota. */
function pingPongTable(): THREE.Group {
  const g = new THREE.Group();
  const L = 2.5;
  const W = 1.4;
  const H = 0.76;
  const white = toon("#ffffff");
  const dark = toon("#2b2d42");
  g.add(mesh(box(L, 0.05, W), toon("#1f5f8b"), 0, H, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(box(L, 0.006, 0.03), white, 0, H + 0.028, s * (W / 2 - 0.015), false));
    g.add(mesh(box(0.03, 0.006, W), white, s * (L / 2 - 0.015), H + 0.028, 0, false));
  }
  g.add(mesh(box(L, 0.006, 0.012), white, 0, H + 0.028, 0, false));
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) g.add(mesh(box(0.06, H - 0.03, 0.06), dark, sx * (L / 2 - 0.25), (H - 0.03) / 2, sz * (W / 2 - 0.15)));
    g.add(mesh(box(0.05, 0.05, W - 0.3), dark, sx * (L / 2 - 0.25), 0.2, 0, false));
  }
  // Red con sus postes.
  for (const s of [-1, 1]) g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.19, 8), dark, 0, H + 0.095, s * (W / 2 + 0.03), false));
  g.add(mesh(box(0.012, 0.14, W + 0.06), toon("#f1f3f5", { opacity: 0.7 }), 0, H + 0.1, 0, false));
  g.add(mesh(box(0.018, 0.02, W + 0.06), white, 0, H + 0.175, 0, false));
  const paddle = (color: string, x: number, z: number, rot: number) => {
    const p = new THREE.Group();
    p.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.014, 16), toon(color), 0, 0, 0, false));
    p.add(mesh(box(0.1, 0.02, 0.03), toon("#c98b5a"), 0.12, 0, 0, false));
    p.position.set(x, H + 0.033, z);
    p.rotation.y = rot;
    g.add(p);
  };
  paddle("#e63946", 0.72, 0.32, 0.6);
  paddle("#2b2d42", -0.8, -0.28, 2.6);
  g.add(mesh(new THREE.SphereGeometry(0.022, 10, 8), toon("#ff9f1c"), 0.34, H + 0.047, -0.18, false));
  return g;
}

/** Futbolín a lo largo de x: rojo contra azul, las manijas de cada equipo a un lado. */
function foosball(): THREE.Group {
  const g = new THREE.Group();
  const L = 1.3;
  const W = 0.8;
  const H = 0.84;
  const wood = toon("#8b5e3c");
  g.add(mesh(box(L, 0.04, W), wood, 0, H - 0.2, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(box(L, 0.18, 0.05), wood, 0, H - 0.09, s * (W / 2 - 0.025)));
    g.add(mesh(box(0.05, 0.18, W), wood, s * (L / 2 - 0.025), H - 0.09, 0));
    g.add(mesh(box(0.03, 0.08, 0.24), toon("#1d1d1d"), s * (L / 2 - 0.05), H - 0.12, 0, false));
    for (const sz of [-1, 1]) g.add(mesh(box(0.07, H - 0.2, 0.07), wood, s * (L / 2 - 0.08), (H - 0.2) / 2, sz * (W / 2 - 0.08)));
  }
  g.add(mesh(box(L - 0.1, 0.02, W - 0.1), toon("#2d9a4b"), 0, H - 0.17, 0, false));
  g.add(mesh(box(0.012, 0.004, W - 0.1), toon("#ffffff"), 0, H - 0.158, 0, false));
  const ring = mesh(new THREE.TorusGeometry(0.1, 0.006, 6, 24), toon("#ffffff"), 0, H - 0.158, 0, false);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  // Varillas: portero, defensa, ataque rival, medio, medio rival, ataque, defensa rival, portero rival.
  const team = [0, 0, 1, 0, 1, 0, 1, 1];
  const count = [1, 2, 3, 5, 5, 3, 2, 1];
  const rodMat = toon("#c9ced6");
  const colors = [toon("#e63946"), toon("#3a86ff")];
  team.forEach((t, i) => {
    const x = -0.525 + i * 0.15;
    const rod = mesh(new THREE.CylinderGeometry(0.01, 0.01, W + 0.5, 8), rodMat, x, H - 0.05, 0, false);
    rod.rotation.x = Math.PI / 2;
    g.add(rod);
    const side = t === 0 ? 1 : -1;
    const handle = mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10), toon("#1d1d1d"), x, H - 0.05, side * (W / 2 + 0.3), false);
    handle.rotation.x = Math.PI / 2;
    g.add(handle);
    const n = count[i];
    for (let k = 0; k < n; k++) {
      const z = n === 1 ? 0 : -0.28 + (k * 0.56) / (n - 1);
      g.add(mesh(box(0.04, 0.1, 0.03), colors[t], x, H - 0.1, z, false));
      g.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), toon("#f1c27d"), x, H - 0.035, z, false));
    }
  });
  g.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), toon("#ffffff"), 0.05, H - 0.14, 0.1, false));
  return g;
}

/** Máquina arcade (el frente mira a +z). La pantalla es una ilustración, sin puntajes. */
function arcadeCabinet(screen: THREE.Texture, trim: string): THREE.Group {
  const g = new THREE.Group();
  const body = toon("#2b2d42");
  const stripe = toon(trim);
  g.add(mesh(box(0.8, 1.0, 0.7), body, 0, 0.5, 0));
  g.add(mesh(box(0.8, 0.78, 0.5), body, 0, 1.39, -0.1));
  for (const s of [-1, 1]) g.add(mesh(box(0.02, 1.7, 0.4), stripe, s * 0.41, 0.95, 0.05, false));
  const panel = mesh(box(0.8, 0.06, 0.3), toon("#3d405b"), 0, 1.03, 0.28);
  panel.rotation.x = 0.28;
  g.add(panel);
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8), toon("#1d1d1d"), -0.2, 1.1, 0.28, false));
  g.add(mesh(new THREE.SphereGeometry(0.035, 10, 8), toon("#e63946"), -0.2, 1.16, 0.28, false));
  ["#ffd166", "#06d6a0", "#3a86ff"].forEach((c, i) => g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 12), toon(c), 0.02 + i * 0.1, 1.09, 0.27 - i * 0.01, false)));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), new THREE.MeshBasicMaterial({ map: screen, toneMapped: false }));
  scr.position.set(0, 1.42, 0.155);
  scr.rotation.x = -0.12;
  g.add(scr);
  g.add(mesh(box(0.8, 0.2, 0.12), toon(trim, { emissive: trim }), 0, 1.86, 0.12, false));
  g.add(mesh(box(0.3, 0.12, 0.02), toon("#1d1d1d"), 0, 0.55, 0.355, false));
  return g;
}

function coatRack(jacket: string): THREE.Group {
  const g = new THREE.Group();
  const dark = toon("#2b2d42");
  g.add(mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.05, 16), dark, 0, 0.025, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.8, 8), dark, 0, 0.92, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const hook = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.22, 6), dark, Math.cos(a) * 0.08, 1.72, Math.sin(a) * 0.08, false);
    hook.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
    g.add(hook);
  }
  const coat = mesh(roundedBox(0.36, 0.7, 0.16, 0.07), toon(jacket), 0.14, 1.32, 0);
  g.add(coat);
  g.add(mesh(new THREE.SphereGeometry(0.11, 12, 8), toon("#ffd166"), -0.12, 1.72, 0.02, false));
  return g;
}

function artCanvas(colors: string[], seed: number) {
  const c = screenCanvas(256, 320);
  const g = c.ctx;
  g.fillStyle = "#f7f1e5";
  g.fillRect(0, 0, 256, 320);
  for (let i = 0; i < 7; i++) {
    const k = (seed * 31 + i * 17) % 97;
    g.fillStyle = colors[(i + seed) % colors.length];
    g.globalAlpha = 0.85;
    if (i % 2) {
      g.beginPath();
      g.arc(40 + ((k * 7) % 180), 50 + ((k * 13) % 220), 24 + (k % 50), 0, Math.PI * 2);
      g.fill();
    } else g.fillRect((k * 5) % 170, (k * 11) % 250, 50 + (k % 70), 18 + (k % 40));
  }
  g.globalAlpha = 1;
  c.tex.needsUpdate = true;
  return c.tex;
}

function dartboardCanvas() {
  const c = screenCanvas(256, 256);
  const g = c.ctx;
  const ring = (r0: number, r1: number, a: string, b: string) => {
    for (let i = 0; i < 20; i++) {
      const a0 = ((i - 0.5) / 20) * Math.PI * 2;
      const a1 = ((i + 0.5) / 20) * Math.PI * 2;
      g.fillStyle = i % 2 ? a : b;
      g.beginPath();
      g.arc(128, 128, r1, a0, a1);
      g.arc(128, 128, r0, a1, a0, true);
      g.fill();
    }
  };
  g.fillStyle = "#1d1d1d";
  g.beginPath();
  g.arc(128, 128, 127, 0, Math.PI * 2);
  g.fill();
  ring(20, 104, "#1d1d1d", "#f3e3c3");
  ring(98, 106, "#2d9a4b", "#e63946");
  ring(58, 65, "#2d9a4b", "#e63946");
  g.fillStyle = "#2d9a4b";
  g.beginPath();
  g.arc(128, 128, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#e63946";
  g.beginPath();
  g.arc(128, 128, 6, 0, Math.PI * 2);
  g.fill();
  c.tex.needsUpdate = true;
  return c.tex;
}

/** Pantalla de la arcade en modo demostración: marcianitos y una nave, sin números. */
function arcadeCanvas(colors: string[]) {
  const c = screenCanvas(256, 200);
  const g = c.ctx;
  g.fillStyle = "#0b1020";
  g.fillRect(0, 0, 256, 200);
  const invader = ["00100000100", "00010001000", "00111111100", "01101110110", "11111111111", "10111111101", "10100000101", "00011011000"];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 5; col++) {
      g.fillStyle = colors[(row + col) % colors.length];
      invader.forEach((line, y) => [...line].forEach((px, x) => px === "1" && g.fillRect(24 + col * 44 + x * 3, 20 + row * 36 + y * 3, 3, 3)));
    }
  g.fillStyle = "#6ccb8f";
  g.fillRect(118, 170, 20, 8);
  g.fillRect(125, 163, 6, 8);
  g.fillStyle = "#ffffff";
  for (let i = 0; i < 18; i++) g.fillRect((i * 67) % 256, (i * 41) % 200, 1.5, 1.5);
  c.tex.needsUpdate = true;
  return c.tex;
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
  // Puertas y manijas del mueble bajo.
  for (let i = 0; i < 4; i++) {
    counter.add(mesh(box(0.02, 0.72, 1.12), toon(p.dark ? "#4a6d94" : "#a9d6ec"), 0.51, 0.48, -1.8 + i * 1.2, false));
    counter.add(mesh(box(0.03, 0.03, 0.22), toon("#6c757d"), 0.53, 0.76, -1.8 + i * 1.2, false));
  }
  // Salpicadero de baldosa y gabinetes altos contra el muro.
  counter.add(mesh(box(0.02, 0.72, 5), toon(p.dark ? "#51606c" : "#dfe9ee"), -0.52, 1.36, 0, false));
  counter.add(mesh(box(0.36, 0.7, 4.8), toon(p.dark ? "#3d5a80" : "#8ecae6"), -0.36, 2.2, 0));
  for (let i = 0; i < 4; i++) {
    counter.add(mesh(box(0.02, 0.62, 1.12), toon(p.dark ? "#4a6d94" : "#a9d6ec"), -0.17, 2.2, -1.8 + i * 1.2, false));
    counter.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), toon("#6c757d"), -0.15, 1.98, -1.8 + i * 1.2 + (i % 2 ? -0.42 : 0.42), false));
  }
  const espresso = espressoMachine();
  const machine = espresso.group;
  machine.position.set(0, 1.0, -1.5);
  machine.rotation.y = Math.PI / 2;
  counter.add(machine);
  const mill = grinder();
  mill.position.set(-0.05, 1.0, -2.25);
  counter.add(mill);
  // Tazas del día, fregadero con grifo, frutero y microondas.
  ["#ef476f", "#ffd166", "#06d6a0"].forEach((c, i) => counter.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon(c), 0.1, 1.06, -0.75 + i * 0.18)));
  counter.add(mesh(box(0.56, 0.02, 0.72), toon("#adb5bd"), 0.02, 1.005, 0.45, false));
  counter.add(mesh(box(0.46, 0.02, 0.6), toon("#6c757d"), 0.02, 1.012, 0.45, false));
  counter.add(mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.32, 8), toon("#c9ced6"), -0.36, 1.16, 0.45, false));
  counter.add(mesh(box(0.22, 0.035, 0.035), toon("#c9ced6"), -0.26, 1.31, 0.45, false));
  counter.add(mesh(box(0.1, 0.02, 0.03), toon("#c9ced6"), -0.36, 1.12, 0.6, false));
  counter.add(mesh(new THREE.CylinderGeometry(0.22, 0.14, 0.1, 14), toon("#c98b5a"), 0.05, 1.05, 1.25));
  ["#e63946", "#ffb703", "#8ac926"].forEach((c, i) => counter.add(mesh(new THREE.SphereGeometry(0.08, 10, 8), toon(c), -0.05 + i * 0.07, 1.14, 1.2 + (i % 2) * 0.08)));
  counter.add(mesh(roundedBox(0.46, 0.32, 0.62, 0.04), toon("#dee2e6"), -0.1, 1.16, 2.05));
  counter.add(mesh(box(0.02, 0.22, 0.38), toon("#1d2433"), 0.135, 1.16, 1.98, false));
  counter.add(mesh(box(0.02, 0.22, 0.12), toon("#343a40"), 0.135, 1.16, 2.27, false));
  counter.position.set(kx, 0, minZ + 3.2);
  group.add(counter);
  // Vapor de las dos tazas de la cafetera (sprites: sin sombra ni contorno).
  counter.updateMatrixWorld(true);
  const steam: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; base: THREE.Vector3; phase: number }[] = [];
  const steamTex = (() => {
    const c = screenCanvas(64, 64);
    const grad = c.ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    c.ctx.fillStyle = grad;
    c.ctx.fillRect(0, 0, 64, 64);
    c.tex.needsUpdate = true;
    return c.tex;
  })();
  disposables.push(steamTex);
  espresso.steamAt.forEach((at, i) => {
    const base = machine.localToWorld(at.clone());
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(base);
      group.add(sprite);
      disposables.push(mat);
      steam.push({ sprite, mat, base, phase: k / 3 + i * 0.17 });
    }
  });
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

  // Máquina de snacks al final de la cocina, de frente al piso.
  const vend = vendingMachine(p.dark ? mix(p.accent, "#000000", 0.25) : p.accent);
  vend.position.set(minX + WALL_T / 2 + 0.42, 0, minZ + 9.9);
  vend.rotation.y = Math.PI / 2;
  group.add(vend);
  colliders.push({ minX, maxX: minX + 0.9, minZ: minZ + 9.4, maxZ: minZ + 10.4, top: 1.95 });

  // ── Zona de juegos (suroeste): ping-pong, canasta de pelotas y diana ────
  const gameAt = new THREE.Vector3(minX + 4.1, 0, minZ + 16.3);
  group.add(mesh(roundedBox(6.2, 0.02, 6.2, 0.5), toon(p.dark ? mix(p.bg, "#2a9d8f", 0.35) : mix("#2a9d8f", "#ffffff", 0.6)), gameAt.x, 0.012, gameAt.z, false));
  const pong = pingPongTable();
  pong.position.copy(gameAt);
  group.add(pong);
  colliders.push({ minX: gameAt.x - 1.25, maxX: gameAt.x + 1.25, minZ: gameAt.z - 0.72, maxZ: gameAt.z + 0.72, top: 0.8 });
  const basket = new THREE.Group();
  basket.add(mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), toon("#8d99ae"), 0, 0.17, 0));
  basket.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 14), toon("#8d99ae"), 0, 0.01, 0, false));
  for (let i = 0; i < 7; i++) basket.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), toon(i % 3 ? "#ffffff" : "#ff9f1c"), Math.cos(i * 2.3) * 0.1, 0.33 + (i % 2) * 0.04, Math.sin(i * 2.3) * 0.1, false));
  basket.position.set(gameAt.x - 2.6, 0, gameAt.z - 2.1);
  group.add(basket);
  colliders.push({ minX: basket.position.x - 0.2, maxX: basket.position.x + 0.2, minZ: basket.position.z - 0.2, maxZ: basket.position.z + 0.2, top: 0.36 });
  const dartTex = dartboardCanvas();
  const dartMat = new THREE.MeshBasicMaterial({ map: dartTex });
  disposables.push(dartTex, dartMat);
  const dart = new THREE.Group();
  dart.add(mesh(box(0.02, 0.9, 0.9), toon("#b08968"), 0, 0, 0, false));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.3, 40), dartMat);
  face.position.x = 0.02;
  face.rotation.y = Math.PI / 2;
  dart.add(face);
  const rim = mesh(new THREE.TorusGeometry(0.31, 0.025, 8, 40), toon("#2b2d42"), 0.02, 0, 0, false);
  rim.rotation.y = Math.PI / 2;
  dart.add(rim);
  for (const [y, z] of [
    [0.05, -0.04],
    [-0.12, 0.09],
  ]) {
    const d = mesh(new THREE.CylinderGeometry(0.008, 0.004, 0.14, 6), toon("#c9ced6"), 0.09, y, z, false);
    d.rotation.z = Math.PI / 2;
    dart.add(d);
    dart.add(mesh(box(0.04, 0.05, 0.004), toon("#e63946"), 0.17, y, z, false));
  }
  dart.position.set(minX + WALL_T / 2 + 0.01, 1.75, gameAt.z);
  group.add(dart);

  // ── Esquina sureste: futbolín y máquina arcade ─────────────────────────
  const foosAt = new THREE.Vector3(maxX - 4, 0, minZ + 17.2);
  const foos = foosball();
  foos.position.copy(foosAt);
  group.add(foos);
  colliders.push({ minX: foosAt.x - 0.65, maxX: foosAt.x + 0.65, minZ: foosAt.z - 0.42, maxZ: foosAt.z + 0.42, top: 0.84 });
  const arcadeTex = arcadeCanvas(p.skins);
  disposables.push(arcadeTex);
  const arcade = arcadeCabinet(arcadeTex, p.accent);
  arcade.position.set(maxX - WALL_T / 2 - 0.42, 0, minZ + 15.2);
  arcade.rotation.y = -Math.PI / 2;
  group.add(arcade);
  arcade.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.MeshBasicMaterial) disposables.push(m);
  });
  colliders.push({ minX: maxX - 0.9, maxX, minZ: minZ + 14.8, maxZ: minZ + 15.6, top: 1.95 });

  // ── Detalles: cuadros en la pared del fondo y perchero en la entrada ────
  for (const [x, seed] of [
    [cx - 10.25, 3],
    [cx + 10.25, 8],
  ]) {
    const tex = artCanvas(p.skins, seed);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    disposables.push(tex, mat);
    group.add(mesh(box(1.3, 1.6, 0.05), toon("#5a3a22"), x, 2.2, minZ + WALL_T / 2 + 0.025, false));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 1.44), mat);
    art.position.set(x, 2.2, minZ + WALL_T / 2 + 0.055);
    group.add(art);
  }
  const rackAt = { x: cx - DOOR_HALF - 1.9, z: maxZ - 0.8 };
  const rack = coatRack(p.accent);
  rack.position.set(rackAt.x, 0, rackAt.z);
  group.add(rack);
  colliders.push({ minX: rackAt.x - 0.25, maxX: rackAt.x + 0.25, minZ: rackAt.z - 0.25, maxZ: rackAt.z + 0.25, top: 1.8 });

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
    animate(t) {
      for (const s of steam) {
        const k = (t * 0.45 + s.phase) % 1;
        s.sprite.position.set(s.base.x + Math.sin(t * 1.7 + s.phase * 9) * 0.03 * k, s.base.y + k * 0.45, s.base.z);
        s.sprite.scale.setScalar(0.07 + k * 0.16);
        s.mat.opacity = Math.sin(k * Math.PI) * 0.55;
      }
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
