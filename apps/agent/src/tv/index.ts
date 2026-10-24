import { weatherWords } from "@hermes/shared";
import { env } from "../env.js";
import { describeCron } from "../scheduled/cron.js";
import { getUpcomingCalendar } from "../calendar.js";
import { habitsToday } from "../habits/store.js";
import { lightsCommand, type LightAction } from "../lights.js";
import { pickNextEvent, pickToday, type PhoneHome } from "../phone/home.js";
import { listTasks } from "../tasks/store.js";
import { getWeather } from "../weather.js";
import { tvAdbConfigured, tvAdbKey, tvAdbPower, tvForeground, tvOpenApp, tvOpenUrl, tvPowerState, tvSnapshot, tvStartActivity } from "./adb.js";
import { hourMinute, prepareGreeting, prepareSpoken, type StoredGreeting } from "./greeting.js";
import { missWake, noteNudge, openWake, wakeSession, wakeStatus, type WakeSession } from "../wake/index.js";
import { dueNudge, nudgeSpeech, wakeResultSpeech, type WakeRecord, type WakeStats } from "../wake/plan.js";
import { OWNER } from "../owner.js";
import { checkinHabit, resolveHabit } from "../habits/store.js";
import { waitVideoEnd, watchYouTube } from "./watch.js";
import { appName, cheerSpeech, isTvKey, powerKey, powerPlan, rampLevel, resolveTvApp, type NowPlaying, type SceneStep } from "./plan.js";
import { remoteSend, remoteStatus } from "./remote.js";
import { readScenes } from "./scenes.js";
import { pickVideo, searchYouTube, youtubeUrl } from "./youtube.js";
import { markSeen, nextToLearn, thumbnailOf } from "../learn/ai.js";

/**
 * Control de la TV: teclas por la ESP32 (Bluetooth, sirve con la TV en reposo)
 * y apps exactas por adb. Docs: hermes-tv/README.md.
 */

type Result = { ok: true; detail: string } | { ok: false; error: string };

export const TV_ACTIONS = ["key", "text", "power_on", "power_off", "open_app", "youtube", "learn_next", "status"] as const;
export type TvAction = (typeof TV_ACTIONS)[number];

async function tvPower(want: "on" | "off"): Promise<Result> {
  const state = tvAdbConfigured() ? await tvPowerState() : "unknown";
  if (powerPlan(want, state) === "skip") {
    return { ok: true, detail: want === "on" ? "la TV ya estaba prendida" : "la TV ya estaba apagada" };
  }
  // adb primero: con el modo de energía "Alto" la TV sigue en la red dormida y
  // KEYCODE_WAKEUP la prende (medido 2026-10-20). El control Bluetooth queda de
  // respaldo para cuando adb no está (permiso de depuración perdido, etc.).
  if (tvAdbConfigured() && state !== "unreachable" && (await tvAdbPower(want))) {
    return { ok: true, detail: want === "on" ? "TV prendida" : "TV apagada" };
  }
  const r = await remoteSend(powerKey(want));
  if (!r.ok && want === "on" && /no está conectada por Bluetooth/.test(r.error)) {
    // Medido: en reposo la TV corta el Bluetooth y no acepta reconectar. Si
    // además adb no llega, la red también está apagada (modo de energía que no es "Alto").
    return {
      ok: false,
      error:
        "La TV está en reposo sin red, y así no escucha ni la red ni el Bluetooth: préndela con su control. " +
        "Para prenderla desde Hermes, su modo de energía debe ser \"Alto\" (Ajustes → Sistema → Alimentación y energía).",
    };
  }
  if (!r.ok) return r;
  return { ok: true, detail: want === "on" ? "TV prendida" : "TV apagada" };
}

/** El último video que Hermes puso: así lo que suena puede llevar su miniatura (la TV no da el id). */
let lastYt: { id: string; title: string } | null = null;

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prende la TV y CONFIRMA que quedó prendida (adb), reintentando hasta
 * `maxMs`: tras horas en reposo la primera conexión de adb puede fallar
 * aunque la red siga viva (modo de energía "Alto"). Solo wake, nunca `power`.
 */
