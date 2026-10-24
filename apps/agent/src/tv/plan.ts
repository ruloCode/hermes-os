import { cronError } from "../scheduled/cron.js";

/**
 * Lógica pura del control de la TV (sin red, sin serie, sin adb): qué teclas
 * existen, qué hace cada escena, cómo decidir el encendido sin un estado real
 * y qué rutas abre el token de la TV. Todo lo que tiene efectos vive en
 * remote.ts (ESP32 por USB) y adb.ts.
 */

/** Teclas que entiende el firmware de la ESP32 (hermes-tv/firmware/control-tv). */
export const TV_KEYS = [
  "power", "home", "back", "menu", "search",
  "up", "down", "left", "right", "ok",
  "vol+", "vol-", "mute", "play", "next", "prev", "stop",
  "wake", "sleep",
] as const;
export type TvKey = (typeof TV_KEYS)[number];

export function isTvKey(k: string): k is TvKey {
  return (TV_KEYS as readonly string[]).includes(k);
}

/**
 * Lo que responde el firmware a una orden: "ok …" o "error: …". Las líneas de
 * log ("[ble] …", "[wifi] …") se ignoran — llegan mezcladas en el mismo puerto.
 */
export function parseRemoteLine(line: string): { ok: true; detail: string } | { ok: false; error: string } | null {
  const l = line.trim();
  if (l.startsWith("ok")) return { ok: true, detail: l.slice(2).trim() };
  if (l.startsWith("error")) return { ok: false, error: l.replace(/^error:?\s*/, "") };
  return null;
}

/** "ble=conectado wifi=sin-config" → ¿la TV está enlazada por Bluetooth? */
export function remoteConnected(statusLine: string): boolean {
  return /\bble=conectado\b/.test(statusLine);
}

/**
 * Estado de la pantalla según `dumpsys power` (mWakefulness=Awake|Asleep|Dozing|Dreaming).
 * Dreaming = protector de pantalla: la TV está prendida.
 */
export type TvPower = "on" | "off" | "unknown";

export function parseWakefulness(dumpsys: string): TvPower {
  const m = /mWakefulness=(\w+)/.exec(dumpsys);
  if (!m) return "unknown";
  return m[1] === "Awake" || m[1] === "Dreaming" ? "on" : "off";
}

/**
 * Prender/apagar usa `wake`/`sleep` del control (System Control HID →
 * KEYCODE_WAKEUP/SLEEP), que NO alternan: despertar una TV prendida o dormir
 * una apagada no hace nada. El botón `power` sí alterna y NO se usa para esto:
 * el 2026-10-20 "prender" a ciegas APAGÓ la TV — después del reposo el Wi-Fi
 * tarda más de un minuto en volver, así que "adb no responde" no significa
 * "está apagada".
 *
 * Con adb se ahorra la tecla si la TV ya está como se pide; sin adb se manda
 * igual, porque mandarla de más es inofensivo.
 */
export function powerPlan(want: "on" | "off", state: TvPower | "unreachable"): "press" | "skip" {
  if (state === "on" || state === "off") return state === want ? "skip" : "press";
  return "press";
}

/** La tecla que lleva la TV al estado pedido sin riesgo de invertirlo. */
export const powerKey = (want: "on" | "off"): TvKey => (want === "on" ? "wake" : "sleep");

// ── Escenas ─────────────────────────────────────────────────────────────

// Una escena = pasos en orden. Las de fábrica son genéricas; las del dueño (con
// SU serie, SU tono de luz) viven en ~/.hermes-os/escenas.json — nunca en el
// código. El archivo reemplaza por id y agrega nuevas.

export type SceneStep =
  | { kind: "lights"; action: string; value?: string }
  | { kind: "tv-power"; action: "on" | "off" }
  /**
   * Abre una app (por nombre o paquete) y, si hay url, ese contenido exacto
   * (enlace profundo). `fresh` la cierra antes: una app ya abierta vuelve a la
   * pantalla donde quedó y las teclas que siguen caerían en otro lado.
   */
  | { kind: "tv-open"; app: string; url?: string; fresh?: boolean }
  | { kind: "tv-key"; key: TvKey }
  | { kind: "wait"; ms: number }
  /**
   * Brillo gradual minuto a minuto (amanecer, descanso). `from` lo fija al empezar.
   * `background` = no bloquea los pasos siguientes (la luz sube MIENTRAS suena el video).
   */
  | { kind: "lights-ramp"; to: number; minutes: number; from?: number; background?: boolean }
  /**
   * Pone ESE video de YouTube en la TV (prendiéndola) y arranca el vigilante que
   * salta anuncios. `duration_s` (de yt-dlp, guardada en la escena) deja saber
   * cuándo termina sin buscar nada a la hora de la escena.
   */
  | { kind: "tv-youtube"; id: string; title?: string; duration_s?: number }
  /**
   * Espera a que TERMINE el video que puso el paso tv-youtube anterior (datos de
   * la sesión de medios, no un temporizador). Si el dueño lo cambió o apagó la
   * TV, la escena se detiene: no se le vuelve a prender nada encima.
   */
  | { kind: "wait-video-end"; max_ms: number }
  /**
   * Saludo hablado en la TV (despertar): buenos días + fecha + semana + plan
   * del día con datos reales, y `outro` al final ("ahora, la meditación").
   * Espera a que termine de hablar antes del siguiente paso.
   */
  | { kind: "tv-greeting"; outro?: string }
  /** Aviso hablado de una sección del día ("comienza la rutina de calistenia"), con la voz de Hermes. */
  | { kind: "tv-say"; title: string; text: string }
  /**
   * Felicitación de progreso: marca el hábito de HOY y dice la racha real.
   * Solo si el video anterior de la escena llegó al final (rutina completa).
   */
  | { kind: "habit-cheer"; habit: string }
  /** Temporizador de apagado de la TV (como /tv/sleep). */
  | { kind: "tv-sleep"; minutes: number }
  /**
   * Espera a que el dueño CONFIRME que está de pie (OK en la TV o "ya me
   * levanté" en el chat) y le dice sus puntos; mientras tanto la TV muestra
   * "¿Ya estás de pie?" e insiste cada tanto. Sin confirmación en `max_ms`, la
   * mañana queda en 0 y la escena se detiene (nada de música a la cama).
   */
  | { kind: "wait-awake"; max_ms: number; next?: string };

