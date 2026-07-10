/**
 * Tareas (tablero de misión): lee /tracker/tasks. Filtra por proyecto en foco y
 * por estado; permite completar, ignorar, reabrir y ejecutar (lanza claude -p).
 * El modo "Hoy" muestra lo que se movió hoy: creado, actualizado o terminado
 * en el día (tz del teléfono), sin las ignoradas.
 */
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, stateColor } from "../theme";
import { Button, Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { useApp } from "../store";
import * as api from "../hermes";
import type { Task, TaskState } from "../types";

const STATUSES: (TaskState | "all")[] = ["all", "pending", "running", "done"];
const LABEL: Record<string, string> = {
  all: "Todas",
  pending: "Por hacer",
  running: "Corriendo",
  done: "Hechas",
  dismissed: "Ignoradas",
};

/** YYYY-MM-DD local del teléfono para un ISO (o null si no parsea). */
function localDay(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isFromToday(t: Task): boolean {
  const today = localDay(new Date().toISOString());
  return (
    t.status !== "dismissed" &&
    (localDay(t.created_at) === today ||
      localDay(t.updated_at) === today ||
      localDay(t.done_at) === today ||
      t.status === "running")
  );
}

export function TasksScreen() {
  const app = useApp();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"hoy" | "todas">("todas");
  const [status, setStatus] = useState<TaskState | "all">("all");
  const [onlyFocused, setOnlyFocused] = useState<boolean>(!!app.focused);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const project = onlyFocused ? app.focused ?? undefined : undefined;
      if (scope === "hoy") {
        const all = await api.tasks({ project });
        setTasks(all.filter(isFromToday));
      } else {
        const st = status === "all" ? undefined : status;
        setTasks(await api.tasks({ project, status: st }));
      }
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [app.focused, onlyFocused, scope, status]);

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

      {/* Ámbito: lo de hoy vs histórico completo */}
      <View style={styles.chips}>
        <Chip label="☀ Hoy" on={scope === "hoy"} onPress={() => setScope("hoy")} />
        <Chip label="Histórico" on={scope === "todas"} onPress={() => setScope("todas")} />
      </View>

      {/* Filtros por estado (solo en histórico; Hoy ya trae todos los estados) */}
      {scope === "todas" ? (
        <View style={styles.chips}>
          {STATUSES.map((s) => (
            <Chip key={s} label={LABEL[s]} on={status === s} onPress={() => setStatus(s)} />
          ))}
        </View>
      ) : null}
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
        <Empty
          text={
            scope === "hoy"
              ? "Hoy no se ha movido ninguna tarea. Mira el Histórico."
              : "Sin tareas con este filtro."
          }
        />
      ) : (
        tasks.map((t) => (
          <Card key={t.id} accent={stateColor(t.status)}>
            <View style={styles.row}>
              <Text style={styles.title}>{t.title}</Text>
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
      style={[styles.chip, { borderColor: on ? C.violet : C.line, backgroundColor: on ? "rgba(122,132,255,0.14)" : "transparent" }]}
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
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: C.text, fontSize: 14.5, fontWeight: "700", flex: 1 },
  detail: { color: C.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 6 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  mini: { paddingVertical: 7, paddingHorizontal: 12 },
});
