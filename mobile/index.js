// Antes que todo: polyfills que otros módulos usan AL CARGAR (DOMException)
// y el guardián que muestra un error de JS en vez de cerrar la app.
import "./src/polyfills";
import "./src/crash-install";
import { registerRootComponent } from "expo";
// registerGlobals() polyfilla WebRTC (getUserMedia, RTCPeerConnection…) para RN.
// DEBE correr antes de que ElevenLabs/LiveKit abran la conexión de voz.
import { registerGlobals } from "@livekit/react-native";
import { loadConfig } from "./src/config";
import { Root } from "./src/root";

registerGlobals();
// Hidrata la URL/Bearer del agente desde AsyncStorage (sobre los defaults del .env).
void loadConfig();

// registerRootComponent = AppRegistry.registerComponent('main', () => Root).
// Root carga App de forma diferida: un error al evaluar módulos se ve en
// pantalla en vez de cerrar la app.
registerRootComponent(Root);
