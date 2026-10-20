# Una sola fuente de verdad y una red que no se cae (2026-10-16)

Pedido: que Hermes en la Mac mini, el MacBook Pro y el teléfono (Hermes Phone
en el S25) tengan **una sola fuente de la verdad** y **la misma marca**, con
una red que funcione desde cualquier parte. La Mac mini es la principal y está
siempre prendida.

## 1 · Quién es la verdad de qué

| Dato | Única fuente | Los demás |
|---|---|---|
| Memoria, conocimiento, tareas, finanzas, hábitos, presencia | **Supabase** (compartido) | todos leen ahí |
| Estado local (gimnasio, foco, compañero, avisos, plan de finanzas, conversaciones) | **`~/.hermes-os/` y `.data/` de la Mac mini** (el agente centro) | el teléfono y el MacBook le preguntan a ESE agente |
| Proyectos | **Vault de Obsidian** en la Mac mini | el MacBook sin vault lee `projects_cache` |
| Marca (colores, letra, radios, la "H") | **`packages/shared/src/brand.ts`** | la web la sigue con un test; el teléfono la recibe generada (`pnpm brand:sync`) |
| Por dónde llegar a Hermes | **`remote_config.agent_routes`** + `/health` | el teléfono las aprende; nada queda grabado en el APK |
| Historial de conversaciones | **El agente centro** (`/conversations/general/history`) | la web y el teléfono muestran el mismo, por hilo |

Regla: **un solo cerebro**. Cada equipo extra es una pantalla (o, si hace
falta, un brazo que ejecuta código en sus propios clones), nunca un segundo
lugar donde se guarde algo.

## 2 · Lo que se hizo hoy

**Marca única.** `brand.ts` tiene los tokens de Grafito (oscuro y claro), la
escala tipográfica, los radios y la geometría de la marca. Un test
(`apps/agent/src/brand/brand.test.ts`) falla si `globals.css`, el favicon o
`HermesMark.tsx` se apartan, si algún texto baja de AA, o si el teléfono no
tiene la marca al día. `pnpm brand:sync` escribe en Hermes Phone su `Brand.kt`,
el icono adaptativo del launcher, el icono de notificaciones y los colores de
ventana. **Hermes Phone ya es Grafito**: grafito frío + índigo Iris, Geist, la
"H" como icono, el índigo solo en lo interactivo (como en la web).

**Red que se cura sola.** La Mac mini cambió de IP tres veces por DHCP (.92 →
.169 → .170) y el teléfono llevaba la .92 grabada: funcionaba solo porque caía
al túnel. Ahora:

- `HERMES_HUB=on` (solo en la Mac mini) → el agente publica su LAN y su
  Tailscale en `remote_config.agent_routes` cuando cambian, y las repite en
  `/health` (`apps/agent/src/net/routes.ts`).
- El teléfono lee esas rutas, las **aprende** de cualquier `/health` que le
  responda (solo IPs privadas o Tailscale: una respuesta rara no lo puede
  mandar a una dirección pública) y las prueba en carrera: LAN → Tailscale →
  túnel. Verificado: pasó de "Conectado · tunnel" a "Conectado · lan" sin
  reinstalar nada.
- El dashboard abierto desde otro equipo le habla al agente de la máquina que
  lo sirve (antes le hablaba a `localhost` = el agente del MacBook).

## 3 · La red "infalible": tres caminos y una Mac que no se apaga

```
                 ┌──────── LAN (casa) ─────── http://<ip-actual>:8650  ← aprendida, no grabada
 Teléfono ──┐    │
 MacBook  ──┼────┼──────── Tailscale ──────── https://mac-mini.<tailnet>.ts.net   ← cualquier red, privada
 Navegador ─┘    │
                 └──────── Túnel Cloudflare ─ https://hermes.<tu-dominio>  ← respaldo público, con Access
                                   │
                              Mac mini (centro, HERMES_HUB=on, siempre prendida)
```

### Lo que te toca a ti (no se puede hacer sin tus manos)

