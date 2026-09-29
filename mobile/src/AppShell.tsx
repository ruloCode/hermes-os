/**
 * Cáscara de la app: barra de tabs inferior propia (sin router, menos piezas
 * nativas) + chip de conexión + overlay de Ajustes. La pantalla de Voz se
 * mantiene montada aunque cambies de tab (el controlador de voz vive arriba,
 * en la raíz), así la llamada no se corta al navegar.
 *
 * Navegación (referencias Mobbin: Savee y Apple Fitness para la barra
 * flotante con píldora activa; Garmin para el juego de 5 destinos):
 *  - CINCO destinos, ni uno más. Ajustes NO es un destino —es un overlay— y
 *    vive en la cabecera de cada pantalla (ScreenTitle / header de Hermes).
 *  - La barra flota, pero su altura se RESERVA en el contenedor de contenido:
 *    sin eso taparía el final de los scrolls de cada pantalla.
 *  - Estado activo = píldora + icono relleno + color, no solo color: el color
 *    por sí solo no basta para quien no lo distingue.
 *  - El aviso de offline es un overlay absoluto; antes empujaba el layout
 *    entero al aparecer y desaparecer.
 */
import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
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

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const TABS: { key: Tab; icon: IconName; iconOn: IconName; label: string }[] = [
  { key: "voz", icon: "chatbubbles-outline", iconOn: "chatbubbles", label: "Hermes" },
  { key: "reuniones", icon: "mic-outline", iconOn: "mic", label: "Reuniones" },
  { key: "proyectos", icon: "grid-outline", iconOn: "grid", label: "Proyectos" },
  { key: "tareas", icon: "checkbox-outline", iconOn: "checkbox", label: "Tareas" },
  { key: "finanzas", icon: "wallet-outline", iconOn: "wallet", label: "Finanzas" },
];

const BAR_H = 62;

export function AppShell() {
  const app = useApp();
  const insets = useSafeAreaInsets();
  const barBottom = Math.max(insets.bottom, 10);

  // La MainActivity va en adjustResize: al abrir el teclado la ventana encoge y
  // una barra flotante quedaria pegada ENCIMA del teclado, comiendose el sitio
  // justo mientras escribes. Se esconde, como hace cualquier app con chat.
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboard(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // Boton ATRAS de Android. Antes no se manejaba: pulsarlo salia de la app
  // desde cualquier sitio, incluso con Ajustes abierto. Orden de prioridad:
  // overlay -> detalle de la pantalla (pila del store) -> tab inicial -> salir.
  const { settingsOpen, setSettingsOpen, handleBack, tab, setTab } = app;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (handleBack()) return true;
      if (tab !== "voz") {
        setTab("voz");
        return true;
      }
      return false; // en Hermes y sin nada abierto: que salga, como se espera
    });
    return () => sub.remove();
  }, [settingsOpen, setSettingsOpen, handleBack, tab, setTab]);

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
      {/* La llamada de voz y la grabación de juntas persisten al navegar porque
          sus controladores (VoiceProvider / RecordingProvider) viven en la raíz;
          las pantallas solo consumen su estado. */}
      <View style={{ flex: 1, paddingBottom: keyboard ? 0 : BAR_H + barBottom + 8 }}>
        {app.tab === "voz" ? <HermesScreen /> : null}
        {app.tab === "reuniones" ? <MeetingsScreen /> : null}
        {app.tab === "proyectos" ? <ProjectsScreen /> : null}
        {app.tab === "tareas" ? <TasksScreen /> : null}
        {app.tab === "finanzas" ? <FinanceScreen /> : null}
      </View>

      {/* Offline: overlay, no ocupa sitio en el layout (antes empujaba todo). */}
      {app.online === false ? (
        <Pressable
          onPress={() => app.setSettingsOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Agente offline. Abrir ajustes de conexión"
          style={({ pressed }) => [styles.offline, { top: 0 }, pressed ? { opacity: 0.8 } : null]}
        >
          <View style={styles.offlineDot} />
          <Text style={styles.offlineText}>Agente offline — toca para revisar la conexión</Text>
        </Pressable>
      ) : null}

      <RecordingPill bottomOffset={keyboard ? 14 : barBottom + BAR_H + 14} />

      {keyboard ? null : (
      <View
        accessibilityRole="tablist"
        style={[styles.tabbar, { bottom: barBottom, height: BAR_H }]}
      >
        {TABS.map((t) => {
          const on = app.tab === t.key;
          return (
            <Pressable
              key={t.key}
              onPress={() => app.setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
              style={({ pressed }) => [
                styles.tab,
                on ? styles.tabOn : null,
                pressed && !on ? { opacity: 0.55 } : null,
              ]}
            >
              <Ionicons
                name={on ? t.iconOn : t.icon}
                size={20}
                color={on ? C.violetHot : C.textDim}
              />
              <Text
                numberOfLines={1}
                style={[styles.tabLabel, { color: on ? C.violetHot : C.textDim }]}
              >
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      )}

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
 * Se dibuja POR ENCIMA de la barra de tabs (bottomOffset), no debajo.
 */
function RecordingPill({ bottomOffset }: { bottomOffset: number }) {
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
      accessibilityRole="button"
      accessibilityLabel={`Grabando ${fmtClock(recording.durationSec)}. Ir a Reuniones`}
      style={({ pressed }) => [
        styles.pill,
        { bottom: bottomOffset },
        pressed ? { opacity: 0.85 } : null,
      ]}
    >
      <Animated.View style={[styles.pillDot, { opacity: pulse }]} />
      <Text style={styles.pillLabel}>Grabando</Text>
      <Text style={styles.pillTimer}>{fmtClock(recording.durationSec)}</Text>
      <Pressable
        onPress={() => void stopNow()}
        disabled={recording.stopping}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Detener grabación"
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
  pill: {
    position: "absolute",
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
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  pillDot: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: C.red },
  pillLabel: { color: C.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.4 },
  pillTimer: { color: C.red, fontSize: 12.5, fontFamily: mono, fontWeight: "700", letterSpacing: 1 },
  pillStop: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: C.red,
    backgroundColor: "rgba(251,113,133,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  offline: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(251,113,133,0.16)",
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.red },
  offlineText: { color: C.red, fontSize: 11.5 },
  tabbar: {
    position: "absolute",
    left: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
    elevation: 10,
    shadowColor: "#000",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
  },
  tab: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    marginVertical: 5,
    borderRadius: 17,
  },
  tabOn: { backgroundColor: "rgba(122,132,255,0.14)" },
  tabLabel: { fontSize: 10.5, fontWeight: "600", letterSpacing: 0.2 },
});
