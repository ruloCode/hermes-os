/**
 * Ajustes (overlay): editar la URL del agente Hermes y el Bearer. Prueba la
 * conexión (/health) y persiste en AsyncStorage. Los defaults vienen bakeados
 * del APK (EXPO_PUBLIC_*), pero desde aquí puedes apuntar a otra Mac/Tailscale.
 */
import React, { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { C } from "../theme";
import { Button, Dim } from "../ui";
import { getBase, getKey, saveConfig, DEFAULTS } from "../config";
import * as api from "../hermes";
import { useApp } from "../store";

export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const app = useApp();
  const [url, setUrl] = useState(getBase());
  const [key, setKey] = useState(getKey());
  const [test, setTest] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const save = async () => {
    await saveConfig(url, key);
    await app.refreshProjects();
    onClose();
  };

  const probe = async () => {
    setTesting(true);
    setTest(null);
    await saveConfig(url, key);
    try {
      const h = await api.health();
      setTest(`✓ Conectado${h.machine ? ` · ${h.machine}` : ""}`);
    } catch (e) {
      setTest(`✗ ${e instanceof Error ? e.message : "sin respuesta"}`);
    } finally {
      setTesting(false);
    }
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

            <Text style={styles.label}>URL DEL AGENTE (Mac)</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="http://192.168.0.92:8650"
              placeholderTextColor={C.textFaint}
              style={styles.input}
            />
            <Dim style={styles.hint}>
              Misma WiFi que el Mac (LAN) o su IP de Tailscale. El agente debe correr con
              HERMES_API_KEY para escuchar en la red.
            </Dim>

            <Text style={styles.label}>API KEY (Bearer)</Text>
            <TextInput
              value={key}
              onChangeText={setKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="HERMES_API_KEY del .env"
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
                setUrl(DEFAULTS.url);
                setKey(DEFAULTS.key);
              }}
              style={{ color: C.textDim, marginTop: 18, fontSize: 12 }}
            >
              Restaurar valores por defecto
            </Text>
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
});
