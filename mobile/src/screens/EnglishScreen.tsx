/**
 * Inglés — la segunda función de todos los días en el móvil:
 *  1. Hablar con la tutora cuando quieras (agente de voz ElevenLabs; llega
 *     por el túnel, así que funciona fuera de la casa). Abre con tu contexto
 *     real: última sesión, errores recurrentes y vocabulario pendiente.
 *  2. Repasar el historial de tus clases REALES con tu profesora (las graba
 *     la Junta EN VIVO del dashboard en modo clase) y de tus prácticas.
 *  3. Vocabulario por repasar.
 *
 * Todo lo que se ve queda guardado en el teléfono (english/cache.ts): sin
 * señal se sigue repasando, y la red solo refresca.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as api from "../hermes";
import { C } from "../theme";
import { ScreenTitle } from "../ui";
import { useBackClose } from "../store";
import { useVoice } from "../voice";
import type { EnglishSession, VocabEntry } from "../types";
import { fmtDuration, whenLabel } from "../meetings/format";
import { cachedSessions, cachedVocab, prefetchSessions, saveSessions, saveVocabCache } from "../english/cache";
import { reportPreview } from "../english/transcript";
import { reviewContext } from "../english/review-context";
import { SessionDetail } from "../english/SessionDetail";
import { TutorCall } from "../english/TutorCall";

type Section = "clases" | "practica" | "vocab";

export function EnglishScreen() {
  const v = useVoice();
  const [sessions, setSessions] = useState<EnglishSession[]>([]);
  const [vocab, setVocab] = useState<VocabEntry[]>([]);
  const [due, setDue] = useState<VocabEntry[]>([]);
  const [cacheAt, setCacheAt] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [section, setSection] = useState<Section>("clases");
  const [openId, setOpenId] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [dialing, setDialing] = useState(false);
  useBackClose(openId != null, () => setOpenId(null));

  const load = useCallback(async () => {
    try {
      const [list, all, dueList] = await Promise.all([
        api.englishSessions(80),
        api.englishVocab(false, 120),
        api.englishVocab(true, 30),
      ]);
      setSessions(list);
      setVocab(all);
      setDue(dueList);
      setOffline(false);
      setCacheAt(null);
      void saveSessions(list);
      void saveVocabCache(all);
      // Las clases primero: son lo que más se repasa sin señal.
      void prefetchSessions(
        [...list.filter((x) => x.source === "class"), ...list.filter((x) => x.source !== "class")],
        api.englishSession,
      );
    } catch {
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Primero lo guardado (instantáneo, sirve sin señal); después la red.
  useEffect(() => {
    void (async () => {
      const [cs, cv] = await Promise.all([cachedSessions(), cachedVocab()]);
      if (cs) {
        setSessions(cs.data);
        setCacheAt(cs.at);
        setLoading(false);
      }
      if (cv) setVocab(cv.data);
      await load();
    })();
  }, [load]);

  // Un reporte en camino (práctica recién guardada) → refrescar hasta que llegue.
  const pendingReport = sessions.some((s) => s.report_status === "pending" || s.report_status === "running");
  useEffect(() => {
    if (!pendingReport) return;
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [pendingReport, load]);

  // Al guardarse una práctica, que aparezca en la lista.
  useEffect(() => {
    if (!v.tutorSave) return;
    const t = setTimeout(() => void load(), 2500);
    return () => clearTimeout(t);
  }, [v.tutorSave, load]);

  const tutorActive = v.mode === "tutor" && (v.connected || v.connecting);

  const startTutor = async (opts?: { context: string; label: string; opening: string }) => {
    setReviewing(opts?.label ?? null);
    setDialing(true);
    try {
      await v.connect(
        "tutor",
        opts ? { practiceContext: opts.context, openingMessage: opts.opening } : undefined,
      );
    } finally {
      setDialing(false);
    }
  };

  if (tutorActive || dialing) return <TutorCall reviewing={reviewing} />;

  const open = openId != null ? sessions.find((s) => s.id === openId) : null;
  if (open) {
    return (
      <SessionDetail
        session={open}
        onBack={() => setOpenId(null)}
        reviewBusy={dialing}
        onReview={(s) => void startTutor(reviewTarget(s))}
      />
    );
  }

  const classes = sessions.filter((s) => s.source === "class");
  const practice = sessions.filter((s) => s.source !== "class");
  const list = section === "clases" ? classes : practice;
  const lastClass = classes[0];

  return (
    <ScrollView
      style={styles.wrap}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          tintColor={C.violet}
          onRefresh={async () => {
            setRefreshing(true);
            await load();
            setRefreshing(false);
          }}
        />
      }
    >
      <ScreenTitle title="Inglés" />

      {/* Tutora: la acción principal de la pantalla */}
      <View style={styles.hero}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={styles.heroIcon}>
            <Ionicons name="chatbubbles" size={22} color={C.bg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Habla con tu tutora</Text>
            <Text style={styles.heroSub}>
              Arranca con tus errores recurrentes y el vocabulario pendiente.
            </Text>
          </View>
        </View>
        <Pressable
          onPress={() => void startTutor()}
          accessibilityRole="button"
          style={({ pressed }) => [styles.heroBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="mic" size={18} color={C.bg} />
          <Text style={styles.heroBtnText}>Empezar a hablar</Text>
        </Pressable>
        {lastClass ? (
          <Pressable
            onPress={() => void startTutor(reviewTarget(lastClass))}
            style={({ pressed }) => [styles.heroAlt, { opacity: pressed ? 0.75 : 1 }]}
          >
            <Ionicons name="repeat" size={15} color={C.violetHot} />
            <Text style={styles.heroAltText}>
              Repasar mi última clase ({whenLabel(lastClass.started_at)})
            </Text>
          </Pressable>
        ) : null}
        {v.tutorSave === "saved" || v.tutorSave === "autosaved" ? (
          <Text style={styles.saved}>
            ✓ Práctica guardada. El reporte con tus correcciones aparece en Práctica en ~1 min.
          </Text>
        ) : v.tutorSave === "error" ? (
          <Text style={styles.err}>No pude guardar la última práctica (sin conexión con la Mac).</Text>
        ) : null}
        {v.error && v.mode === "tutor" ? <Text style={styles.err}>⚠ {v.error}</Text> : null}
      </View>

      {offline ? (
        <View style={styles.offline}>
          <Ionicons name="cloud-offline-outline" size={15} color={C.amber} />
          <Text style={styles.offlineText}>
            Sin conexión con la Mac{cacheAt ? ` · mostrando lo guardado ${whenLabel(cacheAt, true)}` : ""}.
          </Text>
        </View>
      ) : null}

      <View style={styles.seg}>
        <Seg label={`Clases${classes.length ? ` · ${classes.length}` : ""}`} on={section === "clases"} onPress={() => setSection("clases")} />
        <Seg label={`Práctica${practice.length ? ` · ${practice.length}` : ""}`} on={section === "practica"} onPress={() => setSection("practica")} />
        <Seg label={`Vocabulario${due.length ? ` · ${due.length}` : ""}`} on={section === "vocab"} onPress={() => setSection("vocab")} />
      </View>

      {loading && !sessions.length ? (
        <ActivityIndicator color={C.violet} style={{ marginTop: 30 }} />
      ) : section === "vocab" ? (
        <Vocab
          due={due}
          all={vocab}
          onReviewed={(id) => {
            setDue((d) => d.filter((x) => x.id !== id));
            void api.reviewVocab(id).catch(() => undefined);
          }}
        />
      ) : list.length ? (
        list.map((s) => <SessionCard key={s.id} s={s} onPress={() => setOpenId(s.id)} />)
      ) : (
        <Text style={styles.empty}>
          {section === "clases"
            ? "Aún no hay clases guardadas. Se graban desde el dashboard con ● Clase en vivo en Inglés."
            : "Aún no hay prácticas. Toca \"Empezar a hablar\"."}
        </Text>
      )}
    </ScrollView>
  );
}

/** Contexto + etiqueta + primer turno para "repasar esta sesión con la tutora". */
function reviewTarget(s: EnglishSession) {
  const when = whenLabel(s.started_at);
  const isClass = s.source === "class";
  // La tutora habla inglés: la fecha del primer turno va en inglés.
  const day = new Date(s.started_at).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return {
    context: reviewContext(s, `${day} (${when})`),
    label: `${isClass ? "la clase" : "la práctica"} · ${when}`,
    opening: isClass
      ? `Hi! I'd like to review my class with my teacher from ${day}. Let's go through my corrections.`
      : `Hi! I'd like to review our practice session from ${day}. Let's go through my corrections.`,
  };
}

function SessionCard({ s, onPress }: { s: EnglishSession; onPress: () => void }) {
  const pending = s.report_status === "pending" || s.report_status === "running";
  const preview = reportPreview(s.report_md, 150);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, { opacity: pressed ? 0.75 : 1 }]}>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.cardTitle}>{whenLabel(s.started_at, true)}</Text>
        <Text style={styles.cardMeta}>
          {[fmtDuration(s.duration_sec), `${s.errors.length} correcciones`, s.topics.slice(0, 2).join(" · ")]
            .filter(Boolean)
            .join(" · ")}
        </Text>
        {pending ? (
          <Text style={[styles.cardPreview, { color: C.violetHot }]}>El reporte se está escribiendo…</Text>
        ) : preview ? (
          <Text style={styles.cardPreview} numberOfLines={3}>
            {preview}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={C.textFaint} />
    </Pressable>
  );
}

