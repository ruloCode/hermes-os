import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { parseNowPlaying, parseSnapshot, parseWakefulness, type NowPlaying, type TvPower, type TvSnapshot } from "./plan.js";

/**
 * ADB contra la TV por la red (Depuración de red en sus Opciones de
 * desarrollador). Sirve para lo que el control Bluetooth no puede: saber si
 * la pantalla está prendida y abrir una app exacta en un segundo.
 *
 * HERMES_TV_ADB = "ip:puerto" (vacío = sin adb; las teclas siguen por la ESP32).
 * El binario va por ruta absoluta porque launchd no trae el PATH de Homebrew.
 */

const TARGET = process.env.HERMES_TV_ADB?.trim() ?? "";
const ADB_BIN = (() => {
  const fixed = process.env.ADB_BIN?.trim();
  if (fixed) return fixed;
  const known = [
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
    "/opt/homebrew/bin/adb",
    `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`,
  ];
  return known.find((p) => existsSync(p)) ?? "adb";
})();

export const tvAdbConfigured = (): boolean => TARGET !== "";

function adb(args: string[], timeoutMs = 8000): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(ADB_BIN, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: `${stdout}${stderr}`.trim() });
    });
  });
}

/** `adb connect` + comprobar que la TV autorizó a esta Mac. */
async function ready(): Promise<boolean> {
  if (!TARGET) return false;
  await adb(["connect", TARGET], 5000);
  const s = await adb(["-s", TARGET, "get-state"], 4000);
  return s.ok && s.out === "device";
}

/** Prendida/apagada según la TV; "unreachable" si adb no llega (lo normal en reposo). */
export async function tvPowerState(): Promise<TvPower | "unreachable"> {
  if (!(await ready())) return "unreachable";
  const r = await adb(["-s", TARGET, "shell", "dumpsys", "power"]);
  return r.ok ? parseWakefulness(r.out) : "unknown";
}

/**
 * Prender/apagar por adb con KEYCODE_WAKEUP/SLEEP (no alternan). Funciona con
 * la TV en reposo SOLO si su modo de energía es "Alto" (conexión permanente):
 * en "Optimizado" o "Bajo" el reposo apaga la red y adb no llega.
 */
export async function tvAdbPower(want: "on" | "off"): Promise<boolean> {
  if (!(await ready())) return false;
  const key = want === "on" ? "KEYCODE_WAKEUP" : "KEYCODE_SLEEP";
  const r = await adb(["-s", TARGET, "shell", "input", "keyevent", key]);
  return r.ok;
}

/** Teclas que también existen por adb (respaldo cuando el control Bluetooth no está). */
const ADB_KEYCODES: Record<string, string> = {
  home: "KEYCODE_HOME", back: "KEYCODE_BACK", menu: "KEYCODE_MENU",
  up: "KEYCODE_DPAD_UP", down: "KEYCODE_DPAD_DOWN", left: "KEYCODE_DPAD_LEFT", right: "KEYCODE_DPAD_RIGHT",
  ok: "KEYCODE_DPAD_CENTER", "vol+": "KEYCODE_VOLUME_UP", "vol-": "KEYCODE_VOLUME_DOWN", mute: "KEYCODE_VOLUME_MUTE",
  play: "KEYCODE_MEDIA_PLAY_PAUSE", next: "KEYCODE_MEDIA_NEXT", prev: "KEYCODE_MEDIA_PREVIOUS", stop: "KEYCODE_MEDIA_STOP",
  wake: "KEYCODE_WAKEUP", sleep: "KEYCODE_SLEEP",
};

export async function tvAdbKey(key: string): Promise<boolean> {
  const code = ADB_KEYCODES[key];
  if (!code || !(await ready())) return false;
  return (await adb(["-s", TARGET, "shell", "input", "keyevent", code])).ok;
}

/** Enlace profundo: abre ESE contenido dentro de la app (la app tiene que declarar el dominio). */
export async function tvOpenUrl(pkg: string, url: string): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!TARGET) return { ok: false, error: "Abrir contenido necesita adb: define HERMES_TV_ADB." };
  if (!(await ready())) return { ok: false, error: "La TV no responde por adb." };
  const r = await adb(["-s", TARGET, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, pkg]);
  if (!r.ok || /Error|does not exist|unable to resolve/i.test(r.out)) {
    return { ok: false, error: `${pkg} no abrió el enlace (${r.out.split("\n").pop()?.slice(0, 120) ?? "sin detalle"}).` };
  }
  return { ok: true, detail: `abrí el contenido en ${pkg}` };
}

