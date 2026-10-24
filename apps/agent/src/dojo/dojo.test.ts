/**
 * Dojo de algoritmos: contratos del repaso espaciado, la vista, el filtro de
 * código del coach, y —lo más importante— que el catálogo sea correcto: cada
 * solución de referencia pasa TODOS sus casos con el MISMO harness que corre en
 * el navegador, y las soluciones equivocadas típicas fallan.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addDays,
  attemptXp,
  checkAnswer,
  DOJO_XP,
  dojoXp,
  levelOf,
  normalizeAnswer,
  typingXp,
  typedChars,
  typingAccuracy,
  typingStats,
  typingTarget,
  typingWpm,
  type DojoTyping,
  type DojoTrace,
  firstVarOfType,
  traceNum,
  traceRepr,
  DOJO_HARNESS,
  DOJO_ITEMS,
  DOJO_UNITS,
  dojoItem,
  dojoStreak,
  dojoView,
  explainPyError,
  reviewState,
  starterCode,
  stripCode,
  testSpec,
  type DojoAttempt,
  type DojoExecRun,
  type DojoTestRun,
} from "@hermes/shared";
import { parseAttempt, parseTyping, readAttempts, saveAttempt } from "./store.js";
import { buildCoachUserPrompt, cleanCoach } from "./coach.js";

function att(over: Partial<DojoAttempt> = {}): DojoAttempt {
  return {
    id: "x",
    itemId: "f-doble",
    date: "2026-10-20",
    createdAt: `${over.date ?? "2026-10-20"}T15:00:00.000Z`,
    kind: "guiado",
    passed: true,
    hints: 0,
    gaveUp: false,
    review: false,
    ...over,
  };
}

// ── Python real ────────────────────────────────────────────────────────

const PYTHON = (() => {
  try {
    execFileSync("python3", ["--version"], { stdio: "ignore" });
    return "python3";
  } catch {
    return null;
  }
})();

const DRIVER = `
import json, sys
jobs = json.load(open(sys.argv[1]))
out = []
for job in jobs:
    if job["mode"] == "exec":
        out.append(json.loads(__dojo_exec(job["code"])))
    elif job["mode"] == "trace":
        out.append(json.loads(__dojo_trace(job["code"], json.dumps(job["spec"]))))
    elif job["mode"] == "trace_exec":
        out.append(json.loads(__dojo_trace_exec(job["code"])))
    else:
        out.append(json.loads(__dojo_test(job["code"], json.dumps(job["spec"]), lambda s: None)))
print(json.dumps(out))
`;

type Job =
  | { mode: "exec"; code: string }
  | { mode: "test"; code: string; spec: unknown }
  | { mode: "trace"; code: string; spec: unknown }
  | { mode: "trace_exec"; code: string };

/** Corre varios trabajos en UN proceso de python3 (arrancar uno por caso es lento). */
async function runPython<T>(jobs: Job[]): Promise<T[]> {
  const dir = await mkdtemp(join(tmpdir(), "dojo-py-"));
  const script = join(dir, "run.py");
  const input = join(dir, "jobs.json");
  await writeFile(script, DOJO_HARNESS + "\n" + DRIVER, "utf8");
  await writeFile(input, JSON.stringify(jobs), "utf8");
  const out = execFileSync(PYTHON!, ["-I", script, input], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out) as T[];
}

const problems = DOJO_ITEMS.filter((i) => i.problem);
const withSolution = (id: string, code: string) => {
  const item = dojoItem(id)!;
  return { mode: "test" as const, code, spec: testSpec(item.problem!, false) };
};

