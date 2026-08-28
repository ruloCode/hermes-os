import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/**
 * Control de la tira de luces TP-Link Kasa KL400L5 ("luz led") en la LAN.
 *
 * Habla el protocolo IOT legacy (puerto 9999, sin autenticación, solo red
 * local) a través de la CLI de python-kasa vía uvx. CLAVE de latencia:
 * `--type lightstrip` salta el discovery de 10 s — cada comando queda en
 * ~0.5 s, apto para voz en tiempo real. Las acciones son SEMÁNTICAS de una
 * allowlist (igual que el navegador): jamás se pasan argumentos crudos del
 * cliente a la CLI.
 */

// IP de la tira en la LAN. Vacío = luces no configuradas (la voz y el chat lo
// dicen tal cual en vez de esperar 20 s a un host que no existe).
const LIGHTS_HOST = process.env.HERMES_LIGHTS_HOST || "";
const KASA_TIMEOUT_MS = 20_000;

// Binario por ruta absoluta, instalado con `uv tool install python-kasa`
// (venv persistente en ~/.local/share/uv/tools — disco interno). Misma
// lección que GRAPHIFY_BIN: launchd no tiene ~/.local/bin en PATH, y el
// trampolín de `uvx` sobre el cache del disco externo muere en silencio
// bajo el LaunchAgent.
const KASA_BIN = (() => {
  const candidates = [
    process.env.KASA_BIN,
    resolve(homedir(), ".local/bin/kasa"),
    "/opt/homebrew/bin/kasa",
    "/usr/local/bin/kasa",
  ];
  for (const c of candidates) if (c && existsSync(c)) return c;
  return "kasa";
})();

type Result = { ok: true; detail: string } | { ok: false; error: string };

function runKasa(args: string[]): Promise<{ ok: true; out: string } | { ok: false; error: string }> {
  return new Promise((done) => {
    execFile(
      KASA_BIN,
      ["--host", LIGHTS_HOST, "--type", "lightstrip", "--timeout", "5", ...args],
      { timeout: KASA_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) {
          // El warning del rango de color temp es cosmético — fuera del error.
          const clean = (stderr || "")
            .split("\n")
            .filter((l) => l.trim() && !/Unknown color temperature range/i.test(l))
            .join(" ")
            .trim();
          const e = err as NodeJS.ErrnoException & { signal?: string; code?: number | string };
          const why = clean || stdout.trim().slice(-160) || (e.signal ? `señal ${e.signal}` : `exit ${e.code}`);
          done({ ok: false, error: `la tira no respondió: ${why}`.slice(0, 220) });
        } else done({ ok: true, out: stdout.trim() });
      },
    );
  });
}

const normalize = (s: string): string =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// ── Colores por nombre (es/en) → HSV o blanco en Kelvin ────────────────

type NamedColor = { hsv: [number, number, number] } | { temp: number };

const COLOR_ALIASES: Record<string, NamedColor> = {
  rojo: { hsv: [0, 100, 100] },
  red: { hsv: [0, 100, 100] },
  naranja: { hsv: [30, 100, 100] },
  orange: { hsv: [30, 100, 100] },
  amarillo: { hsv: [55, 100, 100] },
  yellow: { hsv: [55, 100, 100] },
  verde: { hsv: [120, 100, 100] },
  green: { hsv: [120, 100, 100] },
  menta: { hsv: [150, 60, 100] },
  cian: { hsv: [180, 100, 100] },
  cyan: { hsv: [180, 100, 100] },
  turquesa: { hsv: [175, 80, 100] },
  celeste: { hsv: [200, 70, 100] },
  azul: { hsv: [230, 100, 100] },
  blue: { hsv: [230, 100, 100] },
  indigo: { hsv: [255, 100, 100] },
  morado: { hsv: [275, 100, 100] },
  violeta: { hsv: [275, 100, 100] },
  purpura: { hsv: [275, 100, 100] },
  purple: { hsv: [275, 100, 100] },
  lila: { hsv: [285, 55, 100] },
  magenta: { hsv: [300, 100, 100] },
  fucsia: { hsv: [310, 100, 100] },
  rosa: { hsv: [330, 80, 100] },
  rosado: { hsv: [330, 80, 100] },
  pink: { hsv: [330, 80, 100] },
  blanco: { temp: 4000 },
  white: { temp: 4000 },
  "blanco calido": { temp: 2700 },
  calido: { temp: 2700 },
  "blanco neutro": { temp: 3500 },
  neutro: { temp: 3500 },
  "blanco frio": { temp: 5000 },
  frio: { temp: 5000 },
};

