/**
 * Ajustes (overlay): cuenta (sesión Supabase) + conexión al agente. La conexión
 * normal es automática (LAN si estás en la casa, túnel público si no); la URL
 * manual y el API key quedan como escape hatch para apuntar a otra Mac o entrar
 * sin login por LAN. Prueba /health y persiste en AsyncStorage.
 */
import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "../theme";
import { Button, Dim } from "../ui";
import { getKey, getManualUrl, getRemoteUrl, saveConfig } from "../config";
import * as api from "../hermes";
import { useApp } from "../store";

export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const app = useApp();
  const [url, setUrl] = useState(getManualUrl());
  const [key, setKey] = useState(getKey());
  const [test, setTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    await saveConfig(url, key);
    await app.reconnect();
    onClose();
  };

  const probe = async () => {
    setTesting(true);
    setTest(null);
    await saveConfig(url, key);
    await app.reconnect();
    try {
      const h = await api.health();
      setTest(`✓ Conectado${h.machine ? ` · ${h.machine}` : ""}`);
    } catch (e) {
      setTest(`✗ ${e instanceof Error ? e.message : "sin respuesta"}`);
    } finally {
      setTesting(false);
    }
  };

  const logout = async () => {
    await app.signOut();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView>
            <View style={styles.head}>
              <Text style={styles.title}>Ajustes</Text>
              <Text onPress={onClose} style={{ color: C.textDim, fontSize: 22 }}>
                ✕
              </Text>
            </View>

            {/* Cuenta */}
            {app.authed ? (
              <>
                <Text style={styles.label}>CUENTA</Text>
                <View style={styles.accountRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: C.text, fontSize: 13.5 }}>{app.email}</Text>
                    <Dim style={{ fontSize: 11, marginTop: 2 }}>Sesión activa (Supabase)</Dim>
                  </View>
                  <Button label="Cerrar sesión" color={C.red} onPress={() => void logout()} />
                </View>
              </>
            ) : null}

            {/* Estado de conexión */}
            <Text style={styles.label}>CONEXIÓN ACTIVA</Text>
            <Dim style={{ fontSize: 12.5, color: C.cyan }}>{app.agentBase}</Dim>
            {getRemoteUrl() ? (
              <Dim style={styles.hint}>Túnel público conocido: {getRemoteUrl()}</Dim>
            ) : null}
            <Dim style={styles.hint}>
              La app elige sola: LAN de la casa si responde, túnel público si no. Deja la URL
              manual vacía para ese modo automático.
            </Dim>

            <Text style={styles.label}>URL MANUAL (opcional)</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="vacío = automático (LAN + túnel)"
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />

            <Text style={styles.label}>API KEY (fallback sin login)</Text>
            <TextInput
              value={key}
              onChangeText={setKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="HERMES_API_KEY del .env (solo LAN)"
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />

            <View style={{ flexDirection: "row", gap: 8, marginTop: 16 }}>
              <Button label={testing ? "Probando…" : "Probar conexión"} color={C.cyan} onPress={() => void probe()} disabled={testing} style={{ flex: 1 }} />
              <Button label="Guardar" color={C.green} filled onPress={() => void save()} style={{ flex: 1 }} />
            </View>
            {test ? (
              <Text style={{ color: test.startsWith("✓") ? C.green : C.red, marginTop: 12, fontSize: 13 }}>
                {test}
              </Text>
            ) : null}

            <Text
              onPress={() => {
                setUrl("");
                setKey("");
              }}
              style={{ color: C.textDim, marginTop: 18, fontSize: 12 }}
            >
              Restaurar modo automático
            </Text>
            <View style={{ height: 12 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: C.panel2,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderColor: C.line,
    borderWidth: 1,
    padding: 20,
    maxHeight: "88%",
  },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { color: C.text, fontSize: 20, fontWeight: "800" },
  label: { color: C.textDim, fontSize: 10, letterSpacing: 1.4, fontWeight: "700", marginTop: 14, marginBottom: 6 },
  input: {
    backgroundColor: C.bg,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: C.text,
    fontSize: 14,
  },
  hint: { fontSize: 11, lineHeight: 16, marginTop: 6 },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 10 },
});
