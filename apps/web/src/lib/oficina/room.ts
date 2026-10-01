// La sala de la Oficina de agentes: el lugar alrededor de los pods, con look de
// coworking tipo loft (ladrillo a la vista, concreto pulido, ventanas
// industriales, lámparas colgantes, neón). Frente abierto (muro bajo de vidrio
// con la entrada, para que la cámara siempre vea adentro), cocina con isla y
// barra de café, lounge con TV, cabina telefónica, plantas y luz cálida real.
//
// Todo lo que muestra datos es REAL: la TV pinta el feed de actividad del
// agente, el reloj marca la hora local, el cielo de las ventanas sigue esa hora
// y el letrero lleva el nombre del dueño (NEXT_PUBLIC_HERMES_OWNER_NAME).
//
// Muebles recreados a partir de agent-office (AgentSystemLabs, MIT —
// src/client/world/office.ts: piso de tablones, ventanas, sofá, cocina,
// plantas, lámparas), con otra planta y colores del tema.

import * as THREE from "three";
import type { AmbientPoi, GameId, OfficeBoardId, OfficeLayout, OfficeNpcRole } from "@hermes/shared";
import { mesh, roundedBox, toon, toonUnique } from "./toon";
import type { OfficePalette } from "./palette";
import type { Collider } from "./player";

export const WALL_H = 3.4;
/** Grosor de la losa entre pisos. */
const SLAB = 0.2;
/** Altura del suelo de cada piso: 1 equipos · 2 café y lounge · 3 azotea. */
export const FLOOR_Y = [0, WALL_H + SLAB, 2 * (WALL_H + SLAB)] as const;
export const FLOOR_NAMES = ["Equipos", "Café", "Azotea"] as const;
/** El piso de una altura (a mitad de escalera ya cuenta el de llegada, para verlo al subir). */
export function floorAt(y: number): number {
  return y < FLOOR_Y[1] - 1.2 ? 0 : y < FLOOR_Y[2] - 1.2 ? 1 : 2;
}
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

/** Dónde está un NPC con rol: su lugar fijo, hacia dónde mira y desde dónde se le habla. */
export interface NpcSpot {
  floor: number;
  x: number;
  z: number;
  facing: number;
  /** Punto desde donde "E" lo alcanza (la barista se atiende del otro lado de la isla). */
  talk: { x: number; z: number };
}

/** Dónde cuelga un tablero de pared (piso 1): centro, normal hacia adentro y desde dónde se usa. */
export interface BoardSpot {
  x: number;
  y: number;
  z: number;
  /** Rotación Y del plano (0 = mira a +z). */
  rotY: number;
  w: number;
  h: number;
  /** Punto frente al tablero desde donde "E" lo alcanza. */
  front: { x: number; z: number };
}

/**
 * Dónde se juega cada minijuego de la azotea (coordenadas del mundo): dónde se
 * para el dueño, el centro de la cosa (mesa, diana, cesta, pantalla) y las
 * piezas decorativas que se esconden mientras se juega (las raquetas de
 * adorno, las varillas quietas del futbolín…).
 */
export interface GameSpot {
  id: GameId;
  floor: number;
  stand: { x: number; z: number; facing: number };
  /** Centro de la cosa en el mundo (mesa: su cubierta; diana: su cara; cesta: el aro; arcade: la pantalla). */
  anchor: { x: number; y: number; z: number };
  hide: THREE.Object3D[];
}

/** La pantalla de la arcade: un canvas que pinta el juego (o su espera, con el récord real). */
export interface ArcadeScreen {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
}

export interface Room {
  group: THREE.Group;
  colliders: Collider[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  spawn: { x: number; z: number; facing: number };
  lamps: THREE.PointLight[];
  /** Piso de cada lámpara (mismo orden que `lamps`): solo se encienden las del piso que se ve. */
  lampFloor: number[];
  floors: THREE.Group[];
  /** Pie de cada escalera (para el QA y "ir a la escalera"): dónde pararse y hacia dónde mirar para subir. */
  stairs: { x: number; z: number; y: number; facing: number }[];
  /** Muestra los pisos hasta `upTo` (los de encima se ocultan, como un corte de casa de muñecas). */
  showFloors(upTo: number): void;
  /** Clave de tamaño: si cambia, la sala se reconstruye. */
  key: string;
  /**
   * Lugares con intención para la gente de ambiente (office-ambient.ts): café,
   * sofá, ventanas, juegos. Solo datos: no agregan nada a la escena.
   */
  pois: AmbientPoi[];
  /** El lugar de cada NPC con rol (recepción, barista, azotea). */
  npcSpots: Record<OfficeNpcRole, NpcSpot>;
  /** Por donde entra al edificio quien llega (la puerta del frente, piso 1). */
  door: { x: number; z: number };
  /** Tableros de pared del piso 1 (issues, PRs, servicios): los pinta `boards.ts` con datos reales. */
  boardSpots: Record<OfficeBoardId, BoardSpot>;
  /** La pizarra libre (piso 1, muro oeste): se dibuja desde el navegador. */
  whiteboardSpot: BoardSpot;
  /** El tablero de la cola de agentes (piso 1, muro oeste, junto a la pizarra). */
  queueSpot: BoardSpot;
  /** Sala de control (piso 1, fondo noreste): la pared con la terminal de todos los agentes vivos. */
  controlSpot: BoardSpot;
  /** Tablero de gasto de tokens (piso 1, junto a la sala de control). */
  spendSpot: BoardSpot;
  /** La TV del lounge (piso 2): centro de la pantalla y desde dónde se usa. */
  tv: { floor: number; x: number; y: number; z: number; front: { x: number; z: number } };
  /** Minijuegos de la azotea: dónde se juega cada uno. */
  gameSpots: Record<GameId, GameSpot>;
  arcadeScreen: ArcadeScreen;
  /** Pone un video en la TV (pantalla compartida) o, con null, vuelve al feed de actividad. */
  setTvVideo(video: HTMLVideoElement | null): void;
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

// ── Estilo loft (coworking): ladrillo, concreto, neón, tiza ─────────────

/** Ladrillo a la vista: un paño de 1,6 × 1,2 m que se repite según el tamaño de cada tramo de muro. */
const BRICK_TILE = { w: 1.6, h: 1.2 };

function brickCanvas(dark: boolean): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const mortar = dark ? "#3a2c26" : "#d9c7b4";
  const bricks = dark ? ["#6e3b2c", "#7a4232", "#5e3326", "#83503c", "#6a3a2e"] : ["#b5563a", "#c0644a", "#a44c33", "#c9745a", "#b0583f"];
  g.fillStyle = mortar;
  g.fillRect(0, 0, 512, 512);
  const rows = 8;
  const rh = 512 / rows;
  const bw = 128;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let i = -1; i < 5; i++) {
      const x = i * bw + off;
      g.fillStyle = bricks[(r * 3 + i * 7 + 20) % bricks.length];
      g.fillRect(x + 4, r * rh + 4, bw - 8, rh - 8);
      // Un poco de textura en cada ladrillo.
      g.fillStyle = "rgba(0,0,0,0.07)";
      g.fillRect(x + 4, r * rh + rh - 14, bw - 8, 10);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + 8, r * rh + 8, bw - 30, 6);
    }
  }
  return c;
}

/** Material de ladrillo para un tramo de `u` × `v` metros (el paño no se estira). */
function brickMaterial(canvas: HTMLCanvasElement, u: number, v: number, disposables: { dispose(): void }[]): THREE.MeshToonMaterial {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(Math.max(0.2, u / BRICK_TILE.w), Math.max(0.2, v / BRICK_TILE.h));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  const m = toonUnique("#ffffff");
  m.map = t;
  disposables.push(t, m);
  return m;
}

/** Concreto pulido: gris cálido con manchas suaves y juntas de dilatación. */
function concreteTexture(dark: boolean, w: number, d: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;
  const base = dark ? "#4a4541" : "#aea397";
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = (i * 97) % 512;
    const y = (i * 181) % 512;
    const r = 18 + ((i * 13) % 50);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const light = i % 2 === 0;
    grad.addColorStop(0, light ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.06)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  g.strokeStyle = dark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, 510, 510);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 4, d / 4);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Letrero de neón: el texto con halo, sobre fondo transparente. */
