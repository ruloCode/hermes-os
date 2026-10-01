// Fábrica de minijuegos: un módulo por juego (darts, pingpong, foosball, basket, arcade).

import type { GameId } from "@hermes/shared";
import { ArcadeGame } from "./arcade";
import { BasketGame } from "./basket";
import { DartsGame } from "./darts";
import { FoosballGame } from "./foosball";
import { PingPongGame } from "./pingpong";
import type { GameCtx, MiniGame } from "./types";

export function createGame(id: GameId, ctx: GameCtx): MiniGame {
  switch (id) {
    case "darts":
      return new DartsGame(ctx);
    case "pingpong":
      return new PingPongGame(ctx);
    case "foosball":
      return new FoosballGame(ctx);
    case "basket":
      return new BasketGame(ctx);
    case "arcade":
      return new ArcadeGame(ctx);
  }
}

export { paintArcadeIdle } from "./arcade";
export type { GameEvent, GameHud, MiniGame } from "./types";
