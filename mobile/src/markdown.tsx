/**
 * Renderizador de markdown mínimo para React Native (puerto del Markdown.tsx del
 * dashboard web). Construye nodos <Text>/<View> — seguro y sin dependencias.
 * Cubre lo que produce Hermes: títulos, listas, código en bloque/inline, citas,
 * separadores, énfasis y enlaces. Estilizado con el tema AGENTIC OS.
 */
import React, { type ReactNode } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { C, mono } from "./theme";

function renderInline(text: string, kp: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${kp}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <Text key={key} style={styles.codeInline}>
          {tok.slice(1, -1)}
        </Text>,
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        <Text key={key} style={styles.strong}>
          {tok.slice(2, -2)}
        </Text>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /\[([^\]]+)\]\(([^)]+)\)/.exec(tok);
      nodes.push(
        mm ? (
          <Text key={key} style={styles.link} onPress={() => void Linking.openURL(mm[2]).catch(() => {})}>
            {mm[1]}
          </Text>
        ) : (
          tok
        ),
      );
    } else {
      nodes.push(
        <Text key={key} style={styles.em}>
          {tok.replace(/^[*_]|[*_]$/g, "")}
        </Text>,
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const SPECIAL = /^(#{1,6})\s|^```|^>\s?|^\s*[-*+]\s+|^\s*\d+\.\s+|^(-{3,}|\*{3,}|_{3,})\s*$/;
const H_SIZE = [22, 19, 16, 14.5]; // h1..h4

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código ```
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(
        <View key={key++} style={styles.pre}>
          <Text style={styles.preText}>{buf.join("\n")}</Text>
        </View>,
      );
      continue;
    }

    // Título
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const lvl = Math.min(h[1].length, 4);
      blocks.push(
        <Text key={key} style={[styles.h, { fontSize: H_SIZE[lvl - 1], marginTop: lvl <= 2 ? 16 : 12 }]}>
          {renderInline(h[2], `h${key++}`)}
        </Text>,
      );
      i++;
      continue;
    }

    // Separador
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(<View key={key++} style={styles.hr} />);
      i++;
      continue;
    }

    // Cita
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(
        <View key={key} style={styles.quote}>
          <Text style={styles.quoteText}>{renderInline(buf.join(" "), `q${key++}`)}</Text>
        </View>,
      );
      continue;
    }

    // Lista no ordenada
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push(
        <View key={key++} style={styles.list}>
          {items.map((it, idx) => (
            <View key={idx} style={styles.li}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.liText}>{renderInline(it, `li${key}-${idx}`)}</Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }

    // Lista ordenada
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <View key={key++} style={styles.list}>
          {items.map((it, idx) => (
            <View key={idx} style={styles.li}>
              <Text style={[styles.bullet, styles.num]}>{idx + 1}.</Text>
              <Text style={styles.liText}>{renderInline(it, `ol${key}-${idx}`)}</Text>
            </View>
          ))}
        </View>,
      );
      continue;
    }

    // Línea en blanco
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Párrafo (junta líneas consecutivas no especiales)
    const buf: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !SPECIAL.test(lines[i])) {
      buf.push(lines[i++]);
    }
    blocks.push(
      <Text key={key} style={styles.p}>
        {renderInline(buf.join(" "), `p${key++}`)}
      </Text>,
    );
  }

  return <View>{blocks}</View>;
}

const styles = StyleSheet.create({
  h: { color: C.text, fontWeight: "800", letterSpacing: 0.2, marginBottom: 6 },
  p: { color: C.text, fontSize: 13.5, lineHeight: 21, marginBottom: 9, opacity: 0.92 },
  strong: { fontWeight: "800", color: C.text },
  em: { fontStyle: "italic", color: C.text },
  link: { color: C.cyan, textDecorationLine: "underline" },
  codeInline: {
    fontFamily: mono,
    fontSize: 12,
    color: C.violetHot,
    backgroundColor: "rgba(122,132,255,0.12)",
  },
  pre: {
    backgroundColor: "#0a0a12",
    borderColor: C.line,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  preText: { fontFamily: mono, fontSize: 11.5, color: C.text, lineHeight: 17 },
  hr: { height: 1, backgroundColor: C.line, marginVertical: 12, borderRadius: 1 },
  quote: {
    borderLeftColor: C.violet,
    borderLeftWidth: 2.5,
    paddingLeft: 12,
    marginBottom: 10,
    opacity: 0.9,
  },
  quoteText: { color: C.textDim, fontSize: 13, lineHeight: 20, fontStyle: "italic" },
  list: { marginBottom: 10, gap: 4 },
  li: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bullet: { color: C.violet, fontSize: 13.5, lineHeight: 21, width: 16 },
  num: { fontFamily: mono, fontSize: 12, width: 22 },
  liText: { color: C.text, fontSize: 13.5, lineHeight: 21, flex: 1, opacity: 0.92 },
});
