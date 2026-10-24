/**
 * Simulador e2e de la junta EN VIVO — valida el pipeline completo contra un
 * agente corriendo, sin navegador y (con el FakeProvider) sin gastar un peso:
 *
 *   HERMES_LIVE_STT=fake pnpm dev:agent          # terminal 1
 *   pnpm --filter @hermes/agent live:sim         # terminal 2
 *
 * Flags:
 *   --project <slug>   proyecto del vault (default: el primero activo)
 *   --title <txt>      título de la junta
 *   --wav <ruta>       streamea PCM16 de un WAV real (16 kHz mono LEI16;
 *                      convertir con `afconvert -f WAVE -d LEI16@16000 -c 1`)
 *                      → prueba AssemblyAI de verdad (labels A/B en español)
 *   --fast N           acelera el streaming ×N (solo smoke: degrada diarización)
 *   --copilot          valida la CAPA RÁPIDA (pregunta → suggestion_start ≤3s
 *                      → deltas streaming → done con source fast + mark_self).
 *                      Corre el agente con:
 *                      HERMES_LIVE_STT=fake HERMES_LIVE_STT_SCRIPT=interview \
 *                      HERMES_COPILOT=fake pnpm dev:agent
 *                      (sin HERMES_COPILOT=fake mide la latencia REAL de la
 *                      sesión persistente con la suscripción de Claude Code)
 *   --class            valida la CLASE DE INGLÉS (modo "clase-ingles"): andamio
 *                      tras la pregunta de la profe, corrección tras tu turno,
 *                      "¿Qué dijo?" a mano, cero loop estratégico y cierre en
 *                      english_sessions (source class) sin acta de junta. Al
 *                      final BORRA la sesión de prueba. Agente con:
 *                      HERMES_LIVE_STT=fake HERMES_LIVE_STT_SCRIPT=class \
 *                      HERMES_COPILOT=fake pnpm dev:agent
 *   --team             valida la REUNIÓN DE EQUIPO (modo "equipo"): aporte con
 *                      ángulo en cada ventana (decisión, problema, pregunta al
 *                      grupo, te nombran), glosario sin streaming, Pregunta y
 *                      ¿De qué hablan? a mano, y la sección ## Repaso del acta.
 *                      Al final BORRA el acta de prueba (vault + Supabase).
 *                      Agente con:
 *                      HERMES_LIVE_STT=fake HERMES_LIVE_STT_SCRIPT=team \
 *                      HERMES_COPILOT=fake pnpm dev:agent
 *   --phone            valida HERMES PHONE como cliente: start con client
 *                      phone, WS con roles (audio del teléfono + viewer que no
 *                      lo echa y recibe el transcript; un audio web desplaza
 *                      SOLO al audio), caída de ~5 s del audio con la cola de
 *                      PCM re-enviada a ≤1,25×, REST /self y /auto-help, stop
 *                      desde el viewer, `client: phone` en el acta y la
 *                      completación con el archivo del teléfono (subida por
 *                      partes con liveSessionId): hueco ≥3 s → re-ingesta
 *                      SOBRE la misma acta (STT batch local, sin gastar);
 *                      hueco <3 s → solo adjunta; complete repetido = mismo
 *                      job. BORRA todo lo que crea. Agente de ENSAYO con:
 *                      HERMES_PORT=<otro> HERMES_JOBS=off HERMES_LIVE_STT=fake \
 *                      HERMES_COPILOT=fake HERMES_STT=local \
 *                      HERMES_LIVE_INDEX_PATH=<tmp>/live-sessions.json \
 *                      HERMES_MEETING_UPLOADS_DIR=<tmp>/uploads pnpm dev:agent
 *                      (el sim lee HERMES_PORT y las mismas rutas del env).
 *
 * Secuencia validada: start REST → WS → hello → transcript_partial* →
 * transcript_final* → suggestion (Agent SDK real, ~60s) → rename →
 * speakers_renamed → stop → stop_ack → done → asserts del .md final.
 * Imprime un reporte PASS/FAIL por assert; exit code 1 si algo falló.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import WebSocket from "ws";
import { LENS_MAX_CHARS, toCue } from "@hermes/shared";
import type { LiveMeetingSnapshot, LiveServerEvent } from "@hermes/shared";
import { env } from "../src/env.js";
import { OWNER } from "../src/owner.js";
import { supabase } from "../src/supabase.js";

// ── Flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const WAV_PATH = flag("wav");
const FAST = Math.max(1, Number(flag("fast") ?? 1) || 1);
const PROJECT_FLAG = flag("project");
const TITLE = flag("title") ?? "Simulación junta en vivo";
const COPILOT = args.includes("--copilot");
const CLASS = args.includes("--class");
const TEAM = args.includes("--team");
const PHONE = args.includes("--phone");

const BASE = `http://127.0.0.1:${env.PORT}`;
const AUTH: Record<string, string> = env.HERMES_API_KEY
  ? { Authorization: `Bearer ${env.HERMES_API_KEY}` }
  : {};

// ── Reporte de asserts ─────────────────────────────────────────────────

const results: { name: string; ok: boolean; detail?: string }[] = [];
function record(name: string, ok: boolean, detail?: string): void {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Lente (docs/lente-gafas.md), en TODOS los modos: cada sugerencia terminada
 * con algo que mirar llega también como `cue` con su misma id, y ninguna
 * tarjeta pasa del tope de caracteres.
 */
function checkLens(): void {
  const done = events.flatMap((ev) =>
    ev.type === "suggestion" || ev.type === "suggestion_done" ? [ev.suggestion] : [],
  );
  const expected = done.filter((s) => toCue(s) !== null);
  if (!expected.length) return;
  const cues = events.flatMap((ev) => (ev.type === "cue" ? [ev.cue] : []));
  const partials = cues.filter((c) => c.pending).length;
  const ids = new Set(cues.filter((c) => !c.pending).map((c) => c.id));
  const missing = expected.filter((s) => !ids.has(s.id));
  record(
    "lente: cada sugerencia sale también como cue",
    missing.length === 0,
    `${expected.length - missing.length}/${expected.length} finales · ${partials} parciales en streaming${missing.length ? ` · faltan ${missing.map((s) => s.id).join(", ")}` : ""}`,
  );
  const long = cues.filter((c) => c.text.length > LENS_MAX_CHARS);
  record(
    `lente: tarjetas ≤ ${LENS_MAX_CHARS} caracteres`,
    long.length === 0,
    long.length ? long.map((c) => `${c.text.length}: ${c.text}`).join(" | ") : `${cues.length} tarjetas`,
  );
}

