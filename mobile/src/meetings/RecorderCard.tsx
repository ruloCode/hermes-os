/**
 * La tarjeta del grabador. Dos estados:
 *
 *  - Lista: un botón grande y el chequeo previo. El chequeo NO es decorativo:
 *    cada línea es una condición real que decide si una junta de una hora
 *    sobrevive (notificaciones, batería sin restricción, espacio libre), con
 *    el botón que la arregla.
 *  - Grabando: reloj grande, onda en vivo y tres pruebas de vida que se
 *    pueden verificar con los ojos (bytes guardados que crecen, modo segundo
 *    plano confirmado por Android, micrófono que sí recibe sonido). Si algo
 *    falla, se dice en rojo en vez de esconderlo (patrón Granola: admitir la
 *    falla da más confianza que callarla).
 */
import React, { useEffect, useRef, useState } from "react";
import { Alert, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { HermesRecorder } from "../../modules/hermes-recorder";
import { useRecording } from "../recording";
import { C, mono } from "../theme";
import { fmtBytes, fmtClock } from "./format";
import { Waveform } from "./Waveform";

/** Slug con el que el grabador nativo marca una junta sin proyecto (recordings.ts lo vuelve null). */
export const NO_PROJECT = "sin-proyecto";

/** Segundos en los que "Cancelar" descarta sin culpa (patrón Granola). */
const CANCEL_WINDOW_SEC = 15;
/** Silencio continuo que amerita aviso. */
const SILENCE_WARN_SEC = 45;

export function RecorderCard({
  project,
  projectName,
  onStarted,
}: {
  project: string | null;
  projectName: string;
  onStarted?: () => void;
}) {
  const r = useRecording();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  if (!r.isRecording && !r.stopping) {
    const startNow = async () => {
      // Sin proyecto (p.ej. sin señal y sin lista guardada) se graba IGUAL:
      // nunca se pierde una junta por un selector vacío. Se elige al subirla.
      setError(null);
      setStarting(true);
      const err = await r.start(project ?? NO_PROJECT, project ? projectName : "Sin proyecto");
      setStarting(false);
      if (err) setError(err);
      else onStarted?.();
    };
    return (
      <View style={styles.card}>
        <View style={styles.idleRow}>
          <Pressable
            onPress={() => void startNow()}
            disabled={starting || !r.available}
            accessibilityRole="button"
            accessibilityLabel={`Grabar junta de ${projectName}`}
            style={({ pressed }) => [
              styles.recBtn,
              { opacity: starting || !r.available ? 0.5 : pressed ? 0.8 : 1 },
              pressed ? { transform: [{ scale: 0.96 }] } : null,
            ]}
          >
            <View style={styles.recBtnInner} />
          </Pressable>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.idleTitle}>{starting ? "Abriendo micrófono…" : "Grabar junta"}</Text>
            <Text style={styles.idleProject} numberOfLines={1}>
              {project ? projectName : "Sin proyecto: lo eliges al subirla"}
            </Text>
          </View>
        </View>
        <Readiness />
        {error ? <Text style={styles.err}>⚠ {error}</Text> : null}
      </View>
    );
  }

  return <LiveRecording />;
}

