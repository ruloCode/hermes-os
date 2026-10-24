// Iconos del plan de inglés: uno por tipo de lección + estados. Trazo 1.8
// como el resto de la app; heredan el color del texto (currentColor).

import type { LessonKind } from "@hermes/shared";

function Svg({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export function KindIcon({ kind, size = 22 }: { kind: LessonKind; size?: number }) {
  switch (kind) {
    case "regla":
      return (
        <Svg size={size}>
          <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" />
          <path d="M4 19a2 2 0 0 1 2-2h12" />
          <path d="M9 7h5M9 10.5h4" />
        </Svg>
      );
    case "gimnasio":
      return (
        <Svg size={size}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
        </Svg>
      );
    case "tutora":
      return (
        <Svg size={size}>
          <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
          <rect x="3" y="14" width="4" height="6" rx="1.5" />
          <rect x="17" y="14" width="4" height="6" rx="1.5" />
        </Svg>
      );
    case "prueba":
      return (
        <Svg size={size}>
          <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
        </Svg>
      );
  }
}

export function CheckIcon({ size = 22 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <Svg size={size}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </Svg>
  );
}

export function FlameIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg size={size}>
      <path d="M12 21c3.9 0 7-2.8 7-6.6 0-4.1-3.4-6.4-4.4-10.4-2.3 1.6-3.4 3.7-3.3 6.3C9.9 9.2 9 8 9 6.3 6.6 8.2 5 10.9 5 14.4 5 18.2 8.1 21 12 21Z" />
    </Svg>
  );
}

export const KIND_LABEL: Record<LessonKind, string> = {
  regla: "Regla",
  gimnasio: "Gimnasio",
  tutora: "Tutora",
  prueba: "Prueba",
};
