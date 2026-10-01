// "Lluvia de tokens" en la pantalla de la máquina arcade (diseño propio): un
// cursor de terminal abajo, del cielo caen tokens verdes (+1) y bugs rojos
// (−1 vida). La lógica es stepRain (shared/office-games.ts); aquí solo se
// pinta en el canvas de la máquina. Sin jugar, la pantalla muestra el título y
// el récord REAL de este navegador (o que no hay récord).

import * as THREE from "three";
import { newRain, stepRain, type GameInput, type RainState } from "@hermes/shared";
import type { ArcadeScreen } from "../room";
import type { GameCtx, GameEvent, MiniGame } from "./types";

const BG = "#0b1020";

function header(g: CanvasRenderingContext2D, w: number) {
  g.fillStyle = "#6ccb8f";
  g.font = "700 30px ui-monospace, Menlo, monospace";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("LLUVIA DE TOKENS", w / 2, 44);
}

/** La espera de la máquina: título, el récord real (o ninguno) y cómo jugar. */
export function paintArcadeIdle(scr: ArcadeScreen, best: number | null) {
  const g = scr.ctx;
  const { width: w, height: h } = scr.canvas;
  g.fillStyle = BG;
  g.fillRect(0, 0, w, h);
  header(g, w);
  // Unos tokens y bugs quietos de adorno (no son datos).
  for (let i = 0; i < 9; i++) {
    g.fillStyle = i % 3 === 0 ? "#f07070" : "#6ccb8f";
    g.fillRect(40 + ((i * 97) % (w - 80)), 90 + ((i * 53) % 150), 14, 14);
  }
  g.fillStyle = "#f4f1ea";
  g.font = "600 28px ui-monospace, Menlo, monospace";
  g.fillText(best !== null ? `RÉCORD  ${best}` : "SIN RÉCORD TODAVÍA", w / 2, 290);
  g.fillStyle = "#9aa3b2";
  g.font = "500 22px ui-monospace, Menlo, monospace";
  g.fillText("acércate y presiona E / A", w / 2, 340);
  g.textAlign = "left";
  scr.tex.needsUpdate = true;
}

export class ArcadeGame implements MiniGame {
  readonly id = "arcade" as const;
  readonly group = new THREE.Group();
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  private s: RainState;
  private paintedAt = 0;
  private readonly scr: ArcadeScreen;

  constructor(private readonly ctx: GameCtx) {
    const a = ctx.spot.anchor;
    // La pantalla mira a −x: la cámara se para enfrente, un poco arriba.
    this.camera = { pos: new THREE.Vector3(a.x - 1.2, a.y + 0.1, a.z), target: new THREE.Vector3(a.x, a.y - 0.08, a.z) };
    this.scr = ctx.room.arcadeScreen;
    this.s = newRain(ctx.seed);
    this.paint();
  }

  get score() {
    return this.s.score;
  }
  get over() {
    return this.s.over;
  }

  update(dt: number, input: GameInput): GameEvent | null {
    const was = this.s;
    this.s = stepRain(this.s, dt, input);
    const now = performance.now();
    // 30 cuadros por segundo bastan para la pantalla (es una textura que se sube a la GPU).
    if (now - this.paintedAt > 33) {
      this.paintedAt = now;
      this.paint();
    }
    if (this.s.over && !was.over) return "over";
    return this.s.event === "catch" ? "score" : this.s.event === "bug" ? "lose" : null;
  }

  private paint() {
    const g = this.scr.ctx;
    const { width: w, height: h } = this.scr.canvas;
    const s = this.s;
    g.fillStyle = BG;
    g.fillRect(0, 0, w, h);
    header(g, w);
    g.textAlign = "left";
    g.fillStyle = "#f4f1ea";
    g.font = "600 22px ui-monospace, Menlo, monospace";
    g.fillText(`TOKENS ${s.score}`, 20, 84);
    g.textAlign = "right";
    g.fillStyle = "#f07070";
    g.fillText("♥".repeat(s.lives) + "·".repeat(Math.max(0, 3 - s.lives)), w - 20, 84);
    g.textAlign = "left";
    const top = 104;
    const ph = h - top - 10;
    for (const it of s.items) {
      const x = it.x * w;
      const y = top + it.y * ph;
      if (it.bug) {
        g.fillStyle = "#f07070";
        g.fillRect(x - 9, y - 7, 18, 14);
        g.fillRect(x - 13, y - 3, 4, 2);
        g.fillRect(x + 9, y - 3, 4, 2);
      } else {
        g.fillStyle = "#6ccb8f";
        g.beginPath();
        g.arc(x, y, 8, 0, Math.PI * 2);
        g.fill();
      }
    }
    // El cursor: un bloque de terminal.
    g.fillStyle = "#f4f1ea";
    g.fillRect(s.cursor * w - 0.06 * w, top + 0.92 * ph - 6, 0.12 * w, 12);
    if (s.over) {
      g.fillStyle = "rgba(11,16,32,0.8)";
      g.fillRect(0, h / 2 - 50, w, 100);
      g.fillStyle = "#f4f1ea";
      g.textAlign = "center";
      g.font = "700 30px ui-monospace, Menlo, monospace";
      g.fillText(`FIN · ${s.score} TOKENS`, w / 2, h / 2 - 8);
      g.font = "500 20px ui-monospace, Menlo, monospace";
      g.fillText("Espacio / A: otra · Esc / B: salir", w / 2, h / 2 + 26);
      g.textAlign = "left";
    }
    this.scr.tex.needsUpdate = true;
  }

  hud() {
    const s = this.s;
    return {
      title: "Lluvia de tokens",
      score: s.score,
      status: s.over ? `Fin de la partida · ${s.score} tokens` : `Vidas ${s.lives} · nivel ${Math.floor(s.score / 10) + 1}`,
      over: s.over,
    };
  }

  restart() {
    this.s = newRain(this.ctx.seed + Math.floor(performance.now()));
  }

  dispose() {
    this.group.removeFromParent();
  }
}
