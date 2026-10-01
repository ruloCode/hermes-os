#!/bin/bash
# Proyectos de práctica para la demo de la Oficina (docs/oficina-de-agentes.md,
# "Proyectos para la demo"). Cada uno es un pod con su escritorio: le hablas a un
# agente ahí y corre `claude -p` en esa carpeta, con su CLAUDE.md.
#
#   scripts/demo-proyectos.sh prepare   # crea ~/dev/demo/<proyecto>, sus notas en el vault y la vista pública
#   scripts/demo-proyectos.sh reset     # devuelve cada repo a su punto de partida (antes de cada ensayo)
#   scripts/demo-proyectos.sh status    # qué falla hoy en cada uno
#
# Proyectos:
#   rulocode-web         tu sitio real (worktree del repo del portafolio en la rama demo/tarima)
#   edicion-reels        crudos reales + voces en off → reel vertical listo para publicar
#   finanzas-demo        finanzas personales con datos de prueba (COP y USD)
#   freelance-cafe-alto  cliente freelance ficticio: horas, cuenta de cobro y landing
#   liga-betplay         tabla de posiciones con resultados de prueba
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
DEMO="${DEMO_DIR:-$HOME/dev/demo}"
PORTFOLIO="${PORTFOLIO_REPO:-$HOME/dev/side/portfolio}"
REEL="${REEL_SOURCE:-/Volumes/Rulo/estudio/le-pedi-a-claude-code-que-trabajara-mientras-iba-al-gym}"
VAULT="${VAULT_PATH:-$(grep -E '^VAULT_PATH=' "$ROOT/.env" 2>/dev/null | cut -d= -f2- | tr -d '"')}"
PUBLIC_VIEW="${HERMES_PUBLIC_VIEW_PATH:-$HOME/.hermes-os/vista-publica.json}"
TEMPLATES=(finanzas-demo freelance-cafe-alto liga-betplay)
ALL=(rulocode-web edicion-reels finanzas-demo freelance-cafe-alto liga-betplay)

commit_start() {
  (cd "$1" && git init -q && git add -A && git -c user.name=demo -c user.email=demo@localhost commit -qm "punto de partida de la demo")
}

