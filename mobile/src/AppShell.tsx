/**
 * Cáscara de la app: barra de tabs inferior propia (sin router, menos piezas
 * nativas) + banner de "agente offline" + overlay de Ajustes. La pantalla de Voz
 * se mantiene montada aunque cambies de tab (el controlador de voz vive arriba,
 * en la raíz), así la llamada no se corta al navegar.
 */
import React, { useEffect, useRef } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C, mono } from "./theme";
import { useApp, type Tab } from "./store";
import { useRecording } from "./recording";
import { HermesScreen } from "./screens/HermesScreen";
import { MeetingsScreen } from "./screens/MeetingsScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { FinanceScreen } from "./screens/FinanceScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { Loading } from "./ui";

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: "voz", glyph: "◉", label: "Hermes" },
  { key: "reuniones", glyph: "⏺", label: "Reuniones" },
  { key: "proyectos", glyph: "▦", label: "Proyectos" },
  { key: "tareas", glyph: "☰", label: "Tareas" },
  { key: "finanzas", glyph: "◈", label: "Finanzas" },
];

export function AppShell() {
  const app = useApp();
  const insets = useSafeAreaInsets();

  // Gate de sesión: hidratando → splash; sin login → LoginScreen (con Ajustes
  // disponible como escape hatch de conexión manual).
  if (app.authed === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <Loading label="Hermes…" />
      </View>
    );
  }
  if (!app.authed) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
        <LoginScreen />
        <SettingsScreen visible={app.settingsOpen} onClose={() => app.setSettingsOpen(false)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      {app.online === false ? (
        <Pressable onPress={() => app.setSettingsOpen(true)} style={styles.offline}>
          <Text style={styles.offlineText}>
            ⚠ Agente offline — toca para revisar la conexión (⚙)
          </Text>
        </Pressable>
      ) : null}

      {/* La llamada de voz y la grabación de juntas persisten al navegar porque
          sus controladores (VoiceProvider / RecordingProvider) viven en la raíz;
          las pantallas solo consumen su estado. */}
      <View style={{ flex: 1 }}>
        {app.tab === "voz" ? <HermesScreen /> : null}
        {app.tab === "reuniones" ? <MeetingsScreen /> : null}
        {app.tab === "proyectos" ? <ProjectsScreen /> : null}
        {app.tab === "tareas" ? <TasksScreen /> : null}
        {app.tab === "finanzas" ? <FinanceScreen /> : null}
        <RecordingPill />
      </View>

      {/* Tab bar */}
      <View style={[styles.tabbar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        {TABS.map((t) => {
          const on = app.tab === t.key;
          return (
            <Pressable key={t.key} style={styles.tab} onPress={() => app.setTab(t.key)}>
              <Text style={{ color: on ? C.violetHot : C.textDim, fontSize: 19 }}>{t.glyph}</Text>
              <Text style={{ color: on ? C.violetHot : C.textDim, fontSize: 10, marginTop: 2 }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
        <Pressable style={styles.tab} onPress={() => app.setSettingsOpen(true)}>
          <Text style={{ color: C.textDim, fontSize: 19 }}>⚙</Text>
          <Text style={{ color: C.textDim, fontSize: 10, marginTop: 2 }}>Ajustes</Text>
        </Pressable>
      </View>

      <SettingsScreen visible={app.settingsOpen} onClose={() => app.setSettingsOpen(false)} />
    </View>
  );
}

const fmtClock = (sec: number) =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

/**
 * Píldora flotante de grabación en curso: visible en cualquier tab menos
 * Reuniones. Tap → volver a Reuniones; "■" → detener con el MISMO flujo que el
 * botón de la pantalla (el provider persiste y MeetingsScreen sube al montar).
 */
function RecordingPill() {
  const app = useApp();
  const recording = useRecording();
  const pulse = useRef(new Animated.Value(1)).current;
  const active = recording.isRecording || recording.stopping;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  if (!active || app.tab === "reuniones") return null;

  const stopNow = async () => {
    const err = await recording.stop();
    // A Reuniones siempre: ahí vive la subida de la recién persistida.
    app.setTab("reuniones");
    if (err) Alert.alert("No pude guardar la grabación", err);
  };

  return (
    <Pressable
      onPress={() => app.setTab("reuniones")}
      style={({ pressed }) => [styles.pill, pressed ? { opacity: 0.85 } : null]}
    >
      <Animated.View style={[styles.pillDot, { opacity: pulse }]} />
      <Text style={styles.pillLabel}>Grabando</Text>
      <Text style={styles.pillTimer}>{fmtClock(recording.durationSec)}</Text>
      <Pressable
        onPress={() => void stopNow()}
        disabled={recording.stopping}
        hitSlop={8}
        style={({ pressed }) => [
          styles.pillStop,
          { opacity: recording.stopping ? 0.5 : pressed ? 0.7 : 1 },
        ]}
      >
        <Text style={{ color: C.red, fontSize: 13, fontWeight: "800" }}>■</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { ...StyleSheet.absoluteFillObject },
  pill: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: C.panel2,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 15,
    paddingRight: 8,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  pillDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.red },
  pillLabel: { color: C.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  pillTimer: { color: C.red, fontSize: 12.5, fontFamily: mono, fontWeight: "700", letterSpacing: 1 },
  pillStop: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.red,
    backgroundColor: "rgba(251,113,133,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  offline: { backgroundColor: "rgba(251,113,133,0.14)", paddingVertical: 7, paddingHorizontal: 14 },
  offlineText: { color: C.red, fontSize: 11.5, textAlign: "center" },
  tabbar: {
    flexDirection: "row",
    borderTopColor: C.line,
    borderTopWidth: 1,
    backgroundColor: C.panel,
    paddingTop: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 1 },
});
