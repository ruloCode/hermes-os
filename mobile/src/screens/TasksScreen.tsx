/**
 * Tareas — Linear-first (paridad con el tab TAREAS del dashboard): Linear es la
 * verdad; /linear/board trae los issues + overlay local de ejecución. Tocar un
 * issue abre su detalle (descripción + propiedades + acciones); "Ejecutar"
 * lanza Claude Code en la Mac vía la fila-puente. "＋" le pide a Hermes crear
 * el issue con contexto (título imperativo + criterios + Copy prompt).
 * Sin LINEAR_API_KEY el agente responde available:false → cae al tracker local.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { C, mono, stateColor } from "../theme";
import { Button, Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { Markdown } from "../markdown";
import { useApp } from "../store";
import * as api from "../hermes";
import type { LinearBoardIssue, LinearIssueFull, Task, TaskState } from "../types";

// ── Tablero Linear ─────────────────────────────────────────────────────

const GROUPS: { type: string; label: string; color: string }[] = [
  { type: "started", label: "EN CURSO", color: C.green },
  { type: "unstarted", label: "TODO", color: C.violet },
  { type: "backlog", label: "BACKLOG", color: C.textDim },
  { type: "completed", label: "HECHAS", color: C.cyan },
];

const PRIORITY: Record<number, { label: string; color: string }> = {
  1: { label: "URGENTE", color: C.red },
  2: { label: "ALTA", color: C.amber },
  3: { label: "MEDIA", color: C.violet },
  4: { label: "BAJA", color: C.textDim },
};

function linearStateColor(type: string): string {
  if (type === "started") return C.green;
  if (type === "completed") return C.cyan;
  if (type === "canceled") return C.textFaint;
  if (type === "backlog") return C.textDim;
  return C.violet;
}

export function TasksScreen() {
  const app = useApp();
  const [board, setBoard] = useState<{ available: boolean; issues: LinearBoardIssue[] } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [onlyFocused, setOnlyFocused] = useState<boolean>(!!app.focused);
  const [open, setOpen] = useState<string | null>(null); // identifier del detalle
  const [creating, setCreating] = useState(false);
  // "Último gana": un fetch viejo (toggle rápido de filtros) no pisa al nuevo.
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const rid = ++reqRef.current;
    setLoading(true);
    try {
      const project = onlyFocused ? (app.focused ?? undefined) : undefined;
      const res = await api.linearBoard(project);
      if (reqRef.current !== rid) return;
      setBoard(res);
    } catch {
      if (reqRef.current === rid) setBoard({ available: false, issues: [] });
    } finally {
      if (reqRef.current === rid) setLoading(false);
    }
  }, [app.focused, onlyFocused]);

  useEffect(() => {
    void load();
  }, [load]);

  // Sin Linear configurado: el tracker local de siempre.
  if (board && !board.available) return <LocalTasks />;

  if (open) {
    return (
      <IssueDetail
        identifier={open}
        onBack={() => {
          setOpen(null);
          void load();
        }}
      />
    );
  }

  const issues = board?.issues ?? [];
  const byType = (t: string) => issues.filter((i) => i.state.type === t);

  return (
    <ScrollView
      style={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.violet} />
      }
    >
      <ScreenTitle
        title="Tareas"
        right={
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Dim>{issues.length}</Dim>
            <Pressable
              onPress={() => setCreating((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={creating ? "Cerrar formulario" : "Crear tarea en Linear"}
              style={({ pressed }) => [styles.addBtn, pressed ? { opacity: 0.6 } : null]}
            >
              <Text style={{ color: C.violetHot, fontSize: 17, fontWeight: "700" }}>
                {creating ? "✕" : "＋"}
              </Text>
            </Pressable>
          </View>
        }
      />
      <Dim style={{ fontSize: 10.5, letterSpacing: 1.5, marginTop: -8, marginBottom: 10 }}>
        LINEAR · LA VERDAD DE LAS TAREAS
      </Dim>

      {creating ? <NewIssueForm onDone={() => setCreating(false)} /> : null}

      {app.focused ? (
        <View style={styles.chips}>
          <Chip
            label={`Solo ${app.focused}`}
            on={onlyFocused}
            onPress={() => setOnlyFocused((v) => !v)}
          />
        </View>
      ) : null}

      {loading && !board ? (
        <Loading />
      ) : app.online === false ? (
        <Empty text="No alcanzo al agente. Revisa Ajustes (⚙)." />
      ) : issues.length === 0 ? (
        <Empty text="Sin issues en el tablero. Crea uno con ＋ (Hermes lo redacta con contexto)." />
      ) : (
        GROUPS.map((g) => {
          const list = g.type === "completed" ? byType(g.type).slice(0, 8) : byType(g.type);
          if (!list.length) return null;
          return (
            <View key={g.type} style={{ marginBottom: 6 }}>
              <View style={styles.groupHeader}>
                <View style={[styles.groupDot, { backgroundColor: g.color }]} />
                <Text style={[styles.groupLabel, { color: g.color }]}>{g.label}</Text>
                <Dim style={{ fontSize: 10.5 }}>{list.length}</Dim>
              </View>
              {list.map((i) => (
                <IssueRow key={i.identifier} issue={i} onPress={() => setOpen(i.identifier)} />
              ))}
            </View>
          );
        })
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function IssueRow({ issue, onPress }: { issue: LinearBoardIssue; onPress: () => void }) {
  const pr = PRIORITY[issue.priority];
  const running = issue.local?.status === "running";
  return (
    <Card onPress={onPress} accent={linearStateColor(issue.state.type)} style={{ marginBottom: 8 }}>
      <View style={styles.rowTop}>
        <Text style={styles.identifier}>{issue.identifier}</Text>
        {running ? <Pill text="corriendo" color={C.green} /> : null}
        {pr && !running ? (
          <Text style={{ color: pr.color, fontSize: 9.5, fontWeight: "800", letterSpacing: 1 }}>
            {pr.label}
          </Text>
        ) : null}
      </View>
      <Text style={styles.issueTitle}>{issue.title}</Text>
      <View style={styles.rowMeta}>
        {issue.project ? <Dim style={{ fontSize: 11 }}>{issue.project.name}</Dim> : null}
        {issue.hasPrompt ? (
          <Text style={{ color: C.cyan, fontSize: 10.5 }}>▸ prompt listo</Text>
        ) : null}
      </View>
    </Card>
  );
}

/** ＋ Nueva: Hermes crea el issue en Linear con contexto real (async). */
function NewIssueForm({ onDone }: { onDone: () => void }) {
  const app = useApp();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    const instruction = text.trim();
    if (!instruction) return;
    setBusy(true);
    const ok = await api.createLinearIssue(instruction, app.focused ?? undefined);
    setBusy(false);
    if (ok) {
      setText("");
      onDone();
      Alert.alert(
        "Issue en camino",
        "Hermes está juntando contexto y redactando el issue en Linear (título + criterios + Copy prompt). Aparece en el tablero en un momento.",
      );
    } else {
      Alert.alert("No pude crearlo", "El agente no respondió. Revisa la conexión.");
    }
  };

  return (
    <View style={styles.newForm}>
      <TextInput
        style={styles.newInput}
        value={text}
        onChangeText={setText}
        placeholder={`Qué hay que hacer… ${app.focused ? `(→ ${app.focused})` : ""}`}
        placeholderTextColor={C.textFaint}
        multiline
      />
      <Button
        label={busy ? "Creando…" : "Crear en Linear"}
        color={C.violet}
        filled
        disabled={busy || !text.trim()}
        onPress={() => void create()}
      />
    </View>
  );
}

