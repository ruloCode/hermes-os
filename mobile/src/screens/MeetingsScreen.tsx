/**
 * Reuniones: graba la junta por micrófono (expo-audio), la sube a /meetings del
 * agente → transcribe + resume + saca 2 accionables. Debajo, el historial del
 * proyecto y el detalle con triage de accionables (ejecutar/pendiente/ignorar).
 *
 * Nota: la grabación corre en primer plano. Mantén Hermes abierto durante la
 * junta (puedes poner la llamada en altavoz para captar ambos lados).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  useAudioRecorder,
  useAudioRecorderState,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";
import { C, stateColor } from "../theme";
import { Button, Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { useApp } from "../store";
import * as api from "../hermes";
import type { Meeting, MeetingSummary, TaskState } from "../types";

function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

export function MeetingsScreen() {
  const app = useApp();
  const [project, setProject] = useState<string | null>(app.focused);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder, 500);
  const startedAt = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Default: primer proyecto activo si no hay foco.
  useEffect(() => {
    if (!project && app.projects.length) {
      setProject(app.focused ?? app.projects.find((p) => p.estado === "activo")?.slug ?? app.projects[0].slug);
    }
  }, [app.projects, app.focused, project]);

  const refresh = useCallback(async () => {
    if (!project) return;
    setLoading(true);
    try {
      setMeetings(await api.listMeetings(project));
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    setSelected(null);
    void refresh();
  }, [refresh]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const trackJob = (jobId: string) => {
    setBusy("Transcribiendo y resumiendo…");
    let ticks = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      ticks++;
      if (ticks > 180) {
        clearInterval(pollRef.current!);
        setBusy(null);
        setError("Está tardando. Revisa el historial en un momento.");
        return;
      }
      try {
        const job = await api.getMeetingJob(jobId);
        if (job.status === "running") return;
        clearInterval(pollRef.current!);
        setBusy(null);
        if (job.status === "done") {
          await refresh();
          if (job.meetingId) setSelected(job.meetingId);
        } else {
          setError(job.error ?? "El procesamiento falló.");
        }
      } catch {
        /* transitorio: reintenta */
      }
    }, 2500);
  };

  const startRec = async () => {
    setError(null);
    if (!project) {
      setError("Elige un proyecto para la reunión.");
      return;
    }
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("Sin permiso de micrófono no puedo grabar.");
        return;
      }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude iniciar la grabación.");
    }
  };

  const stopRec = async () => {
    try {
      const durationSec = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError("La grabación quedó vacía.");
        return;
      }
      setBusy("Subiendo audio…");
      const { meeting_job_id } = await api.uploadMeetingAudio({
        project: project!,
        uri,
        durationSec,
        filename: `reunion-${Date.now()}.m4a`,
      });
      trackJob(meeting_job_id);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : "No se pudo subir el audio.");
    }
  };

  if (selected && project) {
    return (
      <MeetingDetail
        project={project}
        id={selected}
        onBack={() => setSelected(null)}
        onRefresh={refresh}
      />
    );
  }

  return (
    <ScrollView style={styles.wrap}>
      <ScreenTitle title="Reuniones" />

      {/* Selector de proyecto */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {app.projects.map((p) => (
            <Pressable
              key={p.slug}
              onPress={() => setProject(p.slug)}
              style={[
                styles.chip,
                {
                  borderColor: project === p.slug ? C.violet : C.line,
                  backgroundColor: project === p.slug ? "rgba(122,132,255,0.14)" : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: project === p.slug ? C.violetHot : C.textDim,
                  fontSize: 12,
                  fontWeight: "600",
                }}
              >
                {p.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Grabación */}
      <Card>
        {recState.isRecording ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={styles.recDot} />
              <Text style={{ color: C.red, fontSize: 22, fontWeight: "800", letterSpacing: 1 }}>
                {fmt(recState.durationMillis / 1000)}
              </Text>
              <Dim style={{ fontSize: 11 }}>grabando…</Dim>
            </View>
            <Button label="■  Detener y procesar" color={C.red} filled onPress={() => void stopRec()} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ color: C.text, fontSize: 14, fontWeight: "700" }}>
              Grabar reunión de {app.projects.find((p) => p.slug === project)?.name ?? "…"}
            </Text>
            <Dim style={{ fontSize: 12, lineHeight: 18 }}>
              Mantén Hermes abierto durante la junta. Ponla en altavoz para captar ambos lados.
            </Dim>
            <Button
              label="●  Grabar"
              color={C.red}
              disabled={!project || !!busy}
              onPress={() => void startRec()}
            />
          </View>
        )}
        {busy ? <Text style={{ color: C.violetHot, marginTop: 10, fontSize: 12.5 }}>◈ {busy}</Text> : null}
        {error ? <Text style={{ color: C.red, marginTop: 10, fontSize: 12.5 }}>⚠ {error}</Text> : null}
      </Card>

      {/* Historial */}
      <Text style={styles.section}>HISTORIAL</Text>
      {loading && meetings.length === 0 ? (
        <Loading />
      ) : meetings.length === 0 ? (
        <Empty text="Sin reuniones todavía en este proyecto." />
      ) : (
        meetings.map((m) => (
          <Card key={m.id} accent={C.violet} onPress={() => setSelected(m.id)}>
            <Text style={{ color: C.text, fontSize: 14.5, fontWeight: "700" }}>{m.title}</Text>
            <Dim style={{ fontSize: 11, marginTop: 3 }}>
              {m.fecha.slice(0, 10)} · {m.accionables_count} accionables
              {m.duracion_min ? ` · ${m.duracion_min} min` : ""}
            </Dim>
          </Card>
        ))
      )}
      <View style={{ height: 24 }} />
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
        {meeting.fecha.slice(0, 10)} · {meeting.source}
        {meeting.stt_provider ? ` · ${meeting.stt_provider}` : ""}
      </Dim>

      <Text style={styles.section}>RESUMEN</Text>
      <Text style={styles.body}>{meeting.summary}</Text>

      <Text style={[styles.section, { marginTop: 18 }]}>ACCIONABLES</Text>
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
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: C.red },
  section: { color: C.textDim, fontSize: 10, letterSpacing: 1.6, fontWeight: "700", marginBottom: 8, marginTop: 6 },
  body: { color: C.text, fontSize: 13.5, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  mini: { paddingVertical: 7, paddingHorizontal: 12 },
});
