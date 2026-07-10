/**
 * Login con email+contraseña (Supabase Auth). Es la puerta de la app: sin
 * sesión no hay tabs. Tras entrar, el store resuelve la base URL (LAN o túnel)
 * y refresca proyectos. El ⚙ abre Ajustes como escape hatch (URL manual + API
 * key) por si Supabase no responde y estás en la LAN de la casa.
 */
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { C } from "../theme";
import { Button, Dim } from "../ui";
import { useApp } from "../store";

export function LoginScreen() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim() || !password) {
      setError("Escribe tu email y tu contraseña.");
      return;
    }
    setBusy(true);
    setError(null);
    const err = await app.signIn(email, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={styles.logo}>◉</Text>
          <Text style={styles.name}>HERMES</Text>
          <Dim style={{ letterSpacing: 3, fontSize: 10 }}>AGENTIC OS · MÓVIL</Dim>
        </View>

        <Text style={styles.label}>EMAIL</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="tu@email.com"
          placeholderTextColor={C.textFaint}
          style={styles.input}
        />

        <Text style={styles.label}>CONTRASEÑA</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="••••••••"
          placeholderTextColor={C.textFaint}
          style={styles.input}
          onSubmitEditing={() => void submit()}
        />

        <Button
          label={busy ? "Entrando…" : "Entrar"}
          color={C.violet}
          filled
          disabled={busy}
          onPress={() => void submit()}
          style={{ marginTop: 20 }}
        />

        {error ? <Text style={styles.error}>⚠ {error}</Text> : null}

        <Pressable onPress={() => app.setSettingsOpen(true)} style={{ marginTop: 28 }}>
          <Dim style={{ textAlign: "center", fontSize: 12 }}>
            ⚙ Conexión manual (LAN + API key)
          </Dim>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 28, paddingVertical: 40 },
  brand: { alignItems: "center", marginBottom: 36, gap: 6 },
  logo: { color: C.violetHot, fontSize: 42 },
  name: { color: C.text, fontSize: 26, fontWeight: "800", letterSpacing: 8 },
  label: {
    color: C.textDim,
    fontSize: 10,
    letterSpacing: 1.4,
    fontWeight: "700",
    marginTop: 14,
    marginBottom: 6,
  },
  input: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: C.text,
    fontSize: 15,
  },
  error: { color: C.red, marginTop: 14, fontSize: 13, textAlign: "center" },
});
