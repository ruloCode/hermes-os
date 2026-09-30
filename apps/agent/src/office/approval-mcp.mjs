#!/usr/bin/env node
// Puente de aprobaciones para `claude -p` (--permission-prompt-tool).
//
// Un run de claude -p no tiene a quién preguntarle: lo que pediría permiso se
// niega solo. Con este servidor MCP (stdio, sin dependencias: JSON-RPC por
// líneas) el CLI le PREGUNTA al agente de Hermes antes de ejecutar, y el agente
// pausa el run hasta que el humano decide en la Oficina.
//
// Lo lanza el CLI (no el agente), así que corre como hijo del run y con el env
// que le pasa --mcp-config: la URL del agente, un token de ESTE run y su id. El
// token solo sirve para PEDIR y leer la decisión de sus propias solicitudes:
// el run nunca puede aprobarse a sí mismo.
//
// HERMES_APPROVAL_FAKE=allow|deny responde sin agente (prueba del contrato).

import { createInterface } from "node:readline";

const URL_BASE = process.env.HERMES_APPROVAL_URL ?? "";
const TOKEN = process.env.HERMES_APPROVAL_TOKEN ?? "";
const RUN_ID = process.env.HERMES_APPROVAL_RUN ?? "";
const FAKE = process.env.HERMES_APPROVAL_FAKE ?? "";
const POLL_MS = 700;

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

const deny = (message) => ({ behavior: "deny", message });

async function http(method, path, body) {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Hermes-Approval": TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

/** Pide la decisión al agente y espera (el agente aplica el tope de espera). */
async function decide(toolName, input) {
  if (FAKE === "allow") return { behavior: "allow", updatedInput: input };
  if (FAKE === "deny") return deny("Negado (modo de prueba)");
  if (!URL_BASE || !TOKEN) return deny("Aprobaciones sin configurar: no hay a quién preguntarle");
  try {
    const first = await http("POST", "/office/approvals/ask", { run: RUN_ID, tool_name: toolName, input });
    if (first.decision) return first.decision;
    for (;;) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const s = await http("GET", `/office/approvals/${encodeURIComponent(first.id)}`);
      if (s.decision) return s.decision;
    }
  } catch (err) {
    return deny(`No se pudo pedir aprobación al agente: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const TOOL = {
  name: "ask",
  description: "Pide al humano, en la Oficina de Hermes, permiso para usar una tool.",
  inputSchema: {
    type: "object",
    properties: {
      tool_name: { type: "string" },
      input: { type: "object" },
      tool_use_id: { type: "string" },
    },
    required: ["tool_name", "input"],
  },
};

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notificaciones (initialized, cancelled)
  switch (method) {
    case "initialize":
      result(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "hermes-approval", version: "1.0.0" },
      });
      return;
    case "ping":
      result(id, {});
      return;
    case "tools/list":
      result(id, { tools: [TOOL] });
      return;
    case "tools/call": {
      const args = params?.arguments ?? {};
      const decision = await decide(String(args.tool_name ?? ""), args.input ?? {});
      result(id, { content: [{ type: "text", text: JSON.stringify(decision) }] });
      return;
    }
    default:
      send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  }
});
