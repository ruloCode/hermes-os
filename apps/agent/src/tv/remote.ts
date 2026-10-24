import { execFileSync, spawnSync } from "node:child_process";
import { closeSync, constants, openSync, read, writeSync } from "node:fs";
import { parseRemoteLine } from "./plan.js";

/**
 * Enlace con la ESP32 que hace de control Bluetooth de la TV
 * (hermes-tv/firmware/control-tv), conectada por USB a esta Mac.
 *
 * Sin dependencias: el puerto se abre NO bloqueante y se lee por sondeo cada
 * 40 ms. Una lectura bloqueante (createReadStream) ocuparía un hilo del pool
 * de libuv para siempre, y cerrar el fd con esa lectura colgada no la libera.
 * `stty` se corre con el puerto YA abierto como stdin: en macOS la config de
 * un tty se pierde cuando se cierra el último descriptor, así que `stty -f`
 * suelto no sirve.
 *
 * Puerto: HERMES_TV_REMOTE_PORT, o se detecta entre las placas Espressif
 * conectadas (espressifPorts) preguntándole `status` a cada una — solo el
 * firmware del control contesta "ble=…" (los nodos de RuloView también son
 * ESP32 y no lo hacen).
 */

type Result = { ok: true; detail: string } | { ok: false; error: string };

const POLL_MS = 40;

class Port {
  private buf = "";
  private timer: NodeJS.Timeout;
  private listeners = new Set<(line: string) => void>();
  private chunk = Buffer.alloc(4096);
  closed = false;

  constructor(readonly path: string, private fd: number) {
    this.timer = setInterval(() => this.poll(), POLL_MS);
    this.timer.unref();
  }

  static open(path: string): Port {
    const fd = openSync(path, constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK);
    // stty abre el puerto POR SU CUENTA (su propia descripción de archivo):
    // pasarle nuestro fd como stdin hace que libuv lo deje bloqueante en el
    // hijo — y O_NONBLOCK es de la descripción compartida, así que la lectura
    // de aquí quedaba colgada para siempre. Como este fd sigue abierto, la
    // config del tty sobrevive al cierre del de stty.
    const r = spawnSync("/bin/sh", ["-c", 'exec /bin/stty raw -echo 115200 < "$0"', path], { stdio: ["ignore", "ignore", "pipe"] });
    if (r.status !== 0) {
      closeSync(fd);
      throw new Error(`stty falló en ${path}: ${r.stderr?.toString().trim() || r.status}`);
    }
    return new Port(path, fd);
  }

  private poll(): void {
    if (this.closed) return;
    read(this.fd, this.chunk, 0, this.chunk.length, null, (err, n) => {
      if (err) {
        // EAGAIN = no hay nada que leer; cualquier otro = la placa se desconectó.
        if ((err as NodeJS.ErrnoException).code !== "EAGAIN") this.close();
        return;
      }
      if (n === 0) return;
      this.buf += this.chunk.subarray(0, n).toString("utf8");
      let i: number;
      while ((i = this.buf.search(/\r?\n/)) >= 0) {
        const line = this.buf.slice(0, i);
        this.buf = this.buf.slice(this.buf[i] === "\r" ? i + 2 : i + 1);
        for (const l of this.listeners) l(line);
      }
      if (this.buf.length > 8192) this.buf = "";
    });
  }

  write(line: string): void {
    writeSync(this.fd, `${line}\n`);
  }

  /** Espera la primera línea que `match` acepte (o null al vencer el plazo). */
  waitFor<T>(match: (line: string) => T | null, timeoutMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const done = (v: T | null) => {
        clearTimeout(t);
        this.listeners.delete(on);
        resolve(v);
      };
      const on = (line: string) => {
        const v = match(line);
        if (v !== null) done(v);
      };
      const t = setTimeout(() => done(null), timeoutMs);
      this.listeners.add(on);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    try {
      closeSync(this.fd);
    } catch {
      /* ya cerrado */
    }
  }
}

/**
 * Solo los puertos de la USB nativa de Espressif ("USB JTAG/serial debug unit",
 * la de la ESP32-S3): un teléfono enchufado también aparece como
 * /dev/cu.usbmodem…, y escribirle "status" a SU puerto no tiene nada que ver
 * con la TV. ioreg con -n devuelve ese nodo y su subárbol (donde vive el tty).
 */
export function espressifPorts(ioregOut: string): string[] {
  return [...ioregOut.matchAll(/"IOCalloutDevice" = "(\/dev\/cu\.[^"]+)"/g)].map((m) => m[1]!);
}

function candidatePorts(): string[] {
  const fixed = process.env.HERMES_TV_REMOTE_PORT?.trim();
  if (fixed) return [fixed];
  try {
    const out = execFileSync("/usr/sbin/ioreg", ["-r", "-l", "-w0", "-n", "USB JTAG_serial debug unit"], { encoding: "utf8", timeout: 4000 });
    return espressifPorts(out);
  } catch {
    return [];
  }
}

const statusMatch = (line: string) => (/\bble=/.test(line) ? line.trim() : null);

let port: Port | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function connect(): Promise<Port | null> {
  if (port && !port.closed) return port;
  for (const path of candidatePorts()) {
    let p: Port;
    try {
      p = Port.open(path);
    } catch {
      continue;
    }
    p.write("status");
    if (await p.waitFor(statusMatch, 1500)) {
      console.log(`[tv] control Bluetooth en ${path}`);
      return (port = p);
    }
    p.close();
  }
  return null;
}

/** Corre una orden en la placa, una a la vez (el puerto es uno solo). */
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const NO_REMOTE =
  "No encuentro el control Bluetooth de la TV: la ESP32 no está conectada por USB a esta Mac " +
  "(o no tiene el firmware control-tv). Prender, apagar y abrir apps siguen funcionando por adb.";

/** "home", "vol+", "text hola"… → lo que responde el firmware. */
export function remoteSend(command: string): Promise<Result> {
  return serialized(async () => {
    const p = await connect();
    if (!p) return { ok: false, error: NO_REMOTE };
    try {
      p.write(command);
    } catch (err) {
      p.close();
      return { ok: false, error: `Se cortó el USB con la placa: ${err instanceof Error ? err.message : err}` };
    }
    const r = await p.waitFor(parseRemoteLine, 4000);
    return r ?? { ok: false, error: "La placa no respondió a tiempo." };
  });
}

/** Línea de estado del firmware ("ble=conectado wifi=…") o null sin placa. */
export function remoteStatus(): Promise<string | null> {
  return serialized(async () => {
    const p = await connect();
    if (!p) return null;
    p.write("status");
    return p.waitFor(statusMatch, 1500);
  });
}
