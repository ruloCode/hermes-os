import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HIDDEN,
  hiddenTermsFor,
  promptFromParts,
  readsEnvFile,
  redactInventory,
  redactPrompt,
  redactText,
  redactTrace,
  sectionText,
  type TraceEvent,
} from "@hermes/shared";

const ctx = { hiddenTerms: ["careways", "Careways App"] };
const gone = (text: string, secret: string) => {
  const out = redactText(text, ctx);
  assert.ok(!out.includes(secret), `quedó a la vista: ${secret} en ${out}`);
  return out;
};

describe("vista pública: secretos", () => {
  it("llaves conocidas", () => {
    gone("OPENAI: sk-proj-abcDEF1234567890abcdefXYZ", "sk-proj-abcDEF1234567890abcdefXYZ");
    gone("anthropic sk-ant-api03-AAAABBBBCCCCDDDDEEEE", "sk-ant-api03-AAAABBBBCCCCDDDDEEEE");
    gone("token ghp_1234567890abcdefghijABCDEFGHIJ", "ghp_1234567890abcdefghijABCDEFGHIJ");
    gone("lin_api_ABCDEFGHIJKLMNOPQRSTUVWX12", "lin_api_ABCDEFGHIJKLMNOPQRSTUVWX12");
    gone("aws AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE");
    gone("xi sk_0123456789abcdef0123456789abcdef0123", "sk_0123456789abcdef0123456789abcdef0123");
  });

  it("JWT, Bearer, URL con credenciales y llave privada", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcDEF123456";
    gone(`SUPABASE=${jwt}`, jwt);
    gone("Authorization: Bearer abcdef1234567890ABCDEF", "abcdef1234567890ABCDEF");
    const out = gone("postgres://admin:hunter2pass@db.example.com:5432/app", "hunter2pass");
    assert.match(out, /db\.example\.com:5432\/app/);
    gone("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----", "MIIEow");
  });

  it("el VALOR de una variable con nombre de secreto (env, JSON, flags)", () => {
    const a = gone("SUPABASE_SERVICE_ROLE_KEY=abcd1234efgh5678", "abcd1234efgh5678");
    assert.match(a, /SUPABASE_SERVICE_ROLE_KEY=/);
    gone('{"api_key": "plainvalue123"}', "plainvalue123");
    gone("HERMES_APPROVAL_TOKEN=4f2a9c1d7e", "4f2a9c1d7e");
    gone("--api-key supersecretvalue", "supersecretvalue");
    gone("DB_PASSWORD: correcthorse", "correcthorse");
  });

  it("los secretos exactos que conoce el servidor, aunque no tengan forma de llave", () => {
    const out = redactText("valor raro: zq9-weird_value-77", { hiddenTerms: [], exactSecrets: ["zq9-weird_value-77"] });
    assert.ok(!out.includes("zq9-weird_value-77"));
  });
});

describe("vista pública: correos, teléfonos y clientes", () => {
  it("correos y teléfonos", () => {
    gone("Author: Rulo <rulocode7@gmail.com>", "rulocode7@gmail.com");
    gone("llámame al +57 300 123 4567", "300 123 4567");
    gone("cel 3001234567", "3001234567");
    gone("(415) 555-0123", "555-0123");
  });

  it("proyectos de clientes, en cualquier forma de escribirlos", () => {
    const out = redactText("cd /Users/x/dev/careways-app && echo Careways App y CAREWAYS", ctx);
    assert.ok(!/careways/i.test(out), out);
    assert.match(out, /\[cliente\]-app/);
  });

  it("el usuario de una ruta de home no se confunde con un proyecto del mismo nombre", () => {
    const out = redactText("/Users/rulocode/dev/side/rulocode/README.md y /home/rulocode/x", { hiddenTerms: ["rulocode"] });
    assert.equal(out, "/Users/rulocode/dev/side/[cliente]/README.md y /home/rulocode/x");
  });

  it("los términos ocultos salen de los proyectos que NO están en la lista pública", () => {
    const terms = hiddenTermsFor(
      [
        { slug: "hermes-os", name: "Hermes OS" },
        { slug: "careways", name: "Careways" },
        { slug: "app", name: "App" },
      ],
      { publicProjects: ["hermes-os"] },
    );
    assert.ok(terms.includes("careways"));
    assert.ok(!terms.includes("hermes-os"));
    // Términos de menos de 4 letras no se ocultan (taparían media pantalla).
    assert.ok(!terms.includes("app"));
  });
});

describe("vista pública: lo que SÍ pasa intacto", () => {
  const intact = [
    "pnpm test --filter @hermes/agent",
    "apps/web/src/components/oficina/TracePanel.tsx:120",
    "commit 3a087d7f1c2b4e5a6b7c8d9e0f1a2b3c4d5e6f7a",
    "session 0f8e2c4a-1b3d-4e5f-8a9b-0c1d2e3f4a5b",
    "2026-10-01T19:42:07.123Z",
    "http://localhost:8650/office/events",
    "claude-sonnet-5 · 2.1.286 · 12k tokens · 38 s",
    "max_tokens=100000",
    "1712345678901",
    "export const suma = (a: number, b: number) => a + b;",
    "Exit code 1 · 3 failing · 12 passing",
    "@@ -10,7 +10,8 @@ function x() {",
    "author: Rulo",
    "primary_key=True",
    "const tokens = countTokens(text);",
  ];
  for (const s of intact) {
    it(s, () => assert.equal(redactText(s, ctx), s));
  }
});

