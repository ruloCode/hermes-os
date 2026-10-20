// Por dónde se llega a Hermes — la fuente ÚNICA para el teléfono y el MacBook.
//
// El problema real (2026-10-16): la Mac mini cambió de IP tres veces por DHCP
// (.92 → .169 → .170) y Hermes Phone llevaba la .92 grabada en el APK; seguía
// conectando solo porque caía al túnel de Cloudflare. Una dirección grabada es
// una dirección que se vence.
//
// Ahora la máquina CENTRO (HERMES_HUB=on, la que está siempre prendida)
// publica en `remote_config` (key `agent_routes`) su LAN actual y su dirección
// de Tailscale, y las repite en /health. Los clientes las leen al conectar por
// cualquier camino y las prueban en carrera. Una sola máquina publica: si el
// MacBook también lo hiciera, el teléfono acabaría hablándole a él.

import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { env } from "../env.js";
import { detectLanIp } from "../presence.js";
import { supabase } from "../supabase.js";

export interface AgentRoutes {
  machine: string;
  /** http://<ip-lan>:<puerto> — la más rápida, solo en casa. */
  lan: string | null;
  /** Tailscale: https://<nombre>.ts.net (tailscale serve) o http://100.x.y.z:<puerto>. */
  tailnet: string | null;
}

/** ¿Es una IPv4 del rango que Tailscale reparte (100.64.0.0/10, CGNAT)? */
export function isTailnetIp(ip: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const second = Number(m[1]);
  return second >= 64 && second <= 127;
}

/**
 * La IP de Tailscale de esta máquina, si el túnel está arriba. Tailscale crea
 * una interfaz `utun*` (macOS) o `tailscale0` (Linux); se busca por RANGO y no
 * por nombre porque el número de utun cambia entre arranques.
 */
export function detectTailnetIp(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (!a.internal && a.family === "IPv4" && isTailnetIp(a.address)) return a.address;
    }
  }
  return null;
}

/** Las rutas de este agente ahora mismo. `HERMES_TAILNET_URL` manda (nombre MagicDNS con https). */
export function currentRoutes(
  opts: { lanIp?: string | null; tailnetIp?: string | null; tailnetUrl?: string; port?: number; machine?: string } = {},
): AgentRoutes {
  const port = opts.port ?? env.PORT;
  const lanIp = opts.lanIp !== undefined ? opts.lanIp : detectLanIp();
  const tsIp = opts.tailnetIp !== undefined ? opts.tailnetIp : detectTailnetIp();
  const tsUrl = (opts.tailnetUrl ?? env.TAILNET_URL).replace(/\/$/, "");
  return {
    machine: opts.machine ?? env.MACHINE_NAME,
    lan: lanIp ? `http://${lanIp}:${port}` : null,
    tailnet: tsUrl || (tsIp ? `http://${tsIp}:${port}` : null),
  };
}

let lastPublished = "";

/**
 * Publica las rutas en Supabase SOLO si esta máquina es el centro y SOLO si
 * cambiaron (el job corre cada minuto; escribir lo mismo cada minuto es ruido
 * en la tabla y en los logs). Devuelve lo publicado o null.
 */
export async function publishRoutes(): Promise<AgentRoutes | null> {
  if (!env.HUB || !supabase) return null;
  const routes = currentRoutes();
  const key = JSON.stringify(routes);
  if (key === lastPublished) return null;
  const { error } = await supabase
    .from("remote_config")
    .upsert({ key: "agent_routes", value: key, updated_at: new Date().toISOString() });
  if (error) {
    console.error("[hermes] no pude publicar las rutas del centro:", error.message);
    return null;
  }
  lastPublished = key;
  console.log(`[hermes] rutas del centro publicadas: lan=${routes.lan ?? "—"} tailnet=${routes.tailnet ?? "—"}`);
  return routes;
}