// ── Detalle de un issue ────────────────────────────────────────────────

function IssueDetail({ identifier, onBack }: { identifier: string; onBack: () => void }) {
  const [issue, setIssue] = useState<LinearIssueFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const aliveRef = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.linearIssue(identifier);
    if (!aliveRef.current) return;
    setIssue(res);
    setLoading(false);
  }, [identifier]);

  useEffect(() => {
    aliveRef.current = true;
    void load();
    return () => {
      aliveRef.current = false;
    };
  }, [load]);

  const execute = async () => {
    setBusy("exec");
    const run = await api.executeLinearIssue(identifier);
    setBusy(null);
    if (run) {
      Alert.alert(
        "Claude está trabajando",
        `El issue pasó a In Progress y Claude Code corre en la Mac (${run.slug}). Al terminar deja un comentario con métricas en Linear.`,
      );
      void load();
    } else {
      Alert.alert("No pude ejecutarlo", "El agente no respondió o el issue no tiene Copy prompt.");
    }
  };

  const markDone = async () => {
    setBusy("done");
    const ok = await api.setLinearIssueState(identifier, "completed");
    setBusy(null);
    if (ok) onBack();
    else Alert.alert("No pude marcarlo", "El agente no respondió.");
  };

  const pr = issue ? PRIORITY[issue.priority] : undefined;

  return (
    <ScrollView style={styles.wrap}>
      <Pressable onPress={onBack} hitSlop={8} style={{ marginBottom: 10 }}>
        <Text style={{ color: C.textDim, fontSize: 13 }}>← Tablero</Text>
      </Pressable>

      {loading ? (
        <Loading />
      ) : !issue ? (
        <Empty text={`No encontré el issue ${identifier}.`} />
      ) : (
        <>
          <View style={styles.rowTop}>
            <Text style={[styles.identifier, { fontSize: 13 }]}>{issue.identifier}</Text>
            <Pill text={issue.state.name} color={linearStateColor(issue.state.type)} />
            {pr ? (
              <Text style={{ color: pr.color, fontSize: 9.5, fontWeight: "800", letterSpacing: 1 }}>
                {pr.label}
              </Text>
            ) : null}
          </View>
          <Text style={styles.detailTitle}>{issue.title}</Text>
          {issue.project ? (
            <Dim style={{ fontSize: 11.5, marginBottom: 12 }}>{issue.project.name}</Dim>
          ) : null}

          <View style={styles.actions}>
            {issue.copyPrompt && issue.state.type !== "completed" ? (
              <Button
                label={busy === "exec" ? "Lanzando…" : "▶ Ejecutar"}
                color={C.green}
                filled
                disabled={!!busy}
                style={styles.mini}
                onPress={() => void execute()}
              />
            ) : null}
            {issue.state.type === "started" || issue.state.type === "unstarted" ? (
              <Button
                label={busy === "done" ? "…" : "✓ Done"}
                color={C.cyan}
                disabled={!!busy}
                style={styles.mini}
                onPress={() => void markDone()}
              />
            ) : null}
            <Button
              label="↗ Linear"
              color={C.textDim}
              style={styles.mini}
              onPress={() => void Linking.openURL(issue.url).catch(() => {})}
            />
          </View>

          <View style={styles.descBox}>
            {issue.description ? (
              <Markdown source={issue.description} />
            ) : (
              <Dim>Sin descripción.</Dim>
            )}
          </View>
        </>
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

// ── Fallback: tracker local (sin LINEAR_API_KEY en el agente) ──────────

const STATUSES: (TaskState | "all")[] = ["all", "pending", "running", "done"];
const LABEL: Record<string, string> = {
  all: "Todas",
  pending: "Por hacer",
  running: "Corriendo",
  done: "Hechas",
  dismissed: "Ignoradas",
};

function LocalTasks() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<TaskState | "all">("all");
  const [onlyFocused, setOnlyFocused] = useState<boolean>(!!app.focused);
  const reqRef = useRef(0);

  const load = useCallback(async () => {
    const rid = ++reqRef.current;
    setLoading(true);
    try {
      const project = onlyFocused ? (app.focused ?? undefined) : undefined;
      const st = status === "all" ? undefined : status;
      const res = await api.tasks({ project, status: st });
      if (reqRef.current === rid) setTasks(res);
    } catch {
      if (reqRef.current === rid) setTasks([]);
    } finally {
      if (reqRef.current === rid) setLoading(false);
    }
  }, [app.focused, onlyFocused, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } finally {
      void load();
    }
  };

  return (
    <ScrollView
      style={styles.wrap}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.violet} />
      }
    >
      <ScreenTitle title="Tareas" right={<Dim>{tasks.length}</Dim>} />
      <View style={styles.chips}>
        {STATUSES.map((s) => (
          <Chip key={s} label={LABEL[s]} on={status === s} onPress={() => setStatus(s)} />
        ))}
      </View>
      {app.focused ? (
        <View style={[styles.chips, { marginBottom: 12 }]}>
          <Chip
            label={`Solo ${app.focused}`}
            on={onlyFocused}
            onPress={() => setOnlyFocused((v) => !v)}
          />
        </View>
      ) : null}

      {loading && tasks.length === 0 ? (
        <Loading />
      ) : app.online === false ? (
        <Empty text="No alcanzo al agente. Revisa Ajustes (⚙)." />
      ) : tasks.length === 0 ? (
        <Empty text="Sin tareas con este filtro." />
      ) : (
        tasks.map((t) => (
          <Card key={t.id} accent={stateColor(t.status)}>
            <View style={styles.rowTop}>
              <Text style={styles.issueTitle}>{t.title}</Text>
              <Pill text={LABEL[t.status] ?? t.status} color={stateColor(t.status)} />
            </View>
            <Dim style={{ fontSize: 11, marginTop: 2 }}>
              {t.project_slug} · {t.source}
            </Dim>
            {t.detail ? (
              <Text numberOfLines={3} style={styles.detail}>
                {t.detail}
              </Text>
            ) : null}
            <View style={styles.actions}>
              {t.status === "pending" && (
                <>
                  {t.exec_prompt ? (
                    <Button
                      label="Ejecutar"
                      color={C.green}
                      style={styles.mini}
                      onPress={() => void act(() => api.executeTask(t.id))}
                    />
                  ) : null}
                  <Button
                    label="Completar"
                    color={C.cyan}
                    style={styles.mini}
                    onPress={() => void act(() => api.setTaskStatus(t.id, "done"))}
                  />
                  <Button
                    label="Ignorar"
                    color={C.textDim}
                    style={styles.mini}
                    onPress={() => void act(() => api.setTaskStatus(t.id, "dismissed"))}
                  />
                </>
              )}
              {t.status === "done" && (
                <Button
                  label="Reabrir"
                  color={C.amber}
                  style={styles.mini}
                  onPress={() => void act(() => api.setTaskStatus(t.id, "pending"))}
                />
              )}
            </View>
          </Card>
        ))
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: on ? C.violet : C.line,
          backgroundColor: on ? "rgba(122,132,255,0.14)" : "transparent",
        },
      ]}
    >
      <Text style={{ color: on ? C.violetHot : C.textDim, fontSize: 11.5, fontWeight: "600" }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: "rgba(122,132,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
    marginBottom: 8,
  },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupLabel: { fontSize: 10.5, fontWeight: "800", letterSpacing: 1.5 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  identifier: { color: C.violetHot, fontSize: 11.5, fontFamily: mono, fontWeight: "700" },
  issueTitle: { color: C.text, fontSize: 14, fontWeight: "700", flex: 1, marginTop: 3 },
  rowMeta: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  detailTitle: { color: C.text, fontSize: 18, fontWeight: "800", lineHeight: 25, marginTop: 8 },
  descBox: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
  },
  newForm: { gap: 8, marginBottom: 14 },
  newInput: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    color: C.text,
    fontSize: 14,
    minHeight: 70,
    textAlignVertical: "top",
  },
  detail: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12, marginBottom: 12 },
  mini: { paddingVertical: 7, paddingHorizontal: 12 },
});
