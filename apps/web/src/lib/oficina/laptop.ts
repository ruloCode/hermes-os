// La laptop de cada escritorio ocupado: la tapa se abre al llegar el personaje
// y la pantalla muestra sus últimas líneas reales (tool + objetivo, resultado,
// texto del modelo) — las mismas que el reductor del agente guarda en
// OfficeWorker.lines. Nada inventado: sin líneas, dice "arrancando…".
//
// Basado en agent-office (AgentSystemLabs, MIT — src/client/world/laptop.ts):
// misma carcasa y bisagra, mismo repintado por distancia. La pantalla pinta
// líneas de texto en vez de un PTY.

import * as THREE from "three";
import { mesh, roundedBox, toon } from "./toon";
import type { OfficePalette } from "./palette";

const W = 768;
const H = 480;

export class Laptop {
  readonly root = new THREE.Group();
  private canvas = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private lid = new THREE.Group();
  private openT = 0;
  private closing = false;
  private lines: string[] = [];
  private version = 0;
  private drawnVersion = -1;
  private paintedAt = 0;
  private readonly palette: OfficePalette;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly screenMat: THREE.MeshBasicMaterial;

  constructor(palette: OfficePalette) {
    this.palette = palette;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;

    const shell = toon("#c9ced6");
    const dark = toon("#2b2d42");
    const add = (m: THREE.Mesh, parent: THREE.Object3D = this.root) => {
      this.geos.push(m.geometry);
      parent.add(m);
      return m;
    };
    add(mesh(roundedBox(0.78, 0.035, 0.52, 0.04), shell, 0, 0.018, 0.02));
    add(mesh(new THREE.BoxGeometry(0.66, 0.006, 0.24), dark, 0, 0.037, 0.0, false));
    add(mesh(new THREE.BoxGeometry(0.2, 0.004, 0.11), toon("#aab1bb"), 0, 0.037, 0.19, false));
    this.lid.position.set(0, 0.035, -0.24);
    this.root.add(this.lid);
    const lidShell = add(mesh(roundedBox(0.78, 0.025, 0.5, 0.04), shell, 0, 0.25, 0), this.lid);
    lidShell.rotation.x = Math.PI / 2;
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), this.screenMat);
    screen.position.set(0, 0.25, 0.014);
    this.geos.push(screen.geometry);
    this.lid.add(screen);
    const sticker = add(mesh(new THREE.CircleGeometry(0.07, 20), toon(palette.accent), 0, 0.27, -0.014, false), this.lid);
    sticker.rotation.y = Math.PI;
    this.lid.rotation.x = Math.PI / 2;
    this.paint();
  }

  setLines(lines: string[]) {
    if (lines.length === this.lines.length && lines.every((l, i) => l === this.lines[i])) return;
    this.lines = lines.slice();
    this.version++;
  }

  /** Cierra la tapa (el personaje se va). */
  close() {
    this.closing = true;
  }

  /** `distance` a la cámara: las laptops lejanas se repintan menos. */
  update(dt: number, distance: number) {
    const target = this.closing ? 0 : 1;
    if (this.openT !== target) {
      this.openT = this.closing ? Math.max(0, this.openT - dt * 2.5) : Math.min(1, this.openT + dt * 1.6);
      const e = this.openT * this.openT * (3 - 2 * this.openT);
      this.lid.rotation.x = (Math.PI / 2) * (1 - e) - 0.25 * e;
    }
    const now = performance.now();
    const every = distance < 6 ? 150 : distance < 14 ? 600 : 2000;
    if (this.version !== this.drawnVersion && now - this.paintedAt > every) {
      this.paintedAt = now;
      this.paint();
    }
  }

  private paint() {
    this.drawnVersion = this.version;
    const { ctx } = this;
    const p = this.palette;
    ctx.fillStyle = "#1e1e2e";
    ctx.fillRect(0, 0, W, H);
    const pad = 22;
    const size = 26;
    const lh = size * 1.38;
    ctx.textBaseline = "top";
    ctx.font = `500 ${size}px ${p.mono}`;
    if (!this.lines.length) {
      ctx.fillStyle = "#6c7086";
      ctx.textAlign = "center";
      ctx.fillText("arrancando…", W / 2, H / 2 - size / 2);
      ctx.textAlign = "left";
      this.texture.needsUpdate = true;
      return;
    }
    const rows = Math.floor((H - pad * 2) / lh);
    const shown = this.lines.slice(-rows);
    const maxW = W - pad * 2;
    shown.forEach((line, i) => {
      const head = line.slice(0, 1);
      ctx.fillStyle =
        head === "⚙" ? p.accent : head === "↩" ? "#7f849c" : head === "✗" ? "#f38ba8" : head === "✓" ? "#a6e3a1" : head === "❯" ? "#89b4fa" : "#cdd6f4";
      let text = line;
      while (text.length > 4 && ctx.measureText(text).width > maxW) text = text.slice(0, -2);
      if (text !== line) text = `${text.slice(0, -1)}…`;
      ctx.fillText(text, pad, pad + i * lh);
    });
    this.texture.needsUpdate = true;
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.texture.dispose();
    this.screenMat.dispose();
  }
}
