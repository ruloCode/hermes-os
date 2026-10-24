import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  isTvKey,
  parseRemoteLine,
  parseSleepMinutes,
  parseWakefulness,
  powerKey,
  powerPlan,
  remoteConnected,
  resolveTvApp,
  DEFAULT_SCENES,
  alarmDue,
  appName,
  parseNowPlaying,
  parseScenes,
  rampLevel,
  tvTokenAllows,
} from "./plan.js";
import { espressifPorts } from "./remote.js";
import { parseYtLine, pickVideo } from "./youtube.js";

test("el botón de encendido no se pulsa si la TV ya está como se pide", () => {
  assert.equal(powerPlan("off", "off"), "skip");
  assert.equal(powerPlan("on", "on"), "skip");
  assert.equal(powerPlan("off", "on"), "press");
  assert.equal(powerPlan("on", "off"), "press");
});

test("sin estado confiable se manda la tecla igual: wake/sleep no alternan", () => {
  // Tras el reposo el Wi-Fi tarda >1 min: "adb no responde" NO es "apagada".
  assert.equal(powerPlan("on", "unreachable"), "press");
  assert.equal(powerPlan("off", "unreachable"), "press");
  assert.equal(powerPlan("off", "unknown"), "press");
});

test("prender y apagar nunca usan el interruptor", () => {
  assert.equal(powerKey("on"), "wake");
  assert.equal(powerKey("off"), "sleep");
  assert.ok(isTvKey("wake") && isTvKey("sleep"));
});

test("dumpsys power: Dreaming (protector) cuenta como prendida", () => {
  assert.equal(parseWakefulness("  mWakefulness=Awake\n"), "on");
  assert.equal(parseWakefulness("mWakefulness=Dreaming"), "on");
  assert.equal(parseWakefulness("mWakefulness=Asleep"), "off");
  assert.equal(parseWakefulness("mWakefulness=Dozing"), "off");
  assert.equal(parseWakefulness("sin el campo"), "unknown");
});

test("las respuestas del firmware se separan de sus líneas de log", () => {
  assert.deepEqual(parseRemoteLine("ok vol+"), { ok: true, detail: "vol+" });
  assert.deepEqual(parseRemoteLine("error: la TV no está conectada por Bluetooth"), {
    ok: false,
    error: "la TV no está conectada por Bluetooth",
  });
  assert.equal(parseRemoteLine("[ble] conectado: 38:9b:73:c4:ad:44"), null);
  assert.equal(remoteConnected("ble=conectado wifi=sin-config"), true);
  assert.equal(remoteConnected("ble=esperando wifi=sin-config"), false);
});

test("las teclas son las del firmware y nada más", () => {
  assert.ok(isTvKey("home"));
  assert.ok(isTvKey("vol+"));
  assert.ok(!isTvKey("reboot"));
  assert.ok(!isTvKey("text"));
});

test("apps por nombre dicho, con tilde o mayúsculas; desconocidas = null", () => {
  assert.equal(resolveTvApp("Netflix"), "com.netflix.ninja");
  assert.equal(resolveTvApp("HBO Max"), "com.wbd.stream");
  assert.equal(resolveTvApp("Disney+"), "com.disney.disneyplus");
  assert.equal(resolveTvApp("com.spotify.tv.android"), "com.spotify.tv.android");
  assert.equal(resolveTvApp("una app que no existe"), null);
});

test("las escenas de fábrica tocan luces Y TV; buenas noches apaga las dos", () => {
  const noches = DEFAULT_SCENES.find((s) => s.id === "noches")!.steps;
  assert.ok(noches.some((s) => s.kind === "lights" && s.action === "off"));
  assert.ok(noches.some((s) => s.kind === "tv-power" && s.action === "off"));
  assert.ok(DEFAULT_SCENES.find((s) => s.id === "cine")!.steps.some((s) => s.kind === "tv-power" && s.action === "on"));
});

