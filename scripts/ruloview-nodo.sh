#!/usr/bin/env bash
# Deja un ESP32-S3 conectado por USB listo como nodo de RuloView:
#   respaldo de lo que traía → firmware CSI del fork (build sin pantalla) →
#   WiFi + destino + id de nodo en NVS → reset por watchdog → verifica que
#   lleguen tramas UDP a esta Mac.
#
# Uso:  RULOVIEW_WIFI_SSID=… RULOVIEW_WIFI_PASS=… scripts/ruloview-nodo.sh <1|2|3> [ip-destino]
#   ip-destino por defecto = la IP de esta Mac en la interfaz Wi-Fi.
#
# Necesita (una vez):
#   - el venv con esptool: ~/.hermes-os/ruloview/esp-venv (uv venv + esptool pyserial esp-idf-nvs-partition-gen)
#   - el firmware compilado en ~/.hermes-os/ruloview/fw (ver docs/ruloview.md)
#
# Ojo: el reset por USB (DTR/RTS) deja al S3 en modo descarga; el watchdog no.
set -euo pipefail

NODE="${1:-}"
[[ "$NODE" =~ ^[1-3]$ ]] || { echo "Uso: $0 <1|2|3> [ip-destino]"; exit 1; }
: "${RULOVIEW_WIFI_SSID:?Falta RULOVIEW_WIFI_SSID}"
: "${RULOVIEW_WIFI_PASS:?Falta RULOVIEW_WIFI_PASS}"
RUVIEW_PATH="${RUVIEW_PATH:-$HOME/dev/side/RuView}"
BASE="$HOME/.hermes-os/ruloview"
PY="$BASE/esp-venv/bin/python"
FW="$BASE/fw"
WIFI_IF="$(networksetup -listallhardwareports | awk '/Wi-Fi/{getline; print $2; exit}')"
TARGET="${2:-$(ipconfig getifaddr "$WIFI_IF" || true)}"
[ -n "$TARGET" ] || { echo "No pude leer la IP de esta Mac en $WIFI_IF: pásala como segundo argumento"; exit 1; }
for f in bootloader.bin partition-table.bin ota_data_initial.bin esp32-csi-node.bin; do
  [ -f "$FW/$f" ] || { echo "Falta $FW/$f (compila el firmware primero)"; exit 1; }
done

PORTS=(/dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial*)
PORT=""
for p in "${PORTS[@]}"; do [ -e "$p" ] && PORT="$p" && break; done
[ -n "$PORT" ] || { echo "No hay ningún ESP32 por USB"; exit 1; }

MAC="$("$PY" -m esptool --port "$PORT" --after no-reset read-mac 2>/dev/null | awk '/^MAC:/ && !m {print $2; m=1}' | tr -d ':')"
echo "Nodo $NODE · placa $MAC en $PORT · destino $TARGET:5005 · red $RULOVIEW_WIFI_SSID"

mkdir -p "$BASE/backups"
BK="$BASE/backups/$MAC-0x0-0x220000.bin"
if [ ! -f "$BK" ]; then
  echo "Respaldando lo que trae la placa…"
  "$PY" -m esptool --port "$PORT" -b 921600 --before no-reset --after no-reset read-flash 0x0 0x220000 "$BK" >/dev/null
fi

echo "Flasheando firmware CSI…"
"$PY" -m esptool --chip esp32s3 --port "$PORT" -b 460800 --before default-reset --after no-reset \
  write-flash --flash-mode dio --flash-size 8MB --flash-freq 80m \
  0x0 "$FW/bootloader.bin" 0x8000 "$FW/partition-table.bin" \
  0xf000 "$FW/ota_data_initial.bin" 0x20000 "$FW/esp32-csi-node.bin" | grep -E "Hash of data verified" | wc -l | xargs -I{} echo "  {} de 4 regiones verificadas"

echo "Provisionando WiFi y nodo…"
(cd "$BASE" && "$PY" "$RUVIEW_PATH/firmware/esp32-csi-node/provision.py" --port "$PORT" --chip esp32s3 \
  --ssid "$RULOVIEW_WIFI_SSID" --password "$RULOVIEW_WIFI_PASS" \
  --target-ip "$TARGET" --target-port 5005 \
  --node-id "$NODE" --tdm-slot $((NODE - 1)) --tdm-total 3 \
  --state-dir "$BASE/provision/node-$NODE" | tail -1)

"$PY" -m esptool --port "$PORT" --after watchdog-reset chip-id >/dev/null 2>&1 || true

if lsof -nP -iUDP:5005 >/dev/null 2>&1; then
  echo "El relay de RuView ya escucha UDP 5005: revisa el nodo en /ruloview (o tail -f $RUVIEW_PATH/logs/udp-relay.log)."
  exit 0
fi
echo "Esperando tramas del nodo (30 s)…"
python3 - <<'PY'
import socket, time, collections
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.bind(("0.0.0.0", 5005)); s.settimeout(1)
c = collections.Counter(); t = time.time(); first = None
while time.time() - t < 30:
    try:
        _, (ip, _) = s.recvfrom(65535); c[ip] += 1; first = first or time.time()
    except socket.timeout:
        pass
if not c:
    print("  Ninguna trama en 30 s: revisa la red/clave o pulsa RESET en la placa.")
    raise SystemExit(1)
el = time.time() - first if first else 1
for ip, n in c.items():
    print(f"  OK: {ip} manda ~{n / max(el, 1):.0f} tramas/s")
PY