export interface SceneDef {
  id: string;
  name: string;
  steps: SceneStep[];
  /** Horario propio (cron de 5 campos, zona del dueño): "30 22 * * *" = todos los días 22:30. */
  cron?: string;
  /**
   * Se dispara N minutos antes de tu hora de despertar (compromiso o alarma del
   * teléfono): amanecer = 15; despertar = 0 (a la hora).
   */
  before_alarm_min?: number;
}

/** Película: luz cálida y baja, TV prendida. Buenas noches: todo apagado. */
export const DEFAULT_SCENES: SceneDef[] = [
  {
    id: "cine",
    name: "Modo película",
    steps: [
      { kind: "lights", action: "temperature", value: "2700" },
      { kind: "lights", action: "brightness", value: "20" },
      { kind: "tv-power", action: "on" },
    ],
  },
  {
    id: "noches",
    name: "Buenas noches",
    steps: [
      { kind: "lights", action: "off" },
      { kind: "tv-power", action: "off" },
    ],
  },
];

const WAIT_MAX_MS = 30_000;
/** wait-video-end: entre 10 s y 3 h (una mezcla larga de música cabe). */
const VIDEO_WAIT_MIN_MS = 10_000;
const VIDEO_WAIT_MAX_MS = 3 * 3600_000;
const STEPS_MAX = 20;
/** wait-awake: hasta 2 h esperando que te levantes. */
const WAKE_WAIT_MAX_MS = 2 * 3600_000;

function parseStep(raw: unknown, where: string): SceneStep | string {
  if (!raw || typeof raw !== "object") return `${where}: no es un objeto`;
  const o = raw as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  switch (o.kind) {
    case "lights":
      if (!str("action")) return `${where}: lights sin action`;
      return { kind: "lights", action: str("action"), ...(o.value != null ? { value: String(o.value) } : {}) };
    case "tv-power":
      if (o.action !== "on" && o.action !== "off") return `${where}: tv-power.action debe ser on u off`;
      return { kind: "tv-power", action: o.action };
    case "tv-open": {
      if (!str("app")) return `${where}: tv-open sin app`;
      const url = str("url");
      if (url && !/^https?:\/\//.test(url)) return `${where}: tv-open.url debe empezar con http(s)://`;
      return { kind: "tv-open", app: str("app"), ...(url ? { url } : {}), ...(o.fresh === true ? { fresh: true } : {}) };
    }
    case "tv-key": {
      const key = str("key").toLowerCase();
      if (!isTvKey(key)) return `${where}: tecla desconocida '${key}'`;
      return { kind: "tv-key", key };
    }
    case "wait": {
      const ms = Number(o.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > WAIT_MAX_MS) return `${where}: wait.ms debe ser 0-${WAIT_MAX_MS}`;
      return { kind: "wait", ms: Math.round(ms) };
    }
    case "lights-ramp": {
      const to = Number(o.to);
      const minutes = Number(o.minutes);
      const from = o.from == null ? undefined : Number(o.from);
      if (!Number.isFinite(to) || to < 0 || to > 100) return `${where}: lights-ramp.to debe ser 0-100`;
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) return `${where}: lights-ramp.minutes debe ser 1-60`;
      if (from !== undefined && (!Number.isFinite(from) || from < 1 || from > 100)) return `${where}: lights-ramp.from debe ser 1-100`;
      return {
        kind: "lights-ramp",
        to: Math.round(to),
        minutes: Math.round(minutes),
        ...(from !== undefined ? { from: Math.round(from) } : {}),
        ...(o.background === true ? { background: true } : {}),
      };
    }
    case "tv-youtube": {
      const id = str("id");
      if (!/^[\w-]{11}$/.test(id)) return `${where}: tv-youtube.id debe ser el id de 11 caracteres del video`;
      const dur = o.duration_s == null ? undefined : Number(o.duration_s);
      if (dur !== undefined && (!Number.isFinite(dur) || dur < 1 || dur > 43_200)) return `${where}: tv-youtube.duration_s debe ser 1-43200`;
      return { kind: "tv-youtube", id, ...(str("title") ? { title: str("title") } : {}), ...(dur !== undefined ? { duration_s: Math.round(dur) } : {}) };
    }
    case "tv-say": {
      const title = str("title");
      const text = str("text");
      if (!title || !text) return `${where}: tv-say necesita title y text`;
      if (title.length > 60 || text.length > 600) return `${where}: tv-say demasiado largo (title ≤60, text ≤600)`;
      return { kind: "tv-say", title, text };
    }
    case "habit-cheer": {
      if (!str("habit")) return `${where}: habit-cheer sin habit`;
      return { kind: "habit-cheer", habit: str("habit") };
    }
    case "tv-greeting": {
      const outro = str("outro");
      if (outro.length > 200) return `${where}: tv-greeting.outro máximo 200 caracteres`;
      return { kind: "tv-greeting", ...(outro ? { outro } : {}) };
    }
    case "wait-video-end": {
      const ms = Number(o.max_ms);
      if (!Number.isFinite(ms) || ms < VIDEO_WAIT_MIN_MS || ms > VIDEO_WAIT_MAX_MS) {
        return `${where}: wait-video-end.max_ms debe ser ${VIDEO_WAIT_MIN_MS}-${VIDEO_WAIT_MAX_MS}`;
      }
      return { kind: "wait-video-end", max_ms: Math.round(ms) };
    }
    case "wait-awake": {
      const ms = Number(o.max_ms);
      if (!Number.isFinite(ms) || ms < 60_000 || ms > WAKE_WAIT_MAX_MS) return `${where}: wait-awake.max_ms debe ser 60000-${WAKE_WAIT_MAX_MS}`;
      const next = str("next");
      if (next.length > 200) return `${where}: wait-awake.next máximo 200 caracteres`;
      return { kind: "wait-awake", max_ms: Math.round(ms), ...(next ? { next } : {}) };
    }
    case "tv-sleep": {
      const minutes = Number(o.minutes);
      if (!Number.isFinite(minutes) || minutes < 0 || minutes > 360) return `${where}: tv-sleep.minutes debe ser 0-360`;
      return { kind: "tv-sleep", minutes: Math.round(minutes) };
    }
    default:
      return `${where}: kind desconocido '${String(o.kind)}'`;
  }
}

