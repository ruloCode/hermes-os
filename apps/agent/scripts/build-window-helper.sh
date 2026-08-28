#!/bin/bash
# Compila el helper nativo de ventanas (idempotente: skip si el binario es
# más nuevo que la fuente). Requiere Command Line Tools (swiftc).
set -euo pipefail
cd "$(dirname "$0")/../native"

if [[ -x window-helper && window-helper -nt window-helper.swift ]]; then
  echo "[window-helper] al día"
  exit 0
fi

if ! command -v swiftc >/dev/null; then
  echo "[window-helper] swiftc no disponible (instala Command Line Tools)" >&2
  exit 1
fi

swiftc -O window-helper.swift -o window-helper
echo "[window-helper] compilado → apps/agent/native/window-helper"
