/**
 * Llamada con la tutora (takeover dentro de Inglés). Patrón Speak/ElevenReader:
 * lo que ella está diciendo es el héroe (grande, arriba), la conversación
 * queda debajo con lo tuyo en burbujas, y el único control fuerte es colgar.
 * La llamada vive en VoiceProvider (raíz): cambiar de pestaña no la corta.
 */
import React, { useEffect, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVoice } from "../voice";
import { C, mono } from "../theme";
import { fmtClock } from "../meetings/format";

export function TutorCall({ reviewing }: { reviewing: string | null }) {
  const v = useVoice();
  const scrollRef = useRef<ScrollView>(null);
  const pulse = useRef(new Animated.Value(1)).current;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: v.isSpeaking ? 1.18 : 1.06, duration: 520, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v.isSpeaking, pulse]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [v.tutorLines.length]);

  const lastTutor = [...v.tutorLines].reverse().find((l) => l.who === "TUTORA");
  const history = v.tutorLines.slice(0, lastTutor ? v.tutorLines.lastIndexOf(lastTutor) : undefined);
  const elapsed = v.callStartedAt ? (now - v.callStartedAt) / 1000 : 0;
  const status = v.connecting
    ? "Conectando con tu tutora…"
    : v.isSpeaking
      ? "Te está hablando"
      : "Te escucha — habla en inglés";

  return (
    <View style={styles.wrap}>
      <View style={styles.top}>
        <Animated.View style={[styles.orb, { transform: [{ scale: pulse }] }, v.isSpeaking ? styles.orbOn : null]}>
          <Ionicons name={v.isSpeaking ? "volume-high" : "mic"} size={22} color={C.bg} />
        </Animated.View>
        <View style={{ flex: 1 }}>
          <Text style={styles.who}>Tutora de inglés</Text>
          <Text style={styles.status}>{status}</Text>
        </View>
        <Text style={styles.timer}>{fmtClock(elapsed)}</Text>
      </View>

      {reviewing ? (
        <View style={styles.reviewing}>
          <Ionicons name="repeat" size={14} color={C.amber} />
          <Text style={styles.reviewingText} numberOfLines={1}>
            Repasando {reviewing}
          </Text>
        </View>
      ) : null}

      <View style={styles.hero}>
        <Text style={styles.heroText} accessibilityLiveRegion="polite">
          {lastTutor?.text ?? (v.connecting ? "…" : "Saluda para empezar.")}
        </Text>
      </View>

      <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={{ paddingBottom: 12 }}>
        {history.map((l, i) =>
          l.who === "TÚ" ? (
            <View key={i} style={styles.mine}>
              <Text style={styles.mineText}>{l.text}</Text>
            </View>
          ) : (
            <Text key={i} style={styles.theirs}>
              {l.text}
            </Text>
          ),
        )}
        {v.tutorLines.length && v.tutorLines[v.tutorLines.length - 1].who === "TÚ" ? (
          <View style={styles.mine}>
            <Text style={styles.mineText}>{v.tutorLines[v.tutorLines.length - 1].text}</Text>
          </View>
        ) : null}
      </ScrollView>

      {v.action ? <Text style={styles.action}>✓ {v.action}</Text> : null}
      {v.error ? <Text style={styles.error}>⚠ {v.error}</Text> : null}

      <Pressable
        onPress={v.disconnect}
        accessibilityRole="button"
        accessibilityLabel="Terminar la práctica"
        style={({ pressed }) => [styles.end, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="call" size={20} color={C.bg} style={{ transform: [{ rotate: "135deg" }] }} />
        <Text style={styles.endText}>Terminar práctica</Text>
      </Pressable>
      <Text style={styles.hint}>
        Al colgar se guarda sola. Dile "let's wrap up" y te deja el resumen con tus correcciones.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10, gap: 12 },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  orb: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.violet,
    alignItems: "center",
    justifyContent: "center",
  },
  orbOn: { backgroundColor: C.green },
  who: { color: C.text, fontSize: 16, fontWeight: "800" },
  status: { color: C.textDim, fontSize: 12.5, marginTop: 2 },
  timer: { color: C.textDim, fontFamily: mono, fontSize: 14, fontVariant: ["tabular-nums"] },
  reviewing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: C.amber,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  reviewingText: { color: C.amber, fontSize: 12, fontWeight: "700" },
  hero: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    minHeight: 120,
    justifyContent: "center",
  },
  heroText: { color: C.text, fontSize: 21, lineHeight: 30, fontWeight: "600" },
  thread: { flex: 1 },
  theirs: { color: C.textDim, fontSize: 14, lineHeight: 21, marginBottom: 10, maxWidth: "88%" },
  mine: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: "rgba(122,132,255,0.16)",
    borderRadius: 14,
    borderBottomRightRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  mineText: { color: C.text, fontSize: 14, lineHeight: 20 },
  action: { color: C.green, fontSize: 12.5, textAlign: "center" },
  error: { color: C.red, fontSize: 12.5, textAlign: "center" },
  end: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    height: 54,
    borderRadius: 27,
    backgroundColor: C.red,
  },
  endText: { color: C.bg, fontSize: 15.5, fontWeight: "800" },
  hint: { color: C.textFaint, fontSize: 11.5, textAlign: "center" },
});
