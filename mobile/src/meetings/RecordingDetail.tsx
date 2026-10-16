/**
 * Detalle de una grabación que aún no es junta. Escucharla es la única forma
 * de identificar una rescatada; el resto de la pantalla responde dos
 * preguntas: ¿dónde está el audio? y ¿qué hago ahora? Las acciones cambian
 * según el estado — nunca se ofrece re-subir lo que la Mac ya tiene.
 */
import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { C } from "../theme";
import { Button, Dim } from "../ui";
import { useApp } from "../store";
import {
  removeLocal,
  reprocessOnServer,
  retryNow,
  setProject,
  setProjectOnly,
  useMeetingQueue,
  type QueueItem,
} from "../meeting-queue";
import { fmtBytes, fmtClock, fmtDuration, inLabel, whenLabel } from "./format";

export function RecordingDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useMeetingQueue();
  const item = q.items.find((i) => i.id === id);
  // Subió y la junta quedó lista (o se descartó) → volver solo.
  useEffect(() => {
    if (!item) onBack();
  }, [item, onBack]);
  if (!item) return null;
  return <Detail item={item} onBack={onBack} />;
}

function Detail({ item, onBack }: { item: QueueItem; onBack: () => void }) {
  const app = useApp();
  const player = useAudioPlayer(item.uri);
  const status = useAudioPlayerStatus(player);
  const [target, setTarget] = useState<string | null>(item.project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const dur = status.duration || item.durationSec || 0;
  const progress = dur > 0 ? Math.min(1, status.currentTime / dur) : 0;
  const name = (slug: string | null) =>
    slug ? (app.projects.find((p) => p.slug === slug)?.name ?? slug) : null;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = () =>
    Alert.alert(
      "Descartar grabación",
      item.serverHasAudio
        ? "Se borra del teléfono. La Mac conserva su copia."
        : "Se borra el audio del teléfono y NO hay otra copia. No se puede recuperar. ¿Seguro?",
      [
        { text: "Cancelar", style: "cancel" },
        { text: "Descartar", style: "destructive", onPress: () => void removeLocal(item.id) },
      ],
    );

  const where = item.serverHasAudio
    ? { icon: "checkmark-done-outline" as const, color: C.green, text: "El audio está a salvo en la Mac y en el teléfono." }
    : { icon: "phone-portrait-outline" as const, color: C.amber, text: "El audio está SOLO en este teléfono. No lo descartes hasta que sea junta." };

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ marginBottom: 12 }}>
        <Text style={{ color: C.violet, fontSize: 14 }}>← Reuniones</Text>
      </Pressable>
      <Text style={styles.h1}>
        {name(item.project) ? `Junta de ${name(item.project)}` : "Grabación sin proyecto"}
      </Text>
      <Dim style={{ fontSize: 12.5, marginBottom: 16 }}>
        {[whenLabel(item.createdAt, true), fmtDuration(item.durationSec), fmtBytes(item.sizeBytes)]
          .filter(Boolean)
          .join(" · ")}
        {item.interrupted ? " · rescatada" : ""}
      </Dim>

      {/* Dónde está el audio: la respuesta al miedo de perder la junta */}
      <View style={[styles.where, { borderColor: where.color }]}>
        <Ionicons name={where.icon} size={18} color={where.color} />
        <Text style={[styles.whereText, { color: where.color }]}>{where.text}</Text>
      </View>

      {item.interrupted ? (
        <Text style={styles.note}>
          La app se cerró o el grabador falló mientras grababa. Se guardó todo lo grabado hasta ese
          momento — escúchala para confirmar.
        </Text>
      ) : null}

      {/* Reproductor */}
      <View style={styles.player}>
        <Pressable
          onPress={() => (status.playing ? player.pause() : player.play())}
          disabled={!status.isLoaded}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? "Pausar" : "Escuchar"}
          style={({ pressed }) => [styles.play, { opacity: !status.isLoaded ? 0.4 : pressed ? 0.75 : 1 }]}
        >
          <Ionicons name={status.playing ? "pause" : "play"} size={20} color={C.bg} />
        </Pressable>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.track}>
            <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
          </View>
          <Text style={{ color: C.textDim, fontSize: 12 }}>
            {status.isLoaded ? `${fmtClock(status.currentTime)} / ${fmtClock(dur)}` : "cargando audio…"}
          </Text>
        </View>
      </View>

      {/* Estado + motivo */}
      {item.phase === "uploading" ? (
        <Text style={[styles.state, { color: C.blue }]}>
          Subiendo · {Math.round(item.progress * 100)} %
        </Text>
      ) : item.phase === "processing" ? (
        <Text style={[styles.state, { color: C.violetHot }]}>
          La Mac la está transcribiendo y resumiendo. Puedes salir: el aviso llega aquí.
        </Text>
      ) : item.phase === "held" ? (
        <Text style={[styles.state, { color: C.textDim }]}>
          Es de antes de la actualización: no se sube sola para no duplicar juntas ni gastar
          transcripción. Escúchala y decide.
        </Text>
      ) : item.lastError ? (
        <View style={styles.errBox}>
          <Text style={styles.errText}>{item.lastError}</Text>
          {item.phase === "waiting" && item.retryAt ? (
            <Dim style={{ fontSize: 12, marginTop: 4 }}>Reintento automático {inLabel(item.retryAt)}.</Dim>
          ) : null}
        </View>
      ) : null}

      {/* Proyecto */}
      <Text style={styles.label}>Proyecto</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 18 }}>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {app.projects.map((p) => {
            const on = target === p.slug;
            return (
              <Pressable
                key={p.slug}
                onPress={() => {
                  setTarget(p.slug);
                  if (!item.jobId) void setProjectOnly(item.id, p.slug);
                }}
                style={[
                  styles.chip,
                  { borderColor: on ? C.violet : C.line, backgroundColor: on ? "rgba(122,132,255,0.14)" : "transparent" },
                ]}
              >
                <Text style={{ color: on ? C.violetHot : C.textDim, fontSize: 13, fontWeight: "600" }}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      {/* Acciones según el estado */}
      <View style={{ gap: 10 }}>
        {item.serverHasAudio && item.jobId && item.phase !== "processing" ? (
          <Button
            label="↻ Reprocesar en la Mac (sin volver a subir)"
            color={C.green}
            filled
            disabled={busy || !target}
            onPress={() =>
              void run(async () => {
                if (target && target !== item.project) await setProject(item.id, target);
                await reprocessOnServer(item.id);
              })
            }
          />
        ) : null}
        {!item.serverHasAudio && item.phase !== "uploading" && item.phase !== "processing" ? (
          <Button
            label="Subir ahora"
            color={C.green}
            filled
            disabled={busy || !target}
            onPress={() => void run(() => retryNow(item.id, target))}
          />
        ) : null}
        {item.phase === "on-server" ? (
          <Button
            label="Quitar del teléfono (la Mac tiene copia)"
            color={C.textDim}
            disabled={busy}
            onPress={() => void removeLocal(item.id)}
          />
        ) : null}
        {item.phase !== "uploading" ? (
          <Pressable onPress={discard} hitSlop={8} style={{ alignSelf: "center", marginTop: 6 }}>
            <Text style={{ color: C.red, fontSize: 13 }}>Descartar grabación</Text>
          </Pressable>
        ) : null}
        {!target ? <Dim style={{ fontSize: 12 }}>Elige un proyecto para poder subirla.</Dim> : null}
        {error ? <Text style={styles.errText}>⚠ {error}</Text> : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  h1: { color: C.text, fontSize: 21, fontWeight: "800", marginBottom: 4 },
  where: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  whereText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: "600" },
  note: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginBottom: 12 },
  player: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  play: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: "hidden" },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: C.green },
  state: { fontSize: 13, fontWeight: "600", lineHeight: 19, marginBottom: 14 },
  errBox: {
    borderLeftWidth: 2.5,
    borderLeftColor: C.red,
    paddingLeft: 10,
    marginBottom: 14,
  },
  errText: { color: C.red, fontSize: 12.5, lineHeight: 18 },
  label: { color: C.textDim, fontSize: 12, fontWeight: "700", marginBottom: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
});
