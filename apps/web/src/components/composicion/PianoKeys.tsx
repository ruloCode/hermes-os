"use client";

/**
 * Piano SVG de dos octavas: pinta la escala (tenue) y el acorde activo
 * (encendido). Es un instrumento de LECTURA — "¿qué notas tiene esto?" — y
 * de clic: cada tecla suena. Patrón Mobbin (Duolingo Music): teclas grandes
 * con la nota escrita encima, sin adornos.
 */
import { latinName, midi, mod12, noteName, type Key, type Pc } from "@/lib/music-theory";
import { toneVar, type Tone } from "@/components/ui/tones";

const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_AFTER: Record<number, boolean> = { 0: true, 2: true, 5: true, 7: true, 9: true };

export function PianoKeys({
  musicKey,
  scale = [],
  active = [],
  octaves = 2,
  tone = "violet",
  notation = "en",
  onPlay,
  height = 64,
}: {
  musicKey: Key;
  scale?: Pc[];
  active?: Pc[];
  octaves?: 1 | 2;
  tone?: Tone;
  notation?: "en" | "latin";
  onPlay?: (m: number) => void;
  height?: number;
}) {
  const W = 22;
  const whites = octaves * 7;
  const width = whites * W;
  const color = toneVar(tone);
  const hot = toneVar("cyan");
  const name = (pc: Pc) => (notation === "latin" ? latinName(pc, musicKey) : noteName(pc, musicKey));

  const keys: { pc: Pc; oct: number; x: number; black: boolean }[] = [];
  let x = 0;
  for (let o = 0; o < octaves; o++) {
    for (const pc of WHITE_PCS) {
      keys.push({ pc, oct: 4 + o, x, black: false });
      if (BLACK_AFTER[pc]) keys.push({ pc: mod12(pc + 1), oct: 4 + o, x: x + W * 0.65, black: true });
      x += W;
    }
  }

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width * 1.6 }} className="block select-none" role="img" aria-label="Piano">
      {keys
        .filter((k) => !k.black)
        .map((k) => {
          const inScale = scale.includes(k.pc);
          const isActive = active.includes(k.pc);
          return (
            <g key={`${k.pc}-${k.oct}`} onClick={() => onPlay?.(midi(k.pc, k.oct))} style={{ cursor: onPlay ? "pointer" : "default" }}>
              <rect
                x={k.x + 0.5}
                y={0.5}
                width={W - 1}
                height={height - 1}
                rx={2}
                fill={isActive ? hot : inScale ? `color-mix(in srgb, ${color} 18%, var(--color-key-white))` : "var(--color-key-white)"}
                stroke={isActive ? hot : "var(--color-line-2)"}
              />
              {(inScale || isActive) && (
                <text x={k.x + W / 2} y={height - 6} textAnchor="middle" fontSize={notation === "latin" ? 6 : 7} fill={isActive ? "var(--color-key-ink)" : color} fontFamily="var(--font-mono)">
                  {name(k.pc)}
                </text>
              )}
            </g>
          );
        })}
      {keys
        .filter((k) => k.black)
        .map((k) => {
          const inScale = scale.includes(k.pc);
          const isActive = active.includes(k.pc);
          return (
            <g key={`${k.pc}-${k.oct}-b`} onClick={() => onPlay?.(midi(k.pc, k.oct))} style={{ cursor: onPlay ? "pointer" : "default" }}>
              <rect
                x={k.x}
                y={0}
                width={W * 0.7}
                height={height * 0.6}
                rx={1.5}
                fill={isActive ? hot : inScale ? `color-mix(in srgb, ${color} 55%, var(--color-key-black))` : "var(--color-key-black)"}
                stroke={isActive ? hot : "var(--color-line-2)"}
              />
              {(inScale || isActive) && (
                <text x={k.x + (W * 0.7) / 2} y={height * 0.6 - 5} textAnchor="middle" fontSize={5.5} fill={isActive ? "var(--color-key-ink)" : "#ffffff"} fontFamily="var(--font-mono)">
                  {name(k.pc)}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}
