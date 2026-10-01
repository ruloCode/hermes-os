// Tablero de gasto de tokens (piso 1, pared del fondo) y su versión grande en
// el monitor de la oficina de CEO. Datos de GET /office/spend: cada número
// sale de los archivos de usage.ts o del result del CLI (ver office-spend.ts).
// Sin respuesta del agente lo dice; sin histórico, también: nunca un cero que
// parezca dato.

import * as THREE from "three";
import { formatPlanReset, formatTokens, formatUsd, totalTokens, type OfficeSpend, type PlanUsage, type SpendRow } from "@hermes/shared";
import { mesh, toon } from "./toon";
import type { BoardSpot } from "./room";

const PX_PER_M = 400;
const INK = "#f4f1ea";
const DIM = "#9aa3b2";
const SOFT = "#cdd6f4";
const BAR = "#e7b04e";
const GREEN = "#6ccb8f";
/** Barras del uso del plan: azul como en claude.ai; ámbar desde 80 %, rojo desde 95 %. */
const PLAN_BLUE = "#3b82f6";

function planColor(u: number): string {
  return u >= 95 ? "#f07070" : u >= 80 ? BAR : PLAN_BLUE;
}

/**
 * Las barras del uso del plan (GET /office/plan-usage): sesión actual, semana
 * y límites por modelo, cada una con su "Se restablece…". Devuelve dónde terminó.
 */
function planRows(g: CanvasRenderingContext2D, plan: PlanUsage | null | undefined, x: number, y: number, w: number, rowH: number, font: string): number {
  if (!plan) {
    g.fillStyle = DIM;
    g.font = `500 26px ${font}`;
    g.fillText(plan === null ? "Uso del plan: sin datos (el agente no respondió)." : "Uso del plan: cargando…", x, y + 20);
    return y + 60;
  }
  if (!plan.available || !plan.windows.length) {
    g.fillStyle = DIM;
    g.font = `500 24px ${font}`;
    g.fillText(fit(g, plan.error ?? "Sin límites de plan en esta sesión.", w), x, y + 20);
    return y + 60;
  }
  const now = new Date();
  plan.windows.forEach((win, i) => {
    const ry = y + i * rowH;
    const labelW = w * 0.4;
    const pctW = 175;
    g.fillStyle = INK;
    g.font = `600 30px ${font}`;
    g.fillText(fit(g, win.label, labelW - 10), x, ry + 16);
    g.fillStyle = DIM;
    g.font = `500 21px ${font}`;
    const reset = formatPlanReset(win.resetsAt, now, win.key !== "five_hour");
    g.fillText(fit(g, reset ?? "", labelW - 10), x, ry + 50);
    const bx = x + labelW;
    const bw = w - labelW - pctW - 16;
    const by = ry + 28;
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.beginPath();
    g.roundRect(bx, by - 6, bw, 12, 6);
    g.fill();
    g.fillStyle = planColor(win.utilization);
    g.beginPath();
    g.roundRect(bx, by - 6, Math.max(6, (bw * win.utilization) / 100), 12, 6);
    g.fill();
    g.fillStyle = SOFT;
    g.font = `500 26px ${font}`;
    g.textAlign = "right";
    g.fillText(`${Math.round(win.utilization)}% usado`, x + w, by);
    g.textAlign = "left";
  });
  return y + plan.windows.length * rowH;
}

