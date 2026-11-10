/**
 * De la entrada de la tool `Skill` al nombre de una skill de Hermes (hook
 * PostToolUse → recordSkillUse). Puro.
 *
 * Por qué importa: recordSkillUse no tenía ningún llamador, así que el curador
 * veía cada skill como "sin uso" y archivaba a los 45 días una que se cargaba a
 * diario.
 *
 * Las de Hermes viven en el plugin local "hermes" y el CLI las invoca como
 * `hermes:<nombre>`. Las integradas del CLI (dataviz, code-review…) y las de
 * otros plugins no son de Hermes: contarlas crearía filas de uso de skills que
 * el curador no maneja. Un nombre sin prefijo cuenta solo si existe en el
 * plugin (`isHermesSkill`).
 */

export const HERMES_PLUGIN = "hermes";

export function skillUseName(input: unknown, isHermesSkill: (name: string) => boolean): string | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const raw = [o.skill, o.command, o.name].find((v): v is string => typeof v === "string" && v.trim() !== "");
  if (!raw) return null;
  // "/hermes:pedir-indrive args…" → "hermes:pedir-indrive"
  const token = raw.trim().replace(/^\/+/, "").split(/\s+/)[0] ?? "";
  const colon = token.indexOf(":");
  if (colon >= 0) {
    const plugin = token.slice(0, colon);
    const name = token.slice(colon + 1);
    return plugin === HERMES_PLUGIN && name ? name : null;
  }
  return isHermesSkill(token) ? token : null;
}
