#!/bin/bash
# Repo de práctica para la demo en tarima de la Oficina (docs/oficina-de-agentes.md,
# "Demo en tarima"). Los errores que se ven en vivo son REALES: los tests de verdad
# fallan, el guardrail de verdad niega. Lo único preparado es el punto de partida.
#
#   scripts/tarima-demo.sh prepare   # crea ~/dev/demo-tarima desde cero (con los bugs y un dist/ viejo)
#   scripts/tarima-demo.sh reset     # lo devuelve al punto de partida (antes de cada ensayo)
#   scripts/tarima-demo.sh status    # qué falla hoy
set -euo pipefail
DIR="${TARIMA_DIR:-$HOME/dev/demo-tarima}"

write_files() {
  mkdir -p "$DIR/src" "$DIR/test" "$DIR/dist"
  cat > "$DIR/package.json" <<'JSON'
{
  "name": "demo-tarima",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "build": "node build.mjs"
  }
}
JSON
  cat > "$DIR/src/formato.js" <<'JS'
// Formatos para Colombia: precios en pesos y slugs para URLs.

/** 1234567 → "$ 1.234.567" */
export function formatCOP(valor) {
  return "$ " + Math.round(valor).toLocaleString("en-US");
}

/** "Canción del Ñandú" → "cancion-del-nandu" */
export function slugify(texto) {
  return texto.toLowerCase().trim().replace(/\s+/g, "-");
}
JS
  cat > "$DIR/test/formato.test.js" <<'JS'
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCOP, slugify } from "../src/formato.js";

test("formatCOP usa punto de miles", () => {
  assert.equal(formatCOP(1234567), "$ 1.234.567");
});

test("slugify quita tildes y eñes", () => {
  assert.equal(slugify("Canción del Ñandú"), "cancion-del-nandu");
});
JS
  cat > "$DIR/build.mjs" <<'JS'
// Build mínimo: copia src/ a dist/ y escribe un manifiesto. No borra nada (eso es "limpiar").
import { mkdirSync, readdirSync, copyFileSync, writeFileSync } from "node:fs";
mkdirSync("dist", { recursive: true });
const files = readdirSync("src");
for (const f of files) copyFileSync(`src/${f}`, `dist/${f}`);
writeFileSync("dist/manifest.json", JSON.stringify({ files, builtAt: new Date().toISOString() }, null, 2));
console.log(`build: ${files.length} archivo(s) en dist/`);
JS
  # Restos de builds viejos: el caso 2 pide limpiar dist/ antes de volver a construir.
  for i in 1 2 3; do echo "// build viejo $i" > "$DIR/dist/viejo-$i.js"; done
  cat > "$DIR/README.md" <<'MD'
# demo-tarima

Repo de práctica para la demo de la Oficina de Hermes. `npm test` corre los tests y `npm run build` arma `dist/`.
MD
}

case "${1:-}" in
  prepare)
    rm -r "$DIR" 2>/dev/null || true
    write_files
    (cd "$DIR" && git init -q && git add -A && git -c user.name=demo -c user.email=demo@localhost commit -qm "punto de partida de la demo")
    echo "listo: $DIR"
    ;;
  reset)
    [ -d "$DIR/.git" ] || { echo "no existe $DIR: corre 'prepare' primero"; exit 1; }
    (cd "$DIR" && git checkout -q -- . && git clean -qfd && git checkout -q -- .)
    echo "reiniciado: $DIR"
    ;;
  status)
    (cd "$DIR" && npm test --silent 2>&1 | tail -6; ls dist)
    ;;
  *)
    sed -n '2,9p' "$0"
    exit 1
    ;;
esac
