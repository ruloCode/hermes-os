/**
 * Pantalla de Voz: orbe/waveform que reacciona (verde=escuchando, violeta=Hermes
 * hablando), estado de la llamada, transcripción en vivo y botón de conectar.
 * Todo el estado sale de useVoice (el controlador persistente en la raíz).
 */
import React, { useEffect, useRef } from "react";
import { Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { C } from "../theme";
import { Button, Dim } from "../ui";
import { useVoice } from "../voice";
import { useApp } from "../store";

const BARS = 32;

function Waveform({ active, speaking }: { active: boolean; speaking: boolean }) {
  const vals = useRef([...Array(BARS)].map(() => new Animated.Value(0.15))).current;

  useEffect(() => {
    if (!active) {
      vals.forEach((v) => Animated.timing(v, { toValue: 0.12, duration: 300, useNativeDriver: false }).start());
      return;
    }
    const loops = vals.map((v, i) => {
      const animate = () =>
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.3 + Math.abs(Math.sin(i * 1.7)) * 0.7,
            duration: 220 + (i % 7) * 40,
            useNativeDriver: false,
          }),
          Animated.timing(v, {
            toValue: 0.12 + Math.abs(Math.cos(i * 0.9)) * 0.25,
            duration: 220 + (i % 5) * 40,
            useNativeDriver: false,
          }),
        ]);
      const loop = Animated.loop(animate());
      loop.start();
      return loop;
    });
    return () => loops.forEach((l) => l.stop());
  }, [active, vals]);

  const color = speaking ? C.violetHot : C.green;
  return (
    <View style={styles.wave}>
      {vals.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            borderRadius: 2,
            backgroundColor: active ? color : C.textFaint,
            height: v.interpolate({ inputRange: [0, 1], outputRange: [4, 90] }),
          }}
        />
      ))}
    </View>
  );
}

export function VoiceScreen() {
  const v = useVoice();
  const app = useApp();
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [v.transcript.length]);

  const status = !v.connected
    ? v.connecting
      ? "CONECTANDO"
      : "OFF"
    : v.action
      ? "EJECUTANDO"
      : v.isSpeaking
        ? "HABLANDO"
        : "ESCUCHANDO";
  const statusColor = !v.connected
    ? v.connecting
      ? C.amber
      : C.textDim
    : v.action
      ? C.cyan
      : v.isSpeaking
        ? C.violetHot
        : C.green;

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>HERMES</Text>
          <Dim style={{ fontSize: 11, letterSpacing: 2 }}>VOZ · TIEMPO REAL</Dim>
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <Text style={{ color: statusColor, fontSize: 11, letterSpacing: 2, fontWeight: "700" }}>
            {status}
          </Text>
          <Dim style={{ fontSize: 10 }}>
            {app.online === false ? "agente offline" : app.machine ?? ""}
          </Dim>
        </View>
      </View>

      <View style={styles.stage}>
        <Waveform active={v.connected} speaking={v.isSpeaking} />
        {v.action ? (
          <Text style={{ color: C.cyan, fontSize: 12, marginTop: 12 }}>⚙ {v.action}…</Text>
        ) : null}
      </View>

      <View style={styles.transcriptBox}>
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
          {v.error ? (
            <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 19 }}>⚠ {v.error}</Text>
          ) : v.transcript.length ? (
            v.transcript.map((l, i) => (
              <View key={i} style={styles.line}>
                <Text
                  style={{
                    color: l.who === "TÚ" ? C.cyan : C.violetHot,
                    fontWeight: "700",
                    fontSize: 12,
                    width: 62,
                  }}
                >
                  {l.who}
                </Text>
                <Text style={{ color: C.text, fontSize: 13, flex: 1, lineHeight: 19 }}>
                  {l.text}
                </Text>
              </View>
            ))
          ) : v.connected ? (
            <Dim style={{ fontSize: 13 }}>Hermes te escucha…</Dim>
          ) : (
            <Dim style={{ fontSize: 13, lineHeight: 20 }}>
              Inicia la voz para hablar con Hermes en tiempo real. Tiene todo tu contexto:
              proyectos, memoria, reuniones y tareas.
            </Dim>
          )}
        </ScrollView>
      </View>

      {v.connected ? (
        <Button label="Terminar llamada" color={C.red} onPress={v.disconnect} />
      ) : (
        <Button
          label={v.connecting ? "Conectando…" : "◉  Iniciar voz"}
          color={C.violet}
          filled
          disabled={v.connecting}
          onPress={() => void v.connect()}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10, gap: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  h1: { color: C.text, fontSize: 26, fontWeight: "800", letterSpacing: 3 },
  stage: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 22,
  },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 100,
  },
  transcriptBox: {
    flex: 1,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  line: { flexDirection: "row", gap: 6, marginBottom: 9 },
});
