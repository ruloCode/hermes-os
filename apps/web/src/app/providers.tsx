"use client";

import { DocViewerProvider } from "@/components/DocViewer";

/**
 * Providers de cliente que envuelven toda la app. Por ahora: el visor global de
 * documentos del vault (modal tipo Notion para las referencias .md de Hermes).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return <DocViewerProvider>{children}</DocViewerProvider>;
}
