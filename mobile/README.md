# Hermes móvil (Android)

App React Native (Expo SDK 55) que habla con tu agente Hermes **desde cualquier
red**: en la casa va directo por LAN y afuera entra por el túnel público de
cloudflared (servicio `com.hermes-os.tunnel`). Es **standalone**: vive fuera del
workspace pnpm para no arrastrar el build de Metro. Consume el mismo backend que
el dashboard, así que tiene **todo tu contexto** (proyectos, memoria, reuniones,
tareas, finanzas).

## Qué hace

- **Login** (email+contraseña, Supabase Auth): la puerta de la app. La sesión
  (JWT 1h + refresh automático) es la credencial contra el agente — la API key
  de la casa ya no viaja en el APK. Credenciales de prueba en el `.env` raíz
  (`HERMES_MOBILE_USER` / `HERMES_MOBILE_PASSWORD`).
- **Conexión automática**: sondea `URL manual → LAN → túnel` y activa la primera
  viva. El túnel se descubre leyendo `remote_config.agent_public_url` de
  Supabase (RLS: solo autenticados; lo publica `scripts/hermes-tunnel.sh` en
  cada arranque). Se re-resuelve al volver la app del background (cambio de red).
- **Voz**: llamada en tiempo real con Hermes vía ElevenLabs (WebRTC, funciona
  desde cualquier red). Las _client tools_ corren en el teléfono con **paridad
  total** con el dashboard: proyectos, tareas, memoria, brief, finanzas
  (registrar gastos, saldos, resumen), hábitos, metas y Google Calendar. La
  llamada sobrevive al cambiar de pestaña.
- **Reuniones**: graba la junta por micrófono → sube a `/meetings` → transcribe
  + resume + saca accionables, con triage (ejecutar/pendiente/ignorar).
- **Proyectos**: estado real del vault (`/projects`).
- **Tareas**: tablero de misión (`/tracker/tasks`) con vista **Hoy** (lo creado,
  movido o terminado en el día) y filtros por estado/proyecto.
- **Finanzas**: resumen del mes (COP combinado con TRM), billeteras, registro
  rápido de movimientos y últimos movimientos con anulación.
- **Ajustes**: cuenta (cerrar sesión) + URL manual y API key como escape hatch.

## Requisitos para que funcione

1. **El agente debe correr con `HERMES_API_KEY`** (ya lo tienes) para escuchar en
   la red (`0.0.0.0:8650`). Su middleware acepta esa key **o** un JWT de Supabase
   (lo que manda la app tras el login).
2. **Túnel**: `./hermes install` deja `com.hermes-os.tunnel` corriendo al login
   (cloudflared quick tunnel + publicación de la URL en Supabase). `./hermes
   doctor` muestra la URL pública vigente.
3. Supabase con la migración `013_remote_config.sql` aplicada y un usuario en
   Auth (ya hay uno creado; credenciales en el `.env` raíz).

## Instalar el APK

El APK autónomo (firmado con debug key, con el bundle embebido — no necesita
Metro) queda en:

```
mobile/android/app/build/outputs/apk/release/app-release.apk
```

Instálalo con ADB (teléfono con Depuración USB activada):

```bash
adb install -r mobile/android/app/build/outputs/apk/release/app-release.apk
```

O pásalo al teléfono (AirDrop/Drive/USB) y ábrelo; permite "instalar apps de
orígenes desconocidos".

## Recompilar desde cero

```bash
cd mobile
npm install --legacy-peer-deps
npx expo prebuild -p android --clean
cd android
ANDROID_HOME=/opt/homebrew/share/android-commandlinetools \
JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
./gradlew assembleRelease
```

## Notas / límites conocidos

- La grabación de reuniones corre en **primer plano**: mantén Hermes abierto
  durante la junta (ponla en altavoz para captar ambos lados). El foreground
  service para grabar con pantalla apagada es un siguiente paso.
- Voz + WebRTC exige módulos nativos (LiveKit) → **no corre en Expo Go**, solo en
  este build nativo. Por eso el APK.
- El APK ya **no** trae la `HERMES_API_KEY` embebida: la credencial es la sesión
  del login. Solo van bakeadas la URL LAN y las claves *publicables* de Supabase.
- El quick tunnel de cloudflared limita el body a ~100 MB → reuniones de hasta
  ≈2h de audio (AAC 128kbps) por el túnel; por LAN no hay límite práctico.
- La URL del túnel **cambia en cada arranque** del servicio (quick tunnel sin
  cuenta). La app lo maneja sola vía Supabase; si algún día quieres URL fija,
  el paso siguiente es un named tunnel con dominio propio.
- Stack de voz fijado a las versiones probadas por ElevenLabs (Expo 55 / RN
  0.83.6 / `@livekit/react-native-webrtc@137` / `@config-plugins/react-native-webrtc@14`).