/**
 * Lee escenas.json ({ scenes: [...] }) y las mezcla con las de fábrica: mismo
 * id = la del archivo manda. Una escena con un paso inválido se descarta ENTERA
 * (media escena a oscuras es peor que ninguna) y el motivo vuelve en errors.
 */
export function parseScenes(raw: unknown): { scenes: SceneDef[]; errors: string[] } {
  const errors: string[] = [];
  const byId = new Map(DEFAULT_SCENES.map((s) => [s.id, s]));
  const list = raw && typeof raw === "object" ? (raw as { scenes?: unknown }).scenes : undefined;
  if (raw != null && !Array.isArray(list)) errors.push("escenas.json: falta la lista 'scenes'");
  for (const [i, item] of (Array.isArray(list) ? list : []).entries()) {
    const o = (item ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
    const where = `escena ${id || `#${i + 1}`}`;
    if (!/^[a-z0-9-]{1,32}$/.test(id)) {
      errors.push(`${where}: id inválido (a-z, 0-9, guiones)`);
      continue;
    }
    if (!Array.isArray(o.steps) || o.steps.length === 0 || o.steps.length > STEPS_MAX) {
      errors.push(`${where}: steps debe tener 1-${STEPS_MAX} pasos`);
      continue;
    }
    const steps: SceneStep[] = [];
    let bad = false;
    for (const [j, st] of o.steps.entries()) {
      const r = parseStep(st, `${where}, paso ${j + 1}`);
      if (typeof r === "string") {
        errors.push(r);
        bad = true;
        break;
      }
      steps.push(r);
    }
    if (bad) continue;
    const cron = typeof o.cron === "string" && o.cron.trim() ? o.cron.trim() : undefined;
    const cronWhy = cron ? cronError(cron) : null;
    if (cronWhy) {
      errors.push(`${where}: cron inválido (${cronWhy})`);
      continue;
    }
    let beforeAlarm: number | undefined;
    if (o.before_alarm_min != null) {
      beforeAlarm = Number(o.before_alarm_min);
      if (!Number.isFinite(beforeAlarm) || beforeAlarm < 0 || beforeAlarm > 60) {
        errors.push(`${where}: before_alarm_min debe ser 0-60 (0 = a la hora)`);
        continue;
      }
    }
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : id;
    byId.set(id, { id, name, steps, ...(cron ? { cron } : {}), ...(beforeAlarm !== undefined ? { before_alarm_min: Math.round(beforeAlarm) } : {}) });
  }
  return { scenes: [...byId.values()], errors };
}

// ── Apps ────────────────────────────────────────────────────────────────

/** Nombre dicho → paquete. Solo apps que existen en una Google TV típica. */
const APP_ALIASES: Record<string, string> = {
  netflix: "com.netflix.ninja",
  youtube: "com.google.android.youtube.tv",
  "disney": "com.disney.disneyplus",
  "disney+": "com.disney.disneyplus",
  "prime": "com.amazon.amazonvideo.livingroom",
  "prime video": "com.amazon.amazonvideo.livingroom",
  "amazon": "com.amazon.amazonvideo.livingroom",
  "hbo": "com.wbd.stream",
  "hbo max": "com.wbd.stream",
  "max": "com.wbd.stream",
  spotify: "com.spotify.tv.android",
  // Navegador de la TV (TV Bro, de Play Store: Firefox/Opera no son compatibles con Google TV).
  navegador: "com.phlox.tvwebbrowser",
  "tv bro": "com.phlox.tvwebbrowser",
  browser: "com.phlox.tvwebbrowser",
  internet: "com.phlox.tvwebbrowser",
};

const strip = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** "Netflix" → com.netflix.ninja; un paquete escrito tal cual pasa directo. */
export function resolveTvApp(name: string): string | null {
  const q = strip(name);
  if (/^[a-z][\w]*(\.[\w]+)+$/.test(q)) return q;
  return APP_ALIASES[q] ?? null;
}

// ── Token de la TV ──────────────────────────────────────────────────────

/**
 * La app de la TV entra con HERMES_TV_TOKEN, que SOLO abre su pantalla, "Mi
 * día" (lectura: marcar pendientes es desde el teléfono) y las escenas: la TV es un aparato de la sala y su APK se puede leer, así que no
 * lleva la llave de toda la casa.
 */
export function tvTokenAllows(method: string, path: string): boolean {
  if (method === "GET" && (path === "/tv/home" || path === "/tv/scenes" || path === "/day")) return true;
  // El saludo del despertar que la TV reproduce (texto + audio, solo lectura).
  if (method === "GET" && (path === "/tv/greeting" || path === "/tv/greeting.mp3")) return true;
  // "¿Ya estás de pie?": la pantalla de espera lee el estado y el OK confirma.
  if (method === "GET" && path === "/wake") return true;
  if (method === "POST" && path === "/wake/confirm") return true;
  if (method === "POST" && (path === "/tv/scene" || path === "/tv/sleep")) return true;
  return false;
}

/** Minutos del temporizador: 0 cancela; tope de 6 h. */
export function parseSleepMinutes(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 360) return null;
  return Math.round(n);
}

// ── Horarios de escenas ─────────────────────────────────────────────────

/** Brillo del paso i (1..minutes) de una rampa: lineal y redondeado, nunca 0 (0 = apagado en la tira). */
export function rampLevel(from: number, to: number, minutes: number, i: number): number {
  return Math.max(1, Math.round(from + ((to - from) * i) / minutes));
}

