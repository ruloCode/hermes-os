"use client";

// UN PROBLEMA DEL DOJO: el método completo, no solo el editor.
//   1 Entender  → con tus palabras qué entra y qué sale + un caso que lo rompa
//   2 Planear   → el enfoque en una o dos frases, ANTES de escribir
//   3 Escribir  → el editor se abre aquí (antes queda bloqueado a propósito)
//   4 Probar    → ejemplos (⌘↵) o todos los casos, ocultos incluidos (⌘⇧↵)
//   5 Reflexionar → complejidad de tu solución + lo que aprendiste; recién ahí
//                   se ve la solución de referencia
//
// Hermes no escribe código: revisa si entendiste, cuestiona el plan y explica
// por qué falla un caso. Las pistas suben por escalones y se piden con clic.
// En los problemas "sin ayuda" y en la prueba no hay pistas: rendirse las
// muestra junto a la solución y deja el problema en tu repaso.

import { useEffect, useRef, useState } from "react";
import {
  BIG_O,
  DOJO_KIND_LABEL,
  pyCall,
  pyRepr,
  starterCode,
  testSpec,
  type BigO,
  type DojoCaseResult,
  type DojoCoachFeedback,
  type DojoCoachStage,
  type DojoItem,
  type DojoItemView,
} from "@hermes/shared";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Kbd } from "@/components/ui/Kbd";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { runTests, type TestOutcome } from "@/lib/dojo/python";
import { usePythonStatus } from "@/hooks/usePython";
import type { AttemptInput, CoachInput, TypingInput } from "@/hooks/useDojo";
import { CodeEditor } from "./CodeEditor";
import { Prose, inline } from "./Prose";
import { PyErrorBox, Stdout } from "./RunOutput";
import { TypeOver } from "./TypeOver";
import { LivePanel } from "./LivePanel";
import { Segmented } from "@/components/ui/Segmented";
import { DojoFigure, hasDojoFigure } from "./figures/DojoFigure";

export interface DojoPrefs {
  vim: boolean;
  fontSize: number;
}

type CoachState = { loading: true } | { feedback: DojoCoachFeedback } | { error: string };
type RunState = { mode: "ejemplos" | "enviar"; total: number; live: DojoCaseResult[]; outcome: TestOutcome | null };

