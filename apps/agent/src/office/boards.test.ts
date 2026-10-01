import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  boardIssues,
  githubRepoOf,
  isDevService,
  issueColumn,
  parseGhPrs,
  parseLsofListen,
  projectForPath,
  sortServices,
  type BoardService,
} from "@hermes/shared";

describe("tablero de issues", () => {
  it("cada tipo de estado de Linear va a su columna y los cancelados se quedan fuera", () => {
    assert.equal(issueColumn("backlog"), "todo");
    assert.equal(issueColumn("unstarted"), "todo");
    assert.equal(issueColumn("started"), "doing");
    assert.equal(issueColumn("completed"), "done");
    assert.equal(issueColumn("canceled"), null);
  });

  it("convierte los issues sin inventar nada y ordena por el más reciente", () => {
    const items = boardIssues([
      { identifier: "RUL-1", title: "Viejo", url: "u1", priority: 2, updatedAt: "2026-09-01T00:00:00Z", state: { name: "Todo", type: "unstarted" }, project: null },
      { identifier: "RUL-2", title: "Nuevo", url: "u2", priority: 1, updatedAt: "2026-09-30T00:00:00Z", state: { name: "In Progress", type: "started" }, project: { name: "Hermes OS" }, hasPrompt: true },
      { identifier: "RUL-3", title: "Cancelado", url: "u3", priority: 0, updatedAt: "2026-09-29T00:00:00Z", state: { name: "Canceled", type: "canceled" }, project: null },
    ]);
    assert.deepEqual(items.map((i) => i.id), ["RUL-2", "RUL-1"]);
    assert.equal(items[0].column, "doing");
    assert.equal(items[0].ready, true);
    assert.equal(items[0].project, "Hermes OS");
    assert.equal(items[1].ready, false);
  });
});

describe("tablero de PRs", () => {
  it("lee el JSON de gh y descarta filas incompletas", () => {
    const prs = parseGhPrs(
      JSON.stringify([
        { number: 12, title: "Arregla login", url: "https://github.com/a/b/pull/12", isDraft: true, updatedAt: "2026-09-30T10:00:00Z", author: { login: "rulo" } },
        { title: "sin número" },
      ]),
      "a/b",
      "b",
    );
    assert.equal(prs.length, 1);
    assert.deepEqual(prs[0], { repo: "a/b", project: "b", number: 12, title: "Arregla login", author: "rulo", url: "https://github.com/a/b/pull/12", draft: true, updatedAt: "2026-09-30T10:00:00Z" });
    assert.deepEqual(parseGhPrs("no es json", "a/b", "b"), []);
  });

  it("reconoce repos de GitHub por https o ssh y nada más", () => {
    assert.equal(githubRepoOf("https://github.com/ruloCode/hermes-os.git\n"), "ruloCode/hermes-os");
    assert.equal(githubRepoOf("git@github.com:ruloCode/hermes-os.git"), "ruloCode/hermes-os");
    assert.equal(githubRepoOf("https://gitlab.com/x/y.git"), null);
  });
});

describe("tablero de servicios", () => {
  const LSOF = ["p101", "cnode", "f23", "n*:8650", "f24", "n[::1]:8650", "p202", "cSpotify", "f5", "n*:57621", "p303", "cnext-serv", "f9", "n127.0.0.1:3000", "p404", "cnode", "f3", "n127.0.0.1:61234", ""].join("\n");

  it("lee lsof -F: un socket por (pid, puerto), aunque escuche en IPv4 e IPv6", () => {
    const s = parseLsofListen(LSOF);
    assert.deepEqual(s.map((x) => `${x.process}:${x.port}`), ["node:8650", "Spotify:57621", "next-serv:3000", "node:61234"]);
  });

  it("solo cuenta servidores de desarrollo en puertos registrados", () => {
    const dev = parseLsofListen(LSOF).filter(isDevService);
    assert.deepEqual(dev.map((x) => x.port), [8650, 3000]);
  });

  it("el proyecto es la carpeta más específica que contiene al proceso", () => {
    const roots = [
      { slug: "hermes-os", root: "/Users/x/dev/hermes-os" },
      { slug: "web", root: "/Users/x/dev/hermes-os/apps/web" },
    ];
    assert.equal(projectForPath("/Users/x/dev/hermes-os/apps/web", roots), "web");
    assert.equal(projectForPath("/Users/x/dev/hermes-os/apps/agent", roots), "hermes-os");
    assert.equal(projectForPath("/Users/x/dev/hermes-os-old", roots), null);
  });

  it("ordena: primero Hermes, luego proyectos conocidos, luego por puerto", () => {
    const base = { process: "node", pid: 1, url: "" };
    const items: BoardService[] = [
      { ...base, port: 5173, project: null, role: null },
      { ...base, port: 3000, project: "web", role: null },
      { ...base, port: 8650, project: "hermes-os", role: "agente de Hermes" },
    ];
    assert.deepEqual(sortServices(items).map((s) => s.port), [8650, 3000, 5173]);
  });
});
