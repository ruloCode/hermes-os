/**
 * Composición es una herramienta INTERNA y confidencial: lo que se compone
 * ahí no se le muestra a nadie más (ni artistas ni público). El agente también
 * está expuesto por un túnel cloudflared para la app móvil, así que
 * /composicion/* rechaza lo que llega por ahí: solo la red local (o Tailscale,
 * que no pasa por Cloudflare).
 *
 * Cómo se reconoce el túnel: cloudflared entrega en localhost, así que la IP
 * no sirve; lo que sí delata el camino son las cabeceras que Cloudflare pone
 * en TODA petición que cruza su red (cf-connecting-ip, cf-ray, cdn-loop).
 *
 * `privacyInfo()` alimenta la pastilla "Privado" de la UI con datos REALES:
 * qué sale del equipo, a quién y cuándo — no una promesa genérica.
 */
import type { PrivacyInfo } from "@hermes/shared";
import { env } from "../env.js";

type HeaderGetter = (name: string) => string | undefined;

export function viaTunnel(header: HeaderGetter): boolean {
  return Boolean(
    header("cf-connecting-ip") || header("cf-ray") || /cloudflare/i.test(header("cdn-loop") ?? ""),
  );
}

export const PRIVATE_ERROR = "Composición es privada: solo desde la red local";

export function privacyInfo(): PrivacyInfo {
  const external: PrivacyInfo["external"] = [
    {
      what: "Contexto de la canción e intención, molde y texto de la letra",
      to: "Claude (Anthropic)",
      when: "al resumir una sesión y al generar versiones de letra",
    },
  ];
  if (env.ELEVENLABS_API_KEY)
    external.push(
      {
        what: "El audio de una SESIÓN importada (comprimido)",
        to: "ElevenLabs Scribe",
        when: "al transcribir una sesión y distinguir quién habla",
      },
      {
        what: "El texto de las líneas de letra",
        to: "ElevenLabs (voz genérica)",
        when: "al pedir la guía cantada",
      },
    );
  return {
    lanOnly: env.COMPOSICION_LAN_ONLY,
    external,
    local: [
      "El video y el audio originales (disco de la sesión)",
      "Las tomas de Temas: su audio y su análisis en la rejilla (Scribe solo si lo activas en la toma)",
      "La separación de voz, la melodía, las sílabas y la tonalidad",
      "Las transposiciones y el tablero de canciones",
    ],
  };
}
