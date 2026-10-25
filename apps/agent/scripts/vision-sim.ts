/**
 * Ensayo de la visión en vivo con el modelo REAL y sin gafas: manda imágenes
 * como si fueran cuadros de la cámara a la misma VisionSession que usa
 * /vision/ws, y mide cuánto tarda en hablar y si calla cuando debe.
 *
 *   pnpm --filter @hermes/agent vision:sim [img1 img2 img3]
 *
 * Sin argumentos usa imágenes del repo: escena A, la MISMA escena A otra vez
 * (debe callar), escena B (debe narrar) y una pregunta sobre la C. Gasta unos
 * pocos miles de tokens de la suscripción (HERMES_VISION_MODEL).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ASK_FRAME_PX, NARRATE_FRAME_PX, type VisionServerEvent } from "@hermes/shared";
import { VisionSession } from "../src/vision/live.js";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
const defaults = [
  "apps/web/public/oficina/panorama-dia.webp",
  "apps/web/public/oficina/arte-cafetal.webp",
  "docs/img/readme/tarima-log-dark.jpg",
].map((p) => join(root, p));
const inputs = process.argv.slice(2).length ? process.argv.slice(2).map((p) => resolve(p)) : defaults;
if (inputs.length < 3) {
  console.error("Hacen falta 3 imágenes (o ninguna, para usar las del repo).");
  process.exit(1);
}

// JPEG como los manda el teléfono: 640 px para narrar, 1280 al preguntar.
const tmp = mkdtempSync(join(tmpdir(), "vision-sim-"));
const jpeg = (src: string, px: number, name: string): ArrayBuffer => {
  const out = join(tmp, name);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "70", "-Z", String(px), src, "--out", out], { stdio: "ignore" });
  const buf = readFileSync(out);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};
const frames = inputs.map((src, i) => ({
  name: basename(src),
  data: jpeg(src, NARRATE_FRAME_PX, `${i}.jpg`),
  sharp: jpeg(src, ASK_FRAME_PX, `${i}-hd.jpg`),
}));

const events: (VisionServerEvent & { at: number })[] = [];
const t0 = Date.now();
const session = new VisionSession((ev) => {
  events.push({ ...ev, at: Date.now() - t0 });
  if (ev.t === "say") console.log(`  ${ev.kind === "respuesta" ? "↳" : "◉"} ${ev.ms} ms · ${ev.text}`);
  if (ev.t === "quiet") console.log(`  · ${ev.ms} ms · (calló)`);
  if (ev.t === "error") console.log(`  ✕ ${ev.message}`);
});

/** Espera el siguiente cierre de turno (say | quiet | error) después de `from`. */
function nextClose(from: number, ms = 30_000): Promise<VisionServerEvent> {
  return new Promise((res, rej) => {
    const t = Date.now();
    const iv = setInterval(() => {
      const hit = events.slice(from).find((e) => e.t === "say" || e.t === "quiet" || e.t === "error");
      if (hit) {
        clearInterval(iv);
        res(hit);
      } else if (Date.now() - t > ms) {
        clearInterval(iv);
        rej(new Error("sin respuesta en 30 s"));
      }
    }, 50);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const results: { step: string; ok: boolean; detail: string }[] = [];
const check = (step: string, ok: boolean, detail: string) => {
  results.push({ step, ok, detail });
};

try {
  const [a, b, c] = frames;

  console.log(`1) escena A (${a.name}) — primera vez: debe describirla`);
  let mark = events.length;
  session.onFrame(a.data);
  let ev = await nextClose(mark, 45_000); // incluye el arranque del CLI
  check("narra la primera escena", ev.t === "say", ev.t === "say" ? `${ev.ms} ms` : ev.t);

  await sleep(4_500);
  console.log(`2) la MISMA escena A — debe callar`);
  mark = events.length;
  session.onFrame(a.data);
  ev = await nextClose(mark);
  check("calla con la misma escena", ev.t === "quiet", ev.t === "say" ? `dijo: ${ev.text}` : ev.t);

  await sleep(4_500);
  console.log(`3) escena B (${b.name}) — cambió: debe decir qué hay`);
  mark = events.length;
  session.onFrame(b.data);
  ev = await nextClose(mark);
  check("narra el cambio de escena", ev.t === "say", ev.t === "say" ? `${ev.ms} ms` : ev.t);

  console.log(`4) cuadro C (${c.name}) + pregunta "¿qué dice el título?" con cuadro nítido`);
  session.onMessage(JSON.stringify({ t: "mode", mode: "manual" })); // que no narre el cuadro antes
  mark = events.length;
  session.onFrame(c.data);
  session.onMessage(JSON.stringify({ t: "ask", text: "¿Qué dice el título de la pantalla?" }));
  session.onFrame(c.sharp); // el cuadro nítido que sigue a la pregunta
  ev = await nextClose(mark);
  check(
    "responde la pregunta con el cuadro actual",
    ev.t === "say" && ev.kind === "respuesta",
    ev.t === "say" ? `${ev.ms} ms` : ev.t,
  );
  check("respuesta bajo 4 s", ev.t === "say" && ev.ms <= 4_000, ev.t === "say" ? `${ev.ms} ms` : "-");
} catch (err) {
  check("sin errores", false, String(err));
} finally {
  session.close();
  rmSync(tmp, { recursive: true, force: true });
}

console.log("");
for (const r of results) console.log(`${r.ok ? "✓" : "✕"} ${r.step} — ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `\n${failed} de ${results.length} fallaron` : `\n${results.length} de ${results.length} OK`);
process.exit(failed ? 1 : 0);
