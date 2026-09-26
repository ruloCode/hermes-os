/**
 * GRABADORA DE TOMAS (AudioWorklet): junta el micrófono en lotes mono y los
 * manda al hilo principal con el `currentFrame` de su PRIMERA muestra. Con eso
 * se sabe en qué instante del reloj de audio cayó cada muestra grabada — el
 * mismo reloj que toca la pista —, así la toma queda alineada a la rejilla a
 * nivel de muestra (lib/loop-recorder.ts).
 *
 * Mensajes ↓: "stop" (vacía lo pendiente y responde "done").
 * Mensajes ↑: { type: "batch", frame, pcm (Float32Array transferido), peak }
 *             { type: "done" }
 */
const BATCH = 1024; // 8 cuantos de 128: ~21 ms a 48 kHz (el medidor no se ve a saltos)

class TakeRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BATCH);
    this.n = 0;
    this.frame = 0;
    this.peak = 0;
    this.stopped = false;
    this.port.onmessage = (e) => {
      if (e.data === "stop" && !this.stopped) {
        this.flush();
        this.stopped = true;
        this.port.postMessage({ type: "done" });
      }
    };
  }

  flush() {
    if (this.n === 0) return;
    const pcm = this.buf.slice(0, this.n);
    this.port.postMessage({ type: "batch", frame: this.frame, pcm, peak: this.peak }, [pcm.buffer]);
    this.n = 0;
    this.peak = 0;
  }

  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    // Sin entrada todavía (el micrófono tarda en arrancar): nada que guardar.
    if (!input || input.length === 0 || !input[0]) return true;
    const len = input[0].length;
    if (this.n === 0) this.frame = currentFrame;
    const chans = input.length;
    for (let i = 0; i < len; i++) {
      let v = 0;
      for (let c = 0; c < chans; c++) v += input[c][i];
      v /= chans;
      this.buf[this.n + i] = v;
      const a = v < 0 ? -v : v;
      if (a > this.peak) this.peak = a;
    }
    this.n += len;
    if (this.n + len > BATCH) this.flush();
    return true;
  }
}

registerProcessor("take-recorder", TakeRecorder);