/** Nombre aproximado de un hue, para relatar el estado por voz. */
function hueName(hue: number): string {
  const bands: Array<[number, string]> = [
    [15, "rojo"], [45, "naranja"], [70, "amarillo"], [160, "verde"],
    [195, "cian"], [260, "azul"], [290, "morado"], [320, "magenta"], [345, "rosa"], [360, "rojo"],
  ];
  for (const [max, name] of bands) if (hue < max) return name;
  return `tono ${hue}°`;
}

// ── Efectos animados (nombres reales del KL400 + aliases dichos por voz) ─

const EFFECTS = [
  "Aurora", "Bubbling Cauldron", "Candy Cane", "Christmas", "Flicker", "Hanukkah",
  "Haunted Mansion", "Icicle", "Lightning", "Ocean", "Rainbow", "Raindrop", "Spring", "Valentines",
] as const;

const EFFECT_ALIASES: Record<string, string> = {
  arcoiris: "Rainbow",
  oceano: "Ocean",
  mar: "Ocean",
  navidad: "Christmas",
  tormenta: "Lightning",
  rayos: "Lightning",
  relampago: "Lightning",
  lluvia: "Raindrop",
  gotas: "Raindrop",
  primavera: "Spring",
  fuego: "Flicker",
  vela: "Flicker",
  velas: "Flicker",
  fogata: "Flicker",
  halloween: "Haunted Mansion",
  embrujada: "Haunted Mansion",
  hielo: "Icicle",
  caramelo: "Candy Cane",
  burbujas: "Bubbling Cauldron",
  caldero: "Bubbling Cauldron",
  januca: "Hanukkah",
  "san valentin": "Valentines",
  amor: "Valentines",
};

function resolveEffect(raw: string): string | null {
  const q = normalize(raw);
  if (EFFECT_ALIASES[q]) return EFFECT_ALIASES[q];
  const exact = EFFECTS.find((e) => normalize(e) === q);
  if (exact) return exact;
  return EFFECTS.find((e) => normalize(e).includes(q) || q.includes(normalize(e))) ?? null;
}

// ── Acciones ───────────────────────────────────────────────────────────

export const LIGHT_ACTIONS = [
  "on",
  "off",
  "toggle",
  "brightness",
  "color",
  "temperature",
  "effect",
  "status",
] as const;

export type LightAction = (typeof LIGHT_ACTIONS)[number];

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)));

interface LightInfo {
  light_state: { on_off?: number; mode?: string; hue?: number; saturation?: number; color_temp?: number; brightness?: number };
  effect: { enable?: number; name?: string } | null;
  powerMw: number | null;
}

/** Lee el sysinfo real de la tira (estado de luz + efecto + consumo). */
async function readLightInfo(): Promise<LightInfo | null> {
  const res = await runKasa(["--json", "state"]);
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.out) as Record<string, Record<string, Record<string, unknown>>>;
    const sysinfo = data.system?.get_sysinfo as
      | { light_state?: LightInfo["light_state"]; lighting_effect_state?: LightInfo["effect"] }
      | undefined;
    if (!sysinfo?.light_state) return null;
    const powerMw = data["smartlife.iot.common.emeter"]?.get_realtime?.power_mw;
    return {
      light_state: sysinfo.light_state,
      effect: sysinfo.lighting_effect_state ?? null,
      powerMw: typeof powerMw === "number" ? powerMw : null,
    };
  } catch {
    return null;
  }
}

async function setWhite(kelvin: number): Promise<Result> {
  const k = clamp(kelvin, 2700, 5000);
  // Firmware caprichoso: `temperature` NO apaga un efecto activo (queda
  // sonando encima del blanco), pero `hsv` sí. Si hay efecto, se rompe
  // primero conservando el brillo actual.
  const info = await readLightInfo();
  if (info?.effect?.enable) {
    await runKasa(["hsv", "0", "0", String(clamp(info.light_state.brightness ?? 80, 1, 100))]);
  }
  const res = await runKasa(["temperature", String(k)]);
  if (!res.ok) return res;
  const label = k <= 3000 ? "cálida" : k >= 4500 ? "fría" : "neutra";
  return { ok: true, detail: `luz blanca ${label} (${k}K)` };
}

/**
 * Ejecuta una acción sobre la tira. Para las acciones que fijan luz
 * (brillo/color/blanco/efecto) se manda `on` antes: "ponla en azul" con la
 * tira apagada debe encenderla — dos comandos siguen siendo ~1 s.
 */
