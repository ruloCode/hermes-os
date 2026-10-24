// Primer turno de una lección del plan con la tutora. El saludo de la tutora es
// fijo (su first_message no admite override), así que al conectar el cliente
// manda este mensaje POR el usuario para que arranque la lección de una vez
// (mismo truco que "Repasar esta clase" en el móvil). Vive fuera de React: lo
// escribe useVoiceConnect al pedir el contexto y lo consume InglesView cuando
// la llamada ya está conectada.

let pending: string | null = null;

export function setLessonOpening(text: string | null): void {
  pending = text;
}

export function takeLessonOpening(): string | null {
  const t = pending;
  pending = null;
  return t;
}
