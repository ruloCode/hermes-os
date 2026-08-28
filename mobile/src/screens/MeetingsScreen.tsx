/**
 * Reuniones: graba la junta por micrófono (expo-audio), la sube a /meetings del
 * agente → transcribe + resume + saca 2 accionables.
 *
 * Dos tabs bajo la card de grabación:
 *  - SUBIDAS: historial del proyecto en foco (detalle con triage de accionables).
 *  - PENDIENTES: grabaciones que siguen en el teléfono. NO se filtran por
 *    proyecto a propósito — hay que resolverlas estés donde estés, y las
 *    rescatadas ni siquiera traen proyecto. Su detalle deja escucharlas
 *    (única forma de identificar una rescatada), elegir proyecto y reintentar.
 *
 * La grabación NUNCA se pierde por red: al detener se mueve a almacenamiento
 * durable (recordings.ts) antes de subir; si la subida falla queda en
 * PENDIENTES con reintento. Al montar, se rescatan grabaciones huérfanas del
 * cache de expo-audio (juntas grabadas con versiones viejas de la app).
 *
 * El recorder NO vive aquí: es del RecordingProvider (raíz), así que cambiar
 * de tab no mata la junta. Esta pantalla solo arranca/detiene vía contexto y
 * sube lo que el provider deja persistido en `handoff` (mismo flujo venga del
 * botón de esta pantalla o de la píldora global del AppShell).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from "expo-audio";
import { C, stateColor } from "../theme";
import { Button, Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { useApp } from "../store";
import { useRecording } from "../recording";
import * as api from "../hermes";
import { resolveBase } from "../config";
import * as rec from "../recordings";
import type { Meeting, MeetingSummary, TaskState } from "../types";

function fmt(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/**
 * Fecha legible en hora LOCAL (el agente guarda UTC): "hoy 9am", "ayer 2pm",
 * "martes 2pm" dentro de la semana, "8 jul · 2pm" más atrás. `withMinutes`
 * solo para timestamps de error, donde la precisión importa.
 */
