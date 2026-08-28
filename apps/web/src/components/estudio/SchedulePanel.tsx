"use client";

/**
 * Programación de la pieza: cuándo sale, a qué hora y en qué zona.
 *
 * Antes la fecha era un `datetime-local` suelto escondido en PROPIEDADES, y la
 * hora había que deducirla del formato del navegador. Aquí es el centro:
 *
 *   ┌ Sale el sáb 16 de ago · 7:00 a. m.  ·  en 6 días ─────────────┐
 *   │ [Programar] [Publicar ya]                                     │
 *   │ Hoy · Mañana · Sábado · +1 semana      [fecha] [hora]         │
 *   │ Zona: America/Bogota (GMT-5)                                  │
 *   │ Ese día ya sale: "Mi setup…" 17:30                            │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Patrones Mobbin: Ghost ("Set it live now | Schedule for later" con fecha,
 * hora y ZONA visibles) · Hootsuite (la hora resuelta escrita en el pie, para
 * no tener que interpretar el input) · Basecamp ("Hoy a las 10:00am": presets
 * antes que calendario) · beehiiv (elegir modo con tarjetas, no un checkbox).
 *
 * Regla del repo: nada de "mejor hora para publicar" — no tenemos ese dato.
 * Los atajos de hora son atajos, no recomendaciones disfrazadas.
 */
import { useMemo, useState } from "react";
import type { ContentPiece, ContentPublication } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";
import { btnCls, inputCls } from "./styles";

const TZ = "America/Bogota";
/** Franjas de uso frecuente. NO son recomendaciones: no medimos audiencia. */
const QUICK_TIMES = ["07:00", "12:00", "19:00"];

/** ISO → "2026-08-16" y "07:00" en hora LOCAL del navegador. */
function splitLocal(iso: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** "2026-08-16" + "07:00" → ISO. Sin fecha no hay ISO. */
function joinLocal(date: string, time: string): string | null {
  if (!date) return null;
  return new Date(`${date}T${time || "09:00"}`).toISOString();
}

/** "en 6 días" · "en 3 h" · "ya pasó hace 2 días". */
function relative(iso: string | null): { text: string; past: boolean } | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const min = Math.round(abs / 60_000);
  const h = Math.round(abs / 3_600_000);
  const d = Math.round(abs / 86_400_000);
  const span = min < 60 ? `${min} min` : h < 36 ? `${h} h` : `${d} días`;
  return { text: past ? `ya pasó hace ${span}` : `en ${span}`, past };
}

/** "sáb 16 de ago · 7:00 a. m." en la zona del proyecto. */
function fmtFull(iso: string): string {
  return new Date(iso)
    .toLocaleString("es-CO", {
      timeZone: TZ,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
    })
    .replace(",", " ·");
}