export async function ensureTvOn(maxMs = 90_000): Promise<Result> {
  if (!tvAdbConfigured()) return tvPower("on");
  const deadline = Date.now() + maxMs;
  let woke = false;
  while (Date.now() < deadline) {
    const st = await tvPowerState();
    if (st === "on") {
      if (woke) await sleepMs(3000); // recién despierta: que el sistema acabe de levantar antes de abrir apps
      return { ok: true, detail: woke ? "TV prendida" : "la TV ya estaba prendida" };
    }
    if (st === "off" || st === "unknown") {
      woke = (await tvAdbPower("on")) || woke;
      await sleepMs(3000);
    } else {
      await sleepMs(5000); // adb aún no llega: esperar a la red
    }
  }
  const r = await tvPower("on"); // último intento (incluye el control Bluetooth)
  return r.ok ? r : { ok: false, error: `no logré prender la TV en ${Math.round(maxMs / 1000)} s: ${r.error}` };
}

/**
 * Abre un video de YouTube en la TV (prendiéndola si hace falta), lo recuerda y
 * arranca el vigilante que salta anuncios y sabe cuándo termina.
 */
export async function playYouTube(id: string, title: string, channel = "", durationS: number | null = null): Promise<Result> {
  const on = await ensureTvOn();
  if (!on.ok) return on;
  const r = await tvOpenUrl("com.google.android.youtube.tv", youtubeUrl(id));
  if (!r.ok) return r;
  lastYt = { id, title };
  watchYouTube(id, durationS);
  return { ok: true, detail: `puse "${title}"${channel ? ` de ${channel}` : ""} en la TV` };
}

/**
 * Saludo hablado en la TV: lo arma con los datos de hoy, abre la pantalla
 * "Buenos días" de Hermes TV y espera a que termine de hablar (la pantalla se
 * cierra sola al acabar el audio).
 */
async function tvGreeting(outro?: string, wake?: WakeSession | null): Promise<Result> {
  const target = wake ? { at: wake.target_at, source: wake.target_source } : null;
  return tvSpeak(await prepareGreeting(outro, target), "saludo");
}

const WAKE_SCREEN = "os.hermes.tv/.WakeActivity";

/**
 * Despertar con puntos: deja en la TV "¿Ya estás de pie?" (WakeActivity: tu
 * hora, los minutos que van y los puntos que valdría levantarse YA; OK
 * confirma) y espera la confirmación. Insiste a los 5, 10, 20… minutos. Al
 * confirmar dice los puntos; sin confirmación en max_ms la mañana queda en 0
 * y la escena se detiene — no se le pone música a alguien dormido.
 */
/** Dice en la TV los puntos de la mañana recién confirmada. */
async function announceWake(r: WakeRecord, stats: WakeStats, next: string | undefined): Promise<StepResult> {
  const speech = wakeResultSpeech(OWNER, r, stats, hourMinute(r.confirmed_at!, env.SCHEDULED_TZ), next);
  const items = [
    `${r.base} puntos${r.bonus ? ` + ${r.bonus} por racha` : ""}`,
    r.delta_min! <= 0 ? "A tu hora" : `${r.delta_min} min después de tu hora`,
    `Racha a tiempo: ${r.streak} ${r.streak === 1 ? "día" : "días"}`,
    `Esta semana: ${stats.week_points} puntos · Total: ${stats.total_points}`,
  ];
  await tvSpeak(await prepareSpoken({ title: `+${r.points} puntos`, subtitle: `De pie · ${clock()}`, items, speech }), "puntos del despertar");
  return { ok: true, detail: `de pie (${r.confirmed_by}) a ${r.delta_min} min de tu hora: ${r.points} puntos` };
}

