import { NextResponse } from "next/server";
import { getClaudeUsage } from "@/lib/claude-usage";

// Lee ~/.claude en cada request (uso en vivo); nunca se pre-renderiza.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getClaudeUsage();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Fallo al leer el uso de Claude:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
