/**
 * "En camino": cada grabación que todavía no es una junta, con su estado REAL
 * y su siguiente paso. Reemplaza las pestañas SUBIDAS/PENDIENTES, que
 * escondían los problemas detrás de un contador (llegaron a 40 sin que se
 * notara por qué).
 *
 * Primero se dice dónde está el audio ("en el teléfono", "a salvo en la Mac")
 * y después el estado de red: el miedo es perder la junta, no que tarde. Lo
 * que no pide nada de ti (atraso viejo, copias que ya están en la Mac) va
 * plegado en una fila con su acción en lote.
 */
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../theme";
import { useApp } from "../store";
import {
  approveAll,
  removeLocal,
  reprocessOnServer,
  useMeetingQueue,
  type Phase,
  type QueueItem,
} from "../meeting-queue";
import { fmtBytes, fmtDuration, inLabel, whenLabel } from "./format";

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const PHASE: Record<Phase, { color: string; icon: IconName }> = {
  waiting: { color: C.amber, icon: "phone-portrait-outline" },
  held: { color: C.textDim, icon: "archive-outline" },
  "needs-project": { color: C.amber, icon: "help-circle-outline" },
  uploading: { color: C.blue, icon: "cloud-upload-outline" },
  processing: { color: C.violet, icon: "sparkles-outline" },
  "on-server": { color: C.green, icon: "checkmark-done-outline" },
  failed: { color: C.red, icon: "alert-circle-outline" },
};

function statusText(i: QueueItem): string {
  switch (i.phase) {
    case "uploading":
      return `Subiendo · ${Math.round(i.progress * 100)} %`;
    case "processing":
      return "En la Mac · transcribiendo y resumiendo…";
    case "needs-project":
      return "Guardada en el teléfono · elige el proyecto para subirla";
    case "held":
      return "Guardada en el teléfono · espera tu decisión";
    case "on-server":
      return "A salvo en la Mac · sin confirmar si se procesó";
    case "failed":
      return i.serverHasAudio ? "El análisis falló · el audio está en la Mac" : "No se pudo subir";
    case "waiting":
      return i.lastError
        ? `Guardada en el teléfono · reintento ${inLabel(i.retryAt) || "al volver a la app"}`
        : "Guardada en el teléfono · en cola para subir";
  }
}

