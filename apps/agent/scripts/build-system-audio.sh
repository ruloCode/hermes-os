#!/bin/bash
# Compila el helper de audio del sistema (idempotente: skip si el binario es
# más nuevo que la fuente). Requiere swiftc: si el Xcode completo no corre (p.
# ej. licencia sin aceptar), cae a las Command Line Tools.
set -euo pipefail
cd "$(dirname "$0")/../native"

if [[ -x system-audio && system-audio -nt system-audio.swift ]]; then
  echo "[system-audio] al día"
  exit 0
fi

SWIFTC=(swiftc)
if ! swiftc --version >/dev/null 2>&1; then
  if [[ -x /Library/Developer/CommandLineTools/usr/bin/swiftc ]]; then
    export DEVELOPER_DIR=/Library/Developer/CommandLineTools
  else
    echo "[system-audio] swiftc no disponible (instala Command Line Tools)" >&2
    exit 1
  fi
fi

"${SWIFTC[@]}" -O system-audio.swift -o system-audio
echo "[system-audio] compilado → apps/agent/native/system-audio"