1. **Tailscale** (el camino principal fuera de casa; ya está en el código del
   teléfono y del agente). El CLI de esta Mac apunta a una app que ya no está
   instalada.
   - Mac mini: instalar Tailscale (App Store o `brew install --cask tailscale-app`),
     iniciar sesión, activar MagicDNS en la consola.
   - S25 y MacBook: la app de Tailscale con la misma cuenta.
   - HTTPS con certificado real (para que el micrófono funcione en el navegador
     del celular): `tailscale serve --bg --https=443 31415` (dashboard) y
     `tailscale serve --bg --https=8650 8650` (agente). Luego en el `.env`:
     `HERMES_TAILNET_URL=https://<nombre>.<tailnet>.ts.net:8650`.
   - **No hay que recompilar nada**: el agente publica la ruta y el teléfono la
     aprende en la siguiente conexión.
2. **IP fija en el router**: reserva DHCP para la Mac mini (su IP actual). Con rutas aprendidas ya no es obligatorio, pero evita la
   primera conexión lenta tras un cambio.
3. **Que la Mac vuelva sola tras un corte de luz** (hoy NO vuelve):
   - `sudo pmset -a autorestart 1` (hoy está en 0).
   - FileVault está activo y no hay inicio de sesión automático: tras reiniciar,
     la Mac queda en la pantalla de desbloqueo y Hermes (servicios de usuario)
     no arranca. Opciones: desbloquear FileVault por SSH al arrancar (macOS 26
     lo permite en Apple silicon con Sesión remota activada — verificarlo en
     esta Mac), o apagar FileVault en la Mac mini y activar el inicio de sesión
     automático. Para reinicios planeados: `sudo fdesetup authrestart`.
   - Un **UPS** pequeño para la Mac mini y el router: la mayoría de los cortes
     en Bogotá son de segundos.
4. **Túnel con nombre** (opcional, reemplaza el quick tunnel de URL rotativa):
   un dominio en Cloudflare + `cloudflared tunnel create hermes` + Cloudflare
   Access con tu correo. URL fija, sin publicar en Supabase y con login delante.
5. **Internet de respaldo**: router con failover a 4G (o un módem USB 4G en la
   Mac mini). Sin internet en casa, Tailscale y el túnel caen juntos.

### Vigilancia (para enterarse antes que nadie)

- Un "dead man's switch" externo (Healthchecks.io, gratis) al que el agente
  hace ping cada 5 min; si deja de llegar, te avisa por Telegram/correo.
- El teléfono ya muestra por dónde está conectado ("En casa · red local",
  "Tailscale", "Por el túnel"): si dice túnel estando en casa, algo pasa.

## 4 · El MacBook Pro

Hoy corre su propio agente con su propio `~/.hermes-os/`: lo que hagas ahí en
el gimnasio, el tutor o el compañero se guarda en el MacBook y no en el centro.

**Recomendado:**
1. En el MacBook abre el dashboard **del centro**: `http://192.168.0.170:31415`
   en casa o `https://mac-mini.<tailnet>.ts.net` fuera (instálalo como app desde
   Chrome). Desde hoy ese dashboard ya le habla al agente del centro.
2. El agente del MacBook queda solo para ejecutar código en SUS clones
   (`HERMES_JOBS=off`, `HERMES_TUNNEL=off`, sin `HERMES_HUB`). Se elige en el
   selector de máquina solo para lanzar un run.
3. Siguiente paso (no hecho): que el centro reenvíe los runs al MacBook
   (`/peer/:machine/*` por Tailscale) para que el navegador nunca cambie de
   agente y todo el estado siga en un solo lugar.

## 5 · Pendiente

- Tailscale instalado y `HERMES_TAILNET_URL` (lo de arriba).
- El historial del dashboard web aún usa `/chats` (archivados); pasarlo a
  `/conversations/general/history` (por hilo) para que se vea igual que en el
  teléfono.
- Tema claro en el teléfono: los tokens ya están en `Brand.Light`; falta QA de
  las ilustraciones (jardín, compañero) sobre blanco.
- La app Expo (`mobile/`) sigue con la marca vieja; si Hermes Phone absorbe el
  tutor de inglés, se puede retirar y queda una sola app de teléfono.
