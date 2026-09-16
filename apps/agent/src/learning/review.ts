import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { env } from "../env.js";
import { OWNER } from "../owner.js";
import { childEnv } from "../agent/child-env.js";
import { profileEntries, PROFILE_MAX_CHARS } from "../profile.js";
import { listSkills } from "./skills.js";
import { saveProposal } from "./curator.js";

/**
 * Revisión en background: después de un turno con señal, un modelo BARATO
 * relee lo que pasó y se pregunta "¿esto se repite? ¿aprendí algo del dueño?".
 *
 * Por qué así y no dentro del turno:
 * - No toca la conversación principal ni su prefijo cacheado. Corre aparte,
 *   con su propio proceso, y lo que produce entra en la SIGUIENTE sesión.
 * - Nunca escribe directo: emite PROPUESTAS que el humano aprueba
 *   (HERMES_LEARNING=auto las aplica solo). Un agente que se reescribe el
 *   perfil sin permiso es un agente en el que dejas de confiar.
 * - Presupuesto duro: pocos turnos, sin tools de sistema. La revisión debe
 *   costar una fracción del turno que revisa, o no vale la pena.
 */

/** Tope de turnos de la revisión: es una lectura, no una tarea. */
const MAX_TURNS = 6;
/** Debajo de esto no hubo trabajo que valga la pena revisar. */
const MIN_CHARS = 400;

export function learningEnabled(): boolean {
  return env.LEARNING !== "off";
}

function autoApply(): boolean {
  return env.LEARNING === "auto";
}

export interface ReviewInput {
  /** Lo que pidió el dueño. */
  userText: string;
  /** Lo que respondió/hizo Hermes (texto final o transcript resumido). */
  assistantText: string;
  /** Nombres de tools usadas en el turno: la señal de "esto fue un procedimiento". */
  tools?: string[];
  source: "chat" | "task" | "run" | "scheduled";
  sourceRef?: string;
}

/** ¿Vale la pena gastar una revisión en este turno? */
export function worthReviewing(input: ReviewInput): boolean {
  if (!learningEnabled()) return false;
  const total = input.userText.length + input.assistantText.length;
  if (total < MIN_CHARS) return false;
  // Una corrección explícita SIEMPRE se revisa: es la señal más valiosa.
  if (/\b(no,|en realidad|corrige|está mal|equivocaste|prefiero|te dije)\b/i.test(input.userText)) return true;
  // Si no hubo tools ni texto sustancioso, fue charla.
  return (input.tools?.length ?? 0) >= 2 || total > 1500;
}

function buildPrompt(input: ReviewInput, skills: string, profile: string): string {
  return `Eres el revisor de aprendizaje de Hermes, el AI OS personal de ${OWNER}.

Acaba de terminar un turno. Tu ÚNICO trabajo es decidir si de ahí sale algo que valga la pena conservar para el futuro, y proponerlo con las tools. No respondas al turno ni continúes el trabajo.

## El turno
<pidio>
${input.userText.slice(0, 4000)}
</pidio>

<hizo>
${input.assistantText.slice(0, 8000)}
</hizo>

${input.tools?.length ? `Tools usadas: ${input.tools.slice(0, 40).join(", ")}` : "No usó tools."}

## Lo que Hermes ya sabe
Skills existentes (no dupliques; si una se quedó corta, propón un patch):
${skills || "(ninguna todavía)"}

Perfil actual de ${OWNER} (tope ${PROFILE_MAX_CHARS} chars, así que solo lo que de verdad cambia cómo trabajar):
${profile || "(vacío)"}

## Qué proponer
- propose_skill: SOLO si el turno resolvió un procedimiento multi-paso que se va a repetir. Cuerpo en markdown con "## Cuándo usarla", los pasos concretos, y "## Verificación" (cómo saber que salió bien). La description manda: una frase de máximo 120 caracteres que diga CUÁNDO usarla, sin adjetivos de marketing.
- propose_profile: SOLO si aprendiste algo duradero sobre ${OWNER} o cómo le gusta trabajar. Una línea. Si contradice una entrada existente, pasa "find" con un fragmento de la vieja para reemplazarla.
- propose_memory: un hecho concreto que conviene recordar y que no es procedimiento.

## Reglas
- Lo normal es NO proponer nada. Un turno ordinario no deja aprendizaje.
- Nada de detalles efímeros (rutas de un archivo temporal, el clima, un id).
- Nada que ya esté en las skills o el perfil de arriba.
- Como máximo 2 propuestas.
- Cuando termines, responde solo "listo".`;
}

/**
 * Revisa un turno y emite propuestas. No lanza: un fallo de la revisión
 * jamás puede afectar al turno que la originó.
 */
