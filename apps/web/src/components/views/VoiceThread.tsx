"use client";

// Transcripción de la llamada EN EL HOME, con la misma piel que el chat de
// texto: hablar y escribir son el MISMO canal en dos modalidades, así que se
// leen igual (píldora a la derecha = tú · prosa sin caja = Hermes).
//
// Antes conectar la voz te sacaba del home al tab "voz". Con el orbe siendo el
// protagonista del home eso no tiene sentido: la conversación pasa donde estás.

import { useEffect, useRef } from "react";
import { useVoice } from "@/components/VoiceBusyContext";
import { ScrollArea } from "@/components/ui/ScrollArea";

export function VoiceThread() {
  const { transcript, action } = useVoice();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [transcript.length]);

  return (
    <ScrollArea rail fade="y" className="min-h-0 flex-1 pr-1">
      <div className="flex flex-col gap-5 py-1">
        {transcript.map((l, i) =>
          l.who === "TÚ" ? (
            <div key={i} className="flex justify-end">
              {/* Misma píldora que el turno del usuario en el chat de texto. */}
              <div className="max-w-[82%] rounded-lg bg-panel-2 px-3 py-2 text-sm leading-relaxed text-text">
                {l.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-text-dim">
                {l.who.charAt(0) + l.who.slice(1).toLowerCase()}
              </span>
              <div className="text-sm leading-relaxed text-text">{l.text}</div>
            </div>
          ),
        )}
        {/* Client tool en curso: el trabajo real que dispara la voz */}
        {action && (
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-cyan" />
            {action}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
