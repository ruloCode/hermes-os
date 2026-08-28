// Assets de MediaPipe para el control por gestos (public/mediapipe/ está
// gitignorada: son ~40MB de binarios). Idempotente: si ya están, no hace nada.
//  - wasm: se copia de node_modules (misma versión que el package instalado).
//  - hand_landmarker.task: se baja UNA vez del bucket oficial de Google.
// Corre en predev/prebuild para que un clone fresco funcione sin pasos manuales.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const outDir = resolve(root, "public/mediapipe");
const wasmDst = resolve(outDir, "wasm");
const modelDst = resolve(outDir, "hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

mkdirSync(wasmDst, { recursive: true });

if (!existsSync(resolve(wasmDst, "vision_wasm_internal.wasm"))) {
  cpSync(wasmSrc, wasmDst, { recursive: true });
  console.log("[mediapipe] wasm copiado a public/mediapipe/wasm");
}

if (!existsSync(modelDst)) {
  console.log("[mediapipe] bajando hand_landmarker.task (~7.5MB)…");
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    // Sin red no rompemos el dev/build: el provider cae al CDN en runtime.
    console.warn(`[mediapipe] no se pudo bajar el modelo (${res.status}) — se usará el CDN`);
  } else {
    await writeFile(modelDst, Buffer.from(await res.arrayBuffer()));
    console.log("[mediapipe] modelo listo en public/mediapipe/hand_landmarker.task");
  }
}
