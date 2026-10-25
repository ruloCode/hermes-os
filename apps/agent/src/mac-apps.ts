/**
 * Resolver "abre spotify" / "abre la calculadora" → una app instalada en la
 * Mac. Lógica PURA sobre el catálogo que escanea mac.ts (rutas reales de
 * /Applications y compañía): aquí no se toca el disco ni se lanza nada.
 *
 * La regla: solo se abre lo que EXISTE. Un nombre que no se parece a ninguna
 * app instalada devuelve null — la voz dice "no la encontré" en vez de abrir
 * algo parecido por accidente.
 */

export interface MacApp {
  /** Nombre visible sin ".app" ("Google Chrome"). */
  name: string;
  /** Ruta absoluta del bundle. */
  path: string;
}

export type MatchLevel = "alias" | "exact" | "tokens" | "prefix";

export interface AppMatch {
  app: MacApp;
  level: MatchLevel;
}

export const normalizeName = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\.app$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Cómo se dicen en español las apps del sistema (o el apodo de una de
// terceros) → nombre real del bundle, ya normalizado.
const APP_ALIASES: Record<string, string> = {
  ajustes: "system settings",
  configuracion: "system settings",
  preferencias: "system settings",
  "ajustes del sistema": "system settings",
  "configuracion del sistema": "system settings",
  musica: "music",
  notas: "notes",
  calendario: "calendar",
  correo: "mail",
  fotos: "photos",
  mensajes: "messages",
  calculadora: "calculator",
  recordatorios: "reminders",
  mapas: "maps",
  contactos: "contacts",
  reloj: "clock",
  libros: "books",
  atajos: "shortcuts",
  "vista previa": "preview",
  "monitor de actividad": "activity monitor",
  tienda: "app store",
  "tienda de apps": "app store",
  telefono: "phone",
  diccionario: "dictionary",
  "notas adhesivas": "stickies",
  zoom: "zoom us",
  vscode: "visual studio code",
  "vs code": "visual studio code",
  code: "visual studio code",
};

// Lo que se dice alrededor del nombre y no es el nombre.
// Sin "app" suelto: "app store" es un nombre.
const LEADING = /^(abre|abrir|abreme|lanza|la app de|la aplicacion de|el|la|los|las|mi|un|una)\s+/;
const TRAILING = /\s+(en (la|el|mi) (mac|computador|computadora|pc|compu)|en (mac|pc))$/;

/** Limpia lo dicho por voz hasta dejar solo el nombre de la app. */
export function cleanAppQuery(raw: string): string {
  let q = normalizeName(raw);
  for (let i = 0; i < 4; i++) {
    const next = q.replace(TRAILING, "").replace(LEADING, "").trim();
    if (next === q) break;
    q = next;
  }
  return q;
}

const RANK: Record<MatchLevel, number> = { alias: 0, exact: 1, tokens: 2, prefix: 3 };

/**
 * Busca la app más parecida. Niveles, del más fuerte al más débil:
 * alias en español → nombre exacto → todas las palabras dichas están en el
 * nombre ("chrome" ⊂ "Google Chrome") → prefijo de una palabra ("spoti",
 * mínimo 3 letras). Empates: el nombre más corto (el más específico).
 */
export function matchApp(raw: string, catalog: MacApp[]): AppMatch | null {
  const q = cleanAppQuery(raw);
  if (!q) return null;
  const qTokens = q.split(" ");
  let best: (AppMatch & { len: number }) | null = null;
  const consider = (app: MacApp, level: MatchLevel) => {
    const len = app.name.length;
    if (!best || RANK[level] < RANK[best.level] || (RANK[level] === RANK[best.level] && len < best.len)) {
      best = { app, level, len };
    }
  };
  const alias = APP_ALIASES[q];
  for (const app of catalog) {
    const n = normalizeName(app.name);
    if (alias && n === alias) consider(app, "alias");
    else if (n === q) consider(app, "exact");
    else {
      const tokens = n.split(" ");
      if (qTokens.every((t) => tokens.includes(t))) consider(app, "tokens");
      else if (q.length >= 3 && (n.startsWith(q) || tokens.some((t) => t.startsWith(q)))) consider(app, "prefix");
    }
  }
  if (!best) return null;
  const { app, level } = best as AppMatch & { len: number };
  return { app, level };
}

/** Un match "fuerte" gana a un sitio web con el mismo nombre; un prefijo, no. */
export const isStrongMatch = (m: AppMatch): boolean => m.level !== "prefix";
