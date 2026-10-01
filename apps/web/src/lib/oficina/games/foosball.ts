// Futbolín contra la CPU: tus varillas son las rojas (atacas hacia +x). Subir
// y bajar = deslizar las varillas a lo ancho; la acción las gira y patea. La
// física es stepFoos (shared/office-games.ts). Mientras juegas, las varillas de
// adorno de la mesa se esconden y aparecen estas, que sí se mueven. Se acaba
// cuando el rival te mete 3; tu puntaje son tus goles.

import * as THREE from "three";
import { FOOS, FOOS_RODS, newFoos, stepFoos, type FoosState, type GameInput } from "@hermes/shared";
import { mesh, toon } from "../toon";
import type { GameCtx, GameEvent, MiniGame } from "./types";

function rod(men: readonly number[], color: string): THREE.Group {
  const g = new THREE.Group();
  const bar = mesh(new THREE.CylinderGeometry(0.01, 0.01, FOOS.W + 0.5, 8), toon("#c9ced6"), 0, 0, 0, false);
  bar.rotation.x = Math.PI / 2;
  g.add(bar);
  for (const m of men) {
    g.add(mesh(new THREE.BoxGeometry(0.04, 0.1, 0.03), toon(color), 0, -0.05, m, false));
    g.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), toon("#f1c27d"), 0, 0.015, m, false));
  }
  return g;
}

export class FoosballGame implements MiniGame {
  readonly id = "foosball" as const;
  readonly group = new THREE.Group();
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  private s: FoosState;
  private readonly field: THREE.Vector3;
  private readonly yours: THREE.Group[];
  private readonly theirs: THREE.Group[];
  private readonly ball = mesh(new THREE.SphereGeometry(FOOS.ballR, 12, 10), toon("#ffffff"), 0, 0, 0, false);

  constructor(private readonly ctx: GameCtx) {
    const a = ctx.spot.anchor;
    this.field = new THREE.Vector3(a.x, a.y, a.z);
    // Desde tu lado (+z), mirando la mesa: atacas hacia la derecha de la pantalla.
    this.camera = { pos: new THREE.Vector3(a.x, a.y + 1.05, a.z + 1.0), target: new THREE.Vector3(a.x, a.y, a.z - 0.05) };
    this.s = newFoos(ctx.seed);
    this.yours = FOOS_RODS.you.map((r) => rod(r.men, "#e63946"));
    this.theirs = FOOS_RODS.cpu.map((r) => rod(r.men, "#3a86ff"));
    this.group.add(...this.yours, ...this.theirs, this.ball);
    this.place();
  }

  get score() {
    return this.s.scoreYou;
  }
  get over() {
    return this.s.over;
  }

  update(dt: number, input: GameInput): GameEvent | null {
    this.s = stepFoos(this.s, dt, input);
    this.place();
    const e = this.s.event;
    if (this.s.over && e === "goal-cpu") return "over";
    return e === "kick" ? "hit" : e === "wall" ? "wall" : e === "goal-you" ? "score" : e === "goal-cpu" ? "lose" : null;
  }

  private place() {
    const f = this.field;
    const s = this.s;
    const rodY = f.y + 0.13;
    FOOS_RODS.you.forEach((r, i) => {
      const g = this.yours[i];
      g.position.set(f.x + r.x, rodY, f.z + s.you);
      // Patada: la varilla gira hacia adelante (+x) y vuelve.
      g.rotation.z = s.kick > 0 ? -Math.sin((1 - s.kick / 0.25) * Math.PI) * 1.3 : 0;
    });
    FOOS_RODS.cpu.forEach((r, i) => {
      const g = this.theirs[i];
      g.position.set(f.x + r.x, rodY, f.z + s.cpu);
      g.rotation.z = s.cpuKick > 0.3 ? Math.sin(((0.5 - s.cpuKick) / 0.2) * Math.PI) * 1.3 : 0;
    });
    this.ball.position.set(f.x + s.ball.x, f.y + FOOS.ballR, f.z + s.ball.z);
  }

  hud() {
    const s = this.s;
    return {
      title: "Futbolín",
      score: s.scoreYou,
      status: s.over ? `Fin · metiste ${s.scoreYou} ${s.scoreYou === 1 ? "gol" : "goles"}` : `Rojos ${s.scoreYou} · azules ${s.scoreCpu} de ${FOOS.lose}`,
      over: s.over,
    };
  }

  restart() {
    this.s = newFoos(this.ctx.seed + Math.floor(performance.now()));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}
