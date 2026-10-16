/**
 * Raíz registrada en AppRegistry. Carga `App` de forma DIFERIDA dentro de un
 * try: si un módulo truena al evaluarse (el caso de DOMException en la 1.4.0),
 * la app se registra igual y muestra el error en vez de cerrarse, y el reporte
 * llega a la Mac. Además garantiza que registerGlobals() de LiveKit (index.js)
 * corrió ANTES de evaluar cualquier módulo de voz.
 */
import React from "react";
import { CrashScreen, reportError } from "./crash";

type AppComponent = React.ComponentType;

let loaded: { App: AppComponent } | { error: unknown } | null = null;

function load() {
  if (!loaded) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = { App: (require("../App") as { default: AppComponent }).default };
    } catch (error) {
      reportError(error, "fatal");
      loaded = { error };
    }
  }
  return loaded;
}

export function Root() {
  const [, retry] = React.useState(0);
  const l = load();
  if ("App" in l) return <l.App />;
  const err = l.error instanceof Error ? l.error : new Error(String(l.error));
  return (
    <CrashScreen
      report={{
        at: new Date().toISOString(),
        kind: "fatal",
        message: err.message,
        stack: err.stack,
        version: "",
      }}
      onRetry={() => {
        loaded = null;
        retry((n) => n + 1);
      }}
    />
  );
}