test("escenas.json reemplaza por id y agrega nuevas; sin archivo quedan las de fábrica", () => {
  assert.deepEqual(parseScenes(null).scenes.map((s) => s.id), ["cine", "noches"]);
  const r = parseScenes({
    scenes: [
      { id: "cine", name: "Película", steps: [{ kind: "tv-open", app: "HBO Max", url: "https://play.hbomax.com/show/x" }, { kind: "wait", ms: 8000 }, { kind: "tv-key", key: "ok" }] },
      { id: "leer", name: "Leer", steps: [{ kind: "lights", action: "brightness", value: 80 }] },
    ],
  });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.scenes.map((s) => s.id), ["cine", "noches", "leer"]);
  assert.equal(r.scenes[0]!.name, "Película");
  assert.deepEqual(r.scenes[2]!.steps[0], { kind: "lights", action: "brightness", value: "80" });
  const fresh = parseScenes({ scenes: [{ id: "p", steps: [{ kind: "tv-open", app: "prime video", fresh: true }] }] });
  assert.deepEqual(fresh.scenes[2]!.steps[0], { kind: "tv-open", app: "prime video", fresh: true });
});

test("una escena con un paso inválido se descarta entera y dice por qué", () => {
  const r = parseScenes({
    scenes: [
      { id: "rota", steps: [{ kind: "lights", action: "off" }, { kind: "tv-key", key: "reboot" }] },
      { id: "lenta", steps: [{ kind: "wait", ms: 60_000 }] },
      { id: "url-mala", steps: [{ kind: "tv-open", app: "netflix", url: "javascript:alert(1)" }] },
      { id: "Con Espacios", steps: [{ kind: "lights", action: "off" }] },
    ],
  });
  assert.deepEqual(r.scenes.map((s) => s.id), ["cine", "noches"]);
  assert.equal(r.errors.length, 4);
  assert.ok(r.errors[0]!.includes("reboot"));
});

test("el token de la TV solo abre su pantalla, escenas y temporizador", () => {
  assert.ok(tvTokenAllows("GET", "/tv/home"));
  assert.ok(tvTokenAllows("GET", "/tv/scenes"));
  assert.ok(tvTokenAllows("POST", "/tv/scene"));
  assert.ok(tvTokenAllows("POST", "/tv/sleep"));
  assert.ok(!tvTokenAllows("POST", "/tv/command"));
  assert.ok(!tvTokenAllows("GET", "/finance/summary"));
  assert.ok(!tvTokenAllows("POST", "/tasks"));
  assert.ok(!tvTokenAllows("GET", "/tv/home/../finance"));
});

test("temporizador: 0 cancela, fuera de rango o basura = null", () => {
  assert.equal(parseSleepMinutes(40), 40);
  assert.equal(parseSleepMinutes("30"), 30);
  assert.equal(parseSleepMinutes(0), 0);
  assert.equal(parseSleepMinutes(-5), null);
  assert.equal(parseSleepMinutes(1000), null);
  assert.equal(parseSleepMinutes("mucho"), null);
});

test("solo los puertos de la USB de Espressif cuentan como el control (no el teléfono)", () => {
  const ioreg = [
    '+-o USB JTAG_serial debug unit@02130000  <class IOUSBHostDevice>',
    '  |   "idVendor" = 12346',
    '  | | |   "IOCalloutDevice" = "/dev/cu.usbmodem21101"',
    '  | | |   "IODialinDevice" = "/dev/tty.usbmodem21101"',
  ].join("\n");
  assert.deepEqual(espressifPorts(ioreg), ["/dev/cu.usbmodem21101"]);
  assert.deepEqual(espressifPorts(""), []);
});

