// Worker de Python del Dojo (/dojo). Corre el código del alumno con Pyodide
// (CPython compilado a WebAssembly) FUERA del hilo de la página: un bucle
// infinito no congela el dashboard, y la página lo mata con terminate() cuando
// un caso pasa de su tiempo (ver lib/dojo/python.ts).
//
// Es un worker de MÓDULO en /public (nada que empaquetar, CDN fijado): desde la
// 314, Pyodide rechaza los workers clásicos ("Classic web workers are not
// supported") y el importScripts de antes fallaba con un "failed to load" que
// no decía por qué. El harness (packages/shared/src/dojo.ts) llega en el primer
// mensaje: el mismo código decide qué es "pasar" aquí y en los tests del agente
// con CPython.

import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";

let ready = null;

function boot(harness) {
  if (!ready) {
    ready = (async () => {
      const py = await loadPyodide({ indexURL: PYODIDE });
      py.runPython(harness);
      return py;
    })();
  }
  return ready;
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    const py = await boot(msg.harness);
    if (msg.type === "boot") {
      postMessage({ id: msg.id, type: "result", data: null });
      return;
    }
    if (msg.type === "exec") {
      const run = py.globals.get("__dojo_exec");
      const out = run(msg.code);
      run.destroy();
      postMessage({ id: msg.id, type: "result", data: JSON.parse(out) });
      return;
    }
    if (msg.type === "trace" || msg.type === "trace_exec") {
      const run = py.globals.get(msg.type === "trace" ? "__dojo_trace" : "__dojo_trace_exec");
      const out = msg.type === "trace" ? run(msg.code, JSON.stringify(msg.spec)) : run(msg.code);
      run.destroy();
      postMessage({ id: msg.id, type: "result", data: JSON.parse(out) });
      return;
    }
    if (msg.type === "test") {
      // `report` se llama DESDE Python mientras corre: cada caso sale apenas
      // termina, así la página sabe en cuál se colgó si hay que matarlo.
      const report = (s) => postMessage({ id: msg.id, type: "event", data: JSON.parse(s) });
      const run = py.globals.get("__dojo_test");
      const out = run(msg.code, JSON.stringify(msg.spec), report);
      run.destroy();
      postMessage({ id: msg.id, type: "result", data: JSON.parse(out) });
    }
  } catch (err) {
    postMessage({ id: msg.id, type: "error", error: String((err && err.message) || err) });
  }
};