prepare_edicion() {
  local dir="$DEMO/edicion-reels"
  if [ ! -d "$REEL/crudos" ]; then
    echo "⚠ edicion-reels: no encuentro los crudos en $REEL (¿el disco está montado?). Se salta."
    return
  fi
  rm -r "$dir" 2>/dev/null || true
  mkdir -p "$dir/crudos" "$dir/voz" "$dir/exports"
  # Proxies 1080p de los crudos 4K (el original pesa 30-70 MB por bloque): mismo encuadre, sin editar.
  for b in 01-hook 03-3-11s 04-11-22s 05-22-32s 06-32-40s; do
    ffmpeg -v error -y -i "$REEL/crudos/$b.mp4" -vf "scale=-2:1080,fps=30" -c:v libx264 -crf 22 -preset veryfast -c:a aac -b:a 128k "$dir/crudos/$b.mp4"
  done
  for f in "$REEL"/assets/*-vo*.wav "$REEL"/assets/*_transcript.json; do
    [ -f "$f" ] && cp "$f" "$dir/voz/"
  done
  cat > "$dir/CLAUDE.md" <<'MD'
# edicion-reels

Del crudo al reel listo para publicar. Material REAL de la pieza "Le pedí a Claude Code que trabajara mientras iba al gym" (RuloCodeShow).

- `crudos/`: un video por bloque del guion (`01-hook`, `03-3-11s`, `04-11-22s`, `05-22-32s`, `06-32-40s`). Son proxies 1080p (16:9) de los crudos 4K originales, sin editar.
- `voz/`: las voces en off, grabadas por bloque en el dashboard. Si un bloque tiene varias tomas (`-vo`, `-vo-2`, `-vo-3`), **manda la última**. Los `*_transcript.json` son de la PRIMERA toma de cada bloque (segmentos y palabras con tiempos).
- Transcribir: `whisper-cli -m ~/.cache/whisper-ggml/ggml-large-v3-turbo-q5_0.bin -l es -oj -f audio.wav` (el audio en WAV 16 kHz mono).
- Herramientas: `ffmpeg` y `ffprobe` están en el PATH, pero ese ffmpeg **no trae libass ni freetype** (sin los filtros `subtitles` ni `drawtext`). Para quemar subtítulos usa el completo: `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`.

## Entrega: `exports/reel-final.mp4`

- Vertical 1080×1920, 30 fps, H.264 + AAC.
- En el orden de los bloques; cada video dura lo que su voz (recortar, o congelar el último cuadro si la voz es más larga).
- Manda la voz en off; el audio de cámara va fuera.
- Subtítulos quemados estilo reel: texto grande y centrado en el tercio inferior, máximo 2 líneas.
- Loudness integrado cercano a −14 LUFS (`loudnorm`).
- 60 segundos como máximo.
- Portada: `exports/portada.jpg`, un cuadro del hook.

Antes de decir que terminó, verifica el resultado con `ffprobe` (duración, resolución y que tenga audio).
MD
  printf 'exports/*\n!exports/.gitkeep\n' > "$dir/.gitignore"
  touch "$dir/exports/.gitkeep"
  commit_start "$dir"
  echo "listo: $dir"
}

prepare_web() {
  local dir="$DEMO/rulocode-web"
  if [ ! -d "$PORTFOLIO/.git" ]; then
    echo "⚠ rulocode-web: no encuentro el repo del portafolio en $PORTFOLIO. Se salta."
    return
  fi
  if [ ! -d "$dir" ]; then
    # Worktree en una rama propia: tu main y tus cambios sin commitear del portafolio no se tocan.
    git -C "$PORTFOLIO" worktree add -q "$dir" -B demo/tarima HEAD
  fi
  git -C "$dir" rev-parse HEAD > "$DEMO/.rulocode-web-base"
  echo "listo: $dir (rama demo/tarima desde $(cut -c1-7 "$DEMO/.rulocode-web-base"))"
}

vault_note() {
  # vault_note <slug> <nombre> <objetivo> <estado actual> <tareas…>
  local slug="$1" name="$2" goal="$3" state="$4"
  shift 4
  [ -n "$VAULT" ] || return 0
  local folder="$VAULT/projects/$slug"
  [ -f "$folder/$name.md" ] && return 0
  mkdir -p "$folder"
  {
    printf -- '---\nproyecto: %s\nestado: activo\nactualizado: %s\nruta_local: %s\nrama: %s\ntags: [proyecto, demo-tarima]\n---\n\n' "$name" "$(date +%F)" "$DEMO/$slug" "$( [ "$slug" = rulocode-web ] && echo demo/tarima || echo main)"
    printf '# %s\n\nProyecto de práctica para la demo de la Oficina de Hermes (`scripts/demo-proyectos.sh`).\n\n## 🎯 Objetivo\n%s\n\n## 📊 Estado Actual\n%s\n\n## 📋 Tareas Pendientes\n' "$name" "$goal" "$state"
    for t in "$@"; do printf -- '- [ ] %s\n' "$t"; done
  } > "$folder/$name.md"
}

prepare_vault() {
  [ -n "$VAULT" ] || { echo "⚠ sin VAULT_PATH: no se crean las notas del vault"; return; }
  vault_note rulocode-web "RuloCode Web" "El sitio personal rulocode.com (Next.js, blog bilingüe es/en). En la demo se trabaja en la rama demo/tarima de un worktree." "Blog con 10 entradas en español e inglés." "Escribir la entrada del blog sobre la demo en tarima (es y en)"
  vault_note edicion-reels "Edición de Reels" "Convertir crudos y voces en off en un reel vertical listo para publicar, con ffmpeg y whisper." "Crudos y voces del reel del gym listos; falta el montaje." "Armar exports/reel-final.mp4 según el CLAUDE.md"
  vault_note finanzas-demo "Finanzas Personales (demo)" "Resumen mensual de finanzas personales con datos de prueba en COP y USD." "El reporte de septiembre no cuadra." "Arreglar el resumen de septiembre"
  vault_note freelance-cafe-alto "Freelance Café Alto" "Proyecto freelance para un cliente ficticio: landing, horas y cuenta de cobro." "Horas de octubre registradas." "Generar la cuenta de cobro de octubre"
  vault_note liga-betplay "Liga BetPlay" "Tabla de posiciones de la liga con resultados de prueba." "Los tests de la tabla fallan." "Calcular la tabla y quién clasifica"
  echo "notas del vault listas en $VAULT/projects"
}

prepare_public_view() {
  # Los proyectos de la demo (y los públicos de la marca) se pueden nombrar en el proyector; el resto sigue oculto.
  python3 - "$PUBLIC_VIEW" "${ALL[@]}" <<'PY'
import json, os, sys
path, slugs = sys.argv[1], sys.argv[2:]
try:
    cfg = json.load(open(path))
except Exception:
    cfg = {}
pub = list(dict.fromkeys(cfg.get("publicProjects", ["hermes-os", "general"]) + ["hermes-os", "general", "rulocode", "rulocodeshow", "video-edit"] + slugs))
cfg["publicProjects"] = pub
cfg.setdefault("extraHidden", [])
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump(cfg, open(path, "w"), indent=2, ensure_ascii=False)
print(f"vista pública: {path} → {', '.join(pub)}")
PY
}

case "${1:-}" in
  prepare)
    mkdir -p "$DEMO"
    for t in "${TEMPLATES[@]}"; do
      rm -r "$DEMO/$t" 2>/dev/null || true
      cp -R "$HERE/demo-proyectos/$t" "$DEMO/$t"
      commit_start "$DEMO/$t"
      echo "listo: $DEMO/$t"
    done
    prepare_edicion
    prepare_web
    prepare_vault
    prepare_public_view
    ;;
  reset)
    for p in finanzas-demo freelance-cafe-alto liga-betplay edicion-reels; do
      [ -d "$DEMO/$p/.git" ] || continue
      (cd "$DEMO/$p" && git checkout -q -- . && git clean -qfd) && echo "reiniciado: $p"
    done
    if [ -d "$DEMO/rulocode-web" ] && [ -f "$DEMO/.rulocode-web-base" ]; then
      git -C "$DEMO/rulocode-web" checkout -q -- . && git -C "$DEMO/rulocode-web" clean -qfd
      git -C "$DEMO/rulocode-web" checkout -q --detach "$(cat "$DEMO/.rulocode-web-base")" && git -C "$DEMO/rulocode-web" checkout -q -B demo/tarima
      echo "reiniciado: rulocode-web"
    fi
    ;;
  status)
    for p in finanzas-demo freelance-cafe-alto liga-betplay; do
      [ -d "$DEMO/$p" ] && echo "$p: $(cd "$DEMO/$p" && node --test 2>&1 | grep -E '^# (pass|fail)' | tr '\n' ' ')"
    done
    [ -d "$DEMO/edicion-reels" ] && echo "edicion-reels: $(ls "$DEMO/edicion-reels/crudos" | wc -l | tr -d ' ') crudos · $(ls "$DEMO/edicion-reels/voz" | grep -c wav) voces · exports: $(ls "$DEMO/edicion-reels/exports" | grep -vc gitkeep)"
    [ -d "$DEMO/rulocode-web" ] && echo "rulocode-web: rama $(git -C "$DEMO/rulocode-web" branch --show-current), $(git -C "$DEMO/rulocode-web" status --short | wc -l | tr -d ' ') cambios"
    ;;
  *)
    sed -n '2,15p' "$0"
    exit 1
    ;;
esac
