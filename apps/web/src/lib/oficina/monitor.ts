// Monitor de cada escritorio ocupado: una pantalla más grande que la laptop, en
// la punta exterior del escritorio y girada hacia la silla y el pasillo, con el
// stream del agente (tool por tool, texto del modelo, resultado) — las líneas
// que ya viajan por GET /office/events, sin abrir otro stream por agente.
//
// Se repinta a lo sumo 4 veces por segundo de cerca, 1 a media distancia, y
// nunca fuera de cámara ni lejos (el mundo le pasa la distancia y si se ve).

import * as THREE from "three";
import { DESK_SIZE, type OfficeDesk, type OfficeWorker } from "@hermes/shared";
import { mesh, toon } from "./toon";
import { STATUS_COLOR, STATUS_TEXT, clip, paintLines, spendLabel } from "./terminal";
import type { OfficePalette } from "./palette";

const W = 560;
const H = 360;
const SCREEN = { w: 0.56, h: 0.36 };

export class DeskMonitor {
  readonly root = new THREE.Group();
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private readonly screenMat: THREE.MeshBasicMaterial;
  private readonly geos: THREE.BufferGeometry[] = [];
  private key = "";
  private drawnKey = "-";
  private paintedAt = 0;
  private worker: OfficeWorker | null = null;
  private nick = "";
  /** Cuántas veces se pintó (QA: el monitor se mueve con el agente, no por frame). */
  paints = 0;

  constructor(
    desk: OfficeDesk,
    private readonly palette: OfficePalette,
  ) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    const add = (m: THREE.Mesh, parent: THREE.Object3D = this.root) => {
      this.geos.push(m.geometry);
      parent.add(m);
      return m;
    };
    const dark = toon("#1f2024");
    // Pie y brazo; la pantalla, con su carcasa, gira sobre el brazo.
    add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.14), dark, 0, 0.01, 0, false));
    add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), dark, 0, 0.09, -0.02, false));
    const head = new THREE.Group();
    head.position.set(0, 0.17 + SCREEN.h / 2, 0);
    this.root.add(head);
    add(mesh(new THREE.BoxGeometry(SCREEN.w + 0.04, SCREEN.h + 0.04, 0.03), dark, 0, 0, -0.016, false), head);
    this.screenMat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.screenMat.userData.outlineParameters = { visible: false };
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), this.screenMat);
    screen.position.z = 0.001;
    this.geos.push(screen.geometry);
    head.add(screen);

    // En la punta EXTERIOR del escritorio: la pareja 0 hacia +x del mundo, la
    // 1 hacia -x (las parejas se tocan por el lado de adentro). A rotY π el x
    // local se invierte. Gira hacia la silla y hacia ese pasillo.
    const outward = Math.floor(desk.n / 2) === 0 ? 1 : -1;
    const sx = outward * (Math.abs(desk.rotY) < 0.01 ? 1 : -1);
    this.root.position.set(sx * (DESK_SIZE.width / 2 - 0.3), DESK_SIZE.height, -0.36);
    this.root.rotation.y = sx * 0.55;
    this.paint();
  }

  setWorker(w: OfficeWorker | null, nick: string) {
    this.worker = w;
    this.nick = nick;
    this.key = w ? `${w.status}|${nick}|${spendLabel(w) ?? ""}|${w.lines.join("\n")}` : "";
  }

  /** Repinta si cambió y toca según la distancia; fuera de cámara no gasta nada. */
  update(now: number, distance: number, inView: boolean) {
    if (this.key === this.drawnKey || !inView) return;
    const every = distance < 6 ? 250 : distance < 16 ? 1000 : Infinity;
    if (now - this.paintedAt < every) return;
    this.paintedAt = now;
    this.paint();
  }

  private paint() {
    this.drawnKey = this.key;
    this.paints++;
    const g = this.ctx;
    const p = this.palette;
    g.fillStyle = "#1e1e2e";
    g.fillRect(0, 0, W, H);
    const w = this.worker;
    if (!w) {
      this.tex.needsUpdate = true;
      return;
    }
    // Barra de título: apodo, estado y lo que lleva gastado.
    g.fillStyle = "#2a2b3d";
    g.fillRect(0, 0, W, 44);
    g.fillStyle = STATUS_COLOR[w.status];
    g.beginPath();
    g.arc(20, 22, 7, 0, Math.PI * 2);
    g.fill();
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = "#f4f1ea";
    g.font = `700 21px ${p.font}`;
    const spend = spendLabel(w);
    const right = `${STATUS_TEXT[w.status]}${spend ? ` · ${spend}` : ""}`;
    g.font = `500 18px ${p.font}`;
    const rw = g.measureText(right).width;
    g.fillStyle = STATUS_COLOR[w.status];
    g.textAlign = "right";
    g.fillText(right, W - 14, 23);
    g.textAlign = "left";
    g.fillStyle = "#f4f1ea";
    g.font = `700 21px ${p.font}`;
    g.fillText(clip(g, this.nick ? `${this.nick} · ${w.name}` : w.name, W - rw - 60), 36, 23);
    paintLines(g, w.lines, 14, 56, W - 28, H - 66, 19, p.mono, p.accent);
    this.tex.needsUpdate = true;
  }

  /** QA: el texto que muestra (lo mismo que pinta). */
  shown(): string[] {
    return this.worker ? this.worker.lines.slice() : [];
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    this.tex.dispose();
    this.screenMat.dispose();
    this.root.removeFromParent();
  }
}
