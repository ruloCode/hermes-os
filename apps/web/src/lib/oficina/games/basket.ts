// Canasta: lanzar pelotas a la cesta del rincón de juegos. ↑ ↓ cambian el
// ángulo; mantener la acción carga la fuerza (sube y baja) y soltar lanza. La
// trayectoria es stepBall (shared/office-games.ts): entra si cruza el aro
// bajando por dentro; si toca el borde, rebota. 10 pelotas.

import * as THREE from "three";
import { BASKET, basketCharge, basketThrow, stepBall, type BallFlight, type GameInput } from "@hermes/shared";
import { mesh, toon } from "../toon";
import type { GameCtx, GameEvent, MiniGame } from "./types";

export class BasketGame implements MiniGame {
  readonly id = "basket" as const;
  readonly group = new THREE.Group();
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  private readonly origin: THREE.Vector3;
  private angle = 50;
  private charging = false;
  private held = 0;
  private power = 0;
  private flight: BallFlight | null = null;
  private landedAt = 0;
  private thrown = 0;
  private made = 0;
  private last = "";
  private finished = false;
  private readonly ball = mesh(new THREE.SphereGeometry(BASKET.ballR, 12, 10), toon("#ff9f1c"), 0, 0, 0, false);
  private readonly arrow = new THREE.Group();

  constructor(ctx: GameCtx) {
    const a = ctx.spot.anchor;
    // La cesta está hacia −x del dueño, a BASKET.distance.
    this.origin = new THREE.Vector3(a.x + BASKET.distance, a.y - BASKET.rimH, a.z);
    this.camera = { pos: new THREE.Vector3(this.origin.x + 1.3, this.origin.y + 1.9, a.z + 1.1), target: new THREE.Vector3(a.x + 0.6, a.y + 0.3, a.z) };
    const shaft = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 8), toon("#ffffff"), 0, 0.25, 0, false);
    const tip = mesh(new THREE.ConeGeometry(0.035, 0.08, 10), toon("#ffffff"), 0, 0.54, 0, false);
    this.arrow.add(shaft, tip);
    this.arrow.position.set(this.origin.x, this.origin.y + BASKET.releaseH, this.origin.z);
    this.group.add(this.arrow, this.ball);
    this.ball.visible = false;
  }

  get score() {
    return this.made;
  }
  get over() {
    return this.finished;
  }

  update(dt: number, input: GameInput): GameEvent | null {
    let ev: GameEvent | null = null;
    if (!this.flight && !this.finished) {
      this.angle = Math.max(25, Math.min(75, this.angle + input.y * 30 * dt));
      if (input.action) {
        if (!this.charging) {
          this.charging = true;
          this.held = 0;
        }
        this.held += dt;
        this.power = basketCharge(this.held);
      } else if (this.charging) {
        this.charging = false;
        this.flight = basketThrow(this.angle, this.power);
        this.thrown += 1;
        this.ball.visible = true;
        ev = "throw";
      }
    }
    // La flecha apunta en el plano del tiro (hacia −x), inclinada según el ángulo.
    this.arrow.rotation.z = (90 - this.angle) * (Math.PI / 180);
    this.arrow.visible = !this.flight && !this.finished;
    if (this.flight) {
      // Pasos finos: la pelota es chica y el aro también.
      for (let i = 0; i < 4 && !this.flight.done; i++) this.flight = stepBall(this.flight, dt / 4);
      const f = this.flight;
      this.ball.position.set(this.origin.x - f.x, this.origin.y + f.y, this.origin.z);
      if (f.done) {
        if (!this.landedAt) {
          this.landedAt = performance.now();
          if (f.made) this.made += 1;
          this.last = f.made ? "¡Adentro!" : f.rim ? "Tocó el borde" : f.x < BASKET.distance ? "Corta" : "Larga";
          ev = f.made ? "score" : "miss";
          if (this.thrown >= BASKET.balls) {
            this.finished = true;
            ev = f.made ? "score" : "over";
          }
        } else if (performance.now() - this.landedAt > 600) {
          this.flight = null;
          this.landedAt = 0;
          this.ball.visible = false;
          this.power = 0;
        }
      }
    }
    return ev;
  }

  debug() {
    return { flight: this.flight, angle: this.angle, power: this.power, charging: this.charging, ball: this.ball.position.toArray() };
  }

  hud() {
    return {
      title: "Canasta",
      score: this.made,
      status: this.finished
        ? `Fin · ${this.made} de ${BASKET.balls} adentro`
        : `Pelota ${Math.min(this.thrown + 1, BASKET.balls)} de ${BASKET.balls} · ángulo ${Math.round(this.angle)}°${this.last ? ` · ${this.last}` : ""}`,
      meter: this.charging || this.flight ? this.power : 0,
      over: this.finished,
    };
  }

  restart() {
    this.thrown = 0;
    this.made = 0;
    this.last = "";
    this.finished = false;
    this.flight = null;
    this.landedAt = 0;
    this.ball.visible = false;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.group.removeFromParent();
  }
}
