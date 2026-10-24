"use client";

// Estado de Python en el navegador (Pyodide en su worker), para decir la verdad
// en la UI: "cargando" la primera vez que se baja, "listo", o el motivo si no
// cargó.

import { useSyncExternalStore } from "react";
import { pythonStatus, subscribePython, type PythonStatus } from "@/lib/dojo/python";

export function usePythonStatus(): PythonStatus {
  return useSyncExternalStore(subscribePython, pythonStatus, () => "idle" as const);
}
