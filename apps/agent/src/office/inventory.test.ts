import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TraceRecorder, buildInventory, cliPermission, reduceTrace, sdkPermission, toolOrigin, type SdkAgentConfig } from "@hermes/shared";

const sdk: SdkAgentConfig = {
  allowedTools: ["Read", "Grep", "mcp__hermes__search_knowledge", "mcp__linear"],
  guardedTools: ["Bash", "Write", "Edit", "NotebookEdit"],
  checkedPrefixes: [{ prefix: "mcp__chrome-devtools__", note: "asegura Chrome" }],
  approvalTools: ["Bash"],
  permissionMode: "default",
  mcpServers: ["hermes", "linear", "chrome-devtools"],
};

describe("origen de cada tool", () => {
  it("por el nombre real", () => {
    assert.equal(toolOrigin("Read").origin, "cli");
    assert.equal(toolOrigin("mcp__hermes__save_memory").origin, "hermes");
    assert.equal(toolOrigin("mcp__linear__list_issues").origin, "linear");
    assert.equal(toolOrigin("mcp__chrome-devtools__click").origin, "chrome");
    assert.deepEqual(toolOrigin("mcp__otro__x"), { origin: "mcp", server: "otro" });
  });
});

describe("permiso en tareas del SDK (la configuración de session.ts)", () => {
  it("allowedTools = libre; el prefijo pelado de un servidor cubre todas sus tools", () => {
    assert.equal(sdkPermission("Read", sdk).permission, "free");
    assert.equal(sdkPermission("mcp__linear__update_issue", sdk).permission, "free");
  });
  it("Bash y escrituras pasan por el guardrail; Bash además pide permiso si miras", () => {
    assert.equal(sdkPermission("Bash", sdk).permission, "guardrail");
    assert.match(sdkPermission("Bash", sdk).note, /levanta la mano/);
    assert.equal(sdkPermission("Edit", sdk).permission, "guardrail");
    assert.doesNotMatch(sdkPermission("Edit", sdk).note, /levanta la mano/);
  });
  it("chrome-devtools se revisa en canUseTool; lo demás pasa por canUseTool sin restricción", () => {
    assert.equal(sdkPermission("mcp__chrome-devtools__navigate_page", sdk).permission, "checked");
    assert.equal(sdkPermission("Task", sdk).permission, "checked");
  });
});

describe("permiso en runs de claude -p (según el modo del init)", () => {
  it("Plan niega lo que no es lectura; Auto deja decidir al clasificador; Editar acepta ediciones", () => {
    assert.equal(cliPermission("Edit", "plan").permission, "denied-by-mode");
    assert.equal(cliPermission("Bash", "plan").permission, "denied-by-mode");
    assert.equal(cliPermission("Bash", "auto").permission, "checked");
    assert.equal(cliPermission("Edit", "acceptEdits").permission, "free");
    assert.equal(cliPermission("Bash", "acceptEdits").permission, "asks");
    assert.equal(cliPermission("Edit", "manual").permission, "asks");
    assert.equal(cliPermission("Read", "manual").permission, "free");
  });
  it("cita las reglas deny que aplican a esa tool", () => {
    assert.match(cliPermission("Read", "auto", ["Read(./.env)", "Bash(sudo:*)"]).note, /Read\(\.\/\.env\)/);
  });
});

describe("inventario en vivo", () => {
  const rec = new TraceRecorder("sdk");
  const events = [
    ...rec.ingest({ type: "system", subtype: "init", tools: ["Read", "Bash", "mcp__hermes__search_knowledge", "mcp__linear__list_issues", "Skill"], skills: ["hermes:deploy", "hermes:otra"], mcp_servers: [], slash_commands: [], plugins: [] }, 1),
    ...rec.ingest({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "u1", name: "mcp__hermes__search_knowledge", input: { query: "x" } }] } }, 2),
    ...rec.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: "ok" }] } }, 3),
    ...rec.ingest({ type: "assistant", message: { id: "m2", content: [{ type: "tool_use", id: "u2", name: "Skill", input: { skill: "hermes:deploy" } }, { type: "tool_use", id: "u3", name: "Bash", input: { command: "pnpm test" } }] } }, 4),
    ...rec.ingest({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u2", content: "cargada" }] } }, 5),
  ];
  const reduced = reduceTrace(events);
  const cards = buildInventory({
    source: "sdk",
    sdk,
    reduced,
    hermesTools: [{ name: "search_knowledge", description: "Busca en todo lo que Hermes sabe" }],
    capture: { mcp: [{ server: "linear", status: "connected", tools: [{ name: "list_issues", description: "List issues in Linear" }] }], commands: [{ name: "hermes:deploy", description: "Despliega a producción" }] },
  });
  const card = (name: string) => cards.find((c) => c.name === name)!;

  it("las tools que el modelo tuvo salen del init, con su descripción real", () => {
    assert.equal(card("mcp__hermes__search_knowledge").description, "Busca en todo lo que Hermes sabe");
    assert.equal(card("mcp__linear__list_issues").description, "List issues in Linear");
    // La descripción de una tool integrada del CLI no se expone: null, no un texto inventado.
    assert.equal(card("Read").description, null);
  });

  it("cuenta en qué pasos la usó y resalta la que está en uso", () => {
    assert.deepEqual(card("mcp__hermes__search_knowledge").steps, [1]);
    assert.equal(card("Bash").active, true);
    assert.equal(card("Read").steps.length, 0);
  });

  it("las skills dicen su description y si se cargaron en este run", () => {
    assert.equal(card("hermes:deploy").origin, "skill");
    assert.equal(card("hermes:deploy").loaded, true);
    assert.equal(card("hermes:deploy").description, "Despliega a producción");
    assert.equal(card("hermes:otra").loaded, false);
  });

  it("lo activo y lo más usado va primero", () => {
    assert.equal(cards[0].name, "Bash");
  });
});