/** Chequeo previo: solo las condiciones que de verdad cortan juntas. */
function Readiness() {
  const r = useRecording();
  const c = r.checks;
  if (!r.available) {
    return (
      <Line
        tone="red"
        icon="alert-circle"
        text="Esta versión de la app no trae el grabador nuevo. Instala el APK actualizado."
      />
    );
  }
  if (!c) return null;
  const issues: React.ReactNode[] = [];
  if (!c.notifications) {
    issues.push(
      <Line
        key="n"
        tone="amber"
        icon="notifications-off-outline"
        text="Notificaciones apagadas: no verás el cronómetro ni podrás detener desde fuera de Hermes."
        action="Activar"
        onAction={() => HermesRecorder?.openNotificationSettings()}
      />,
    );
  }
  if (!c.batteryUnrestricted) {
    const brand = c.manufacturer.toLowerCase();
    const extra = brand.includes("samsung")
      ? " En Samsung, además: Ajustes › Batería › Límites de uso en segundo plano › Apps que nunca se suspenden."
      : brand.includes("xiaomi") || brand.includes("redmi") || brand.includes("poco")
        ? " En Xiaomi, además: activa Inicio automático y pon Ahorro de batería en Sin restricciones."
        : "";
    issues.push(
      <Line
        key="b"
        tone="amber"
        icon="battery-half-outline"
        text={`La batería de Hermes está restringida: en juntas largas Android puede cortar la grabación.${extra}`}
        action="Permitir"
        onAction={() => HermesRecorder?.requestBatteryUnrestricted()}
      />,
    );
  }
  if (c.freeBytes < 500 * 1024 * 1024) {
    issues.push(
      <Line
        key="s"
        tone="amber"
        icon="save-outline"
        text={`Queda poco espacio (${fmtBytes(c.freeBytes)}). Una hora de junta ocupa ~30 MB.`}
      />,
    );
  }
  if (!issues.length) {
    return (
      <Line
        tone="green"
        icon="shield-checkmark-outline"
        text="Lista. Puedes bloquear la pantalla o usar otras apps mientras grabas."
      />
    );
  }
  return <View style={{ gap: 8 }}>{issues}</View>;
}