/** Offset actual de la zona del proyecto, calculado (no hardcodeado). */
function tzLabel(): string {
  const name =
    new Intl.DateTimeFormat("es-CO", { timeZone: TZ, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${TZ} ${name}`.trim();
}

/** El siguiente día de semana pedido (0=dom … 6=sáb), a partir de mañana. */
function nextWeekday(target: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  while (d.getDay() !== target) d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function SchedulePanel({ piece }: { piece: ContentPiece }) {
  const { patchPiece, board } = useEstudioContext();
  const { date, time } = splitLocal(piece.publish_at);
  const [stagger, setStagger] = useState(false);

  const rel = relative(piece.publish_at);
  // El navegador podría estar en otra zona que el proyecto: decirlo, no asumir.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tzMismatch = browserTz !== TZ;

  /** Cambia la fecha de la pieza y arrastra las variantes que la seguían. */
  const setWhen = (nextDate: string, nextTime: string) => {
    const iso = joinLocal(nextDate, nextTime);
    const before = piece.publish_at;
    const pubs: ContentPublication[] = piece.publications.map((p, i) => {
      // Una variante ya subida no se re-programa: su fecha vive en la plataforma.
      if (p.remote_id) return p;
      // Solo se arrastran las que iban con la pieza (o no tenían fecha propia).
      const followed = !p.scheduled_at || p.scheduled_at === before;
      if (!followed) return p;
      if (!iso) return { ...p, scheduled_at: null };
      const offset = stagger ? i * 3 * 3_600_000 : 0; // 3 h entre redes
      return { ...p, scheduled_at: new Date(new Date(iso).getTime() + offset).toISOString() };
    });
    void patchPiece(piece.id, { publish_at: iso, publications: pubs });
  };

  /** Otras piezas que salen el mismo día (contexto real del calendario). */
  const sameDay = useMemo(() => {
    if (!piece.publish_at) return [];
    const day = new Date(piece.publish_at).toDateString();
    return board.pieces.filter(
      (p) =>
        p.id !== piece.id &&
        p.publish_at &&
        p.status !== "descartada" &&
        new Date(p.publish_at).toDateString() === day,
    );
  }, [board.pieces, piece.id, piece.publish_at]);

  return (
    <div
      className={`flex flex-col gap-2 rounded-sm border px-2 py-2 ${
        piece.publish_at
          ? rel?.past
            ? "border-amber/40 bg-amber/5"
            : "border-cyan/35 bg-cyan/5"
          : "border-line"
      }`}
    >
      {/* Lo primero: la frase que responde "¿cuándo sale?" sin interpretar nada. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-2xs tracking-label text-text-faint uppercase">Sale</span>
        {piece.publish_at ? (
          <>
            <span className="text-sm text-text tabular-nums">{fmtFull(piece.publish_at)}</span>
            <span className={`text-2xs tabular-nums ${rel?.past ? "text-amber" : "text-cyan"}`}>
              {rel?.text}
            </span>
          </>
        ) : (
          <span className="text-sm text-text-dim">sin fecha</span>
        )}
        <span className="flex-1" />
        {piece.publish_at && (
          <button
            onClick={() => setWhen("", "")}
            className="text-2xs text-text-faint uppercase hover:text-red"
          >
            ✕ quitar fecha
          </button>
        )}
      </div>

      {/* Atajos de día (Basecamp) + fecha y hora explícitas (Ghost/Hootsuite). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ["Hoy", todayPlus(0)],
            ["Mañana", todayPlus(1)],
            ["Sábado", nextWeekday(6)],
            ["+1 semana", todayPlus(7)],
          ] as [string, string][]
        ).map(([label, value]) => (
          <button
            key={label}
            onClick={() => setWhen(value, time || "07:00")}
            className={`${btnCls} ${date === value ? "border-cyan text-cyan" : ""}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="date"
          value={date}
          onChange={(e) => setWhen(e.target.value, time || "07:00")}
          className={`${inputCls} tabular-nums`}
          aria-label="Fecha de publicación"
        />
        <input
          type="time"
          value={time}
          onChange={(e) => setWhen(date || todayPlus(0), e.target.value)}
          className={`${inputCls} tabular-nums`}
          aria-label="Hora de publicación"
        />
        {QUICK_TIMES.map((t) => (
          <button
            key={t}
            onClick={() => setWhen(date || todayPlus(1), t)}
            className={`${btnCls} tabular-nums ${time === t ? "border-cyan text-cyan" : ""}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Escalonar: una hora por red en vez de las tres a la vez. */}
      {piece.publications.length > 1 && (
        <label className="flex items-center gap-1.5 text-2xs text-text-dim">
          <input
            type="checkbox"
            checked={stagger}
            onChange={(e) => {
              setStagger(e.target.checked);
              if (date) setWhen(date, time);
            }}
            className="accent-cyan"
          />
          Escalonar 3 h entre redes (la primera a la hora puesta)
        </label>
      )}

      <p className="text-2xs text-text-faint">
        Zona: <span className="text-text-dim">{tzLabel()}</span>
        {tzMismatch && (
          <span className="text-amber"> · tu navegador está en {browserTz}, ojo al elegir</span>
        )}
        {piece.publish_at && !rel?.past && (
          <> · YouTube programa la salida solo: el video se sube ya y sale a esta hora.</>
        )}
        {rel?.past && <span className="text-amber"> · la fecha ya pasó: subiría en privado.</span>}
      </p>

      {sameDay.length > 0 && (
        <p className="text-2xs text-text-faint">
          Ese día ya sale:{" "}
          {sameDay.map((p, i) => (
            <span key={p.id}>
              {i > 0 && " · "}
              <span className="text-text-dim">{p.title.slice(0, 34)}</span>{" "}
              <span className="tabular-nums">
                {new Date(p.publish_at as string).toLocaleTimeString("es-CO", {
                  timeZone: TZ,
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
