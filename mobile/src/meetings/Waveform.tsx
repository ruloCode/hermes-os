/**
 * Onda de nivel en vivo: la prueba visible de que el micrófono SÍ está
 * captando (patrón Voice Memos / Otter). Barras simples, sin canvas: llegan
 * ~5 muestras por segundo y cada una es una barra.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import { C } from "../theme";

export function Waveform({
  levels,
  bars = 50,
  height = 44,
  color = C.red,
  muted = false,
}: {
  levels: number[];
  bars?: number;
  height?: number;
  color?: string;
  muted?: boolean;
}) {
  const pad = Math.max(0, bars - levels.length);
  const data = [...Array<number>(pad).fill(0), ...levels.slice(-bars)];
  return (
    <View style={[styles.row, { height }]} accessibilityElementsHidden importantForAccessibility="no">
      {data.map((v, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height: Math.max(3, Math.round(v * height)),
              backgroundColor: muted ? C.textFaint : color,
              opacity: i < pad ? 0.25 : 0.35 + 0.65 * (i / data.length),
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 2 },
  bar: { flex: 1, borderRadius: 2 },
});