test("escenas con horario y amanecer: cron y before_alarm_min se validan; rampa y temporizador son pasos", () => {
  const r = parseScenes({
    scenes: [
      { id: "descanso", cron: "30 22 * * *", steps: [{ kind: "lights-ramp", to: 10, minutes: 20 }, { kind: "tv-sleep", minutes: 30 }] },
      { id: "amanecer", before_alarm_min: 15, steps: [{ kind: "lights-ramp", from: 1, to: 60, minutes: 15 }] },
      { id: "cron-malo", cron: "99 * * * *", steps: [{ kind: "lights", action: "off" }] },
      { id: "rampa-mala", steps: [{ kind: "lights-ramp", to: 50, minutes: 600 }] },
    ],
  });
  const ids = r.scenes.map((s) => s.id);
  assert.ok(ids.includes("descanso") && ids.includes("amanecer"));
  assert.ok(!ids.includes("cron-malo") && !ids.includes("rampa-mala"));
  assert.equal(r.errors.length, 2);
  const amanecer = r.scenes.find((s) => s.id === "amanecer")!;
  assert.equal(amanecer.before_alarm_min, 15);
  assert.deepEqual(amanecer.steps[0], { kind: "lights-ramp", from: 1, to: 60, minutes: 15 });
});

test("la rampa sube en línea recta y nunca manda 0 (0 = apagado)", () => {
  assert.equal(rampLevel(1, 60, 15, 15), 60);
  assert.equal(rampLevel(1, 60, 15, 0), 1);
  assert.equal(rampLevel(40, 0, 20, 20), 1);
  assert.ok(rampLevel(1, 60, 15, 7) > rampLevel(1, 60, 15, 6));
});

test("el amanecer corre dentro de la ventana antes de la alarma, una vez por alarma", () => {
  const alarm = "2026-10-21T11:00:00.000Z"; // 6:00 Bogotá
  const at = (iso: string) => new Date(iso);
  assert.equal(alarmDue(alarm, 15, at("2026-10-21T10:40:00Z"), null), false); // 20 min antes: aún no
  assert.equal(alarmDue(alarm, 15, at("2026-10-21T10:46:00Z"), null), true); // 14 min antes
  assert.equal(alarmDue(alarm, 15, at("2026-10-21T10:50:00Z"), alarm), false); // ya disparada
  assert.equal(alarmDue(alarm, 15, at("2026-10-21T11:01:00Z"), null), false); // ya sonó
  assert.equal(alarmDue(null, 15, at("2026-10-21T10:50:00Z"), null), false); // sin alarma
});

test("YouTube: se lee lo que imprime yt-dlp y se elige un video de verdad, no un Short", () => {
  const short = parseYtLine("abcdefghijk\t45\tCanal\tUn short");
  const real = parseYtLine("EbgkuczJ3jY\t727\tClínica\tPausas activas");
  assert.deepEqual(real, { id: "EbgkuczJ3jY", duration: 727, channel: "Clínica", title: "Pausas activas" });
  assert.equal(parseYtLine("basura sin tabs"), null);
  assert.equal(pickVideo([short!, real!])!.id, "EbgkuczJ3jY");
  assert.equal(pickVideo([short!])!.id, "abcdefghijk"); // sin otra opción, el que hay
  assert.equal(pickVideo([]), null);
});

test("qué suena: la sesión de YouTube (no el Bluetooth), título y canal separados, posición al día", () => {
  const dump = [
    "  Sessions Stack - have 2 sessions:",
    "      package=com.google.android.youtube.tv",
    "      state=PlaybackState {state=PLAYING(3), position=26000, buffered position=0, speed=1.0, updated=1000, actions=381}",
    "      metadata: size=5, description=¿Qué son los LLM? Explicación, sencilla, Derivando, null",
    "      package=com.android.bluetooth",
    "      state=PlaybackState {state=ERROR(7), position=0, buffered position=0, speed=0.0, updated=5, actions=0}",
    "      metadata: null",
  ].join("\n");
  const now = parseNowPlaying(dump, 11_000); // corrieron 10 s desde la actualización
  assert.deepEqual(now, { pkg: "com.google.android.youtube.tv", state: "playing", title: "¿Qué son los LLM? Explicación, sencilla", subtitle: "Derivando", position_s: 36 });
  assert.equal(appName(now!.pkg), "YouTube");
  assert.equal(appName("com.otra.app"), null);
});

