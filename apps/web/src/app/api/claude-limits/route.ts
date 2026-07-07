import { NextResponse } from "next/server";
import { getClaudeLimits } from "@/lib/claude-limits";

// Consulta en vivo los límites del plan; nunca se pre-renderiza.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await getClaudeLimits();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Fallo al leer los límites del plan:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json(
      {
        available: false,
        generatedAt: new Date().toISOString(),
        plan: null,
        session: null,
        weekly: [],
        reason: message,
      },
      { status: 200 },
    );
  }
}
