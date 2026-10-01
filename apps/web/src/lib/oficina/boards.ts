// Los tres tableros de pared del piso de los equipos: Issues (corcho con notas
// de Linear), Pull requests (pizarra blanca con los PRs abiertos) y Servicios
// (pantalla con los dev servers que escuchan un puerto). Se pintan en canvas
// con los datos de GET /office/boards; sin datos todavía dicen "cargando", y si
// una fuente falla lo dicen — un tablero vacío nunca finge que no hay nada.

import * as THREE from "three";
import type { BoardIssueItem, BoardSection, OfficeBoardId, OfficeBoards } from "@hermes/shared";
import { mesh, toon } from "./toon";
import type { BoardSpot } from "./room";

const PX_PER_M = 400;

interface BoardView {
  id: OfficeBoardId;
  group: THREE.Group;
  surface: THREE.Mesh;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: THREE.CanvasTexture;
  spot: BoardSpot;
  key: string;
}

const NOTE_COLORS: Record<BoardIssueItem["column"], string> = { todo: "#ffe79a", doing: "#bfe0ff", done: "#c8efc0" };
const COLUMN_LABEL: Record<BoardIssueItem["column"], string> = { todo: "Por hacer", doing: "En curso", done: "Hecho" };

/** Corta `text` en líneas que caben en `max` px (como mucho `lines`, la última con …). */
function wrap(g: CanvasRenderingContext2D, text: string, max: number, lines: number): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width <= max) cur = next;
    else {
      if (cur) out.push(cur);
      cur = w;
      if (out.length === lines) break;
    }
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length > lines) out.length = lines;
  const used = out.join(" ").split(/\s+/).length;
  if (used < words.length && out.length) {
    let last = out[out.length - 1];
    while (last.length > 1 && g.measureText(`${last}…`).width > max) last = last.slice(0, -1);
    out[out.length - 1] = `${last}…`;
  }
  return out;
}

function title(g: CanvasRenderingContext2D, w: number, text: string, sub: string, font: string, dark: boolean) {
  g.fillStyle = dark ? "#f4f1ea" : "#2b2d42";
  g.font = `800 64px ${font}`;
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillText(text, 48, 66);
  g.font = `500 32px ${font}`;
  g.fillStyle = dark ? "#9aa3b2" : "#6c757d";
  g.textAlign = "right";
  g.fillText(sub, w - 48, 70);
  g.textAlign = "left";
}

function message(g: CanvasRenderingContext2D, w: number, h: number, text: string, font: string, color: string) {
  g.fillStyle = color;
  g.font = `500 40px ${font}`;
  g.textAlign = "center";
  wrap(g, text, w - 160, 3).forEach((l, i) => g.fillText(l, w / 2, h / 2 + i * 52));
  g.textAlign = "left";
}

/** Pie común: la fuente fallida o vacía se dice tal cual. */
function sectionState<T>(s: BoardSection<T> | undefined, empty: string, off: string): string | null {
  if (!s) return "Cargando…";
  if (!s.available) return s.error ?? off;
  if (s.error) return s.error;
  if (!s.items.length) return empty;
  return null;
}

