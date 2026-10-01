// Sala de control (piso 1, pared del fondo): una cuadrícula con la terminal de
// TODOS los agentes vivos — apodo, proyecto, estado, lo que llevan gastado y
// sus últimas líneas reales. UN solo canvas y una sola malla para toda la
// pared (no una por agente), repintada a lo sumo 3 veces por segundo y solo si
// se ve. Clic en una pantalla = el panel de ese agente (`tileAt` por UV).

import * as THREE from "three";
import type { OfficeWorker } from "@hermes/shared";
import { mesh, toon } from "./toon";
import { STATUS_COLOR, STATUS_TEXT, clip, paintLines, spendLabel } from "./terminal";
import type { BoardSpot } from "./room";
import type { OfficePalette } from "./palette";

const PX_PER_M = 300;
/** Más de esto no cabe legible: el resto se cuenta ("+N más"). */
export const CONTROL_MAX_TILES = 12;

/** Columnas y filas para `n` pantallas (cuadrícula lo más cuadrada posible para una pared ancha). */
export function controlGrid(n: number): { cols: number; rows: number } {
  const k = Math.min(Math.max(n, 1), CONTROL_MAX_TILES);
  const cols = k <= 1 ? 1 : k <= 2 ? 2 : k <= 6 ? 3 : 4;
  return { cols, rows: Math.ceil(k / cols) };
}

interface Tile {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class ControlWall {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private workers: OfficeWorker[] = [];
  private nicks: ReadonlyMap<string, string> = new Map();
  private projectName: (slug: string) => string = (s) => s;
  private key = "";
  private drawnKey = "-";
  private paintedAt = 0;
  private tiles: Tile[] = [];
  paints = 0;

  constructor(
    readonly spot: BoardSpot,
    private readonly palette: OfficePalette,
  ) {
    this.canvas.width = Math.round(spot.w * PX_PER_M);
    this.canvas.height = Math.round(spot.h * PX_PER_M);
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group.add(mesh(new THREE.BoxGeometry(spot.w + 0.16, spot.h + 0.16, 0.06), toon("#1f2024"), 0, 0, -0.025, false));
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.surface.position.z = 0.012;
    (this.surface.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.group.add(this.surface);
    // Repisa con dos parlantes: es una sala de control, no un cuadro.
    this.group.add(mesh(new THREE.BoxGeometry(spot.w, 0.05, 0.22), toon("#2b2d42"), 0, -spot.h / 2 - 0.12, 0.08, false));
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.rotY;
    this.paint();
  }

  setWorkers(workers: OfficeWorker[], nicks: ReadonlyMap<string, string>, projectName: (slug: string) => string) {
    this.workers = workers;
    this.nicks = nicks;
    this.projectName = projectName;
    this.key = workers.map((w) => `${w.id}|${w.status}|${nicks.get(w.id) ?? ""}|${spendLabel(w) ?? ""}|${w.project}|${w.lines.join("\n")}`).join("§");
  }

  update(now: number, inView: boolean) {
    if (this.key === this.drawnKey || !inView || now - this.paintedAt < 333) return;
    this.paintedAt = now;
    this.paint();
  }

  /** El agente de la pantalla bajo un punto UV de la pared (clic). */
  tileAt(uv: THREE.Vector2): string | null {
    const x = uv.x * this.canvas.width;
    const y = (1 - uv.y) * this.canvas.height;
    return this.tiles.find((t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h)?.id ?? null;
  }

  /** QA: qué pantalla muestra a quién. */
  debug() {
    return { tiles: this.tiles.map((t) => t.id), paints: this.paints };
  }

  private paint() {
    this.drawnKey = this.key;
    this.paints++;
    const g = this.ctx;
    const p = this.palette;
    const { width: W, height: H } = this.canvas;
    g.fillStyle = "#0e0f16";
    g.fillRect(0, 0, W, H);
    this.tiles = [];
    const list = this.workers.slice(0, CONTROL_MAX_TILES);
    if (!list.length) {
      g.fillStyle = "#cdd6f4";
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.font = `700 52px ${p.font}`;
      g.fillText("Sala de control", W / 2, H / 2 - 40);
      g.fillStyle = "#9aa3b2";
      g.font = `500 32px ${p.font}`;
      g.fillText("Sin agentes vivos. Contrata uno en un escritorio libre (+).", W / 2, H / 2 + 26);
      g.textAlign = "left";
      this.tex.needsUpdate = true;
      return;
    }
    const { cols, rows } = controlGrid(list.length);
    const gap = 10;
    const tw = (W - gap * (cols + 1)) / cols;
    const th = (H - gap * (rows + 1)) / rows;
    const scale = Math.min(1, th / 300);
    list.forEach((w, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = gap + c * (tw + gap);
      const y = gap + r * (th + gap);
      this.tiles.push({ id: w.id, x, y, w: tw, h: th });
      g.fillStyle = "#1e1e2e";
      g.fillRect(x, y, tw, th);
      const bar = Math.round(46 * scale + 8);
      g.fillStyle = "#2a2b3d";
      g.fillRect(x, y, tw, bar);
      g.fillStyle = STATUS_COLOR[w.status];
      g.fillRect(x, y, 6, th);
      g.textBaseline = "middle";
      const spend = spendLabel(w);
      const right = `${STATUS_TEXT[w.status]}${spend ? ` · ${spend}` : ""}`;
      g.font = `600 ${Math.round(22 * scale + 4)}px ${p.font}`;
      const rw = g.measureText(right).width;
      g.fillStyle = STATUS_COLOR[w.status];
      g.textAlign = "right";
      g.fillText(right, x + tw - 14, y + bar / 2);
      g.textAlign = "left";
      g.fillStyle = "#f4f1ea";
      g.font = `700 ${Math.round(24 * scale + 4)}px ${p.font}`;
      const nick = this.nicks.get(w.id);
      g.fillText(clip(g, `${nick ? `${nick} · ` : ""}${this.projectName(w.project)}`, tw - rw - 40), x + 18, y + bar / 2);
      paintLines(g, w.lines, x + 18, y + bar + 10, tw - 32, th - bar - 18, Math.round(18 * scale + 4), p.mono, p.accent);
    });
    if (this.workers.length > CONTROL_MAX_TILES) {
      g.fillStyle = "#f4f1ea";
      g.font = `600 26px ${p.font}`;
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillText(`+${this.workers.length - CONTROL_MAX_TILES} más en la lista del equipo`, W - 16, H - 8);
      g.textAlign = "left";
    }
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    (this.surface.material as THREE.Material).dispose();
    this.tex.dispose();
    this.group.removeFromParent();
  }
}