async function waitAwake(maxMs: number, next: string | undefined, gen: number, sceneStart: number): Promise<StepResult> {
  if (!(await wakeSession())) {
    const st = await wakeStatus();
    const done = st.today;
    if (!done?.confirmed_at) return { ok: false, error: "no hay un despertar abierto (¿la escena no lo abrió?)" };
    // Confirmó por el chat mientras la TV hablaba: igual se le dicen sus puntos.
    if (Date.parse(done.confirmed_at) >= sceneStart) return announceWake(done, st.stats, next);
    return { ok: true, detail: `ya estabas de pie hoy (${done.points} puntos)` };
  }
  const on = await ensureTvOn();
  if (on.ok) await tvStartActivity(WAKE_SCREEN);
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await sleepMs(2000);
    if (gen !== sceneGen) return { ok: true, detail: "otra escena tomó el cuarto: dejo de esperar", stop: true };
    const st = await wakeStatus();
    if (!st.session) {
      const r = st.today;
      if (!r?.confirmed_at) return { ok: false, error: "la sesión del despertar se cerró sin confirmación", stop: true };
      return announceWake(r, st.stats, next);
    }
    const n = dueNudge(st.session.minutes_late, st.session.nudges);
    if (n != null) {
      await noteNudge(n);
      const text = nudgeSpeech(OWNER, st.session.minutes_late, st.session.points_now);
      await tvSpeak(await prepareSpoken({ title: "¿Ya estás de pie?", subtitle: clock(), items: [], speech: text }), "recordatorio");
      await tvStartActivity(WAKE_SCREEN); // por si la pantalla de espera se cerró
    }
  }
  await missWake();
  return { ok: true, detail: `no confirmaste en ${Math.round(maxMs / 60_000)} min: 0 puntos, paro la escena`, stop: true };
}

/** Muestra y dice en la TV lo preparado (GreetingActivity) y espera a que termine. */
async function tvSpeak(g: StoredGreeting, what: string): Promise<Result> {
  const on = await ensureTvOn();
  if (!on.ok) return on;
  const open = await tvStartActivity("os.hermes.tv/.GreetingActivity");
  if (!open.ok) return open;
  const started = Date.now();
  const limit = ((g.duration_s ?? 20) + 40) * 1000;
  let seen = false;
  while (Date.now() - started < limit) {
    await sleepMs(1000);
    const snap = await tvSnapshot();
    const onScreen = snap.fg === "os.hermes.tv" && /GreetingActivity$/.test(snap.activity ?? "");
    if (onScreen) seen = true;
    else if (seen) break; // terminó de hablar y se cerró
    else if (Date.now() - started > 15_000) return { ok: false, error: "la pantalla del saludo no abrió (¿Hermes TV actualizada?)" };
  }
  const secs = Math.round((Date.now() - started) / 1000);
  return g.audio
    ? { ok: true, detail: `${what} dicho (${secs} s)` }
    : { ok: false, error: `${what} SIN voz, solo en pantalla (${g.audio_error})` };
}

/** Hora local "6:20" para el subtítulo de un aviso. */
const clock = () => new Date().toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", hour12: false, timeZone: env.SCHEDULED_TZ });

/** Felicitación tras la rutina: marca el hábito de HOY y dice la racha real. */
async function habitCheer(name: string): Promise<Result> {
  const habit = await resolveHabit(name);
  if (!habit) return { ok: false, error: `no encontré el hábito "${name}"` };
  const done = await checkinHabit(habit.id, { source: "tv" });
  if (!done) return { ok: false, error: `no pude marcar "${habit.name}" (¿Supabase?)` };
  const today = (await habitsToday().catch(() => [])).find((h) => h.id === habit.id);
  const speech = cheerSpeech(OWNER, habit.name, today?.streak ?? null, today?.week_count ?? null);
  const r = await tvSpeak(await prepareSpoken({ title: "¡Rutina completa!", subtitle: `${habit.name} · ${clock()}`, items: [], speech }), "felicitación");
  return r.ok ? { ok: true, detail: `${habit.name} marcado · ${speech}` } : r;
}

const norm = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "").slice(0, 24);