export async function lightsCommand(action: LightAction, value?: string): Promise<Result> {
  if (!LIGHTS_HOST) return { ok: false, error: "Luces no configuradas: define HERMES_LIGHTS_HOST (IP de la tira Kasa en la LAN)." };
  const val = value?.trim() ?? "";
  if (["brightness", "color", "temperature", "effect"].includes(action)) await runKasa(["on"]);

  switch (action) {
    case "on": {
      const res = await runKasa(["on"]);
      return res.ok ? { ok: true, detail: "tira encendida" } : res;
    }
    case "off": {
      const res = await runKasa(["off"]);
      return res.ok ? { ok: true, detail: "tira apagada" } : res;
    }
    case "toggle": {
      const res = await runKasa(["toggle"]);
      if (!res.ok) return res;
      // El estado resultante importa más que "alternada": el chip del
      // dashboard y la voz relatan "encendida"/"apagada" de verdad.
      const info = await readLightInfo();
      if (!info) return { ok: true, detail: "tira alternada" };
      return { ok: true, detail: info.light_state.on_off ? "tira encendida" : "tira apagada" };
    }
    case "brightness": {
      const n = Number(val.replace("%", ""));
      if (!Number.isFinite(n)) return { ok: false, error: "¿a cuánto el brillo? (0 a 100)" };
      if (n <= 0) {
        const res = await runKasa(["off"]);
        return res.ok ? { ok: true, detail: "tira apagada" } : res;
      }
      const b = clamp(n, 1, 100);
      const res = await runKasa(["brightness", String(b)]);
      return res.ok ? { ok: true, detail: `brillo al ${b}%` } : res;
    }
    case "temperature": {
      const named = COLOR_ALIASES[normalize(val)];
      if (named && "temp" in named) return setWhite(named.temp);
      const k = Number(val);
      if (!Number.isFinite(k)) return { ok: false, error: "¿qué blanco? (cálido, neutro, frío o Kelvin 2700-5000)" };
      return setWhite(k);
    }
    case "color": {
      if (!val) return { ok: false, error: "¿de qué color?" };
      // "h s v" explícito (hue 0-360, sat/val 0-100) — para matices finos.
      const nums = val.match(/^\d{1,3}(?:[ ,]+\d{1,3}){0,2}$/)
        ? val.split(/[ ,]+/).map(Number)
        : null;
      if (nums) {
        const [h, s = 100, v = 100] = nums;
        const hsv = [clamp(h, 0, 360) % 360, clamp(s, 0, 100), clamp(v, 1, 100)];
        const res = await runKasa(["hsv", ...hsv.map(String)]);
        return res.ok ? { ok: true, detail: `color ${hueName(hsv[0])} (hsv ${hsv.join(" ")})` } : res;
      }
      const named = COLOR_ALIASES[normalize(val).replace(/^(color|luz)\s+/, "")];
      if (!named) return { ok: false, error: `no conozco el color "${val}" — prueba rojo, naranja, amarillo, verde, cian, azul, morado, rosa o blanco cálido/frío` };
      if ("temp" in named) return setWhite(named.temp);
      const res = await runKasa(["hsv", ...named.hsv.map(String)]);
      return res.ok ? { ok: true, detail: `color ${normalize(val)}` } : res;
    }
    case "effect": {
      if (!val) return { ok: false, error: `¿qué efecto? Hay: ${EFFECTS.join(", ")}` };
      const effect = resolveEffect(val);
      if (!effect) return { ok: false, error: `no hay un efecto "${val}" — hay: ${EFFECTS.join(", ")}` };
      const res = await runKasa(["effect", effect]);
      return res.ok ? { ok: true, detail: `efecto ${effect} andando` } : res;
    }
    case "status":
      return lightsStatus();
  }
}

/** Estado real de la tira, resumido en una frase apta para voz. */
async function lightsStatus(): Promise<Result> {
  const info = await readLightInfo();
  if (!info) return { ok: false, error: "no pude leer el estado de la tira" };
  const ls = info.light_state;
  if (!ls.on_off) return { ok: true, detail: "la tira está apagada" };

  const look =
    info.effect?.enable && info.effect.name
      ? `efecto ${info.effect.name}`
      : (ls.saturation ?? 0) > 0
        ? `color ${hueName(ls.hue ?? 0)}`
        : `blanco (${ls.color_temp ?? "?"}K)`;
  const watts = info.powerMw != null ? ` · ${(info.powerMw / 1000).toFixed(1)} W` : "";
  return { ok: true, detail: `encendida al ${ls.brightness ?? "?"}%, ${look}${watts}` };
}