test("en pausa no se suma tiempo; sin metadatos (Prime) no hay título que mostrar", () => {
  const paused = "package=com.google.android.youtube.tv\nstate=PlaybackState {state=PAUSED(2), position=26091, buffered position=0, speed=0.0, updated=10, actions=381}\nmetadata: size=5, description=Video, Canal, null";
  assert.equal(parseNowPlaying(paused, 999_999)!.position_s, 26);
  const prime = "package=com.amazon.amazonvideo.livingroom\nstate=PlaybackState {state=PLAYING(3), position=0, buffered position=0, speed=1.0, updated=10, actions=1}\nmetadata: null";
  assert.equal(parseNowPlaying(prime, 100), null);
});

// ── YouTube: anuncios, fin del video y saludo (medido en la TV el 2026-10-20) ──
import {
  adStep,
  AD_MAX_PRESSES,
  buildGreeting,
  dateWords,
  isoWeek,
  newAdTracker,
  newVideoWatch,
  parseSnapshot,
  parseYouTubeSession,
  speakTime,
  videoEndStep,
  type TvSnapshot,
  type YtSession,
} from "./plan.js";

const ytBlock = (state: string, pos: number, updated: number, actions: number, desc: string) => `
    starboard com.google.android.youtube.tv/starboard (userId=0)
      package=com.google.android.youtube.tv
      active=true
      state=PlaybackState {state=${state}, position=${pos}, buffered position=0, speed=1.0, updated=${updated}, actions=${actions}, custom actions=[], active item id=-1, error=null}
      metadata: size=5, description=${desc}
    other com.spotify.tv.android/x (userId=0)
      package=com.spotify.tv.android
      state=PlaybackState {state=NONE(0), position=112218, buffered position=0, speed=1.0, updated=1, actions=2368383, custom actions=[], active item id=-1, error=null}
      metadata: size=8, description=Otra, Artista, Album
`;

test("un anuncio se reconoce porque no deja buscar, aunque traiga el título del video pedido", () => {
  const ad = parseYouTubeSession(ytBlock("PLAYING(3)", 1712, 1000, 51, "Mood booster playlist, Just Chillin', null"), 4000)!;
  assert.equal(ad.seekable, false);
  assert.equal(ad.title, "Mood booster playlist");
  assert.equal(ad.position_s, 5); // 1,7 s + 3 s corridos
  const video = parseYouTubeSession(ytBlock("PLAYING(3)", 1503, 1000, 379, "Meditación, Canal, null"), 1000)!;
  assert.equal(video.seekable, true);
  assert.equal(parseYouTubeSession("sin youtube", 0), null);
  const loading = parseYouTubeSession(ytBlock("PLAYING(3)", 0, 1, 379, "null, null, null"), 1)!;
  assert.equal(loading.title, null);
});

const ad = (pos: number): YtSession => ({ state: "playing", seekable: false, title: "x", position_s: pos });
const vid = (pos: number, title = "Meditación", state: YtSession["state"] = "playing"): YtSession => ({ state, seekable: true, title, position_s: pos });

test("el OK solo va con anuncio detectado y pasado el conteo; nunca sobre el video", () => {
  let t = newAdTracker();
  let r = adStep(ad(2), t, 0);
  assert.equal(r.action, "none");
  assert.equal(r.newAd, true);
  t = r.tracker;
  r = adStep(ad(6), t, 4000);
  assert.equal(r.action, "skip");
  t = r.tracker;
  assert.equal(adStep(ad(7), t, 5000).action, "none", "espera entre intentos");
  for (const pos of [1, 50, 300]) assert.equal(adStep(vid(pos), newAdTracker(), 0).action, "none");
  assert.equal(adStep(null, t, 9000).action, "none", "encuesta o cambio de anuncio: sin sesión no se toca nada");
});

