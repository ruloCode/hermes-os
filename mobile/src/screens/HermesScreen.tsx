/**
 * Pantalla principal: escribirle Y hablarle a Hermes en un solo hilo.
 *
 * Patrones (Mobbin): ChatGPT — respuesta del asistente a ancho completo, lo
 * tuyo en burbuja derecha, la llamada de voz plegada dentro del hilo al colgar;
 * Gemini Live/Tolan — la voz es un takeover con orbe + fila de controles
 * (minimizar al chat · colgar). La llamada sigue viva minimizada (el
 * controlador vive en la raíz): queda una píldora de estado para volver.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { C, mono } from "../theme";
import { Dim } from "../ui";
import { Markdown } from "../markdown";
import { useApp } from "../store";
import { useChat, type ChatMsg } from "../chat";
import { useVoice } from "../voice";

const BARS = 32;

function Waveform({ active, speaking }: { active: boolean; speaking: boolean }) {
  // Init perezoso (el argumento de useRef se evaluaría en CADA render) y
  // scaleY con native driver: animar height correría en el hilo JS.
  const valsRef = useRef<Animated.Value[] | null>(null);
  if (!valsRef.current) valsRef.current = [...Array(BARS)].map(() => new Animated.Value(0.06));
  const vals = valsRef.current;

  useEffect(() => {
    if (!active) {
      vals.forEach((v) =>
        Animated.timing(v, { toValue: 0.05, duration: 300, useNativeDriver: true }).start(),
      );
      return;
    }
    const loops = vals.map((v, i) => {
      const animate = () =>
        Animated.sequence([
          Animated.timing(v, {
            toValue: 0.3 + Math.abs(Math.sin(i * 1.7)) * 0.7,
            duration: 220 + (i % 7) * 40,
            useNativeDriver: true,
          }),
          Animated.timing(v, {
            toValue: 0.12 + Math.abs(Math.cos(i * 0.9)) * 0.25,
            duration: 220 + (i % 5) * 40,
            useNativeDriver: true,
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
            height: 90,
            borderRadius: 2,
            backgroundColor: active ? color : C.textFaint,
            transform: [{ scaleY: v }],
          }}
        />
      ))}
    </View>
  );
}

/** Punto que respira (píldora de voz activa, "pensando…"). */
function Pulse({ color, size = 8 }: { color: string; size?: number }) {
  const vRef = useRef<Animated.Value | null>(null);
  if (!vRef.current) vRef.current = new Animated.Value(1);
  const v = vRef.current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0.25, duration: 650, useNativeDriver: true }),
        Animated.timing(v, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <Animated.View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: v }}
    />
  );
}

/** Nombre corto y legible de una tool del SDK (mcp__hermes__save_memory → save_memory). */
const toolLabel = (name: string) => name.replace(/^mcp__[^_]+(?:__)?/, "").replace(/^__/, "");

function ToolChips({ tools }: { tools: NonNullable<ChatMsg["tools"]> }) {
  return (
    <View style={styles.toolRow}>
      {tools.slice(-8).map((t, i) => (
        <View key={i} style={styles.toolChip}>
          <Text style={styles.toolText}>
            ⚙ {toolLabel(t.name)}
            {t.target ? <Text style={{ color: C.textDim }}> · {t.target.slice(0, 28)}</Text> : null}
          </Text>
        </View>
      ))}
    </View>
  );
}

const SUGGESTIONS = [
  "¿Qué tengo hoy?",
  "Dame el estado de mis proyectos",
  "¿Qué salió de la última reunión?",
  "¿Cómo van mis finanzas del mes?",
];

