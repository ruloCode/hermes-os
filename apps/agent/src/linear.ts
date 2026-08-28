import { env } from "./env.js";
import { readProjects } from "./vault/projects.js";

/**
 * Integración con Linear (manejo de tareas). API GraphQL oficial con una
 * personal API key (header Authorization SIN "Bearer", así lo pide Linear).
 * El agente crea issues con el contexto real del proyecto y un bloque
 * "Copy prompt" al final: un fence de código (Linear le pone botón de copiar
 * nativo) con el prompt autocontenido listo para pegar en Claude Code.
 */

const LINEAR_API = "https://api.linear.app/graphql";

export function linearEnabled(): boolean {
  return Boolean(env.LINEAR_API_KEY);
}

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: env.LINEAR_API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = (await res.json().catch(() => null)) as
    | { data?: T; errors?: { message: string }[] }
    | null;
  if (!res.ok || !json || json.errors?.length) {
    const detail = json?.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`Linear API: ${detail}`);
  }
  return json.data as T;
}

export type LinearTeam = { id: string; key: string; name: string };

let teamsCache: { at: number; teams: LinearTeam[] } | null = null;

export async function listLinearTeams(): Promise<LinearTeam[]> {
  if (teamsCache && Date.now() - teamsCache.at < 10 * 60_000) return teamsCache.teams;
  const data = await gql<{ teams: { nodes: LinearTeam[] } }>(
    `query { teams { nodes { id key name } } }`,
  );
  teamsCache = { at: Date.now(), teams: data.teams.nodes };
  return data.teams.nodes;
}

/** Resuelve el team por key o nombre; default: LINEAR_TEAM_KEY o el único/primer team. */
async function resolveTeam(teamKey?: string): Promise<LinearTeam> {
  const teams = await listLinearTeams();
  if (!teams.length) throw new Error("El workspace de Linear no tiene teams.");
  const wanted = (teamKey || env.LINEAR_TEAM_KEY || "").trim().toLowerCase();
  if (!wanted) return teams[0];
  const found = teams.find(
    (t) => t.key.toLowerCase() === wanted || t.name.toLowerCase() === wanted,
  );
  if (!found)
    throw new Error(
      `Team "${teamKey || env.LINEAR_TEAM_KEY}" no existe en Linear. Disponibles: ${teams.map((t) => t.key).join(", ")}`,
    );
  return found;
}

/** Busca un label por nombre (case-insensitive) o lo crea en el team. */
async function findOrCreateLabel(teamId: string, name: string): Promise<string | null> {
  const found = await gql<{ issueLabels: { nodes: { id: string }[] } }>(
    `query($name: String!) { issueLabels(filter: { name: { eqIgnoreCase: $name } }) { nodes { id } } }`,
    { name },
  );
  if (found.issueLabels.nodes[0]) return found.issueLabels.nodes[0].id;
  const created = await gql<{ issueLabelCreate: { issueLabel: { id: string } | null } }>(
    `mutation($input: IssueLabelCreateInput!) { issueLabelCreate(input: $input) { issueLabel { id } } }`,
    { input: { name, teamId } },
  );
  return created.issueLabelCreate.issueLabel?.id ?? null;
}

/**
 * Resuelve el slug del vault al proyecto de Linear (espejo 1:1 creado el
 * 2026-07-16). Matchea por el nombre canónico del vault (video-edit →
 * "OpenMontage"); si el proyecto no existe en Linear todavía, lo crea.
 */
async function resolveProjectId(teamId: string, slug: string): Promise<string | null> {
  const vault = await readProjects().catch(() => []);
  const name =
    vault.find((p) => p.slug.toLowerCase() === slug.toLowerCase())?.name ?? slug;
  const found = await gql<{ projects: { nodes: { id: string }[] } }>(
    `query($name: String!) { projects(filter: { name: { eqIgnoreCase: $name } }, first: 1) { nodes { id } } }`,
    { name },
  );
  if (found.projects.nodes[0]) return found.projects.nodes[0].id;
  const created = await gql<{ projectCreate: { project: { id: string } | null } }>(
    `mutation($input: ProjectCreateInput!) { projectCreate(input: $input) { project { id } } }`,
    {
      input: {
        name,
        teamIds: [teamId],
        description: `Proyecto activo del vault de Hermes (slug: ${slug}).`,
        state: "started",
      },
    },
  );
  return created.projectCreate.project?.id ?? null;
}

