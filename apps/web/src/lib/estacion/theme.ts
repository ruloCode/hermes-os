/**
 * Sistema visual del TÓTEM DE ESTACIÓN. Vive SOLO aquí: el dashboard tiene su
 * propio tema (globals.css) y esta pantalla no lo toca ni al revés. Se aplica
 * como variables CSS en el contenedor de la página, así que los componentes
 * usan `text-[var(--est-cream)]` y nada se filtra al resto de la app.
 *
 * La paleta sale de la identidad de la ciudad y del sistema de transporte
 * (ver docs/estacion-metro.md): verde montaña de fondo, guayaba para el
 * anfitrión de la ciudad y la acción principal, azul del sistema para el
 * anfitrión de los datos, lima para confirmar, naranja para alertar y
 * mantequilla para las tarjetas. El color de cada LÍNEA no está aquí: ese
 * llega del GTFS (route_color) y manda siempre.
 */

export const EST = {
  mountain: "#1F4D3A",
  mountainDeep: "#173A2C",
  guava: "#C4553A",
  system: "#0065B3",
  lime: "#B2D459",
  alert: "#F8821E",
  butter: "#F6E7C1",
  ink: "#12261D",
} as const;

/** Variables CSS del tótem (se ponen en el contenedor raíz de la página). */
export const estVars: React.CSSProperties = {
  ["--est-mountain" as string]: EST.mountain,
  ["--est-mountain-deep" as string]: EST.mountainDeep,
  ["--est-guava" as string]: EST.guava,
  ["--est-system" as string]: EST.system,
  ["--est-lime" as string]: EST.lime,
  ["--est-alert" as string]: EST.alert,
  ["--est-butter" as string]: EST.butter,
  ["--est-ink" as string]: EST.ink,
};

/** Color de un anfitrión: el de los datos va en azul del sistema; el de la ciudad, guayaba. */
export function hostColor(index: number): string {
  return index === 0 ? EST.system : EST.guava;
}

/**
 * Curvas de nivel del fondo: un SVG generado, no una imagen. Determinista (la
 * misma pantalla se ve igual en cada render) y barato: 9 trazos de seno con
 * fase y amplitud distintas, como las líneas de un mapa topográfico.
 */
export function contourPaths(width = 1080, height = 1920, lines = 9): string[] {
  const paths: string[] = [];
  for (let i = 0; i < lines; i++) {
    const y0 = (height / (lines + 1)) * (i + 1);
    const amp = 26 + ((i * 37) % 60);
    const freq = 1.1 + ((i * 13) % 7) / 10;
    const phase = (i * 1.7) % Math.PI;
    let d = `M -40 ${y0.toFixed(1)}`;
    for (let x = 0; x <= width + 40; x += 40) {
      const y = y0 + Math.sin((x / width) * Math.PI * 2 * freq + phase) * amp;
      d += ` L ${x} ${y.toFixed(1)}`;
    }
    paths.push(d);
  }
  return paths;
}

/** Texto del reloj en la zona del sistema (HH:MM, 24 h). */
export function clockText(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("es-CO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(now);
}

export type EstLanguage = "es" | "en" | "pt";

export const LANGUAGES: { code: EstLanguage; label: string }[] = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
];

/** Textos de la pantalla por idioma. La voz habla; esto es lo que se LEE. */
export const COPY: Record<EstLanguage, Record<string, string>> = {
  es: {
    idle: "¿Para dónde vas?",
    idleHint: "Háblale a la pantalla. Nombra a uno para dirigirte a él.",
    listening: "Te escucho…",
    connecting: "Conectando…",
    route: "Tu ruta",
    places: "Qué hacer cerca",
    transfers: "transbordos",
    transfer: "transbordo",
    noTransfers: "sin transbordos",
    minutes: "min",
    stops: "paradas",
    stop: "parada",
    walk: "a pie",
    here: "en esta estación",
    noHours: "sin horario publicado",
    scheduleNote: "Horario publicado, no tiempo real",
    next: "Próximo",
    privacy: "La cámara no graba ni guarda tu imagen. Solo detecta que hay alguien para encender la conversación.",
    enter: "Tocar para hablar",
    line: "Línea",
  },
  en: {
    idle: "Where are you headed?",
    idleHint: "Just talk to the screen. Say a name to address one of us.",
    listening: "Listening…",
    connecting: "Connecting…",
    route: "Your route",
    places: "What's nearby",
    transfers: "transfers",
    transfer: "transfer",
    noTransfers: "no transfers",
    minutes: "min",
    stops: "stops",
    stop: "stop",
    walk: "walk",
    here: "at this station",
    noHours: "hours not published",
    scheduleNote: "Published timetable, not live",
    next: "Next",
    privacy: "The camera does not record or store your image. It only detects someone is there to start the conversation.",
    enter: "Tap to talk",
    line: "Line",
  },
  pt: {
    idle: "Para onde você vai?",
    idleHint: "Fale com a tela. Diga um nome para falar com um de nós.",
    listening: "Ouvindo…",
    connecting: "Conectando…",
    route: "Sua rota",
    places: "O que fazer por perto",
    transfers: "baldeações",
    transfer: "baldeação",
    noTransfers: "sem baldeações",
    minutes: "min",
    stops: "paradas",
    stop: "parada",
    walk: "a pé",
    here: "nesta estação",
    noHours: "horário não publicado",
    scheduleNote: "Horário publicado, não tempo real",
    next: "Próximo",
    privacy: "A câmera não grava nem guarda sua imagem. Só detecta que há alguém para iniciar a conversa.",
    enter: "Toque para falar",
    line: "Linha",
  },
};

export function t(lang: EstLanguage, key: string): string {
  return COPY[lang]?.[key] ?? COPY.es[key] ?? key;
}
