#!/usr/bin/env bash
# Llena la Oficina de agentes (/oficina) con trabajo REAL para un demo:
# varios runs de claude -p en paralelo, cada uno en un proyecto distinto, más
# una tarea de Hermes para el pod General. Prompts de solo lectura, Sonnet y
# esfuerzo bajo: el costo total se imprime al final con --cost.
#
#   scripts/oficina-demo.sh                 # 3 proyectos activos con carpeta local (del vault)
#   scripts/oficina-demo.sh video-edit rulocode   # esos proyectos
#   scripts/oficina-demo.sh --cost          # costo de los runs que siguen en memoria
#   scripts/oficina-demo.sh --kill          # detiene los runs en curso
#
# Ningún proyecto va escrito aquí: salen de GET /projects (estado activo y
# carpeta que existe en esta máquina) o de los argumentos.
set -euo pipefail
cd "$(dirname "$0")/.."

AGENT="${HERMES_URL:-http://localhost:8650}"
KEY="$(grep -E '^HERMES_API_KEY=' .env 2>/dev/null | cut -d= -f2- || true)"
AUTH=()
[[ -n "$KEY" ]] && AUTH=(-H "Authorization: Bearer $KEY")

api() { curl -fsS "${AUTH[@]}" -H "Content-Type: application/json" "$@"; }

if [[ "${1:-}" == "--kill" ]]; then
  for id in $(api "$AGENT/claude/runs" | python3 -c 'import json,sys; [print(r["id"]) for r in json.load(sys.stdin) if r["status"]=="running"]'); do
    api -X POST "$AGENT/claude/run/$id/kill" >/dev/null && echo "⏹ $id"
  done
  exit 0
fi

if [[ "${1:-}" == "--cost" ]]; then
  api "$AGENT/claude/runs" | python3 -c '
import json, sys
runs = json.load(sys.stdin)
total = 0.0
for r in runs:
    c = r.get("costUsd") or 0
    total += c
    print("%s  %-7s  $%.2f  %-20s  %s" % (r["id"], r["status"], c, r["projectSlug"], r["title"].replace("\n", " ")[:60]))
print("total $%.2f (%d runs en memoria; se evictan 5 min después de terminar)" % (total, len(runs)))'
  exit 0
fi

if [[ $# -gt 0 ]]; then
  PROJECTS=("$@")
else
  # shellcheck disable=SC2207
  PROJECTS=($(api "$AGENT/projects" | python3 -c '
import json, os, sys
d = json.load(sys.stdin)
ps = d if isinstance(d, list) else d.get("projects", [])
ok = [p["slug"] for p in ps if p.get("estado") == "activo" and p.get("ruta_local") and os.path.isdir(os.path.expanduser(p["ruta_local"]))]
print(" ".join(ok[:3]))'))
fi
[[ ${#PROJECTS[@]} -eq 0 ]] && { echo "✕ no hay proyectos activos con carpeta local; pásalos como argumentos" >&2; exit 1; }

PROMPTS=(
  "Lee el README de este repo y resume la arquitectura en 5 líneas. No edites nada."
  "Busca dónde se definen las rutas o endpoints principales y lista los 5 más importantes con su archivo. No edites nada."
  "Revisa el package.json (o equivalente) y dime qué scripts de test y build hay y qué harían. Si hay tests rápidos, córrelos y reporta el resultado. No edites nada."
)

i=0
for p in "${PROJECTS[@]}"; do
  prompt="${PROMPTS[$((i % ${#PROMPTS[@]}))]}"
  body=$(python3 -c 'import json,sys; print(json.dumps({"prompt": sys.argv[1], "project": sys.argv[2], "model": "sonnet", "effort": "low", "permissionMode": "default"}))' "$prompt" "$p")
  run=$(api -X POST "$AGENT/claude/run" -d "$body" | python3 -c 'import json,sys; print(json.load(sys.stdin)["run_id"])')
  echo "▶ run $run · $p"
  i=$((i + 1))
  sleep 1.5
done

task=$(api -X POST "$AGENT/tasks" -d '{"prompt":"Dame en tres líneas el estado de mis proyectos activos según el vault. Solo lectura."}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["task_id"])')
echo "▶ tarea $task · General"
echo "Abre /oficina. Costo al terminar: scripts/oficina-demo.sh --cost"