export async function tvOpenApp(pkg: string, fresh = false): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!TARGET) return { ok: false, error: "Abrir apps por nombre necesita adb: define HERMES_TV_ADB (ip:puerto de la TV)." };
  if (!(await ready())) {
    return { ok: false, error: "La TV no responde por adb (¿está apagada o pidió permiso de depuración de nuevo?)." };
  }
  if (fresh) await adb(["-s", TARGET, "shell", "am", "force-stop", pkg]);
  const r = await adb(["-s", TARGET, "shell", "monkey", "-p", pkg, "-c", "android.intent.category.LEANBACK_LAUNCHER", "1"]);
  if (!r.ok || /No activities found|monkey aborted/i.test(r.out)) {
    return { ok: false, error: `No pude abrir ${pkg} en la TV (¿está instalada?).` };
  }
  return { ok: true, detail: `abrí ${pkg}${fresh ? " (desde cero)" : ""}` };
}

/** App al frente + lo que suena (sesión de medios). null en cada campo si la TV no responde. */
export async function tvForeground(): Promise<{ pkg: string | null; now: NowPlaying | null }> {
  if (!(await ready())) return { pkg: null, now: null };
  const [act, media, up] = await Promise.all([
    adb(["-s", TARGET, "shell", "dumpsys", "activity", "activities"]),
    adb(["-s", TARGET, "shell", "dumpsys", "media_session"]),
    adb(["-s", TARGET, "shell", "cat", "/proc/uptime"]),
  ]);
  const pkg = /topResumedActivity=ActivityRecord\{\S+ \S+ ([\w.]+)\//.exec(act.out)?.[1] ?? null;
  const uptimeMs = Math.round(Number(up.out.split(/\s+/)[0]) * 1000);
  return { pkg, now: media.ok && Number.isFinite(uptimeMs) ? parseNowPlaying(media.out, uptimeMs) : null };
}

/**
 * Foto para los vigilantes (anuncios, fin del video, saludo): energía +
 * actividad al frente + sesiones de medios + reloj de la TV en UNA llamada a
 * adb (se pide cada 1-3 s; tres llamadas por foto serían el triple de carga en
 * una TV de 1 GB). Si el shell falla se reconecta una vez.
 */
export async function tvSnapshot(): Promise<TvSnapshot> {
  if (!TARGET) return { power: "unreachable", fg: null, activity: null, yt: null };
  const cmd = "dumpsys power | grep mWakefulness=; dumpsys activity activities | grep topResumedActivity; dumpsys media_session; cat /proc/uptime";
  let r = await adb(["-s", TARGET, "shell", cmd]);
  if (!r.ok) {
    if (!(await ready())) return { power: "unreachable", fg: null, activity: null, yt: null };
    r = await adb(["-s", TARGET, "shell", cmd]);
  }
  return r.ok ? parseSnapshot(r.out) : { power: "unreachable", fg: null, activity: null, yt: null };
}

/** Play que NO alterna (MEDIA_PLAY): reanuda un video pausado sin riesgo de pausarlo. */
export async function tvAdbPlay(): Promise<boolean> {
  if (!(await ready())) return false;
  return (await adb(["-s", TARGET, "shell", "input", "keyevent", "KEYCODE_MEDIA_PLAY"])).ok;
}

/** Abre una actividad exacta ("paquete/.Clase"). */
export async function tvStartActivity(component: string): Promise<{ ok: true; detail: string } | { ok: false; error: string }> {
  if (!TARGET) return { ok: false, error: "Abrir una pantalla necesita adb: define HERMES_TV_ADB." };
  if (!(await ready())) return { ok: false, error: "La TV no responde por adb." };
  const r = await adb(["-s", TARGET, "shell", "am", "start", "-n", component]);
  if (!r.ok || /Error|does not exist|unable to resolve/i.test(r.out)) {
    return { ok: false, error: `no abrió ${component} (${r.out.split("\n").pop()?.slice(0, 120) ?? "sin detalle"})` };
  }
  return { ok: true, detail: `abrí ${component}` };
}