export async function reviewTurn(input: ReviewInput): Promise<number> {
  if (!worthReviewing(input)) return 0;

  let proposals = 0;
  const auto = autoApply();
  const record = async (
    kind: "skill_create" | "skill_patch" | "profile" | "memory",
    title: string,
    payload: Record<string, unknown>,
    rationale: string,
  ) => {
    proposals += 1;
    await saveProposal(
      {
        kind,
        title,
        payload,
        rationale,
        source: input.source,
        source_ref: input.sourceRef ?? null,
      },
      auto,
    );
    return auto
      ? `Propuesta aplicada: ${title}`
      : `Propuesta guardada para revisión de ${OWNER}: ${title}`;
  };

  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

  const reviewServer = createSdkMcpServer({
    name: "learning",
    version: "0.1.0",
    tools: [
      tool(
        "propose_skill",
        "Propone guardar un procedimiento repetible como skill (o parchear una existente).",
        {
          name: z.string().describe("minúsculas-con-guiones, ej: publicar-pieza-estudio"),
          description: z.string().max(120).describe("Cuándo usarla, en una frase de máx 120 chars"),
          body: z.string().describe("Markdown con ## Cuándo usarla, los pasos y ## Verificación"),
          rationale: z.string().describe("Por qué este turno amerita una skill"),
          patch_of: z.string().optional().describe("Nombre de la skill a parchear, si mejora una existente"),
          find: z.string().optional().describe("Con patch_of: fragmento EXACTO a reemplazar"),
        },
        async (a) =>
          text(
            a.patch_of && a.find
              ? await record(
                  "skill_patch",
                  `Mejorar skill "${a.patch_of}"`,
                  { name: a.patch_of, find: a.find, replace: a.body },
                  a.rationale,
                )
              : await record(
                  "skill_create",
                  `Nueva skill "${a.name}"`,
                  { name: a.name, description: a.description, body: a.body },
                  a.rationale,
                ),
          ),
      ),
      tool(
        "propose_profile",
        `Propone una entrada para el perfil de ${OWNER} (algo duradero sobre él o cómo trabaja).`,
        {
          entry: z.string().max(200).describe("Una línea, autocontenida"),
          rationale: z.string(),
          find: z.string().optional().describe("Fragmento de la entrada vieja que esta reemplaza"),
        },
        async (a) =>
          text(await record("profile", `Perfil: ${a.entry.slice(0, 60)}`, { entry: a.entry, find: a.find }, a.rationale)),
      ),
      tool(
        "propose_memory",
        "Propone guardar un hecho concreto en la memoria de largo plazo.",
        {
          content: z.string().describe("El hecho, autocontenido"),
          type: z.enum(["user", "feedback", "project", "reference", "agent"]),
          project: z.string().optional(),
          rationale: z.string(),
        },
        async (a) =>
          text(
            await record(
              "memory",
              `Memoria: ${a.content.slice(0, 60)}`,
              { content: a.content, type: a.type, project: a.project },
              a.rationale,
            ),
          ),
      ),
    ],
  });

  try {
    const [skills, profile] = await Promise.all([listSkills(), profileEntries()]);
    const skillIndex = skills
      .filter((s) => s.state !== "archived")
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");

    const q = query({
      prompt: buildPrompt(input, skillIndex, profile.map((e) => `- ${e}`).join("\n")),
      options: {
        model: env.LEARNING_MODEL,
        maxTurns: MAX_TURNS,
        // Sin cwd del proyecto ni settings: la revisión no lee el disco.
        settingSources: [],
        env: childEnv(),
        mcpServers: { learning: reviewServer },
        // Solo sus tres tools. Sin Bash, sin Read, sin red: sin superficie.
        allowedTools: [
          "mcp__learning__propose_skill",
          "mcp__learning__propose_profile",
          "mcp__learning__propose_memory",
        ],
        permissionMode: "default",
        canUseTool: async (name, i) =>
          name.startsWith("mcp__learning__")
            ? { behavior: "allow", updatedInput: i }
            : { behavior: "deny", message: "La revisión de aprendizaje solo puede proponer." },
      },
    });
    for await (const _ of q) {
      /* consumimos el stream; el trabajo ocurre en las tools */
    }
  } catch (err) {
    console.error("[hermes] learning review:", String(err).slice(0, 200));
  }
  return proposals;
}

/** Dispara la revisión sin bloquear al que la llama. */
export function reviewTurnInBackground(input: ReviewInput): void {
  if (!worthReviewing(input)) return;
  void reviewTurn(input).catch((err) =>
    console.error("[hermes] learning review bg:", String(err).slice(0, 200)),
  );
}