function LiveRecording() {
  const r = useRecording();
  const pulse = useRef(new Animated.Value(1)).current;
  const [stopErr, setStopErr] = useState<string | null>(null);

  useEffect(() => {
    if (r.paused) {
      pulse.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.25, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [r.paused, pulse]);

  const finish = () => {
    Alert.alert(
      "¿Terminar la junta?",
      `${fmtClock(r.durationSec)} grabados. Se guarda en el teléfono y se sube sola a Hermes.`,
      [
        { text: "Seguir grabando", style: "cancel" },
        {
          text: "Terminar",
          onPress: () =>
            void r.stop().then((err) => {
              if (err) setStopErr(err);
            }),
        },
      ],
    );
  };

  const cancel = () => {
    Alert.alert("¿Descartar esta grabación?", "Se borra lo grabado hasta ahora.", [
      { text: "No", style: "cancel" },
      { text: "Descartar", style: "destructive", onPress: () => void r.cancel() },
    ]);
  };

  const silent = !r.paused && !r.silencedByOtherApp && r.silentForSec >= SILENCE_WARN_SEC;

  return (
    <View style={[styles.card, styles.cardLive]}>
      <View style={styles.liveHead}>
        <Animated.View style={[styles.liveDot, { opacity: pulse }, r.paused ? { backgroundColor: C.amber } : null]} />
        <Text style={[styles.liveLabel, r.paused ? { color: C.amber } : null]}>
          {r.stopping ? "Guardando…" : r.paused ? "En pausa" : "Grabando"}
        </Text>
        <Text style={styles.liveProject} numberOfLines={1}>
          · {r.projectName || r.project}
        </Text>
      </View>

      <Text style={styles.timer} accessibilityLabel={`Tiempo grabado ${fmtClock(r.durationSec)}`}>
        {fmtClock(r.durationSec)}
      </Text>

      <Waveform levels={r.levels} muted={r.paused || r.silencedByOtherApp} />

      {r.silencedByOtherApp ? (
        <Banner
          tone="red"
          icon="call-outline"
          text="Una llamada u otra app tomó el micrófono: ahora mismo NO entra audio. Al colgar, la grabación sigue sola."
        />
      ) : null}
      {silent ? (
        <Banner
          tone="amber"
          icon="volume-mute-outline"
          text={`No entra sonido hace ${fmtClock(r.silentForSec)}. ¿El micrófono está tapado o la junta está en silencio?`}
        />
      ) : null}

      <View style={{ gap: 7 }}>
        <Line
          tone="green"
          icon="phone-portrait-outline"
          text={`Guardando en el teléfono · ${fmtBytes(r.bytes)}`}
        />
        {r.background ? (
          <Line
            tone="green"
            icon="layers-outline"
            text="Sigue grabando si sales de Hermes o bloqueas la pantalla."
          />
        ) : (
          <Line
            tone="amber"
            icon="warning-outline"
            text={
              r.backgroundError ??
              "Android aún no confirma el modo segundo plano: no salgas de Hermes hasta que esta línea se ponga verde."
            }
          />
        )}
      </View>

      <View style={styles.controls}>
        <Pressable
          onPress={() => void (r.paused ? r.resume() : r.pause())}
          disabled={r.stopping}
          accessibilityRole="button"
          accessibilityLabel={r.paused ? "Reanudar" : "Pausar"}
          style={({ pressed }) => [styles.ctrl, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Ionicons name={r.paused ? "play" : "pause"} size={18} color={C.text} />
          <Text style={styles.ctrlText}>{r.paused ? "Reanudar" : "Pausar"}</Text>
        </Pressable>
        <Pressable
          onPress={finish}
          disabled={r.stopping}
          accessibilityRole="button"
          accessibilityLabel="Terminar y guardar"
          style={({ pressed }) => [styles.ctrl, styles.ctrlStop, { opacity: r.stopping ? 0.5 : pressed ? 0.8 : 1 }]}
        >
          <Ionicons name="stop" size={16} color={C.bg} />
          <Text style={[styles.ctrlText, { color: C.bg }]}>{r.stopping ? "Guardando…" : "Terminar"}</Text>
        </Pressable>
      </View>
      {r.durationSec < CANCEL_WINDOW_SEC && !r.stopping ? (
        <Pressable onPress={cancel} hitSlop={8} style={{ alignSelf: "center" }}>
          <Text style={styles.cancel}>Empecé por error · descartar</Text>
        </Pressable>
      ) : null}
      {stopErr || r.error ? <Text style={styles.err}>⚠ {stopErr ?? r.error}</Text> : null}
    </View>
  );
}

const TONE = { green: C.green, amber: C.amber, red: C.red } as const;

function Line({
  tone,
  icon,
  text,
  action,
  onAction,
}: {
  tone: keyof typeof TONE;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.line}>
      <Ionicons name={icon} size={15} color={TONE[tone]} style={{ marginTop: 1 }} />
      <Text style={[styles.lineText, tone !== "green" ? { color: C.text } : null]}>{text}</Text>
      {action ? (
        <Pressable
          onPress={onAction}
          hitSlop={8}
          accessibilityRole="button"
          style={({ pressed }) => [styles.lineBtn, { borderColor: TONE[tone], opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.lineBtnText, { color: TONE[tone] }]}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Banner({
  tone,
  icon,
  text,
}: {
  tone: "red" | "amber";
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  return (
    <View
      style={[
        styles.banner,
        {
          borderColor: TONE[tone],
          backgroundColor: tone === "red" ? "rgba(251,113,133,0.12)" : "rgba(251,191,36,0.10)",
        },
      ]}
      accessibilityLiveRegion="polite"
    >
      <Ionicons name={icon} size={16} color={TONE[tone]} />
      <Text style={[styles.bannerText, { color: TONE[tone] }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 14,
  },
  cardLive: { borderColor: "rgba(251,113,133,0.45)" },
  idleRow: { flexDirection: "row", alignItems: "center", gap: 16 },
  recBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "rgba(251,113,133,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  recBtnInner: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.red },
  idleTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  idleProject: { color: C.textDim, fontSize: 13.5 },
  liveHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.red },
  liveLabel: { color: C.red, fontSize: 13, fontWeight: "800", letterSpacing: 0.5 },
  liveProject: { color: C.textDim, fontSize: 13, flex: 1 },
  timer: {
    color: C.text,
    fontSize: 52,
    fontWeight: "300",
    fontFamily: mono,
    letterSpacing: 1,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  controls: { flexDirection: "row", gap: 10 },
  ctrl: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.panel2,
  },
  ctrlStop: { backgroundColor: C.red, borderColor: C.red },
  ctrlText: { color: C.text, fontSize: 15, fontWeight: "700" },
  cancel: { color: C.textDim, fontSize: 12.5, textDecorationLine: "underline" },
  line: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  lineText: { flex: 1, color: C.textDim, fontSize: 12.5, lineHeight: 18 },
  lineBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 4 },
  lineBtnText: { fontSize: 12, fontWeight: "700" },
  banner: {
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
    borderWidth: 1,
    borderRadius: 10,
    padding: 11,
  },
  bannerText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontWeight: "600" },
  err: { color: C.red, fontSize: 12.5, lineHeight: 18 },
});