function report(): never {
  checkLens();
  const failed = results.filter((r) => !r.ok);
  console.log("\n── Reporte ─────────────────────────────────────────────");
  for (const r of results) {
    console.log(` ${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(
    failed.length
      ? `\n❌ ${failed.length}/${results.length} asserts fallaron`
      : `\n✅ ${results.length}/${results.length} asserts OK`,
  );
  process.exit(failed.length ? 1 : 0);
}

// ── Cola de eventos del WS + espera por tipo ───────────────────────────

const events: LiveServerEvent[] = [];
/** Epoch ms de llegada de cada evento (para medir latencias de la capa rápida). */
const eventTimes = new WeakMap<LiveServerEvent, number>();
const waiters = new Set<() => void>();
function pushEvent(ev: LiveServerEvent): void {
  events.push(ev);
  eventTimes.set(ev, Date.now());
  for (const w of [...waiters]) w();
}

type EventOf<K extends LiveServerEvent["type"]> = Extract<LiveServerEvent, { type: K }>;

function waitType<K extends LiveServerEvent["type"]>(
  type: K,
  timeoutMs: number,
  extra?: (ev: EventOf<K>) => boolean,
): Promise<EventOf<K> | null> {
  const pred = (ev: LiveServerEvent): ev is EventOf<K> =>
    ev.type === type && (!extra || extra(ev as EventOf<K>));
  const found = events.find(pred);
  if (found) return Promise.resolve(found);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(check);
      resolve(null);
    }, timeoutMs);
    const check = () => {
      const hit = events.find(pred);
      if (hit) {
        clearTimeout(timer);
        waiters.delete(check);
        resolve(hit);
      }
    };
    waiters.add(check);
  });
}

/** Chars finales acumulados (por id único: los upserts no se doble-cuentan). */
function finalChars(): number {
  const seen = new Map<string, number>();
  for (const e of events)
    if (e.type === "transcript_final") seen.set(e.segment.id, e.segment.text.length);
  return [...seen.values()].reduce((a, b) => a + b, 0);
}

async function waitFinalChars(min: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && finalChars() < min) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return finalChars() >= min;
}

// ── Audio: WAV real a ritmo de junta, o silencio (el fake lo ignora) ────

function startAudio(ws: WebSocket, pcm: Buffer | null): () => void {
  let offset = 0;
  const silence = Buffer.alloc(3200); // 100 ms de PCM16 16 kHz mono
  const timer = setInterval(
    () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (pcm && offset < pcm.length) {
        ws.send(pcm.subarray(offset, Math.min(offset + 3200, pcm.length)));
        offset += 3200;
      } else {
        // Sin WAV (o agotado): silencio para mantener vivo el lastAudioAt.
        ws.send(silence);
      }
    },
    Math.max(10, Math.round(100 / FAST)),
  );
  return () => clearInterval(timer);
}

// ── Flujo principal ────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (CLASS) return runClass();
  if (TEAM) return runTeam();
  if (PHONE) return runPhone();
  // 0. Proyecto objetivo (el ingest necesita una carpeta del vault).
  let project = PROJECT_FLAG;
  if (!project) {
    const res = await fetch(`${BASE}/projects`, { headers: AUTH });
    const projects = (await res.json()) as { slug: string; estado: string }[];
    project = (projects.find((p) => p.estado === "activo") ?? projects[0])?.slug;
  }
  if (!project) {
    console.error("Sin proyecto en el vault: pásalo con --project <slug>");
    process.exit(1);
  }
  const pcm = WAV_PATH ? (await readFile(WAV_PATH)).subarray(44) : null; // 44 = header WAV
  console.log(
    `▶ junta simulada en "${project}" → ${BASE}${pcm ? ` (WAV real ×${FAST})` : " (silencio + provider fake)"}\n`,
  );

  // 1. start REST
  const startRes = await fetch(`${BASE}/meetings/live/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ project, title: TITLE }),
  });
  if (startRes.status === 503) {
    console.error(
      "503: STT no configurado. Corre el agente con HERMES_LIVE_STT=fake o pon ASSEMBLYAI_API_KEY.",
    );
    process.exit(1);
  }
  if (startRes.status === 409) {
    console.error("409: ya hay una junta activa. Termínala primero (POST /meetings/live/:id/stop).");
    process.exit(1);
  }
  const snap = (await startRes.json()) as LiveMeetingSnapshot;
  record("start REST → snapshot con status live", startRes.ok && snap.status === "live", `status=${snap.status}`);
  if (!startRes.ok) report();

  // 2. WS (auth por ?key=, igual que el browser)
  const key = env.HERMES_API_KEY ? `?key=${encodeURIComponent(env.HERMES_API_KEY)}` : "";
  const ws = new WebSocket(`ws://127.0.0.1:${env.PORT}/meetings/live/${snap.id}/ws${key}`);
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      pushEvent(JSON.parse(data.toString()) as LiveServerEvent);
    } catch {
      /* frame no-JSON: se ignora */
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });

  const hello = await waitType("hello", 5_000);
  record("hello con el snapshot al conectar", hello?.session?.id === snap.id);

  // 3. audio ↑ + transcripción ↓
  const stopAudio = startAudio(ws, pcm);
  const partial = await waitType("transcript_partial", 30_000);
  record("llegan transcript_partial", !!partial);
  const final = await waitType("transcript_final", 60_000);
  record(
    "llegan transcript_final",
    !!final,
    final ? `[${final.segment.speaker}] "${final.segment.text.slice(0, 60)}…"` : "sin finales en 60s",
  );

  if (COPILOT) {
    // 4b. CAPA RÁPIDA: pregunta del guion → suggestion_start ≤3s → streaming →
    //     done con source fast. Requiere el guion interview en el agente
    //     (HERMES_LIVE_STT_SCRIPT=interview) para que haya finales con "?".
    console.log("… esperando la capa rápida (pregunta del guion → respuesta streaming)");
    const question = await waitType("transcript_final", 60_000, (ev) =>
      ev.segment.text.includes("?"),
    );
    record(
      "guion con pregunta (final con '?')",
      !!question,
      question?.segment.text.slice(0, 70) ?? "¿corre el agente con HERMES_LIVE_STT_SCRIPT=interview?",
    );
    const sStart = await waitType("suggestion_start", 15_000);
    const latencyMs =
      question && sStart ? (eventTimes.get(sStart) ?? 0) - (eventTimes.get(question) ?? 0) : -1;
    record(
      "suggestion_start ≤3s tras la pregunta",
      !!sStart && latencyMs >= -1_000 && latencyMs <= 3_000,
      sStart ? `${latencyMs}ms` : "sin suggestion_start en 15s",
    );
    const sDelta = await waitType("suggestion_delta", 5_000, (ev) => ev.id === sStart?.id);
    record("llegan suggestion_delta (streaming)", !!sDelta);
    const sDone = await waitType("suggestion_done", 30_000, (ev) => ev.suggestion.source === "fast");
    record(
      "suggestion_done con source fast",
      !!sDone,
      sDone ? sDone.suggestion.text.slice(0, 70) : "sin done en 30s",
    );
    // mark_self por el espejo JSON del WS → broadcast self_marked
    ws.send(JSON.stringify({ type: "mark_self", speaker: "B" }));
    const marked = await waitType("self_marked", 5_000, (ev) => ev.speaker === "B");
    record("mark_self B → self_marked", !!marked);
    // La ingesta exige ≥400 chars finales: los asserts rápidos terminan a los
    // ~15 s del guion, así que hay que dejarlo correr un poco más antes del stop.
    console.log("… dejando correr el guion hasta ~450 chars finales (para la ingesta)");
    const enough = await waitFinalChars(450, 90_000);
    record("transcript suficiente para la ingesta (≥450 chars)", enough);
    // Coach: el guion interview trae muletillas de B ("um", "like", "este") y
    // B quedó marcado como "yo" arriba → sus fillers deben contarse.
    const coach = await waitType("coach_metrics", 60_000, (ev) => {
      const self = ev.metrics.selfSpeaker ? ev.metrics.bySpeaker[ev.metrics.selfSpeaker] : null;
      return (self?.fillers ?? 0) > 0;
    });
    const selfStats = coach?.metrics.selfSpeaker
      ? coach.metrics.bySpeaker[coach.metrics.selfSpeaker]
      : null;
    record(
      "coach_metrics con muletillas de B (yo)",
      !!selfStats && selfStats.fillers > 0,
      selfStats ? `${selfStats.fillers} fillers · ${selfStats.wpm} wpm` : "sin coach_metrics con fillers",
    );
  } else {
    // 4. sugerencia del copiloto (Agent SDK real: umbral ≥20s + LLM ≈ 30-90s)
    console.log("… esperando la primera sugerencia del copiloto (hasta 120s)");
    const suggestion = await waitType("suggestion", 120_000);
    record(
      "llega ≥1 suggestion",
      !!suggestion,
      suggestion
        ? `[${suggestion.suggestion.kind}] ${suggestion.suggestion.text.slice(0, 80)}`
        : "sin sugerencias en 120s (¿login de Claude Code?)",
    );
  }

  // 5. rename en vivo (REST → broadcast)
  const renameRes = await fetch(`${BASE}/meetings/live/${snap.id}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({ speaker: "A", name: "Ana" }),
  });
  const renamed = await waitType("speakers_renamed", 5_000, (ev) => ev.speakerNames?.A === "Ana");
  record("rename A→Ana → speakers_renamed", renameRes.ok && !!renamed);

  // 6. stop → stop_ack → done (la ingesta LLM tarda)
  const stopRes = await fetch(`${BASE}/meetings/live/${snap.id}/stop`, {
    method: "POST",
    headers: AUTH,
  });
  const stopAck = await waitType("stop_ack", 10_000);
  record("stop REST → stop_ack por WS", stopRes.ok && !!stopAck);
  console.log("… esperando la ingesta (resumen + 2 accionables, hasta 180s)");
  // Un error fatal (p.ej. "junta demasiado corta") corta la espera de una:
  // el done ya no va a llegar.
  const done = await Promise.race([
    waitType("done", 180_000),
    waitType("error", 180_000, (ev) => ev.fatal).then(() => null),
  ]);
  stopAudio();
  const fatal = events.find((e) => e.type === "error" && e.fatal);
  record(
    "done{meetingId} tras la ingesta",
    !!done?.meetingId,
    done?.meetingId ?? (fatal && fatal.type === "error" ? fatal.message : "sin done en 180s"),
  );

  // 7. Asserts del resultado final (.md del vault + API)
  if (done?.meetingId) {
    const mRes = await fetch(`${BASE}/meetings/${project}/${done.meetingId}`, { headers: AUTH });
    const meeting = (await mRes.json()) as { source?: string; vault_path?: string };
    record("GET reunión → source live", mRes.ok && meeting.source === "live", `source=${meeting.source}`);
    if (meeting.vault_path) {
      const md = await readFile(meeting.vault_path, "utf8");
      const gotSuggestions = events.some(
        (e) => e.type === "suggestion" || e.type === "suggestion_done",
      );
      record(".md: sección Resumen", md.includes("## Resumen"));
      record(".md: sección Accionables", md.includes("## Accionables"));
      record(
        gotSuggestions ? ".md: sección Sugerencias en vivo" : ".md: sin sugerencias → sección omitida",
        gotSuggestions
          ? md.includes("## Sugerencias en vivo")
          : !md.includes("## Sugerencias en vivo"),
      );
      record(".md: sección Transcripción", md.includes("## Transcripción"));
      record(".md: frontmatter fuente live", /fuente:\s*live/.test(md));
      record(".md: hablante renombrado **Ana:**", md.includes("**Ana:**"));
      if (COPILOT) {
        // Coach: métricas reales en el acta, con B marcado como "yo".
        record(".md: sección Coach", md.includes("## Coach"));
        record(".md: coach marca a B como (yo)", md.includes("**B (yo)**"));
      }
    } else {
      record(".md accesible (vault_path)", false, "la respuesta no trae vault_path");
    }
  }

  ws.close();
  report();
}

// ── Clase de inglés (--class) ─────────────────────────────────────────

async function runClass(): Promise<void> {
  console.log(`▶ clase de inglés simulada → ${BASE}\n`);
  const startRes = await fetch(`${BASE}/meetings/live/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({
      project: "ingles",
      title: "Simulación clase de inglés",
      mode: "remoto",
      languages: ["es", "en"],
      coachMode: "clase-ingles",
      maxSpeakers: 2,
    }),
  });
  if (startRes.status === 503 || startRes.status === 409) {
    console.error(`${startRes.status}: ${await startRes.text()}`);
    process.exit(1);
  }
  const snap = (await startRes.json()) as LiveMeetingSnapshot;
  record(
    "start → snapshot live con coachMode clase-ingles",
    startRes.ok && snap.status === "live" && snap.coachMode === "clase-ingles",
    `status=${snap.status} coachMode=${snap.coachMode}`,
  );
  if (!startRes.ok) report();

  const key = env.HERMES_API_KEY ? `?key=${encodeURIComponent(env.HERMES_API_KEY)}` : "";
  const ws = new WebSocket(`ws://127.0.0.1:${env.PORT}/meetings/live/${snap.id}/ws${key}`);
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      pushEvent(JSON.parse(data.toString()) as LiveServerEvent);
    } catch {
      /* frame no-JSON */
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await waitType("hello", 5_000);
  const stopAudio = startAudio(ws, null);

  // "Soy yo" desde el arranque: B es el alumno en el guion de clase.
  ws.send(JSON.stringify({ type: "mark_self", speaker: "B" }));
  record("mark_self B → self_marked", !!(await waitType("self_marked", 5_000, (e) => e.speaker === "B")));

  // 1. Pregunta de la profe → la FRASE completa sola (ayuda automática por defecto).
  const question = await waitType(
    "transcript_final",
    30_000,
    (e) => e.segment.speaker === "A" && e.segment.text.includes("?"),
  );
  record("guion de clase: pregunta de la profe", !!question, question?.segment.text.slice(0, 70));
  const fStart = await waitType("suggestion_start", 10_000, (e) => e.kind === "decir");
  const fLatency =
    question && fStart ? (eventTimes.get(fStart) ?? 0) - (eventTimes.get(question) ?? 0) : -1;
  record(
    "frase automática arranca ≤3s tras la pregunta",
    !!fStart && fLatency <= 3_000,
    fStart ? `${fLatency}ms` : "sin suggestion_start decir",
  );
  const fDone = await waitType(
    "suggestion_done",
    15_000,
    (e) => e.suggestion.kind === "decir" && !e.suggestion.manual,
  );
  record("frase automática completa (no manual)", !!fDone, fDone?.suggestion.text.slice(0, 90));

  // 1b. "Ayúdame" a mano → andamio con palabras clave y arranque.
  ws.send(JSON.stringify({ type: "suggest_now", intent: "scaffold" }));
  const aDone = await waitType("suggestion_done", 15_000, (e) => e.suggestion.kind === "andamio");
  record(
    "Ayúdame → andamio con palabras clave y arranque",
    !!aDone && /Clave:/.test(aDone.suggestion.text) && /Arranca:/.test(aDone.suggestion.text),
    aDone?.suggestion.text.replace(/\n/g, " ⏎ ").slice(0, 90),
  );

  // 2. Tu turno → corrección (sin streaming: llega como `suggestion` entera).
  const mine = await waitType("transcript_final", 30_000, (e) => e.segment.speaker === "B");
  const corr = await waitType("suggestion", 15_000, (e) => e.suggestion.kind === "corregir");
  const cLatency = mine && corr ? (eventTimes.get(corr) ?? 0) - (eventTimes.get(mine) ?? 0) : -1;
  record(
    "corrección tras tu turno (≤7s: espera a que termines de hablar)",
    !!corr && cLatency <= 7_000 && corr.suggestion.text.includes("→"),
    corr ? `${cLatency}ms · ${corr.suggestion.text} · ${corr.suggestion.why}` : "sin corrección",
  );
  record(
    "las correcciones no streamean (no pisan el carril del andamio)",
    !events.some((e) => e.type === "suggestion_start" && e.kind === "corregir"),
  );

  // 3. "¿Qué dijo?" a mano por el WS.
  ws.send(JSON.stringify({ type: "suggest_now", intent: "explain" }));
  const eDone = await waitType("suggestion_done", 10_000, (e) => e.suggestion.kind === "explicar");
  record("¿Qué dijo? → explicar (manual)", !!eDone && !!eDone.suggestion.manual, eDone?.suggestion.text.slice(0, 70));

  // 4. Dejar correr el guion: métricas de clase + material para el cierre.
  console.log("… dejando correr la clase hasta ~450 chars finales");
  record("transcript suficiente (≥450 chars)", await waitFinalChars(450, 90_000));
  // El primero llega antes de cualquier corrección: se espera uno que ya las cuente.
  const coach = await waitType("coach_metrics", 30_000, (e) => (e.metrics.class?.corrections ?? 0) > 0);
  const cls = coach?.metrics.class;
  record(
    "coach_metrics con métricas de clase",
    !!cls && cls.selfWords > 0 && cls.corrections > 0,
    cls
      ? `habla ${Math.round(cls.selfShare * 100)}% · ${cls.selfWords} palabras · ${cls.corrections} correcciones`
      : "sin métricas de clase",
  );
  record(
    "sin loop estratégico (solo capa rápida)",
    !events.some(
      (e) =>
        (e.type === "suggestion" || e.type === "suggestion_done") && e.suggestion.source !== "fast",
    ),
  );

  // 5. Cierre → english_sessions, no acta de junta.
  const before = (await (await fetch(`${BASE}/meetings/ingles`, { headers: AUTH })).json()) as unknown[];
  await fetch(`${BASE}/meetings/live/${snap.id}/stop`, { method: "POST", headers: AUTH });
  const done = await Promise.race([
    waitType("done", 60_000),
    waitType("error", 60_000, (e) => e.fatal).then(() => null),
  ]);
  stopAudio();
  const fatal = events.find((e) => e.type === "error" && e.fatal);
  record(
    "done con englishSessionId",
    !!done?.englishSessionId,
    done ? `meetingId=${done.meetingId}` : fatal && fatal.type === "error" ? fatal.message : "sin done",
  );
  if (done?.englishSessionId) {
    const res = await fetch(`${BASE}/english/sessions/${done.englishSessionId}`, { headers: AUTH });
    const session = (await res.json()) as {
      source?: string;
      errors?: { quote: string; correction: string }[];
      transcript?: string;
    };
    record("sesión de inglés con source class", session.source === "class", `source=${session.source}`);
    record(
      "las correcciones en vivo quedaron como errores",
      (session.errors?.length ?? 0) > 0,
      `${session.errors?.length ?? 0} errores`,
    );
    record(
      "transcript con Profe/Yo y métricas",
      !!session.transcript?.includes("**Yo:**") &&
        !!session.transcript?.includes("**Profe:**") &&
        !!session.transcript?.startsWith("> Clase en vivo"),
    );
    const after = (await (await fetch(`${BASE}/meetings/ingles`, { headers: AUTH })).json()) as unknown[];
    record("no se creó acta de junta", after.length === before.length, `${before.length} → ${after.length}`);
    // Limpieza: la sesión simulada no debe quedar en el historial real.
    const del = await fetch(`${BASE}/english/sessions/${done.englishSessionId}`, {
      method: "DELETE",
      headers: AUTH,
    });
    record("sesión de prueba borrada", del.ok);
  }
  // Lo que soplaría en una clase real (útil corriendo con Haiku de verdad).
  console.log("\n── Tarjetas de la clase ────────────────────────────────");
  for (const e of events)
    if (e.type === "suggestion" || e.type === "suggestion_done")
      console.log(`[${e.suggestion.kind}] ${e.suggestion.text.replace(/\n/g, " ⏎ ")}${e.suggestion.why && e.suggestion.kind === "corregir" ? ` | ${e.suggestion.why}` : ""}`);
  ws.close();
  report();
}

