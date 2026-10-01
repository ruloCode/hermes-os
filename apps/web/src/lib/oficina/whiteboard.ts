// La pizarra libre en 3D: muestra el último dibujo guardado en el agente (o,
// limpia, la invitación a dibujar). Se dibuja en el editor HTML
// (components/oficina/WhiteboardEditor.tsx); esto solo la cuelga y la pinta.

import * as THREE from "three";
import { mesh, toon } from "./toon";
import type { BoardSpot } from "./room";

export class WallWhiteboard {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private image: string | null | undefined = undefined;
  private loading = 0;

  constructor(
    readonly spot: BoardSpot,
    private readonly font: string,
  ) {
    this.canvas.width = 1600;
    this.canvas.height = 1000;
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group.add(mesh(new THREE.BoxGeometry(spot.w + 0.12, spot.h + 0.12, 0.05), toon("#adb5bd"), 0, 0, -0.02, false));
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.surface.position.z = 0.012;
    this.surface.userData.whiteboard = true;
    (this.surface.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.group.add(this.surface);
    // Bandeja con marcadores.
    this.group.add(mesh(new THREE.BoxGeometry(spot.w - 0.3, 0.05, 0.12), toon("#adb5bd"), 0, -spot.h / 2 - 0.06, 0.05, false));
    ["#ef476f", "#3a86ff", "#2b2d42"].forEach((c, i) => this.group.add(mesh(new THREE.BoxGeometry(0.14, 0.03, 0.03), toon(c), -0.4 + i * 0.22, -spot.h / 2 - 0.02, 0.07, false)));
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.rotY;
    this.setImage(null);
  }

  /** El dibujo guardado (data URL PNG) o null = pizarra limpia. */
  setImage(image: string | null) {
    if (image === this.image) return;
    this.image = image;
    const g = this.ctx;
    const { width: w, height: h } = this.canvas;
    const blank = () => {
      g.fillStyle = "#fbfbf8";
      g.fillRect(0, 0, w, h);
    };
    if (!image) {
      blank();
      g.fillStyle = "#adb5bd";
      g.font = `600 64px ${this.font}`;
      g.textAlign = "center";
      g.fillText("Pizarra libre", w / 2, h / 2 - 20);
      g.font = `500 40px ${this.font}`;
      g.fillText("acércate y presiona E para dibujar", w / 2, h / 2 + 50);
      g.textAlign = "left";
      this.tex.needsUpdate = true;
      return;
    }
    const ticket = ++this.loading;
    const img = new Image();
    img.onload = () => {
      if (ticket !== this.loading) return;
      blank();
      g.drawImage(img, 0, 0, w, h);
      this.tex.needsUpdate = true;
    };
    img.src = image;
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