test("un anuncio que no se deja saltar recibe pocos OK, y el siguiente anuncio cuenta de nuevo", () => {
  let t = newAdTracker();
  let presses = 0;
  for (let i = 0; i < 20; i++) {
    const r = adStep(ad(6 + i * 3), t, i * 3000);
    if (r.action === "skip") presses++;
    t = r.tracker;
  }
  assert.equal(presses, AD_MAX_PRESSES);
  const next = adStep(ad(7), t, 100_000); // la posición bajó: es otro anuncio
  assert.equal(next.newAd, true);
  assert.equal(next.action, "skip");
});

test("si el OK cayó sobre el video (el anuncio acabó justo) y lo pausó, se reanuda", () => {
  const t = adStep(ad(8), newAdTracker(), 1000).tracker;
  assert.equal(adStep(vid(3, "M", "paused"), t, 3000).action, "resume");
  assert.equal(adStep(vid(3, "M", "paused"), t, 20_000).action, "none", "pausado mucho después = lo pausó el dueño");
});

const snap = (yt: YtSession | null, fg: string | null = "com.google.android.youtube.tv", power: TvSnapshot["power"] = "on"): TvSnapshot => ({ power, fg, activity: null, yt });

test("el video termina por su duración, no por un temporizador", () => {
  let w = newVideoWatch();
  w = videoEndStep(snap(vid(5)), w, 601, 30_000, 0).watch;
  assert.equal(w.title, "Meditación");
  assert.equal(videoEndStep(snap(vid(300)), w, 601, 300_000, 0).verdict, "waiting");
  assert.equal(videoEndStep(snap(vid(599)), w, 601, 650_000, 0).verdict, "ended");
});

test("un anuncio a mitad (mismo título, sin buscar) no cuenta como fin ni como cambio", () => {
  let w = videoEndStep(snap(vid(200)), newVideoWatch(), 601, 200_000, 0).watch;
  const r = videoEndStep(snap(ad(3)), w, 601, 210_000, 0);
  assert.equal(r.verdict, "waiting");
  w = r.watch;
  assert.equal(w.lastPos, 200);
});

test("autoplay al final = terminó; otro video a mitad = el dueño lo cambió", () => {
  const near = videoEndStep(snap(vid(590)), videoEndStep(snap(vid(1)), newVideoWatch(), 601, 1, 0).watch, 601, 600_000, 0).watch;
  assert.equal(videoEndStep(snap(vid(3, "Otro video")), near, 601, 620_000, 0).verdict, "ended");
  const mid = videoEndStep(snap(vid(100)), videoEndStep(snap(vid(1)), newVideoWatch(), 601, 1, 0).watch, 601, 100_000, 0).watch;
  assert.equal(videoEndStep(snap(vid(3, "Otro video")), mid, 601, 120_000, 0).verdict, "abandoned");
});

test("TV apagada u otra app a mitad: se abandona tras 20 s, no al primer vistazo ni durante el arranque", () => {
  const w = videoEndStep(snap(vid(100)), videoEndStep(snap(vid(1)), newVideoWatch(), 601, 1, 0).watch, 601, 100_000, 0).watch;
  assert.equal(videoEndStep(snap(null, "os.hermes.tv"), newVideoWatch(), 601, 5_000, 0).verdict, "waiting", "arranque");
  const first = videoEndStep(snap(null, "com.netflix.ninja"), w, 601, 120_000, 1000);
  assert.equal(first.verdict, "waiting");
  assert.equal(videoEndStep(snap(null, "com.netflix.ninja"), first.watch, 601, 141_000, 22_000).verdict, "abandoned");
  assert.equal(videoEndStep(snap(null, null, "off"), w, 601, 120_000, 0).verdict, "waiting");
});

test("la foto combinada de adb trae energía, actividad al frente y la sesión", () => {
  const out = `  mWakefulness=Awake\n  topResumedActivity=ActivityRecord{abc u0 os.hermes.tv/.GreetingActivity t12}\n${ytBlock("PLAYING(3)", 0, 1, 379, "M, C, null")}\n12345.67 999.1\n`;
  const s = parseSnapshot(out);
  assert.equal(s.power, "on");
  assert.equal(s.fg, "os.hermes.tv");
  assert.equal(s.activity, ".GreetingActivity");
  assert.equal(s.yt?.seekable, true);
});

