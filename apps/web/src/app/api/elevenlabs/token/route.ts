import { NextResponse } from "next/server";

/**
 * Devuelve credenciales efímeras para conectar el browser con el agente
 * privado de ElevenLabs sin exponer la API key:
 *  - conversationToken (WebRTC, preferido)
 *  - signedUrl (WebSocket, fallback)
 */
export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (!apiKey || !agentId) {
    // Config faltante ≠ crash del server → 503 (servicio no disponible aún).
    return NextResponse.json(
      {
        notConfigured: true,
        error: "Configura ELEVENLABS_API_KEY y NEXT_PUBLIC_ELEVENLABS_AGENT_ID en .env",
      },
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
