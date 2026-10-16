/**
 * Transcripciones de inglés → turnos de conversación. Lógica pura.
 *
 * Dos formatos reales conviven en english_sessions.transcript:
 *  - Clase en vivo (ingestClass): párrafos `**Profe:** …` / `**Yo:** …` y una
 *    primera línea `> Clase en vivo — tu habla: 38 % …` con las métricas.
 *  - Práctica con la tutora (web/móvil): líneas `TUTOR: …` / `TÚ: …`.
 * Una línea sin etiqueta continúa el turno anterior.
 */
export type Speaker = "teacher" | "me" | "other";

export interface Turn {
  who: Speaker;
  /** Etiqueta original ("Profe", "Tutora", "Hablante 2"…). */
  label: string;
  text: string;
}

export interface ParsedTranscript {
  /** Líneas `> …` de métricas del encabezado. */
  meta: string[];
  turns: Turn[];
}

const ME = /^(yo|tú|tu|me|you|user)$/i;
const TEACHER = /^(profe|profesora|profesor|teacher|tutor|tutora)$/i;

function speakerOf(label: string): Speaker {
  if (ME.test(label)) return "me";
  if (TEACHER.test(label)) return "teacher";
  return "other";
}

const BOLD = /^\*\*([^*:]{1,30}):\*\*\s*(.*)$/;
const PLAIN = /^([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{0,20}\d{0,2}):\s+(.*)$/;

export function parseTranscript(raw: string | null | undefined): ParsedTranscript {
  const meta: string[] = [];
  const turns: Turn[] = [];
  for (const line of (raw ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith(">")) {
      meta.push(t.replace(/^>\s*/, ""));
      continue;
    }
    const m = BOLD.exec(t) ?? PLAIN.exec(t);
    if (m) {
      const label = m[1].trim();
      const who = speakerOf(label);
      // Una etiqueta cualquiera ("Nota: …") no es un hablante si no la conocemos
      // y no viene en negrita: se queda como continuación.
      if (who !== "other" || BOLD.test(t) || /^hablante/i.test(label)) {
        turns.push({ who, label: displayLabel(label, who), text: m[2].trim() });
        continue;
      }
    }
    const last = turns[turns.length - 1];
    if (last) last.text = `${last.text}\n${t}`.trim();
    else turns.push({ who: "other", label: "", text: t });
  }
  return { meta, turns: turns.filter((x) => x.text) };
}

function displayLabel(label: string, who: Speaker): string {
  if (who === "me") return "Tú";
  if (/^tutor/i.test(label)) return "Tutora";
  if (who === "teacher") return "Profe";
  return label;
}

/** "tu habla: 38 %" del encabezado de una clase, si está. */
export function talkShare(meta: string[]): number | null {
  const m = /tu habla:\s*(\d{1,3})\s*%/i.exec(meta.join(" "));
  return m ? Number(m[1]) : null;
}

/** Primer párrafo de texto del reporte (sin markdown) para la vista previa. */
export function reportPreview(md: string | null | undefined, max = 160): string {
  const para = (md ?? "")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("#"))
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith("#"));
  if (!para) return "";
  const plain = para.replace(/[*_`>#]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}
