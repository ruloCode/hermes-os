# RuloView — presencia con WiFi sobre tu cuarto en 3D

`/ruloview` (página suelta, ⌘K "RuloView") dibuja tu cuarto **escaneado con el celular** y, encima, lo que miden tres nodos ESP32-S3 con la señal WiFi del router: qué enlace cruza alguien, si hay movimiento y por dónde. Con la **cámara maestra** encendida, además, tu esqueleto (MediaPipe Pose) en tu posición real del cuarto. El Observatorio del fork (`127.0.0.1:3000/ui/rulostark/observatory.html`) lee **el mismo cuarto**.

El servidor de sensado es [RuView](https://github.com/ruloCode/RuView) (fork de ruvnet/RuView, rama "rulostark"): imagen Docker `ruvnet/wifi-densepose` + un relay UDP. Hermes no lo reimplementa: lo arranca con el script del fork y reenvía su stream.

## Qué es dato y qué no

| Lo que ves | De dónde sale |
|---|---|
| Paredes, muebles, texturas | el escaneo (`room.glb`), escalado con una medida real |
| Enlaces, lecturas/s, dBm, perturbación por enlace | medidos (RSSI de cada trama nueva, `LinkMetric`) |
| "Hay movimiento / presencia quieta / sala vacía" | lo clasifica el servidor RuView |
| Esqueleto sólido "Medido (cámara)" | MediaPipe Pose + modelo pinhole de la cámara (posición **estimada**) |
| Figura translúcida "Aproximado (WiFi)" | solo dice que hay alguien y qué enlace cruza; **no es una pose** |

El servidor manda `persons` con 17 puntos, pero hoy con **confianza 0** (el modelo de pose por WiFi del upstream es un stub: PCK@20 = 3 %). No se pinta. El camino para tener pose por WiFi en este cuarto es entrenar con la cámara como maestra (pares cámara + CSI, ADR-079 del upstream).

## Piezas

- **Agente** (`apps/agent/src/ruloview/`): `server.ts` (arranque/parada con `start-rulostark-rust.sh`, Colima con reintento si quedó el candado "in use by instance", token leído de `<repo>/docker/.env`, estado MEDIDO), `stream.ts` (UNA conexión WS al servidor por ticket, polling de respaldo, se cierra sin nadie mirando), `room.ts` (cuarto y escaneo). Rutas `/ruloview/*` — **no salen por el túnel** (presencia en un cuarto real): `status`, `start {source}`, `stop`, `events` (SSE), `room` (GET/PUT), `room/scan` (GET/PUT/DELETE, GLB ≤ 200 MB), `token`.
- **Lógica pura** (`packages/shared/src/ruloview.ts`, tests en `apps/agent/src/ruloview/metric.test.ts`): `trimSensing`, `LinkMetric` (portado de `link-metric.js` del fork, sin timers), `EscenarioState`, `parseRoom`, `dominantYaw` (alineación del escaneo), `cameraToRoom` + `roomPuppetFrame` (esqueleto en el cuarto).
- **Web**: `app/ruloview/page.tsx`, `components/ruloview/RoomScene.tsx`, `hooks/useRuloview.ts`, `lib/ruloview/scan.ts`. `usePose` aceptó `deviceId` + resolución y entrega los landmarks 2D.
- **Fork** (`~/dev/side/RuView`): three.js 0.185 vendorizado (antes `build/` estaba en `.gitignore` → 404 y el Observatorio/Sala 3D sin escena), sidecar UDP en `python:3.12-alpine` (antes `espressif/idf`, 10 GB), montaje del cuarto en `/ui/ruloview-room/`, Observatorio en "modo cuarto".

## Archivos en la máquina

```
~/.hermes-os/ruloview/
  room/            ← lo ÚNICO que se monta en el contenedor
    room.json      cuarto: tamaño, nodos (x, altura, z), zona de captura, cámara, escaneo
    room.glb       escaneo alineado (lo sube la página)
  provision/       estado de provision.py por nodo (CONTIENE la clave WiFi — no se sirve)
  backups/         flash original de cada placa antes de flashear
  fw/              firmware CSI compilado (S3, sin pantalla)
  esp-venv/        esptool + pyserial + nvs-partition-gen
```

Coordenadas del cuarto: metros, **x** pared izquierda → derecha, **z** pared del fondo (0) → frente, **y** altura.

## Escanear el cuarto

1. Polycam (o Scaniverse/Luma): todas las luces encendidas, recorrer el perímetro despacio a la altura del pecho, una pasada alta (techo, encima del clóset) y una baja (marco de la cama). 1–2 min.
2. Exportar **GLB**. Si solo deja OBJ (.zip con texturas), se convierte: `npx obj2gltf@3 -i escaneo.obj -o escaneo.glb --binary`.
3. `/ruloview` → **Cargar escaneo** (o soltar el archivo). Las paredes se alinean solas; **Girar 90°** hasta que el escritorio quede al fondo.
4. **Escala**: sin LiDAR, el escaneo sale con la textura bien pero el tamaño estimado. Medir algo conocido EN el escaneo (vista **Planta**, tecla P, rejilla de 50 cm a nivel del piso) y poner `Escala × = medida real ÷ medida en el escaneo`. El primer escaneo real salió ~1,64× más chico: la cama doble (1,90 × 1,40) medía 1,12 × 0,88.
5. **Ubicar** (E): `1/2/3/T` y clic sobre el escaneo donde está pegado cada nodo (toma la altura real de la superficie); `C` = cámara maestra, luego clic hacia donde mira.

## Nodos ESP32-S3

`scripts/ruloview-nodo.sh <1|2|3> [ip-destino]` con `RULOVIEW_WIFI_SSID`/`RULOVIEW_WIFI_PASS`: respalda la flash, flashea el firmware CSI, provisiona WiFi + destino + `node-id N` + `tdm-slot N-1/3`, reinicia por watchdog y verifica que lleguen tramas UDP.

- Build del firmware **sin pantalla** (overlay `sdkconfig.defaults.devkitc`): el build por defecto cree ver una pantalla AMOLED inexistente y el CSI cae a 0 pps. Compilar exige `espressif/idf:v5.4` (~10 GB) — se borró después; `~/.hermes-os/ruloview/fw/` guarda los binarios.
- El reset por USB (DTR/RTS) deja al S3 en modo descarga; el watchdog (o alimentarlo de un cargador) arranca normal.
- La Mac recibe en la interfaz Wi-Fi (`en1`) conectada a la red de los nodos; el internet sigue por Ethernet.

## QA

`~/.cache/hermes-pw-venv/bin/python apps/web/scripts/ruloview-qa.py` (datos reales, no simula nada): servidor y 3 nodos en vivo, escaneo cargado, canvas pinta, calibrar/editar, cámara (falsa de Chromium), ambos temas, y el Observatorio en modo cuarto con three.js servido.

## Disco

Colima guarda las imágenes en un disco sparse: `docker rmi` no devuelve espacio al Mac. Si un lease de containerd retiene capas: `colima ssh -- sudo ctr -n moby leases rm --sync <id>`, y después `colima ssh -- sudo fstrim -v /mnt/lima-colima`.