export async function tvCommand(action: TvAction, value = ""): Promise<Result> {
  const v = value.trim();
  switch (action) {
    case "key":
      if (!isTvKey(v.toLowerCase())) return { ok: false, error: `Tecla desconocida: '${v}'.` };
      return tvKey(v.toLowerCase());
    case "text":
      if (!v) return { ok: false, error: "Falta el texto." };
      // Una línea por orden: un salto de línea partiría el texto en dos órdenes.
      return remoteSend(`text ${v.replace(/[\r\n]+/g, " ").slice(0, 180)}`);
    case "power_on":
      return tvPower("on");
    case "power_off":
      return tvPower("off");
    case "open_app": {
      const pkg = resolveTvApp(v);
      if (!pkg) return { ok: false, error: `No conozco la app '${v}'.` };
      return tvOpenApp(pkg);
    }
    case "learn_next": {
      // "Pon el siguiente de mi plan": el primero sin ver de la curaduría de IA.
      const next = await nextToLearn();
      if (!next) return { ok: false, error: "No hay curaduría de IA o ya la viste toda." };
      return playYouTube(next.id, next.title, next.channel).then(async (r) => {
        if (r.ok) await markSeen(next.id);
        return r;
      });
    }
    case "youtube": {
      // "Pon una rutina de estiramiento": busca, elige un video de verdad (no un Short) y lo abre en la TV.
      if (!v) return { ok: false, error: "¿Qué busco en YouTube?" };
      const found = pickVideo(await searchYouTube(v));
      if (!found) return { ok: false, error: `No encontré nada en YouTube para "${v}".` };
      return playYouTube(found.id, found.title, found.channel, found.duration);
    }
    case "status": {
      const [remote, power] = await Promise.all([
        remoteStatus(),
        tvAdbConfigured() ? tvPowerState() : Promise.resolve("unknown" as const),
      ]);
      const pantalla =
        power === "on" ? "prendida" : power === "off" ? "apagada" : power === "unreachable" ? "sin respuesta por adb" : "desconocida";
      const control = remote ? (remote.includes("ble=conectado") ? "enlazado" : "sin enlazar") : "no conectado a la Mac";
      return { ok: true, detail: `pantalla ${pantalla} · control Bluetooth ${control}` };
    }
  }
}

/** Tecla por el control Bluetooth; si no está, por adb. */
async function tvKey(key: string): Promise<Result> {
  const r = await remoteSend(key);
  if (r.ok) return r;
  if (await tvAdbKey(key)) return { ok: true, detail: `${key} (por adb)` };
  return r;
}

/**
 * Cada escena que arranca sube la generación: una rampa de luz de una escena
 * anterior (que dura minutos) ve que ya no es la vigente y se detiene. Tú
 * tocaste "Modo película" a mitad del amanecer → manda el modo película.
 */
let sceneGen = 0;
/** Escena (por generación) cuyo último video llegó al final: habilita habit-cheer. */
let videoEndedIn = -1;
/** Cuándo arrancó la escena vigente (para saber si una confirmación es de ESTA mañana en curso). */
let sceneStartedAt = 0;

async function ramp(to: number, minutes: number, from: number | undefined, gen: number): Promise<Result> {
  let start = from;
  if (start === undefined) {
    const st = await lightsCommand("status");
    const m = st.ok ? /al (\d+)%/.exec(st.detail) : null;
    start = m ? Number(m[1]) : to;
  }
  const first = await lightsCommand("brightness", String(Math.max(1, start)));
  if (!first.ok) return first;
  for (let i = 1; i <= minutes; i++) {
    await sleepMs(60_000);
    if (gen !== sceneGen) return { ok: true, detail: `rampa interrumpida por otra escena (iba en ${rampLevel(start, to, minutes, i - 1)}%)` };
    await lightsCommand("brightness", String(rampLevel(start, to, minutes, i)));
  }
  return { ok: true, detail: `luz de ${start}% a ${to}% en ${minutes} min` };
}

/** `stop` = la escena no sigue (el dueño apagó la TV o puso otra cosa: no se le prende nada encima). */
type StepResult = Result & { stop?: boolean };