export function HermesScreen() {
  const app = useApp();
  const chat = useChat();
  const v = useVoice();
  const [input, setInput] = useState("");
  // La voz en takeover puede minimizarse: la llamada sigue (controlador en la
  // raíz) y aquí queda la píldora para volver.
  const [voiceMin, setVoiceMin] = useState(false);
  // "Marcando": feedback inmediato mientras se pide el token (antes de que el
  // SDK reporte connecting).
  const [dialing, setDialing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const voiceScrollRef = useRef<ScrollView>(null);

  const voiceActive = v.connected || v.connecting;
  const showTakeover = (voiceActive || dialing) && !voiceMin;

  const startVoice = async () => {
    setDialing(true);
    try {
      await v.connect();
    } finally {
      setDialing(false);
    }
  };

  // Al conectar una llamada nueva, el takeover se abre solo.
  useEffect(() => {
    if (voiceActive) return;
    setVoiceMin(false);
  }, [voiceActive]);

  // Autoscroll SOLO si el usuario ya está abajo: si subió a leer, el stream
  // no le secuestra el scroll.
  const nearBottomRef = useRef(true);
  const last = chat.messages[chat.messages.length - 1];
  useEffect(() => {
    if (!nearBottomRef.current) return;
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 40);
    return () => clearTimeout(t);
  }, [chat.messages.length, last?.content, chat.streaming]);

  // Dep = el array (nuevo en cada línea): length se satura con la ventana de 60.
  useEffect(() => {
    voiceScrollRef.current?.scrollToEnd({ animated: true });
  }, [v.transcript]);

  const sendNow = () => {
    const text = input.trim();
    if (!text || chat.streaming) return;
    setInput("");
    nearBottomRef.current = true;
    chat.send(text);
  };

  const voiceStatus = !v.connected
    ? v.connecting || dialing
      ? "CONECTANDO"
      : "OFF"
    : v.action
      ? "EJECUTANDO"
      : v.isSpeaking
        ? "HABLANDO"
        : "ESCUCHANDO";
  const voiceColor = !v.connected
    ? v.connecting || dialing
      ? C.amber
      : C.textDim
    : v.action
      ? C.cyan
      : v.isSpeaking
        ? C.violetHot
        : C.green;

  return (
    <View style={styles.wrap}>
      {/* ── Header ──────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.h1}>HERMES</Text>
          <Dim style={{ fontSize: 10.5, letterSpacing: 2 }}>
            {chat.project ? `CHAT · ${chat.project.toUpperCase()}` : "CHAT + VOZ"}
          </Dim>
        </View>
        <View style={styles.headerRight}>
          <View style={{ alignItems: "flex-end" }}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: app.online === false ? C.red : C.green },
                ]}
              />
              <Dim style={{ fontSize: 10 }}>
                {app.online === false ? "offline" : app.machine ?? "agente"}
              </Dim>
            </View>
          </View>
          {chat.messages.length > 0 && !showTakeover ? (
            <Pressable
              onPress={chat.newChat}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Nueva conversación"
              style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.6 } : null]}
            >
              <Text style={{ color: C.textDim, fontSize: 16 }}>✎</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {showTakeover ? (
        /* ── Takeover de voz (Gemini Live / Tolan) ───────────────────── */
        <View style={{ flex: 1 }}>
          <View style={styles.stage}>
            <Waveform active={v.connected} speaking={v.isSpeaking} />
            <Text
              style={{
                color: voiceColor,
                fontSize: 12,
                letterSpacing: 3,
                fontWeight: "700",
                marginTop: 16,
              }}
            >
              {voiceStatus}
            </Text>
            {v.action ? (
              <Text style={{ color: C.cyan, fontSize: 12, marginTop: 8 }}>⚙ {v.action}…</Text>
            ) : null}
          </View>

          <View style={styles.voiceTranscript}>
            <ScrollView ref={voiceScrollRef} showsVerticalScrollIndicator={false}>
              {v.error ? (
                <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 19 }}>⚠ {v.error}</Text>
              ) : v.transcript.length ? (
                v.transcript.slice(-30).map((l, i) => (
                  <View key={i} style={styles.voiceLine}>
                    <Text
                      style={{
                        color: l.who === "TÚ" ? C.cyan : C.violetHot,
                        fontWeight: "700",
                        fontSize: 11.5,
                        width: 58,
                      }}
                    >
                      {l.who}
                    </Text>
                    <Text style={{ color: C.text, fontSize: 13, flex: 1, lineHeight: 19 }}>
                      {l.text}
                    </Text>
                  </View>
                ))
              ) : (
                <Dim style={{ fontSize: 13 }}>
                  {v.connected ? "Hermes te escucha…" : "Conectando con Hermes…"}
                </Dim>
              )}
            </ScrollView>
          </View>

          {/* Controles: minimizar al chat · colgar */}
          <View style={styles.callControls}>
            <Pressable
              onPress={() => setVoiceMin(true)}
              accessibilityRole="button"
              accessibilityLabel="Minimizar al chat"
              style={({ pressed }) => [styles.ctrlBtn, pressed ? { opacity: 0.7 } : null]}
            >
              <Text style={{ color: C.text, fontSize: 18 }}>💬</Text>
            </Pressable>
            <Pressable
              onPress={v.disconnect}
              accessibilityRole="button"
              accessibilityLabel="Colgar la llamada"
              style={({ pressed }) => [styles.ctrlBtn, styles.ctrlEnd, pressed ? { opacity: 0.8 } : null]}
            >
              <Text style={{ color: "#fff", fontSize: 17, fontWeight: "800" }}>✕</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        /* ── Hilo de chat ────────────────────────────────────────────── */
        <View style={{ flex: 1 }}>
          {voiceActive ? (
            <Pressable onPress={() => setVoiceMin(false)} style={styles.voicePill}>
              <Pulse color={voiceColor} />
              <Text style={{ color: C.text, fontSize: 11.5, fontWeight: "700" }}>
                Voz activa · {voiceStatus}
              </Text>
              <Text style={{ color: C.textDim, fontSize: 11 }}>tocar para abrir</Text>
            </Pressable>
          ) : null}

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={styles.thread}
            showsVerticalScrollIndicator={false}
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              nearBottomRef.current =
                contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            }}
            scrollEventThrottle={100}
          >
            {chat.messages.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Habla o escríbele a Hermes</Text>
                <Dim style={{ fontSize: 13, lineHeight: 20, textAlign: "center" }}>
                  Tiene todo tu contexto: proyectos, memoria, reuniones, tareas y finanzas.
                  Funciona desde cualquier red.
                </Dim>
                <View style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable
                      key={s}
                      onPress={() => chat.send(s)}
                      style={({ pressed }) => [styles.sugChip, pressed ? { opacity: 0.6 } : null]}
                    >
                      <Text style={{ color: C.violetHot, fontSize: 12.5 }}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : (
              chat.messages.map((m, i) => {
                const prev = chat.messages[i - 1];
                const voiceStart = m.via === "voz" && prev?.via !== "voz";
                const isLast = i === chat.messages.length - 1;
                const thinking =
                  isLast && chat.streaming && m.role === "assistant" && !m.content;
                return (
                  <View key={`${m.at}-${i}`}>
                    {voiceStart ? (
                      <View style={styles.voiceDivider}>
                        <View style={styles.divLine} />
                        <Text style={styles.divText}>◉ LLAMADA DE VOZ</Text>
                        <View style={styles.divLine} />
                      </View>
                    ) : null}
                    {m.role === "user" ? (
                      <View style={[styles.userBubble, m.via ? styles.viaVoz : null]}>
                        <Text style={styles.userText}>{m.content}</Text>
                      </View>
                    ) : (
                      <View style={[styles.assistantBlock, m.via ? styles.viaVoz : null]}>
                        {m.tools?.length ? <ToolChips tools={m.tools} /> : null}
                        {thinking ? (
                          <View style={styles.thinking}>
                            <Pulse color={C.violet} size={7} />
                            <Dim style={{ fontSize: 12.5 }}>Hermes está pensando…</Dim>
                          </View>
                        ) : m.via ? (
                          <Text style={styles.voiceMsgText}>{m.content}</Text>
                        ) : (
                          <Markdown source={m.content} />
                        )}
                      </View>
                    )}
                  </View>
                );
              })
            )}
            {chat.error ? (
              <View style={styles.errorBox}>
                <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 18 }}>⚠ {chat.error}</Text>
              </View>
            ) : null}
            {v.error && !voiceActive ? (
              <View style={styles.errorBox}>
                <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 18 }}>
                  ⚠ Voz: {v.error}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* ── Composer (píldora + botón contextual: enviar/voz/stop) ── */}
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="Escríbele a Hermes…"
              placeholderTextColor={C.textFaint}
              multiline
            />
            {chat.streaming ? (
              <Pressable
                onPress={chat.stop}
                accessibilityRole="button"
                accessibilityLabel="Detener la respuesta"
                style={({ pressed }) => [styles.fab, styles.fabStop, pressed ? { opacity: 0.7 } : null]}
              >
                <Text style={{ color: C.red, fontSize: 14, fontWeight: "800" }}>■</Text>
              </Pressable>
            ) : input.trim() ? (
              <Pressable
                onPress={sendNow}
                accessibilityRole="button"
                accessibilityLabel="Enviar"
                style={({ pressed }) => [styles.fab, styles.fabSend, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={{ color: C.bg, fontSize: 17, fontWeight: "800" }}>↑</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => (voiceActive ? setVoiceMin(false) : void startVoice())}
                accessibilityRole="button"
                accessibilityLabel="Hablar con Hermes"
                style={({ pressed }) => [styles.fab, styles.fabVoice, pressed ? { opacity: 0.8 } : null]}
              >
                <Text style={{ color: C.violetHot, fontSize: 16 }}>◉</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 8,
  },
  h1: { color: C.text, fontSize: 24, fontWeight: "800", letterSpacing: 3 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.panel,
  },

  // Voz (takeover)
  stage: { alignItems: "center", justifyContent: "center", paddingVertical: 26 },
  wave: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    height: 100,
  },
  voiceTranscript: {
    flex: 1,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 18,
  },
  voiceLine: { flexDirection: "row", gap: 6, marginBottom: 9 },
  callControls: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 18,
    paddingVertical: 16,
  },
  ctrlBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
    alignItems: "center",
    justifyContent: "center",
  },
  ctrlEnd: { backgroundColor: C.red, borderColor: C.red },

  // Píldora de voz activa minimizada
  voicePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginBottom: 6,
  },

  // Hilo
  thread: { paddingHorizontal: 18, paddingBottom: 12, paddingTop: 4 },
  empty: { alignItems: "center", paddingTop: 60, gap: 12, paddingHorizontal: 8 },
  emptyTitle: { color: C.text, fontSize: 18, fontWeight: "800", letterSpacing: 0.3 },
  suggestions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
    marginTop: 14,
  },
  sugChip: {
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(122,132,255,0.08)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "84%",
    backgroundColor: "rgba(122,132,255,0.16)",
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 18,
    borderBottomRightRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 14,
    marginVertical: 5,
  },
  userText: { color: C.text, fontSize: 14, lineHeight: 20 },
  assistantBlock: { marginVertical: 6 },
  viaVoz: { opacity: 0.82 },
  voiceMsgText: { color: C.text, fontSize: 13.5, lineHeight: 20, opacity: 0.92 },
  thinking: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  toolRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  toolChip: {
    borderWidth: 1,
    borderColor: "rgba(34,211,238,0.25)",
    backgroundColor: "rgba(34,211,238,0.07)",
    borderRadius: 6,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  toolText: { color: C.cyan, fontSize: 10.5, fontFamily: mono },
  voiceDivider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginVertical: 10,
  },
  divLine: { flex: 1, height: 1, backgroundColor: C.line },
  divText: { color: C.textDim, fontSize: 9.5, letterSpacing: 1.5, fontWeight: "700" },
  errorBox: {
    borderWidth: 1,
    borderColor: "rgba(251,113,133,0.35)",
    backgroundColor: "rgba(251,113,133,0.08)",
    borderRadius: 10,
    padding: 12,
    marginVertical: 8,
  },

  // Composer
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    color: C.text,
    fontSize: 14.5,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  fab: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  fabSend: { backgroundColor: C.violet, borderColor: C.violet },
  fabVoice: { backgroundColor: "rgba(122,132,255,0.12)", borderColor: C.violet },
  fabStop: { backgroundColor: "rgba(251,113,133,0.12)", borderColor: C.red },
});
