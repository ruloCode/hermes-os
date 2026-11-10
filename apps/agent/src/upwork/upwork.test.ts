/**
 * Oportunidades de Upwork: contratos del parser de avisos, del puntaje, del
 * store y del barrido. Fixtures INVENTADOS con la forma real del correo
 * (nada de clientes reales en el repo).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetLabel, parseJobAlert, parseSpent } from "./parse.js";
import { scoreJob } from "./score.js";
import { fileOpportunityStore, reduceOpportunities, type Opportunity } from "./store.js";
import { noticeFor, pickToNotify, syncUpwork } from "./sync.js";

const LINK = (id: string, extra = "") => `https://www.upwork.com/jobs/~${id}?link=title&utm_source=mailgun${extra}`;
const SKILL = (s: string) => `${s}: https://www.upwork.com/s/emails/nx/search/jobs/?utm_medium=email&frkscc=abc`;

function alert(o: {
  id?: string;
  title?: string;
  budget?: string;
  desc?: string;
  skills?: string[];
  more?: number;
  client?: string;
}): string {
  const id = o.id ?? "0211111111111111111";
  return `

New job alert

Hi Alex,

This job was just posted and matches your alert settings.

----------

${o.title ?? "Senior Next.js + Supabase engineer to finish a Lovable app"}...: ${LINK(id)}

  ${o.budget ?? "Hourly: $35.00 - $60.00 · Est. time: Less than 1 month · Posted Mon, Nov 02"}

${o.desc ?? "Our MVP was built with Lovable and it mostly works, but RLS is off and payments break. We need a senior to make it production-ready..."} more: ${LINK(id, "&link=more")}

Skills:
${(o.skills ?? ["Next.js", "Supabase", "TypeScript"]).map(SKILL).join("\n")}
${o.more ? `+${o.more} more\n` : ""}
${o.client ?? "Payment verified · 4.9 stars · $12K spent · Neverland"}

    ----------

View job details: https://www.upwork.com/jobs/~${id}?frkscc=zzz

You received this email because Freelancer Plus members have access to job alerts.`;
}

describe("parseJobAlert", () => {
  it("saca id, título, presupuesto por hora, skills y cliente del texto plano", () => {
    const j = parseJobAlert({ plain: alert({ more: 4 }) })!;
    assert.equal(j.jobId, "0211111111111111111");
    assert.equal(j.url, "https://www.upwork.com/jobs/~0211111111111111111");
    assert.equal(j.title, "Senior Next.js + Supabase engineer to finish a Lovable app");
    assert.deepEqual(j.budget, { type: "hourly", min: 35, max: 60 });
    assert.equal(j.estTime, "Less than 1 month");
    assert.match(j.description, /^Our MVP was built with Lovable/);
    assert.doesNotMatch(j.description, /https:|more:/);
    assert.deepEqual(j.skills, ["Next.js", "Supabase", "TypeScript"]);
    assert.equal(j.moreSkills, 4);
    assert.equal(j.paymentVerified, true);
    assert.equal(j.rating, 4.9);
    assert.equal(j.spent, 12_000);
    assert.equal(j.country, "Neverland");
  });

  it("precio fijo con miles y cliente sin calificación", () => {
    const j = parseJobAlert({
      plain: alert({ budget: "Fixed: $1,000.00 · Est. time: 3 to 6 months · Posted Tue, Oct 27", client: "Payment verified · $5K spent · XYZ" }),
    })!;
    assert.deepEqual(j.budget, { type: "fixed", amount: 1000 });
    assert.equal(j.rating, null);
    assert.equal(j.spent, 5_000);
    assert.equal(j.country, "XYZ");
  });

  it('"$0.00 - $0.00" por hora es un hueco, no una tarifa de cero', () => {
    const j = parseJobAlert({ plain: alert({ budget: "Hourly: $0.00 - $0.00 · Est. time: Less than 1 month · Posted Sun, Nov 01" }) })!;
    assert.deepEqual(j.budget, { type: "hourly", min: null, max: null });
    assert.equal(budgetLabel(j.budget), "por hora (sin tarifa)");
  });

  it("pago sin verificar se reconoce", () => {
    const j = parseJobAlert({ plain: alert({ client: "Payment unverified · $0 spent · Nowhere" }) })!;
    assert.equal(j.paymentVerified, false);
    assert.equal(j.spent, 0);
  });

  it("el asunto gana si trae el título más completo", () => {
    const j = parseJobAlert({ plain: alert({ title: "AI agent dev" }), subject: "New job alert: AI agent developer for a support desk..." })!;
    assert.equal(j.title, "AI agent developer for a support desk");
  });

  it("sin texto plano cae al HTML; sin link de oferta devuelve null", () => {
    const html = `<html><body><a href="${LINK("0299")}">Build an MCP server</a><p>Fixed: $400.00 · Est. time: Less than 1 month</p><p>Payment verified · 5.0 stars · $3K spent · Atlantis</p></body></html>`;
    const j = parseJobAlert({ html, subject: "New job alert: Build an MCP server" })!;
    assert.equal(j.jobId, "0299");
    assert.deepEqual(j.budget, { type: "fixed", amount: 400 });
    assert.equal(j.spent, 3_000);
    assert.equal(parseJobAlert({ plain: "Your account has been verified" }), null);
  });

  it("parseSpent entiende K y M", () => {
    assert.equal(parseSpent("$2K spent"), 2000);
    assert.equal(parseSpent("$2M spent"), 2_000_000);
    assert.equal(parseSpent("$637 spent"), 637);
    assert.equal(parseSpent("nada"), null);
  });
});

const job = (o: Parameters<typeof alert>[0]) => parseJobAlert({ plain: alert(o) })!;

describe("scoreJob", () => {
  it("rescate de app hecha con IA en Next.js/Supabase, buen cliente y tarifa → aplicar", () => {
    const s = scoreJob(job({}));
    assert.equal(s.verdict, "aplicar");
    assert.ok(s.score >= 70, `score ${s.score}`);
    assert.ok(s.niche.includes("rescate"));
    assert.match(s.reasons[0], /nicho/);
  });

  it("agentes + Claude Code con fijo chico y cerrado puntúa alto", () => {
    const s = scoreJob(
      job({
        title: "Build an AI agent with Claude Code and MCP",
        budget: "Fixed: $400.00 · Est. time: Less than 1 month · Posted Mon, Nov 02",
        desc: "We need an AI agent that reads our docs (RAG) and exposes tools over MCP.",
        skills: ["Claude", "MCP", "TypeScript"],
      }),
    );
    assert.equal(s.verdict, "aplicar");
    for (const n of ["agentes", "claude-code", "mcp", "rag"]) assert.ok(s.niche.includes(n), n);
  });

  it("fijo de $15 se descarta aunque sea del nicho", () => {
    const s = scoreJob(job({ budget: "Fixed: $15.00 · Est. time: Less than 1 month · Posted Mon, Nov 02" }));
    assert.equal(s.verdict, "descartar");
    assert.ok(s.score <= 15);
    assert.match(s.discard!, /\$15/);
  });

  it("tope por hora bajo $30 se descarta", () => {
    const s = scoreJob(job({ budget: "Hourly: $15.00 - $25.00 · Est. time: 1 to 3 months · Posted Mon, Nov 02" }));
    assert.equal(s.verdict, "descartar");
    assert.match(s.discard!, /\$25\/h/);
  });

  it("WordPress/PHP sin nada del nicho queda descartada", () => {
    const s = scoreJob(
      job({
        title: "WordPress developer for a PHP site",
        desc: "Fix our WordPress theme and PHP plugins.",
        skills: ["WordPress", "PHP"],
        budget: "Hourly: $30.00 - $45.00 · Est. time: 1 to 3 months · Posted Mon, Nov 02",
      }),
    );
    assert.equal(s.verdict, "descartar");
    assert.ok(s.reasons.some((r) => /WordPress/.test(r)));
  });

  it("trabajo de prueba sin pago se descarta", () => {
    const s = scoreJob(job({ desc: "Before hiring we need an unpaid test task with Next.js and Supabase." }));
    assert.equal(s.verdict, "descartar");
    assert.match(s.discard!, /prueba/);
  });

  it("pago sin verificar y cliente nuevo restan con motivo", () => {
    const base = scoreJob(job({})).score;
    const s = scoreJob(job({ client: "Payment unverified · $0 spent · Nowhere" }));
    assert.ok(s.score < base - 20);
    assert.ok(s.reasons.includes("Pago sin verificar"));
  });
});

function opp(id: string, over: Partial<Opportunity> = {}): Opportunity {
  const j = { ...job({}), jobId: id, url: `https://www.upwork.com/jobs/~${id}` };
  return {
    jobId: id,
    mailId: `m${id}`,
    receivedAt: Date.parse("2026-11-02T15:00:00Z"),
    job: j,
    score: 80,
    verdict: "aplicar",
    reasons: ["Encaja con tu nicho: x", "Tu stack: nextjs"],
    status: "nueva",
    updatedAt: "2026-11-02T15:00:00Z",
    ...over,
  };
}

describe("store", () => {
  it("gana la última línea por jobId y una línea rota no tumba el resto", () => {
    const lines = [JSON.stringify(opp("1")), "{roto", JSON.stringify(opp("2")), JSON.stringify(opp("1", { status: "aplicada" }))];
    const r = reduceOpportunities(lines);
    assert.equal(r.length, 2);
    assert.equal(r.find((o) => o.jobId === "1")!.status, "aplicada");
  });

  it("put + all en disco", async () => {
    const dir = await mkdtemp(join(tmpdir(), "upwork-"));
    const s = fileOpportunityStore(join(dir, "o.jsonl"));
    await s.put(opp("1"));
    await s.put(opp("1", { status: "descartada" }));
    assert.equal((await s.all()).length, 1);
    assert.equal((await s.get("1"))!.status, "descartada");
  });
});

describe("pickToNotify", () => {
  const nowMs = Date.parse("2026-11-02T17:00:00Z");
  const tz = "America/Bogota";

  it("solo nuevas, sobre el umbral y recientes; la de más puntaje primero", () => {
    const all = [
      opp("a", { score: 75 }),
      opp("b", { score: 92 }),
      opp("c", { score: 60 }),
      opp("d", { score: 95, status: "aplicada" }),
      opp("e", { score: 99, receivedAt: nowMs - 7 * 60 * 60_000 }),
    ];
    assert.deepEqual(pickToNotify(all, { nowMs, tz }).map((o) => o.jobId), ["b", "a"]);
  });

  it("respeta el tope diario contando lo ya avisado hoy", () => {
    const all = [
      opp("x", { status: "avisada", notifiedAt: "2026-11-02T14:00:00Z" }),
      opp("y", { status: "avisada", notifiedAt: "2026-11-02T15:00:00Z" }),
      opp("a", { score: 90 }),
      opp("b", { score: 85 }),
    ];
    assert.deepEqual(pickToNotify(all, { nowMs, tz, maxPerDay: 3 }).map((o) => o.jobId), ["a"]);
  });

  it("el aviso lleva presupuesto, motivos y link", () => {
    const n = noticeFor(opp("a"));
    assert.match(n.title, /^Upwork 80 · /);
    assert.match(n.body, /\$35–60\/h/);
    assert.match(n.body, /https:\/\/www\.upwork\.com\/jobs\/~a/);
  });
});

describe("syncUpwork", () => {
  const nowMs = Date.parse("2026-11-02T17:00:00Z");
  const mails = [
    { id: "m1", receivedAt: nowMs - 30 * 60_000, subject: "", plain: alert({ id: "01" }), html: "" },
    { id: "m2", receivedAt: nowMs - 20 * 60_000, subject: "", plain: alert({ id: "02", budget: "Fixed: $10.00 · Est. time: Less than 1 month · Posted Mon, Nov 02" }), html: "" },
    // El mismo job en otro correo: se guarda una vez.
    { id: "m3", receivedAt: nowMs - 10 * 60_000, subject: "", plain: alert({ id: "01" }), html: "" },
  ];

  it("guarda una vez por oferta, descarta lo malo y en seco no avisa", async () => {
    const store = fileOpportunityStore(join(await mkdtemp(join(tmpdir(), "upwork-")), "o.jsonl"));
    let calls = 0;
    const r = (await syncUpwork({ store, tz: "America/Bogota", dryRun: true, fetchAlerts: async () => mails, notify: async () => void calls++, now: () => nowMs }))!;
    assert.equal(r.saved, 2);
    assert.equal(r.notified, 0);
    assert.equal(calls, 0);
    const all = await store.all();
    assert.equal(all.find((o) => o.jobId === "02")!.status, "descartada");
  });

  it("avisa la buena con borrador, la marca avisada y no la repite", async () => {
    const store = fileOpportunityStore(join(await mkdtemp(join(tmpdir(), "upwork-")), "o.jsonl"));
    const sent: string[] = [];
    const deps = {
      store,
      tz: "America/Bogota",
      fetchAlerts: async (known: Set<string>) => mails.filter((m) => !known.has(m.id)),
      notify: async (_o: Opportunity, n: { title: string; body: string }) => void sent.push(n.body),
      draft: async () => ({ text: "Hi! draft", model: "test", at: "now" }),
      now: () => nowMs,
    };
    const r = (await syncUpwork(deps))!;
    assert.equal(r.notified, 1);
    assert.equal(r.drafted, 1);
    assert.match(sent[0], /Borrador:\nHi! draft/);
    assert.equal((await store.get("01"))!.status, "avisada");
    const again = (await syncUpwork(deps))!;
    assert.equal(again.notified, 0);
    assert.equal(sent.length, 1);
  });

  it("si el borrador falla, el aviso sale igual sin borrador", async () => {
    const store = fileOpportunityStore(join(await mkdtemp(join(tmpdir(), "upwork-")), "o.jsonl"));
    const r = (await syncUpwork({
      store,
      tz: "America/Bogota",
      fetchAlerts: async () => mails.slice(0, 1),
      notify: async () => {},
      draft: async () => {
        throw new Error("sin perfil");
      },
      now: () => nowMs,
    }))!;
    assert.equal(r.notified, 1);
    assert.equal(r.drafted, 0);
    assert.match(r.errors[0], /sin perfil/);
  });
});
