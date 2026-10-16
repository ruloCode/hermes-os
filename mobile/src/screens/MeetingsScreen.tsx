/**
 * Reuniones — la función que de verdad se usa a diario en el móvil.
 *
 * De arriba abajo, en el orden en que se piensa durante una junta:
 *  1. De qué proyecto es (chips; se fija al arrancar).
 *  2. El grabador (RecorderCard): botón grande + chequeo previo, o la junta en
 *     curso con sus pruebas de vida.
 *  3. En camino (DeliveryList): lo que aún no es junta, con estado real.
 *  4. Las juntas del proyecto en el agente.
 *
 * La grabación vive en el módulo nativo (foreground service) y la entrega en
 * `meeting-queue.ts`: esta pantalla solo mira y manda. Salir de ella, de la
 * app o bloquear el teléfono no corta nada.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, stateColor } from "../theme";
import { Button, Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { useApp, useBackClose } from "../store";
import { useRecording } from "../recording";
import * as api from "../hermes";
import { RecorderCard } from "../meetings/RecorderCard";
import { DeliveryList } from "../meetings/DeliveryList";
import { RecordingDetail } from "../meetings/RecordingDetail";
import { useMeetingQueue } from "../meeting-queue";
import { whenLabel } from "../meetings/format";
import type { Meeting, MeetingSummary } from "../types";

export function MeetingsScreen() {
  const app = useApp();
  const recording = useRecording();
  const queue = useMeetingQueue();
  const [project, setProject] = useState<string | null>(app.focused);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ project: string; id: string } | null>(null);
  const [openRecording, setOpenRecording] = useState<string | null>(null);
  // ATRÁS cierra el detalle abierto antes de tocar tabs.
  useBackClose(!!openRecording, () => setOpenRecording(null));
  useBackClose(!!selected && !openRecording, () => setSelected(null));

  // Default: primer proyecto activo si no hay foco.
  useEffect(() => {
    if (!project && app.projects.length) {
      setProject(
        app.focused ?? app.projects.find((p) => p.estado === "activo")?.slug ?? app.projects[0].slug,
      );
    }
  }, [app.projects, app.focused, project]);

  // Grabando: los chips muestran el proyecto de la junta en curso.
  const shownProject = recording.isRecording ? recording.project : project;

  const refresh = useCallback(async () => {
    if (!shownProject) return;
    setLoading(true);
    try {
      setMeetings(await api.listMeetings(shownProject));
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [shownProject]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Una junta acaba de quedar lista → refrescar el historial.
  const lastDone = queue.done[0]?.id;
  useEffect(() => {
    if (lastDone) void refresh();
  }, [lastDone, refresh]);

  const closeRecording = useCallback(() => setOpenRecording(null), []);

  if (openRecording) {
    return <RecordingDetail id={openRecording} onBack={closeRecording} />;
  }
  if (selected) {
    return (
      <MeetingDetail
        project={selected.project}
        id={selected.id}
        onBack={() => setSelected(null)}
        onRefresh={refresh}
      />
    );
  }

  const projectName = (slug: string | null) =>
    slug ? (app.projects.find((p) => p.slug === slug)?.name ?? slug) : "";

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenTitle title="Reuniones" />

      {/* Proyecto: se fija al arrancar; grabando, los chips no se tocan */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {app.projects.map((p) => {
            const on = shownProject === p.slug;
            return (
              <Pressable
                key={p.slug}
                onPress={() => setProject(p.slug)}
                disabled={recording.isRecording}
                style={[
                  styles.chip,
                  {
                    borderColor: on ? C.violet : C.line,
                    backgroundColor: on ? "rgba(122,132,255,0.14)" : "transparent",
                    opacity: recording.isRecording && !on ? 0.35 : 1,
                  },
                ]}
              >
                <Text style={{ color: on ? C.violetHot : C.textDim, fontSize: 13, fontWeight: "600" }}>
                  {p.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <RecorderCard project={project} projectName={projectName(project)} />

      <DeliveryList
        onOpen={setOpenRecording}
        onOpenMeeting={(proj, id) => setSelected({ project: proj, id })}
      />

      <Text style={[styles.section, { marginTop: 22 }]}>
        Juntas de {projectName(shownProject) || "…"}
      </Text>
      {loading && meetings.length === 0 ? (
        <Loading />
      ) : meetings.length === 0 ? (
        <Empty text="Sin juntas todavía en este proyecto." />
      ) : (
        meetings.map((m) => (
          <Card
            key={m.id}
            accent={C.violet}
            onPress={() => shownProject && setSelected({ project: shownProject, id: m.id })}
          >
            <Dim style={{ fontSize: 11.5, marginBottom: 3, color: C.violetHot }}>{whenLabel(m.fecha)}</Dim>
            <Text style={{ color: C.text, fontSize: 14.5, fontWeight: "700" }} numberOfLines={2}>
              {m.title}
            </Text>
            <Dim style={{ fontSize: 11.5, marginTop: 3 }}>
              {m.accionables_count} accionables
              {m.duracion_min ? ` · ${m.duracion_min} min` : ""}
            </Dim>
          </Card>
        ))
      )}
    </ScrollView>
  );
}

// ── Detalle de una reunión ─────────────────────────────────────────────
function MeetingDetail({
  project,
  id,
  onBack,
  onRefresh,
}: {
  project: string;
  id: string;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [showTranscript, setShowTranscript] = useState(false);
  const [triaging, setTriaging] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      setMeeting(await api.getMeeting(project, id));
    } catch {
      setMeeting(null);
    }
  }, [project, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const triage = async (idx: number, decision: "ejecutar" | "pendiente" | "ignorar") => {
    setTriaging(idx);
    try {
      await api.triageActionable(project, id, idx, decision);
      await load();
      await onRefresh();
    } finally {
      setTriaging(null);
    }
  };

  if (!meeting) return <Loading label="Cargando reunión…" />;

  return (
    <ScrollView style={styles.wrap}>
      <Pressable onPress={onBack} style={{ marginBottom: 10 }}>
        <Text style={{ color: C.violet, fontSize: 13 }}>← Volver</Text>
      </Pressable>
      <Text style={{ color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 }}>
        {meeting.title}
      </Text>
      <Dim style={{ fontSize: 11, marginBottom: 14 }}>
        {whenLabel(meeting.fecha)} · {meeting.source}
        {meeting.stt_provider ? ` · ${meeting.stt_provider}` : ""}
      </Dim>

      <Text style={styles.label}>RESUMEN</Text>
      <Text style={styles.body}>{meeting.summary}</Text>

      <Text style={[styles.label, { marginTop: 18 }]}>ACCIONABLES</Text>
      {meeting.actionables.map((a) => (
        <Card key={a.idx} accent={a.status ? stateColor(a.status) : C.amber}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
            <Text style={{ color: C.text, fontSize: 14, fontWeight: "700", flex: 1 }}>{a.title}</Text>
            {a.status ? <Pill text={a.status} color={stateColor(a.status)} /> : null}
          </View>
          <Text style={[styles.body, { marginTop: 4 }]}>{a.one_liner}</Text>
          {!a.status ? (
            <View style={styles.actions}>
              <Button
                label={triaging === a.idx ? "…" : "Ejecutar"}
                color={C.green}
                style={styles.mini}
                disabled={triaging !== null}
                onPress={() => void triage(a.idx, "ejecutar")}
              />
              <Button
                label="Pendiente"
                color={C.amber}
                style={styles.mini}
                disabled={triaging !== null}
                onPress={() => void triage(a.idx, "pendiente")}
              />
              <Button
                label="Ignorar"
                color={C.textDim}
                style={styles.mini}
                disabled={triaging !== null}
                onPress={() => void triage(a.idx, "ignorar")}
              />
            </View>
          ) : null}
        </Card>
      ))}

      <Pressable onPress={() => setShowTranscript((v) => !v)} style={{ marginTop: 16 }}>
        <Text style={{ color: C.violet, fontSize: 13 }}>
          {showTranscript ? "▾ Ocultar transcripción" : "▸ Ver transcripción completa"}
        </Text>
      </Pressable>
      {showTranscript ? (
        <Text style={[styles.body, { marginTop: 10, color: C.textDim }]}>{meeting.transcript}</Text>
      ) : null}
      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 6 },
  section: { color: C.textDim, fontSize: 12, fontWeight: "700", letterSpacing: 0.4, marginBottom: 10 },
  label: { color: C.textDim, fontSize: 10, letterSpacing: 1.6, fontWeight: "700", marginBottom: 8, marginTop: 6 },
  body: { color: C.text, fontSize: 13.5, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  mini: { paddingVertical: 7, paddingHorizontal: 12 },
});
