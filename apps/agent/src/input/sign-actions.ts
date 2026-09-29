import { isSystemSignAction, SYSTEM_SIGN_ACTIONS } from "@hermes/shared";
import { isKeyAction, tapAction } from "./mouse.js";
import { arrangeWindowUnderCursor, teleportWindowUnderCursor } from "./windows.js";

/**
 * Ejecuta una acción de SISTEMA disparada por una seña (WS `sign`). El id
 * ya viene validado contra el catálogo compartido; aquí se rutea a teclas
 * semánticas (robotjs) o al helper de ventanas. Devuelve el resultado con
 * `error` legible para que el HUD/feed lo cuenten tal cual.
 */
export async function runSystemSignAction(
  action: string,
): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!isSystemSignAction(action)) return { ok: false, error: `acción desconocida: ${action}` };
  const label = SYSTEM_SIGN_ACTIONS.find((a) => a.id === action)?.label ?? action;

  switch (action) {
    case "window_next_display": {
      const r = await teleportWindowUnderCursor();
      if ("error" in r) return { ok: false, error: r.error };
      return { ok: true, detail: `${label}: ${r.app} → display ${r.display}` };
    }
    case "window_snap_left":
    case "window_snap_right":
    case "window_maximize":
    case "window_center": {
      const r = await arrangeWindowUnderCursor(action.slice("window_".length) as "snap_left" | "snap_right" | "maximize" | "center");
      if ("error" in r) return { ok: false, error: r.error };
      return { ok: true, detail: `${label}: ${r.app}` };
    }
    default:
      if (isKeyAction(action)) {
        return tapAction(action)
          ? { ok: true, detail: label }
          : { ok: false, error: `${label}: en cooldown o robotjs no disponible` };
      }
      return { ok: false, error: `sin implementación: ${action}` };
  }
}
