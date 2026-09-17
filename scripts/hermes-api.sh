#!/usr/bin/env bash
# Enciende Hermes contra los CRÉDITOS de la API (console.anthropic.com) en vez
# de la suscripción de Claude Code.
#
# Por qué existe: el Agent SDK spawnea el CLI `claude`, y el CLI prefiere
# ANTHROPIC_API_KEY sobre tu login si la variable está en el entorno. Meterla
# al .env cambiaría la facturación de TODO Hermes para siempre — incluidos los
# jobs de fondo. Este script la pone SOLO en la terminal donde lo corres.
#
#   Uso:  ./scripts/hermes-api.sh [modelo]     (default: claude-fable-5-1)
#
# La key vive en ~/.hermes-os/anthropic-api-key (fuera del repo, chmod 600).
# Producción (launchd) sigue con la suscripción y no se entera de nada.
set -euo pipefail

KEY_FILE="${HERMES_API_KEY_FILE:-$HOME/.hermes-os/anthropic-api-key}"
MODEL="${1:-claude-fable-5-1}"

if [[ ! -f "$KEY_FILE" ]]; then
  cat >&2 <<MSG
No encontré la key en: $KEY_FILE

  1. console.anthropic.com → Settings → API keys → Create key
     (crea primero un Workspace para el evento y sácala DE ESE workspace,
      así el gasto queda aislado y le puedes poner tope)
  2. mkdir -p ~/.hermes-os
     printf '%s' 'sk-ant-...' > $KEY_FILE
     chmod 600 $KEY_FILE
MSG
  exit 1
fi

KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
if [[ "$KEY" != sk-ant-* ]]; then
  echo "La key de $KEY_FILE no parece una API key (debe empezar con sk-ant-)." >&2
  exit 1
fi

echo "→ Comprobando la key y el saldo contra la API…"
CODE=$(curl -s -o /tmp/hermes-api-check.json -w "%{http_code}" https://api.anthropic.com/v1/messages \
  -H "x-api-key: $KEY" -H "anthropic-version: 2023-06-01" -H "content-type: application/json" \
  -d "{\"model\":\"$MODEL\",\"max_tokens\":16,\"messages\":[{\"role\":\"user\",\"content\":\"di: listo\"}]}")

if [[ "$CODE" != "200" ]]; then
  echo "✕ La API respondió $CODE:" >&2
  python3 -c "import json,sys;d=json.load(open('/tmp/hermes-api-check.json'));print('  ',d.get('error',{}).get('message',d))" >&2 || cat /tmp/hermes-api-check.json >&2
  echo "  (401 = key inválida · 400 con 'model' = ese modelo no está habilitado · 429 = rate limit del tier)" >&2
  exit 1
fi
python3 - <<'PY'
import json
u = json.load(open("/tmp/hermes-api-check.json")).get("usage", {})
print(f"✓ Key válida. Prueba: {u.get('input_tokens',0)} in / {u.get('output_tokens',0)} out tokens.")
PY

echo "→ Deteniendo el Hermes de producción (suscripción)…"
launchctl bootout "gui/$UID/com.hermes-os.agent" 2>/dev/null || true

cd "$(dirname "$0")/.."
echo "→ Levantando Hermes con $MODEL contra los créditos de la API."
echo "  Al terminar: Ctrl-C y luego  ./hermes install  (vuelve a la suscripción)."
echo
ANTHROPIC_API_KEY="$KEY" HERMES_MODEL="$MODEL" exec pnpm --filter @hermes/agent dev