function neonCanvas(text: string, color: string, font: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 1024;
  c.height = 320;
  const g = c.getContext("2d")!;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = `italic 700 190px ${font}`;
  for (const [blur, alpha] of [
    [60, 0.55],
    [28, 0.8],
    [10, 1],
  ] as const) {
    g.shadowColor = color;
    g.shadowBlur = blur;
    g.globalAlpha = alpha;
    g.strokeStyle = color;
    g.lineWidth = 14;
    g.strokeText(text, 512, 170);
  }
  g.globalAlpha = 1;
  g.shadowBlur = 0;
  g.lineWidth = 5;
  g.strokeStyle = "#fff4f7";
  g.strokeText(text, 512, 170);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pizarra de tiza del café. Sin precios: en la oficina un número siempre es un dato real. */
function chalkboardCanvas(font: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 700;
  const g = c.getContext("2d")!;
  g.fillStyle = "#23282a";
  g.fillRect(0, 0, 512, 700);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = "rgba(255,255,255,0.025)";
    g.fillRect((i * 71) % 512, (i * 113) % 700, 90, 30);
  }
  g.fillStyle = "#f4f1ea";
  g.textAlign = "center";
  g.font = `700 64px ${font}`;
  g.fillText("Café & más", 256, 90);
  g.strokeStyle = "#f4f1ea";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(120, 118);
  g.lineTo(392, 114);
  g.stroke();
  g.textAlign = "left";
  g.font = `500 40px ${font}`;
  ["Espresso", "Americano", "Latte", "Cold brew", "Kombucha", "Agua de frutas"].forEach((item, i) => g.fillText(item, 70, 200 + i * 64));
  g.textAlign = "center";
  g.font = `italic 500 34px ${font}`;
  g.fillStyle = "#ffcf8a";
  g.fillText("buenas ideas, buen café", 256, 640);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Afiche tipográfico en la pared. */
function posterCanvas(lines: string[], bg: string, ink: string, font: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 640;
  const g = c.getContext("2d")!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 480, 640);
  g.fillStyle = ink;
  g.font = `800 92px ${font}`;
  lines.forEach((l, i) => g.fillText(l, 40, 150 + i * 100));
  g.font = `800 50px ${font}`;
  g.fillText("♡", 40, 590);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lámpara industrial colgante: campana negra, bombilla cálida y el cable hasta arriba. */
function pendantLamp(drop = 0.9): THREE.Group {
  const g = new THREE.Group();
  const black = toon("#1f2024");
  g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, drop, 5), black, 0, -drop / 2, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), black, 0, -drop - 0.02, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.1, 0.34, 0.3, 20, 1, true), black, 0, -drop - 0.2, 0, false));
  g.add(mesh(new THREE.SphereGeometry(0.09, 12, 10), toon("#fff3d0", { emissive: "#ffcf7a" }), 0, -drop - 0.3, 0, false));
  return g;
}

/** Maceta colgante con hojas que caen en cascada (pothos). */
function hangingPlant(drop = 0.7): THREE.Group {
  const g = new THREE.Group();
  const rope = toon("#c8b18e");
  for (const a of [0, 2.1, 4.2]) {
    const r = mesh(new THREE.CylinderGeometry(0.006, 0.006, drop, 4), rope, Math.cos(a) * 0.08, -drop / 2, Math.sin(a) * 0.08, false);
    g.add(r);
  }
  const potY = -drop - 0.1;
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.24, 14), toon("#e8dfd2"), 0, potY, 0, false));
  const leaf = [toon("#4f9d55"), toon("#5fb760"), toon("#74c776")];
  // Copa redonda sobre la maceta y cuatro ramas que cuelgan por los lados.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), leaf[i % 3], Math.cos(a) * 0.12, potY + 0.16, Math.sin(a) * 0.12, false));
  }
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    const n = 3 + (k % 2);
    for (let i = 0; i < n; i++) {
      const out = 0.2 + i * 0.03;
      g.add(mesh(new THREE.SphereGeometry(0.075 - i * 0.008, 8, 6), leaf[(k + i) % 3], Math.cos(a) * out, potY - 0.02 - i * 0.12, Math.sin(a) * out, false));
    }
  }
  return g;
}

/** Banqueta alta de bar: asiento de madera, patas negras y reposapiés. */
function barStool(): THREE.Group {
  const g = new THREE.Group();
  const black = toon("#1f2024");
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), toon("#a86b44"), 0, 0.78, 0));
  for (const [x, z] of [
    [0.13, 0.13],
    [-0.13, 0.13],
    [0.13, -0.13],
    [-0.13, -0.13],
  ]) {
    const leg = mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.78, 6), black, x * 0.9, 0.39, z * 0.9, false);
    leg.rotation.z = -x * 0.25;
    leg.rotation.x = z * 0.25;
    g.add(leg);
  }
  g.add(mesh(new THREE.TorusGeometry(0.16, 0.012, 5, 16), black, 0, 0.3, 0, false));
  g.children[g.children.length - 1].rotation.x = Math.PI / 2;
  return g;
}

/** Dispensador de agua con fruta: frasco de vidrio, agua de color y rodajas. */
function fruitJar(water: string, fruit: string): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14), toon("#8a5a3b"), 0, 0.02, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.34, 16), toon(water, { opacity: 0.55 }), 0, 0.22, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.38, 16, 1, true), toon("#e8f6ff", { opacity: 0.25 }), 0, 0.23, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 12), toon("#c9ced6"), 0, 0.44, 0, false));
  for (let i = 0; i < 4; i++) {
    const slice = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 10), toon(fruit), Math.cos(i * 1.7) * 0.05, 0.12 + i * 0.07, Math.sin(i * 1.7) * 0.05, false);
    slice.rotation.x = 0.6 + i * 0.4;
    g.add(slice);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 6), toon("#c9ced6"), 0, 0.08, 0.13, false));
  return g;
}

/** Torre de grifos (kombucha, cerveza): barra cromada con manijas de colores. */
function tapTower(handles: string[]): THREE.Group {
  const g = new THREE.Group();
  const chrome = toon("#c9ced6");
  const n = handles.length;
  g.add(mesh(box(0.08 + n * 0.16, 0.05, 0.16), chrome, 0, 0.025, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8), chrome, 0, 0.26, 0));
  g.add(mesh(box(0.08 + n * 0.16, 0.08, 0.1), chrome, 0, 0.5, 0));
  handles.forEach((c, i) => {
    const x = (i - (n - 1) / 2) * 0.16;
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6), chrome, x, 0.44, 0.07, false));
    g.add(mesh(roundedBox(0.045, 0.2, 0.045, 0.015), toon(c), x, 0.56, 0.02, false));
  });
  return g;
}

/** Cabina telefónica de vidrio con marco negro, banquito, repisa y su luz (frente hacia +z). */
function phoneBooth(glass: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const black = toon("#1f2024");
  const W = 1.15;
  const H = 2.25;
  for (const [x, z] of [
    [-W / 2, -W / 2],
    [W / 2, -W / 2],
    [-W / 2, W / 2],
    [W / 2, W / 2],
  ])
    g.add(mesh(box(0.06, H, 0.06), black, x, H / 2, z));
  g.add(mesh(box(W + 0.08, 0.14, W + 0.08), black, 0, H + 0.07, 0));
  g.add(mesh(box(W + 0.08, 0.06, W + 0.08), toon("#2b2d42"), 0, 0.03, 0));
  // Vidrio en los cuatro lados; la puerta (frente) con su jalador.
  for (const [x, z, ry] of [
    [0, W / 2, 0],
    [0, -W / 2, 0],
    [W / 2, 0, Math.PI / 2],
    [-W / 2, 0, Math.PI / 2],
  ] as const) {
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.06, H - 0.1), glass);
    pane.position.set(x, H / 2 + 0.02, z);
    pane.rotation.y = ry;
    g.add(pane);
  }
  g.add(mesh(box(0.03, 0.5, 0.03), toon("#c9ced6"), W / 2 - 0.15, 1.1, W / 2 + 0.03, false));
  g.add(mesh(box(0.7, 0.04, 0.32), toon("#a86b44"), 0, 1.05, -W / 2 + 0.2));
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14), toon("#a86b44"), 0, 0.62, 0.05));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), black, 0, 0.3, 0.05, false));
  g.add(mesh(box(0.5, 0.03, 0.5), toon("#fff3d0", { emissive: "#ffcf7a" }), 0, H - 0.02, 0, false));
  return g;
}

/** Sillón individual (el del lounge). */
function armchair(color: string): THREE.Group {
  const g = new THREE.Group();
  const m = toon(color);
  const dark = toon(mix(color, "#000000", 0.2));
  g.add(mesh(roundedBox(1.0, 0.42, 1.0, 0.16), m, 0, 0.3, 0));
  g.add(mesh(roundedBox(0.28, 0.8, 1.0, 0.12), m, -0.42, 0.55, 0));
  for (const s of [-1, 1]) g.add(mesh(roundedBox(0.9, 0.55, 0.22, 0.1), dark, 0.02, 0.45, s * 0.5));
  g.add(mesh(roundedBox(0.75, 0.13, 0.72, 0.08), m, 0.05, 0.56, 0));
  return g;
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
    p.userData.gamePiece = true;
    g.add(p);
  };
  paddle("#e63946", 0.72, 0.32, 0.6);
  paddle("#2b2d42", -0.8, -0.28, 2.6);
  const ball = mesh(new THREE.SphereGeometry(0.022, 10, 8), toon("#ff9f1c"), 0.34, H + 0.047, -0.18, false);
  ball.userData.gamePiece = true;
  g.add(ball);
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
  // Lo que se mueve al jugar (varillas, manijas, muñecos, pelota) va marcado: el juego lo esconde y pone el suyo.
  const piece = (m: THREE.Object3D) => {
    m.userData.gamePiece = true;
    g.add(m);
    return m;
  };
  team.forEach((t, i) => {
    const x = -0.525 + i * 0.15;
    const rod = piece(mesh(new THREE.CylinderGeometry(0.01, 0.01, W + 0.5, 8), rodMat, x, H - 0.05, 0, false));
    rod.rotation.x = Math.PI / 2;
    const side = t === 0 ? 1 : -1;
    const handle = piece(mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.13, 10), toon("#1d1d1d"), x, H - 0.05, side * (W / 2 + 0.3), false));
    handle.rotation.x = Math.PI / 2;
    const n = count[i];
    for (let k = 0; k < n; k++) {
      const z = n === 1 ? 0 : -0.28 + (k * 0.56) / (n - 1);
      piece(mesh(box(0.04, 0.1, 0.03), colors[t], x, H - 0.1, z, false));
      piece(mesh(new THREE.SphereGeometry(0.02, 8, 6), toon("#f1c27d"), x, H - 0.035, z, false));
    }
  });
  piece(mesh(new THREE.SphereGeometry(0.018, 10, 8), toon("#ffffff"), 0.05, H - 0.14, 0.1, false));
  return g;
}