test("semana ISO: la semana 1 tiene el primer jueves del año", () => {
  assert.equal(isoWeek("2026-10-21"), 43);
  assert.equal(isoWeek("2026-01-01"), 1); // jueves
  assert.equal(isoWeek("2027-01-01"), 53); // viernes: aún es la última de 2026
  assert.equal(isoWeek("2025-12-29"), 1); // lunes de la semana 1 de 2026
  assert.equal(dateWords("2026-10-21"), "miércoles 21 de octubre de 2026");
});

test("la voz no lee emojis; la pantalla los conserva", () => {
  const g = buildGreeting({ owner: "Ana", date: "2026-10-21", events: [{ title: "🏋️ Gym", h: 6, m: 0 }, { title: "📖 Control — Lectura", h: 7, m: 30 }], tasks: [], habits: [] });
  assert.match(g.speech, /A las 6 de la mañana, Gym\. A las 7 y media de la mañana, Control, Lectura\./);
  assert.ok(g.items.includes("6:00 · 🏋️ Gym"));
});

test("las horas se dicen como se hablan", () => {
  assert.equal(speakTime(9, 0), "a las 9 de la mañana");
  assert.equal(speakTime(13, 30), "a la 1 y media de la tarde");
  assert.equal(speakTime(12, 15), "a las 12 y cuarto del mediodía");
  assert.equal(speakTime(20, 5), "a las 8 y 5 de la noche");
});

test("el saludo solo dice datos reales y corta las listas largas", () => {
  const g = buildGreeting({
    owner: "Ana",
    date: "2026-10-21",
    events: [{ title: "Daily", h: 9, m: 0 }, { title: "Cumpleaños de Leo", h: null, m: null }],
    tasks: [{ title: "a", done: false }, { title: "b", done: true }, ...["c", "d", "e", "f"].map((t) => ({ title: t, done: false }))],
    habits: [],
    outro: "Ahora, la meditación.",
  });
  assert.match(g.speech, /^Buenos días, Ana\. Hoy es miércoles 21 de octubre de 2026\. Estamos en la semana 43 del año\./);
  assert.match(g.speech, /A las 9 de la mañana, Daily\./);
  assert.match(g.speech, /Todo el día: Cumpleaños de Leo\./);
  assert.match(g.speech, /Pendientes: a, c, d y e y 1 más\./);
  assert.ok(!g.speech.includes(" b,") && !/hábitos/i.test(g.speech));
  assert.ok(g.speech.endsWith("Ahora, la meditación."));
  assert.equal(g.subtitle, "miércoles 21 de octubre de 2026 · semana 43");
  const empty = buildGreeting({ owner: "Ana", date: "2026-10-21", events: [], tasks: [], habits: [] });
  assert.match(empty.speech, /Hoy no tienes nada en el calendario\.$/);
  assert.equal(empty.items.length, 1, "un día vacío solo muestra la frase, nada inventado");
  assert.match(empty.items[0], /^«.+» — /);
});

test("las escenas aceptan los pasos del despertar y rechazan ids o tiempos imposibles", () => {
  const { scenes, errors } = parseScenes({
    scenes: [
      {
        id: "despertar",
        steps: [
          { kind: "lights-ramp", from: 1, to: 60, minutes: 12, background: true },
          { kind: "tv-greeting", outro: "Ahora, la meditación." },
          { kind: "tv-youtube", id: "-L0A-bU-Kio", title: "Meditación", duration_s: 601 },
          { kind: "wait-video-end", max_ms: 1_200_000 },
        ],
      },
      { id: "mala1", steps: [{ kind: "tv-youtube", id: "corto" }] },
      { id: "mala2", steps: [{ kind: "wait-video-end", max_ms: 5 }] },
    ],
  });
  const d = scenes.find((s) => s.id === "despertar")!;
  assert.deepEqual(d.steps[0], { kind: "lights-ramp", from: 1, to: 60, minutes: 12, background: true });
  assert.equal(d.steps[2].kind, "tv-youtube");
  assert.ok(!scenes.some((s) => s.id.startsWith("mala")));
  assert.equal(errors.length, 2);
});

