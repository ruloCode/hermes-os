import React from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ConversationProvider } from "@elevenlabs/react-native";
import { AppProvider } from "./src/store";
import { VoiceProvider } from "./src/voice";
import { AppShell } from "./src/AppShell";

/**
 * Raíz de Hermes móvil. Orden de providers:
 *  AppProvider (estado)  →  ConversationProvider (ElevenLabs)  →  VoiceProvider
 *  (controlador de voz: usa store + conversation)  →  AppShell (tabs).
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AppProvider>
        <ConversationProvider>
          <VoiceProvider>
            <AppShell />
          </VoiceProvider>
        </ConversationProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}
