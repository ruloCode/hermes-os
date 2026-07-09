import { registerRootComponent } from "expo";
// registerGlobals() polyfilla WebRTC (getUserMedia, RTCPeerConnection…) para RN.
// DEBE correr antes de que ElevenLabs/LiveKit abran la conexión de voz.
import { registerGlobals } from "@livekit/react-native";
import { loadConfig } from "./src/config";
import App from "./App";

registerGlobals();
// Hidrata la URL/Bearer del agente desde AsyncStorage (sobre los defaults del .env).
void loadConfig();

// registerRootComponent = AppRegistry.registerComponent('main', () => App).
registerRootComponent(App);