// ── Reunión de equipo (--team) ────────────────────────────────────────

async function runTeam(): Promise<void> {
  let project = PROJECT_FLAG;
  if (!project) {
    const res = await fetch(`${BASE}/projects`, { headers: AUTH });
    const projects = (await res.json()) as { slug: string; estado: string }[];
    project = (projects.find((p) => p.estado === "activo") ?? projects[0])?.slug;
  }
  if (!project) {
    console.error("Sin proyecto en el vault: pásalo con --project <slug>");
    process.exit(1);
  }
  console.log(`▶ reunión de equipo simulada en "${project}" → ${BASE}\n`);
  const startRes = await fetch(`${BASE}/meetings/live/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH },
    body: JSON.stringify({
      project,
      title: "Simulación reunión de equipo",
      mode: "remoto",
      languages: ["es"],
      coachMode: "equipo",
    }),
  });
  if (startRes.status === 503 || startRes.status === 409) {
    console.error(`${startRes.status}: ${await startRes.text()}`);
    process.exit(1);
  }
  const snap = (await startRes.json()) as LiveMeetingSnapshot;
  record(
    "start → snapshot live con coachMode equipo",
    startRes.ok && snap.status === "live" && snap.coachMode === "equipo",
    `status=${snap.status} coachMode=${snap.coachMode}`,
  );
  if (!startRes.ok) report();

  const key = env.HERMES_API_KEY ? `?key=${encodeURIComponent(env.HERMES_API_KEY)}` : "";
  const ws = new WebSocket(`ws://127.0.0.1:${env.PORT}/meetings/live/${snap.id}/ws${key}`);
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      pushEvent(JSON.parse(data.toString()) as LiveServerEvent);
    } catch {
      /* frame no-JSON */
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  await waitType("hello", 5_000);
  const stopAudio = startAudio(ws, null);

  // B es el dueño en el guion de equipo.
  ws.send(JSON.stringify({ type: "mark_self", speaker: "B" }));
  record("mark_self B → self_marked", !!(await waitType("self_marked", 5_000, (e) => e.speaker === "B")));
  ws.send(JSON.stringify({ type: "rename", speaker: "A", name: "Ana" }));

  // 1. Primera ventana (la idea es… / el problema es…) → aporte con ángulo.
  const opening = await waitType(
    "transcript_final",
    30_000,
    (e) => e.segment.speaker !== "B" && /la idea es|el problema es/i.test(e.segment.text),
  );
  record("guion de equipo: ventana (decisión o problema)", !!opening, opening?.segment.text.slice(0, 70));
  const aStart = await waitType("suggestion_start", 10_000, (e) => e.kind === "aportar");
  const aLatency =
    opening && aStart ? (eventTimes.get(aStart) ?? 0) - (eventTimes.get(opening) ?? 0) : -1;
  record(
    "el aporte arranca ≤3s tras la ventana",
    !!aStart && aLatency <= 3_000,
    aStart ? `${aLatency}ms · ${aStart.trigger}` : "sin suggestion_start aportar",
  );
  const aDone = await waitType(
    "suggestion_done",
    15_000,
    (e) => e.suggestion.kind === "aportar" && !e.suggestion.manual,
  );
  record(
    "aporte automático con ángulo y frase (sin el ángulo en el texto)",
    !!aDone?.suggestion.angle && !!aDone.suggestion.text && !aDone.suggestion.text.startsWith(aDone.suggestion.angle),
    aDone ? `[${aDone.suggestion.angle}] ${aDone.suggestion.text.slice(0, 80)}` : "sin done",
  );

  // 2. Glosario: llega entero (sin streaming), «término — explicación».
  const concept = await waitType("suggestion", 25_000, (e) => e.suggestion.kind === "entender");
  record(
    "concepto nuevo «término — explicación»",
    !!concept && concept.suggestion.text.includes(" — "),
    concept?.suggestion.text.slice(0, 90),
  );

  // 3. A mano: Pregunta y ¿De qué hablan?
  ws.send(JSON.stringify({ type: "suggest_now", intent: "question" }));
  const qDone = await waitType("suggestion_done", 15_000, (e) => e.suggestion.kind === "preguntar");
  record(
    "Pregunta (manual) → preguntar con ángulo Pregunta",
    !!qDone?.suggestion.manual && qDone.suggestion.angle === "Pregunta",
    qDone?.suggestion.text.slice(0, 80),
  );
  // 4. Te nombran → aporte aunque haya otro reciente.
  const named = await waitType(
    "transcript_final",
    60_000,
    (e) => e.segment.speaker !== "B" && e.segment.text.toLowerCase().includes(OWNER.toLowerCase()),
  );
  const nDone = named
    ? await waitType("suggestion_done", 10_000, (e) => e.suggestion.why === "te nombraron")
    : null;
  record(
    `te nombran («${OWNER}») → aporte "te nombraron"`,
    !!nDone,
    named ? named.segment.text.slice(0, 70) : "el guion no te nombró (¿HERMES_OWNER_NAME distinto?)",
  );
  // Después de que te nombran (que te nombren interrumpe lo que esté en vuelo,
  // a propósito: esa respuesta importa más que el glosario).
  ws.send(JSON.stringify({ type: "suggest_now", intent: "explain" }));
  const eDone = await waitType(
    "suggestion_done",
    15_000,
    (e) => e.suggestion.kind === "entender" && !!e.suggestion.manual,
  );
  record("¿De qué hablan? (manual) → entender", !!eDone, eDone?.suggestion.text.replace(/\n/g, " ⏎ ").slice(0, 80));
  record(
    "lo que dices tú nunca dispara un aporte",
    !events.some(
      (e) =>
        e.type === "suggestion_start" &&
        e.kind === "aportar" &&
        events.some(
          (f) =>
            f.type === "transcript_final" &&
            f.segment.speaker === "B" &&
            (eventTimes.get(f) ?? 0) <= (eventTimes.get(e) ?? 0) &&
            (eventTimes.get(e) ?? 0) - (eventTimes.get(f) ?? 0) < 300,
        ),
    ),
  );
  record(
    "los conceptos no streamean (no pisan el carril del aporte)",
    !events.some((e) => e.type === "suggestion_start" && e.kind === "entender" && !e.trigger.includes("de qué")),
  );

  // 5. Cierre → acta con ## Repaso (ventanas con si hablaste + para estudiar).
  record("transcript suficiente (≥450 chars)", await waitFinalChars(450, 60_000));
  await fetch(`${BASE}/meetings/live/${snap.id}/stop`, { method: "POST", headers: AUTH });
  console.log("… esperando la ingesta (resumen + 2 accionables, hasta 180s)");
  const done = await Promise.race([
    waitType("done", 180_000),
    waitType("error", 180_000, (e) => e.fatal).then(() => null),
  ]);
  stopAudio();
  const fatal = events.find((e) => e.type === "error" && e.fatal);
  record(
    "done{meetingId} tras la ingesta",
    !!done?.meetingId,
    done?.meetingId ?? (fatal && fatal.type === "error" ? fatal.message : "sin done"),
  );
  if (done?.meetingId) {
    const mRes = await fetch(`${BASE}/meetings/${project}/${done.meetingId}`, { headers: AUTH });
    const meeting = (await mRes.json()) as { vault_path?: string };
    if (meeting.vault_path) {
      const md = await readFile(meeting.vault_path, "utf8");
      record(".md: sección ## Repaso", md.includes("## Repaso"));
      record(".md: ventanas con «hablaste en N»", /### Ventanas para aportar \(\d+ · hablaste en \d+\)/.test(md));
      record(".md: ### Para estudiar con conceptos", /### Para estudiar\n\n- \*\*/.test(md));
      record(".md: sugerencias con su ángulo", /\[aportar · [^·\]]+ · \d\d:\d\d\]/.test(md));
      // Limpieza: el acta simulada no debe quedar en el historial real.
      await unlink(meeting.vault_path).catch(() => undefined);
      if (supabase)
        await supabase.from("meetings").delete().eq("meeting_id", done.meetingId).eq("project_slug", project);
      record("acta de prueba borrada (vault + Supabase)", true);
    } else {
      record(".md accesible (vault_path)", false, "la respuesta no trae vault_path");
    }
  }
  console.log("\n── Tarjetas de la reunión ──────────────────────────────");
  for (const e of events)
    if (e.type === "suggestion" || e.type === "suggestion_done")
      console.log(
        `[${e.suggestion.kind}${e.suggestion.angle ? ` · ${e.suggestion.angle}` : ""}] ${e.suggestion.text.replace(/\n/g, " ⏎ ")} (${e.suggestion.why})`,
      );
  ws.close();
  report();
}

// ── Hermes Phone como cliente (--phone) ───────────────────────────────

const run = promisify(execFile);
const FRAME = 3200; // 100 ms de PCM16 16 kHz mono (lo que manda el teléfono)
const FRAME_MS = 100;

interface SimSocket {
  ws: WebSocket;
  events: LiveServerEvent[];
  closes: number[];
}

/** WS con su propia cola (el global `events` queda para el viewer). */
async function openLive(id: string, query: string, global = false): Promise<SimSocket> {
  const auth = env.HERMES_API_KEY ? `&key=${encodeURIComponent(env.HERMES_API_KEY)}` : "";
  const ws = new WebSocket(`ws://127.0.0.1:${env.PORT}/meetings/live/${id}/ws?${query}${auth}`);
  const sock: SimSocket = { ws, events: [], closes: [] };
  ws.on("message", (data, isBinary) => {
    if (isBinary) return;
    try {
      const ev = JSON.parse(data.toString()) as LiveServerEvent;
      sock.events.push(ev);
      if (global) pushEvent(ev);
    } catch {
      /* frame no-JSON */
    }
  });
  ws.on("close", (code) => sock.closes.push(code));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return sock;
}

async function until(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

const api = (path: string, init?: RequestInit) =>
  fetch(`${BASE}${path}`, { ...init, headers: { "Content-Type": "application/json", ...AUTH, ...(init?.headers ?? {}) } });

/** Subida por partes como la hace el teléfono → {jobId}. */
async function phoneUpload(
  file: Buffer,
  body: Record<string, unknown>,
): Promise<{ jobId?: string; again?: string }> {
  const init = await api("/meetings/uploads", {
    method: "POST",
    body: JSON.stringify({ ...body, size: file.length, mime: "audio/aac", filename: "junta.aac" }),
  });
  if (!init.ok) throw new Error(`init ${init.status}: ${await init.text()}`);
  for (let off = 0; off < file.length; off += 64 * 1024) {
    const part = file.subarray(off, Math.min(off + 64 * 1024, file.length));
    const r = await fetch(`${BASE}/meetings/uploads/${body.id}?offset=${off}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", ...AUTH },
      body: part,
    });
    if (!r.ok) throw new Error(`PUT ${r.status}: ${await r.text()}`);
  }
  const c1 = (await (await api(`/meetings/uploads/${body.id}/complete`, { method: "POST" })).json()) as {
    meeting_job_id?: string;
  };
  // Idempotencia: el teléfono no vio la respuesta y vuelve a completar.
  const c2 = (await (await api(`/meetings/uploads/${body.id}/complete`, { method: "POST" })).json()) as {
    meeting_job_id?: string;
  };
  return { jobId: c1.meeting_job_id, again: c2.meeting_job_id };
}

interface JobView {
  status?: string;
  stage?: string;
  outcome?: string;
  meetingId?: string;
  note?: string;
  error?: string;
  kind?: string;
  audioOnServer?: boolean;
}

async function waitJob(jobId: string, timeoutMs: number): Promise<JobView> {
  const deadline = Date.now() + timeoutMs;
  let last: JobView = {};
  while (Date.now() < deadline) {
    last = (await (await api(`/meetings/jobs/${jobId}`)).json()) as JobView;
    if (last.status === "done" || last.status === "error") return last;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return last;
}

/** Audio con voz real (say de macOS) en AAC ADTS — el formato del grabador del teléfono. */
async function speechAac(dir: string): Promise<Buffer> {
  const text =
    "Retomamos la junta del proyecto. Quedamos en terminar las pruebas de carga antes del viernes, " +
    "y Ana va a documentar el runbook de operación. También hay que pedir los permisos del tablero " +
    "de métricas y revisar los costos del clúster con finanzas el jueves.";
  const aiff = join(dir, "voz.aiff");
  const aac = join(dir, "voz.aac");
  await run("say", ["-v", "Paulina", "-o", aiff, text]).catch(() => run("say", ["-o", aiff, text]));
  await run(env.FFMPEG_BIN, ["-y", "-v", "error", "-i", aiff, "-ac", "1", "-ar", "16000", "-c:a", "aac", "-b:a", "64k", "-f", "adts", aac]);
  return readFile(aac);
}

async function runPhone(): Promise<void> {
  let project = PROJECT_FLAG;
  if (!project) {
    const res = await fetch(`${BASE}/projects`, { headers: AUTH });
    const projects = (await res.json()) as { slug: string; estado: string }[];
    project = (projects.find((p) => p.estado === "activo") ?? projects[0])?.slug;
  }
  if (!project) {
    console.error("Sin proyecto en el vault: pásalo con --project <slug>");
    process.exit(1);
  }
  console.log(`▶ junta desde Hermes Phone (simulada) en "${project}" → ${BASE}
`);
  const tmp = await mkdtemp(join(tmpdir(), "hermes-phone-sim-"));
  const created = { jobIds: new Set<string>(), uploadIds: new Set<string>(), meetingId: "" };

  try {
    const startRes = await api("/meetings/live/start", {
      method: "POST",
      body: JSON.stringify({ project, title: "Simulación junta desde el teléfono", client: "phone" }),
    });
    if (startRes.status === 503 || startRes.status === 409) {
      console.error(`${startRes.status}: ${await startRes.text()}`);
      process.exit(1);
    }
    const snap = (await startRes.json()) as LiveMeetingSnapshot;
    record("start con client phone → snapshot client phone", startRes.ok && snap.client === "phone", `client=${snap.client}`);
    if (!startRes.ok) report();

    // 1. Roles: audio del teléfono + viewer (el dashboard mirando).
    const audio = await openLive(snap.id, "role=audio&client=phone");
    const helloA = await until(() => audio.events.some((e) => e.type === "hello"), 5_000);
    const aHello = audio.events.find((e) => e.type === "hello");
    record(
      "hello al audio con audioClient phone",
      helloA && aHello?.type === "hello" && aHello.session.audioClient === "phone",
    );
    const viewer = await openLive(snap.id, "role=viewer&client=web", true);
    const vHello = await waitType("hello", 5_000);
    record("hello al viewer (snapshot con viewers 1)", vHello?.session.viewers === 1, `viewers=${vHello?.session.viewers}`);
    const sawClients = await until(
      () => audio.events.some((e) => e.type === "clients" && e.viewers === 1 && e.audioClient === "phone"),
      5_000,
    );
    record("evento clients al audio cuando entra el viewer", sawClients);
    // Un viewer que manda binario no rompe nada ni desplaza al audio.
    viewer.ws.send(Buffer.alloc(FRAME));
    await new Promise((r) => setTimeout(r, 300));
    record("el viewer no echa al audio (ni con binario)", audio.closes.length === 0 && audio.ws.readyState === WebSocket.OPEN);

    let sending = true;
    const queue: Buffer[] = [];
    const silence = Buffer.alloc(FRAME);
    // El "micrófono": un tramo cada 100 ms; si el WS no está, se encola (como el teléfono).
    let audioWs = audio.ws;
    const mic = setInterval(() => {
      if (!sending) return;
      if (audioWs.readyState === WebSocket.OPEN && queue.length === 0) audioWs.send(silence);
      else queue.push(Buffer.from(silence));
    }, FRAME_MS);

    const tf = await waitType("transcript_final", 30_000);
    record("el viewer recibe transcript_final", !!tf, tf?.segment.text.slice(0, 60));

    // 2. Un audio web desplaza SOLO al audio del teléfono; el viewer sigue.
    const web = await openLive(snap.id, "role=audio&client=web");
    const phoneKicked = await until(() => audio.closes.includes(4001), 5_000);
    record("audio web nuevo → el audio del teléfono recibe 4001", phoneKicked, `closes=${audio.closes.join(",")}`);
    record("el viewer NO fue desplazado", viewer.ws.readyState === WebSocket.OPEN && viewer.closes.length === 0);
    const webAudio = await until(
      () => events.some((e) => e.type === "clients" && e.audioClient === "web"),
      5_000,
    );
    record("viewer ve clients{audioClient: web}", webAudio);
    web.ws.close();
    await until(() => events.some((e) => e.type === "clients" && e.audioClient === undefined), 5_000);

    // 3. Caída de ~5 s del WS de audio del teléfono: el PCM se acumula.
    const phone2 = await openLive(snap.id, "role=audio&client=phone");
    queue.length = 0; // lo de antes era el turno del audio web: no es del teléfono
    audioWs = phone2.ws;
    await new Promise((r) => setTimeout(r, 1_000));
    phone2.ws.terminate(); // corte de red en seco
    const dropAt = Date.now();
    await new Promise((r) => setTimeout(r, 5_000));
    record(
      "durante la caída la sesión sigue viva (viewer abierto, sin error fatal)",
      viewer.ws.readyState === WebSocket.OPEN && !events.some((e) => e.type === "error" && e.fatal),
    );
    const mark = events.length;
    const phone3 = await openLive(snap.id, "role=audio&client=phone");
    audioWs = phone3.ws;
    await until(() => phone3.events.some((e) => e.type === "hello"), 5_000);
    const downMs = Date.now() - dropAt;
    // Ponerse al día a 1,25×: un tramo de 100 ms cada 80 ms hasta vaciar la
    // cola (el micrófono sigue encolando mientras tanto, como en el teléfono).
    const backlogMs = queue.length * FRAME_MS;
    const catchStart = Date.now();
    let sentFrames = 0;
    while (queue.length) {
      phone3.ws.send(queue.shift()!);
      sentFrames += 1;
      await new Promise((r) => setTimeout(r, FRAME_MS / 1.25));
    }
    const catchMs = Date.now() - catchStart;
    const speed = (sentFrames * FRAME_MS) / catchMs;
    record(
      "la cola de la caída se re-envía a ≤1,25× tiempo real",
      backlogMs >= 4_500 && speed <= 1.3,
      `caída ${downMs} ms → cola ${backlogMs} ms; ${sentFrames * FRAME_MS} ms enviados en ${catchMs} ms (${speed.toFixed(2)}×)`,
    );
    record(
      "reconectado: clients{audioClient: phone} al viewer y sin errores",
      await until(() => events.slice(mark).some((e) => e.type === "clients" && e.audioClient === "phone"), 5_000) &&
        phone3.closes.length === 0,
    );
    record(
      "la junta siguió transcribiendo tras la caída",
      await until(() => events.slice(mark).some((e) => e.type === "transcript_final"), 15_000),
    );
    record("ningún 4001 al viewer en todo el ensayo", !viewer.closes.includes(4001));

    // 4. REST nuevos (lo que hoy era solo-WS).
    const self = (await (await api(`/meetings/live/${snap.id}/self`, { method: "POST", body: JSON.stringify({ speaker: "B" }) })).json()) as LiveMeetingSnapshot;
    record("POST /self {B} → 200 snapshot con selfSpeaker B", self.selfSpeaker === "B");
    record("…y el viewer recibe self_marked", !!(await waitType("self_marked", 5_000, (e) => e.speaker === "B")));
    const unself = (await (await api(`/meetings/live/${snap.id}/self`, { method: "POST", body: JSON.stringify({ speaker: "" }) })).json()) as LiveMeetingSnapshot;
    record('POST /self {""} desmarca', unself.selfSpeaker === undefined);
    const bad = await api(`/meetings/live/${snap.id}/self`, { method: "POST", body: JSON.stringify({}) });
    record("POST /self sin speaker → 400", bad.status === 400);
    const ah = await api(`/meetings/live/${snap.id}/auto-help`, { method: "POST", body: JSON.stringify({ mode: "off" }) });
    record("POST /auto-help {off} → 200 autoHelp off", ah.ok && ((await ah.json()) as LiveMeetingSnapshot).autoHelp === "off");
    const ahBad = await api(`/meetings/live/${snap.id}/auto-help`, { method: "POST", body: JSON.stringify({ mode: "x" }) });
    record("POST /auto-help modo inválido → 400", ahBad.status === 400);
    const nf = await api(`/meetings/live/nope0000/self`, { method: "POST", body: JSON.stringify({ speaker: "A" }) });
    record("POST /self en junta inexistente → 404", nf.status === 404);
    // Para la ingesta: "soy yo" = B (como el guion).
    await api(`/meetings/live/${snap.id}/self`, { method: "POST", body: JSON.stringify({ speaker: "B" }) });

    // 5. Cierre DESDE EL VIEWER (los controles JSON se aceptan de ambos roles).
    record("transcript suficiente (≥450 chars)", await waitFinalChars(450, 90_000));
    viewer.ws.send(JSON.stringify({ type: "stop" }));
    record("stop por el viewer → stop_ack", !!(await waitType("stop_ack", 10_000)));
    console.log("… esperando la ingesta (hasta 180s)");
    const done = await Promise.race([
      waitType("done", 180_000),
      waitType("error", 180_000, (e) => e.fatal).then(() => null),
    ]);
    sending = false;
    clearInterval(mic);
    record("done{meetingId}", !!done?.meetingId, done?.meetingId);
    if (!done?.meetingId) report();
    created.meetingId = done.meetingId;

    const mRes = await api(`/meetings/${project}/${done.meetingId}`);
    const meeting = (await mRes.json()) as { vault_path?: string; client?: string; summary?: string };
    record("GET reunión → client phone", meeting.client === "phone", `client=${meeting.client}`);
    const md0 = meeting.vault_path ? await readFile(meeting.vault_path, "utf8") : "";
    record("acta: frontmatter client: phone", /^client: phone$/m.test(md0));

    // 6. Completar con el archivo del teléfono — hueco ≥3 s → re-ingesta sobre la MISMA acta.
    const file = await speechAac(tmp);
    const up1 = `sim-phone-${Date.now()}-a`;
    created.uploadIds.add(up1);
    const r1 = await phoneUpload(file, {
      id: up1,
      project,
      client: "phone",
      liveSessionId: snap.id,
      gapMs: 5_200,
      durationSec: 20,
    });
    if (r1.jobId) created.jobIds.add(r1.jobId);
    record("complete repetido → mismo job", !!r1.jobId && r1.jobId === r1.again, `${r1.jobId} / ${r1.again}`);
    console.log("… esperando la re-ingesta (STT batch + análisis, hasta 300s)");
    const j1 = await waitJob(r1.jobId!, 300_000);
    record(
      "hueco 5,2 s → job done, outcome reingested, MISMO meetingId",
      j1.status === "done" && j1.outcome === "reingested" && j1.meetingId === done.meetingId,
      `status=${j1.status} outcome=${j1.outcome} meetingId=${j1.meetingId} ${j1.error ?? j1.note ?? ""}`,
    );
    const md1 = meeting.vault_path ? await readFile(meeting.vault_path, "utf8") : "";
    record("acta: constancia «Transcripción rehecha… 5 s»", /Transcripción rehecha desde el audio del teléfono: 5 s no llegaron en vivo/.test(md1));
    record("acta: conserva client phone y coach", /^client: phone$/m.test(md1) && /^coach:/m.test(md1) && md1.includes("## Coach"));
    record(
      "acta: conserva las sugerencias en vivo (si las hubo)",
      !md0.includes("## Sugerencias en vivo") || md1.includes("## Sugerencias en vivo"),
      md0.includes("## Sugerencias en vivo") ? "había sugerencias" : "la junta no tuvo sugerencias",
    );
    record("acta: la transcripción es la del archivo", /pruebas de carga|runbook/i.test(md1.split("## Transcripción")[1] ?? ""));
    const reunionesDir = meeting.vault_path ? meeting.vault_path.replace(/\/[^/]+$/, "") : "";
    const sameTitle = reunionesDir
      ? (await readdir(reunionesDir)).filter((f) => f.endsWith(".md") && f.includes(done.meetingId.slice(0, 15)))
      : [];
    record("no se creó otra acta en el vault", sameTitle.length === 1, sameTitle.join(", "));
    if (supabase) {
      await new Promise((r) => setTimeout(r, 4_000)); // el espejo es fire-and-forget
      const { data } = await supabase.from("meetings").select("meeting_id").eq("meeting_id", done.meetingId);
      record("Supabase: una sola fila (upsert)", (data ?? []).length === 1, `${(data ?? []).length} filas`);
    }

    // 7. Otra subida de la MISMA sesión (otro id) → devuelve el job existente.
    const up2 = `sim-phone-${Date.now()}-b`;
    created.uploadIds.add(up2);
    const r2 = await phoneUpload(file, { id: up2, project, client: "phone", liveSessionId: snap.id, gapMs: 0 });
    record("misma sesión, otra subida → mismo job (no otra junta)", r2.jobId === r1.jobId, `${r2.jobId}`);

    // 8. Hueco <3 s → solo adjunta. Sesión que el agente "olvidó": el índice durable manda.
    const indexPath = process.env.HERMES_LIVE_INDEX_PATH;
    if (indexPath) {
      const fakeSession = `simattach${Date.now() % 100000}`;
      const idx = JSON.parse(await readFile(indexPath, "utf8").catch(() => "{}")) as Record<string, unknown>;
      idx[fakeSession] = { status: "done", meetingId: done.meetingId, project, at: new Date().toISOString() };
      await writeFile(indexPath, JSON.stringify(idx, null, 2));
      const up3 = `sim-phone-${Date.now()}-c`;
      created.uploadIds.add(up3);
      const r3 = await phoneUpload(file, { id: up3, project, client: "phone", liveSessionId: fakeSession, gapMs: 800 });
      if (r3.jobId) created.jobIds.add(r3.jobId);
      const j3 = await waitJob(r3.jobId!, 60_000);
      record(
        "hueco 0,8 s (sesión solo en el índice) → attached al mismo meetingId",
        j3.status === "done" && j3.outcome === "attached" && j3.meetingId === done.meetingId && j3.audioOnServer === true,
        `status=${j3.status} outcome=${j3.outcome} meetingId=${j3.meetingId}`,
      );
      const md3 = meeting.vault_path ? await readFile(meeting.vault_path, "utf8") : "";
      record("acta: audio_job del adjunto en el frontmatter", md3.includes(`audio_job: ${r3.jobId}`));
    } else {
      record("adjuntar (hueco <3 s) — omitido: corre el agente con HERMES_LIVE_INDEX_PATH", true);
    }
    audio.ws.close();
    viewer.ws.close();
    phone3.ws.close();
  } finally {
    // Limpieza: nada de esta simulación queda en el historial ni en ~/.hermes-os.
    if (created.meetingId) {
      await new Promise((r) => setTimeout(r, 3_000)); // espejos en vuelo antes de borrar
      const mRes = await api(`/meetings/${project}/${created.meetingId}`).catch(() => null);
      const m = mRes?.ok ? ((await mRes.json()) as { vault_path?: string }) : {};
      if (m.vault_path) await unlink(m.vault_path).catch(() => undefined);
      if (supabase)
        await supabase.from("meetings").delete().eq("meeting_id", created.meetingId).eq("project_slug", project);
    }
    const hermes = join(homedir(), ".hermes-os");
    const audioDir = join(hermes, "audio-juntas");
    for (const jobId of created.jobIds) {
      await unlink(join(hermes, "meeting-jobs", `${jobId}.json`)).catch(() => undefined);
      for (const f of await readdir(audioDir).catch(() => [] as string[]))
        if (f.replace(/\.[^.]+$/, "").endsWith(`-${jobId}`)) await unlink(join(audioDir, f)).catch(() => undefined);
      for (const f of await readdir(join(hermes, "transcripciones-pendientes")).catch(() => [] as string[]))
        if (f.includes(jobId)) await unlink(join(hermes, "transcripciones-pendientes", f)).catch(() => undefined);
    }
    const uploadsDir = process.env.HERMES_MEETING_UPLOADS_DIR || join(hermes, "meeting-uploads");
    for (const id of created.uploadIds) await rm(join(uploadsDir, id), { recursive: true, force: true });
    await rm(tmp, { recursive: true, force: true });
    if (created.meetingId) record("limpieza: acta, Supabase, jobs, audios y subidas borrados", true);
  }
  report();
}

main().catch((err) => {
  console.error("simulador reventó:", err);
  process.exit(1);
});
