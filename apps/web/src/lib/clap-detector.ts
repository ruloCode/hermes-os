/**
 * Detector de DOBLE APLAUSO sobre picos de amplitud del micrófono.
 *
 * Lógica pura (sin WebAudio ni DOM) para poder ejercitarla con picos
 * sintéticos — mismo patrón que gestures/engine.ts. El hook que la alimenta
 * lee el AnalyserNode a ~60 fps y pasa el pico absoluto de cada frame.
 *
 * Un "aplauso" es un transitorio: pico por encima del umbral (piso de ruido
 * adaptativo × ratio, con un mínimo absoluto) tras un hueco refractario —
 * así el ring de un solo aplauso (~50-150 ms) no cuenta dos veces. Dos
 * aplausos con separación humana (180-700 ms) disparan el callback y abren
 * un cooldown para no re-disparar con el eco.
 */

export interface ClapDetectorOptions {
  onDoubleClap: () => void;
  /** Pico mínimo absoluto (0-1) para contar un aplauso. */
  minPeak?: number;
  /** El umbral es max(minPeak, piso de ruido × floorRatio). */
  floorRatio?: number;
  /** Separación mínima entre los DOS aplausos (ms). */
  minGapMs?: number;
  /** Separación máxima entre los DOS aplausos (ms). */
  maxGapMs?: number;
  /** Silencio obligado tras disparar (ms). */
  cooldownMs?: number;
}

export interface ClapDetector {
  /** Alimenta el pico absoluto (0-1) del frame actual. */
  feed(peak: number, nowMs: number): void;
  /** Piso de ruido actual (QA/depuración). */
  noiseFloor(): number;
}

export function createClapDetector(opts: ClapDetectorOptions): ClapDetector {
  const minPeak = opts.minPeak ?? 0.28;
  const floorRatio = opts.floorRatio ?? 5;
  const minGapMs = opts.minGapMs ?? 180;
  const maxGapMs = opts.maxGapMs ?? 700;
  const cooldownMs = opts.cooldownMs ?? 1600;
  // El ring de un aplauso dura ~150 ms: dentro de esa ventana todo pico es
  // el MISMO aplauso.
  const refractoryMs = 150;

  let floor = 0.02;
  let firstClapAt: number | null = null;
  let lastClapAt = -Infinity;
  let firedAt = -Infinity;

  return {
    feed(peak: number, nowMs: number) {
      const threshold = Math.max(minPeak, floor * floorRatio);
      // El piso solo aprende de frames tranquilos: un aplauso (o música dura)
      // no debe subirlo al vuelo.
      if (peak < threshold * 0.5) floor = floor * 0.95 + peak * 0.05;

      if (nowMs - firedAt < cooldownMs) return;
      if (peak < threshold) return;
      if (nowMs - lastClapAt < refractoryMs) {
        lastClapAt = nowMs;
        return;
      }
      lastClapAt = nowMs;

      const gap = firstClapAt == null ? null : nowMs - firstClapAt;
      if (gap != null && gap >= minGapMs && gap <= maxGapMs) {
        firstClapAt = null;
        firedAt = nowMs;
        opts.onDoubleClap();
        return;
      }
      // Muy tarde (o primer aplauso): este pico abre una ventana nueva.
      firstClapAt = nowMs;
    },
    noiseFloor: () => floor,
  };
}
