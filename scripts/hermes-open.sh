#!/bin/bash
#
# hermes-open.sh — Espera a que el dashboard esté sano y lo abre en el
# navegador. Lo lanza com.hermes-os.open al login (RunAtLoad, sin KeepAlive).
#
set -uo pipefail

PORT="${NEXT_PUBLIC_WEB_PORT:-31415}"
URL="http://localhost:${PORT}"

# Hasta ~2 minutos de espera: al login el build de Next tarda en levantar.
for _ in $(seq 1 60); do
  if curl -sf -o /dev/null --max-time 2 "$URL"; then
    open "$URL"
    exit 0
  fi
  sleep 2
done

echo "hermes-open: el dashboard no respondió en $URL tras 2 minutos" >&2
exit 1
