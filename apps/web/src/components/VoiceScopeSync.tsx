"use client";

import { useEffect, useRef } from "react";
import { useConversationControls, useConversationStatus } from "@elevenlabs/react";
import { useVoice, type VoiceScope } from "./VoiceBusyContext";

/**
 * Sincroniza el PROYECTO ENFOCADO del dashboard con el scope de la voz.
 *
 * - Empuja el proyecto en foco al contexto de voz → `useVoiceConnect` lo inyecta
 *   como dynamic variable `session_scope` al iniciar la llamada (el agente
 *   arranca sabiendo en qué proyecto estamos).
 * - Si el foco CAMBIA a mitad de una llamada activa, le avisa a Hermes por
 *   contextual update (las dynamic variables solo se fijan al inicio de sesión).
 *
 * No renderiza nada. Vive dentro del ConversationProvider.
 */
export function VoiceScopeSync({ slug, name }: { slug: string | null; name?: string }) {
  const { setScope } = useVoice();
  const { status } = useConversationStatus();
  const { sendContextualUpdate } = useConversationControls();

  const next: VoiceScope | null = slug ? { slug, name: name || slug } : null;
  const prevSlugRef = useRef<string | null>(null);
  const connected = status === "connected";

  // Mantiene el scope del contexto al día.
  useEffect(() => {
    setScope(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, name, setScope]);

  // Cambio de foco durante una llamada → reencuadra al agente en vivo.
  useEffect(() => {
    const prev = prevSlugRef.current;
    prevSlugRef.current = slug;
    if (prev === slug || !connected) return;
    if (slug) {
      sendContextualUpdate(
        `[Scope] A partir de ahora el usuario está DENTRO del proyecto "${name || slug}" (slug: ${slug}). Centra todo en este proyecto salvo que nombre otro.`,
      );
    } else {
      sendContextualUpdate(
        "[Scope] El usuario salió del proyecto: ahora está en la vista general, sin proyecto enfocado.",
      );
    }
  }, [slug, name, connected, sendContextualUpdate]);

  return null;
}