function Vocab({
  due,
  all,
  onReviewed,
}: {
  due: VocabEntry[];
  all: VocabEntry[];
  onReviewed: (id: number) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  return (
    <View style={{ gap: 10 }}>
      {due.length ? (
        <>
          <Text style={styles.subhead}>Por repasar hoy</Text>
          {due.map((w) => (
            <View key={w.id} style={styles.word}>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={styles.term}>{w.term}</Text>
                {w.meaning_es ? <Text style={styles.meaning}>{w.meaning_es}</Text> : null}
                {w.example ? <Text style={styles.example}>"{w.example}"</Text> : null}
              </View>
              <Pressable
                onPress={() => onReviewed(w.id)}
                hitSlop={8}
                accessibilityLabel={`Marcar ${w.term} como repasada`}
                style={({ pressed }) => [styles.reviewed, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Ionicons name="checkmark" size={16} color={C.green} />
              </Pressable>
            </View>
          ))}
        </>
      ) : (
        <Text style={styles.empty}>Nada pendiente por repasar. 🎉</Text>
      )}
      {all.length ? (
        <Pressable onPress={() => setShowAll((x) => !x)} style={{ paddingVertical: 10 }}>
          <Text style={styles.moreText}>
            {showAll ? "Ocultar" : "Ver"} todo tu vocabulario ({all.length})
          </Text>
        </Pressable>
      ) : null}
      {showAll
        ? all.map((w) => (
            <View key={w.id} style={[styles.word, { paddingVertical: 10 }]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.term}>
                  {w.term} {w.learned ? <Text style={{ color: C.green, fontSize: 12 }}>· aprendida</Text> : null}
                </Text>
                {w.meaning_es ? <Text style={styles.meaning}>{w.meaning_es}</Text> : null}
              </View>
            </View>
          ))
        : null}
    </View>
  );
}

function Seg({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      style={[styles.segBtn, on ? styles.segOn : null]}
    >
      <Text style={[styles.segText, { color: on ? C.violetHot : C.textDim }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  hero: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    gap: 14,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.violet,
    alignItems: "center",
    justifyContent: "center",
  },
  heroTitle: { color: C.text, fontSize: 18, fontWeight: "800" },
  heroSub: { color: C.textDim, fontSize: 13, lineHeight: 18, marginTop: 2 },
  heroBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    height: 52,
    borderRadius: 26,
    backgroundColor: C.green,
  },
  heroBtnText: { color: C.bg, fontSize: 16, fontWeight: "800" },
  heroAlt: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  heroAltText: { color: C.violetHot, fontSize: 13.5, fontWeight: "700" },
  saved: { color: C.green, fontSize: 12.5, lineHeight: 18 },
  err: { color: C.red, fontSize: 12.5, lineHeight: 18 },
  offline: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    backgroundColor: "rgba(251,191,36,0.08)",
  },
  offlineText: { flex: 1, color: C.amber, fontSize: 12, lineHeight: 17 },
  seg: {
    flexDirection: "row",
    gap: 4,
    marginTop: 18,
    marginBottom: 12,
    backgroundColor: C.panel,
    borderRadius: 12,
    padding: 4,
  },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
  segOn: { backgroundColor: "rgba(122,132,255,0.16)" },
  segText: { fontSize: 12.5, fontWeight: "700" },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 8,
  },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "800" },
  cardMeta: { color: C.textDim, fontSize: 12.5 },
  cardPreview: { color: C.textDim, fontSize: 13, lineHeight: 19, marginTop: 2 },
  empty: { color: C.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 24 },
  subhead: { color: C.textDim, fontSize: 12, fontWeight: "700" },
  word: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  term: { color: C.text, fontSize: 15.5, fontWeight: "800" },
  meaning: { color: C.textDim, fontSize: 13.5 },
  example: { color: C.textDim, fontSize: 12.5, fontStyle: "italic" },
  reviewed: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.green,
    alignItems: "center",
    justifyContent: "center",
  },
  moreText: { color: C.violet, fontSize: 13, fontWeight: "700", textAlign: "center" },
});