async function runStep(s: SceneStep, gen = sceneGen, wake: WakeSession | null = null): Promise<StepResult | null> {
  switch (s.kind) {
    case "lights":
      return lightsCommand(s.action as LightAction, s.value);
    case "tv-power":
      return tvPower(s.action);
    case "tv-open": {
      const pkg = resolveTvApp(s.app);
      if (!pkg) return { ok: false, error: `no conozco la app '${s.app}'` };
      return s.url ? tvOpenUrl(pkg, s.url) : tvOpenApp(pkg, s.fresh);
    }
    case "tv-key":
      return tvKey(s.key);
    case "wait":
      await sleepMs(s.ms);
      return null; // esperar no es un resultado que decir
    case "lights-ramp":
      if (s.background) {
        // La luz sube MIENTRAS siguen los pasos (el saludo, el video): no los bloquea.
        void ramp(s.to, s.minutes, s.from, gen).then((r) => console.log(`[tv] rampa: ${r.ok ? r.detail : r.error}`));
        return { ok: true, detail: `luz subiendo a ${s.to}% en ${s.minutes} min` };
      }
      return ramp(s.to, s.minutes, s.from, gen);
    case "tv-greeting":
      return tvGreeting(s.outro, wake);
    case "wait-awake":
      return waitAwake(s.max_ms, s.next, gen, sceneStartedAt);
    case "tv-say":
      return tvSpeak(await prepareSpoken({ title: s.title, subtitle: clock(), items: [], speech: s.text }), `aviso "${s.title}"`);
    case "habit-cheer":
      // Solo con la rutina COMPLETA: si el video no llegó al final, no se marca nada.
      if (videoEndedIn !== gen) return { ok: true, detail: `no marco ${s.habit}: la rutina no terminó` };
      return habitCheer(s.habit);
    case "tv-youtube":
      return playYouTube(s.id, s.title ?? s.id, "", s.duration_s ?? null);
    case "wait-video-end": {
      const r = await waitVideoEnd(s.max_ms, () => gen === sceneGen);
      if (r.verdict === "ended") videoEndedIn = gen;
      if (r.verdict === "abandoned") return { ok: true, detail: `el video no terminó: ${r.reason}; paro la escena`, stop: true };
      return { ok: true, detail: r.verdict === "timeout" ? `${r.reason}; sigo` : `el video ${r.reason}` };
    }
    case "tv-sleep": {
      const { sleep_at } = tvSleepIn(s.minutes);
      return { ok: true, detail: sleep_at ? `la TV se apaga en ${s.minutes} min` : "temporizador cancelado" };
    }
  }
}

/** Corre la escena paso a paso; un paso que falla no detiene a los demás (las luces no dependen de la TV). */
export async function tvScene(id: string): Promise<{ ok: boolean; name: string; steps: string[] } | null> {
  const { scenes, errors } = await readScenes();
  for (const e of errors) console.warn(`[tv] ${e}`);
  const scene = scenes.find((s) => s.id === id);
  if (!scene) return null;
  const gen = ++sceneGen;
  sceneStartedAt = Date.now();
  const steps: string[] = [];
  let ok = true;
  console.log(`[tv] escena ${scene.id}: arranca (${scene.steps.length} pasos)`);
  // Un despertar con puntos abre su sesión YA: la hora objetivo queda congelada
  // y confirmar durante el saludo (por el chat) también cuenta.
  const wake = scene.steps.some((st) => st.kind === "wait-awake") ? (await openWake()).session : null;
  for (const [i, s] of scene.steps.entries()) {
    if (gen !== sceneGen) {
      steps.push("detenida: arrancó otra escena");
      console.log(`[tv] escena ${scene.id}: detenida, arrancó otra escena`);
      break;
    }
    const r = await runStep(s, gen, wake);
    if (!r) continue;
    if (!r.ok) ok = false;
    const line = r.ok ? r.detail : `no pude: ${r.error}`;
    steps.push(line);
    // Registro legible paso a paso: así se revisa a las 6:15 qué pasó y qué falló.
    console.log(`[tv] escena ${scene.id} · paso ${i + 1} (${s.kind}): ${line}`);
    if (r.stop) break;
  }
  console.log(`[tv] escena ${scene.id}: ${ok ? "terminó" : "terminó con fallas"}`);
  return { ok, name: scene.name, steps };
}

/**
 * Lista para el teléfono y la TV: id + nombre + CUÁNDO corre sola, en palabras
 * ("22:30, todos los días" · "15 min antes de tu alarma (5:15)"). Manual = null.
 */
