// "Sigue en tu celular": el tótem pide un pase al agente y arma la URL que va
// dentro del QR. La parte delicada es el HOST: el tótem suele abrirse en
// localhost, y un celular no puede abrir el localhost de otra máquina. Por eso
// la cadena es: URL pública configurada → el host desde donde se abrió la
// pantalla (si ya es alcanzable) → la IP de la LAN que el propio agente
// publica en su heartbeat. Si ninguna sirve, no se muestra QR: un código que
// no abre nada es peor que no ofrecerlo.

import { hermesFetch } from "@/lib/hermes";
import type { UiRoutePlan } from "@/lib/sala/ui-bus";

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)$/i;

/** Base pública de la web para el celular, o null si no hay ninguna alcanzable. */
export async function publicWebBase(): Promise<string | null> {
  const configured = (process.env.NEXT_PUBLIC_ESTACION_PUBLIC_URL || "").trim();
  if (configured) return configured.replace(/\/$/, "");
  if (typeof window === "undefined") return null;
  const { protocol, hostname, port, origin } = window.location;
  if (!LOCAL.test(hostname)) return origin;
  try {
    const res = await hermesFetch("/machines");
    // Ojo: el agente sirve este campo en camelCase (lanIp), no como la columna.
    const r = (await res.json()) as { machines?: { self?: boolean; lanIp?: string | null }[] };
    const ip = (r.machines ?? []).find((m) => m.self)?.lanIp ?? (r.machines ?? []).find((m) => m.lanIp)?.lanIp;
    if (!ip) return null;
    return `${protocol}//${ip}${port ? `:${port}` : ""}`;
  } catch {
    return null;
  }
}

export interface HandoffInput {
  summary: string;
  language: string;
  route?: UiRoutePlan | null;
  station?: string;
}

/** Crea el pase y devuelve la URL que va en el QR (null si no hay host alcanzable). */
export async function createHandoffUrl(input: HandoffInput): Promise<{ url: string; token: string; expiresAt: number } | null> {
  const base = await publicWebBase();
  if (!base) return null;
  const res = await hermesFetch("/sala/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: input.summary,
      language: input.language,
      route: input.route ?? undefined,
      station: input.station,
    }),
  });
  const r = (await res.json()) as { ok: boolean; token?: string; expiresAt?: number; error?: string };
  if (!r.ok || !r.token) return null;
  return { url: `${base}/m/${r.token}`, token: r.token, expiresAt: r.expiresAt ?? 0 };
}
