/**
 * Cáscara de la app: barra de tabs inferior propia (sin router, menos piezas
 * nativas) + banner de "agente offline" + overlay de Ajustes. La pantalla de Voz
 * se mantiene montada aunque cambies de tab (el controlador de voz vive arriba,
 * en la raíz), así la llamada no se corta al navegar.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { C } from "./theme";
import { useApp, type Tab } from "./store";
import { VoiceScreen } from "./screens/VoiceScreen";
import { MeetingsScreen } from "./screens/MeetingsScreen";
import { ProjectsScreen } from "./screens/ProjectsScreen";
import { TasksScreen } from "./screens/TasksScreen";
import { FinanceScreen } from "./screens/FinanceScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { Loading } from "./ui";

const TABS: { key: Tab; glyph: string; label: string }[] = [
  { key: "voz", glyph: "◉", label: "Voz" },
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

      {/* La llamada de voz persiste al navegar porque el controlador (VoiceProvider)
          vive en la raíz; las pantallas solo consumen su estado. */}
      <View style={{ flex: 1 }}>
        {app.tab === "voz" ? <VoiceScreen /> : null}
        {app.tab === "reuniones" ? <MeetingsScreen /> : null}
        {app.tab === "proyectos" ? <ProjectsScreen /> : null}
        {app.tab === "tareas" ? <TasksScreen /> : null}
        {app.tab === "finanzas" ? <FinanceScreen /> : null}
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

const styles = StyleSheet.create({
  page: { ...StyleSheet.absoluteFillObject },
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
