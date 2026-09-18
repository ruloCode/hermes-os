/**
 * SALA DE AGENTES 3D — configuración de los personajes.
 *
 * Cada agente de la sala es dueño de UN proyecto del vault y habla con su
 * propia voz de ElevenLabs. Los personajes NO viven en el código (regla del
 * repo: ningún nombre propio): se leen de `~/.hermes-os/sala.json` y el
 * agente los sirve en `GET /sala/agents`. Aquí solo hay el CONTRATO (tipos +
 * validación pura), compartido por el agente (leer/servir), el dashboard (la
 * escena y la ruta del token) y el script de setup de ElevenLabs (crear).
 *
 * Dos clases de voz conviven:
 *  - `reuse`: el personaje usa un agente ElevenLabs que YA existe (Hermes o el
 *    tutor de inglés) — su agent_id sale del .env, no del JSON.
 *  - propia: el script de setup crea el agente con `voice_id`, `prompt`,
 *    `first_message` y el subconjunto de client tools que se le permite; al
 *    crearlo escribe `agent_id` de vuelta en el JSON.
 */

export const SALA_HEADS = ["sphere", "cube", "icosahedron", "cone", "torus"] as const;
export type SalaHead = (typeof SALA_HEADS)[number];

export const SALA_BUILDS = ["slim", "medium", "wide"] as const;
export type SalaBuild = (typeof SALA_BUILDS)[number];

export type SalaLanguage = "es" | "en";
export type SalaReuse = "hermes" | "tutor";

/** Tope de personajes: más de esto no cabe en el arco ni se distingue. */
export const SALA_MAX_AGENTS = 8;
/** Alturas sanas de una figura (metros de escena). */
export const SALA_HEIGHT_MIN = 1.3;
export const SALA_HEIGHT_MAX = 2.3;

export interface SalaVoiceReuse {
  reuse: SalaReuse;
}

export interface SalaVoiceOwn {
  reuse?: undefined;
  /** Lo escribe `pnpm setup:elevenlabs`; null/ausente = aún no creado. */
  agent_id?: string | null;
  /** Voz de ElevenLabs (de la cuenta o de la biblioteca pública). */
  voice_id: string;
  /** Nombre exacto en la biblioteca: con él el setup la agrega a la cuenta si falta. */
  voice_name?: string;
  language: SalaLanguage;
  first_message: string;
  /** Persona + hechos del proyecto. El setup le suma el bloque común (dueño, tools). */
  prompt: string;
  /** Client tools de Hermes que este personaje puede usar (por nombre). */
  tools: string[];
}

export type SalaVoice = SalaVoiceReuse | SalaVoiceOwn;

export interface SalaAgentConfig {
  /** Clave estable: `?agent=<key>` en el token, `/sala/portrait/<key>`. */
  key: string;
  name: string;
  /** Slug del proyecto del vault del que es dueño. */
  project: string;
  /** Color hex de la figura (#rrggbb). */
  color: string;
  head: SalaHead;
  /** Altura en metros de escena. */
  height: number;
  build: SalaBuild;
  /** Prompt texto→imagen para su retrato (`pnpm sala:portraits`). */
  portrait_prompt?: string;
  /** false = definido pero fuera de la sala (no se sirve ni se crea su voz). Default true. */
  enabled?: boolean;
  voice: SalaVoice;
}

/**
 * ELENCO: un solo agente ElevenLabs multi-voz que interpreta a varios
 * personajes de la sala (uno por `members`), cada uno con su voz. Un solo
 * cerebro = contexto total, sin solaparse, y "Iván, ¿…?" rutea solo. El
 * setup lo crea con `tts.supported_voices` y escribe `agent_id`.
 */
export interface SalaCast {
  agent_id?: string | null;
  /** Claves de agentes con voz PROPIA (voice_id) y habilitados. */
  members: string[];
  /** Quién habla si el modelo olvida etiquetar (default: el primero). */
  default?: string;
}

/**
 * TÓTEM DE ESTACIÓN: dónde está plantada la pantalla. Con este bloque el
 * elenco deja de ser una tertulia y se vuelve el anfitrión de una estación
 * concreta: sabe de dónde sale el viajero (sin que se lo diga) y qué línea
 * pisa. El nombre de la estación NO vive en el código — sale de aquí y se
 * resuelve contra el GTFS.
 */
export interface SalaStation {
  /** Clave de estación del GTFS (`/metro/stations`), o el nombre tal cual. */
  id: string;
  /** Nombre para mostrar y para decir en voz. */
  name: string;
  /** route_short_name de la línea que pasa por aquí ("A"): pinta el badge. */
  line: string;
  /** Idioma con el que arranca la pantalla. */
  default_language?: SalaLanguage | "pt";
}

export interface SalaConfig {
  agents: SalaAgentConfig[];
  /** Tema de la tertulia (demo a tres voces): lo reciben los agentes al conectar. */
  topic?: string;
  cast?: SalaCast;
  /** Presente = el elenco es el anfitrión de esta estación (modo tótem). */
  station?: SalaStation;
}