export function DeliveryList({
  onOpen,
  onOpenMeeting,
}: {
  onOpen: (id: string) => void;
  onOpenMeeting: (project: string, meetingId: string) => void;
}) {
  const app = useApp();
  const q = useMeetingQueue();
  const [showHeld, setShowHeld] = useState(false);
  const [showServer, setShowServer] = useState(false);
  // Re-render cada 15 s para que "reintento en 2 min" no mienta.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const onServer = q.items.filter((i) => i.phase === "on-server");
  const held = q.items.filter((i) => i.phase === "held");
  const live = q.items.filter((i) => i.phase !== "on-server" && i.phase !== "held");
  const recentDone = q.done.filter((d) => Date.now() - new Date(d.at).getTime() < 24 * 3600 * 1000);
  if (!q.items.length && !recentDone.length) return null;

  const nameOf = (slug: string | null) =>
    slug ? (app.projects.find((p) => p.slug === slug)?.name ?? slug) : null;

  const uploadAllHeld = () => {
    const ready = held.filter((i) => i.project);
    Alert.alert(
      `Subir ${ready.length} grabaciones`,
      "Se suben una por una y cada una se transcribe (gasta créditos de transcripción). Si alguna ya era junta, quedará duplicada.",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Subir todas", onPress: () => void approveAll(ready.map((i) => i.id)) },
      ],
    );
  };

  const freeAll = () => {
    Alert.alert(
      "Liberar espacio en el teléfono",
      `${onServer.length} grabaciones ya tienen copia en la Mac (~/.hermes-os/audio-juntas). Se borran SOLO del teléfono; desde la Mac se pueden reprocesar cuando quieras.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Quitar del teléfono",
          onPress: () => void Promise.all(onServer.map((i) => removeLocal(i.id))),
        },
      ],
    );
  };

  const renderItem = (i: QueueItem) => {
    const p = PHASE[i.phase];
    return (
      <Pressable
        key={i.id}
        onPress={() => onOpen(i.id)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
      >
        <View style={[styles.icon, { borderColor: p.color }]}>
          {i.phase === "uploading" || i.phase === "processing" ? (
            <ActivityIndicator size="small" color={p.color} />
          ) : (
            <Ionicons name={p.icon} size={17} color={p.color} />
          )}
        </View>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text style={styles.title} numberOfLines={1}>
              {nameOf(i.project) ? `Junta de ${nameOf(i.project)}` : "Grabación sin proyecto"}
            </Text>
            {i.interrupted ? <Text style={styles.tag}>rescatada</Text> : null}
          </View>
          <Text style={styles.meta}>
            {[whenLabel(i.createdAt, true), fmtDuration(i.durationSec), fmtBytes(i.sizeBytes)]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <Text style={[styles.status, { color: p.color }]}>{statusText(i)}</Text>
          {i.phase === "uploading" ? (
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(i.progress * 100)}%` }]} />
            </View>
          ) : null}
          {i.phase === "failed" && i.serverHasAudio ? (
            <Pressable
              onPress={() =>
                void reprocessOnServer(i.id).catch((e) => Alert.alert("No pude reprocesar", String(e)))
              }
              hitSlop={6}
              style={{ marginTop: 4, alignSelf: "flex-start" }}
            >
              <Text style={[styles.inlineBtnText, { color: C.violetHot }]}>↻ Reprocesar en la Mac</Text>
            </Pressable>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
      </Pressable>
    );
  };

  return (
    <View style={{ marginTop: 22 }}>
      <Text style={styles.section}>En camino</Text>

      {q.offline ? (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline-outline" size={15} color={C.amber} />
          <Text style={styles.offlineText}>
            {q.offline}. Las grabaciones están a salvo en el teléfono y se suben solas al volver la
            conexión.
          </Text>
        </View>
      ) : null}

      {live.map(renderItem)}

      {held.length ? (
        <Group
          open={showHeld}
          onToggle={() => setShowHeld((v) => !v)}
          color={C.textDim}
          icon="archive-outline"
          text={`${held.length} de antes de la actualización, guardadas en el teléfono`}
          action={held.some((i) => i.project) ? { label: "Subir todas", onPress: uploadAllHeld } : undefined}
        />
      ) : null}
      {showHeld ? held.map(renderItem) : null}

      {onServer.length ? (
        <Group
          open={showServer}
          onToggle={() => setShowServer((v) => !v)}
          color={C.green}
          icon="checkmark-done-outline"
          text={`${onServer.length} ya están a salvo en la Mac`}
          action={{ label: "Liberar teléfono", onPress: freeAll }}
        />
      ) : null}
      {showServer ? onServer.map(renderItem) : null}

      {recentDone.map((d) => (
        <Pressable
          key={d.id}
          onPress={() => onOpenMeeting(d.project, d.meetingId)}
          style={({ pressed }) => [styles.row, { opacity: pressed ? 0.75 : 1 }]}
        >
          <View style={[styles.icon, { borderColor: C.green }]}>
            <Ionicons name="checkmark" size={17} color={C.green} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={styles.title} numberOfLines={1}>
              {d.title}
            </Text>
            <Text style={[styles.status, { color: C.green }]}>
              Lista · {nameOf(d.project) ?? d.project} · {whenLabel(d.at, true)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
        </Pressable>
      ))}
    </View>
  );
}

/** Fila plegable con acción en lote (atraso viejo · copias en la Mac). */
function Group({
  open,
  onToggle,
  color,
  icon,
  text,
  action,
}: {
  open: boolean;
  onToggle: () => void;
  color: string;
  icon: IconName;
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={styles.group}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.groupMain, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Ionicons name={icon} size={16} color={color} />
        <Text style={[styles.groupText, { color }]}>{text}</Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={15} color={C.textFaint} />
      </Pressable>
      {action ? (
        <Pressable
          onPress={action.onPress}
          hitSlop={6}
          style={({ pressed }) => [styles.groupBtn, { borderColor: color, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[styles.inlineBtnText, { color }]}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { color: C.textDim, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 10 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.text, fontSize: 14.5, fontWeight: "700", flexShrink: 1 },
  tag: {
    color: C.amber,
    fontSize: 10.5,
    fontWeight: "700",
    borderColor: C.amber,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  meta: { color: C.textDim, fontSize: 12 },
  status: { fontSize: 12.5, fontWeight: "600" },
  track: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: "hidden", marginTop: 3 },
  fill: { height: 4, borderRadius: 2, backgroundColor: C.blue },
  inlineBtnText: { fontSize: 12.5, fontWeight: "700" },
  offline: {
    flexDirection: "row",
    gap: 8,
    alignItems: "flex-start",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  offlineText: { flex: 1, color: C.amber, fontSize: 12, lineHeight: 17 },
  group: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: C.lineSoft,
    paddingVertical: 11,
    marginBottom: 4,
  },
  groupMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  groupText: { flex: 1, fontSize: 12.5, fontWeight: "600", lineHeight: 17 },
  groupBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
});