const STEPS = ["Entender", "Planear", "Escribir", "Probar", "Reflexionar"];
const HINT_LABEL = ["Reformular", "Un caso a mano", "El patrón", "Pseudocódigo"];
const ms = (n: number) => `${Math.round(n).toLocaleString("es-CO")} ms`;
const mmss = (n: number) => {
  const s = Math.round(n / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};

function readDraft(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeDraft(key: string, code: string) {
  try {
    localStorage.setItem(key, code);
  } catch {
    /* sin storage: el borrador dura lo que dure la pestaña */
  }
}

function Card({
  step,
  title,
  done,
  children,
  right,
}: {
  step?: number;
  title: string;
  done?: boolean;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="rounded-md border border-line bg-panel p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium text-text">
          {step != null && (
            <span
              className={`grid h-5 w-5 place-items-center rounded-full text-2xs ${
                done ? "bg-green/15 text-green" : "bg-selected text-text-dim"
              }`}
            >
              {done ? "✓" : step}
            </span>
          )}
          {title}
        </h3>
        {right}
      </header>
      {children}
    </section>
  );
}

const FIELD =
  "w-full resize-y rounded-sm border border-line bg-bg px-3 py-2 text-sm leading-relaxed text-text placeholder:text-text-faint focus:border-accent focus:outline-none";

function CoachReply({ state }: { state: CoachState | undefined }) {
  if (!state) return null;
  if ("loading" in state) return <p className="mt-3 text-sm text-text-faint">Hermes está leyendo…</p>;
  if ("error" in state) return <p className="mt-3 text-sm text-amber">{state.error}</p>;
  const f = state.feedback;
  const tone = f.verdict === "bien" ? "bg-green" : f.verdict === "casi" ? "bg-amber" : "bg-red";
  return (
    <div className="mt-3 rounded-sm border border-line bg-panel-2 px-3 py-2.5">
      <p className="flex items-center gap-2 text-xs text-text-faint">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone}`} />
        Hermes · {f.verdict === "bien" ? "vas bien" : f.verdict === "casi" ? "casi" : "hay algo que no cuadra"}
      </p>
      <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-text">{inline(f.message)}</p>
      {f.question && <p className="mt-1.5 text-sm text-text-dim italic">{inline(f.question)}</p>}
    </div>
  );
}

function CaseRow({ r }: { r: DojoCaseResult }) {
  return (
    <li className="border-b border-line px-4 py-2.5 last:border-b-0">
      <p className="flex items-start gap-2">
        <span aria-hidden className={`mt-0.5 w-4 shrink-0 text-sm ${r.ok ? "text-green" : "text-red"}`}>
          {r.ok ? "✓" : "✗"}
        </span>
        <span className="min-w-0 flex-1 font-mono text-sm break-all text-text">{r.call}</span>
        <span className="shrink-0 text-xs text-text-faint tabular-nums">{ms(r.ms)}</span>
      </p>
      {!r.ok && (
        <div className="mt-2 ml-6 flex flex-col gap-2">
          {r.slow ? (
            <p className="text-sm text-amber">
              Da la respuesta, pero tarda demasiado para este tamaño. Hace falta otra idea, no un truco: piensa en la
              complejidad.
            </p>
          ) : r.error ? (
            <PyErrorBox error={r.error} />
          ) : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-sm">
              <dt className="font-sans text-text-faint">Esperado</dt>
              <dd className="break-all text-text">{r.expected}</dd>
              <dt className="font-sans text-text-faint">Obtuviste</dt>
              <dd className="break-all text-red">{r.got}</dd>
            </dl>
          )}
        </div>
      )}
      {r.stdout && (
        <div className="mt-2 ml-6">
          <Stdout text={r.stdout} label="Imprimiste" />
        </div>
      )}
    </li>
  );
}

function Results({
  run,
  canDebug,
  onDebug,
  debug,
}: {
  run: RunState;
  canDebug: boolean;
  onDebug: (r: DojoCaseResult) => void;
  debug: CoachState | undefined;
}) {
  const o = run.outcome;
  const list = o?.kind === "ok" && o.run.phase === "done" ? o.run.results : o?.kind === "timeout" ? o.results : run.live;
  const firstFail = list.find((r) => !r.ok);
  const passed = list.filter((r) => r.ok).length;
  const allOk = o?.kind === "ok" && o.run.phase === "done" && passed === run.total;

  let head: React.ReactNode = null;
  if (!o) head = <p className="text-sm text-text-dim">Corriendo… {list.length} de {run.total}</p>;
  else if (o.kind === "error") head = <p className="text-sm text-amber">{o.message}</p>;
  else if (o.kind === "timeout")
    head = (
      <p className="text-sm text-red">
        {o.index != null ? `El caso ${o.index + 1}` : "Tu código"} no terminó en {o.seconds} s y lo corté. ¿Un bucle que
        no acaba, o una solución demasiado lenta para ese tamaño?
      </p>
    );
  else if (o.run.phase === "syntax") head = <PyErrorBox error={o.run.error} />;
  else if (o.run.phase === "load") head = <PyErrorBox error={o.run.error} />;
  else if (o.run.phase === "banned")
    head = (
      <p className="text-sm text-red">
        Línea {o.run.line}: este ejercicio pide hacerlo sin <code className="font-mono">{o.run.banned}</code>. La idea es
        construirlo tú.
      </p>
    );
  else if (o.run.phase === "missing")
    head = (
      <p className="text-sm text-red">
        No encuentro la función <code className="font-mono">{o.run.fn}</code>. Los tests la llaman por ese nombre: no lo
        cambies.
      </p>
    );
  else
    head = (
      <p className={`text-sm ${allOk ? "text-green" : "text-text"}`}>
        {allOk
          ? run.mode === "ejemplos"
            ? "Los ejemplos pasan. Enviar corre también los casos ocultos."
            : "Todos los casos pasan."
          : `${passed} de ${run.total} casos pasan.`}
      </p>
    );

  const loadOut = o?.kind === "ok" && o.run.phase !== "syntax" && o.run.phase !== "banned" ? o.run.stdout : "";

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="min-w-0 flex-1">{head}</div>
        {firstFail && o && canDebug && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onDebug(firstFail)}
            disabled={Boolean(debug && "loading" in debug)}
          >
            ¿Por qué falla? · Hermes
          </Button>
        )}
      </div>
      {debug && (
        <div className="px-4 pb-1">
          <CoachReply state={debug} />
        </div>
      )}
      {loadOut && (
        <div className="px-4 pt-2.5">
          <Stdout text={loadOut} label="Imprimiste al cargar" />
        </div>
      )}
      {list.length > 0 && <ul className="flex flex-col">{list.map((r) => <CaseRow key={r.index} r={r} />)}</ul>}
    </div>
  );
}

export function ProblemWorkspace({
  item,
  view,
  review,
  prefs,
  setPrefs,
  onSave,
  onTyping,
  askCoach,
  next,
  onNext,
}: {
  item: DojoItem;
  view: DojoItemView | undefined;
  review: boolean;
  prefs: DojoPrefs;
  setPrefs: (p: DojoPrefs) => void;
  onSave: (input: AttemptInput) => Promise<{ ok: boolean; error?: string }>;
  onTyping: (input: TypingInput) => void;
  askCoach: (
    input: CoachInput,
  ) => Promise<{ ok: true; feedback: DojoCoachFeedback } | { ok: false; error: string }>;
  next: DojoItem | null;
  onNext: () => void;
}) {
  const p = item.problem!;
  const guided = item.kind === "guiado";
  const draftKey = `hermes-dojo-code:${item.id}${review ? ":repaso" : ""}`;
  const status = usePythonStatus();

  const [code, setCode] = useState(() => (review ? null : readDraft(draftKey)) ?? starterCode(p));
  const [understanding, setUnderstanding] = useState("");
  const [edgeCase, setEdgeCase] = useState("");
  const [understood, setUnderstood] = useState(review);
  const [plan, setPlan] = useState("");
  const [planned, setPlanned] = useState(review);
  const [hints, setHints] = useState(0);
  const [helped, setHelped] = useState(false);
  const [run, setRun] = useState<RunState | null>(null);
  // Debajo del editor: la máquina con tu código en vivo, o el resultado de las pruebas.
  const [pane, setPane] = useState<"vivo" | "pruebas">("vivo");
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [passedMs, setPassedMs] = useState<number | null>(null);
  const [tests, setTests] = useState<{ passed: number; total: number } | null>(null);
  const [guess, setGuess] = useState<BigO | null>(null);
  const [learned, setLearned] = useState("");
  const [finished, setFinished] = useState<null | "passed" | "gaveUp">(null);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [coach, setCoach] = useState<Partial<Record<DojoCoachStage, CoachState>>>({});
  const openedAt = useRef<number | null>(null);
  const editorWrap = useRef<HTMLDivElement>(null);
  const [retype, setRetype] = useState<null | "guia" | "memoria">(null);
  const [retyped, setRetyped] = useState<string | null>(null);

  const editorOpen = understood && planned;
  useEffect(() => {
    if (editorOpen && openedAt.current == null) openedAt.current = Date.now();
    // Se abre el editor → el cursor ya está ahí: a escribir sin tocar el mouse.
    if (editorOpen) editorWrap.current?.querySelector<HTMLElement>(".cm-content")?.focus();
  }, [editorOpen]);

  // ⌘↵ dentro de Entender/Planear = "Listo".
  const submitOn = (ok: boolean, go: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (ok) go();
    }
  };
  const canUnderstand = understanding.trim().length >= 10 && edgeCase.trim().length >= 2;
  const canPlan = plan.trim().length >= 10;
  useEffect(() => {
    if (!review) writeDraft(draftKey, code);
  }, [code, draftKey, review]);

  const running = run != null && run.outcome == null;
  const stepIdx = !understood ? 0 : !planned ? 1 : !run ? 2 : passedMs == null && !finished ? 3 : 4;
  const visible = p.cases.filter((c) => !c.hidden);
  const hiddenCount = p.cases.length - visible.length;
  const hintsOpen = guided || finished != null;

  // Línea a marcar: la del error de sintaxis/carga/prohibido o la del primer caso que revienta.
  const o = run?.outcome;
  const errorLine =
    o?.kind === "ok"
      ? o.run.phase === "syntax" || o.run.phase === "load"
        ? o.run.error.line
        : o.run.phase === "banned"
          ? o.run.line
          : o.run.phase === "done"
            ? (o.run.results.find((r) => r.error?.line)?.error?.line ?? null)
            : null
      : null;

  const runCases = async (mode: "ejemplos" | "enviar") => {
    if (!editorOpen || running) return;
    const spec = testSpec(p, mode === "ejemplos");
    setCoach((c) => ({ ...c, debug: undefined }));
    setRun({ mode, total: spec.cases.length, live: [], outcome: null });
    setPane("pruebas");
    const outcome = await runTests(code, spec, (r) =>
      setRun((prev) => (prev && !prev.outcome ? { ...prev, live: [...prev.live, r] } : prev)),
    );
    setRun({ mode, total: spec.cases.length, live: [], outcome });
    if (mode === "enviar" && outcome.kind === "ok" && outcome.run.phase === "done") {
      const passed = outcome.run.results.filter((r) => r.ok).length;
      setTests({ passed, total: spec.cases.length });
      if (passed === spec.cases.length && passedMs == null)
        setPassedMs(Date.now() - (openedAt.current ?? Date.now()));
    }
  };

  const ask = async (stage: DojoCoachStage, failing?: DojoCaseResult) => {
    if (stage !== "entender") setHelped(true);
    setCoach((c) => ({ ...c, [stage]: { loading: true } }));
    const r = await askCoach({
      itemId: item.id,
      stage,
      understanding: understanding || undefined,
      edgeCase: edgeCase || undefined,
      plan: plan || undefined,
      code: stage === "entender" ? undefined : code,
      failing: failing
        ? {
            call: failing.call,
            expected: failing.expected,
            got: failing.got,
            error: failing.error ? `${failing.error.type}: ${failing.error.message} (línea ${failing.error.line ?? "?"})` : failing.slow ? `tardó ${ms(failing.ms)}` : null,
          }
        : undefined,
    });
    setCoach((c) => ({ ...c, [stage]: r.ok ? { feedback: r.feedback } : { error: r.error } }));
  };

  // Pedirle a Hermes que cuestione el plan o explique un fallo cuenta como una
  // pista: "sin pistas" tiene que significar que lo resolviste solo.
  const hintsUsed = Math.max(hints, helped ? 1 : 0);
  const notes = [understanding, edgeCase && `Caso que lo rompe: ${edgeCase}`].filter(Boolean).join("\n");

  const savePass = async () => {
    setSaving(true);
    setSaveError(null);
    const r = await onSave({
      itemId: item.id,
      passed: true,
      hints: hintsUsed,
      review,
      ms: passedMs ?? undefined,
      tests: tests ?? undefined,
      code,
      understanding: notes || undefined,
      plan: plan || undefined,
      learned: learned || undefined,
      guessedTime: guess ?? undefined,
    });
    setSaving(false);
    if (!r.ok) setSaveError(r.error ?? "No se guardó.");
    setFinished("passed");
  };

  const giveUp = async () => {
    setSaving(true);
    setSaveError(null);
    const r = await onSave({
      itemId: item.id,
      passed: false,
      gaveUp: true,
      hints: hintsUsed,
      review,
      code,
      understanding: notes || undefined,
      plan: plan || undefined,
    });
    setSaving(false);
    if (!r.ok) setSaveError(r.error ?? "No se guardó.");
    setConfirmGiveUp(false);
    setFinished("gaveUp");
  };

  const canDebug = guided || finished != null;

  return (
    <div className="grid min-h-0 flex-1 gap-4 max-lg:auto-rows-min max-lg:overflow-y-auto lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
      {/* ── Izquierda: enunciado + el método ── */}
      <ScrollArea fade="y" className="min-h-0">
        <div className="flex flex-col gap-4 pr-1 pb-10">
          <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs">
            {STEPS.map((s, i) => (
              <li key={s} className="flex items-center gap-1">
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    i === stepIdx
                      ? "bg-accent-solid text-on-accent"
                      : i < stepIdx
                        ? "text-green"
                        : "text-text-faint"
                  }`}
                >
                  {i + 1} {s}
                </span>
                {i < STEPS.length - 1 && <span aria-hidden className="text-text-faint">·</span>}
              </li>
            ))}
          </ol>

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm">{DOJO_KIND_LABEL[item.kind]}</Badge>
              {review && (
                <Badge size="sm" tone="accent">
                  Repaso: desde cero
                </Badge>
              )}
              {p.timeLimitMs && <Badge size="sm">Límite {ms(p.timeLimitMs)} por caso</Badge>}
              {view?.clean && <Badge size="sm" tone="green">Ya lo resolviste sin pistas</Badge>}
            </div>
            {p.statement.map((s, i) => (
              <Prose key={i} text={s} />
            ))}
            <div className="mt-1 flex flex-col gap-1">
              <p className="text-xs text-text-faint">
                Ejemplos{hiddenCount > 0 ? ` · al enviar corren ${hiddenCount} casos más que no ves` : ""}
              </p>
              {visible.map((c, i) => (
                <p key={i} className="rounded-sm bg-panel-2 px-3 py-1.5 font-mono text-sm break-all text-text">
                  {pyCall(p.fn, c.args ?? [])} <span className="text-text-faint">→</span> {pyRepr(c.expected)}
                </p>
              ))}
            </div>
          </section>

          {hasDojoFigure(item.id) && <DojoFigure itemId={item.id} reveal={finished != null} />}

          {/* 1 · Entender */}
          <Card
            step={1}
            title="Entender"
            done={understood}
            right={
              understood && !review ? (
                <Button variant="ghost" size="xs" onClick={() => setUnderstood(false)}>
                  Editar
                </Button>
              ) : undefined
            }
          >
            {understood ? (
              review ? (
                <p className="text-sm text-text-faint">Es un repaso: ya lo entendiste antes. Escríbelo desde cero.</p>
              ) : (
                <p className="text-sm whitespace-pre-line text-text-dim">{notes}</p>
              )
            ) : (
              <div className="flex flex-col gap-2.5">
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-text-dim">Con tus palabras: ¿qué entra y qué tienes que devolver?</span>
                  <textarea
                    className={FIELD}
                    rows={3}
                    value={understanding}
                    onChange={(e) => setUnderstanding(e.target.value)}
                    onKeyDown={submitOn(canUnderstand, () => setUnderstood(true))}
                    placeholder="Me dan… y devuelvo…"
                    autoFocus
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-text-dim">Un caso que podría romper una solución descuidada</span>
                  <input
                    className={FIELD}
                    value={edgeCase}
                    onChange={(e) => setEdgeCase(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canUnderstand) {
                        e.preventDefault();
                        setUnderstood(true);
                      }
                    }}
                    placeholder="Lista vacía, un solo elemento, negativos…"
                  />
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="sm" disabled={!canUnderstand} onClick={() => setUnderstood(true)}>
                    Listo, a planear <span className="ml-1 text-2xs text-on-accent/75">↵</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={understanding.trim().length < 10 || Boolean(coach.entender && "loading" in coach.entender)}
                    onClick={() => void ask("entender")}
                  >
                    ¿Lo entendí? · Hermes
                  </Button>
                </div>
              </div>
            )}
            {!understood && <CoachReply state={coach.entender} />}
          </Card>

          {/* 2 · Planear */}
          {understood && (
            <Card
              step={2}
              title="Planear"
              done={planned}
              right={
                planned && !review ? (
                  <Button variant="ghost" size="xs" onClick={() => setPlanned(false)}>
                    Editar
                  </Button>
                ) : undefined
              }
            >
              {planned ? (
                review ? (
                  <p className="text-sm text-text-faint">Sin plan escrito en el repaso: que salga de memoria.</p>
                ) : (
                  <p className="text-sm whitespace-pre-line text-text-dim">{plan}</p>
                )
              ) : (
                <div className="flex flex-col gap-2.5">
                  <label className="flex flex-col gap-1">
                    <span className="text-sm text-text-dim">
                      Tu enfoque en una o dos frases, o pseudocódigo. Todavía sin Python.
                    </span>
                    <textarea
                      className={FIELD}
                      rows={4}
                      value={plan}
                      onChange={(e) => setPlan(e.target.value)}
                      onKeyDown={submitOn(canPlan, () => setPlanned(true))}
                      placeholder="Recorro… y voy guardando…"
                      autoFocus
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" disabled={!canPlan} onClick={() => setPlanned(true)}>
                      Listo, a escribir <span className="ml-1 text-2xs text-on-accent/75">⌘↵</span>
                    </Button>
                    {guided && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={plan.trim().length < 10 || Boolean(coach.plan && "loading" in coach.plan)}
                        onClick={() => void ask("plan")}
                        title="Cuenta como una pista"
                      >
                        Cuestiona mi plan · Hermes
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {!planned && <CoachReply state={coach.plan} />}
            </Card>
          )}

          {/* Pistas / sin ayuda */}
          {editorOpen && (
            <Card
              title={hintsOpen ? "Pistas" : "Sin pistas"}
              right={
                hintsOpen && hints > 0 ? (
                  <span className="text-xs text-text-faint">
                    {hints} de 4{finished == null ? " · cuentan en tu registro" : ""}
                  </span>
                ) : undefined
              }
            >
              {hintsOpen ? (
                <div className="flex flex-col gap-2">
                  {p.hints.slice(0, finished ? 4 : hints).map((h, i) => (
                    <div key={i} className="rounded-sm bg-panel-2 px-3 py-2">
                      <p className="text-xs text-text-faint">
                        {i + 1} · {HINT_LABEL[i]}
                      </p>
                      <p className="mt-0.5 text-sm leading-relaxed text-text">{inline(h)}</p>
                    </div>
                  ))}
                  {!finished && hints < 4 && (
                    <Button variant="secondary" size="sm" className="self-start" onClick={() => setHints((h) => h + 1)}>
                      Pista {hints + 1}: {HINT_LABEL[hints].toLowerCase()}
                    </Button>
                  )}
                  {!finished && hints === 0 && (
                    <p className="text-xs text-text-faint">Intenta primero sin ellas: cada una queda en tu registro.</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-text-dim">
                  {item.kind === "prueba"
                    ? "Es la prueba de la unidad: va sin pistas, y Hermes solo te dice si entendiste el enunciado. Si la pasas, la unidad queda dominada."
                    : "Este va sin pistas, y Hermes solo te dice si entendiste el enunciado: es para comprobar que el patrón ya es tuyo."}
                </p>
              )}
              {!finished && (
                <div className="mt-3 border-t border-line pt-3">
                  {confirmGiveUp ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="w-full text-sm text-text-dim">
                        Verás todas las pistas y la solución, y el problema vuelve a tu repaso mañana para reescribirlo
                        desde cero.
                      </p>
                      <Button variant="danger" size="sm" onClick={() => void giveUp()} disabled={saving}>
                        Sí, me rindo
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmGiveUp(false)}>
                        Sigo intentando
                      </Button>
                    </div>
                  ) : (
                    <Button variant="ghost" size="xs" onClick={() => setConfirmGiveUp(true)}>
                      Me rindo
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* 5 · Reflexionar */}
          {passedMs != null && !finished && (
            <Card step={5} title="Reflexionar">
              <div className="flex flex-col gap-3">
                <p className="text-sm text-text">
                  <span className="text-green">Pasó todo</span> en {mmss(passedMs)}
                  {hintsUsed > 0 ? ` con ${hintsUsed} ${hintsUsed === 1 ? "pista" : "pistas"}` : ", sin pistas"}.
                </p>
                <div>
                  <p className="mb-1.5 text-sm text-text-dim">¿Qué complejidad de tiempo tiene TU solución?</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup">
                    {BIG_O.map((b) => (
                      <button
                        key={b}
                        type="button"
                        role="radio"
                        aria-checked={guess === b}
                        onClick={() => setGuess(b)}
                        className={`cursor-pointer rounded-sm border px-2.5 py-1 font-mono text-sm transition-colors ${
                          guess === b
                            ? "border-accent bg-selected text-text"
                            : "border-line text-text-dim hover:border-line-2 hover:text-text"
                        }`}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-sm text-text-dim">Lo que aprendiste, en una línea</span>
                  <input
                    className={FIELD}
                    value={learned}
                    onChange={(e) => setLearned(e.target.value)}
                    placeholder="Que…"
                  />
                </label>
                <Button variant="primary" size="sm" className="self-start" disabled={!guess || saving} onClick={() => void savePass()}>
                  {saving ? "Guardando…" : "Guardar y ver la solución de referencia"}
                </Button>
              </div>
            </Card>
          )}

          {/* Solución de referencia: solo después de pasar o rendirse */}
          {finished && (
            <Card title="Solución de referencia">
              <div className="flex flex-col gap-3">
                {saveError && <p className="text-sm text-amber">No se guardó el intento: {saveError}</p>}
                {finished === "passed" && guess && (
                  <p className="text-sm text-text-dim">
                    Dijiste <span className="font-mono text-text">{guess}</span> · la de referencia es{" "}
                    <span className="font-mono text-text">{p.complexity.time}</span>
                    {guess === p.complexity.time ? <span className="text-green"> · coinciden</span> : null}
                  </p>
                )}
                {retype ? (
                  <TypeOver
                    key={retype}
                    code={p.solution}
                    blind={retype === "memoria"}
                    fontSize={prefs.fontSize - 1}
                    autoFocus
                    onDone={(r) => {
                      onTyping({ itemId: item.id, source: "solucion", ...r });
                      setRetyped(retype);
                      setRetype(null);
                    }}
                  />
                ) : (
                  <div className="overflow-hidden rounded-sm border border-line">
                    <CodeEditor value={p.solution} readOnly fontSize={prefs.fontSize - 1} />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-text-dim">
                    {retyped
                      ? retyped === "memoria"
                        ? "La escribiste de memoria."
                        : "Ya la tecleaste. ¿Ahora de memoria?"
                      : "Reescríbela con tus dedos:"}
                  </span>
                  <Button variant="secondary" size="xs" onClick={() => setRetype("guia")} disabled={retype === "guia"}>
                    Con guía
                  </Button>
                  <Button variant="secondary" size="xs" onClick={() => setRetype("memoria")} disabled={retype === "memoria"}>
                    De memoria · XP ×2
                  </Button>
                </div>
                <p className="text-sm text-text-dim">
                  <span className="font-mono text-text">
                    {p.complexity.time} tiempo · {p.complexity.space} memoria
                  </span>{" "}
                  — {p.complexity.why}
                </p>
                <p className="text-sm text-text-faint">
                  {finished === "gaveUp"
                    ? "Vuelve a tu repaso mañana. Antes de cerrar, léela línea por línea y explícatela en voz alta."
                    : hintsUsed > 0
                      ? "Como usaste ayuda, vuelve a tu repaso mañana para escribirlo sin ella."
                      : review
                        ? "Repaso limpio: si vuelve, será en más días."
                        : "Limpio: no vuelve al repaso."}
                </p>
                {next && (
                  <Button variant="primary" size="sm" className="self-start" onClick={onNext}>
                    Siguiente: {next.title}
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </ScrollArea>

      {/* ── Derecha: editor + resultados ── */}
      <section className="flex min-h-[560px] flex-col overflow-hidden rounded-md border border-line bg-panel lg:min-h-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-text-faint">
            <span className="font-mono text-text-dim">solucion.py</span>
            <span
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status === "ready" ? "bg-green" : status === "error" ? "bg-red" : status === "loading" ? "bg-amber" : "bg-text-faint"
              }`}
            />
            {status === "ready"
              ? "Python listo"
              : status === "loading"
                ? "Cargando Python…"
                : status === "error"
                  ? "Python no cargó"
                  : "Python en espera"}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              aria-pressed={prefs.vim}
              onClick={() => setPrefs({ ...prefs, vim: !prefs.vim })}
              className={prefs.vim ? "bg-selected text-text" : ""}
              title="Atajos de Vim en el editor"
            >
              Vim
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setPrefs({ ...prefs, fontSize: Math.max(12, prefs.fontSize - 1) })}
              aria-label="Letra más chica"
            >
              A−
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setPrefs({ ...prefs, fontSize: Math.min(22, prefs.fontSize + 1) })}
              aria-label="Letra más grande"
            >
              A+
            </Button>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setCode(starterCode(p))}
              disabled={!editorOpen || code === starterCode(p)}
              title="Volver al código vacío (⌘Z lo deshace)"
            >
              Reiniciar
            </Button>
            <span aria-hidden className="mx-1 h-4 w-px bg-line" />
            <Button variant="secondary" size="sm" onClick={() => void runCases("ejemplos")} disabled={!editorOpen || running}>
              Probar ejemplos <Kbd className="ml-1">⌘↵</Kbd>
            </Button>
            <Button variant="primary" size="sm" onClick={() => void runCases("enviar")} disabled={!editorOpen || running}>
              Enviar <span className="ml-1 text-2xs text-on-accent/75">⌘⇧↵</span>
            </Button>
          </span>
        </div>

        <div ref={editorWrap} className="relative min-h-0 flex-[4]">
          <CodeEditor
            value={code}
            onChange={(v) => setCode(v)}
            readOnly={!editorOpen}
            fill
            vim={prefs.vim}
            fontSize={prefs.fontSize}
            errorLine={errorLine}
            activeLine={pane === "vivo" ? activeLine : null}
            onRun={() => void runCases("ejemplos")}
            onSubmit={() => void runCases("enviar")}
            autoFocus={review}
            ariaLabel={`Tu solución para ${item.title}`}
          />
          {!editorOpen && (
            <div className="absolute inset-0 grid place-items-center bg-panel/80 px-6 text-center backdrop-blur-[2px]">
              <div className="max-w-xs">
                <p className="text-md font-medium text-text">Primero entiende y planea</p>
                <p className="mt-1 text-sm text-text-dim">
                  El editor se abre en el paso 3. Escribir sin un plan es la forma más cara de pensar.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex min-h-0 flex-[7] flex-col border-t border-line">
          <div className="flex items-center justify-between gap-2 px-3 pt-2">
            <Segmented
              size="sm"
              value={pane}
              onChange={setPane}
              ariaLabel="Debajo del editor"
              options={[
                { value: "vivo", label: "En vivo", title: "La máquina se mueve con tu código" },
                { value: "pruebas", label: "Pruebas", title: "Resultado de ⌘↵ / ⌘⇧↵" },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {pane === "vivo" ? (
              <LivePanel
                item={item}
                code={code}
                enabled={editorOpen}
                reveal={finished != null}
                onActiveLine={setActiveLine}
              />
            ) : run ? (
              <Results run={run} canDebug={canDebug} onDebug={(r) => void ask("debug", r)} debug={coach.debug} />
            ) : (
              <p className="px-4 py-6 text-center text-sm text-text-faint">
                Prueba los ejemplos con ⌘↵ o envía todos los casos con ⌘⇧↵.
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