function whenLabel(iso: string, withMinutes = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const h = d.getHours();
  const mins = withMinutes ? `:${String(d.getMinutes()).padStart(2, "0")}` : "";
  const hour = `${h % 12 || 12}${mins}${h < 12 ? "am" : "pm"}`;

  const now = new Date();
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86400000);
  if (days === 0) return `hoy ${hour}`;
  if (days === 1) return `ayer ${hour}`;
  // Dentro de la semana el día basta; más atrás sería ambiguo → fecha.
  if (days > 1 && days < 7) return `${DIAS[d.getDay()]} ${hour}`;
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MESES[d.getMonth()]}${year} · ${hour}`;
}

type Tab = "subidas" | "pendientes";

export function MeetingsScreen() {
  const app = useApp();
  const [project, setProject] = useState<string | null>(app.focused);
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<rec.PendingRecording[]>([]);
  const [tab, setTab] = useState<Tab>("subidas");
  const [selectedPending, setSelectedPending] = useState<string | null>(null);

  const recording = useRecording();
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

  const refreshPending = useCallback(async () => {
    setPending(await rec.listPending());
  }, []);

  // La pendiente abierta se subió o se descartó → cerrar su detalle.
  useEffect(() => {
    if (selectedPending && !pending.some((p) => p.id === selectedPending)) {
      setSelectedPending(null);
    }
  }, [pending, selectedPending]);

  // Al montar: rescatar huérfanas del cache de expo-audio, reconciliar los
  // jobs que quedaron en vuelo (app cerrada a mitad del análisis) y cargar.
  useEffect(() => {
    void (async () => {
      try {
        await rec.adoptOrphans(recording.recorderUri);
      } catch {
        /* el rescate nunca debe tumbar la pantalla */
      }
      // Audio con jobId sin confirmar: preguntar cómo terminó. Ante la duda
      // (agente caído, job olvidado tras un reinicio) el audio SE QUEDA.
      for (const p of await rec.listPending()) {
        if (!p.jobId) continue;
        try {
          const job = await api.getMeetingJob(p.jobId);
          if (job.status === "done") await rec.removePending(p.id);
          else if (job.status === "error") {
            await rec.setPendingError(p.id, `el análisis falló: ${job.error ?? "sin detalle"}`);
          }
        } catch {
          // 404 = el agente se reinició y olvidó el job (viven en memoria). No
          // sabemos si la junta quedó → conservar el audio y dejar reintentar.
          await rec.setPendingError(
            p.id,
            "no pude confirmar si el análisis terminó — mira el historial antes de reintentar",
          );
        }
      }
      await refreshPending();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // El poll sobrevive al cambio de proyecto (subir una rescatada mueve el
  // foco), así que lee SIEMPRE el refresh vigente en vez del del render en que
  // arrancó — si no, recargaría el historial del proyecto anterior.
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  /**
   * Sigue el job de ingest. `recordingId` es la grabación local que lo originó:
   * su audio SOLO se borra cuando el job confirma `done`. Un 200 del POST no
   * basta — significa "job aceptado", y el análisis puede fallar después (así
   * se perdió la junta de Careways del 2026-07-16).
   */
  const trackJob = (jobId: string, recordingId?: string) => {
    setBusy("Transcribiendo y resumiendo…");
    let ticks = 0;
    if (pollRef.current) clearInterval(pollRef.current);
    // `id` local: un tick en vuelo no debe matar el intervalo de otro job.
    const id: ReturnType<typeof setInterval> = setInterval(async () => {
      ticks++;
      if (ticks > 180) {
        clearInterval(id);
        setBusy(null);
        // El audio sigue en PENDIENTES: no lo tocamos por un timeout de UI.
        setError("Está tardando. Revisa el historial en un momento.");
        return;
      }
      try {
        const job = await api.getMeetingJob(jobId);
        if (job.status === "running") return;
        clearInterval(id);
        setBusy(null);
        if (job.status === "done") {
          // Recién AHORA la junta existe en el agente → soltar el audio local.
          if (recordingId) {
            await rec.removePending(recordingId);
            await refreshPending();
          }
          await refreshRef.current();
          if (job.meetingId) setSelected(job.meetingId);
        } else {
          const detail = job.error ?? "El procesamiento falló.";
          if (recordingId) {
            await rec.setPendingError(
              recordingId,
              `${whenLabel(new Date().toISOString(), true)} · el agente recibió el audio pero el análisis falló: ${detail}`,
            );
            await refreshPending();
          }
          setError(
            `${detail} La grabación sigue guardada en el teléfono — puedes reintentar desde PENDIENTES.`,
          );
          setTab("pendientes");
        }
      } catch {
        /* transitorio: reintenta */
      }
    }, 2500);
    pollRef.current = id;
  };

  const startRec = async () => {
    setError(null);
    if (!project) {
      setError("Elige un proyecto para la reunión.");
      return;
    }
    // El proyecto queda fijado al arrancar (en el provider): si tocas otro
    // chip a mitad de la junta, la grabación sigue siendo de ESTE proyecto.
    const err = await recording.start(project);
    if (err) setError(err);
  };

  /**
   * Sube una grabación ya persistida. Re-sondea LAN/túnel antes (la base pudo
   * quedar vencida al cambiar de red); si falla, el audio sigue en PENDIENTES.
   */
  const uploadPending = async (entry: rec.PendingRecording, projectOverride?: string | null) => {
    // El override gana: el detalle sabe qué chip está tocado AHORA, sin
    // esperar el round-trip a AsyncStorage que actualiza `entry`.
    const proj = projectOverride ?? entry.project ?? project;
    if (!proj) {
      setError("Elige un proyecto para subir la grabación.");
      return;
    }
    setError(null);
    setBusy("Conectando con el agente…");
    // El sondeo es consultivo: aunque ningún /health responda (parpadeo de
    // datos móviles), igual intentamos la subida con la última base conocida.
    const alive = await resolveBase().catch(() => false);
    try {
      setBusy("Subiendo audio…");
      const { meeting_job_id } = await api.uploadMeetingAudio({
        project: proj,
        uri: entry.uri,
        durationSec: entry.durationSec ?? undefined,
        filename: entry.filename,
      });
      // El audio NO se borra aquí: 200 = "job aceptado", no "junta creada".
      // trackJob lo suelta solo cuando el análisis confirma `done`.
      await rec.setPendingJob(entry.id, meeting_job_id);
      await refreshPending();
      setTab("subidas");
      if (proj !== project) setProject(proj);
      trackJob(meeting_job_id, entry.id);
    } catch (e) {
      let msg = e instanceof Error ? e.message : String(e);
      if (/network request failed/i.test(msg)) {
        msg = alive
          ? "se cortó la conexión a mitad de la subida — reintenta"
          : "sin conexión con el agente (¿datos móviles/wifi activos? ¿la Mac está encendida y con red?)";
      }
      await rec.setPendingError(entry.id, `${whenLabel(new Date().toISOString(), true)} · ${msg}`);
      await refreshPending();
      setBusy(null);
      setError(`No pude subir el audio (${msg}). La grabación quedó guardada en el teléfono — reintenta desde PENDIENTES.`);
      setTab("pendientes"); // que vea dónde quedó a salvo
    }
  };

  const discardPending = (entry: rec.PendingRecording) => {
    Alert.alert(
      "Descartar grabación",
      "Se borra el audio del teléfono y no se puede recuperar. ¿Seguro?",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Descartar",
          style: "destructive",
          onPress: () => {
            void rec.removePending(entry.id).then(refreshPending);
          },
        },
      ],
    );
  };

  const stopRec = async () => {
    // El provider detiene y persiste; la subida la dispara el efecto del
    // handoff de abajo (mismo camino que al detener desde la píldora global).
    const err = await recording.stop();
    if (err) {
      setBusy(null);
      setError(err);
    }
  };

  // Entrega del provider: al detener (aquí o en la píldora) la grabación ya
  // quedó persistida en PENDIENTES; esta pantalla ejecuta la subida para que
  // el flujo (busy, errores, poll del job) viva en un solo lugar.
  useEffect(() => {
    if (!recording.handoff) return;
    const entry = recording.consumeHandoff();
    if (!entry) return;
    void (async () => {
      await refreshPending();
      await uploadPending(entry);
    })();
    // uploadPending se recrea por render; el disparador real es el handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording.handoff]);

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

  const openPending = selectedPending ? pending.find((p) => p.id === selectedPending) : null;
  if (openPending) {
    return (
      <PendingDetail
        entry={openPending}
        fallbackProject={project}
        busy={busy}
        error={error}
        onBack={() => {
          setError(null);
          setSelectedPending(null);
        }}
        onSetProject={async (slug) => {
          await rec.setPendingProject(openPending.id, slug);
          await refreshPending();
        }}
        onUpload={(slug) => void uploadPending(openPending, slug)}
        onDiscard={() => discardPending(openPending)}
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

      {/* Grabación (el recorder vive en RecordingProvider: cambiar de tab no la corta) */}
      <Card>
        {recording.isRecording || recording.stopping ? (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={styles.recDot} />
              <Text style={{ color: C.red, fontSize: 22, fontWeight: "800", letterSpacing: 1 }}>
                {fmt(recording.durationSec)}
              </Text>
              <Dim style={{ fontSize: 11 }}>
                grabando {app.projects.find((p) => p.slug === recording.project)?.name ?? ""}…
              </Dim>
            </View>
            <Dim style={{ fontSize: 11, lineHeight: 16 }}>
              {recording.backgroundCapable
                ? "Puedes navegar por la app o bloquear la pantalla: la grabación sigue en segundo plano."
                : "Puedes navegar por la app (la pantalla queda encendida sola), pero no salgas de Hermes: sin el servicio de Android la grabación se corta en segundo plano."}
            </Dim>
            <Button
              label={recording.stopping ? "■  Guardando…" : "■  Detener y procesar"}
              color={C.red}
              filled
              disabled={recording.stopping}
              onPress={() => void stopRec()}
            />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ color: C.text, fontSize: 14, fontWeight: "700" }}>
              Grabar reunión de {app.projects.find((p) => p.slug === project)?.name ?? "…"}
            </Text>
            <Dim style={{ fontSize: 12, lineHeight: 18 }}>
              Puedes moverte por la app mientras grabas; no cierres Hermes. Ponla en altavoz
              para captar ambos lados.
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

      {/* Tabs: historial del proyecto vs. grabaciones aún en el teléfono.
          Las pendientes NO se filtran por proyecto — hay que resolverlas
          estés donde estés (y las rescatadas ni siquiera tienen proyecto). */}
      <View style={styles.tabs}>
        <SegTab
          label="SUBIDAS"
          count={meetings.length}
          tone={C.violet}
          active={tab === "subidas"}
          onPress={() => setTab("subidas")}
        />
        <SegTab
          label="PENDIENTES"
          count={pending.length}
          tone={C.amber}
          active={tab === "pendientes"}
          onPress={() => setTab("pendientes")}
        />
      </View>

      {tab === "subidas" ? (
        loading && meetings.length === 0 ? (
          <Loading />
        ) : meetings.length === 0 ? (
          <Empty text="Sin reuniones todavía en este proyecto." />
        ) : (
          meetings.map((m) => (
            <Card key={m.id} accent={C.violet} onPress={() => setSelected(m.id)}>
              <Dim style={{ fontSize: 11, marginBottom: 3, color: C.violetHot }}>
                {whenLabel(m.fecha)}
              </Dim>
              <Text
                style={{ color: C.text, fontSize: 14.5, fontWeight: "700" }}
                numberOfLines={2}
              >
                {m.title}
              </Text>
              <Dim style={{ fontSize: 11, marginTop: 3 }}>
                {m.accionables_count} accionables
                {m.duracion_min ? ` · ${m.duracion_min} min` : ""}
              </Dim>
            </Card>
          ))
        )
      ) : pending.length === 0 ? (
        <Empty text="Nada pendiente: todas las grabaciones llegaron al agente." />
      ) : (
        pending.map((p) => (
          <Card
            key={p.id}
            accent={C.amber}
            onPress={() => {
              setError(null); // el error de la card de grabación no es de esta pendiente
              setSelectedPending(p.id);
            }}
          >
            <Dim style={{ fontSize: 11, marginBottom: 3, color: C.amber }}>
              {whenLabel(p.createdAt)}
            </Dim>
            <Text style={{ color: C.text, fontSize: 14.5, fontWeight: "700" }} numberOfLines={2}>
              {p.project
                ? `Reunión de ${app.projects.find((x) => x.slug === p.project)?.name ?? p.project}`
                : "Grabación rescatada"}
            </Text>
            <Dim style={{ fontSize: 11, marginTop: 3 }}>
              {(p.sizeBytes / 1024 / 1024).toFixed(1)} MB
              {p.durationSec ? ` · ${Math.max(1, Math.round(p.durationSec / 60))} min` : ""}
              {p.lastError ? " · falló" : p.jobId ? " · procesando en el agente" : " · sin subir"}
            </Dim>
          </Card>
        ))
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

/** Tab del segmentado (SUBIDAS / PENDIENTES) con contador. */
function SegTab({
  label,
  count,
  tone,
  active,
  onPress,
}: {
  label: string;
  count: number;
  tone: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        {
          borderColor: active ? tone : C.line,
          backgroundColor: active ? "rgba(122,132,255,0.10)" : "transparent",
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={{ color: active ? tone : C.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 1 }}>
        {label}
      </Text>
      {count > 0 ? (
        <View style={[styles.tabCount, { backgroundColor: active ? tone : C.textFaint }]}>
          <Text style={{ color: C.bg, fontSize: 9.5, fontWeight: "800" }}>{count}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Detalle de una grabación pendiente ─────────────────────────────────
// Sin transcripción todavía, así que el "detalle" es la grabación misma:
// escucharla es la única forma de saber qué junta es (sobre todo las
// rescatadas, que no traen proyecto).
function PendingDetail({
  entry,
  fallbackProject,
  busy,
  error,
  onBack,
  onSetProject,
  onUpload,
  onDiscard,
}: {
  entry: rec.PendingRecording;
  fallbackProject: string | null;
  busy: string | null;
  error: string | null;
  onBack: () => void;
  onSetProject: (slug: string) => Promise<void>;
  onUpload: (project: string) => void;
  onDiscard: () => void;
}) {
  const app = useApp();
  const recording = useRecording();
  const player = useAudioPlayer(entry.uri);
  const status = useAudioPlayerStatus(player);
  // Estado local = el chip responde al toque al instante; la persistencia va
  // detrás. Sin esto, tocar chip + "Subir" rápido sube al proyecto anterior.
  const [target, setTarget] = useState<string | null>(entry.project ?? fallbackProject);

  // playsInSilentMode/allowsRecording son iOS-only (en Android el módulo los
  // ignora): esto es prep para un build iOS, donde el modo de grabación deja
  // la salida en el auricular y no se oiría la reproducción. OJO: con una
  // junta grabándose NO se toca el modo — en Android, resetear
  // `allowsBackgroundRecording` desengancharía el foreground service de la
  // grabación en curso.
  useEffect(() => {
    if (recording.isRecording || recording.stopping) return;
    void setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
  }, [recording.isRecording, recording.stopping]);

  // Al terminar, volver al inicio para poder re-escuchar sin quedar en el final.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const dur = status.duration || entry.durationSec || 0;
  const progress = dur > 0 ? Math.min(1, status.currentTime / dur) : 0;

  return (
    <ScrollView style={styles.wrap}>
      <Pressable onPress={onBack} style={{ marginBottom: 10 }}>
        <Text style={{ color: C.violet, fontSize: 13 }}>← Volver</Text>
      </Pressable>
      <Text style={{ color: C.text, fontSize: 19, fontWeight: "800", marginBottom: 4 }}>
        {entry.project
          ? `Reunión de ${app.projects.find((x) => x.slug === entry.project)?.name ?? entry.project}`
          : "Grabación rescatada"}
      </Text>
      <Dim style={{ fontSize: 11, marginBottom: 14 }}>
        {whenLabel(entry.createdAt, true)} · {(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB
        {entry.durationSec ? ` · ${fmt(entry.durationSec)}` : ""}
      </Dim>

      {/* Reproductor: escuchar es lo que identifica la grabación */}
      <Text style={styles.section}>GRABACIÓN</Text>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Pressable
            onPress={() => (status.playing ? player.pause() : player.play())}
            disabled={!status.isLoaded}
            style={({ pressed }) => [
              styles.playBtn,
              { opacity: !status.isLoaded ? 0.4 : pressed ? 0.75 : 1 },
            ]}
          >
            <Text style={{ color: C.bg, fontSize: 15, fontWeight: "800" }}>
              {status.playing ? "❚❚" : "▶"}
            </Text>
          </Pressable>
          <View style={{ flex: 1, gap: 6 }}>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
            </View>
            <Text style={{ color: C.textDim, fontSize: 11 }}>
              {status.isLoaded ? `${fmt(status.currentTime)} / ${fmt(dur)}` : "cargando audio…"}
            </Text>
          </View>
        </View>
      </Card>

      {/* Proyecto destino: obligatorio para las rescatadas */}
      <Text style={[styles.section, { marginTop: 14 }]}>SUBIR A</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={{ flexDirection: "row", gap: 7 }}>
          {app.projects.map((p) => (
            <Pressable
              key={p.slug}
              onPress={() => {
                setTarget(p.slug);
                void onSetProject(p.slug);
              }}
              style={[
                styles.chip,
                {
                  borderColor: target === p.slug ? C.violet : C.line,
                  backgroundColor: target === p.slug ? "rgba(122,132,255,0.14)" : "transparent",
                },
              ]}
            >
              <Text
                style={{
                  color: target === p.slug ? C.violetHot : C.textDim,
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

      {entry.lastError ? (
        <>
          <Text style={styles.section}>ÚLTIMO INTENTO</Text>
          <Card accent={C.red}>
            <Text style={{ color: C.red, fontSize: 12, lineHeight: 18 }}>{entry.lastError}</Text>
            <Dim style={{ fontSize: 11, marginTop: 6, lineHeight: 16 }}>
              El audio está guardado en el teléfono: puedes reintentar las veces que haga falta.
            </Dim>
          </Card>
        </>
      ) : null}

      {busy ? <Text style={{ color: C.violetHot, fontSize: 12.5 }}>◈ {busy}</Text> : null}
      {error ? <Text style={{ color: C.red, fontSize: 12.5, lineHeight: 18 }}>⚠ {error}</Text> : null}

      <View style={[styles.actions, { marginTop: 14 }]}>
        <Button
          label={entry.lastError ? "Reintentar subida" : "Subir ahora"}
          color={C.green}
          filled
          disabled={!!busy || !target}
          onPress={() => target && onUpload(target)}
        />
        <Button label="Descartar" color={C.textDim} disabled={!!busy} onPress={onDiscard} />
      </View>
      {!target ? (
        <Dim style={{ fontSize: 11, marginTop: 8 }}>Elige un proyecto para poder subirla.</Dim>
      ) : null}
      <View style={{ height: 32 }} />
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
  tabs: { flexDirection: "row", gap: 8, marginTop: 14, marginBottom: 12 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 9,
  },
  tabCount: {
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  playBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  track: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: "hidden" },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: C.green },
  section: { color: C.textDim, fontSize: 10, letterSpacing: 1.6, fontWeight: "700", marginBottom: 8, marginTop: 6 },
  body: { color: C.text, fontSize: 13.5, lineHeight: 21 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  mini: { paddingVertical: 7, paddingHorizontal: 12 },
});
