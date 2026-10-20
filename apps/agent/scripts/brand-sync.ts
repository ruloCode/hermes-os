// pnpm brand:sync [--check] — escribe la marca (packages/shared/src/brand.ts)
// en Hermes Phone. Ruta del teléfono: HERMES_PHONE_PATH o ../hermes-phone.
// Con --check no escribe: dice qué está desactualizado y sale con 1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPhoneBrand } from "../src/brand/phone.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PHONE = resolve(process.env.HERMES_PHONE_PATH ?? join(ROOT, "../hermes-phone"));
const check = process.argv.includes("--check");

if (!existsSync(join(PHONE, "settings.gradle.kts"))) {
  console.error(`brand:sync: no encuentro el repo del teléfono en ${PHONE} (usa HERMES_PHONE_PATH)`);
  process.exit(1);
}

let stale = 0;
for (const [rel, content] of Object.entries(renderPhoneBrand())) {
  const file = join(PHONE, rel);
  const current = existsSync(file) ? readFileSync(file, "utf8") : null;
  if (current === content) continue;
  stale++;
  if (check) {
    console.log(`desactualizado: ${rel}`);
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`${current === null ? "creado" : "actualizado"}: ${rel}`);
}

if (stale === 0) console.log("brand:sync: el teléfono ya sigue la marca.");
if (check && stale > 0) process.exit(1);
