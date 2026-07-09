# Hermes móvil (Android)

App React Native (Expo SDK 55) que habla con tu agente Hermes local (`:8650`).
Es **standalone**: vive fuera del workspace pnpm para no arrastrar el build de
Metro. Consume el mismo backend que el dashboard, así que tiene **todo tu
contexto** (proyectos, memoria, reuniones, tareas).

## Qué hace

- **Voz** (prioridad #1): llamada en tiempo real con Hermes vía ElevenLabs
  (WebRTC). Las _client tools_ corren en el teléfono y llaman a `:8650`, así que
  es el **mismo agente de voz** del dashboard: `focus_project`, `work_on_project`,
  `run_task`, `check_task`, `get_project_status`, `search_memory`, `save_memory`,
  `get_daily_brief`. La llamada sobrevive al cambiar de pestaña.
- **Reuniones** (prioridad #2): graba la junta por micrófono → sube a `/meetings`
  → transcribe + resume + saca 2 accionables, con triage (ejecutar/pendiente/ignorar).
- **Proyectos**: estado real del vault (`/projects`).
- **Tareas**: tablero de misión (`/tracker/tasks`) con completar/ignorar/ejecutar.
- **Ajustes**: cambia la URL del agente y el Bearer (LAN o Tailscale).

## Requisitos para que funcione

1. **El agente debe correr con `HERMES_API_KEY`** (ya lo tienes) para escuchar en
   la red (`0.0.0.0:8650`), no solo en loopback.
2. Se añadió el endpoint `GET /elevenlabs/token` en `apps/agent` (sirve el token
   de voz sin exponer la `xi-api-key`). **Ya está vivo** (el agente recargó solo);
   verificado E2E: devuelve un `conversationToken` real de ElevenLabs. Si reinicias
   el agente, sigue disponible (está en el código).
3. El teléfono debe estar en la **misma WiFi** que el Mac (o alcanzarlo por
   Tailscale). Defaults bakeados: `http://192.168.0.92:8650` + tu key. Editables
   en Ajustes (⚙).

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
- El APK trae la `HERMES_API_KEY` embebida (uso personal en tu teléfono). No lo
  compartas públicamente.
- Stack de voz fijado a las versiones probadas por ElevenLabs (Expo 55 / RN
  0.83.6 / `@livekit/react-native-webrtc@137` / `@config-plugins/react-native-webrtc@14`).