/** Una escena "antes de tu hora" corre una vez por mañana: otra hora a menos de esto es la misma mañana. */
const SAME_MORNING_MS = 3 * 3600_000;
/** Ventana de la escena "a la hora" (before_alarm_min = 0): el job corre cada minuto. */
const AT_TIME_WINDOW_MS = 5 * 60_000;

/**
 * ¿Toca la escena "antes de la alarma"? Sí cuando ya entramos en la ventana
 * [hora − N min, hora) — con N = 0, [hora, hora + 5 min) — y esa mañana aún no
 * la disparó (firedFor: el compromiso de las 5:20 ya disparó, la alarma de las
 * 5:30 no vuelve a hacerlo).
 */
export function alarmDue(alarmAt: string | null, beforeMin: number, now: Date, firedFor: string | null): boolean {
  if (!alarmAt) return false;
  const t = Date.parse(alarmAt);
  if (!Number.isFinite(t)) return false;
  // Se compara el INSTANTE, no el texto: "10:30:00Z" y "10:30:00.000Z" son la misma alarma.
  if (firedFor && Math.abs(Date.parse(firedFor) - t) < SAME_MORNING_MS) return false;
  const start = t - beforeMin * 60_000;
  const end = beforeMin > 0 ? t : t + AT_TIME_WINDOW_MS;
  return now.getTime() >= start && now.getTime() < end;
}

// ── Qué está sonando (dumpsys media_session) ────────────────────────────

export interface NowPlaying {
  pkg: string;
  state: "playing" | "paused";
  title: string;
  /** Canal o artista, si la app lo da (YouTube sí; Prime no da nada). */
  subtitle: string | null;
  /** Segundos reproducidos ahora (contando lo que corrió desde la última actualización). */
  position_s: number;
}

const APP_NAMES: Record<string, string> = {
  "com.google.android.youtube.tv": "YouTube",
  "com.netflix.ninja": "Netflix",
  "com.amazon.amazonvideo.livingroom": "Prime Video",
  "com.wbd.stream": "HBO Max",
  "com.disney.disneyplus": "Disney+",
  "com.spotify.tv.android": "Spotify",
  "os.hermes.tv": "Hermes TV",
  "com.phlox.tvwebbrowser": "Navegador",
};

/** com.google.android.youtube.tv → "YouTube"; desconocido → null (no se inventa un nombre). */
export const appName = (pkg: string | null | undefined): string | null => (pkg ? APP_NAMES[pkg] ?? null : null);

/**
 * La sesión de medios que de verdad suena: la primera con PLAYING o PAUSED que
 * no sea el audio Bluetooth del sistema. `uptimeMs` = reloj de la TV
 * (/proc/uptime): `updated` va en ese reloj, así se suma lo que corrió.
 */
export function parseNowPlaying(dumpsys: string, uptimeMs: number): NowPlaying | null {
  const blocks = dumpsys.split(/\n(?=\s*package=)/);
  for (const b of blocks) {
    const pkg = /package=([\w.]+)/.exec(b)?.[1];
    if (!pkg || pkg === "com.android.bluetooth") continue;
    const st = /state=PlaybackState \{state=(PLAYING|PAUSED)\(\d\), position=(\d+)[^}]*?updated=(\d+)/.exec(b);
    if (!st) continue;
    const desc = /description=(.*)/.exec(b)?.[1]?.replace(/, null\s*$/, "").trim();
    if (!desc || desc === "null") continue;
    const cut = desc.lastIndexOf(", ");
    const title = cut > 0 ? desc.slice(0, cut) : desc;
    const subtitle = cut > 0 ? desc.slice(cut + 2) : null;
    const playing = st[1] === "PLAYING";
    const pos = Number(st[2]) + (playing ? Math.max(0, uptimeMs - Number(st[3])) : 0);
    return { pkg, state: playing ? "playing" : "paused", title, subtitle: subtitle && subtitle !== "null" ? subtitle : null, position_s: Math.round(pos / 1000) };
  }
  return null;
}

// ── YouTube: anuncios y fin del video ───────────────────────────────────
//
// Medido en la TV el 2026-10-20 (dumpsys media_session de la app de YouTube):
// - Durante un anuncio la sesión trae el título del video PEDIDO, no el del
//   anuncio: el título no sirve para detectarlo.
// - Lo que cambia son las acciones: el video de verdad deja buscar
//   (actions=379, con SEEK_TO) y el anuncio no (actions=51). La posición
//   arranca de 0 en cada anuncio.
// - Entre anuncio y anuncio la sesión desaparece 1-2 s. Una encuesta de
//   anunciantes ("Saltar encuesta") no tiene sesión y se cierra sola (~15 s).
// - Pasado el conteo, UN OK (DPAD_CENTER) salta: el foco cae en "Saltar".

export const YOUTUBE_PKG = "com.google.android.youtube.tv";
/** PlaybackState.ACTION_SEEK_TO */
const ACTION_SEEK_TO = 256;

export interface YtSession {
  state: "playing" | "paused" | "other";
  /** El video de verdad deja buscar; un anuncio no. */
  seekable: boolean;
  title: string | null;
  position_s: number;
}

/** La sesión de la app de YouTube (null si no hay). `uptimeMs` = /proc/uptime de la TV. */
export function parseYouTubeSession(dumpsys: string, uptimeMs: number): YtSession | null {
  for (const b of dumpsys.split(/\n(?=\s*package=)/)) {
    if (!/package=com\.google\.android\.youtube\.tv\b/.test(b)) continue;
    const st = /state=PlaybackState \{state=(\w+)\(\d+\), position=(-?\d+)[^}]*?updated=(\d+)[^}]*?actions=(\d+)/.exec(b);
    if (!st) return null;
    const state = st[1] === "PLAYING" ? "playing" : st[1] === "PAUSED" ? "paused" : "other";
    const pos = Math.max(0, Number(st[2])) + (state === "playing" ? Math.max(0, uptimeMs - Number(st[3])) : 0);
    const desc = /description=(.*)/.exec(b)?.[1]?.replace(/, null\s*$/, "").trim();
    let title: string | null = null;
    if (desc && desc !== "null" && !desc.startsWith("null,")) {
      const cut = desc.lastIndexOf(", ");
      title = cut > 0 ? desc.slice(0, cut) : desc;
    }
    return { state, seekable: (Number(st[4]) & ACTION_SEEK_TO) !== 0, title, position_s: Math.round(pos / 1000) };
  }
  return null;
}

