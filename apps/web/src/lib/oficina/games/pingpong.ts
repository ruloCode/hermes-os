// Ping-pong contra la CPU en la mesa de la azotea: un pong 3D simple. La
// física y el rival son stepPong (shared/office-games.ts); aquí se pintan las
// dos raquetas y la pelota (con su bote, que es solo visual). Juegas desde la
// punta oeste; se acaba cuando el rival te gana 3 puntos. Tu puntaje: los
// puntos que le ganas.

import * as THREE from "three";
import { PONG, newPong, stepPong, type GameInput, type PongState } from "@hermes/shared";
import { mesh, toon } from "../toon";
import type { GameCtx, GameEvent, MiniGame } from "./types";

function paddle(color: string): THREE.Group {
  const g = new THREE.Group();
  const face = mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.016, 18), toon(color), 0, 0, 0, false);
  face.rotation.z = Math.PI / 2;
  g.add(face);
  g.add(mesh(new THREE.BoxGeometry(0.03, 0.12, 0.03), toon("#c98b5a"), 0, -0.12, 0, false));
  return g;
}

export class PingPongGame implements MiniGame {
  readonly id = "pingpong" as const;
  readonly group = new THREE.Group();
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  private s: PongState;
  private readonly you = paddle("#e63946");
  private readonly cpu = paddle("#2b2d42");
  private readonly ball = mesh(new THREE.SphereGeometry(0.024, 12, 10), toon("#ff9f1c"), 0, 0, 0, false);
  private readonly top: THREE.Vector3;
  private travel = 0;

  constructor(private readonly ctx: GameCtx) {
    const a = ctx.spot.anchor;
    this.top = new THREE.Vector3(a.x, a.y, a.z);
    // Detrás de tu punta de la mesa, mirando hacia el rival.
    this.camera = { pos: new THREE.Vector3(a.x - 2.5, a.y + 1.15, a.z), target: new THREE.Vector3(a.x + 0.35, a.y, a.z) };
    this.s = newPong(ctx.seed);
    this.group.add(this.you, this.cpu, this.ball);
    this.place();
  }

  get score() {
    return this.s.scoreYou;
  }
  get over() {
    return this.s.over;
  }

  update(dt: number, input: GameInput): GameEvent | null {
    // Desde tu punta, la derecha de la pantalla es +z: ← → (o el stick) mueven la raqueta.
    const prev = this.s.ball;
    this.s = stepPong(this.s, dt, { ...input, y: -input.x });
    this.travel += Math.hypot(this.s.ball.x - prev.x, this.s.ball.z - prev.z);
    this.place();
    const e = this.s.event;
    if (this.s.over && e === "point-cpu") return "over";
    return e === "hit" ? "hit" : e === "wall" ? "wall" : e === "point-you" ? "score" : e === "point-cpu" ? "lose" : null;
  }

  private place() {
    const t = this.top;
    const s = this.s;
    this.you.position.set(t.x - PONG.L / 2 - 0.06, t.y + 0.13, t.z + s.you);
    this.cpu.position.set(t.x + PONG.L / 2 + 0.06, t.y + 0.13, t.z + s.cpu);
    // Un bote cada ~0,9 m recorridos: solo visual, la física es plana.
    const h = 0.03 + Math.abs(Math.sin((this.travel / 0.9) * Math.PI)) * 0.2;
    this.ball.position.set(t.x + s.ball.x, t.y + (s.serve > 0 ? 0.25 : h), t.z + s.ball.z);
  }

  hud() {
    const s = this.s;
    return {
      title: "Ping-pong",
      score: s.scoreYou,
      status: s.over ? `Fin · le ganaste ${s.scoreYou} ${s.scoreYou === 1 ? "punto" : "puntos"}` : `Tú ${s.scoreYou} · rival ${s.scoreCpu} de ${PONG.lose} · peloteo ${s.rally}`,
      over: s.over,
    };
  }

  restart() {
    this.s = newPong(this.ctx.seed + Math.floor(performance.now()));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}
