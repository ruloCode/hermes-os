/**
 * Filtro One Euro (Casiez et al. 2012): el estándar para suavizar punteros
 * con tracking ruidoso. La gracia sobre un low-pass fijo: el corte se adapta
 * a la velocidad — mano quieta = mucho suavizado (cero jitter apuntando a un
 * botón), mano rápida = poco suavizado (cero lag percibido al cruzar la
 * pantalla). Sin esto, el cursor por cámara es inusable: tiembla en reposo o
 * arrastra medio segundo de retraso.
 */

class LowPass {
  private y: number | null = null;

  filter(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  reset(): void {
    this.y = null;
  }
}

function alpha(cutoff: number, dtSec: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dtSec);
}

export class OneEuroFilter {
  private readonly x = new LowPass();
  private readonly dx = new LowPass();
  private lastT: number | null = null;
  private lastX: number | null = null;

  constructor(
    /** Corte mínimo (Hz): más bajo = más suave en reposo. */
    private readonly minCutoff = 1.2,
    /** Cuánto sube el corte con la velocidad: más alto = menos lag al moverse. */
    private readonly beta = 0.02,
    /** Corte del estimador de velocidad (dejar en 1). */
    private readonly dCutoff = 1.0,
  ) {}

  filter(value: number, tMs: number): number {
    if (this.lastT === null || this.lastX === null) {
      this.lastT = tMs;
      this.lastX = value;
      this.x.filter(value, 1);
      this.dx.filter(0, 1);
      return value;
    }
    const dt = Math.max((tMs - this.lastT) / 1000, 1e-3);
    this.lastT = tMs;

    const rawVelocity = (value - this.lastX) / dt;
    this.lastX = value;
    const velocity = this.dx.filter(rawVelocity, alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(velocity);
    return this.x.filter(value, alpha(cutoff, dt));
  }

  reset(): void {
    this.x.reset();
    this.dx.reset();
    this.lastT = null;
    this.lastX = null;
  }
}
