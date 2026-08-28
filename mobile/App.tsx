import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConversationProvider } from "@elevenlabs/react-native";
import { AppProvider } from "./src/store";
import { ChatProvider } from "./src/chat";
import { VoiceProvider } from "./src/voice";
import { RecordingProvider } from "./src/recording";
import { AppShell } from "./src/AppShell";

/**
 * Raíz de Hermes móvil. Orden de providers:
 *  AppProvider (estado)  →  ChatProvider (chat de texto: el stream sobrevive a
 *  navegar)  →  ConversationProvider (ElevenLabs)  →  VoiceProvider
 *  (controlador de voz: usa store + chat + conversation; al colgar pliega el
 *  transcript al hilo)  →  RecordingProvider (grabación de juntas: vive sobre
 *  los tabs para sobrevivir a la navegación)  →  AppShell (tabs).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppProvider>
        <ChatProvider>
          <ConversationProvider>
            <VoiceProvider>
              <RecordingProvider>
                <AppShell />
              </RecordingProvider>
            </VoiceProvider>
          </ConversationProvider>
        </ChatProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