/** Etiqueta de voz de un personaje en el elenco: nombre sin acentos ni espacios (`<Ivan>…</Ivan>`). */
export function castLabel(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]/g, "");
}

/** Lo que el agente sirve al dashboard: sin prompts ni ids de ElevenLabs. */
export interface SalaAgentPublic {
  key: string;
  name: string;
  project: string;
  /** Del vault (o del espejo `projects_cache`); null si el slug no existe. */
  project_name: string | null;
  project_estado: string | null;
  color: string;
  head: SalaHead;
  height: number;
  build: SalaBuild;
  language: SalaLanguage;
  /** Hay un agent_id resoluble: se le puede pedir token. */
  ready: boolean;
  /** Existe `~/.hermes-os/avatars/sala/<key>.png`. */
  portrait: boolean;
  reuse: SalaReuse | null;
}

/** Elenco tal como lo ve el dashboard. */
export interface SalaCastPublic {
  /** Hay agent_id: se le puede pedir token con ?agent=cast. */
  ready: boolean;
  members: string[];
  default: string;
  /** clave → etiqueta de voz (<Etiqueta>…</Etiqueta>) para saber quién habla. */
  labels: Record<string, string>;
}

export class SalaValidationError extends Error {}

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(msg: string): never {
  throw new SalaValidationError(msg);
}

function str(v: unknown, where: string, max = 4000): string {
  if (typeof v !== "string" || v.trim().length === 0) fail(`${where}: texto vacío`);
  if (v.length > max) fail(`${where}: más de ${max} caracteres`);
  return v;
}

function parseVoice(raw: unknown, where: string): SalaVoice {
  if (!raw || typeof raw !== "object") fail(`${where}: falta "voice"`);
  const v = raw as Record<string, unknown>;
  if (v.reuse !== undefined) {
    if (v.reuse !== "hermes" && v.reuse !== "tutor") fail(`${where}: reuse debe ser "hermes" o "tutor"`);
    return { reuse: v.reuse };
  }
  const language = v.language === "en" ? "en" : v.language === "es" ? "es" : fail(`${where}: language debe ser "es" o "en"`);
  if (!Array.isArray(v.tools) || !v.tools.every((t) => typeof t === "string" && t.length > 0)) {
    fail(`${where}: tools debe ser una lista de nombres`);
  }
  const agentId =
    v.agent_id === undefined || v.agent_id === null
      ? null
      : typeof v.agent_id === "string" && v.agent_id.trim()
        ? v.agent_id.trim()
        : fail(`${where}: agent_id inválido`);
  return {
    agent_id: agentId,
    voice_id: str(v.voice_id, `${where}.voice_id`, 64),
    ...(v.voice_name !== undefined ? { voice_name: str(v.voice_name, `${where}.voice_name`, 120) } : {}),
    language,
    first_message: str(v.first_message, `${where}.first_message`, 600),
    prompt: str(v.prompt, `${where}.prompt`, 6000),
    tools: v.tools as string[],
  };
}

function parseAgent(raw: unknown, idx: number): SalaAgentConfig {
  if (!raw || typeof raw !== "object") fail(`agente ${idx}: no es un objeto`);
  const a = raw as Record<string, unknown>;
  const where = `agente ${idx}`;
  if (typeof a.key !== "string" || !KEY_RE.test(a.key)) fail(`${where}: key inválida (a-z, 0-9, guiones)`);
  if (a.key === "tutor" || a.key === "hermes") {
    // Estas dos claves ya significan algo en `?agent=`; el personaje que las
    // use tiene que REUSAR ese agente, o el token se volvería ambiguo.
    const voice = a.voice as Record<string, unknown> | undefined;
    if (voice?.reuse !== a.key) fail(`${where}: la key "${a.key}" exige voice.reuse = "${a.key}"`);
  }
  if (typeof a.project !== "string" || !SLUG_RE.test(a.project)) fail(`${where}: project debe ser un slug`);
  if (typeof a.color !== "string" || !COLOR_RE.test(a.color)) fail(`${where}: color debe ser #rrggbb`);
  if (!SALA_HEADS.includes(a.head as SalaHead)) fail(`${where}: head debe ser ${SALA_HEADS.join("|")}`);
  if (!SALA_BUILDS.includes(a.build as SalaBuild)) fail(`${where}: build debe ser ${SALA_BUILDS.join("|")}`);
  const height = typeof a.height === "number" ? a.height : NaN;
  if (!(height >= SALA_HEIGHT_MIN && height <= SALA_HEIGHT_MAX)) {
    fail(`${where}: height fuera de ${SALA_HEIGHT_MIN}-${SALA_HEIGHT_MAX}`);
  }
  return {
    key: a.key,
    name: str(a.name, `${where}.name`, 40).trim(),
    project: a.project,
    color: a.color.toLowerCase(),
    head: a.head as SalaHead,
    height,
    build: a.build as SalaBuild,
    ...(a.portrait_prompt !== undefined
      ? { portrait_prompt: str(a.portrait_prompt, `${where}.portrait_prompt`, 2000) }
      : {}),
    ...(a.enabled === false ? { enabled: false } : {}),
    voice: parseVoice(a.voice, `${where}.voice`),
  };
}

