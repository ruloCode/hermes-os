// Apariencia del personaje del dueño en la Oficina: piel, pelo, peinado y
// camiseta. Se elige en el selector del HUD y vive en el navegador
// (localStorage): es preferencia de quien mira, no dato del agente.
//
// Paletas de agent-office (AgentSystemLabs, MIT — src/shared/avatar.ts).

export const SKIN_TONES = ["#ffe3cc", "#ffd7b5", "#f1c27d", "#e0ac69", "#c68642", "#a0663a", "#8d5524", "#5c3a21"];
export const HAIR_COLORS = ["#2b2d42", "#4a3222", "#6f4e37", "#e9c46a", "#c1440e", "#d9d9d9", "#d62828", "#ff8fab", "#9d4edd", "#264653"];
export const HAIR_STYLES = ["Corto", "Largo", "Moño", "Puntas", "Rizado", "Cola", "Calvo"] as const;
export const SHIRT_COLORS = ["#d97757", "#3d5a80", "#2a9d8f", "#e9c46a", "#6c757d", "#9d4edd", "#ef476f", "#1d3557"];

export interface OwnerLook {
  skin: number;
  hair: number;
  style: number;
  shirt: number;
}

export const DEFAULT_LOOK: OwnerLook = { skin: 3, hair: 1, style: 0, shirt: 0 };

const KEY = "hermes-oficina-look";

function valid(n: unknown, len: number): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n < len;
}

export function loadLook(): OwnerLook {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<OwnerLook> | null;
    if (!raw) return DEFAULT_LOOK;
    return {
      skin: valid(raw.skin, SKIN_TONES.length) ? raw.skin : DEFAULT_LOOK.skin,
      hair: valid(raw.hair, HAIR_COLORS.length) ? raw.hair : DEFAULT_LOOK.hair,
      style: valid(raw.style, HAIR_STYLES.length) ? raw.style : DEFAULT_LOOK.style,
      shirt: valid(raw.shirt, SHIRT_COLORS.length) ? raw.shirt : DEFAULT_LOOK.shirt,
    };
  } catch {
    return DEFAULT_LOOK;
  }
}

export function saveLook(look: OwnerLook) {
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    /* modo privado: la apariencia dura la sesión */
  }
}
