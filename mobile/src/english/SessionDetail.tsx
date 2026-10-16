/**
 * Una clase (o práctica) para repasar cuando quieras. Tres vistas, una a la vez:
 *  - Resumen: el reporte del coach (markdown) + lo que salió bien.
 *  - Correcciones: lo que dijiste → cómo se dice, con la regla. "Practicar"
 *    las tapa y te deja intentar antes de ver la respuesta (recuerdo activo).
 *  - Conversación: la transcripción como chat (Profe / Tú).
 * Lo que se abre se guarda en el teléfono: sin señal se sigue viendo.
 * Arriba, la acción que importa: repasar ESTA clase con la tutora.
 */
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as api from "../hermes";
import { C } from "../theme";
import { Markdown } from "../markdown";
import type { EnglishSession, EnglishSessionFull } from "../types";
import { fmtDuration, whenLabel } from "../meetings/format";
import { cachedSession, saveSession } from "./cache";
import { parseTranscript, talkShare } from "./transcript";

type View_ = "resumen" | "correcciones" | "conversacion";

export function SessionDetail({
  session,
  onBack,
  onReview,
  reviewBusy,
}: {
  session: EnglishSession;
  onBack: () => void;
  onReview: (s: EnglishSession) => void;
  reviewBusy: boolean;
}) {
  const [full, setFull] = useState<EnglishSessionFull | null>(null);
  const [offline, setOffline] = useState(false);
  const [view, setView] = useState<View_>("resumen");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const cached = await cachedSession(session.id);
      if (alive && cached) setFull(cached.data);
      try {
        const fresh = await api.englishSession(session.id);
        if (!alive) return;
        setFull(fresh);
        setOffline(false);
        void saveSession(fresh);
      } catch {
        if (alive) setOffline(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [session.id]);

  const s = full ?? { ...session, transcript: null };
  const parsed = useMemo(() => parseTranscript(full?.transcript), [full?.transcript]);
  const share = talkShare(parsed.meta);
  const isClass = s.source === "class";

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={{ paddingBottom: 40 }}>
      <Pressable onPress={onBack} hitSlop={10} style={{ marginBottom: 12 }}>
        <Text style={{ color: C.violet, fontSize: 14 }}>← Inglés</Text>
      </Pressable>

      <Text style={styles.kicker}>{isClass ? "Clase con tu profesora" : "Práctica con la tutora"}</Text>
      <Text style={styles.h1}>{whenLabel(s.started_at, true)}</Text>
      <View style={styles.stats}>
        {s.duration_sec ? <Stat icon="time-outline" text={fmtDuration(s.duration_sec)} /> : null}
        <Stat icon="create-outline" text={`${s.errors.length} correcciones`} />
        {share != null ? <Stat icon="mic-outline" text={`hablaste ${share} %`} /> : null}
        {s.fluency ? <Stat icon="pulse-outline" text={`fluidez ${s.fluency}/5`} /> : null}
      </View>
      {s.topics.length ? <Text style={styles.topics}>{s.topics.join(" · ")}</Text> : null}

      <Pressable
        onPress={() => onReview(s)}
        disabled={reviewBusy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.review, { opacity: reviewBusy ? 0.5 : pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="repeat" size={18} color={C.bg} />
        <Text style={styles.reviewText}>
          {reviewBusy ? "Llamando a tu tutora…" : `Repasar esta ${isClass ? "clase" : "práctica"} con la tutora`}
        </Text>
      </Pressable>

      {offline ? (
        <Text style={styles.offline}>Sin conexión: estás viendo la copia guardada en el teléfono.</Text>
      ) : null}

      <View style={styles.seg}>
        <Seg label="Resumen" on={view === "resumen"} onPress={() => setView("resumen")} />
        <Seg
          label={`Correcciones${s.errors.length ? ` · ${s.errors.length}` : ""}`}
          on={view === "correcciones"}
          onPress={() => setView("correcciones")}
        />
        <Seg label="Conversación" on={view === "conversacion"} onPress={() => setView("conversacion")} />
      </View>

      {view === "resumen" ? (
        <Summary s={s} />
      ) : view === "correcciones" ? (
        <Corrections s={s} />
      ) : !full ? (
        <ActivityIndicator color={C.violet} style={{ marginTop: 30 }} />
      ) : parsed.turns.length ? (
        <Conversation turns={parsed.turns} isClass={isClass} />
      ) : (
        <Text style={styles.empty}>Esta sesión no guardó la conversación.</Text>
      )}
    </ScrollView>
  );
}

function Summary({ s }: { s: EnglishSession }) {
  if (s.report_status === "pending" || s.report_status === "running") {
    return (
      <View style={styles.pending}>
        <ActivityIndicator color={C.violet} />
        <Text style={styles.empty}>El coach está escribiendo el reporte de esta sesión (≈1 min).</Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 14 }}>
      {s.report_md ? <Markdown source={s.report_md} /> : <Text style={styles.empty}>Esta sesión no tiene reporte.</Text>}
      {s.wins.length ? (
        <View style={styles.wins}>
          <Text style={styles.winsTitle}>Lo que salió bien</Text>
          {s.wins.map((w, i) => (
            <Text key={i} style={styles.winItem}>
              ✓ {w}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Corrections({ s }: { s: EnglishSession }) {
  const [practice, setPractice] = useState(false);
  const [shown, setShown] = useState<Set<number>>(new Set());
  if (!s.errors.length) return <Text style={styles.empty}>No hubo correcciones guardadas.</Text>;
  const reveal = (i: number) => setShown((prev) => new Set(prev).add(i));
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        onPress={() => {
          setPractice((p) => !p);
          setShown(new Set());
        }}
        style={({ pressed }) => [styles.practiceToggle, { opacity: pressed ? 0.75 : 1 }]}
      >
        <Ionicons name={practice ? "eye-outline" : "school-outline"} size={15} color={C.violetHot} />
        <Text style={styles.practiceToggleText}>
          {practice ? "Ver todas las respuestas" : "Practicar: tapa la respuesta y di tu versión"}
        </Text>
      </Pressable>
      {s.errors.map((e, i) => {
        const hidden = practice && !shown.has(i);
        return (
          <Pressable
            key={i}
            onPress={() => hidden && reveal(i)}
            disabled={!hidden}
            style={styles.corr}
            accessibilityHint={hidden ? "Toca para ver cómo se dice" : undefined}
          >
            <Text style={styles.said}>
              <Text style={styles.saidMark}>Dijiste  </Text>
              {e.quote}
            </Text>
            {hidden ? (
              <Text style={styles.tap}>¿Cómo lo dirías mejor? Dilo en voz alta y toca para ver.</Text>
            ) : (
              <>
                <Text style={styles.better}>
                  <Text style={styles.betterMark}>Mejor  </Text>
                  {e.correction}
                </Text>
                {e.note_es ? <Text style={styles.note}>{e.note_es}</Text> : null}
              </>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function Conversation({ turns, isClass }: { turns: ReturnType<typeof parseTranscript>["turns"]; isClass: boolean }) {
  // Las clases largas tienen 100+ turnos: se pintan por tandas.
  const [limit, setLimit] = useState(40);
  return (
    <View style={{ gap: 10 }}>
      {turns.slice(0, limit).map((t, i) =>
        t.who === "me" ? (
          <View key={i} style={styles.mine}>
            <Text style={styles.mineText}>{t.text}</Text>
          </View>
        ) : (
          <View key={i} style={styles.theirs}>
            <Text style={styles.theirsLabel}>{t.label || (isClass ? "Profe" : "Tutora")}</Text>
            <Text style={styles.theirsText}>{t.text}</Text>
          </View>
        ),
      )}
      {turns.length > limit ? (
        <Pressable onPress={() => setLimit((l) => l + 60)} style={styles.more}>
          <Text style={styles.moreText}>Ver más ({turns.length - limit} turnos)</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Stat({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>["name"]; text: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={13} color={C.textDim} />
      <Text style={styles.statText}>{text}</Text>
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
  kicker: { color: C.violetHot, fontSize: 12.5, fontWeight: "700" },
  h1: { color: C.text, fontSize: 22, fontWeight: "800", marginTop: 2 },
  stats: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 8 },
  stat: { flexDirection: "row", alignItems: "center", gap: 4 },
  statText: { color: C.textDim, fontSize: 12.5 },
  topics: { color: C.textDim, fontSize: 12.5, marginTop: 6 },
  review: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    height: 50,
    borderRadius: 25,
    backgroundColor: C.green,
    marginTop: 16,
  },
  reviewText: { color: C.bg, fontSize: 15, fontWeight: "800" },
  offline: { color: C.amber, fontSize: 12, marginTop: 10 },
  seg: {
    flexDirection: "row",
    gap: 4,
    marginTop: 18,
    marginBottom: 14,
    backgroundColor: C.panel,
    borderRadius: 12,
    padding: 4,
  },
  segBtn: { flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: 9 },
  segOn: { backgroundColor: "rgba(122,132,255,0.16)" },
  segText: { fontSize: 12.5, fontWeight: "700" },
  pending: { alignItems: "center", gap: 10, paddingVertical: 30 },
  empty: { color: C.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 20 },
  wins: { backgroundColor: "rgba(110,231,160,0.08)", borderRadius: 12, padding: 14, gap: 6 },
  winsTitle: { color: C.green, fontSize: 13, fontWeight: "800" },
  winItem: { color: C.text, fontSize: 13.5, lineHeight: 20 },
  practiceToggle: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4 },
  practiceToggleText: { color: C.violetHot, fontSize: 13, fontWeight: "700" },
  corr: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    gap: 8,
  },
  said: { color: C.textDim, fontSize: 14, lineHeight: 20 },
  saidMark: { color: C.red, fontWeight: "800", fontSize: 12 },
  better: { color: C.text, fontSize: 15, lineHeight: 22, fontWeight: "600" },
  betterMark: { color: C.green, fontWeight: "800", fontSize: 12 },
  note: { color: C.textDim, fontSize: 12.5, lineHeight: 18 },
  tap: { color: C.violetHot, fontSize: 13, fontStyle: "italic" },
  mine: {
    alignSelf: "flex-end",
    maxWidth: "86%",
    backgroundColor: "rgba(122,132,255,0.16)",
    borderRadius: 14,
    borderBottomRightRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  mineText: { color: C.text, fontSize: 14, lineHeight: 20 },
  theirs: { maxWidth: "92%", gap: 2 },
  theirsLabel: { color: C.textDim, fontSize: 11.5, fontWeight: "700" },
  theirsText: { color: C.text, fontSize: 14, lineHeight: 21 },
  more: { alignItems: "center", paddingVertical: 12 },
  moreText: { color: C.violet, fontSize: 13, fontWeight: "700" },
});