function paintIssues(v: BoardView, data: OfficeBoards | null, font: string) {
  const { ctx: g, canvas } = v;
  const w = canvas.width;
  const h = canvas.height;
  // Corcho con motas.
  g.fillStyle = "#c79a63";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 500; i++) {
    g.fillStyle = i % 2 ? "rgba(90,55,25,0.18)" : "rgba(255,240,210,0.16)";
    g.fillRect((i * 97) % w, (i * 53) % h, 3 + (i % 4), 3 + (i % 3));
  }
  const s = data?.issues;
  const n = s?.items ?? [];
  const sub = s?.available ? `Linear · ${n.filter((i) => i.column !== "done").length} abiertos` : "Linear";
  title(g, w, "Issues", sub, font, false);
  const state = sectionState(s, "No hay issues en Linear.", "Linear no está configurado en esta máquina.");
  if (state) return message(g, w, h, state, font, "#3b2a20");
  // Primero lo que está en curso, luego lo pendiente, luego lo hecho.
  const order = { doing: 0, todo: 1, done: 2 } as const;
  const notes = n.slice().sort((a, b) => order[a.column] - order[b.column]).slice(0, 12);
  const cols = 4;
  const nw = (w - 96 - (cols - 1) * 24) / cols;
  const nh = 150;
  notes.forEach((it, i) => {
    const x = 48 + (i % cols) * (nw + 24);
    const y = 124 + Math.floor(i / cols) * (nh + 16);
    const tilt = ((i * 37) % 7) / 100 - 0.03;
    g.save();
    g.translate(x + nw / 2, y + nh / 2);
    g.rotate(tilt);
    g.fillStyle = "rgba(0,0,0,0.18)";
    g.fillRect(-nw / 2 + 6, -nh / 2 + 8, nw, nh);
    g.fillStyle = NOTE_COLORS[it.column];
    g.fillRect(-nw / 2, -nh / 2, nw, nh);
    g.fillStyle = it.column === "doing" ? "#3a86ff" : it.column === "done" ? "#2a9d8f" : "#e76f51";
    g.beginPath();
    g.arc(0, -nh / 2 + 14, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b2d42";
    g.font = `700 28px ${font}`;
    g.fillText(it.id, -nw / 2 + 16, -nh / 2 + 44);
    g.fillStyle = "#2b2d42";
    g.font = `500 25px ${font}`;
    wrap(g, it.title, nw - 32, 3).forEach((l, k) => g.fillText(l, -nw / 2 + 16, -nh / 2 + 80 + k * 28));
    g.restore();
  });
  // Leyenda: el color de la nota es su columna.
  g.font = `600 26px ${font}`;
  let lx = 48;
  for (const col of ["todo", "doing", "done"] as const) {
    g.fillStyle = NOTE_COLORS[col];
    g.fillRect(lx, h - 46, 26, 26);
    g.fillStyle = "#3b2a20";
    g.fillText(COLUMN_LABEL[col], lx + 36, h - 32);
    lx += 56 + g.measureText(COLUMN_LABEL[col]).width;
  }
}

