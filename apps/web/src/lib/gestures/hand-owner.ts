// Dueño ÚNICO de las manos: el tracking de la UI (UiHandsProvider) y el del
// grafo 3D (CodeGraph3D) usan la misma webcam y la misma pinza — dos motores
// interpretando el mismo gesto = doble acción. Quien arranca reclama y apaga
// al anterior; sin listeners ni contexto: un singleton de módulo basta.

let owner: { name: string; stop: () => void } | null = null;

/** Reclama las manos: apaga al dueño anterior (si es otro) y se registra. */
export function claimHands(name: string, stop: () => void): void {
  if (owner && owner.name !== name) owner.stop();
  owner = { name, stop };
}

/** Suelta las manos (solo si sigues siendo el dueño). */
export function releaseHands(name: string): void {
  if (owner?.name === name) owner = null;
}