/** Máquina arcade (el frente mira a +z). La pantalla es un canvas: el juego o su espera con el récord real. */
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

/**
 * La pantalla de la arcade: un canvas de 512×400 que pinta "Lluvia de tokens"
 * (games/arcade.ts) o su espera con el récord real de este navegador. Antes era
 * una ilustración fija; ahora es un juego propio y el número es de una partida.
 */
function arcadeScreen(): ArcadeScreen {
  const c = screenCanvas(512, 400);
  return { canvas: c.ctx.canvas, ctx: c.ctx, tex: c.tex };
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

// ── Pisos: losas con hueco, escaleras, barandas y azotea ───────────────

/** Tablones de la terraza de la azotea. */
function deckTexture(dark: boolean, w: number, d: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  const base = dark ? "#6b4f3a" : "#b98b62";
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = mix(base, i % 2 ? "#000000" : "#ffffff", 0.06);
    g.fillRect(0, i * 32 + 2, 256, 28);
    g.fillStyle = mix(base, "#000000", 0.35);
    g.fillRect(0, i * 32, 256, 2);
    g.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(w / 2, d / 2);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Rincón de la azotea con sombrilla y dos sillas de playa (noreste). */
function rooftopNook(maxX: number, minZ: number) {
  return { x: maxX - 6, z: minZ + 4 };
}

interface FloorsCtx {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  cx: number;
  p: OfficePalette;
  brick: HTMLCanvasElement;
  disposables: { dispose(): void }[];
  floors: THREE.Group[];
  col: (level: number, c: Collider) => void;
  light: (level: number, l: THREE.PointLight) => void;
}

/**
 * Las losas de los pisos 2 y 3 (con el hueco de su escalera), las dos
 * escaleras en zigzag contra el muro oeste, sus barandas, el balcón del
 * frente del piso 2 y la azotea (antepecho, terraza, luces colgantes).
 * Devuelve el pie de cada escalera en coordenadas del mundo.
 */
function buildFloorsAndStairs(ctx: FloorsCtx): { x: number; z: number; y: number; facing: number }[] {
  const { minX, maxX, minZ, maxZ, cx, p, brick, disposables, floors, col, light } = ctx;
  const N = 18;
  const rise = FLOOR_Y[1] / N;
  const run = 5.4;
  const tread = run / N;
  // Escalera 1 (piso 1 → 2) sube hacia el fondo desde el frente; la 2 (2 → 3), al lado, vuelve hacia el frente.
  const zHigh = maxZ - 1.5;
  const zLow = zHigh - run;
  const s1 = { x0: minX + WALL_T / 2, x1: minX + 1.9 };
  const s2 = { x0: minX + 2.0, x1: minX + 3.6 };
  const hole1 = { minX, maxX: minX + 1.95, minZ: zLow, maxZ: zHigh };
  const hole2 = { minX: minX + 1.95, maxX: minX + 3.65, minZ: zLow, maxZ: zHigh };

  const black = toon("#1f2024");
  const treadMat = toon(p.dark ? "#8a5a3b" : "#b07a52");
  const riserMat = toon(p.dark ? "#3a3532" : "#5a524c");

  // Losa con hueco: cuatro rectángulos alrededor del hueco, cada uno con su textura a escala.
  const slab = (level: number, hole: { minX: number; maxX: number; minZ: number; maxZ: number }, tex: (w: number, d: number) => THREE.CanvasTexture) => {
    const g = floors[level];
    const rects = [
      [minX, maxX, minZ, hole.minZ],
      [minX, maxX, hole.maxZ, maxZ],
      [minX, hole.minX, hole.minZ, hole.maxZ],
      [hole.maxX, maxX, hole.minZ, hole.maxZ],
    ];
    for (const [x0, x1, z0, z1] of rects) {
      const w = x1 - x0;
      const d = z1 - z0;
      if (w < 0.05 || d < 0.05) continue;
      const t = tex(w, d);
      const m = new THREE.MeshToonMaterial({ map: t, color: "#ffffff" });
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set((x0 + x1) / 2, 0.002, (z0 + z1) / 2);
      plane.receiveShadow = true;
      g.add(plane);
      // Canto de la losa (se ve desde afuera y por el hueco).
      g.add(mesh(box(w, SLAB, d), riserMat, (x0 + x1) / 2, -SLAB / 2 - 0.004, (z0 + z1) / 2, false));
      disposables.push(t, m);
      col(level, { minX: x0, maxX: x1, minZ: z0, maxZ: z1, bottom: -SLAB, top: 0 });
    }
  };
  slab(1, hole1, (w, d) => concreteTexture(p.dark, w, d));
  slab(2, hole2, (w, d) => deckTexture(p.dark, w, d));

  // Escalera maciza: cada escalón es una caja de su altura (el personaje los sube solo).
  const stair = (level: number, x0: number, x1: number, zStart: number, dir: 1 | -1) => {
    const g = floors[level];
    for (let i = 0; i < N; i++) {
      const h = (i + 1) * rise;
      const za = zStart + dir * i * tread;
      const zb = zStart + dir * (i + 1) * tread;
      const z0 = Math.min(za, zb);
      const z1 = Math.max(za, zb);
      g.add(mesh(box(x1 - x0, h, tread), riserMat, (x0 + x1) / 2, h / 2, (z0 + z1) / 2));
      g.add(mesh(box(x1 - x0 + 0.02, 0.04, tread + 0.02), treadMat, (x0 + x1) / 2, h - 0.02, (z0 + z1) / 2, false));
      col(level, { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: h });
    }
  };
  stair(0, s1.x0, s1.x1, zHigh, -1);
  stair(1, s2.x0, s2.x1, zLow, 1);

  // Baranda: postes, pasamanos (inclinado si sube) y su colisión, que hace de guarda.
  const rail = (level: number, axis: "x" | "z", at: number, from: number, to: number, hFrom: number, hTo: number, guardTop: number) => {
    const g = floors[level];
    const H = 1.0;
    const len = Math.abs(to - from);
    const posts = Math.max(2, Math.round(len / 1.2) + 1);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const u = from + (to - from) * t;
      const base = hFrom + (hTo - hFrom) * t;
      const post = mesh(new THREE.CylinderGeometry(0.025, 0.025, H, 6), black, 0, base + H / 2, 0, false);
      if (axis === "x") post.position.set(u, base + H / 2, at);
      else post.position.set(at, base + H / 2, u);
      g.add(post);
    }
    const a = axis === "x" ? new THREE.Vector3(from, hFrom + H, at) : new THREE.Vector3(at, hFrom + H, from);
    const b = axis === "x" ? new THREE.Vector3(to, hTo + H, at) : new THREE.Vector3(at, hTo + H, to);
    const bar = mesh(new THREE.CylinderGeometry(0.035, 0.035, a.distanceTo(b), 8), black, 0, 0, 0, false);
    bar.position.copy(a).lerp(b, 0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(bar);
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    col(level, axis === "x" ? { minX: lo, maxX: hi, minZ: at - 0.05, maxZ: at + 0.05, top: guardTop } : { minX: at - 0.05, maxX: at + 0.05, minZ: lo, maxZ: hi, top: guardTop });
  };
  // Escalera 1: baranda del lado abierto (el otro es el muro).
  rail(0, "z", s1.x1 + 0.03, zHigh, zLow, 0, FLOOR_Y[1], FLOOR_Y[1] + 1.1);
  // Piso 2: guarda al borde sur del hueco 1 y las dos barandas de la escalera 2.
  rail(1, "x", zHigh - 0.03, minX + WALL_T / 2, hole1.maxX, 0, 0, 1.1);
  rail(1, "z", s2.x0 - 0.03, zLow, zHigh, 0, FLOOR_Y[1], FLOOR_Y[1] + 1.1);
  rail(1, "z", s2.x1 + 0.03, zLow, zHigh, 0, FLOOR_Y[1], FLOOR_Y[1] + 1.1);
  // Azotea: el hueco 2 se rodea salvo por el sur, que es donde se llega.
  rail(2, "x", zLow + 0.03, hole2.minX, hole2.maxX, 0, 0, 1.1);
  rail(2, "z", hole2.minX + 0.03, zLow, zHigh, 0, 0, 1.1);
  rail(2, "z", hole2.maxX - 0.03, zLow, zHigh, 0, 0, 1.1);

  // Piso 2: balcón de vidrio al frente (sin puerta: la entrada es abajo).
  {
    const g = floors[1];
    const glass = new THREE.MeshBasicMaterial({ color: "#d6f1ff", transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
    disposables.push(glass);
    const w = maxX - minX;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.0), glass);
    pane.position.set(cx, 0.55, maxZ);
    g.add(pane);
    g.add(mesh(box(w, 0.06, 0.1), black, cx, 1.08, maxZ, false));
    g.add(mesh(box(w, 0.08, 0.14), black, cx, 0.04, maxZ, false));
    col(1, { minX, maxX, minZ: maxZ - 0.1, maxZ: maxZ + 0.1, top: 1.2 });
    // El centro del café, sobre los pods: un tapete grande, pufs y matas.
    g.add(mesh(roundedBox(8, 0.02, 5, 0.6), toon(p.dark ? mix(p.bg, "#2a9d8f", 0.3) : mix("#2a9d8f", "#ffffff", 0.65)), cx, 0.012, (minZ + maxZ) / 2, false));
    [
      ["#e76f51", cx - 1.6, (minZ + maxZ) / 2],
      ["#e9c46a", cx + 1.6, (minZ + maxZ) / 2 + 0.8],
    ].forEach(([c, x, z]) => {
      const bean = mesh(new THREE.SphereGeometry(0.55, 18, 12), toon(c as string), x as number, 0.32, z as number);
      bean.scale.y = 0.6;
      g.add(bean);
      col(1, { minX: (x as number) - 0.45, maxX: (x as number) + 0.45, minZ: (z as number) - 0.45, maxZ: (z as number) + 0.45, top: 0.55 });
    });
  }

  // Azotea: antepecho de ladrillo en los cuatro lados, terraza, luces colgantes y un rincón para sentarse.
  {
    const g = floors[2];
    const H = 1.0;
    const T = 0.3;
    const edges: [number, number, number, number][] = [
      [minX, maxX, minZ, minZ + T],
      [minX, maxX, maxZ - T, maxZ],
      [minX, minX + T, minZ, maxZ],
      [maxX - T, maxX, minZ, maxZ],
    ];
    for (const [x0, x1, z0, z1] of edges) {
      const w = x1 - x0;
      const d = z1 - z0;
      const m = brickMaterial(brick, Math.max(w, d), H, disposables);
      g.add(mesh(box(w, H, d), m, (x0 + x1) / 2, H / 2, (z0 + z1) / 2));
      g.add(mesh(box(w + 0.04, 0.06, d + 0.04), black, (x0 + x1) / 2, H + 0.03, (z0 + z1) / 2, false));
      col(2, { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: H + 0.2 });
    }
    // Guirnaldas de bombillos entre postes negros.
    const bulb = toon("#fff3d0", { emissive: "#ffcf7a" });
    const lineZs = [minZ + 5, minZ + 11, minZ + 17].filter((z) => z < maxZ - 1);
    const xA = minX + 6;
    const xB = maxX - 3;
    for (const z of lineZs) {
      for (const x of [xA, xB]) {
        g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), black, x, 1.6, z));
        col(2, { minX: x - 0.08, maxX: x + 0.08, minZ: z - 0.08, maxZ: z + 0.08, top: 3.2 });
      }
      const n = Math.round((xB - xA) / 1.1);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const y = 3.1 - Math.sin(t * Math.PI) * 0.7;
        g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), bulb, xA + (xB - xA) * t, y - 0.1, z, false));
      }
    }
    for (const [x, z] of [
      [cx - 6, minZ + 11],
      [cx + 6, minZ + 11],
    ]) {
      const l = new THREE.PointLight("#ffcf8a", 1, 14, 1.4);
      l.position.set(x, 2.6, z);
      light(2, l);
    }
    // Rincón con sombrilla y dos sillas de playa (noreste).
    const nook = rooftopNook(maxX, minZ);
    g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8), black, nook.x, 1.2, nook.z));
    const shade = mesh(new THREE.ConeGeometry(1.6, 0.6, 16, 1, true), toon(p.accent), nook.x, 2.4, nook.z, false);
    g.add(shade);
    col(2, { minX: nook.x - 0.1, maxX: nook.x + 0.1, minZ: nook.z - 0.1, maxZ: nook.z + 0.1, top: 2.6 });
    for (const dx of [-1.1, 1.1]) {
      const chair = new THREE.Group();
      chair.add(mesh(box(0.6, 0.08, 1.4), toon("#e9c46a"), 0, 0.35, 0));
      const back = mesh(box(0.6, 0.08, 0.7), toon("#e9c46a"), 0, 0.6, -0.6);
      back.rotation.x = 0.9;
      chair.add(back);
      for (const sx of [-0.25, 0.25]) for (const sz of [-0.55, 0.55]) chair.add(mesh(box(0.04, 0.35, 0.04), toon("#8a5a3b"), sx, 0.17, sz, false));
      chair.position.set(nook.x + dx, 0, nook.z + 0.4);
      g.add(chair);
      col(2, { minX: nook.x + dx - 0.32, maxX: nook.x + dx + 0.32, minZ: nook.z - 0.35, maxZ: nook.z + 1.15, top: 0.4 });
    }
    // Materas en las esquinas.
    for (const [x, z] of [
      [minX + 5, minZ + 1.2],
      [cx, minZ + 1.2],
      [maxX - 1.2, maxZ - 1.2],
      [cx + 3, maxZ - 1.2],
    ]) {
      g.add(mesh(box(1.2, 0.5, 0.6), toon("#8a5a3b"), x, 0.25, z));
      for (const dx of [-0.35, 0, 0.35]) g.add(mesh(new THREE.SphereGeometry(0.28, 10, 8), toon(dx === 0 ? "#4f9d55" : "#5fb760"), x + dx, 0.7, z, false));
      col(2, { minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.3, maxZ: z + 0.3, top: 0.5 });
    }
  }

  return [
    { x: (s1.x0 + s1.x1) / 2, z: zHigh + 0.7, y: 0, facing: Math.PI },
    { x: (s2.x0 + s2.x1) / 2, z: zLow - 0.7, y: FLOOR_Y[1], facing: 0 },
  ];
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
  const lampFloor: number[] = [];

  // Tres pisos: cada uno es un grupo a su altura. Lo de cada piso se construye
  // en coordenadas locales (y = 0 es su suelo); `on(n)` elige a qué piso va lo
  // que sigue, `col` sube la colisión a esa altura y `light` deja las luces en
  // la raíz (así el mundo las apaga por piso sin cambiar cuántas hay: cambiar
  // el número de luces recompila los shaders y el juego da un tirón).
  const floors = FLOOR_Y.map((y) => {
    const f = new THREE.Group();
    f.position.y = y;
    group.add(f);
    return f;
  });
  let level = 0;
  let g = floors[0];
  const on = (n: number) => {
    level = n;
    g = floors[n];
  };
  const col = (c: Collider) => {
    const y = FLOOR_Y[level];
    colliders.push({ ...c, bottom: y + (c.bottom ?? 0), top: c.top >= 99 ? 99 : y + c.top });
  };
  const light = (l: THREE.PointLight) => {
    l.position.y += FLOOR_Y[level];
    group.add(l);
    lamps.push(l);
    lampFloor.push(level);
  };

  // Planta: pods al centro, cocina al oeste, lounge al este.
  const minX = Math.min(layout.floor.minX - 8, -19.5);
  const maxX = Math.max(layout.floor.maxX + 8, 19.5);
  const minZ = Math.min(layout.floor.minZ - 1.5, -7);
  const maxZ = Math.max(layout.floor.maxZ + 1.5, 15);
  const W = maxX - minX;
  const D = maxZ - minZ;
  const key = [minX, maxX, minZ, maxZ].map((n) => n.toFixed(1)).join(",");

  // Ladrillo a la vista en los muros; acero negro en marcos y rodapiés.
  const brick = brickCanvas(p.dark);
  const trimMat = toon("#1f2024");
  const frameMat = toon("#1f2024");

  // Piso de concreto pulido en toda la planta (los tapetes marcan las zonas).
  const floorTex = concreteTexture(p.dark, W, D);
  const floorMat = new THREE.MeshToonMaterial({ map: floorTex, color: "#ffffff" });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set((minX + maxX) / 2, 0.002, (minZ + maxZ) / 2);
  floor.receiveShadow = true;
  g.add(floor);
  disposables.push(floor.geometry, floorMat, floorTex);

  const kitchen = { minX: minX + 0.2, maxX: minX + 7.5, minZ: minZ + 0.2, maxZ: minZ + 11 };

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
      const mat = brickMaterial(brick, u1 - u0, v1 - v0, disposables);
      const m =
        axis === "x"
          ? mesh(box(u1 - u0, v1 - v0, WALL_T), mat, (u0 + u1) / 2, (v0 + v1) / 2, at)
          : mesh(box(WALL_T, v1 - v0, u1 - u0), mat, at, (v0 + v1) / 2, (u0 + u1) / 2);
      g.add(m);
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
      // Ventana industrial: cuadrícula de 3 × 2 en acero negro.
      for (const s of [-1, 1]) win.add(mesh(box(F * 0.6, y1 - y0 - 2 * F, 0.06), frameMat, (s * (winW - 2 * F)) / 6, (y0 + y1) / 2, 0, false));
      win.add(mesh(box(winW - 2 * F, F * 0.6, 0.06), frameMat, 0, (y0 + y1) / 2, 0, false));
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
      g.add(win);
    }
    piece(u, to, 0, WALL_H);
    // Rodapié y colisión.
    const base =
      axis === "x"
        ? mesh(box(to - from, 0.18, WALL_T + 0.04), trimMat, (from + to) / 2, 0.09, at, false)
        : mesh(box(WALL_T + 0.04, 0.18, to - from), trimMat, at, 0.09, (from + to) / 2, false);
    g.add(base);
    col(
      axis === "x"
        ? { minX: from, maxX: to, minZ: at - WALL_T / 2, maxZ: at + WALL_T / 2, top: 99 }
        : { minX: at - WALL_T / 2, maxX: at + WALL_T / 2, minZ: from, maxZ: to, top: 99 },
    );
  };

  const cx = (minX + maxX) / 2;
  // En el piso 1 el rincón noreste del fondo es pared: ahí van la sala de
  // control (pantallas de todos los agentes) y el tablero de gasto.
  wall("x", minZ, minX - WALL_T / 2, maxX + WALL_T / 2, [cx - 13, cx - 7.5, cx + 7.5], 1);
  wall("z", minX, minZ, maxZ, [minZ + 13, minZ + 19].filter((z) => z < maxZ - 2), 1);
  wall("z", maxX, minZ, maxZ, [minZ + 3.5, minZ + 18].filter((z) => z < maxZ - 2), -1);
  // El piso 2 repite los muros con sus ventanas; el 3 es azotea (solo antepecho).
  on(1);
  wall("x", minZ, minX - WALL_T / 2, maxX + WALL_T / 2, [cx - 13, cx - 7.5, cx + 7.5, cx + 13], 1);
  wall("z", minX, minZ, maxZ, [minZ + 13, minZ + 19].filter((z) => z < maxZ - 2), 1);
  wall("z", maxX, minZ, maxZ, [minZ + 3.5, minZ + 18].filter((z) => z < maxZ - 2), -1);
  on(0);

  // Frente abierto: muro bajo con vidrio arriba y la entrada al centro.
  const partitionGlass = new THREE.MeshBasicMaterial({ color: "#d6f1ff", transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(partitionGlass);
  for (const [a, b] of [
    [minX - WALL_T / 2, cx - DOOR_HALF],
    [cx + DOOR_HALF, maxX + WALL_T / 2],
  ]) {
    g.add(mesh(box(b - a, PARTITION_H, WALL_T), brickMaterial(brick, b - a, PARTITION_H, disposables), (a + b) / 2, PARTITION_H / 2, maxZ));
    g.add(mesh(box(b - a, 0.06, WALL_T + 0.06), frameMat, (a + b) / 2, PARTITION_H + 0.03, maxZ, false));
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 0.5), partitionGlass);
    gl.position.set((a + b) / 2, PARTITION_H + 0.3, maxZ);
    g.add(gl);
    col({ minX: a, maxX: b, minZ: maxZ - WALL_T / 2, maxZ: maxZ + WALL_T / 2, top: PARTITION_H + 0.5 });
  }
  // Tapete de bienvenida.
  g.add(mesh(roundedBox(2.6, 0.02, 1.4, 0.3), toon(p.accent), cx, 0.012, maxZ - 1.1, false));

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
  g.add(signMesh);
  disposables.push(sign.tex, signMat, signMesh.geometry);

  const clock = screenCanvas(256, 256);
  const clockMat = new THREE.MeshBasicMaterial({ map: clock.tex, toneMapped: false, transparent: true });
  const clockMesh = new THREE.Mesh(new THREE.CircleGeometry(0.42, 40), clockMat);
  clockMesh.position.set(cx + 4.2, 2.55, minZ + WALL_T / 2 + 0.03);
  g.add(clockMesh);
  g.add(mesh(new THREE.TorusGeometry(0.43, 0.04, 8, 40), toon("#2b2d42"), clockMesh.position.x, 2.55, minZ + WALL_T / 2 + 0.05, false));
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
  g.add(boardMesh);
  g.add(mesh(box(2.52, 1.72, 0.04), toon("#adb5bd"), cx - 4.6, 1.95, minZ + WALL_T / 2 + 0.01, false));
  g.add(mesh(box(2.3, 0.05, 0.12), toon("#adb5bd"), cx - 4.6, 1.12, minZ + WALL_T / 2 + 0.07, false));
  ["#ef476f", "#3a86ff", "#06d6a0"].forEach((c, i) => g.add(mesh(box(0.14, 0.03, 0.03), toon(c), cx - 5.3 + i * 0.22, 1.16, minZ + WALL_T / 2 + 0.09, false)));
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

  // ── Piso 2 · Café y lounge ─────────────────────────────────────────────
  on(1);
  // ── Cocina (oeste) ─────────────────────────────────────────────────────
  const kx = minX + WALL_T / 2 + 0.55;
  const woodDark = toon(p.dark ? "#5a3b28" : "#8a5a3b");
  const woodTop = toon(p.dark ? "#a9784f" : "#c99a6c");
  const counter = new THREE.Group();
  counter.add(mesh(box(1.0, 0.92, 5), woodDark, 0, 0.46, 0));
  counter.add(mesh(box(1.1, 0.08, 5.1), woodTop, 0, 0.96, 0));
  // Puertas de madera con tirador negro.
  for (let i = 0; i < 4; i++) {
    counter.add(mesh(box(0.02, 0.72, 1.12), toon(p.dark ? "#6a4630" : "#9c6a47"), 0.51, 0.48, -1.8 + i * 1.2, false));
    counter.add(mesh(box(0.03, 0.03, 0.22), trimMat, 0.53, 0.76, -1.8 + i * 1.2, false));
  }
  // Repisas abiertas de madera sobre el ladrillo, con tazas, frascos y matas.
  for (const y of [1.78, 2.2]) {
    counter.add(mesh(box(0.28, 0.05, 1.9), woodTop, -0.38, y, 1.3));
    for (const z of [0.5, 2.1]) counter.add(mesh(box(0.2, 0.14, 0.03), trimMat, -0.44, y - 0.09, z, false));
  }
  ["#ffffff", "#f4f1ea", "#ffffff", "#e8dfd2", "#ffffff"].forEach((c, i) =>
    counter.add(mesh(new THREE.CylinderGeometry(0.055, 0.045, 0.11, 10), toon(c), -0.36, 1.86, 0.55 + i * 0.3, false)),
  );
  [0.6, 1.0, 1.4].forEach((z, i) => {
    counter.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 12), toon("#e8f6ff", { opacity: 0.35 }), -0.36, 2.33, z, false));
    counter.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), toon(["#6f4e37", "#e9c46a", "#c8694b"][i]), -0.36, 2.28, z, false));
  });
  counter.add(mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.14, 10), toon("#e8dfd2"), -0.36, 2.3, 1.95, false));
  counter.add(mesh(new THREE.SphereGeometry(0.13, 10, 8), toon("#5fb760"), -0.36, 2.45, 1.95, false));
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
  g.add(counter);
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
  group.updateMatrixWorld(true);
  espresso.steamAt.forEach((at, i) => {
    // El vapor vive en el grupo del piso: se pasa de mundo a coordenadas de ese piso.
    const base = g.worldToLocal(machine.localToWorld(at.clone()));
    for (let k = 0; k < 3; k++) {
      const mat = new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 });
      const sprite = new THREE.Sprite(mat);
      sprite.position.copy(base);
      g.add(sprite);
      disposables.push(mat);
      steam.push({ sprite, mat, base, phase: k / 3 + i * 0.17 });
    }
  });
  col({ minX: kx - 0.55, maxX: kx + 0.55, minZ: minZ + 0.7, maxZ: minZ + 5.7, top: 1.0 });
  const fr = fridge();
  fr.position.set(kx - 0.05, 0, minZ + 6.5);
  fr.rotation.y = Math.PI / 2;
  g.add(fr);
  col({ minX: kx - 0.5, maxX: kx + 0.45, minZ: minZ + 6, maxZ: minZ + 7, top: 2.1 });
  const cooler = waterCooler();
  cooler.position.set(kx - 0.1, 0, minZ + 8.2);
  g.add(cooler);
  col({ minX: kx - 0.35, maxX: kx + 0.15, minZ: minZ + 7.95, maxZ: minZ + 8.45, top: 1.5 });
  // Isla de cocina: madera, frascos de agua con fruta, grifos de kombucha y
  // cerveza, frascos de snacks y banquetas altas del lado del piso.
  const tableAt = new THREE.Vector3(kitchen.minX + 4.1, 0, minZ + 3.6);
  const island = new THREE.Group();
  island.add(mesh(box(0.9, 0.9, 3.6), woodDark, 0, 0.45, 0));
  island.add(mesh(box(1.1, 0.07, 3.8), woodTop, 0, 0.93, 0));
  for (let i = 0; i < 6; i++) island.add(mesh(box(0.02, 0.8, 0.02), trimMat, 0.46, 0.45, -1.5 + i * 0.6, false));
  [
    ["#f6e27a", "#f4d35e"],
    ["#b8e0a0", "#8ac926"],
    ["#f4a3a8", "#e63946"],
  ].forEach(([water, fruit], i) => {
    const jar = fruitJar(water, fruit);
    jar.position.set(-0.15, 0.965, -1.45 + i * 0.36);
    island.add(jar);
  });
  const taps = tapTower(["#e76f51", "#2a9d8f", "#e9c46a"]);
  taps.position.set(-0.2, 0.965, 0.1);
  taps.rotation.y = Math.PI / 2;
  island.add(taps);
  [0.75, 0.95, 1.15].forEach((z, i) => {
    island.add(mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.22, 12), toon("#e8f6ff", { opacity: 0.35 }), -0.25, 1.08, z, false));
    island.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 12), toon(["#c98b5a", "#6f4e37", "#e9c46a"][i]), -0.25, 1.03, z, false));
  });
  island.add(mesh(new THREE.CylinderGeometry(0.2, 0.13, 0.09, 14), toon("#1f2024"), 0.15, 1.01, 1.4));
  ["#e63946", "#ffb703", "#8ac926", "#ff9f1c"].forEach((c, i) =>
    island.add(mesh(new THREE.SphereGeometry(0.07, 10, 8), toon(c), 0.1 + (i % 2) * 0.1, 1.08, 1.33 + Math.floor(i / 2) * 0.12, false)),
  );
  island.position.copy(tableAt);
  g.add(island);
  col({ minX: tableAt.x - 0.55, maxX: tableAt.x + 0.55, minZ: tableAt.z - 1.9, maxZ: tableAt.z + 1.9, top: 0.97 });
  for (let i = 0; i < 4; i++) {
    const st = barStool();
    const z = tableAt.z - 1.3 + i * 0.86;
    st.position.set(tableAt.x + 0.95, 0, z);
    g.add(st);
    col({ minX: tableAt.x + 0.78, maxX: tableAt.x + 1.12, minZ: z - 0.17, maxZ: z + 0.17, top: 0.8 });
  }
  for (const dz of [-1.1, 1.1]) {
    const lamp = pendantLamp(1.25);
    lamp.position.set(tableAt.x, WALL_H + 0.2, tableAt.z + dz);
    g.add(lamp);
  }

  // Neón sobre la barra del café y pizarra de tiza en la esquina.
  const neonTex = neonCanvas("Hermes", "#ff4f8b", p.font);
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex, transparent: true, toneMapped: false, depthWrite: false });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.81), neonMat);
  neon.position.set(minX + WALL_T / 2 + 0.03, 2.65, minZ + 2.4);
  neon.rotation.y = Math.PI / 2;
  g.add(neon);
  disposables.push(neonTex, neonMat, neon.geometry);
  const neonGlow = new THREE.PointLight("#ff4f8b", 1, 5, 1.8);
  neonGlow.position.set(minX + 0.8, 2.6, minZ + 2.4);
  light(neonGlow);
  const chalkTex = chalkboardCanvas(p.font);
  const chalkMat = new THREE.MeshBasicMaterial({ map: chalkTex });
  disposables.push(chalkTex, chalkMat);
  const chalkX = minX + 2.3;
  g.add(mesh(box(1.42, 1.9, 0.05), toon("#5a3b28"), chalkX, 1.95, minZ + WALL_T / 2 + 0.025, false));
  const chalk = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.78), chalkMat);
  chalk.position.set(chalkX, 1.95, minZ + WALL_T / 2 + 0.055);
  g.add(chalk);

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
  g.add(tvGroup);
  disposables.push(tv.tex, tvMat, tvScreen.geometry);
  // Mueble bajo la TV.
  g.add(mesh(box(0.5, 0.5, 2.6), toon(p.dark ? "#4a3a30" : "#a86b44"), tvX - 0.3, 0.25, lz));
  col({ minX: tvX - 0.55, maxX: tvX, minZ: lz - 1.3, maxZ: lz + 1.3, top: 0.5 });

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
  g.add(mesh(roundedBox(6, 0.02, 5.6, 0.8), toon(p.dark ? mix(p.accent, p.bg, 0.55) : mix(p.accent, "#ffffff", 0.6)), rugAt.x, 0.012, rugAt.z, false));
  const sofa = couch(p.dark ? "#9a4431" : "#b8553b");
  sofa.position.set(maxX - 6.6, 0, lz);
  g.add(sofa);
  col({ minX: maxX - 7.2, maxX: maxX - 6.1, minZ: lz - 1.9, maxZ: lz + 1.9, top: 0.55 });
  // Mesa de centro redonda de madera, con libros, taza y una mata.
  const ctable = new THREE.Group();
  ctable.add(mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.08, 28), toon("#8a5a3b"), 0, 0.42, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    ctable.add(mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.4, 8), trimMat, Math.cos(a) * 0.5, 0.2, Math.sin(a) * 0.5));
  }
  ctable.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon("#ffffff"), 0.25, 0.52, -0.25));
  ctable.add(mesh(box(0.34, 0.05, 0.26), toon("#e76f51"), -0.15, 0.49, 0.2));
  ctable.add(mesh(box(0.3, 0.04, 0.22), toon("#264653"), -0.15, 0.535, 0.2));
  ctable.add(mesh(new THREE.CylinderGeometry(0.08, 0.06, 0.1, 10), toon("#e8dfd2"), 0.1, 0.51, 0.35));
  ctable.add(mesh(new THREE.SphereGeometry(0.1, 10, 8), toon("#5fb760"), 0.1, 0.62, 0.35));
  ctable.position.set(maxX - 4.8, 0, lz);
  g.add(ctable);
  col({ minX: maxX - 5.3, maxX: maxX - 4.3, minZ: lz - 0.8, maxZ: lz + 0.8, top: 0.46 });
  // Sillón verde de terciopelo frente al sofá, y un puf naranja.
  const chair = armchair(p.dark ? "#2f5d50" : "#3f7d6b");
  chair.position.set(maxX - 3.2, 0, lz + 1.7);
  chair.rotation.y = Math.PI + 0.5;
  g.add(chair);
  col({ minX: maxX - 3.8, maxX: maxX - 2.6, minZ: lz + 1.1, maxZ: lz + 2.3, top: 0.6 });
  const lounge = pendantLamp(1.1);
  lounge.position.set(maxX - 4.8, WALL_H + 0.2, lz);
  g.add(lounge);
  [["#e76f51", maxX - 3.6, lz - 2.1]].forEach(([c, x, z]) => {
    const bean = mesh(new THREE.SphereGeometry(0.55, 18, 12), toon(c as string), x as number, 0.32, z as number);
    bean.scale.y = 0.6;
    g.add(bean);
    col({ minX: (x as number) - 0.45, maxX: (x as number) + 0.45, minZ: (z as number) - 0.45, maxZ: (z as number) + 0.45, top: 0.55 });
  });
  const shelf = bookshelf();
  shelf.position.set(maxX - 3.5, 0, minZ + WALL_T / 2 + 0.25);
  g.add(shelf);
  col({ minX: maxX - 4.6, maxX: maxX - 2.4, minZ: minZ, maxZ: minZ + 0.6, top: 2.1 });

  // Máquina de snacks al final de la cocina, de frente al piso.
  const vend = vendingMachine(p.dark ? mix(p.accent, "#000000", 0.25) : p.accent);
  vend.position.set(minX + WALL_T / 2 + 0.42, 0, minZ + 9.9);
  vend.rotation.y = Math.PI / 2;
  g.add(vend);
  col({ minX, maxX: minX + 0.9, minZ: minZ + 9.4, maxZ: minZ + 10.4, top: 1.95 });

  // ── Piso 3 · Azotea: ping-pong, canasta, diana, futbolín y arcade ──────
  on(2);
  const gameAt = new THREE.Vector3(cx - 8, 0, minZ + 8);
  g.add(mesh(roundedBox(6.2, 0.02, 6.2, 0.5), toon(p.dark ? mix(p.bg, "#2a9d8f", 0.35) : mix("#2a9d8f", "#ffffff", 0.6)), gameAt.x, 0.012, gameAt.z, false));
  const pong = pingPongTable();
  pong.position.copy(gameAt);
  g.add(pong);
  col({ minX: gameAt.x - 1.25, maxX: gameAt.x + 1.25, minZ: gameAt.z - 0.72, maxZ: gameAt.z + 0.72, top: 0.8 });
  const basket = new THREE.Group();
  basket.add(mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 14, 1, true), toon("#8d99ae"), 0, 0.17, 0));
  basket.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.02, 14), toon("#8d99ae"), 0, 0.01, 0, false));
  for (let i = 0; i < 7; i++) basket.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), toon(i % 3 ? "#ffffff" : "#ff9f1c"), Math.cos(i * 2.3) * 0.1, 0.33 + (i % 2) * 0.04, Math.sin(i * 2.3) * 0.1, false));
  basket.position.set(gameAt.x - 2.6, 0, gameAt.z - 2.1);
  g.add(basket);
  col({ minX: basket.position.x - 0.2, maxX: basket.position.x + 0.2, minZ: basket.position.z - 0.2, maxZ: basket.position.z + 0.2, top: 0.36 });
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
  // En la azotea no hay muro: la diana va en un tablero de madera propio.
  const dartX = gameAt.x - 4.2;
  g.add(mesh(box(0.12, 2.1, 1.3), toon("#8a5a3b"), dartX, 1.05, gameAt.z));
  col({ minX: dartX - 0.1, maxX: dartX + 0.1, minZ: gameAt.z - 0.65, maxZ: gameAt.z + 0.65, top: 2.1 });
  dart.position.set(dartX + 0.07, 1.75, gameAt.z);
  g.add(dart);

  // ── Esquina sureste: futbolín y máquina arcade ─────────────────────────
  const foosAt = new THREE.Vector3(maxX - 4, 0, minZ + 17.2);
  const foos = foosball();
  foos.position.copy(foosAt);
  g.add(foos);
  col({ minX: foosAt.x - 0.65, maxX: foosAt.x + 0.65, minZ: foosAt.z - 0.42, maxZ: foosAt.z + 0.42, top: 0.84 });
  const arcadeScr = arcadeScreen();
  disposables.push(arcadeScr.tex);
  const arcade = arcadeCabinet(arcadeScr.tex, p.accent);
  arcade.position.set(maxX - WALL_T / 2 - 0.42, 0, minZ + 15.2);
  arcade.rotation.y = -Math.PI / 2;
  g.add(arcade);
  arcade.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m instanceof THREE.MeshBasicMaterial) disposables.push(m);
  });
  col({ minX: maxX - 0.9, maxX, minZ: minZ + 14.8, maxZ: minZ + 15.6, top: 1.95 });

  // ── Detalles: cuadros en la pared del fondo y perchero en la entrada ────
  on(1);
  {
    const x = cx + 10.25;
    const tex = posterCanvas(["Buenas", "ideas,", "mejor", "equipo"], "#e07a5f", "#fff7ef", p.font);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    disposables.push(tex, mat);
    g.add(mesh(box(1.3, 1.7, 0.05), trimMat, x, 2.15, minZ + WALL_T / 2 + 0.025, false));
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(1.18, 1.57), mat);
    poster.position.set(x, 2.15, minZ + WALL_T / 2 + 0.055);
    g.add(poster);
  }
  on(0);
  for (const [x, seed] of [[cx - 10.25, 3]]) {
    const tex = artCanvas(p.skins, seed);
    const mat = new THREE.MeshBasicMaterial({ map: tex });
    disposables.push(tex, mat);
    g.add(mesh(box(1.3, 1.6, 0.05), toon("#5a3a22"), x, 2.2, minZ + WALL_T / 2 + 0.025, false));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 1.44), mat);
    art.position.set(x, 2.2, minZ + WALL_T / 2 + 0.055);
    g.add(art);
  }
  const rackAt = { x: cx - DOOR_HALF - 1.9, z: maxZ - 0.8 };
  const rack = coatRack(p.accent);
  rack.position.set(rackAt.x, 0, rackAt.z);
  g.add(rack);
  col({ minX: rackAt.x - 0.25, maxX: rackAt.x + 0.25, minZ: rackAt.z - 0.25, maxZ: rackAt.z + 0.25, top: 1.8 });

  // ── Plantas y lámparas ─────────────────────────────────────────────────
  // Cabina telefónica de vidrio en la esquina noreste del café.
  on(1);
  const boothGlass = new THREE.MeshBasicMaterial({ color: "#d6f1ff", transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
  disposables.push(boothGlass);
  const booth = phoneBooth(boothGlass);
  const boothAt = { x: maxX - 1.0, z: minZ + 1.0 };
  booth.position.set(boothAt.x, 0, boothAt.z);
  g.add(booth);
  col({ minX: boothAt.x - 0.62, maxX: boothAt.x + 0.62, minZ: boothAt.z - 0.62, maxZ: boothAt.z + 0.62, top: 2.4 });

  // Matas colgantes cerca de las ventanas y en la cocina (por encima de la cabeza: sin colisión).
  for (const [x, z, drop, n] of [
    [cx - 7.5, minZ + 0.9, 0.9, 0],
    [cx + 7.5, minZ + 0.9, 0.9, 0],
    // (La del rincón noreste del piso 1 se quitó: tapaba el tablero de uso de Claude.)
    [cx - 13, minZ + 0.9, 0.8, 1],
    [cx + 7.5, minZ + 0.9, 0.9, 1],
    [tableAt.x + 1.6, tableAt.z + 3.2, 0.9, 1],
  ] as const) {
    on(n);
    const hp = hangingPlant(drop);
    hp.position.set(x, WALL_H + 0.1, z);
    g.add(hp);
  }
  on(0);

  const plants: [number, number, number][] = [
    // La esquina suroeste queda libre: ahí arranca la escalera. La maceta va a 3,3 m del muro:
    // a 2,6 m tapaba con la baranda y el muro bajo la salida del pie de la escalera (huecos de 0,4 m).
    [minX + 3.3, maxZ - 0.9, 1.1],
    [maxX - 0.8, maxZ - 0.9, 1.1],
    [cx - 10.2, minZ + 0.8, 0.9],
    [cx + 6.3, minZ + 0.8, 0.9],
    [cx - DOOR_HALF - 0.7, maxZ - 0.7, 0.8],
    [cx + DOOR_HALF + 0.7, maxZ - 0.7, 0.8],
    [kitchen.maxX + 0.6, minZ + 0.9, 1.0],
  ];
  for (const [x, z, s] of plants) {
    const pl = plant(s);
    pl.position.set(x, 0, z);
    g.add(pl);
    const r = 0.3 * s;
    col({ minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s });
  }

  on(1);
  const lampSpots: [number, number, string][] = [
    [maxX - 7.4, lz + 2.4, "#ffd6a5"],
    [kitchen.maxX + 0.6, minZ + 8, "#ffe8b3"],
  ];
  for (const [x, z, shade] of lampSpots) {
    const l = floorLamp(shade);
    l.group.position.set(x, 0, z);
    g.add(l.group);
    col({ minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25, top: 1.9 });
    const lampLight = new THREE.PointLight("#ffc98a", 1, 9, 1.6);
    lampLight.position.set(x, 1.75, z);
    light(lampLight);
  }
  const kitchenLight = new THREE.PointLight("#ffd9a0", 1, 8, 1.6);
  kitchenLight.position.set(tableAt.x, 2.0, tableAt.z);
  light(kitchenLight);

  // ── Losas, escaleras y azotea ──────────────────────────────────────────
  const stairs = buildFloorsAndStairs({ minX, maxX, minZ, maxZ, cx, p, brick, disposables, floors, col: (n, c) => { on(n); col(c); }, light: (n, l) => { on(n); light(l); } });
  on(0);

  // ── Gente de ambiente: lugares con intención y puestos de los NPC ─────
  // Mismas medidas que los muebles de arriba. Facing: 0 mira a +z, π/2 a +x.
  const W_ = -Math.PI / 2; // mira al oeste (-x)
  const E_ = Math.PI / 2; // mira al este (+x)
  const N_ = Math.PI; // mira al fondo (-z)
  const mid = (minZ + maxZ) / 2;
  const nook = rooftopNook(maxX, minZ);
  const toward = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
  const one = (id: string, floor: number, activity: AmbientPoi["activity"], x: number, z: number, facing: number): AmbientPoi => ({
    id,
    floor,
    activity,
    slots: [{ x, z, facing }],
  });
  /** Un asiento: se llega al punto de pie y se sube al asiento (y = alto del cojín). */
  const seat = (x: number, z: number, facing: number, sx: number, sy: number, sz: number) => ({ x, z, facing, seat: { x: sx, y: sy, z: sz } });
  const stoolZ = (i: number) => tableAt.z - 1.3 + i * 0.86;
  const pois: AmbientPoi[] = [
    // Piso 1 · Equipos: ventanas del fondo, la pizarra, el cuadro y la ventana del este.
    one("ventana-fondo-oeste", 0, "window", cx - 7.5, minZ + 1.1, N_),
    one("ventana-fondo-este", 0, "window", cx + 8, minZ + 1.1, N_),
    one("pizarra", 0, "board", cx - 4.6, minZ + 1.25, N_),
    one("cuadro", 0, "window", cx - 10.25, minZ + 1.5, N_),
    one("ventana-este", 0, "window", maxX - 1.1, minZ + 3.5, E_),
    // Piso 2 · Café: barra, agua, snacks, banquetas, sofá, sillón, pufs, libros y ventanas.
    one("cafe-barra", 1, "coffee", kx + 1.0, minZ + 1.7, W_),
    one("agua", 1, "water", kx + 0.85, minZ + 8.2, W_),
    one("snacks", 1, "snack", minX + 1.6, minZ + 9.9, W_),
    { id: "banqueta-1", floor: 1, activity: "coffee", slots: [seat(tableAt.x + 1.6, stoolZ(1), W_, tableAt.x + 0.95, 0.81, stoolZ(1))] },
    { id: "banqueta-2", floor: 1, activity: "coffee", slots: [seat(tableAt.x + 1.6, stoolZ(3), W_, tableAt.x + 0.95, 0.81, stoolZ(3))] },
    {
      id: "sofa",
      floor: 1,
      activity: "tv",
      slots: [seat(maxX - 5.7, lz - 1.45, E_, maxX - 6.5, 0.63, lz - 0.8), seat(maxX - 5.7, lz + 1.45, E_, maxX - 6.5, 0.63, lz + 0.8)],
    },
    { id: "sillon", floor: 1, activity: "sit", slots: [seat(maxX - 4.0, lz + 2.15, -1.07, maxX - 3.25, 0.63, lz + 1.72)] },
    { id: "puf-oeste", floor: 1, activity: "sit", slots: [seat(cx - 0.75, mid, E_, cx - 1.6, 0.55, mid)] },
    { id: "puf-este", floor: 1, activity: "sit", slots: [seat(cx + 0.75, mid + 0.8, W_, cx + 1.6, 0.55, mid + 0.8)] },
    one("libros", 1, "books", maxX - 3.5, minZ + 1.3, N_),
    one("ventana-cafe-oeste", 1, "window", cx - 7.5, minZ + 1.1, N_),
    one("ventana-cafe-este", 1, "window", cx + 7.5, minZ + 1.1, N_),
    // Piso 3 · Azotea: ping-pong y futbolín (de a dos), dardos, arcade, guirnaldas, sillas de playa y vistas.
    {
      id: "pingpong",
      floor: 2,
      activity: "pingpong",
      together: true,
      slots: [
        { x: gameAt.x - 1.75, z: gameAt.z, facing: E_ },
        { x: gameAt.x + 1.75, z: gameAt.z, facing: W_ },
      ],
    },
    {
      id: "futbolin",
      floor: 2,
      activity: "foosball",
      together: true,
      slots: [
        { x: foosAt.x, z: foosAt.z - 1.05, facing: 0 },
        { x: foosAt.x, z: foosAt.z + 1.05, facing: N_ },
      ],
    },
    one("dardos", 2, "darts", dartX + 2.0, gameAt.z - 1.5, toward(dartX + 2.0, gameAt.z - 1.5, dartX, gameAt.z)),
    one("arcade", 2, "arcade", maxX - 1.5, minZ + 15.2, E_),
    one("guirnaldas-centro", 2, "lights", cx - 2, minZ + 11, 0.4),
    one("guirnaldas-este", 2, "lights", cx + 4, minZ + 8, -0.6),
    { id: "silla-playa-1", floor: 2, activity: "sit", slots: [seat(nook.x - 1.1, nook.z + 1.55, 0, nook.x - 1.1, 0.42, nook.z + 0.45)] },
    { id: "silla-playa-2", floor: 2, activity: "sit", slots: [seat(nook.x + 1.1, nook.z + 1.55, 0, nook.x + 1.1, 0.42, nook.z + 0.45)] },
    one("vista-norte", 2, "view", cx - 4, minZ + 1.0, N_),
    one("vista-este", 2, "view", maxX - 1.0, minZ + 10, E_),
  ];
  const npcSpots: Record<OfficeNpcRole, NpcSpot> = {
    // Recepción, a la derecha de la entrada, con su atril entre ella y el pasillo.
    reception: { floor: 0, x: cx + 3.6, z: maxZ - 2.4, facing: W_, talk: { x: cx + 2.0, z: maxZ - 2.4 } },
    // Barista detrás de la isla (entre la barra y la isla); se le habla desde las banquetas.
    barista: { floor: 1, x: minX + 2.5, z: tableAt.z, facing: E_, talk: { x: tableAt.x + 1.75, z: tableAt.z } },
    // Coordinación, junto al tablero de la cola (muro oeste), mirando al salón.
    queue: { floor: 0, x: minX + 1.0, z: minZ + 4.3, facing: Math.PI / 2 + 0.5, talk: { x: minX + 1.6, z: minZ + 2.4 } },
    // En la azotea, junto a las sillas de playa, mirando hacia donde llega la escalera.
    rooftop: { floor: 2, x: nook.x - 2.6, z: nook.z + 0.8, facing: -Math.PI / 4, talk: { x: nook.x - 3.66, z: nook.z + 1.86 } },
  };

  // Minijuegos de la azotea: dónde se para el dueño y qué esconder mientras juega.
  const hideIn = (root: THREE.Object3D) => {
    const out: THREE.Object3D[] = [];
    root.traverse((o) => o.userData.gamePiece && out.push(o));
    return out;
  };
  const y2 = FLOOR_Y[2];
  const arcadeAt = arcade.position;
  const gameSpots: Record<GameId, GameSpot> = {
    pingpong: { id: "pingpong", floor: 2, stand: { x: gameAt.x - 1.75, z: gameAt.z, facing: E_ }, anchor: { x: gameAt.x, y: y2 + 0.785, z: gameAt.z }, hide: hideIn(pong) },
    darts: { id: "darts", floor: 2, stand: { x: dartX + 2.4, z: gameAt.z, facing: W_ }, anchor: { x: dartX + 0.1, y: y2 + 1.75, z: gameAt.z }, hide: [] },
    basket: {
      id: "basket",
      floor: 2,
      stand: { x: basket.position.x + 2.6, z: basket.position.z, facing: W_ },
      anchor: { x: basket.position.x, y: y2 + 0.34, z: basket.position.z },
      hide: [],
    },
    foosball: { id: "foosball", floor: 2, stand: { x: foosAt.x, z: foosAt.z + 1.05, facing: N_ }, anchor: { x: foosAt.x, y: y2 + 0.68, z: foosAt.z }, hide: hideIn(foos) },
    arcade: { id: "arcade", floor: 2, stand: { x: maxX - 1.5, z: arcadeAt.z, facing: E_ }, anchor: { x: arcadeAt.x - 0.155, y: y2 + 1.42, z: arcadeAt.z }, hide: [] },
  };

  // Tableros de la pared (piso 1): issues al fondo, simétrico al cuadro; PRs y
  // servicios en el muro este, entre sus dos ventanas.
  const eastX = maxX - WALL_T / 2 - 0.04;
  const boardSpots: Record<OfficeBoardId, BoardSpot> = {
    issues: { x: cx + 10.25, y: 1.85, z: minZ + WALL_T / 2 + 0.04, rotY: 0, w: 2.3, h: 1.75, front: { x: cx + 10.25, z: minZ + 1.6 } },
    prs: { x: eastX, y: 1.85, z: minZ + 8.5, rotY: -Math.PI / 2, w: 2.4, h: 1.6, front: { x: maxX - 1.6, z: minZ + 8.5 } },
    services: { x: eastX, y: 1.85, z: minZ + 12.5, rotY: -Math.PI / 2, w: 2.0, h: 1.4, front: { x: maxX - 1.6, z: minZ + 12.5 } },
  };
  // Pizarra libre en el muro oeste, entre el fondo y su primera ventana.
  const whiteboardSpot: BoardSpot = { x: minX + WALL_T / 2 + 0.04, y: 1.75, z: minZ + 6, rotY: Math.PI / 2, w: 2.4, h: 1.5, front: { x: minX + 1.6, z: minZ + 6 } };
  // Rincón de datos del piso 1 (pared del fondo, a la derecha de Issues): sala de control y gasto.
  const backZ = minZ + WALL_T / 2 + 0.05;
  const controlSpot: BoardSpot = { x: cx + 14.0, y: 1.9, z: backZ, rotY: 0, w: 4.3, h: 2.0, front: { x: cx + 14.0, z: minZ + 1.9 } };
  const spendSpot: BoardSpot = { x: cx + 17.8, y: 1.9, z: backZ, rotY: 0, w: 2.5, h: 2.0, front: { x: cx + 17.8, z: minZ + 1.8 } };
  const queueSpot: BoardSpot = { x: minX + WALL_T / 2 + 0.04, y: 1.8, z: minZ + 2.4, rotY: Math.PI / 2, w: 2.2, h: 1.55, front: { x: minX + 1.6, z: minZ + 2.4 } };

  // Pantalla compartida en la TV: una VideoTexture en vez del feed mientras dure.
  let tvVideoTex: THREE.VideoTexture | null = null;
  const setTvVideo = (video: HTMLVideoElement | null) => {
    tvVideoTex?.dispose();
    tvVideoTex = null;
    if (video) {
      tvVideoTex = new THREE.VideoTexture(video);
      tvVideoTex.colorSpace = THREE.SRGBColorSpace;
      tvMat.map = tvVideoTex;
    } else tvMat.map = tv.tex;
    tvMat.needsUpdate = true;
  };

  let lastSky = "";
  return {
    group,
    colliders,
    bounds: { minX, maxX, minZ, maxZ },
    floors,
    lampFloor,
    stairs,
    showFloors(upTo) {
      floors.forEach((f, i) => (f.visible = i <= upTo));
    },
    spawn: { x: cx, z: maxZ - 2.2, facing: Math.PI },
    lamps,
    key,
    pois,
    npcSpots,
    door: { x: cx, z: maxZ - 0.7 },
    boardSpots,
    whiteboardSpot,
    queueSpot,
    controlSpot,
    spendSpot,
    gameSpots,
    arcadeScreen: arcadeScr,
    tv: { floor: 1, x: tvX, y: FLOOR_Y[1] + 1.75, z: lz, front: { x: maxX - 2.2, z: lz - 0.5 } },
    setTvVideo,
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
      tvVideoTex?.dispose();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const d of disposables) d.dispose();
    },
  };
}
