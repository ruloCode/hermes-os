"use client";

/**
 * Datos del ESTUDIO (creación de contenido RuloCode): un solo poll a
 * GET /content/board + mutaciones finas con merge optimista y reload.
 * Mismo patrón que useVida (poll 10s, mutaciones que recargan al terminar).
 */
import { useCallback, useEffect, useState } from "react";
import type {
  ClipBrowse,
  ContentBoard,
  ContentPiece,
  ContentPillar,
  ContentRef,
  ContentSession,
  HookPerformanceRow,
  PieceMedia,
  PieceMetrics,
  PublishProviderStatus,
} from "@hermes/shared";
import { hermesDelete, hermesGet, hermesPatch, hermesPost, uploadVoiceover } from "@/lib/hermes";

/** Subcarpeta canónica de la pieza (crudos = material, assets = voz/gráficos). */
export type MediaSubdir = "crudos" | "assets" | "exports";

const EMPTY: ContentBoard = { available: false, pieces: [], sessions: [], refs: [] };

/** Patch de pieza con las claves del tipo compartido (snake_case). */
export type PiecePatch = Partial<
  Pick<
    ContentPiece,
    | "title"
    | "pillar"
    | "platforms"
    | "format"
    | "status"
    | "publish_at"
    | "week_label"
    | "hook"
    | "script_md"
    | "takes"
    | "edit_points"
    | "publications"
    | "master_path"
    | "variants"
    | "notes"
    | "session_id"
  >
>;

/** Patch de referencia del radar (detalle editable). */
export type RefPatch = Partial<
  Pick<
    ContentRef,
    "kind" | "title" | "body" | "metric" | "source" | "url" | "apply_status" | "pillar"
  >
>;

