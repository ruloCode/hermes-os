#!/bin/bash
#
# hermes-tunnel.sh — Expone el agente (:8650) a internet con un quick tunnel de
# cloudflared y publica la URL vigente en Supabase (remote_config), donde la app
# móvil la lee tras hacer login. Lo corre com.hermes-os.tunnel (KeepAlive): si
# el túnel se cae, launchd relanza el script y se publica la URL nueva.
#
# Sin cuenta de Cloudflare: los quick tunnels (trycloudflare.com) no requieren
# login; el precio es que la URL cambia en cada arranque — por eso el
# descubrimiento vive en remote_config y no bakeada en el APK.
#
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

env_get() {
  grep -E "^[[:space:]]*$1=" "$ROOT/.env" 2>/dev/null | tail -n1 | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs 2>/dev/null || true
}

AGENT_PORT="$(env_get HERMES_PORT)"; AGENT_PORT="${AGENT_PORT:-8650}"
SUPA_URL="$(env_get NEXT_PUBLIC_SUPABASE_URL)"
SUPA_SECRET="$(env_get SUPABASE_SERVICE_ROLE_KEY)"
METRICS_PORT=8654

if [[ -z "$SUPA_URL" || -z "$SUPA_SECRET" ]]; then
  echo "hermes-tunnel: faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env" >&2
  exit 1
fi

CLOUDFLARED="$(command -v cloudflared || echo /opt/homebrew/bin/cloudflared)"
if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "hermes-tunnel: cloudflared no está instalado (brew install cloudflared)" >&2
  exit 1
fi

publish_url() {
  local url="$1"
  curl -sf -X POST "$SUPA_URL/rest/v1/remote_config" \
    -H "apikey: $SUPA_SECRET" \
    -H "Authorization: Bearer $SUPA_SECRET" \
    -H "Content-Type: application/json" \
    -H "Prefer: resolution=merge-duplicates" \
    -d "[{\"key\":\"agent_public_url\",\"value\":\"$url\",\"updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}]" \
    >/dev/null
}

"$CLOUDFLARED" tunnel --url "http://127.0.0.1:$AGENT_PORT" \
  --metrics "127.0.0.1:$METRICS_PORT" --no-autoupdate &
CF_PID=$!
trap 'kill "$CF_PID" 2>/dev/null' EXIT TERM INT

# El endpoint /quicktunnel del servidor de métricas devuelve el hostname
# asignado — más robusto que parsear el banner de stderr.
HOSTNAME=""
for _ in $(seq 1 40); do
  HOSTNAME="$(curl -sf --max-time 2 "http://127.0.0.1:$METRICS_PORT/quicktunnel" 2>/dev/null \
    | sed -E 's/.*"hostname":"([^"]*)".*/\1/')"
  [[ -n "$HOSTNAME" && "$HOSTNAME" == *trycloudflare.com ]] && break
  HOSTNAME=""
  kill -0 "$CF_PID" 2>/dev/null || { echo "hermes-tunnel: cloudflared murió al arrancar" >&2; exit 1; }
  sleep 1
done

if [[ -z "$HOSTNAME" ]]; then
  echo "hermes-tunnel: no obtuve hostname del quick tunnel en 40s" >&2
  exit 1
fi

PUBLIC_URL="https://$HOSTNAME"
if publish_url "$PUBLIC_URL"; then
  echo "hermes-tunnel: agente publicado en $PUBLIC_URL"
else
  echo "hermes-tunnel: túnel arriba en $PUBLIC_URL pero no pude publicarlo en Supabase" >&2
fi

# Nos quedamos pegados al proceso del túnel: si muere, salimos y launchd
# (KeepAlive) nos relanza con URL fresca.
wait "$CF_PID"
