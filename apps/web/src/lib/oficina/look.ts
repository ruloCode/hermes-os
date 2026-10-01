// Apariencia del personaje del dueño en la Oficina: piel, pelo, peinado,
// camiseta y rasgos (barba, gafas, accesorios). Se elige en el selector del HUD
// y vive en el navegador (localStorage): es preferencia de quien mira, no dato
// del agente.
//
// Paletas de agent-office (AgentSystemLabs, MIT — src/shared/avatar.ts), más
// el tono trigueño, los rulos y la camiseta blanca del avatar del dueño.

export const SKIN_TONES = ["#ffe3cc", "#ffd7b5", "#f1c27d", "#e0ac69", "#d49a6a", "#c68642", "#a0663a", "#8d5524", "#5c3a21"];
export const HAIR_COLORS = ["#2b2d42", "#3b2417", "#6f4e37", "#e9c46a", "#c1440e", "#d9d9d9", "#d62828", "#ff8fab", "#9d4edd", "#264653"];
export const HAIR_STYLES = ["Rulos", "Corto", "Largo", "Moño", "Puntas", "Rizado", "Cola", "Calvo"] as const;
export const SHIRT_COLORS = ["#f4f1ea", "#d97757", "#3d5a80", "#2a9d8f", "#e9c46a", "#6c757d", "#9d4edd", "#ef476f", "#1d3557"];
/** Pantalón (el primero es el del dueño). Solo la gente del edificio usa los demás. */
export const PANTS_COLORS = ["#3d405b", "#5c4033", "#2f4858", "#6b705c", "#8d99ae", "#3a3a3a"];
/** Gorra o gorro de la gente del edificio (el dueño no usa: sus rulos son su sello). */
export const HAT_STYLES = ["ninguno", "gorra", "gorro"] as const;

export interface OwnerLook {
  skin: number;
  hair: number;
  style: number;
  shirt: number;
  /** Barba corta con bigote. */
  beard: boolean;
  /** Gafas de marco transparente. */
  glasses: boolean;
  /** Collar con dije y arete. */
  extras: boolean;
  /** Color del pantalón (índice de PANTS_COLORS; sin dato, el del dueño). */
  pants?: number;
  /** Gorra o gorro (índice de HAT_STYLES; sin dato, ninguno). */
  hat?: number;
}

export const DEFAULT_LOOK: OwnerLook = { skin: 4, hair: 1, style: 0, shirt: 0, beard: true, glasses: true, extras: true };

// v2: las paletas cambiaron de orden (rulos, tono trigueño y camiseta blanca
// primero), así que una apariencia guardada con la clave vieja apuntaría a
// otros colores. Con la clave nueva todos arrancan en el default una vez.
const KEY = "hermes-oficina-look-v2";

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
      beard: typeof raw.beard === "boolean" ? raw.beard : DEFAULT_LOOK.beard,
      glasses: typeof raw.glasses === "boolean" ? raw.glasses : DEFAULT_LOOK.glasses,
      extras: typeof raw.extras === "boolean" ? raw.extras : DEFAULT_LOOK.extras,
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
