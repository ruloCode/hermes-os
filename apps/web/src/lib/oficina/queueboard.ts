// El tablero de la cola de agentes en la pared: lo que corre, lo que espera y
// lo último que terminó, con el tope de concurrencia. Datos de GET
// /office/queue; sin respuesta del agente lo dice.

import * as THREE from "three";
import { queueCounts, type QueueItem, type QueueState } from "@hermes/shared";
import { mesh, toon } from "./toon";
import type { BoardSpot } from "./room";

const STATUS: Record<QueueItem["status"], { mark: string; color: string; label: string }> = {
  running: { mark: "▶", color: "#e7b04e", label: "en curso" },
  queued: { mark: "…", color: "#7fc4d4", label: "esperando" },
  done: { mark: "✓", color: "#6ccb8f", label: "lista" },
  error: { mark: "✗", color: "#f07070", label: "error" },
  canceled: { mark: "–", color: "#9aa3b2", label: "cancelada" },
};

export class QueueBoard {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = "-";

  constructor(
    readonly spot: BoardSpot,
    private readonly font: string,
  ) {
    this.canvas.width = Math.round(spot.w * 400);
    this.canvas.height = Math.round(spot.h * 400);
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group.add(mesh(new THREE.BoxGeometry(spot.w + 0.12, spot.h + 0.12, 0.05), toon("#2b2d42"), 0, 0, -0.02, false));
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.surface.position.z = 0.012;
    (this.surface.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.group.add(this.surface);
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.rotY;
    this.setState(undefined);
  }

  /** undefined = cargando · null = el agente no respondió. */
  setState(q: QueueState | null | undefined) {
    const key = JSON.stringify(q === undefined ? "loading" : q);
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    const { width: w, height: h } = this.canvas;
    const f = this.font;
    g.fillStyle = "#1d2433";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#f4f1ea";
    g.font = `800 60px ${f}`;
    g.textBaseline = "middle";
    g.fillText("Cola de agentes", 44, 64);
    if (!q) {
      g.fillStyle = "#9aa3b2";
      g.font = `500 38px ${f}`;
      g.fillText(q === null ? "El agente no respondió." : "Cargando…", 44, h / 2);
      this.tex.needsUpdate = true;
      return;
    }
    const c = queueCounts(q.items);
    g.font = `500 32px ${f}`;
    g.fillStyle = "#9aa3b2";
    g.fillText(`${c.running} en curso · ${c.queued} esperando · hasta ${q.max} a la vez`, 44, 122);
    const live = q.items.filter((i) => i.status === "running" || i.status === "queued");
    const recent = q.items
      .filter((i) => i.status === "done" || i.status === "error")
      .sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
    const rows = [...live, ...recent].slice(0, 7);
    if (!rows.length) {
      g.fillStyle = "#cdd6f4";
      g.font = `500 36px ${f}`;
      g.fillText("Vacía. Acércate y presiona E para pedir trabajo.", 44, h / 2 + 30);
    }
    rows.forEach((it, i) => {
      const y = 196 + i * 62;
      const st = STATUS[it.status];
      g.fillStyle = st.color;
      g.font = `700 36px ${f}`;
      g.fillText(st.mark, 44, y);
      g.fillStyle = it.status === "done" || it.status === "error" ? "#9aa3b2" : "#f4f1ea";
      g.font = `500 32px ${f}`;
      let t = it.title;
      while (t.length > 3 && g.measureText(t).width > w - 330) t = t.slice(0, -2);
      g.fillText(t === it.title ? t : `${t}…`, 92, y);
      g.fillStyle = st.color;
      g.font = `500 26px ${f}`;
      g.textAlign = "right";
      g.fillText(st.label, w - 44, y);
      g.textAlign = "left";
    });
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
