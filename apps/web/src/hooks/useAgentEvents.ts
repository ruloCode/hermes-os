"use client";

// Firma histórica conservada: ahora lee del SSE único del shell
// (AgentEventsProvider) en vez de abrir una conexión por consumidor.
export { useAgentEventsContext as useAgentEvents } from "@/state/AgentEventsProvider";
