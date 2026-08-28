"use client";

/**
 * Estado REAL de la carpeta de la pieza en el disco (crudos/assets/exports).
 *
 * No es un poll: el disco no cambia solo, así que se escanea al abrir y cuando
 * algo escribe un archivo — `mediaVersion` del provider hace de invalidación
 * compartida (grabar la voz en off en el teleprompter refresca el checklist de
 * Tomas y el tab Edición sin que ninguno sepa del otro).
 */
import { useCallback, useEffect, useState } from "react";
import type { PieceMedia } from "@hermes/shared";
import { useEstudioContext } from "@/state/EstudioProvider";

export function usePieceMedia(pieceId: number | null) {
  const { pieceMedia, mediaVersion } = useEstudioContext();
  const [media, setMedia] = useState<PieceMedia | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (pieceId == null) return null;
    setLoading(true);
    const m = await pieceMedia(pieceId);
    setMedia(m);
    setError(m === null);
    setLoading(false);
    return m;
  }, [pieceId, pieceMedia]);

  useEffect(() => {
    void refresh();
  }, [refresh, mediaVersion]);

  return { media, error, loading, refresh };
}
