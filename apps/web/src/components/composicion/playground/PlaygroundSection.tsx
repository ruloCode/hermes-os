"use client";

/**
 * Sección PLAYGROUND de /composicion: sesiones (lista) → sesión → memo. La
 * gramática de la casa, contexto → lista → pieza, con Esc en cascada.
 */
import { usePlayground } from "./PlaygroundContext";
import { SessionsHome } from "./SessionsHome";
import { SessionView } from "./SessionView";

export function PlaygroundSection() {
  const { sessionId } = usePlayground();
  return sessionId ? <SessionView key={sessionId} id={sessionId} /> : <SessionsHome />;
}