export const LINEAR_PRIORITIES = ["urgent", "high", "normal", "low"] as const;
export type LinearPriority = (typeof LINEAR_PRIORITIES)[number];
const PRIORITY_VALUE: Record<LinearPriority, number> = { urgent: 1, high: 2, normal: 3, low: 4 };

/** Sección "Copy prompt": fence con botón de copiar nativo en la UI de Linear. */
function copyPromptSection(prompt: string): string {
  // Si el prompt trae fences de ``` adentro, subimos a un fence de 4 backticks.
  const fence = prompt.includes("```") ? "````" : "```";
  return `## 🤖 Copy prompt\n\nPégalo directo en Claude Code (o en la consola de Hermes):\n\n${fence}text\n${prompt.trim()}\n${fence}`;
}

export type CreateIssueInput = {
  title: string;
  description: string;
  prompt: string;
  teamKey?: string;
  /** Slug del proyecto del vault; se resuelve al proyecto de Linear (se crea si falta). */
  project?: string;
  priority?: LinearPriority;
  labels?: string[];
};

export type CreatedIssue = { identifier: string; title: string; url: string };

export async function createLinearIssue(input: CreateIssueInput): Promise<CreatedIssue> {
  const team = await resolveTeam(input.teamKey);

  const labelIds = (
    await Promise.all(
      [...new Set(input.labels ?? [])].map((name) =>
        findOrCreateLabel(team.id, name).catch(() => null),
      ),
    )
  ).filter((id): id is string => Boolean(id));

  // El proyecto de Linear es el espejo del vault; si no resuelve, el issue
  // sale sin proyecto en vez de fallar (mejor un issue suelto que perderlo).
  const projectId = input.project
    ? await resolveProjectId(team.id, input.project).catch(() => null)
    : null;

  const description = `${input.description.trim()}\n\n${copyPromptSection(input.prompt)}\n`;

  const data = await gql<{
    issueCreate: { success: boolean; issue: CreatedIssue | null };
  }>(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) { success issue { identifier title url } }
    }`,
    {
      input: {
        teamId: team.id,
        title: input.title,
        description,
        priority: PRIORITY_VALUE[input.priority ?? "normal"],
        ...(labelIds.length ? { labelIds } : {}),
        ...(projectId ? { projectId } : {}),
      },
    },
  );
  if (!data.issueCreate.success || !data.issueCreate.issue)
    throw new Error("Linear no confirmó la creación del issue.");
  return data.issueCreate.issue;
}

export type LinearIssue = {
  identifier: string;
  title: string;
  url: string;
  priority: number;
  updatedAt: string;
  state: { name: string; type: string };
  labels: { nodes: { name: string }[] };
  project: { name: string } | null;
  /** true si el description trae bloque "Copy prompt" (listo para ejecutar). */
  hasPrompt: boolean;
};

export async function listLinearIssues(opts: {
  teamKey?: string;
  project?: string;
  includeDone?: boolean;
  limit?: number;
}): Promise<LinearIssue[]> {
  const filter: Record<string, unknown> = {};
  if (opts.teamKey || env.LINEAR_TEAM_KEY) {
    const team = await resolveTeam(opts.teamKey);
    filter.team = { key: { eq: team.key } };
  }
  if (opts.project) {
    const vault = await readProjects().catch(() => []);
    const name =
      vault.find((p) => p.slug.toLowerCase() === opts.project!.toLowerCase())?.name ??
      opts.project;
    filter.project = { name: { eqIgnoreCase: name } };
  }
  if (!opts.includeDone) filter.state = { type: { nin: ["completed", "canceled"] } };
  type Row = Omit<LinearIssue, "hasPrompt"> & { description: string | null };
  const data = await gql<{ issues: { nodes: Row[] } }>(
    `query($filter: IssueFilter, $first: Int!) {
      issues(filter: $filter, first: $first, orderBy: updatedAt) {
        nodes {
          identifier title url priority updatedAt description
          state { name type }
          labels { nodes { name } }
          project { name }
        }
      }
    }`,
    { filter, first: Math.min(opts.limit ?? 25, 50) },
  );
  return data.issues.nodes.map(({ description, ...rest }) => ({
    ...rest,
    hasPrompt: extractCopyPrompt(description ?? "") != null,
  }));
}

// ── Detalle, estados y comentarios (tablero Linear-first del dashboard) ──

export type LinearIssueDetail = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  url: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  state: { id: string; name: string; type: string };
  project: { name: string } | null;
  labels: { nodes: { name: string }[] };
  /** Contenido del bloque "Copy prompt" del description (null si no trae). */
  copyPrompt: string | null;
};

/** Extrae el contenido del fence de la sección "Copy prompt" del description. */
export function extractCopyPrompt(description: string): string | null {
  const section = description.split(/^##\s.*copy prompt.*$/im)[1];
  if (!section) return null;
  const fence = section.match(/^(`{3,})[^\n]*\n([\s\S]*?)^\1/m);
  return fence ? fence[2].trim() : null;
}

