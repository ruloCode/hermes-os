/**
 * Retratos de los agentes de la Sala 3D: un PNG por personaje generado UNA
 * vez con gpt-image-1 (texto → imagen) desde el `portrait_prompt` de
 * ~/.hermes-os/sala.json, guardado en ~/.hermes-os/avatars/sala/<clave>.png.
 * Idempotente: salta los que ya existen (`--force` los regenera). Sin
 * OPENAI_API_KEY o sin prompt, avisa y sigue: la sala no depende del retrato
 * (la tarjeta muestra solo el nombre).
 *
 * Uso: pnpm sala:portraits [--force] [--only=clave,clave]
 */
import { config } from "dotenv";
import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });

const { readSalaConfig, portraitPath, SALA_PATH, SALA_PORTRAIT_DIR } = await import("../src/sala/store.js");

const KEY = process.env.OPENAI_API_KEY;
const FORCE = process.argv.includes("--force");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).split(",").filter(Boolean);
// "medium" es el punto medio de precio/calidad de gpt-image-1 (~4¢ por imagen);
// override por env si se quiere más detalle.
const QUALITY = process.env.SALA_PORTRAIT_QUALITY || "medium";

// Mismo estilo para los cinco: así se leen como un elenco, no como cinco stocks.
const STYLE =
  "Consistent series style: 3D rendered character portrait, soft matte materials, single warm key light from the upper left, dark neutral charcoal backdrop, square composition, centered bust, no text, no watermark, no letters.";

if (!KEY) {
  console.error("Falta OPENAI_API_KEY en .env — sin retratos (la sala funciona igual).");
  process.exit(1);
}

const cfg = await readSalaConfig();
if (!cfg) {
  console.error(`No existe ${SALA_PATH}`);
  process.exit(1);
}

await mkdir(SALA_PORTRAIT_DIR, { recursive: true });

async function exists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

async function generate(prompt: string): Promise<Buffer> {
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1024", quality: QUALITY, n: 1 }),
  });
  if (!res.ok) {
    const raw = await res.text();
    let msg = raw.slice(0, 300);
    try {
      msg = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* texto crudo */
    }
    throw new Error(`OpenAI ${res.status}: ${msg}`);
  }
  const json = (await res.json()) as { data?: { b64_json?: string }[] };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI devolvió sin imagen");
  return Buffer.from(b64, "base64");
}

let made = 0;
for (const a of cfg.agents) {
  if (ONLY && !ONLY.includes(a.key)) continue;
  const out = portraitPath(a.key);
  if (!a.portrait_prompt) {
    console.log(`· ${a.name}: sin portrait_prompt en sala.json — se omite`);
    continue;
  }
  if (!FORCE && (await exists(out))) {
    console.log(`· ${a.name}: ya existe ${out}`);
    continue;
  }
  const t0 = Date.now();
  process.stdout.write(`✦ ${a.name}: generando… `);
  try {
    const png = await generate(`${a.portrait_prompt}\n\n${STYLE}`);
    await writeFile(out, png);
    made++;
    console.log(`listo en ${((Date.now() - t0) / 1000).toFixed(0)}s → ${out}`);
  } catch (err) {
    console.log(`falló: ${err instanceof Error ? err.message : String(err)}`);
  }
}
console.log(`\n${made} retrato(s) nuevo(s) en ${SALA_PORTRAIT_DIR}`);
