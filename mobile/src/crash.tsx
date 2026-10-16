/**
 * Guardián de errores. En un build release, un error de JS no atrapado CIERRA
 * la app sin decir nada ("se abre y se cierra de una", 2026-10-08), y sin
 * cable USB no hay forma de saber por qué. Aquí:
 *
 *  - El handler global de RN se reemplaza: el error se guarda y se muestra en
 *    pantalla en vez de matar el proceso.
 *  - Un ErrorBoundary hace lo mismo con los errores de render.
 *  - Cada error se escribe a disco (síncrono: sobrevive aunque el proceso
 *    muera) y se manda al agente (`POST /mobile/errors`), que lo deja en
 *    ~/.hermes-os/logs/mobile-errors.log para diagnosticar desde la Mac.
 *
 * La grabación vive en el servicio nativo: un error de pantalla NO la corta.
 */
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { File, Paths } from "expo-file-system";
import { getBase, getKey } from "./config";
import { getAccessToken } from "./auth";

export interface CrashReport {
  at: string;
  kind: "fatal" | "error" | "render";
  message: string;
  stack?: string;
  componentStack?: string;
  version: string;
}

const VERSION = "1.5.0";
const PENDING = () => new File(Paths.document, "crash-reports.json");

let current: CrashReport | null = null;
const listeners = new Set<() => void>();

function readPending(): CrashReport[] {
  try {
    const f = PENDING();
    return f.exists ? (JSON.parse(f.textSync()) as CrashReport[]) : [];
  } catch {
    return [];
  }
}

function writePending(list: CrashReport[]) {
  try {
    const f = PENDING();
    if (!f.exists) f.create();
    f.write(JSON.stringify(list.slice(-20)));
  } catch {
    /* sin disco no hay nada más que hacer */
  }
}

/** Manda los reportes guardados al agente; los que llegan salen del archivo. */
export async function flushCrashReports(): Promise<void> {
  const list = readPending();
  if (!list.length) return;
  const token = getAccessToken() || getKey();
  const left: CrashReport[] = [];
  for (const r of list) {
    try {
      const res = await fetch(`${getBase()}/mobile/errors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(r),
      });
      if (!res.ok) left.push(r);
    } catch {
      left.push(r);
    }
  }
  writePending(left);
}

export function reportError(e: unknown, kind: CrashReport["kind"], componentStack?: string) {
  const err = e instanceof Error ? e : new Error(String(e));
  const report: CrashReport = {
    at: new Date().toISOString(),
    kind,
    message: err.message,
    stack: err.stack?.slice(0, 4000),
    componentStack: componentStack?.slice(0, 3000),
    version: VERSION,
  };
  writePending([...readPending(), report]);
  void flushCrashReports();
  if (kind !== "error") {
    current = report;
    for (const l of listeners) l();
  }
}

/** Reemplaza el handler global de RN (que en release mata la app). */
export function installCrashGuard() {
  const g = globalThis as unknown as {
    ErrorUtils?: { setGlobalHandler: (fn: (e: unknown, isFatal?: boolean) => void) => void };
  };
  g.ErrorUtils?.setGlobalHandler((e, isFatal) => reportError(e, isFatal ? "fatal" : "error"));
}

function useCrash(): CrashReport | null {
  return React.useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
    () => current,
  );
}

/** Pantalla de error: dice qué pasó y deja reintentar sin cerrar la app. */
export function CrashScreen({ report, onRetry }: { report: CrashReport; onRetry: () => void }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.h1}>Algo falló en la pantalla</Text>
      <Text style={styles.p}>
        Si estabas grabando, la grabación sigue: vive en el servicio de Android, no en esta
        pantalla. El error ya se mandó a la Mac para arreglarlo.
      </Text>
      <ScrollView style={styles.box}>
        <Text style={styles.mono}>{report.message}</Text>
        {report.stack ? <Text style={[styles.mono, styles.dim]}>{report.stack}</Text> : null}
        {report.componentStack ? (
          <Text style={[styles.mono, styles.dim]}>{report.componentStack}</Text>
        ) : null}
      </ScrollView>
      <Pressable onPress={onRetry} style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.8 : 1 }]}>
        <Text style={styles.btnText}>Reintentar</Text>
      </Pressable>
    </View>
  );
}

class Boundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    reportError(error, "render", info.componentStack ?? undefined);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Envuelve la app: errores de render y fatales globales → CrashScreen. */
export function CrashGuard({ children }: { children: React.ReactNode }) {
  const crash = useCrash();
  const [gen, setGen] = React.useState(0);
  React.useEffect(() => {
    void flushCrashReports();
  }, []);
  if (crash) {
    return (
      <CrashScreen
        report={crash}
        onRetry={() => {
          current = null;
          for (const l of listeners) l();
          setGen((n) => n + 1);
        }}
      />
    );
  }
  return (
    <Boundary key={gen} onError={() => {}}>
      {children}
    </Boundary>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: "#07070c", padding: 22, paddingTop: 60, gap: 14 },
  h1: { color: "#e7e7f2", fontSize: 20, fontWeight: "800" },
  p: { color: "#a0a0b8", fontSize: 13.5, lineHeight: 20 },
  box: { flex: 1, backgroundColor: "#12121f", borderRadius: 10, padding: 12 },
  mono: { color: "#fb7185", fontFamily: "monospace", fontSize: 11.5, marginBottom: 10 },
  dim: { color: "#7a7a92" },
  btn: { backgroundColor: "#7a84ff", borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  btnText: { color: "#07070c", fontSize: 15, fontWeight: "800" },
});
