// pnpm brand:sync [--check] — escribe la marca (packages/shared/src/brand.ts)
// en los repos Android hermanos: Hermes Phone (HERMES_PHONE_PATH o
// ../hermes-phone) y Hermes TV (HERMES_TV_PATH o ../hermes-tv). Un repo que
// no está en esta máquina se salta. Con --check no escribe: dice qué está
// desactualizado y sale con 1.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPhoneBrand, renderTvBrand } from "../src/brand/phone.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const check = process.argv.includes("--check");

const targets = [
  { name: "el teléfono", path: resolve(process.env.HERMES_PHONE_PATH ?? join(ROOT, "../hermes-phone")), files: renderPhoneBrand() },
  { name: "la TV", path: resolve(process.env.HERMES_TV_PATH ?? join(ROOT, "../hermes-tv")), files: renderTvBrand() },
];

let found = 0;
let stale = 0;
for (const t of targets) {
  if (!existsSync(join(t.path, "settings.gradle.kts"))) {
    console.log(`brand:sync: sin repo de ${t.name} en ${t.path} (se salta)`);
    continue;
  }
  found++;
  let here = 0;
  for (const [rel, content] of Object.entries(t.files)) {
    const file = join(t.path, rel);
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current === content) continue;
    here++;
    if (check) {
      console.log(`desactualizado (${t.name}): ${rel}`);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    console.log(`${current === null ? "creado" : "actualizado"} (${t.name}): ${rel}`);
  }
  if (here === 0) console.log(`brand:sync: ${t.name} ya sigue la marca.`);
  stale += here;
}

if (found === 0) {
  console.error("brand:sync: no encontré ningún repo Android (usa HERMES_PHONE_PATH / HERMES_TV_PATH)");
  process.exit(1);
}
if (check && stale > 0) process.exit(1);
