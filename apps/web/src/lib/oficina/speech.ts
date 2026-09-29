// La respuesta del agente, en voz alta: cuando termina un agente al que le
// hablaste, su resumen se lee con la síntesis de voz del sistema (gratis, sin
// red; en macOS hay voces en español como Paulina o Mónica). Se puede apagar
// desde el HUD y la preferencia vive en el navegador.

const KEY = "hermes-oficina-voz-respuesta";

export function replyVoiceEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setReplyVoice(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* modo privado */
  }
}

/** Lo que se lee: sin markdown, sin "$0.26 · 7s ·", una o dos frases. */
export function spokenSummary(text: string): string {
  let t = text
    .replace(/^\$\d+(\.\d+)?\s*·\s*\d+s\s*·\s*/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > 280) {
    const cut = t.slice(0, 280);
    const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
    t = end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
  }
  return t;
}

function spanishVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const es = voices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  const byPref = (names: string[]) => es.find((v) => names.some((n) => v.name.includes(n)));
  return byPref(["Paulina", "Mónica", "Monica", "Marisol", "Google español"]) ?? es.find((v) => /419|MX|CO|US/.test(v.lang)) ?? es[0] ?? null;
}

/** Lee `text` en voz alta. Devuelve false si el navegador no tiene síntesis. */
export function speak(text: string, onEnd?: () => void): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  const say = spokenSummary(text);
  if (!say) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(say);
  const voice = spanishVoice();
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "es-CO";
  u.rate = 1.05;
  u.onend = () => onEnd?.();
  window.speechSynthesis.speak(u);
  return true;
}

export function stopSpeaking() {
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}
