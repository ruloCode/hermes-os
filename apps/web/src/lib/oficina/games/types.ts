// Contrato de los minijuegos de la azotea: cada uno vive en su módulo, dibuja
// en el mundo (coordenadas absolutas) y deja la física y el puntaje a la
// lógica pura de @hermes/shared (office-games.ts).

import type * as THREE from "three";
import type { GameId, GameInput } from "@hermes/shared";
import type { GameSpot, Room } from "../room";
import type { OfficePalette } from "../palette";

/** Lo que pasó en un frame (para el sonido): golpe, rebote, punto… */
export type GameEvent = "hit" | "wall" | "score" | "lose" | "throw" | "miss" | "over";

export interface GameHud {
  id: GameId;
  title: string;
  score: number;
  best: number | null;
  /** Una línea con el estado del juego ("Dardo 4 de 9 · Triple 20 · 60"). */
  status: string;
  /** 0..1 si el juego tiene un medidor (la fuerza de la canasta). */
  meter?: number;
  over: boolean;
}

export interface GameCtx {
  spot: GameSpot;
  room: Room;
  palette: OfficePalette;
  seed: number;
}

export interface MiniGame {
  readonly id: GameId;
  /** Lo que el juego agrega a la escena (se quita al salir). */
  readonly group: THREE.Group;
  /** Dónde va la cámara y a dónde mira (mundo). */
  readonly camera: { pos: THREE.Vector3; target: THREE.Vector3 };
  readonly score: number;
  readonly over: boolean;
  update(dt: number, input: GameInput): GameEvent | null;
  /** Estado para el HUD (sin el récord: lo pone el mundo). */
  hud(): Omit<GameHud, "best" | "id">;
  /** QA: lo de adentro del juego (la pelota en vuelo, la mira…). */
  debug?(): unknown;
  /** Otra partida (Espacio/A con la partida terminada). */
  restart(): void;
  dispose(): void;
}
