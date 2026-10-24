// La marca es UNA: estos tests fallan si la web, el icono o el teléfono se
// apartan de packages/shared/src/brand.ts. Contratos, no snapshots: cada
// aserción dice qué promesa de la marca se rompió.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  BRAND_COLOR_KEYS,
  BRAND_DARK,
  BRAND_LIGHT,
  BRAND_MARK,
  contrastRatio,
  parseBrandColor,
  toAndroidHex,
  toArgbHex,
  type BrandPalette,
} from "@hermes/shared";
import { kotlinName, renderPhoneBrand, renderTvBrand } from "./phone.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const css = readFileSync(join(ROOT, "apps/web/src/app/globals.css"), "utf8");

/** Los tokens `--color-x: valor;` de un bloque CSS (el primero que empieza con `opener`). */
function block(opener: string): Map<string, string> {
  const start = css.indexOf(opener);
  assert.ok(start >= 0, `globals.css sin el bloque ${opener}`);
  const end = css.indexOf("\n}", start);
  const out = new Map<string, string>();
  for (const m of css.slice(start, end).matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const darkCss = new Map([...block("@theme {"), ...block("@theme static {")]);
const lightCss = block(':root[data-theme="light"] {');

test("cada token oscuro de la marca está en globals.css con el mismo valor", () => {
  for (const k of BRAND_COLOR_KEYS) assert.equal(darkCss.get(k), BRAND_DARK[k], `--color-${k} (oscuro)`);
});

test("cada token claro de la marca está en globals.css con el mismo valor", () => {
  for (const k of BRAND_COLOR_KEYS) assert.equal(lightCss.get(k), BRAND_LIGHT[k], `--color-${k} (claro)`);
});

test("el favicon y la marca de la barra dibujan la misma H que brand.ts", () => {
  const svg = readFileSync(join(ROOT, "apps/web/src/app/icon.svg"), "utf8");
  assert.ok(svg.includes(`d="${BRAND_MARK.path}"`), "icon.svg: trazo distinto");
  assert.ok(svg.includes(`rx="${BRAND_MARK.cornerRadius}"`), "icon.svg: radio distinto");
  assert.ok(svg.includes(`fill="${BRAND_DARK["accent-solid"]}"`), "icon.svg: fondo que no es accent-solid");
  const tsx = readFileSync(join(ROOT, "apps/web/src/components/shell/HermesMark.tsx"), "utf8");
  assert.ok(tsx.includes(`d="${BRAND_MARK.path}"`), "HermesMark.tsx: trazo distinto");
});

// La regla de la marca: si lleva información, pasa AA (4,5:1) — en los dos temas.
for (const [name, p] of [["oscuro", BRAND_DARK], ["claro", BRAND_LIGHT]] as Array<[string, BrandPalette]>) {
  test(`texto y acento pasan AA sobre lienzo y tarjeta (${name})`, () => {
    for (const surface of ["bg", "panel"] as const) {
      for (const ink of ["text", "text-dim", "text-faint", "accent"] as const) {
        const ratio = contrastRatio(parseBrandColor(p[ink]), parseBrandColor(p[surface]));
        assert.ok(ratio >= 4.5, `${ink} sobre ${surface}: ${ratio.toFixed(2)}:1`);
      }
    }
  });
  test(`el texto del botón primario pasa AA sobre accent-solid (${name})`, () => {
    const ratio = contrastRatio(parseBrandColor(p["on-accent"]), parseBrandColor(p["accent-solid"]));
    assert.ok(ratio >= 4.5, `on-accent sobre accent-solid: ${ratio.toFixed(2)}:1`);
  });
}

test("colores: hex y rgb con alfa se convierten al formato de Compose y de Android", () => {
  assert.equal(toArgbHex(parseBrandColor("#5b5bd6")), "0xFF5B5BD6");
  assert.equal(toArgbHex(parseBrandColor("rgb(255 255 255 / 0.07)")), "0x12FFFFFF");
  assert.equal(toAndroidHex(parseBrandColor("#0e0f11")), "#FF0E0F11");
  assert.throws(() => parseBrandColor("var(--x)"));
  assert.throws(() => parseBrandColor("#abc"));
});

test("el Kotlin generado nombra cada token como la web (panel-2 → panel2, text-dim → textDim)", () => {
  assert.equal(kotlinName("panel-2"), "panel2");
  assert.equal(kotlinName("accent-solid"), "accentSolid");
  const kt = renderPhoneBrand()["app/src/main/java/os/hermes/phone/ui/Brand.kt"];
  for (const k of BRAND_COLOR_KEYS) assert.ok(kt.includes(`val ${kotlinName(k)}: Color`), `Brand.kt sin ${k}`);
  assert.ok(kt.includes("textDim = Color(0xFFA3A7B0)"), "Brand.kt: text-dim oscuro distinto");
});

// El teléfono vive en un repo hermano (../hermes-phone). Si está, lo que tiene
// en disco debe ser EXACTAMENTE lo que genera la marca: si no, falta un
// `pnpm brand:sync`. En una máquina sin el teléfono, el test no aplica.
const PHONE = process.env.HERMES_PHONE_PATH ?? join(ROOT, "../hermes-phone");
test("Hermes Phone tiene la marca al día (pnpm brand:sync)", { skip: !existsSync(PHONE) && "sin ../hermes-phone en esta máquina" }, () => {
  for (const [rel, content] of Object.entries(renderPhoneBrand())) {
    const file = join(PHONE, rel);
    assert.ok(existsSync(file), `falta ${rel} en el teléfono: corre pnpm brand:sync`);
    assert.equal(readFileSync(file, "utf8"), content, `${rel} desactualizado: corre pnpm brand:sync`);
  }
});

// Lo mismo para Hermes TV (../hermes-tv): su Brand.kt cambia solo el paquete.
const TV = process.env.HERMES_TV_PATH ?? join(ROOT, "../hermes-tv");
test("Hermes TV tiene la marca al día (pnpm brand:sync)", { skip: !existsSync(TV) && "sin ../hermes-tv en esta máquina" }, () => {
  const files = renderTvBrand();
  assert.ok(files["app/src/main/java/os/hermes/tv/ui/Brand.kt"].includes("package os.hermes.tv.ui"));
  for (const [rel, content] of Object.entries(files)) {
    const file = join(TV, rel);
    assert.ok(existsSync(file), `falta ${rel} en la TV: corre pnpm brand:sync`);
    assert.equal(readFileSync(file, "utf8"), content, `${rel} desactualizado: corre pnpm brand:sync`);
  }
});