export function useEstudio() {
  const [board, setBoard] = useState<ContentBoard>(EMPTY);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  // Modo grabación (teleprompter a pantalla completa) + bloque de arranque:
  // vive aquí porque se abre desde el workspace, desde el riel y desde ⌘K.
  const [recordingId, setRecordingId] = useState<number | null>(null);
  const [recordingBeat, setRecordingBeat] = useState(0);

  const load = useCallback(async () => {
    try {
      const b = await hermesGet<ContentBoard>("/content/board");
      setBoard(b);
      setOnline(true);
      // Sin auto-selección: la pantalla de entrada es la LISTA (takeover —
      // elegir una pieza la abre a pantalla completa; auto-elegir la saltaría).
    } catch {
      setOnline(false);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [load]);

  const selected = board.pieces.find((p) => p.id === selectedId) ?? null;

  /** Abre (o cierra con null) el modo grabación de una pieza en un bloque. */
  const setRecording = useCallback((id: number | null, beat = 0) => {
    setRecordingId(id);
    setRecordingBeat(beat);
    if (id != null) setSelectedId(id);
  }, []);

  /** Merge optimista local + persistencia; el poll corrige cualquier deriva. */
  const patchPiece = useCallback(
    async (id: number, patch: PiecePatch) => {
      setBoard((b) => ({
        ...b,
        pieces: b.pieces.map((p) => (p.id === id ? ({ ...p, ...patch } as ContentPiece) : p)),
      }));
      try {
        const saved = await hermesPatch<ContentPiece>(`/content/pieces/${id}`, patch);
        setBoard((b) => ({
          ...b,
          pieces: b.pieces.map((p) => (p.id === id ? saved : p)),
        }));
        return saved;
      } catch {
        await load(); // revertir al estado real
        return null;
      }
    },
    [load],
  );

  const createPiece = useCallback(
    async (input: {
      title: string;
      pillar?: ContentPillar;
      platforms?: string[];
      format?: ContentPiece["format"];
      notes?: string;
      /** Referencia del radar de la que nace (trazabilidad en su detalle). */
      ref_id?: number;
    }) => {
      const piece = await hermesPost<ContentPiece>("/content/pieces", input).catch(() => null);
      if (piece) {
        await load();
        setSelectedId(piece.id);
      }
      return piece;
    },
    [load],
  );

  /** Genera guion + plan de tomas + edición + copies con el Agent SDK (~30-60s). */
  const generateKit = useCallback(async (id: number, description?: string) => {
    const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/generate`, {
      description,
    }).catch(() => null);
    if (piece)
      setBoard((b) => ({ ...b, pieces: b.pieces.map((p) => (p.id === id ? piece : p)) }));
    return piece;
  }, []);

  /** Mete al board una pieza que llegó por otro canal (el chat la muta en vivo). */
  const mergePiece = useCallback((piece: ContentPiece) => {
    setBoard((b) => ({ ...b, pieces: b.pieces.map((p) => (p.id === piece.id ? piece : p)) }));
  }, []);

  // ── Crudos + edición automática (OpenMontage) ────────────────────────

  /** Lista carpetas + videos del disco del agente (file-picker server-side). */
  const browseClips = useCallback(
    async (dir?: string) =>
      hermesGet<ClipBrowse>(
        `/content/clips/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`,
      ),
    [],
  );

  /** Vincula rutas locales como crudos de la pieza (el agente hace ffprobe). */
  const addClips = useCallback(
    async (id: number, paths: string[]) => {
      const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/clips`, {
        paths,
      }).catch(() => null);
      if (piece) mergePiece(piece);
      return piece;
    },
    [mergePiece],
  );

  const removeClip = useCallback(
    async (id: number, clipId: string) => {
      const piece = await hermesDelete<ContentPiece>(
        `/content/pieces/${id}/clips/${clipId}`,
      ).catch(() => null);
      if (piece) mergePiece(piece);
      return piece;
    },
    [mergePiece],
  );

  /** Dispara la edición automática; devuelve el error legible si no arrancó. */
  const startEditRun = useCallback(
    async (id: number, brief?: string): Promise<{ piece: ContentPiece | null; error?: string }> => {
      try {
        const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/edit-run`, { brief });
        mergePiece(piece);
        return { piece };
      } catch (err) {
        return { piece: null, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [mergePiece],
  );

  const stopEditRun = useCallback(
    async (id: number) => {
      const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/edit-run/stop`).catch(
        () => null,
      );
      if (piece) mergePiece(piece);
      return piece;
    },
    [mergePiece],
  );

  /** Abre el master en QuickTime (reveal=true lo muestra en Finder). */
  const openEditOutput = useCallback(async (id: number, reveal = false) => {
    return hermesPost<{ ok: boolean; error?: string }>(`/content/pieces/${id}/edit-run/open`, {
      reveal,
    }).catch(() => ({ ok: false, error: "agente fuera de línea" }));
  }, []);

  // ── Carpeta de la pieza en el disco extraíble (checklist de captura) ──

  /** Estado real de <disco>/estudio/<pieza>/ (crudos/assets/exports). */
  const pieceMedia = useCallback(
    async (id: number) => hermesGet<PieceMedia>(`/content/pieces/${id}/media`).catch(() => null),
    [],
  );

  /** Crea la carpeta canónica de la pieza (y sella media_dir). */
  const ensureMediaFolder = useCallback(
    async (id: number) => {
      const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/media/folder`).catch(
        () => null,
      );
      if (piece) mergePiece(piece);
      return piece;
    },
    [mergePiece],
  );

  /** Vincula los videos de crudos/ + assets/ de la carpeta como raw_clips. */
  const linkFolderClips = useCallback(
    async (id: number): Promise<{ piece: ContentPiece | null; added: number }> => {
      try {
        const r = await hermesPost<{ piece: ContentPiece; added: number }>(
          `/content/pieces/${id}/media/link`,
        );
        mergePiece(r.piece);
        return r;
      } catch {
        return { piece: null, added: 0 };
      }
    },
    [mergePiece],
  );

  /**
   * Abre en Finder la carpeta de la pieza o una subcarpeta (`crudos` para
   * soltar el material, `assets` para la voz en off). El agente la crea si
   * falta: el botón nunca se queda sin hacer nada.
   */
  const revealMediaFolder = useCallback(async (id: number, sub?: MediaSubdir) => {
    return hermesPost<{ ok: boolean; dir?: string; error?: string }>(
      `/content/pieces/${id}/media/reveal`,
      { sub },
    ).catch(() => ({ ok: false, error: "agente fuera de línea" }) as { ok: boolean; error?: string });
  }, []);

  /**
   * Contador que invalida el escaneo del disco: lo bombea quien escribe un
   * archivo (grabar/borrar voz en off) para que el checklist de Tomas y el tab
   * Edición se enteren aunque el cambio haya pasado en el teleprompter.
   */
  const [mediaVersion, setMediaVersion] = useState(0);
  const bumpMedia = useCallback(() => setMediaVersion((v) => v + 1), []);

  /** Graba una toma de voz en off en assets/ (el agente la pasa a WAV 48k). */
  const saveVoiceover = useCallback(
    async (id: number, stem: string, blob: Blob) => {
      try {
        const r = await uploadVoiceover(id, { stem, blob });
        bumpMedia();
        return r;
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) } as {
          error: string;
        };
      }
    },
    [bumpMedia],
  );

  /** "▲ Usar esta toma": la asciende a última (el agente la renombra). */
  const promoteVoiceover = useCallback(
    async (id: number, name: string) => {
      const r = await hermesPost<{ media: PieceMedia; name: string }>(
        `/content/pieces/${id}/voiceover/${encodeURIComponent(name)}/promote`,
      ).catch(() => null);
      bumpMedia();
      return r;
    },
    [bumpMedia],
  );

  /** Borra UNA toma de voz en off (las demás quedan). */
  const removeVoiceover = useCallback(
    async (id: number, name: string) => {
      const media = await hermesDelete<PieceMedia>(
        `/content/pieces/${id}/voiceover/${encodeURIComponent(name)}`,
      ).catch(() => null);
      bumpMedia();
      return media;
    },
    [bumpMedia],
  );

  // ── Publicación automática (fase 1: YouTube Shorts) ──────────────────

  /** Re-escanea el disco y sella el master canónico (exports/ o el run). */
  const sealMaster = useCallback(
    async (id: number) => {
      const r = await hermesPost<{ piece: ContentPiece; master: string | null }>(
        `/content/pieces/${id}/master`,
      ).catch(() => null);
      if (r?.piece) mergePiece(r.piece);
      return r;
    },
    [mergePiece],
  );

  /**
   * Sube ya. `only` = id de UNA variante (el ▶ de la fila). Devuelve el error
   * legible del agente para pintarlo en sitio, como startEditRun.
   */
  const publishPiece = useCallback(
    async (
      id: number,
      only?: string,
    ): Promise<{ piece: ContentPiece | null; error?: string }> => {
      try {
        const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/publish`, { only });
        mergePiece(piece);
        return { piece };
      } catch (err) {
        return { piece: null, error: err instanceof Error ? err.message : String(err) };
      }
    },
    [mergePiece],
  );

  /** Qué providers están configurados (se carga una vez por vista). */
  const [providers, setProviders] = useState<PublishProviderStatus[]>([]);
  useEffect(() => {
    void hermesGet<{ providers: PublishProviderStatus[] }>("/content/publish/providers")
      .then((r) => setProviders(r.providers))
      .catch(() => setProviders([]));
  }, []);

  /** 3-5 versiones nuevas de una parte del guion ("hook" o etiqueta del bloque). */
  const generateVariants = useCallback(
    async (id: number, part: string, current?: string, brief?: string) => {
      const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/variants`, {
        part,
        current,
        brief,
      }).catch(() => null);
      if (piece)
        setBoard((b) => ({ ...b, pieces: b.pieces.map((p) => (p.id === id ? piece : p)) }));
      return piece;
    },
    [],
  );

  const linkLinear = useCallback(
    async (id: number) => {
      const piece = await hermesPost<ContentPiece>(`/content/pieces/${id}/linear`).catch(
        () => null,
      );
      if (piece) await load();
      return piece;
    },
    [load],
  );

  const patchSession = useCallback(
    async (id: number, patch: Partial<Pick<ContentSession, "status" | "checklist" | "notes">>) => {
      const session = await hermesPatch<ContentSession>(`/content/sessions/${id}`, patch).catch(
        () => null,
      );
      if (session) await load();
      return session;
    },
    [load],
  );

  const createSession = useCallback(
    async (input: { title: string; scheduled_at?: string; checklist?: { label: string; done: boolean }[] }) => {
      const session = await hermesPost<ContentSession>("/content/sessions", input).catch(
        () => null,
      );
      if (session) await load();
      return session;
    },
    [load],
  );

  /**
   * Arma el batch de grabación desde piezas concretas (las "listas para
   * grabar"): el agente crea la sesión con su checklist y avanza a grabacion
   * las que estaban en guion — meterlas al batch ES el compromiso.
   */
  const buildBatch = useCallback(
    async (pieceIds: number[], title?: string) => {
      const r = await hermesPost<{ session: ContentSession; pieces: ContentPiece[] }>(
        "/content/sessions/from-pieces",
        { piece_ids: pieceIds, title },
      ).catch(() => null);
      if (r) await load();
      return r;
    },
    [load],
  );

  /** Re-fecha las piezas vencidas en un acto, a la cadencia elegida. */
  const replanOverdue = useCallback(
    async (perWeek: number) => {
      const r = await hermesPost<{
        changed: { id: number; title: string; from: string; to: string }[];
      }>("/content/replan", { per_week: perWeek }).catch(() => null);
      if (r?.changed.length) await load();
      return r;
    },
    [load],
  );

  /** Métricas reales de la pieza (bucle de resultados; null = sin agente). */
  const pieceMetrics = useCallback(
    async (id: number) =>
      hermesGet<PieceMetrics>(`/content/pieces/${id}/metrics`).catch(() => null),
    [],
  );

  /** Dispara el sync de métricas a demanda (el job igual corre cada 6 h). */
  const syncMetrics = useCallback(
    async () =>
      hermesPost<{ videos: number; rows: number; analyticsSkipped: string | null }>(
        "/content/metrics/sync",
      ).catch(() => null),
    [],
  );

  /** Hooks que ya salieron con su dato (biblioteca de hooks). */
  const hookPerformance = useCallback(
    async () =>
      hermesGet<{ hooks: HookPerformanceRow[] }>("/content/hooks/performance")
        .then((r) => r.hooks)
        .catch(() => [] as HookPerformanceRow[]),
    [],
  );

  const saveRef = useCallback(
    async (input: {
      kind: ContentRef["kind"];
      /** Opcional si viene url: el agente resuelve el título real por oEmbed. */
      title?: string;
      body?: string;
      metric?: string;
      source?: string;
      url?: string;
      apply_status?: ContentRef["apply_status"];
      pillar?: ContentPillar;
    }) => {
      const ref = await hermesPost<ContentRef>("/content/refs", input).catch(() => null);
      if (ref) await load();
      return ref;
    },
    [load],
  );

  /** Edición fina de una referencia del radar (merge optimista, como las piezas). */
  const patchRef = useCallback(
    async (id: number, patch: RefPatch) => {
      setBoard((b) => ({
        ...b,
        refs: b.refs.map((r) => (r.id === id ? ({ ...r, ...patch } as ContentRef) : r)),
      }));
      try {
        const saved = await hermesPatch<ContentRef>(`/content/refs/${id}`, patch);
        setBoard((b) => ({ ...b, refs: b.refs.map((r) => (r.id === id ? saved : r)) }));
        return saved;
      } catch {
        await load();
        return null;
      }
    },
    [load],
  );

  const removeRef = useCallback(
    async (id: number) => {
      setBoard((b) => ({ ...b, refs: b.refs.filter((r) => r.id !== id) }));
      try {
        await hermesDelete<{ ok: boolean }>(`/content/refs/${id}`);
        return true;
      } catch {
        await load();
        return false;
      }
    },
    [load],
  );

  return {
    board,
    online,
    loaded,
    selected,
    selectedId,
    setSelectedId,
    recordingId,
    recordingBeat,
    setRecording,
    reload: load,
    patchPiece,
    createPiece,
    generateKit,
    generateVariants,
    mergePiece,
    linkLinear,
    browseClips,
    addClips,
    removeClip,
    startEditRun,
    stopEditRun,
    openEditOutput,
    pieceMedia,
    mediaVersion,
    bumpMedia,
    ensureMediaFolder,
    linkFolderClips,
    revealMediaFolder,
    saveVoiceover,
    removeVoiceover,
    promoteVoiceover,
    sealMaster,
    publishPiece,
    providers,
    patchSession,
    createSession,
    buildBatch,
    replanOverdue,
    pieceMetrics,
    syncMetrics,
    hookPerformance,
    saveRef,
    patchRef,
    removeRef,
  };
}
