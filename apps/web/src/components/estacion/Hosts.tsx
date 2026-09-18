"use client";

// LOS DOS ANFITRIONES. No son avatares humanos: dos figuras de color con su
// nombre y su rol. El que está hablando se enciende (anillo + escala) con el
// mismo dato que usa la sala 3D: quién suena en este instante.

import { hostColor, type EstLanguage } from "@/lib/estacion/theme";

export interface HostView {
  key: string;
  name: string;
  /** "tu ruta" · "tu ciudad": el rol se lee antes que el nombre. */
  role: string;
}

interface Props {
  hosts: HostView[];
  speakingKey: string | null;
  /** 0..1 del volumen de salida, para que el aro respire con la voz. */
  level: number;
  lang: EstLanguage;
}

export function Hosts({ hosts, speakingKey, level }: Props) {
  return (
    <div className="flex items-end justify-center gap-10">
      {hosts.map((h, i) => {
        const on = speakingKey === h.key;
        const color = hostColor(i);
        const scale = on ? 1 + Math.min(0.12, level * 0.18) : 1;
        return (
          <div key={h.key} className="flex w-[240px] flex-col items-center gap-3">
            <div
              className="relative grid place-items-center rounded-full transition-[transform,box-shadow] duration-150"
              style={{
                width: 150,
                height: 150,
                transform: `scale(${scale})`,
                backgroundColor: color,
                boxShadow: on ? `0 0 0 10px ${color}40, 0 18px 40px rgba(0,0,0,0.3)` : "0 12px 28px rgba(0,0,0,0.25)",
              }}
            >
              {/* Cara mínima: dos puntos. Un robot amable, no una persona falsa. */}
              <span className="flex gap-6">
                <span className="block h-4 w-4 rounded-full bg-white/90" />
                <span className="block h-4 w-4 rounded-full bg-white/90" />
              </span>
              {on && (
                <span
                  aria-hidden
                  className="absolute -bottom-2 h-[10px] rounded-full bg-white/80"
                  style={{ width: 40 + level * 70 }}
                />
              )}
            </div>
            <p
              className="font-[family-name:var(--font-baloo)] text-[30px] leading-none font-semibold"
              style={{ color: on ? "#fff" : "var(--est-butter)" }}
            >
              {h.name}
            </p>
            <p className="text-[19px] text-[var(--est-butter)]/70">{h.role}</p>
          </div>
        );
      })}
    </div>
  );
}