describe("vista pública: lecturas de .env", () => {
  it("detecta Read de un .env y un cat por Bash", () => {
    assert.equal(readsEnvFile("Read", JSON.stringify({ file_path: "/repo/.env" })), true);
    assert.equal(readsEnvFile("Read", JSON.stringify({ file_path: "/repo/.env.local" })), true);
    assert.equal(readsEnvFile("Bash", JSON.stringify({ command: "cat .env | head" })), true);
    assert.equal(readsEnvFile("Bash", JSON.stringify({ command: "env" })), true);
    assert.equal(readsEnvFile("Read", JSON.stringify({ file_path: "/repo/src/env.ts" })), false);
    assert.equal(readsEnvFile("Bash", JSON.stringify({ command: "pnpm test" })), false);
  });

  it("la salida entera de ese paso se oculta, aunque no parezca secreta", () => {
    const events: TraceEvent[] = [
      { seq: 1, t: 1, turn: 1, kind: "tool_use", tool: "Read", id: "u1", input: JSON.stringify({ file_path: ".env" }) },
      { seq: 2, t: 2, turn: 1, kind: "tool_result", tool: "Read", id: "u1", output: "NOMBRE=algo\nOTRA=cosa" },
      { seq: 3, t: 3, turn: 2, kind: "tool_use", tool: "Read", id: "u2", input: JSON.stringify({ file_path: "src/a.ts" }) },
      { seq: 4, t: 4, turn: 2, kind: "tool_result", tool: "Read", id: "u2", output: "export {}" },
    ];
    const out = redactTrace(events, ctx);
    assert.ok(!out[1].output?.includes("NOMBRE=algo"));
    assert.match(out[1].output ?? "", new RegExp(HIDDEN));
    assert.equal(out[3].output, "export {}");
    // No muta la traza original.
    assert.equal(events[1].output, "NOMBRE=algo\nOTRA=cosa");
  });
});

describe("vista pública: system prompt", () => {
  const parts = [
    { id: "identity", title: "Identidad", why: "w", text: "# Hermes\nEres Hermes. Correo: dueno@example.com" },
    { id: "soul", title: "SOUL.md", why: "w", personal: true, text: "# Sobre Ana (SOUL.md)\nMe gusta el café, vivo en Medellín" },
    { id: "projects", title: "Proyectos activos", why: "w", text: "# Proyectos activos\n## Hermes OS (hermes-os)\nva bien\n## Careways (careways)\nfactura del cliente X\n## Otro (otro)\nok" },
  ];
  const p = promptFromParts(parts, "\n\n---\n\n");
  const r = redactPrompt(p, { hiddenTerms: ["careways", "Careways"] });

  it("las secciones personales dejan el título y 'oculto en vista pública'", () => {
    const soul = sectionText(r, r.sections[1]);
    assert.equal(soul, `# Sobre Ana (SOUL.md)\n(${HIDDEN})`);
    assert.ok(!soul.includes("Medellín"));
  });

  it("el resto se redacta como texto y la subsección del cliente se vacía", () => {
    const projects = sectionText(r, r.sections[2]);
    assert.ok(!/careways|factura del cliente/i.test(projects), projects);
    assert.match(projects, /## Hermes OS \(hermes-os\)\nva bien/);
    assert.match(projects, /## Otro \(otro\)\nok/);
    assert.ok(!sectionText(r, r.sections[0]).includes("dueno@example.com"));
  });

  it("los rangos se recalculan y el separador original se conserva", () => {
    assert.equal(r.raw, r.sections.map((s) => sectionText(r, s)).join("\n\n---\n\n"));
    assert.equal(r.sections[0].why, "w");
  });
});

describe("vista pública: inventario", () => {
  it("las skills personales ocultan su descripción; las de Hermes se redactan como texto", () => {
    const inv = redactInventory(
      {
        mcp: [{ server: "linear", status: "connected", tools: [{ name: "list_issues", description: "Lista issues de careways" }] }],
        commands: [
          { name: "junta", description: "Procesa juntas con el cliente (Mónica/Jacobo) de Careways" },
          { name: "hermes:deploy", description: "Despliega hermes-os a producción" },
        ],
      },
      ctx,
    )!;
    assert.match(inv.commands[0].description, new RegExp(HIDDEN));
    assert.ok(!inv.commands[0].description.includes("Mónica"));
    assert.equal(inv.commands[1].description, "Despliega hermes-os a producción");
    assert.equal(inv.mcp[0].tools[0].description, "Lista issues de [cliente]");
  });
});
