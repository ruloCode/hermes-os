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
 *
 * Secuencia validada: start REST → WS → hello → transcript_partial* →
 * transcript_final* → suggestion (Agent SDK real, ~60s) → rename →
 * speakers_renamed → stop → stop_ack → done → asserts del .md final.
 * Imprime un reporte PASS/FAIL por assert; exit code 1 si algo falló.
 */
import { readFile } from "node:fs/promises";
import WebSocket from "ws";
import type { LiveMeetingSnapshot, LiveServerEvent } from "@hermes/shared";
import { env } from "../src/env.js";

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

function report(): never {
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

main().catch((err) => {
  console.error("simulador reventó:", err);
  process.exit(1);
});