function paintPrs(v: BoardView, data: OfficeBoards | null, font: string) {
  const { ctx: g, canvas } = v;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = "#fbfbf8";
  g.fillRect(0, 0, w, h);
  const s = data?.prs;
  title(g, w, "Pull requests", s?.available ? `GitHub · ${s.items.length} abiertos` : "GitHub", font, false);
  g.strokeStyle = "#2b2d42";
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(48, 112);
  g.lineTo(520, 106);
  g.stroke();
  const state = sectionState(s, "No hay PRs abiertos en los repos de tus proyectos.", "GitHub no está disponible en esta máquina.");
  if (state) return message(g, w, h, state, font, "#6c757d");
  s!.items.slice(0, 6).forEach((pr, i) => {
    const y = 160 + i * 88;
    g.fillStyle = pr.draft ? "#adb5bd" : "#2a9d8f";
    g.beginPath();
    g.arc(66, y + 6, 13, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#2b2d42";
    g.font = `700 32px ${font}`;
    const head = `#${pr.number}`;
    g.fillText(head, 96, y);
    const hw = g.measureText(head).width;
    g.font = `500 32px ${font}`;
    g.fillText(wrap(g, pr.title, w - 150 - hw, 1)[0] ?? "", 112 + hw, y);
    g.font = `500 24px ${font}`;
    g.fillStyle = "#6c757d";
    g.fillText(`${pr.repo}${pr.author ? ` · ${pr.author}` : ""}${pr.draft ? " · borrador" : ""}`, 96, y + 36);
  });
  if (s!.items.length > 6) message(g, w, h * 1.82, `…y ${s!.items.length - 6} más`, font, "#6c757d");
}

function paintServices(v: BoardView, data: OfficeBoards | null, font: string, mono: string) {
  const { ctx: g, canvas } = v;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = "#15161f";
  g.fillRect(0, 0, w, h);
  const s = data?.services;
  title(g, w, "Servicios", s?.available ? `${s.items.length} escuchando` : "", font, true);
  const state = sectionState(s, "Ningún servidor de desarrollo escuchando ahora.", "No se pudo leer los puertos.");
  if (state) return message(g, w, h, state, font, "#9aa3b2");
  s!.items.slice(0, 6).forEach((sv, i) => {
    const y = 160 + i * 66;
    g.fillStyle = "#6ccb8f";
    g.beginPath();
    g.arc(62, y, 10, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f4f1ea";
    g.font = `700 34px ${mono}`;
    g.fillText(`:${sv.port}`, 86, y + 2);
    g.font = `500 28px ${font}`;
    g.fillStyle = "#cdd6f4";
    g.fillText(wrap(g, sv.role ?? sv.project ?? sv.process, w - 300, 1)[0] ?? "", 250, y + 2);
  });
}

/** Construye los tres tableros en sus lugares de la pared. */
export class WallBoards {
  readonly group = new THREE.Group();
  private readonly views: BoardView[] = [];
  private data: OfficeBoards | null = null;

  constructor(
    spots: Record<OfficeBoardId, BoardSpot>,
    private readonly font: string,
    private readonly mono: string,
  ) {
    for (const id of ["issues", "prs", "services"] as const) {
      const spot = spots[id];
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(spot.w * PX_PER_M);
      canvas.height = Math.round(spot.h * PX_PER_M);
      const ctx = canvas.getContext("2d")!;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      const g = new THREE.Group();
      const frame = id === "issues" ? "#7a5232" : id === "prs" ? "#adb5bd" : "#1f2024";
      g.add(mesh(new THREE.BoxGeometry(spot.w + 0.12, spot.h + 0.12, 0.05), toon(frame), 0, 0, -0.02, false));
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
      surface.position.z = 0.012;
      surface.userData.boardId = id;
      (surface.material as THREE.Material).userData.outlineParameters = { visible: false };
      g.add(surface);
      if (id === "prs") g.add(mesh(new THREE.BoxGeometry(spot.w - 0.2, 0.05, 0.12), toon("#adb5bd"), 0, -spot.h / 2 - 0.06, 0.05, false));
      g.position.set(spot.x, spot.y, spot.z);
      g.rotation.y = spot.rotY;
      this.group.add(g);
      const view: BoardView = { id, group: g, surface, canvas, ctx, tex, spot, key: "-" };
      this.views.push(view);
      this.paint(view);
    }
  }

  setData(data: OfficeBoards | null) {
    this.data = data;
    for (const v of this.views) this.paint(v);
  }

  private paint(v: BoardView) {
    const section = this.data?.[v.id];
    const key = JSON.stringify(section ?? null);
    if (key === v.key) return;
    v.key = key;
    if (v.id === "issues") paintIssues(v, this.data, this.font);
    else if (v.id === "prs") paintPrs(v, this.data, this.font);
    else paintServices(v, this.data, this.font, this.mono);
    v.tex.needsUpdate = true;
  }

  /** Superficies para el clic (vista aérea o puntero). */
  surfaces(): THREE.Object3D[] {
    return this.views.map((v) => v.surface);
  }

  /** El tablero al alcance de (x, z): el de punto de uso más cercano dentro de `reach`. */
  near(x: number, z: number, reach: number): { id: OfficeBoardId; d: number; at: THREE.Vector3 } | null {
    let best: { id: OfficeBoardId; d: number; at: THREE.Vector3 } | null = null;
    for (const v of this.views) {
      const d = Math.hypot(v.spot.front.x - x, v.spot.front.z - z);
      if (d > reach || (best && d >= best.d)) continue;
      best = { id: v.id, d, at: new THREE.Vector3(v.spot.x, v.spot.y + v.spot.h / 2 + 0.3, v.spot.z) };
    }
    return best;
  }

  spot(id: OfficeBoardId): BoardSpot | null {
    return this.views.find((v) => v.id === id)?.spot ?? null;
  }

  dispose() {
    for (const v of this.views) {
      v.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      (v.surface.material as THREE.Material).dispose();
      v.tex.dispose();
    }
    this.group.removeFromParent();
  }
}