test("la alarma ya disparada se reconoce por el instante, no por cómo está escrita", () => {
  const now = new Date("2026-10-21T10:20:00Z");
  assert.equal(alarmDue("2026-10-21T10:30:00Z", 15, now, "2026-10-21T10:30:00.000Z"), false);
  assert.equal(alarmDue("2026-10-21T10:30:00Z", 15, now, null), true);
});

test("el token de la TV puede leer el saludo, nada más nuevo", () => {
  assert.ok(tvTokenAllows("GET", "/tv/greeting"));
  assert.ok(tvTokenAllows("GET", "/tv/greeting.mp3"));
  assert.ok(!tvTokenAllows("POST", "/tv/greeting/preview"));
});

import { cheerSpeech, DAILY_QUOTES, quoteOfDay } from "./plan.js";

test("la frase cambia cada día y recorre toda la lista antes de repetir", () => {
  const days = Array.from({ length: DAILY_QUOTES.length }, (_, i) => {
    const d = new Date(Date.UTC(2026, 9, 21 + i));
    return d.toISOString().slice(0, 10);
  });
  const seen = new Set(days.map((d) => quoteOfDay(d).text));
  assert.equal(seen.size, DAILY_QUOTES.length);
  assert.equal(quoteOfDay("2026-10-21").text, quoteOfDay("2026-10-21").text);
  for (const q of DAILY_QUOTES) assert.ok(q.author && q.source, "toda frase lleva autor y obra");
});

test("el saludo dice la frase del día y el clima solo si hay dato", () => {
  const base = { owner: "Ana", date: "2026-10-21", events: [], tasks: [], habits: [] };
  const q = quoteOfDay("2026-10-21");
  const g = buildGreeting({ ...base, weather: { place: "Bogotá", temp_c: 9, words: "nublado" } });
  assert.ok(g.speech.includes(`La frase de hoy es de ${q.author}: ${q.text}`));
  assert.ok(g.speech.includes("En Bogotá hay 9 grados, nublado."));
  assert.ok(g.speech.indexOf("semana 43") < g.speech.indexOf("La frase") && g.speech.indexOf("grados") < g.speech.indexOf("calendario"));
  assert.ok(!buildGreeting({ ...base, weather: null }).speech.includes("grados"));
});

test("la felicitación usa la racha real, celebra hitos y no inventa números", () => {
  assert.equal(cheerSpeech("Ana", "Gym", 1, 1), "¡Muy bien, Ana! Rutina completa: Gym de hoy marcado. Hoy arranca tu racha: mañana la seguimos.");
  assert.match(cheerSpeech("Ana", "Gym", 4, 3), /Llevas 4 días seguidos\. Esta semana van 3\.$/);
  assert.match(cheerSpeech("Ana", "Gym", 7, 5), /¡Una semana completa sin fallar!/);
  assert.match(cheerSpeech("Ana", "Gym", 30, 4), /¡Un mes sin fallar!/);
  assert.equal(cheerSpeech("Ana", "Gym", null, null), "¡Muy bien, Ana! Rutina completa: Gym de hoy marcado.");
});

test("los avisos de sección y la felicitación se validan", () => {
  const { scenes, errors } = parseScenes({
    scenes: [
      { id: "ejercicio", steps: [{ kind: "tv-say", title: "Ejercicio", text: "Comienza la rutina." }, { kind: "habit-cheer", habit: "Gym" }] },
      { id: "mala3", steps: [{ kind: "tv-say", title: "Sin texto" }] },
      { id: "mala4", steps: [{ kind: "habit-cheer" }] },
    ],
  });
  assert.deepEqual(scenes.find((s) => s.id === "ejercicio")!.steps, [
    { kind: "tv-say", title: "Ejercicio", text: "Comienza la rutina." },
    { kind: "habit-cheer", habit: "Gym" },
  ]);
  assert.equal(errors.length, 2);
});
