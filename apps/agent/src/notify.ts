/**
 * Notificación nativa de macOS vía osascript (sin dependencias).
 *
 * Cierra el loop "lancé algo → me avisan": runs de Claude Code y tareas del
 * SDK notifican al terminar/fallar aunque el dashboard no esté a la vista.
 * Se apaga con HERMES_NOTIFY=0.
 */
import { execFile } from "node:child_process";

const enabled = process.platform === "darwin" && process.env.HERMES_NOTIFY !== "0";

// osascript no tiene args parametrizables dentro del string: escapamos las
// comillas y recortamos (una notificación no necesita más de ~200 chars).
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').slice(0, 200);

export function notifyMac(title: string, body: string): void {
  if (!enabled) return;
  const script = `display notification "${esc(body)}" with title "Hermes" subtitle "${esc(title)}" sound name "Glass"`;
  execFile("osascript", ["-e", script], (err) => {
    if (err) console.error("[hermes] notify", err.message);
  });
}