/** Segundos de anuncio antes del primer OK (el botón "Saltar" sale a los ~5 s). */
export const AD_SKIP_AFTER_S = 6;
const AD_RETRY_MS = 3000;
/** Un anuncio que no se deja saltar no recibe más que esto (OK de más abre "Enviar al teléfono"). */
export const AD_MAX_PRESSES = 3;
/** Tras un OK, si el VIDEO queda en pausa en esta ventana, el OK cayó sobre él: se reanuda. */
const AD_RESUME_WINDOW_MS = 8000;

export interface AdTracker {
  /** Posición del anuncio en curso (null = no hay anuncio). Si baja, es otro anuncio. */
  lastPos: number | null;
  presses: number;
  lastPressMs: number;
  /** Anuncios vistos y OKs enviados (para el registro). */
  ads: number;
}

export const newAdTracker = (): AdTracker => ({ lastPos: null, presses: 0, lastPressMs: Number.NEGATIVE_INFINITY, ads: 0 });

/**
 * Qué hacer con lo que muestra la sesión ahora: `skip` = mandar OK (anuncio
 * saltable ya), `resume` = el OK de antes pausó el video (carrera: el anuncio
 * terminó justo) y hay que darle play, `none` = nada. Nunca OK sobre el video.
 */
export function adStep(s: YtSession | null, t: AdTracker, nowMs: number): { action: "skip" | "resume" | "none"; tracker: AdTracker; newAd: boolean } {
  const isAd = s?.state === "playing" && !s.seekable;
  if (!isAd) {
    const resume = s?.state === "paused" && s.seekable && nowMs - t.lastPressMs < AD_RESUME_WINDOW_MS;
    return { action: resume ? "resume" : "none", tracker: { ...t, lastPos: null, presses: 0, ...(resume ? { lastPressMs: Number.NEGATIVE_INFINITY } : {}) }, newAd: false };
  }
  const newAd = t.lastPos === null || s.position_s + 1 < t.lastPos;
  const base = newAd ? { ...t, presses: 0, ads: t.ads + 1 } : t;
  const due = s.position_s >= AD_SKIP_AFTER_S && base.presses < AD_MAX_PRESSES && nowMs - base.lastPressMs >= AD_RETRY_MS;
  return {
    action: due ? "skip" : "none",
    newAd,
    tracker: { ...base, lastPos: s.position_s, presses: base.presses + (due ? 1 : 0), lastPressMs: due ? nowMs : base.lastPressMs },
  };
}

export interface VideoWatch {
  /** Título del video que puso Hermes, aprendido de la sesión (la TV puede traducirlo distinto a yt-dlp). */
  title: string | null;
  /** Última posición vista del video (no de un anuncio). */
  lastPos: number;
  /** Desde cuándo la TV está apagada o en otra app (null = está en YouTube). */
  awaySince: number | null;
}

export const newVideoWatch = (): VideoWatch => ({ title: null, lastPos: 0, awaySince: null });

export interface TvSnapshot {
  power: TvPower | "unreachable";
  /** App al frente (null = no se supo). */
  fg: string | null;
  /** Actividad al frente (clase completa o relativa, tal cual la da dumpsys). */
  activity: string | null;
  yt: YtSession | null;
}

/** Arranque de la app + anuncios iniciales: lo que pase en este rato no cuenta como "lo dejaron". */
export const VIDEO_START_GRACE_MS = 60_000;
const AWAY_LIMIT_MS = 20_000;

/**
 * ¿Terminó el video? `ended` = llegó al final (o la app siguió con otro estando
 * ya al final: autoplay). `abandoned` = el dueño puso otra cosa o apagó la TV
 * antes del final. Sin duración conocida, que cambie de video cuenta como fin.
 */
export function videoEndStep(
  snap: TvSnapshot,
  w: VideoWatch,
  durationS: number | null,
  sinceStartMs: number,
  nowMs: number,
): { verdict: "waiting" | "ended" | "abandoned"; reason?: string; watch: VideoWatch } {
  const nearEnd = durationS != null && w.lastPos >= durationS - 30;
  const away = snap.power === "off" || (snap.fg != null && snap.fg !== YOUTUBE_PKG);
  if (away && sinceStartMs > VIDEO_START_GRACE_MS) {
    if (nearEnd) return { verdict: "ended", reason: "terminó (la TV salió de YouTube al final)", watch: w };
    const since = w.awaySince ?? nowMs;
    if (nowMs - since >= AWAY_LIMIT_MS) {
      return { verdict: "abandoned", reason: snap.power === "off" ? "apagaron la TV" : "cambiaron de app", watch: { ...w, awaySince: since } };
    }
    return { verdict: "waiting", watch: { ...w, awaySince: since } };
  }
  const watch = { ...w, awaySince: null };
  const s = snap.yt;
  if (!s || !s.seekable || !s.title) {
    // Anuncio, encuesta o pantalla de "a continuación": al final cuenta como fin.
    if (nearEnd && (!s || s.state === "other")) return { verdict: "ended", reason: "terminó", watch };
    return { verdict: "waiting", watch };
  }
  if (watch.title === null) return { verdict: "waiting", watch: { ...watch, title: s.title, lastPos: s.position_s } };
  if (s.title !== watch.title) {
    if (nearEnd || durationS == null) return { verdict: "ended", reason: "terminó y la app siguió con otro", watch };
    return { verdict: "abandoned", reason: `pusieron otro video ("${s.title}")`, watch };
  }
  const next = { ...watch, lastPos: s.position_s };
  if (durationS != null && s.position_s >= durationS - 2) return { verdict: "ended", reason: "terminó", watch: next };
  return { verdict: "waiting", watch: next };
}

