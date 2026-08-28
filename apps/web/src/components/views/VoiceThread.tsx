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
      <div className="flex flex-col gap-6">
        {transcript.map((l, i) =>
          l.who === "TÚ" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[78%] rounded-lg border border-line bg-violet/10 px-3.5 py-2.5 text-base leading-relaxed">
                {l.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex flex-col gap-2.5">
              <span className="text-2xs tracking-title text-text-faint uppercase">
                <b className="font-normal text-violet">{l.who}</b>
              </span>
              <div className="text-base leading-loose text-text-dim">{l.text}</div>
            </div>
          ),
        )}
        {/* Client tool en curso: el trabajo real que dispara la voz */}
        {action && (
          <div className="flex items-center gap-2 text-2xs tracking-label text-cyan uppercase">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan" />
            {action}
          </div>
        )}
        <div ref={endRef} />
      </div>
    </ScrollArea>
  );
}
