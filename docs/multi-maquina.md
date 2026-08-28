# Multi-máquina: un dashboard, varios PCs

Escribirle a Hermes desde cualquier PC de la casa entrando al **mismo URL**, y
que cada PC **ejecute en su propio disco**. La UI muestra las máquinas de la red
interna y con un clic eliges a cuál le habla ese navegador.

## Cómo funciona

- **El dashboard lo sirve UNA máquina** (la Mac mini, `:31415`). Todos los PCs
  abren `http://192.168.0.169:31415`. Una sola build, un solo URL.
- **Cada máquina corre su propio agente** (`:8650`) con su propio
  `MACHINE_NAME`, sus propias rutas y su propio login de Claude Code. Los runs
  pasan en la máquina del agente, no en la que sirve el dashboard.
- **El navegador elige el agente** (override en `localStorage`, que ya es
  por-máquina): la Mac se queda en el suyo, el Windows en el suyo. Cambiar de
  máquina recarga la página — recablear todos los SSE/WS en vivo no vale la
  complejidad.
- **El descubrimiento es real**: cada agente publica en su heartbeat
  (`agent_presence`, cada 30 s) su URL LAN, su OS y sus capacidades. El selector
  del header y la sección **Máquinas** del riel se arman de ahí: enciendes un PC
  y aparece; lo apagas y a los 90 s queda `offline`.
- **Datos compartidos**: mismo Supabase para todas (memoria, conocimiento,
  presencia, tareas). Cada fila ya se estampa con la `machine` que la creó.

```
        ┌──────────────── http://192.168.0.169:31415 (una sola web) ───────────────┐
        │                                                                          │
   navegador Mac ──► agente Mac  :8650  (vault + Estudio + gestos + navegador)      │
   navegador Win ──► agente Win  :8650  (solo ejecución: runs de código)            │
        │                                                                          │
        └──────── ambos ──► Supabase (memoria · presencia · proyectos) ─────────────┘
```

## Requisitos de red (LAN con IPs fijas)

1. **Reserva de DHCP** en el router para cada PC (la Mac ya está en
   `192.168.0.169`). Sin IP fija el registry y las URLs publicadas se vencen.
2. **Firewall**: en Windows, la primera vez que el agente escucha en `:8650`,
   permitir el acceso en el **perfil privado** (no público). En la Mac, permitir
   conexiones entrantes para node si el firewall está activo.
3. **El agente solo se abre a la red si hay `HERMES_API_KEY`**: sin key escucha
   en `127.0.0.1` a propósito. La MISMA key en todas las máquinas.
4. **Chrome y la red local**: si el navegador pregunta por acceso a dispositivos
   de la red local, hay que aceptar una vez. Se evita del todo eligiendo la
   máquina en el selector (usa su IP LAN, no `localhost`).

## Máquina nueva (el PC Windows)

Se recomienda **WSL2** en vez de Windows nativo: el agente corre en Linux
(node, pnpm, `claude`, ffmpeg iguales, rutas POSIX) y se pierde exactamente lo
mismo que se perdería en Windows nativo (gestos, control de Chrome por
AppleScript, Terminal.app, notificaciones nativas).

```powershell
# 1. WSL2 con red en modo espejo (así :8650 se ve en la LAN sin portproxy)
wsl --install -d Ubuntu
# En %USERPROFILE%\.wslconfig:
#   [wsl2]
#   networkingMode=mirrored
wsl --shutdown
```

```bash
# 2. Dentro de Ubuntu: node 22 + pnpm + Claude Code (login con la suscripción)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22 && npm i -g pnpm
npm i -g @anthropic-ai/claude-code && claude   # login una vez

# 3. El repo y sus dependencias
mkdir -p ~/dev && cd ~/dev && git clone <hermes-os> hermes-os && cd hermes-os
pnpm install

# 4. .env: copia el de la Mac y cambia SOLO estas líneas
#    MACHINE_NAME=windows-pc          ← distinto (es la PK del heartbeat)
#    VAULT_PATH=                      ← vacío: máquina solo-ejecución
#    HERMES_CODE_ROOT=/home/rulo/dev  ← donde viven los clones aquí
#    ESTUDIO_MEDIA_ROOT=              ← el disco de captura vive en la Mac
#    HERMES_GESTURES=off
#    HERMES_BROWSER_AGENT=off
#    (HERMES_PORT, HERMES_API_KEY y todo Supabase quedan IGUALES)

# 5. Arrancar solo el agente (el dashboard lo sirve la Mac)
./hermes agent
```

`pnpm install` puede fallar al compilar `@jitsi/robotjs` (es macOS-only). Si
pasa: `pnpm install --ignore-scripts` — el módulo se carga de forma perezosa y
el agente arranca sin él (los gestos ya están apagados por env).

Autostart cuando ya funcione a mano: `systemd` de usuario dentro de WSL
(`systemctl --user`) o una tarea del Programador de tareas de Windows que
ejecute `wsl -d Ubuntu -- bash -lc 'cd ~/dev/hermes-os && ./hermes agent'`.

## Verificación

```bash
# 1. El agente nuevo se ve a sí mismo con su dirección publicada
curl -s http://192.168.0.170:8650/health | jq
#   → { "ok": true, "machine": "windows-pc", "baseUrl": "http://192.168.0.170:8650" }

# 2. Las dos máquinas se conocen (desde cualquiera de las dos)
curl -s -H "Authorization: Bearer $HERMES_API_KEY" http://192.168.0.169:8650/machines | jq '.machines[] | {machine, os, online, baseUrl}'

# 3. Desde el navegador del Windows: abrir http://192.168.0.169:31415,
#    clic en "windows-pc" en el header → recarga y ahí queda.
#    El riel muestra Máquinas con OS, estado y "sin vault".
```

## Qué puede cada máquina

| | Mac (con vault) | PC solo-ejecución |
|---|---|---|
| Chat y voz con Hermes | ✅ | ✅ |
| Runs de Claude Code | ✅ | ✅ (en sus propios clones) |
| Proyectos del vault | ✅ escribe notas | ✅ los ve (espejo `projects_cache`), no escribe |
| Juntas, Estudio, hábitos/finanzas | ✅ | ⚠️ requieren vault/disco: se quedan en la Mac |
| Gestos, control de Chrome, Terminal.app | ✅ | ❌ (responde con el motivo, no revienta) |

La UI no adivina: cada máquina publica sus capacidades reales en el heartbeat y
el riel dice lo que falta (`sin vault`, `sin claude`).

## Notas

- **Los runs corren en el clon local**: el vault guarda una sola `ruta_local`
  (la de la Mac), así que `resolveProjectRoot` prueba esa ruta y si no existe
  busca la carpeta bajo `HERMES_CODE_ROOT` (también un nivel adentro). Si no la
  encuentra, se niega con un mensaje claro en vez de correr en el cwd
  equivocado.
- **Un solo dueño del vault**: la máquina sin `VAULT_PATH` nunca escribe notas.
  Es lo que evita dos agentes peleándose por el mismo `.md`.
- **Fuera de casa**: el túnel cloudflared (`com.hermes-os.tunnel`) sigue
  apuntando a la máquina donde corre, y la app móvil llega por ahí. Cruzar de
  máquina desde fuera de la LAN necesitaría un proxy `/peer/:machine/*` en el
  agente — no está hecho.