/** Lee la salida combinada de tvSnapshot (power + actividad al frente + medios + uptime). */
export function parseSnapshot(out: string): TvSnapshot {
  const uptimeMs = Math.round(Number(/^(\d+(?:\.\d+)?) \d/m.exec(out)?.[1] ?? NaN) * 1000);
  const top = /topResumedActivity=ActivityRecord\{\S+ \S+ ([\w.]+)\/([\w.$]+)/.exec(out);
  return {
    power: parseWakefulness(out),
    fg: top?.[1] ?? null,
    activity: top?.[2] ?? null,
    yt: Number.isFinite(uptimeMs) ? parseYouTubeSession(out, uptimeMs) : null,
  };
}

// ── Saludo de la mañana ─────────────────────────────────────────────────

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Semana ISO 8601 de una fecha AAAA-MM-DD (la semana 1 es la que tiene el primer jueves). */
export function isoWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const dow = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dow); // el jueves de esa semana decide el año
  const y0 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - y0) / 86_400_000 + 1) / 7);
}

/** "martes 21 de octubre de 2026" de una fecha AAAA-MM-DD. */
export function dateWords(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} de ${MESES[m - 1]} de ${y}`;
}

/** Hora dicha: "a las 9 de la mañana", "a la 1 y media de la tarde", "a las 12 del mediodía". */
export function speakTime(h: number, m: number): string {
  const h12 = h % 12 || 12;
  const part = h < 12 ? (h === 0 ? "de la noche" : "de la mañana") : h === 12 ? "del mediodía" : h < 19 ? "de la tarde" : "de la noche";
  const min = m === 0 ? "" : m === 15 ? " y cuarto" : m === 30 ? " y media" : ` y ${m}`;
  return `${h12 === 1 ? "a la" : "a las"} ${h12}${min} ${part}`;
}

/** Lo que se DICE de un título: sin emojis (la voz los leería) y la raya como pausa. */
export const speakable = (t: string) =>
  t.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "").replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").trim();

/** Une una lista hablada: "a, b y c". */
const joinEs = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/**
 * Frases del día: SOLO citas con autor y obra verificables (nada de "frases
 * atribuidas" que nadie dijo). Rotan por fecha: el mismo día, la misma frase.
 * `talk` = el discurso de la mañana, ESCRITO por Hermes sobre esa idea: va
 * dicho como suyo, nunca como palabras del autor.
 */
export const DAILY_QUOTES: ReadonlyArray<{ text: string; author: string; source: string; talk: string }> = [
  { text: "Al amanecer, cuando te cueste levantarte, ten presente este pensamiento: me levanto para hacer obra de hombre.", author: "Marco Aurelio", source: "Meditaciones, V, 1", talk: "Lo escribió un emperador que también tenía frío y sueño. No se levantaba porque tuviera ganas, sino porque tenía algo que hacer, y eso bastaba. Hoy pasa lo mismo: la cama no te debe nada y el día sí te espera. No esperes a tener ganas. Las ganas llegan después, cuando ya estás haciendo." },
  { text: "No es que tengamos poco tiempo, sino que perdemos mucho.", author: "Séneca", source: "Sobre la brevedad de la vida", talk: "El tiempo no se acaba de golpe: se escapa en ratos que no anotamos. Diez minutos aquí, media hora allá, y el día se fue sin que nadie lo decidiera. Hoy decide tú adónde va cada hora. La primera la decides ahora mismo, saliendo de la cama." },
  { text: "No son las cosas las que nos perturban, sino las opiniones que tenemos sobre ellas.", author: "Epicteto", source: "Enquiridión, 5", talk: "El día todavía no ha hecho nada, y ya traes en la cabeza un juicio sobre él: que va a ser pesado, que no te alcanza. Ese juicio es tuyo, no del día. Suéltalo. Mira lo que hay que hacer como lo que es, una tarea a la vez, y verás que pesa menos de lo que pensabas." },
  { text: "Lo que se interpone en el camino se convierte en el camino.", author: "Marco Aurelio", source: "Meditaciones, V, 20", talk: "Lo que hoy te estorbe no es una interrupción del trabajo: es el trabajo. El problema que aparezca, la reunión difícil, el código que no compila, ahí está el día de verdad. No lo esquives. Entra por ahí, porque esa es justo la parte que te hace mejor." },
  { text: "Sufrimos más a menudo en la imaginación que en la realidad.", author: "Séneca", source: "Cartas a Lucilio, 13", talk: "Casi nada de lo que te preocupaba anoche va a pasar como lo imaginaste. La mente ensaya catástrofes que nunca llegan. Hoy no le des ese poder: trata lo que tienes delante, no lo que inventas. Lo real casi siempre es más pequeño y más manejable." },
  { text: "Primero dite a ti mismo qué quieres ser; luego haz lo que tengas que hacer.", author: "Epicteto", source: "Disertaciones, III, 23", talk: "Antes de hacer, decide quién quieres ser hoy. ¿Alguien que cumple lo que se prometió? ¿Alguien que trabaja con calma y con foco? Elígelo ahora, con los ojos medio cerrados. Después, cada cosa del día es solo hacer lo que esa persona haría." },
  { text: "Caminante, no hay camino, se hace camino al andar.", author: "Antonio Machado", source: "Proverbios y cantares", talk: "No hay un mapa listo esperándote. El camino es lo que vas a recorrer hoy, paso por paso, decisión por decisión. Nadie lo va a trazar por ti. Así que el primer paso de hoy es este: poner los pies en el suelo." },
  { text: "No actúes como si fueras a vivir diez mil años.", author: "Marco Aurelio", source: "Meditaciones, IV, 17", talk: "Vivimos como si siempre hubiera un mañana para lo importante. Pero el tiempo es el mismo para todos y no se recupera. Hoy haz lo que importa primero, no lo que es fácil. No como quien tiene diez mil años, sino como quien tiene solo este día." },
  { text: "Mientras se aplaza, la vida pasa.", author: "Séneca", source: "Cartas a Lucilio, 1", talk: "Cada vez que dejamos algo para después, la vida sigue su marcha sin esperarnos. Lo que aplazas hoy no desaparece: solo se hace más pesado. Hoy elige una cosa que llevas días posponiendo y hazla antes del mediodía. Te vas a sentir más liviano." },
  { text: "Ninguna gran cosa se produce de repente.", author: "Epicteto", source: "Disertaciones, I, 15", talk: "Lo grande se construye con días normales. Un buen hábito no se nota en una mañana, se nota en un año de mañanas. No necesitas un día heroico, necesitas un día bien hecho. Y empieza aquí, levantándote a tu hora, otra vez." },
  { text: "Un viaje de mil leguas comienza con un primer paso.", author: "Lao Tse", source: "Tao Te Ching, 64", talk: "Todo lo que quieres construir empieza con un movimiento pequeño, casi ridículo de tan simple. Hoy ese movimiento es levantarte. Después, abrir la primera tarea. No pienses en la distancia completa: piensa en el siguiente paso, y da ese." },
  { text: "No discutas más sobre cómo ha de ser un hombre bueno: sé uno.", author: "Marco Aurelio", source: "Meditaciones, X, 16", talk: "Es fácil hablar de disciplina, de bondad o de buen trabajo. Lo difícil es hacerlo cuando nadie mira. Hoy no lo discutas en tu cabeza: hazlo. Cumple con lo que dijiste, trata bien a la gente y deja el trabajo mejor de como lo encontraste." },
  { text: "Al hombre se le puede arrebatar todo salvo una cosa: la última de las libertades humanas, elegir su actitud ante las circunstancias.", author: "Viktor Frankl", source: "El hombre en busca de sentido", talk: "Esto lo escribió alguien que lo perdió casi todo, y aun así encontró una libertad que nadie le pudo quitar: elegir cómo responder. Hoy no vas a controlar lo que pase. Pero sí cómo lo enfrentas. Esa elección empieza en este momento." },
  { text: "El alma se tiñe del color de sus pensamientos.", author: "Marco Aurelio", source: "Meditaciones, V, 16", talk: "Lo que piensas en la mañana colorea el resto del día. Si arrancas con quejas, todo te va a parecer cuesta arriba. Si arrancas con un propósito, hasta lo difícil tiene sentido. Escoge con cuidado el primer pensamiento de hoy: que sea uno que te empuje." },
  { text: "Todo el futuro es incierto: vive desde ya.", author: "Séneca", source: "Sobre la brevedad de la vida, 9", talk: "El futuro no está garantizado, y por eso no conviene vivir esperándolo. La vida es hoy: esta mañana, este café, este trabajo. No guardes lo mejor de ti para un después que nadie te prometió. Úsalo hoy." },
  { text: "Una vida sin examen no merece ser vivida.", author: "Sócrates", source: "Platón, Apología", talk: "Revisar tu vida no es castigarte, es mirarla con honestidad. ¿Qué hiciste bien ayer? ¿Qué harías distinto? Hoy, al final del día, tómate un minuto para preguntártelo. Y ahora, con esa misma honestidad: ¿te vas a levantar a tu hora?" },
  { text: "La vida es como montar en bicicleta: para mantener el equilibrio hay que seguir moviéndose.", author: "Albert Einstein", source: "carta a su hijo Eduard, 1930", talk: "El equilibrio no es quedarse quieto, es seguir avanzando. Los días que te detienes son los que más te cuesta retomar. Hoy no busques la perfección, busca el movimiento. Un paso, y otro, y otro. Empieza por levantarte." },
  { text: "Muy poco se necesita para una vida feliz: todo está dentro de ti, en tu manera de pensar.", author: "Marco Aurelio", source: "Meditaciones, VII, 67", talk: "La felicidad no está en la lista de cosas que te faltan. Está en cómo miras lo que ya tienes: salud, trabajo, gente que te quiere, un día nuevo. Hoy empieza con esa cuenta, no con la otra. Lo demás se construye desde ahí." },
  { text: "Si he visto más lejos es porque estoy sentado sobre los hombros de gigantes.", author: "Isaac Newton", source: "carta a Robert Hooke, 1675", talk: "Nadie llega lejos solo. Todo lo que sabes lo aprendiste de alguien que vino antes. Hoy honra eso: aprende algo nuevo, comparte lo que sabes y agradece a quien te enseñó. Construyes sobre gigantes; deja algo para los que vienen." },
  { text: "Bien hecho es mejor que bien dicho.", author: "Benjamin Franklin", source: "Almanaque del pobre Richard, 1737", talk: "Las intenciones no mueven nada. Lo que cuenta es lo que queda hecho. Hoy menos planes y más ejecución: una tarea terminada vale más que diez empezadas. Y la primera que puedes terminar ya mismo es levantarte." },
  { text: "Ningún viento es favorable para quien no sabe a qué puerto se dirige.", author: "Séneca", source: "Cartas a Lucilio, 71", talk: "Si no sabes adónde vas, cualquier día te parece igual. Por eso vale la pena tener claro el puerto: qué quieres lograr esta semana, este mes, este año. Hoy, antes de abrir el correo, recuerda tu rumbo. Así cada hora sabe hacia dónde empuja." },
  { text: "La vida no es la que uno vivió, sino la que uno recuerda y cómo la recuerda para contarla.", author: "Gabriel García Márquez", source: "Vivir para contarla", talk: "Hoy vas a escribir otra página de la historia que después vas a contar. No tiene que ser épica, solo tiene que ser tuya y bien vivida. Que mañana, cuando la recuerdes, te dé orgullo contarla." },
];

/** La frase de una fecha AAAA-MM-DD: días seguidos, frases distintas (recorre la lista entera antes de repetir). */
export function quoteOfDay(date: string): (typeof DAILY_QUOTES)[number] {
  const [y, m, d] = date.split("-").map(Number);
  const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  return DAILY_QUOTES[((day % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length];
}

export interface GreetingInput {
  owner: string;
  /** Clima de ahora (null = sin fuente: no se dice nada). */
  weather?: { place: string; temp_c: number; words: string } | null;
  /** Fecha local AAAA-MM-DD (en la zona del dueño). */
  date: string;
  /** Eventos de hoy con su hora local ya resuelta (null = todo el día). */
  events: Array<{ title: string; h: number | null; m: number | null }>;
  tasks: Array<{ title: string; done: boolean }>;
  habits: Array<{ name: string; done: boolean }>;
  outro?: string;
  /**
   * Despertar con puntos: la hora a la que te comprometiste (o la alarma). Con
   * ella el saludo cierra con el discurso y el llamado a ponerse de pie.
   */
  wake?: { h: number; m: number; source: "compromiso" | "alarma" | "escena" } | null;
}

export interface Greeting {
  /** Lo que se ve en la TV mientras habla. */
  title: string;
  subtitle: string;
  items: string[];
  /** Lo que se dice. */
  speech: string;
}

const PLAN_MAX = 6;
const LIST_MAX = 4;

/**
 * El saludo del despertar, solo con datos reales: sin calendario no se inventa
 * agenda (se dice que no hay nada), y una lista larga se corta con "y N más".
 */
export function buildGreeting(g: GreetingInput): Greeting {
  const week = isoWeek(g.date);
  const say: string[] = [`Buenos días, ${g.owner}.`, `Hoy es ${dateWords(g.date)}.`, `Estamos en la semana ${week} del año.`];
  const items: string[] = [];
  const q = quoteOfDay(g.date);
  // Con despertar, la frase se dice al final dentro del discurso (es lo último que oyes antes de pararte).
  if (!g.wake) say.push(`La frase de hoy es de ${q.author}: ${q.text}`);
  items.push(`«${q.text}» — ${q.author}`);
  if (g.weather) {
    say.push(`En ${g.weather.place} hay ${g.weather.temp_c} grados, ${g.weather.words}.`);
    items.push(`${g.weather.place} · ${g.weather.temp_c} °C, ${g.weather.words}`);
  }
  const pad = (n: number) => String(n).padStart(2, "0");

  const timed = g.events.filter((e) => e.h != null).slice(0, PLAN_MAX);
  const allDay = g.events.filter((e) => e.h == null);
  if (timed.length || allDay.length) {
    say.push("Este es tu plan de hoy.");
    for (const e of timed) {
      say.push(`${speakTime(e.h!, e.m ?? 0).replace(/^a/, "A")}, ${speakable(e.title)}.`);
      items.push(`${e.h}:${pad(e.m ?? 0)} · ${e.title}`);
    }
    if (allDay.length) {
      say.push(`Todo el día: ${joinEs(allDay.map((e) => speakable(e.title)))}.`);
      for (const e of allDay) items.push(`Todo el día · ${e.title}`);
    }
  } else {
    say.push("Hoy no tienes nada en el calendario.");
  }

  const more = (n: number) => (n > LIST_MAX ? ` y ${n - LIST_MAX} más` : "");
  const pending = g.tasks.filter((t) => !t.done).map((t) => t.title);
  if (pending.length) {
    const shown = pending.slice(0, LIST_MAX);
    say.push(`${pending.length === 1 ? "Tienes un pendiente" : "Pendientes"}: ${joinEs(shown.map(speakable))}${more(pending.length)}.`);
    for (const t of shown) items.push(`Pendiente · ${t}`);
  }
  const habits = g.habits.filter((h) => !h.done).map((h) => h.name);
  if (habits.length) {
    const shown = habits.slice(0, LIST_MAX);
    say.push(`Y tus hábitos: ${joinEs(shown.map(speakable))}${more(habits.length)}.`);
    for (const h of shown) items.push(`Hábito · ${h}`);
  }
  if (g.wake) {
    say.push(`Y para arrancar, una idea de ${q.author}: ${q.text}`, q.talk);
    const at = speakTime(g.wake.h, g.wake.m).replace(/^a la(s)? /, "");
    const why = g.wake.source === "compromiso" ? "Te comprometiste a levantarte a las" : g.wake.source === "alarma" ? "Tu alarma era a las" : "Arrancamos a las";
    say.push(`${why.replace(/las$/, g.wake.h % 12 === 1 ? "la" : "las")} ${at}. Ponte de pie y presiona OK en el control: mientras más cerca de tu hora, más puntos.`);
  }
  if (g.outro) say.push(g.outro);
  return { title: `Buenos días, ${g.owner}`, subtitle: `${dateWords(g.date)} · semana ${week}`, items, speech: say.join(" ") };
}

/**
 * La felicitación tras una rutina completa, con el progreso REAL del hábito:
 * racha de días seguidos (con hitos) y cuántos van esta semana. Sin datos de
 * racha (sin Supabase) solo felicita por hoy, sin inventar números.
 */
export function cheerSpeech(owner: string, habit: string, streak: number | null, weekCount: number | null): string {
  const say = [`¡Muy bien, ${owner}! Rutina completa: ${habit} de hoy marcado.`];
  if (streak != null) {
    if (streak >= 2) {
      const milestone =
        streak % 30 === 0
          ? ` ¡${streak === 30 ? "Un mes" : `${streak / 30} meses`} sin fallar!`
          : streak % 7 === 0
            ? ` ¡${streak === 7 ? "Una semana completa" : `${streak / 7} semanas`} sin fallar!`
            : "";
      say.push(`Llevas ${streak} días seguidos.${milestone}`);
    } else {
      say.push("Hoy arranca tu racha: mañana la seguimos.");
    }
  }
  if (weekCount != null && weekCount >= 2) say.push(`Esta semana van ${weekCount}.`);
  return say.join(" ");
}