function fit(g: CanvasRenderingContext2D, text: string, max: number): string {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 2 && g.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d}/${m}`;
}

/** Barras de la serie diaria; los días sin dato no se pintan (ni como cero). */
function bars(g: CanvasRenderingContext2D, data: OfficeSpend, n: number, x: number, y: number, w: number, h: number, font: string) {
  const pts = data.series.slice(-n);
  if (!pts.length) {
    g.fillStyle = DIM;
    g.font = `500 26px ${font}`;
    g.fillText("Sin histórico en esta máquina.", x, y + h / 2);
    return;
  }
  const max = Math.max(0.01, ...pts.map((p) => p.costUsd));
  const bw = w / pts.length;
  pts.forEach((p, i) => {
    const bx = x + i * bw;
    if (!p.known) {
      g.fillStyle = "rgba(255,255,255,0.06)";
      g.fillRect(bx + bw * 0.2, y + h - 4, bw * 0.6, 4);
      return;
    }
    const bh = Math.max(p.costUsd > 0 ? 4 : 2, (p.costUsd / max) * (h - 30));
    g.fillStyle = i === pts.length - 1 ? BAR : "rgba(231,176,78,0.55)";
    g.fillRect(bx + bw * 0.18, y + h - bh, bw * 0.64, bh);
  });
  g.fillStyle = DIM;
  g.font = `500 20px ${font}`;
  g.fillText(dayLabel(pts[0].day), x, y + h + 26);
  g.textAlign = "right";
  g.fillText(`hoy ${dayLabel(pts[pts.length - 1].day)}`, x + w, y + h + 26);
  g.textAlign = "left";
}

function rows(g: CanvasRenderingContext2D, list: SpendRow[], label: (k: string) => string, x: number, y: number, w: number, max: number, font: string, mono: string) {
  list.slice(0, max).forEach((r, i) => {
    const ry = y + i * 46;
    g.fillStyle = SOFT;
    g.font = `500 28px ${font}`;
    g.fillText(fit(g, label(r.key), w - 220), x, ry);
    g.fillStyle = INK;
    g.font = `600 28px ${mono}`;
    g.textAlign = "right";
    g.fillText(formatUsd(r.costUsd), x + w, ry);
    g.fillStyle = DIM;
    g.font = `500 22px ${font}`;
    g.fillText(`${r.runs}×`, x + w - 120, ry);
    g.textAlign = "left";
  });
}

export interface SpendPaintOpts {
  font: string;
  mono: string;
  projectName: (slug: string) => string;
  /** Versión grande (monitor del CEO): serie de 30 días, por proyecto, por modelo y quién gasta ahora. */
  big?: boolean;
  /** Píxeles por metro del canvas (el monitor del CEO es chico y necesita más resolución). */
  pxPerM?: number;
}

/**
 * Pinta el tablero en un canvas. Arriba el uso del PLAN (sesión, semana, Fable…:
 * lo que importa con una suscripción) y abajo el gasto equivalente en dólares
 * del registro local. `data`/`plan`: undefined = cargando · null = sin respuesta.
 */
export function paintSpend(g: CanvasRenderingContext2D, w: number, h: number, data: OfficeSpend | null | undefined, o: SpendPaintOpts, plan?: PlanUsage | null) {
  const { font, mono } = o;
  g.fillStyle = "#15161f";
  g.fillRect(0, 0, w, h);
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.fillStyle = INK;
  g.font = `800 52px ${font}`;
  g.fillText("Uso de Claude", 44, 58);
  if (plan?.subscription) {
    g.fillStyle = DIM;
    g.font = `500 26px ${font}`;
    g.textAlign = "right";
    g.fillText(`plan ${plan.subscription[0].toUpperCase()}${plan.subscription.slice(1)}`, w - 44, 62);
    g.textAlign = "left";
  }
  const planW = o.big ? w * 0.55 : w - 88;
  let y = planRows(g, plan, 44, 116, planW, 92, font);

  // El gasto en dólares del registro local (runs de claude -p y tareas de Hermes).
  y = Math.max(y + 10, o.big ? 0 : 0);
  g.strokeStyle = "rgba(255,255,255,0.08)";
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(44, y);
  g.lineTo(o.big ? planW + 44 : w - 44, y);
  g.stroke();
  if (!data) {
    g.fillStyle = DIM;
    g.font = `500 26px ${font}`;
    g.fillText(data === null ? "Gasto: sin datos (el agente no respondió)." : "Gasto: cargando…", 44, y + 44);
    return;
  }
  const t = data.today.tokens;
  g.fillStyle = DIM;
  g.font = `500 24px ${font}`;
  g.fillText(`Gasto equivalente hoy · ${dayLabel(data.today.day)}`, 44, y + 36);
  g.fillStyle = BAR;
  g.font = `800 64px ${mono}`;
  g.fillText(formatUsd(data.today.costUsd), 44, y + 92);
  g.fillStyle = SOFT;
  g.font = `500 24px ${font}`;
  const runs = data.today.runs === 1 ? "1 ejecución" : `${data.today.runs} ejecuciones`;
  g.fillText(`${runs}${t ? ` · ${formatTokens(totalTokens(t))} tokens` : ""}`, 44, y + 144);
  // 7 días a la derecha del número (pared) o 30 abajo (monitor del CEO).
  if (!o.big) bars(g, data, 7, w * 0.5, y + 30, w * 0.5 - 44, Math.max(60, h - y - 130), font);
  else {
    bars(g, data, 30, 44, y + 190, planW, Math.max(80, h - y - 290), font);
    const px = w * 0.64;
    g.fillStyle = INK;
    g.font = `700 30px ${font}`;
    g.fillText("Por proyecto · 7 días", px, 130);
    if (data.byProject.week.length) rows(g, data.byProject.week, o.projectName, px, 180, w - px - 44, 5, font, mono);
    else {
      g.fillStyle = DIM;
      g.font = `500 24px ${font}`;
      g.fillText("Sin desglose todavía.", px, 182);
    }
    if (data.byModel?.week.length) {
      g.fillStyle = INK;
      g.font = `700 30px ${font}`;
      g.fillText("Por modelo · 7 días", px, 430);
      rows(g, data.byModel.week, (k) => k, px, 480, w - px - 44, 3, font, mono);
    }
    const live = data.live.filter((l) => l.spend);
    g.fillStyle = INK;
    g.font = `700 30px ${font}`;
    g.fillText("Ahora", px, 650);
    if (!live.length) {
      g.fillStyle = DIM;
      g.font = `500 24px ${font}`;
      g.fillText("Ningún agente con gasto reportado.", px, 698);
    }
    live.slice(0, 3).forEach((l, i) => {
      const ly = 698 + i * 44;
      g.fillStyle = SOFT;
      g.font = `500 26px ${font}`;
      g.fillText(fit(g, `${l.name} · ${o.projectName(l.project)}`, w - px - 230), px, ly);
      g.fillStyle = l.spend?.final ? GREEN : DIM;
      g.font = `600 24px ${mono}`;
      g.textAlign = "right";
      g.fillText(l.spend?.final ? formatUsd(l.spend.costUsd) : `${formatTokens(totalTokens(l.spend?.tokens))} tok`, w - 44, ly);
      g.textAlign = "left";
    });
  }
  g.fillStyle = "#6c7086";
  g.font = `500 20px ${font}`;
  g.fillText(
    data.since ? `% del plan: /usage de Claude · $: runs de claude -p y tareas de Hermes (desglose desde ${dayLabel(data.since)})` : "% del plan: /usage de Claude · $: runs de claude -p y tareas de Hermes",
    44,
    h - 28,
  );
}

/** El tablero de la pared (y, con `big`, el monitor del CEO). */
export class SpendBoard {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  private readonly canvas = document.createElement("canvas");
  private readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = "-";
  private data: OfficeSpend | null | undefined = undefined;
  private plan: PlanUsage | null | undefined = undefined;

  constructor(
    readonly spot: BoardSpot,
    private readonly opts: SpendPaintOpts,
    frame = "#1f2024",
  ) {
    const scale = opts.pxPerM ?? PX_PER_M;
    this.canvas.width = Math.round(spot.w * scale);
    this.canvas.height = Math.round(spot.h * scale);
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group.add(mesh(new THREE.BoxGeometry(spot.w + 0.12, spot.h + 0.12, 0.05), toon(frame), 0, 0, -0.02, false));
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.surface.position.z = 0.012;
    (this.surface.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.group.add(this.surface);
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.rotY;
    this.paint();
  }

  /** Uso del plan (GET /office/plan-usage): undefined = cargando, null = sin respuesta. */
  setPlan(plan: PlanUsage | null | undefined) {
    this.plan = plan;
    this.paint();
  }

  setData(data: OfficeSpend | null | undefined, projectName?: (slug: string) => string) {
    // Otro nombrador (llegaron los nombres del vault): repinta aunque los datos sean los mismos.
    if (projectName && projectName !== this.opts.projectName) {
      this.opts.projectName = projectName;
      this.key = "-";
    }
    this.data = data;
    this.paint();
  }

  private paint() {
    const d = this.data;
    // `fetchedAt` cambia en cada consulta: la clave es lo que se pinta.
    const p = this.plan;
    // El "Se restablece…" depende del día: la clave lleva la fecha local.
    const key = JSON.stringify([d === undefined ? "loading" : d && { ...d, fetchedAt: undefined }, p === undefined ? "loading" : p && { ...p, fetchedAt: undefined }, new Date().toDateString()]);
    if (key === this.key) return;
    this.key = key;
    paintSpend(this.ctx, this.canvas.width, this.canvas.height, d, this.opts, p);
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