export async function tvScenes(): Promise<{ scenes: Array<{ id: string; name: string; when: string | null }>; errors: string[] }> {
  const { scenes, errors } = await readScenes();
  // La hora que manda: el compromiso de anoche o, si no, la alarma del teléfono.
  const alarm = (await wakeStatus().catch(() => null))?.next?.at ?? null;
  const hhmm = (d: Date) => d.toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: env.SCHEDULED_TZ });
  return {
    scenes: scenes.map(({ id, name, cron, before_alarm_min }) => ({
      id,
      name,
      when: cron
        ? describeCron(cron, env.SCHEDULED_TZ)
        : before_alarm_min != null
          ? `${before_alarm_min ? `${before_alarm_min} min antes de` : "a"} tu hora de despertar${alarm ? ` (${hhmm(new Date(Date.parse(alarm) - before_alarm_min * 60_000))})` : ""}`
          : null,
    })),
    errors,
  };
}

export interface TvNow {
  power: "on" | "off" | "unknown";
  /** App al frente y su nombre legible (null si no es una conocida). */
  app: { pkg: string; name: string | null } | null;
  playing: (NowPlaying & { app_name: string | null; thumbnail: string | null }) | null;
}

/** Para el teléfono: ¿prendida?, ¿qué app?, ¿qué suena? Un poll, cada parte degrada sola. */
export async function tvNow(): Promise<TvNow> {
  if (!tvAdbConfigured()) return { power: "unknown", app: null, playing: null };
  const power = await tvPowerState();
  if (power !== "on") return { power: power === "off" ? "off" : "unknown", app: null, playing: null };
  const fg = await tvForeground();
  return {
    power,
    app: fg.pkg ? { pkg: fg.pkg, name: appName(fg.pkg) } : null,
    playing: fg.now
      ? {
          ...fg.now,
          app_name: appName(fg.now.pkg),
          // Solo si es el video que Hermes puso (mismo título): nunca una miniatura adivinada.
          thumbnail: lastYt && norm(fg.now.title) === norm(lastYt.title) ? thumbnailOf(lastYt.id) : null,
        }
      : null,
  };
}

// ── Temporizador de apagado ─────────────────────────────────────────────
// En memoria a propósito: un reinicio del agente lo pierde, y eso se dice en
// /tv/home (sleep_at vuelve a null) en vez de apagar a una hora vieja.

let sleepTimer: NodeJS.Timeout | null = null;
let sleepAt: string | null = null;

export function tvSleepIn(minutes: number): { sleep_at: string | null } {
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = null;
  sleepAt = null;
  if (minutes > 0) {
    const ms = minutes * 60_000;
    sleepAt = new Date(Date.now() + ms).toISOString();
    sleepTimer = setTimeout(() => {
      sleepTimer = null;
      sleepAt = null;
      void tvPower("off").then((r) => console.log(`[tv] temporizador: ${r.ok ? r.detail : r.error}`));
    }, ms);
  }
  return { sleep_at: sleepAt };
}

// ── Pantalla de inicio de la TV ─────────────────────────────────────────

export interface TvHome {
  next_event: PhoneHome["next_event"];
  today: PhoneHome["today"];
  weather: { place: string; temp_c: number; words: string; stale: boolean } | null;
  sleep_at: string | null;
}

/** UN poll para la app de la TV. Cada sección degrada sola; nunca un placeholder. */
export async function tvHome(): Promise<TvHome> {
  const [cal, habits, tasks, weather] = await Promise.allSettled([
    getUpcomingCalendar(7, 10),
    habitsToday(),
    listTasks({ status: "pending" }),
    getWeather(),
  ]);
  const w = weather.status === "fulfilled" ? weather.value : null;
  return {
    next_event: cal.status === "fulfilled" && cal.value.configured ? pickNextEvent(cal.value.events) : null,
    today: pickToday(
      habits.status === "fulfilled" ? habits.value : [],
      tasks.status === "fulfilled" ? tasks.value.map((t) => t.title) : [],
    ),
    weather: w ? { place: w.place, temp_c: Math.round(w.now.tempC), words: weatherWords(w.now.weatherCode), stale: w.stale } : null,
    sleep_at: sleepAt,
  };
}
