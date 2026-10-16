/**
 * Contexto para {{practice_context}} cuando eliges "Repasar esta clase con la
 * tutora". La tutora es un agente en inglés: las instrucciones van en inglés.
 * Lógica pura (testeable): solo arma el texto.
 */
import type { EnglishSession } from "../types";
import { reportPreview } from "./transcript";

const MAX = 2400;

export function reviewContext(s: EnglishSession, dateLabel: string): string {
  const kind = s.source === "class" ? "a REAL 1:1 class with his human English teacher" : "a previous practice session with you";
  const lines: string[] = [
    `REVIEW MODE. The user wants to review ${kind} from ${dateLabel}.`,
    "Open by saying which session you're reviewing, then drill it — don't lecture.",
  ];
  if (s.topics.length) lines.push(`Topics of that session: ${s.topics.join(", ")}.`);
  const focus = reportPreview(s.report_md, 500);
  if (focus) lines.push(`Coach's analysis (Spanish, for your reference): ${focus}`);
  if (s.errors.length) {
    lines.push(
      "Corrections from that session — go through them ONE BY ONE: give the situation, let him produce the correct form himself, and only then confirm. Revisit the ones he misses at the end:",
    );
    s.errors.slice(0, 12).forEach((e, i) => {
      lines.push(`${i + 1}. He said "${e.quote}" → better: "${e.correction}"${e.note_es ? ` (${e.note_es})` : ""}`);
    });
  } else {
    lines.push("No corrections were saved for that session: ask him what he remembers and practice the topics.");
  }
  if (s.wins.length) lines.push(`Things he did well: ${s.wins.join("; ")}.`);
  const text = lines.join("\n");
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
}