/** Valida el JSON de `sala.json`. Lanza SalaValidationError con el motivo exacto. */
export function parseSalaConfig(raw: unknown): SalaConfig {
  if (!raw || typeof raw !== "object") fail("sala.json: la raíz debe ser un objeto");
  const agents = (raw as Record<string, unknown>).agents;
  if (!Array.isArray(agents)) fail('sala.json: falta la lista "agents"');
  if (agents.length === 0) fail("sala.json: la lista de agentes está vacía");
  if (agents.length > SALA_MAX_AGENTS) fail(`sala.json: máximo ${SALA_MAX_AGENTS} agentes`);
  const parsed = agents.map(parseAgent);
  const keys = new Set<string>();
  for (const a of parsed) {
    if (keys.has(a.key)) fail(`sala.json: key repetida "${a.key}"`);
    keys.add(a.key);
  }
  const topic = (raw as Record<string, unknown>).topic;
  const castRaw = (raw as Record<string, unknown>).cast;
  let cast: SalaCast | undefined;
  if (castRaw !== undefined) {
    if (!castRaw || typeof castRaw !== "object") fail("sala.json.cast: debe ser un objeto");
    const c = castRaw as Record<string, unknown>;
    if (!Array.isArray(c.members) || c.members.length < 1 || !c.members.every((m) => typeof m === "string")) {
      fail("sala.json.cast.members: lista de claves (≥1)");
    }
    const members = c.members as string[];
    const labels = new Set<string>();
    for (const m of members) {
      const a = parsed.find((x) => x.key === m);
      if (!a) fail(`sala.json.cast: "${m}" no es un agente`);
      if (a.voice.reuse) fail(`sala.json.cast: "${m}" reusa un agente; el elenco necesita voice_id propio`);
      if (a.enabled === false) fail(`sala.json.cast: "${m}" está deshabilitado`);
      const label = castLabel(a.name);
      if (!label || labels.has(label)) fail(`sala.json.cast: etiqueta de voz repetida o vacía para "${m}"`);
      labels.add(label);
    }
    if (c.default !== undefined && (typeof c.default !== "string" || !members.includes(c.default))) {
      fail("sala.json.cast.default: debe ser uno de members");
    }
    const agentId =
      c.agent_id === undefined || c.agent_id === null
        ? null
        : typeof c.agent_id === "string" && c.agent_id.trim()
          ? c.agent_id.trim()
          : fail("sala.json.cast.agent_id inválido");
    cast = { agent_id: agentId, members, ...(typeof c.default === "string" ? { default: c.default } : {}) };
  }
  const stationRaw = (raw as Record<string, unknown>).station;
  let station: SalaStation | undefined;
  if (stationRaw !== undefined) {
    if (!stationRaw || typeof stationRaw !== "object") fail("sala.json.station: debe ser un objeto");
    const st = stationRaw as Record<string, unknown>;
    const lang = st.default_language;
    if (lang !== undefined && lang !== "es" && lang !== "en" && lang !== "pt") {
      fail('sala.json.station.default_language: "es", "en" o "pt"');
    }
    station = {
      id: str(st.id, "sala.json.station.id", 80),
      name: str(st.name, "sala.json.station.name", 80),
      line: str(st.line, "sala.json.station.line", 12),
      ...(lang !== undefined ? { default_language: lang } : {}),
    };
  }
  return {
    agents: parsed,
    ...(topic !== undefined ? { topic: str(topic, "sala.json.topic", 400) } : {}),
    ...(cast ? { cast } : {}),
    ...(station ? { station } : {}),
  };
}

/** Idioma en que habla el personaje (el tutor reusado es inglés). */
export function salaAgentLanguage(agent: SalaAgentConfig): SalaLanguage {
  if (agent.voice.reuse) return agent.voice.reuse === "tutor" ? "en" : "es";
  return agent.voice.language;
}

/**
 * Posiciones de N figuras en arco frente a la cámara, de izquierda a derecha,
 * sobre el plano XZ (y=0). Con una sola figura queda al centro. Radio y
 * apertura en unidades de escena; el arco se abre hacia la cámara (z positivo
 * mira al espectador, así que el arco está en z negativo y se curva hacia él).
 */
export function salaArcPositions(
  count: number,
  opts: { radius?: number; spreadDeg?: number } = {},
): { x: number; z: number; /** rotación Y para mirar al origen */ yaw: number }[] {
  const radius = opts.radius ?? 4.2;
  const spread = ((opts.spreadDeg ?? 110) * Math.PI) / 180;
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, z: -radius, yaw: 0 }];
  const out: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1) - 0.5; // -0.5 … 0.5
    const angle = t * spread; // 0 = frente
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    // Mirar al origen (donde está el avatar): atan2 del vector hacia (0,0).
    const yaw = Math.atan2(-x, -z);
    out.push({ x, z, yaw });
  }
  return out;
}
