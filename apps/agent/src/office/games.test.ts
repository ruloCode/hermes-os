import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BASKET,
  DART_RINGS,
  FOOS,
  FOOS_RODS,
  NO_INPUT,
  PONG,
  basketCharge,
  dartAim,
  dartScore,
  newFoos,
  newPong,
  newRain,
  simulateBasket,
  stepFoos,
  stepPong,
  stepRain,
  type FoosState,
  type GameInput,
  type PongState,
} from "@hermes/shared";

const input = (o: Partial<GameInput> = {}): GameInput => ({ ...NO_INPUT, ...o });

describe("minijuegos de la azotea", () => {
  it("dardos: el puntaje sale del sector y el anillo reales", () => {
    assert.equal(dartScore(0, 0).points, 50);
    assert.equal(dartScore(0, 0.09).points, 25);
    assert.equal(dartScore(0, 0.4).points, 20, "arriba es el 20");
    const triple = (DART_RINGS.tripleIn + DART_RINGS.tripleOut) / 2;
    assert.deepEqual(dartScore(0, triple), { points: 60, label: "Triple 20 · 60" });
    assert.equal(dartScore(0, 0.96).points, 40, "doble 20");
    assert.equal(dartScore(0.4, 0).points, 6, "a la derecha está el 6");
    assert.equal(dartScore(0, -0.4).points, 3, "abajo está el 3");
    assert.equal(dartScore(0.8, 0.8).points, 0, "fuera de la diana");
  });

  it("dardos: la mira oscila alrededor de donde apuntas, sin alejarse más del pulso", () => {
    for (let t = 0; t < 10; t += 0.13) {
      const a = dartAim(t, { x: 0.2, y: -0.1 }, 0.3);
      assert.ok(Math.hypot(a.x - 0.2, a.y + 0.1) <= 0.3 * Math.SQRT2 + 1e-9);
    }
  });

  it("canasta: un tiro débil se queda corto y existe un tiro que entra", () => {
    const short = simulateBasket(45, 0);
    assert.equal(short.made, false);
    assert.ok(short.x < BASKET.distance);
    let made = 0;
    for (let a = 30; a <= 70; a += 5) for (let p = 0; p <= 1; p += 0.02) if (simulateBasket(a, p).made) made++;
    assert.ok(made > 0, "algún ángulo y fuerza encestan");
  });

  it("canasta: todo tiro termina (un roce del borde no queda rebotando)", () => {
    for (let a = 25; a <= 75; a += 2.5) for (let p = 0; p <= 1; p += 0.01) assert.equal(simulateBasket(a, p, 1 / 60 / 4).done, true, `${a}° · ${p}`);
  });

  it("canasta: la fuerza se carga y descarga en ciclo", () => {
    assert.equal(basketCharge(0), 0);
    assert.ok(Math.abs(basketCharge(1.2) - 1) < 1e-9);
    assert.ok(Math.abs(basketCharge(1.8) - 0.5) < 1e-9);
  });

  it("ping-pong: la raqueta devuelve la pelota y fallar le da el punto al rival", () => {
    let s = newPong(1);
    s.serve = 0;
    s.ball = { x: -PONG.L / 2 + 0.01, z: 0, vx: -2, vz: 0 };
    s = stepPong(s, 1 / 60, input());
    assert.equal(s.event, "hit");
    assert.ok(s.ball.vx > 0);
    s = { ...newPong(1), serve: 0, you: 0.5, ball: { x: -PONG.L / 2 + 0.01, z: -0.5, vx: -2, vz: 0 } };
    s = stepPong(s, 1 / 60, input());
    assert.equal(s.event, "point-cpu");
    assert.equal(s.scoreCpu, 1);
  });

  it("ping-pong: la partida termina cuando el rival llega a 3", () => {
    let s = newPong(3);
    let steps = 0;
    // Sin moverse, la raqueta queda al centro y pierde los saques cruzados tarde o temprano.
    while (!s.over && steps++ < 60 * 600) s = stepPong(s, 1 / 60, input({ y: 1 }));
    assert.ok(s.over);
    assert.equal(s.scoreCpu, PONG.lose);
  });

  it("ping-pong: el rival no se teletransporta (velocidad tope)", () => {
    let s: PongState = { ...newPong(1), serve: 0, ball: { x: 0, z: 0.6, vx: 1, vz: 0 } };
    s = stepPong(s, 0.1, input());
    assert.ok(Math.abs(s.cpu) <= PONG.cpuSpeed * 0.1 + 1e-9);
  });

  it("futbolín: patear con el muñeco alineado manda la pelota al arco rival", () => {
    const rod = FOOS_RODS.you[1];
    let s: FoosState = { ...newFoos(1), serve: 0, ball: { x: rod.x + 0.01, z: rod.men[1], vx: 0, vz: 0 } };
    s = stepFoos(s, 1 / 60, input({ pressed: true, action: true }));
    assert.equal(s.event, "kick");
    assert.ok(s.ball.vx > 0);
  });

  it("futbolín: entrar por la boca del arco es gol; por fuera, rebote", () => {
    let s: FoosState = { ...newFoos(1), serve: 0, ball: { x: FOOS.L / 2 - 0.03, z: 0, vx: 2, vz: 0 } };
    s = stepFoos(s, 1 / 60, input());
    assert.equal(s.event, "goal-you");
    assert.equal(s.scoreYou, 1);
    s = { ...newFoos(1), serve: 0, ball: { x: FOOS.L / 2 - 0.03, z: 0.3, vx: 2, vz: 0 } };
    s = stepFoos(s, 1 / 60, input());
    assert.notEqual(s.event, "goal-you");
    assert.ok(s.ball.vx < 0);
  });

  it("futbolín: una pelota quieta no se duerme entre varillas y, sin jugar, la CPU gana", () => {
    let s: FoosState = { ...newFoos(5), serve: 0, ball: { x: 0.0, z: 0.3, vx: 0, vz: 0 } };
    for (let i = 0; i < 60 * 4; i++) s = stepFoos(s, 1 / 60, input());
    assert.ok(Math.abs(s.ball.x) > 0.02 || s.event !== "", "la pendiente la mueve hacia una varilla");
    let idle = newFoos(3);
    for (let i = 0; i < 60 * 300 && !idle.over; i++) idle = stepFoos(idle, 1 / 60, input());
    assert.equal(idle.over, true);
    assert.equal(idle.scoreCpu, FOOS.lose);
  });

  it("lluvia de tokens: atrapar suma, un bug quita vida y a las 0 termina", () => {
    let s = newRain(7);
    s.items = [{ x: 0.5, y: 0.9, bug: false, v: 0.3 }];
    s.nextSpawn = 99;
    s = stepRain(s, 1 / 60, input());
    assert.equal(s.score, 1);
    s.items = [{ x: 0.5, y: 0.9, bug: true, v: 0.3 }];
    s.lives = 1;
    s = stepRain(s, 1 / 60, input());
    assert.equal(s.lives, 0);
    assert.equal(s.over, true);
  });

  it("lluvia de tokens: misma semilla, misma partida", () => {
    const run = () => {
      let s = newRain(42);
      for (let i = 0; i < 600; i++) s = stepRain(s, 1 / 60, input({ x: Math.sin(i / 30) }));
      return [s.score, s.lives, s.items.length];
    };
    assert.deepEqual(run(), run());
  });
});
