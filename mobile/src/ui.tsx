/**
 * Primitivas de UI compartidas (estilo AGENTIC OS). Sin librerías: solo
 * componentes de react-native estilados a mano.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { C } from "./theme";

export function ScreenTitle({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={styles.titleRow}>
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  );
}

export function Card({
  children,
  onPress,
  style,
  accent,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: ViewStyle;
  accent?: string;
}) {
  const body = (
    <View
      style={[
        styles.card,
        accent ? { borderLeftColor: accent, borderLeftWidth: 2.5 } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.7 } : null)}>
      {body}
    </Pressable>
  );
}

export function Pill({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{text.toUpperCase()}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  color = C.violet,
  disabled,
  filled,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
  filled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        {
          borderColor: color,
          backgroundColor: filled ? color : "transparent",
          opacity: disabled ? 0.4 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Text style={[styles.btnText, { color: filled ? C.bg : color }]}>{label}</Text>
    </Pressable>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={C.violet} />
      {label ? <Text style={styles.dim}>{label}</Text> : null}
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  return (
    <View style={styles.center}>
      <Text style={[styles.dim, { textAlign: "center", lineHeight: 20 }]}>{text}</Text>
    </View>
  );
}

export function Dim({ children, style }: { children: React.ReactNode; style?: TextStyle }) {
  return <Text style={[styles.dim, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: {
    color: C.text,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  card: {
    backgroundColor: C.panel,
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: "flex-start",
  },
  pillText: { fontSize: 9, letterSpacing: 1.2, fontWeight: "700" },
  btn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 13, fontWeight: "700", letterSpacing: 0.6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
  dim: { color: C.textDim, fontSize: 12.5 },
});
