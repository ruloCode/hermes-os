import { NextResponse, type NextRequest } from "next/server";
import { resolveSalaAgentId } from "@/lib/server/sala-config";

/**
 * Devuelve credenciales efímeras para conectar el browser con un agente
 * privado de ElevenLabs sin exponer la API key:
 *  - conversationToken (WebRTC, preferido)
 *  - signedUrl (WebSocket, fallback)
 *
 * `?agent=tutor` pide el token del tutor de inglés; sin query, el Hermes
 * normal; cualquier otra clave es un personaje de la Sala de Agentes 3D y se
 * resuelve contra ~/.hermes-os/sala.json (mapa clave → agent_id).
 */
export async function GET(request: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const which = request.nextUrl.searchParams.get("agent") || "";
  let agentId: string | null | undefined;
  let hint: string;
  if (!which) {
    agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
    hint = "Configura ELEVENLABS_API_KEY y NEXT_PUBLIC_ELEVENLABS_AGENT_ID en .env";
  } else if (which === "tutor") {
    agentId = process.env.NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID;
    hint = "Configura NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID en .env (pnpm setup:elevenlabs lo crea)";
  } else if ((process.env.HERMES_SALA || "").toLowerCase() === "off") {
    agentId = null;
    hint = "La sala está apagada (HERMES_SALA=off)";
  } else {
    ({ agentId, hint } = await resolveSalaAgentId(which));
  }
  if (!apiKey || !agentId) {
    // Config faltante ≠ crash del server → 503 (servicio no disponible aún).
    return NextResponse.json(
      { notConfigured: true, error: apiKey ? hint : "Falta ELEVENLABS_API_KEY en .env" },
      { status: 503 },
    );
  }

  const headers = { "xi-api-key": apiKey };

  // WebRTC token (latencia más baja)
  const tokenRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
    { headers, cache: "no-store" },
  );
  if (tokenRes.ok) {
    const { token } = (await tokenRes.json()) as { token: string };
    return NextResponse.json({ conversationToken: token });
  }

  // Fallback WebSocket
  const signedRes = await fetch(
    `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
    { headers, cache: "no-store" },
  );
  if (signedRes.ok) {
    const { signed_url } = (await signedRes.json()) as { signed_url: string };
    return NextResponse.json({ signedUrl: signed_url });
  }

  return NextResponse.json(
    { error: `ElevenLabs rechazó ambos métodos (${tokenRes.status}/${signedRes.status})` },
    { status: 502 },
  );
}