export async function getLinearIssue(identifier: string): Promise<LinearIssueDetail> {
  const data = await gql<{ issue: Omit<LinearIssueDetail, "copyPrompt"> & { description: string | null } }>(
    `query($id: String!) {
      issue(id: $id) {
        id identifier title description url priority createdAt updatedAt
        state { id name type }
        project { name }
        labels { nodes { name } }
      }
    }`,
    { id: identifier },
  );
  const description = data.issue.description ?? "";
  return { ...data.issue, description, copyPrompt: extractCopyPrompt(description) };
}

type WorkflowState = { id: string; name: string; type: string; position: number };
let statesCache: { at: number; byTeam: Map<string, WorkflowState[]> } | null = null;

async function teamStates(teamId: string): Promise<WorkflowState[]> {
  if (!statesCache || Date.now() - statesCache.at > 10 * 60_000)
    statesCache = { at: Date.now(), byTeam: new Map() };
  const hit = statesCache.byTeam.get(teamId);
  if (hit) return hit;
  const data = await gql<{ team: { states: { nodes: WorkflowState[] } } }>(
    `query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }`,
    { id: teamId },
  );
  const states = data.team.states.nodes.sort((a, b) => a.position - b.position);
  statesCache.byTeam.set(teamId, states);
  return states;
}

/**
 * Mueve un issue a un estado por TIPO de workflow ("unstarted" = Todo,
 * "started" = In Progress, "completed" = Done…). Usa el primer estado de ese
 * tipo en el team (orden visual de Linear).
 */
export async function updateIssueState(
  identifier: string,
  stateType: "backlog" | "unstarted" | "started" | "completed" | "canceled",
): Promise<{ identifier: string; state: string }> {
  const issue = await gql<{ issue: { id: string; team: { id: string } } }>(
    `query($id: String!) { issue(id: $id) { id team { id } } }`,
    { id: identifier },
  );
  const states = await teamStates(issue.issue.team.id);
  const target = states.find((s) => s.type === stateType);
  if (!target) throw new Error(`El team no tiene estados de tipo "${stateType}".`);
  await gql(
    `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
    { id: issue.issue.id, input: { stateId: target.id } },
  );
  return { identifier, state: target.name };
}

export async function commentOnIssue(identifier: string, body: string): Promise<void> {
  const issue = await gql<{ issue: { id: string } }>(
    `query($id: String!) { issue(id: $id) { id } }`,
    { id: identifier },
  );
  await gql(
    `mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`,
    { input: { issueId: issue.issue.id, body } },
  );
}

const PRIORITY_LABEL = ["—", "urgente", "alta", "media", "baja"];

export function linearIssuesToText(issues: LinearIssue[]): string {
  return issues
    .map((i) => {
      const labels = i.labels.nodes.map((l) => l.name).join(",");
      const project = i.project?.name ? ` proyecto:${i.project.name}` : "";
      return `${i.identifier} · ${i.title} [${i.state.name}]${project} prioridad:${PRIORITY_LABEL[i.priority] ?? "—"}${labels ? ` labels:${labels}` : ""}\n  ${i.url}`;
    })
    .join("\n");
}