describe("catálogo", () => {
  it("ids únicos y cada unidad con su prueba", () => {
    const ids = DOJO_ITEMS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const u of DOJO_UNITS) {
      assert.ok(u.items.every((i) => i.unit === u.key), `${u.key}: item de otra unidad`);
      assert.equal(u.items.filter((i) => i.kind === "prueba").length, 1, `${u.key} sin prueba`);
    }
  });

  it("cada lección y cada problema tienen lo que necesitan", () => {
    for (const item of DOJO_ITEMS) {
      if (item.kind === "concepto") {
        assert.ok(item.blocks?.length, item.id);
        assert.ok(!item.problem, item.id);
        for (const b of item.blocks!)
          if (b.kind === "check") assert.ok(checkAnswer(b.answer, b), `${item.id}: ${b.question}`);
        continue;
      }
      const p = item.problem!;
      assert.ok(p, item.id);
      assert.equal(p.hints.length, 4, `${item.id}: la escalera tiene 4 escalones`);
      assert.ok(p.hints.every((h) => h.trim().length > 10), `${item.id}: pista vacía`);
      assert.ok(p.cases.filter((c) => !c.hidden).length >= 2, `${item.id}: al menos 2 ejemplos visibles`);
      assert.ok(p.cases.some((c) => c.hidden), `${item.id}: sin casos ocultos`);
      assert.ok(p.signature.startsWith(`def ${p.fn}(`) && p.signature.endsWith(":"), item.id);
      assert.ok(starterCode(p).startsWith(p.signature), item.id);
      // Los ejemplos visibles se pueden mostrar: nada de expresiones de Python.
      for (const c of p.cases.filter((c) => !c.hidden)) assert.ok(c.args && !c.argsExpr && !c.expectedExpr, item.id);
      // Un caso grande sin etiqueta mostraría 100.000 números en la UI.
      for (const c of p.cases) if (c.argsExpr) assert.ok(c.label, `${item.id}: argsExpr sin label`);
    }
  });

  it("las pistas y el enunciado no traen la solución escrita", () => {
    for (const item of problems) {
      const p = item.problem!;
      for (const h of p.hints) assert.ok(!/```|\n\s*(def|return) /.test(h), `${item.id}: pista con código`);
      const body = p.solution.split("\n").slice(1).map((l) => l.trim()).filter((l) => l.length > 12);
      for (const line of body)
        assert.ok(!p.statement.some((s) => s.includes(line)), `${item.id}: el enunciado trae «${line}»`);
    }
  });

  it("la solución de referencia no usa lo que el ejercicio prohíbe", () => {
    for (const item of problems) {
      for (const name of item.problem!.banned ?? [])
        assert.ok(!new RegExp(`\\b${name}\\b`).test(item.problem!.solution), `${item.id} usa ${name}`);
    }
  });
});

describe("todo se teclea", () => {
  it("el código del catálogo se puede escribir con un teclado (nada de → ni ×)", () => {
    const ok = /^[\x20-\x7eáéíóúÁÉÍÓÚñÑü¿¡\n]*$/;
    for (const item of DOJO_ITEMS) {
      const codes = [
        ...(item.blocks ?? []).flatMap((b) => (b.kind === "code" ? [b.code] : [])),
        ...(item.problem ? [item.problem.solution] : []),
      ];
      for (const c of codes) assert.match(c, ok, `${item.id}: «${[...c].find((ch) => !ok.test(ch))}»`);
    }
  });

  it("las preguntas se responden escribiendo, con variantes razonables", () => {
    const b = { answer: "O(n²)", accept: ["O(n*n)"] };
    for (const s of ["O(n²)", "O(n^2)", "o(n^2)", " O(n**2) ", "O(n*n)"]) assert.ok(checkAnswer(s, b), s);
    assert.ok(!checkAnswer("O(n)", b));
    assert.ok(!checkAnswer("", { answer: "" }), "vacío nunca es correcto");
    assert.ok(checkAnswer("None", { answer: "None" }));
    assert.ok(!checkAnswer("none", { answer: "None" }), "Python distingue mayúsculas");
    assert.ok(checkAnswer("2  6", { answer: "2 6" }));
    assert.ok(!checkAnswer("26", { answer: "2 6" }));
    assert.equal(normalizeAnswer("`n % 3 == 0`"), "n % 3 == 0");
  });

  it("métricas de tecleo: 5 caracteres = 1 palabra", () => {
    assert.equal(typingWpm(300, 60_000), 60);
    assert.equal(typingWpm(10, 0), 0);
    assert.equal(typingAccuracy(95, 5), 95);
    assert.equal(typingAccuracy(0, 0), 100);
  });

  it("la sangría al empezar línea no cuenta como tecleada", () => {
    const t = typingTarget("def f(n):   \n    return n\n\n");
    assert.equal(t, "def f(n):\n    return n");
    assert.equal(typedChars(t), "def f(n):".length + 1 + "return n".length);
  });

  it("racha de tecleo: hoy, total y las últimas 10", () => {
    const rec = (date: string, chars: number, errors = 0, ms = 60_000): DojoTyping => ({
      id: "t",
      itemId: "f-doble",
      date,
      createdAt: `${date}T15:00:00Z`,
      source: "ejemplo",
      blind: false,
      chars,
      errors,
      ms,
    });
    const s = typingStats([rec("2026-10-21", 100), rec("2026-10-22", 200, 10)], "2026-10-22");
    assert.equal(s.today, 200);
    assert.equal(s.total, 300);
    assert.equal(s.wpm, typingWpm(300, 120_000));
    assert.equal(s.accuracy, typingAccuracy(300, 10));
    assert.equal(typingStats([], "2026-10-22").wpm, null);
  });

  it("una pasada imposible no se guarda", () => {
    assert.equal(parseTyping({ itemId: "nope", source: "ejemplo", chars: 10, ms: 5000 }), "Lección desconocida.");
    assert.match(String(parseTyping({ itemId: "f-doble", source: "ejemplo", chars: 3000, ms: 5000 })), /30 caracteres/);
    assert.match(String(parseTyping({ itemId: "f-doble", source: "ejemplo", chars: 5, ms: 200 })), /corta/);
    const ok = parseTyping({ itemId: "f-doble", source: "solucion", blind: true, chars: 40, errors: 2, ms: 20_000 });
    assert.ok(typeof ok !== "string" && ok.blind && ok.source === "solucion");
  });
});

describe("el juego", () => {
  it("niveles: 100, luego 200, luego 300 XP", () => {
    assert.deepEqual(levelOf(0), { level: 1, into: 0, need: 100 });
    assert.deepEqual(levelOf(100), { level: 2, into: 0, need: 200 });
    assert.deepEqual(levelOf(350), { level: 3, into: 50, need: 300 });
  });

  it("un problema da su XP grande una vez; repetirlo no suma, repasarlo sí", () => {
    const first = att({ createdAt: "2026-10-20T10:00:00Z" });
    const again = att({ createdAt: "2026-10-20T11:00:00Z" });
    const review = att({ createdAt: "2026-10-21T10:00:00Z", date: "2026-10-21", review: true });
    const xp = dojoXp([first, again, review], [], "2026-10-21");
    const big = DOJO_XP.problema + DOJO_XP.limpio;
    assert.equal(xp.total, big + DOJO_XP.repaso + DOJO_XP.limpio / 2);
    assert.equal(xp.today, DOJO_XP.repaso + DOJO_XP.limpio / 2);
  });

  it("la prueba y lo limpio valen más; rendirse no da XP", () => {
    assert.equal(attemptXp(att({ kind: "prueba" }), true), DOJO_XP.problema + DOJO_XP.limpio + DOJO_XP.prueba);
    assert.equal(attemptXp(att({ hints: 2 }), true), DOJO_XP.problema);
    assert.equal(attemptXp(att({ passed: false, gaveUp: true }), true), 0);
  });

  it("teclear siempre suma, más si es preciso o de memoria", () => {
    assert.equal(typingXp({ chars: 100, errors: 0, blind: false }), 15);
    assert.equal(typingXp({ chars: 100, errors: 5, blind: false }), 10);
    assert.equal(typingXp({ chars: 100, errors: 30, blind: false }), 5);
    assert.equal(typingXp({ chars: 100, errors: 0, blind: true }), 30);
  });
});

describe("catálogo × Python (mismo harness que el navegador)", { skip: !PYTHON && "sin python3" }, () => {
  it("cada solución de referencia pasa todos sus casos, dentro del tiempo", async () => {
    const runs = await runPython<DojoTestRun>(problems.map((i) => withSolution(i.id, i.problem!.solution)));
    runs.forEach((run, k) => {
      const id = problems[k].id;
      assert.equal(run.phase, "done", `${id}: ${JSON.stringify(run)}`);
      if (run.phase !== "done") return;
      assert.equal(run.results.length, problems[k].problem!.cases.length, id);
      for (const r of run.results)
        assert.ok(r.ok, `${id} · ${r.call}: esperado ${r.expected}, obtuvo ${r.got} ${JSON.stringify(r.error)} (${r.ms} ms)`);
    });
  });

  it("el código de cada lección corre sin error", async () => {
    const blocks = DOJO_ITEMS.flatMap((i) =>
      (i.blocks ?? []).filter((b) => b.kind === "code").map((b) => ({ id: i.id, code: (b as { code: string }).code })),
    );
    const runs = await runPython<DojoExecRun>(blocks.map((b) => ({ mode: "exec", code: b.code })));
    runs.forEach((run, k) => {
      assert.equal(run.error, null, `${blocks[k].id}: ${JSON.stringify(run.error)}`);
      assert.ok(run.stdout.trim(), `${blocks[k].id}: el ejemplo no imprime nada`);
    });
  });

  it("las respuestas de las preguntas con código son las que Python imprime", async () => {
    // Solo las de «¿Qué imprime?»: su respuesta tiene que ser la ÚLTIMA línea real.
    const checks = DOJO_ITEMS.flatMap((i) =>
      (i.blocks ?? []).flatMap((b) =>
        b.kind === "check" && b.code && b.question.startsWith("¿Qué imprime") ? [{ id: i.id, b }] : [],
      ),
    );
    assert.ok(checks.length >= 4);
    const runs = await runPython<DojoExecRun>(checks.map((c) => ({ mode: "exec", code: c.b.code! })));
    runs.forEach((run, k) => {
      const { id, b } = checks[k];
      const last = run.stdout.trim().split("\n").at(-1);
      assert.ok(checkAnswer(last ?? "", b), `${id}: «${b.question}» imprime ${last}, la respuesta dice ${b.answer}`);
    });
  });

  it("lo que suele salir mal, falla", async () => {
    const [printNoReturn, intForBool, banned, floatDiv, sameTwice, syntax, missing, crash, unordered, groups] =
      await runPython<DojoTestRun>([
        withSolution("f-doble", "def doble(n):\n    print(n * 2)"),
        withSolution("f-es-par", "def es_par(n):\n    return 1 if n % 2 == 0 else 0"),
        withSolution("f-mayor", "def mayor(numeros):\n    return max(numeros)"),
        withSolution("c-suma-gigante", "def suma_gigante(n):\n    return n * (n + 1) / 2"),
        withSolution(
          "h-dos-suma",
          "def dos_suma(numeros, objetivo):\n    d = {x: i for i, x in enumerate(numeros)}\n    for i, x in enumerate(numeros):\n        if objetivo - x in d:\n            return [i, d[objetivo - x]]",
        ),
        withSolution("f-doble", "def doble(n)\n    return n * 2"),
        withSolution("f-doble", "def duplicar(n):\n    return n * 2"),
        withSolution("f-mayor", "def mayor(numeros):\n    return numeros[len(numeros)]"),
        withSolution("h-dos-suma", "def dos_suma(numeros, objetivo):\n    return [1, 0] if objetivo == 9 else [-1, -1]"),
        withSolution("h-agrupar", "def agrupar_anagramas(palabras):\n    return [list(reversed(palabras))] if palabras else []"),
      ]);
    const failed = (r: DojoTestRun) => r.phase === "done" && r.results.some((x) => !x.ok);

    assert.ok(failed(printNoReturn));
    if (printNoReturn.phase === "done") {
      assert.equal(printNoReturn.results[0].got, "None");
      assert.equal(printNoReturn.results[0].stdout, "8\n", "lo impreso se captura por caso");
    }
    assert.ok(failed(intForBool), "1 no es True");
    assert.equal(banned.phase, "banned");
    if (banned.phase === "banned") assert.deepEqual([banned.banned, banned.line], ["max", 2]);
    assert.ok(failed(floatDiv), "con / los enteros enormes pierden precisión");
    assert.ok(failed(sameTwice), "[3, 3] con 6 no puede usar el mismo 3");
    assert.equal(syntax.phase, "syntax");
    if (syntax.phase === "syntax") assert.equal(syntax.error.line, 1);
    assert.equal(missing.phase, "missing");
    assert.ok(failed(crash));
    if (crash.phase === "done") {
      assert.equal(crash.results[0].error?.type, "IndexError");
      assert.equal(crash.results[0].error?.line, 2, "la línea es la de SU código");
    }
    // unordered acepta [1, 0] para [0, 1] en el primer caso
    assert.ok(unordered.phase === "done" && unordered.results[0].ok);
    assert.ok(failed(groups));
  });
});

describe("trazador (lo que hizo TU código)", { skip: !PYTHON && "sin python3" }, () => {
  it("registra el acumulador subiendo y lo que devuelve", async () => {
    const [t] = await runPython<DojoTrace>([
      { mode: "trace", code: dojoItem("f-contar-pares")!.problem!.solution, spec: { fn: "contar_pares", args: [[1, 2, 3, 4]] } },
    ]);
    assert.equal(t.phase, "done");
    if (t.phase !== "done") return;
    assert.equal(t.call, "contar_pares([1, 2, 3, 4])");
    assert.equal(traceRepr(t.result!), "2");
    const counts = [...new Set(t.steps.map((s) => traceNum(s.locals.cuenta)).filter((n) => n != null))];
    assert.deepEqual(counts, [0, 1, 2], "la cuenta pasa por 0, 1 y 2");
    assert.equal(firstVarOfType(t.steps, "contar_pares", ["int"]), "cuenta");
    assert.ok(t.steps.every((s) => s.line >= 1 && s.line <= 6), "solo líneas de SU código");
    assert.equal(t.steps.at(-1)!.event, "return");
  });

  it("un bucle infinito se corta por el tope de pasos, sin colgarse", async () => {
    const [t] = await runPython<DojoTrace>([
      { mode: "trace", code: "def f(n):\n    while True:\n        n += 1", spec: { fn: "f", args: [0] } },
    ]);
    assert.ok(t.phase === "done" && t.truncated && t.steps.length === 600);
  });

  it("los dicts y sets viajan con su contenido", async () => {
    const [t] = await runPython<DojoTrace>([
      { mode: "trace", code: dojoItem("h-contar-palabras")!.problem!.solution, spec: { fn: "contar_palabras", args: ["hola mundo hola"] } },
    ]);
    assert.ok(t.phase === "done");
    if (t.phase !== "done") return;
    assert.equal(traceRepr(t.result!), "{'hola': 2, 'mundo': 1}");
    assert.equal(firstVarOfType(t.steps, "contar_palabras", ["dict"]), "conteo");
  });

  it("los ejemplos de las lecciones se trazan como programa suelto", async () => {
    const [t] = await runPython<DojoTrace>([{ mode: "trace_exec", code: 'edad = 31\nnombre = "Rulo"\nedad = edad + 1\nprint(edad)' }]);
    assert.ok(t.phase === "done");
    if (t.phase !== "done") return;
    const last = t.steps.at(-1)!;
    assert.equal(traceRepr(last.locals.edad), "32");
    assert.equal(traceRepr(last.locals.nombre), "'Rulo'");
    assert.equal(t.stdout, "32\n");
    assert.ok(!("print" in last.locals), "sin builtins");
  });

  it("un error deja la traza hasta donde llegó", async () => {
    const [t] = await runPython<DojoTrace>([
      { mode: "trace", code: "def f(xs):\n    return xs[5]", spec: { fn: "f", args: [[1]] } },
    ]);
    assert.ok(t.phase === "done" && t.error?.type === "IndexError" && t.steps.length > 0);
  });
});

describe("repaso espaciado", () => {
  it("limpio a la primera no agenda nada", () => {
    assert.equal(reviewState([att()]), null);
  });

  it("con pistas vuelve mañana; cada repaso limpio sube un escalón y al final se gradúa", () => {
    const first = att({ hints: 2, date: "2026-10-20" });
    assert.deepEqual(reviewState([first]), { step: 0, due: "2026-10-21" });
    const r1 = att({ date: "2026-10-21", review: true });
    assert.deepEqual(reviewState([first, r1]), { step: 1, due: "2026-10-24" });
    const r2 = att({ date: "2026-10-24", review: true });
    assert.deepEqual(reviewState([first, r1, r2]), { step: 2, due: "2026-10-31" });
    const r3 = att({ date: "2026-10-31", review: true });
    assert.equal(reviewState([first, r1, r2, r3]), null);
  });

  it("un limpio ANTES de la fecha no adelanta; un repaso con pistas vuelve al principio", () => {
    const first = att({ hints: 1, date: "2026-10-20" });
    const early = att({ date: "2026-10-20", createdAt: "2026-10-20T18:00:00.000Z" });
    assert.deepEqual(reviewState([first, early]), { step: 0, due: "2026-10-21" });
    const r1 = att({ date: "2026-10-21" });
    const bad = att({ date: "2026-10-24", hints: 3 });
    assert.deepEqual(reviewState([first, r1, bad]), { step: 0, due: "2026-10-25" });
  });

  it("rendirse también agenda", () => {
    assert.deepEqual(reviewState([att({ passed: false, gaveUp: true })]), { step: 0, due: "2026-10-21" });
  });

  it("addDays cruza meses", () => {
    assert.equal(addDays("2026-10-30", 3), "2026-11-02");
  });
});

describe("racha y vista", () => {
  it("racha desde hoy o desde ayer", () => {
    assert.equal(dojoStreak(["2026-10-20", "2026-10-21", "2026-10-22"], "2026-10-22"), 3);
    assert.equal(dojoStreak(["2026-10-20", "2026-10-21"], "2026-10-22"), 2);
    assert.equal(dojoStreak(["2026-10-19"], "2026-10-22"), 0);
  });

  it("lo que toca es lo primero sin hacer; pasar la prueba domina la unidad", () => {
    const empty = dojoView(DOJO_UNITS, [], "2026-10-22");
    assert.equal(empty.current, DOJO_UNITS[0].items[0].id);
    assert.equal(empty.items[empty.current!].status, "current");

    const prueba = DOJO_UNITS[0].items.find((i) => i.kind === "prueba")!;
    const v = dojoView(DOJO_UNITS, [att({ itemId: prueba.id, kind: "prueba" })], "2026-10-22");
    assert.equal(v.units[0].mastered, true);
    assert.equal(v.current, DOJO_UNITS[1].items[0].id, "la unidad dominada ya no pide nada");
  });

  it("candados: cada lección se abre al terminar la anterior; el jefe siempre se puede intentar", () => {
    const v = dojoView(DOJO_UNITS, [], "2026-10-22");
    const [cap1, cap2] = DOJO_UNITS;
    assert.equal(v.items[cap1.items[0].id].status, "current");
    assert.equal(v.items[cap1.items[1].id].status, "locked");
    assert.equal(v.items[cap1.items.at(-1)!.id].status, "open", "el jefe del capítulo abierto");
    assert.equal(v.units[1].open, false);
    assert.equal(v.items[cap2.items[0].id].status, "locked", "capítulo cerrado");
    assert.equal(v.items[cap2.items.at(-1)!.id].status, "open", "su jefe sí: saltar el capítulo");

    const v2 = dojoView(DOJO_UNITS, [att({ itemId: cap1.items[0].id, kind: "concepto" })], "2026-10-22");
    assert.equal(v2.items[cap1.items[1].id].status, "current", "terminar una abre la siguiente");
  });

  it("vencer al jefe abre el capítulo siguiente aunque falten lecciones", () => {
    const [cap1, cap2] = DOJO_UNITS;
    const boss = cap1.items.at(-1)!;
    const v = dojoView(DOJO_UNITS, [att({ itemId: boss.id, kind: "prueba" })], "2026-10-22");
    assert.equal(v.units[0].mastered, true);
    assert.equal(v.units[1].open, true);
    assert.equal(v.current, cap2.items[0].id);
  });

  it("el cofre se abre con las lecciones de antes y da su XP el día que se abrió", () => {
    const cap1 = DOJO_UNITS[0];
    const before = cap1.items.slice(0, cap1.chestAfter);
    const atts = before.map((it, k) =>
      att({ itemId: it.id, kind: it.kind, date: k ? "2026-10-22" : "2026-10-21", createdAt: `2026-10-2${k ? 2 : 1}T1${k}:00:00Z` }),
    );
    const closed = dojoView(DOJO_UNITS, atts.slice(0, -1), "2026-10-22");
    assert.equal(closed.units[0].chest, "closed");
    const v = dojoView(DOJO_UNITS, atts, "2026-10-22");
    assert.equal(v.units[0].chest, "opened");
    assert.equal(v.xp.total - dojoXp(atts, [], "2026-10-22").total, DOJO_XP.cofre);
    assert.ok(v.xp.today >= DOJO_XP.cofre, "se abrió hoy");
  });

  it("cada capítulo es un lugar con historia, cofre a mitad y jefe al final", () => {
    for (const u of DOJO_UNITS) {
      assert.equal(u.story.length, 2, u.key);
      assert.ok(u.chestAfter > 0 && u.chestAfter < u.items.length, u.key);
      assert.equal(u.items.at(-1)!.kind, "prueba", `${u.key}: el jefe va al final`);
    }
  });

  it("repasos que vencen, solo los de hoy o antes", () => {
    const v = dojoView(
      DOJO_UNITS,
      [att({ hints: 1, date: "2026-10-20" }), att({ itemId: "f-es-par", hints: 1, date: "2026-10-22" })],
      "2026-10-22",
    );
    assert.deepEqual(v.reviews.map((r) => r.itemId), ["f-doble"]);
    assert.equal(v.upcoming, 1);
    assert.equal(v.totals.solved, 2);
    assert.equal(v.totals.clean, 0);
  });
});

describe("coach", () => {
  it("stripCode quita bloques y sentencias, deja el código en línea", () => {
    const r = stripCode("Piensa en un `set`.\n```python\nvistos = set()\n```\nfor x in numeros:\n    return True\n¿Qué pasa con [3, 3]?");
    assert.equal(r.stripped, true);
    assert.equal(r.text, "Piensa en un `set`.\n\n¿Qué pasa con [3, 3]?");
    assert.deepEqual(stripCode("Vas bien: `x in vistos` es O(1)."), {
      text: "Vas bien: `x in vistos` es O(1).",
      stripped: false,
    });
  });

  it("si todo era código, dice por qué no responde", () => {
    const f = cleanCoach({ verdict: "casi", message: "def f(n):\n    return n * 2" });
    assert.match(f.message, /no se escribe tu solución/);
  });

  it("el prompt lleva el problema, lo suyo y la tarea del momento", () => {
    const prompt = buildCoachUserPrompt({
      item: dojoItem("h-repetidos")!,
      stage: "plan",
      plan: "comparo cada número con todos",
    });
    assert.match(prompt, /hay_repetidos\(\[1,2,3,1\]\) → true/);
    assert.match(prompt, /1500 ms/);
    assert.match(prompt, /comparo cada número con todos/);
    assert.match(prompt, /NO le des el enfoque correcto/);
  });

  it("los errores comunes tienen explicación en español", () => {
    for (const t of ["SyntaxError", "IndentationError", "NameError", "TypeError", "IndexError", "KeyError"])
      assert.ok(explainPyError(t));
    assert.equal(explainPyError("MiErrorRaro"), null);
  });
});

describe("store", () => {
  it("valida el intento: lección conocida y pasó o se rindió", () => {
    assert.equal(parseAttempt({ itemId: "nope", passed: true }), "Lección desconocida.");
    assert.match(String(parseAttempt({ itemId: "f-doble" })), /pasar o al rendirse/);
    assert.match(String(parseAttempt({ itemId: "f-funciones", gaveUp: true })), /terminarla/);
    const ok = parseAttempt({ itemId: "f-doble", passed: true, hints: 9, guessedTime: "O(n)", code: "x".repeat(30_000) });
    assert.ok(typeof ok !== "string");
    if (typeof ok !== "string") {
      assert.equal(ok.hints, 4, "las pistas se recortan a la escalera");
      assert.equal(ok.kind, "guiado", "el tipo lo pone el catálogo, no la web");
      assert.equal(ok.guessedTime, "O(n)");
      assert.equal(ok.code!.length, 20_000);
    }
    const bad = parseAttempt({ itemId: "f-doble", passed: true, guessedTime: "O(n³)" });
    assert.ok(typeof bad !== "string" && bad.guessedTime === undefined);
  });

  it("guarda y relee; una línea rota no tumba el archivo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dojo-"));
    const file = join(dir, "attempts.jsonl");
    const parsed = parseAttempt({ itemId: "f-doble", passed: true });
    assert.ok(typeof parsed !== "string");
    await saveAttempt(parsed as Exclude<typeof parsed, string>, file);
    await appendFile(file, "{roto\n", "utf8");
    const back = await readAttempts(file);
    assert.equal(back.length, 1);
    assert.equal(back[0].itemId, "f-doble");
  });
});
