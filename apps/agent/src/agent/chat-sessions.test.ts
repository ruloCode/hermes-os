/**
 * Contratos de la sesión viva del chat (chat-sessions.ts) contra un Query
 * FALSO: sin CLI, sin tokens. Cada test cubre un hallazgo de la revisión.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Options, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { CHAT_MAX_TURNS, chatToolDenial, reuseDecision } from "./chat-session-policy.js";
import { closeAllChatSessions, liveChatTiming, runLiveChatTurn, setLiveChatQueryFactory, type LiveChatSpec } from "./chat-sessions.js";

interface Made {
  options: Options;
  closed: boolean;
  interrupts: number;
  release(): void;
}

/** Un CLI de mentira: `hold` retiene los resultados hasta release(); `hang` nunca responde. */
function fake(mode: (index: number) => { hold?: boolean; hang?: boolean; ignoreInterrupt?: boolean; fail?: boolean }) {
  const made: Made[] = [];
  setLiveChatQueryFactory(((input: AsyncIterable<SDKUserMessage>, options: Options) => {
    const m = mode(made.length);
    const out: unknown[] = [];
    const held: unknown[] = [];
    let wake: (() => void) | null = null;
    const push = (x: unknown) => {
      out.push(x);
      wake?.();
    };
    const rec: Made = {
      options,
      closed: false,
      interrupts: 0,
      release: () => {
        while (held.length) push(held.shift());
      },
    };
    made.push(rec);
    let n = 0;
    void (async () => {
      for await (const _msg of input) {
        n += 1;
        if (n === 1) push({ type: "system", subtype: "init", session_id: options.resume ?? `sid-${made.indexOf(rec) + 1}` });
        if (m.hang) continue;
        const res = [
          { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hola" } } },
          { type: "result", subtype: m.fail ? "error_max_turns" : "success", result: "hola" },
        ];
        if (m.hold) held.push(...res);
        else res.forEach(push);
      }
    })();
    return {
      async next() {
        while (!out.length) {
          if (rec.closed) return { done: true, value: undefined };
          await new Promise<void>((r) => (wake = r));
        }
        return { done: false, value: out.shift() };
      },
      async return() {
        rec.closed = true;
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
      async interrupt() {
        rec.interrupts += 1;
        if (!m.ignoreInterrupt) push({ type: "result", subtype: "error_during_execution" });
      },
      close() {
        rec.closed = true;
        wake?.();
      },
    } as never;
  }) as never);
  return made;
}

function sink() {
  const ids: string[] = [];
  const announce = (id: string) => void (ids.includes(id) || ids.push(id));
  // Como el TurnCollector de session.ts: el `init` anuncia la sesión.
  const handle = (m: unknown) => {
    const x = m as { type?: string; subtype?: string; session_id?: string };
    if (x.type === "system" && x.subtype === "init" && x.session_id) announce(x.session_id);
    return x.type === "result";
  };
  return { ids, handle, announce };
}

function spec(clientId: string, over: Partial<LiveChatSpec> = {}): LiveChatSpec {
  return {
    clientId,
    profile: "chat-web",
    model: "claude-sonnet-5-5",
    fresh: false,
    meta: {},
    options: (resume) => ({ ...(resume ? { resume } : {}), maxTurns: CHAT_MAX_TURNS }),
    ...over,
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));
const timing = { ...liveChatTiming };

after(() => {
  closeAllChatSessions();
  setLiveChatQueryFactory(null);
  Object.assign(liveChatTiming, timing);
});

test("hallazgo 2: con la sesión respondiendo, pedir OTRA conversación no entra en su cola", async () => {
  const made = fake((i) => ({ hold: i === 0 }));
  const a = sink();
  const first = runLiveChatTurn(spec("qa-h2"), "uno", a);
  await tick();
  const b = sink();
  const second = await runLiveChatTurn(spec("qa-h2", { resume: "otra-conversacion" }), "dos", b);
  assert.equal(second, "ok", "el mensaje nuevo no espera a la sesión vieja");
  assert.equal(made.length, 2, "se abrió otra sesión");
  assert.equal(made[1].options.resume, "otra-conversacion");
  assert.deepEqual(b.ids, ["otra-conversacion"], "la pestaña adopta la conversación pedida, no la vieja");
  made[0].release();
  assert.equal(await first, "ok", "lo que ya corría termina");
  await tick();
  assert.equal(made[0].closed, true, "la sesión reemplazada se cierra al vaciar su cola");
});

test("hallazgo 2: «conversación nueva» con la sesión ocupada abre una sin resume", async () => {
  const made = fake((i) => ({ hold: i === 0 }));
  const first = runLiveChatTurn(spec("qa-h2b"), "uno", sink());
  await tick();
  assert.equal(await runLiveChatTurn(spec("qa-h2b", { fresh: true }), "nuevo", sink()), "ok");
  assert.equal(made.length, 2);
  assert.equal(made[1].options.resume, undefined);
  made[0].release();
  await first;
});

test("hallazgo 2: retomar la MISMA conversación que una sesión que se cierra espera a que termine (no bifurca)", async () => {
  const made = fake((i) => ({ hold: i === 0 }));
  const first = runLiveChatTurn(spec("qa-h2c", { project: "a" }), "uno", sink());
  await tick();
  let done = false;
  const second = runLiveChatTurn(spec("qa-h2c", { project: "b", resume: "sid-1" }), "dos", sink()).then((o) => ((done = true), o));
  await tick();
  assert.equal(done, false, "no arranca mientras la vieja lleva ese hilo");
  assert.equal(made.length, 1);
  made[0].release();
  assert.equal(await first, "ok");
  assert.equal(await second, "ok");
  assert.equal(made[0].closed, true);
  assert.equal(made[1].options.resume, "sid-1");
});

test("hallazgo 3: un turno detenido que nunca cierra no traba la cola: se cierra la sesión y vale como detenido", async () => {
  liveChatTiming.abortGraceMs = 40;
  const made = fake(() => ({ hang: true, ignoreInterrupt: true }));
  const ac = new AbortController();
  const p = runLiveChatTurn(spec("qa-h3"), "uno", sink(), ac.signal);
  await tick();
  ac.abort();
  assert.equal(await p, "aborted");
  assert.equal(made[0].interrupts, 1);
  assert.equal(made[0].closed, true);
  Object.assign(liveChatTiming, timing);
});

test("hallazgo 3: un turno colgado sin Detener tiene tope duro", async () => {
  liveChatTiming.turnMaxMs = 60;
  const made = fake(() => ({ hang: true }));
  assert.equal(await runLiveChatTurn(spec("qa-h3b"), "uno", sink()), "failed");
  assert.equal(made[0].closed, true);
  Object.assign(liveChatTiming, timing);
});

test("hallazgo 4: un turno fallido cierra la sesión viva antes de devolver (el reintento de una vuelta no bifurca)", async () => {
  const made = fake(() => ({ fail: true }));
  assert.equal(await runLiveChatTurn(spec("qa-h4"), "uno", sink()), "failed");
  assert.equal(made[0].closed, true);
});

test("hallazgo 5: en el chat se niega Bash en segundo plano con un motivo; el resto pasa", () => {
  assert.match(chatToolDenial("Bash", { command: "sleep 100", run_in_background: true }) ?? "", /segundo plano/);
  assert.equal(chatToolDenial("Bash", { command: "date" }), null);
  assert.equal(chatToolDenial("Read", { file_path: "/x", run_in_background: true }), null);
});

test("hallazgo 6: la sesión viva no sube el tope de vueltas: viaja el de cada mensaje", async () => {
  const made = fake(() => ({}));
  assert.equal(await runLiveChatTurn(spec("qa-h6"), "uno", sink()), "ok");
  assert.equal(made[0].options.maxTurns, CHAT_MAX_TURNS);
  assert.equal(CHAT_MAX_TURNS, 40);
});

test("reuseDecision no mira si está ocupada: solo la conversación", () => {
  const liveS = { closed: false, sdkSessionId: "s-1" };
  assert.equal(reuseDecision(undefined, undefined, false), "create");
  assert.equal(reuseDecision({ ...liveS, closed: true }, undefined, false), "create");
  assert.equal(reuseDecision(liveS, "s-1", false), "reuse");
  assert.equal(reuseDecision(liveS, "s-2", false), "replace");
  assert.equal(reuseDecision(liveS, undefined, true), "replace");
});
