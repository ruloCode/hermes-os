/**
 * Proyectos: lee /projects del agente (verdad = vault de Obsidian). Tap para
 * ver estado actual + tareas pendientes. Resalta el proyecto en foco (voz).
 */
import React, { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { C, stateColor } from "../theme";
import { Card, Dim, Empty, Loading, Pill, ScreenTitle } from "../ui";
import { useApp } from "../store";

export function ProjectsScreen() {
  const app = useApp();
  const [open, setOpen] = useState<string | null>(app.focused);

  if (app.projectsLoading && app.projects.length === 0) return <Loading label="Cargando proyectos…" />;

  return (
    <ScrollView
      style={styles.wrap}
      refreshControl={
        <RefreshControl
          refreshing={app.projectsLoading}
          onRefresh={() => void app.refreshProjects()}
          tintColor={C.violet}
        />
      }
    >
      <ScreenTitle
        title="Proyectos"
        right={<Dim>{app.projects.length}</Dim>}
      />
      {app.online === false ? (
        <Empty text={`No alcanzo al agente. Revisa la conexión en Ajustes (⚙).`} />
      ) : app.projects.length === 0 ? (
        <Empty text="Sin proyectos en el vault." />
      ) : (
        app.projects.map((p) => {
          const isOpen = open === p.slug;
          const focused = app.focused === p.slug;
          return (
            <Card
              key={p.slug}
              accent={focused ? C.violetHot : stateColor(p.estado)}
              onPress={() => setOpen(isOpen ? null : p.slug)}
            >
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>
                    {focused ? "◉ " : ""}
                    {p.name}
                  </Text>
                  <Dim style={{ fontSize: 11 }}>{p.slug}</Dim>
                </View>
                <Pill text={p.estado} color={stateColor(p.estado)} />
              </View>

              {isOpen ? (
                <View style={{ marginTop: 12, gap: 10 }}>
                  {p.estado_actual ? (
                    <View>
                      <Text style={styles.label}>ESTADO ACTUAL</Text>
                      <Text style={styles.body}>{p.estado_actual.trim().slice(0, 900)}</Text>
                    </View>
                  ) : null}
                  {p.tareas_pendientes?.length ? (
                    <View>
                      <Text style={styles.label}>TAREAS PENDIENTES</Text>
                      {p.tareas_pendientes.slice(0, 8).map((t, i) => (
                        <Text key={i} style={styles.body}>
                          • {t}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  {p.rama ? <Dim style={{ fontSize: 11 }}>rama: {p.rama}</Dim> : null}
                </View>
              ) : (
                <Text numberOfLines={2} style={[styles.body, { marginTop: 8 }]}>
                  {p.estado_actual?.trim().split("\n")[0] || "Sin estado registrado."}
                </Text>
              )}
            </Card>
          );
        })
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, paddingHorizontal: 18, paddingTop: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { color: C.text, fontSize: 15.5, fontWeight: "700" },
  label: { color: C.textDim, fontSize: 9.5, letterSpacing: 1.5, fontWeight: "700", marginBottom: 5 },
  body: { color: C.text, fontSize: 13, lineHeight: 20, marginBottom: 2 },
});
