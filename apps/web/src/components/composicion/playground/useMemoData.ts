"use client";

/**
 * Datos de UN memo: su análisis (melodía, frases, molde, tonalidad) y su
 * tablero de letras (versiones, "Tu versión", filas bloqueadas). Los cambios
 * del tablero se guardan con un PUT diferido y acumulado — escribir "Tu
 * versión" no manda una petición por tecla — y generar vacía lo pendiente
 * antes: la generación lleva las filas bloqueadas como contexto y tienen que
 * ser las que ves.
 *
 * Nada se escribe antes de que el tablero LLEGUE (`boardLoaded`): el PUT
 * reemplaza `mine` entero, así que escribir sobre el vacío inicial pisaba las
 * líneas que el agente ya tenía. Si la lectura falla, el editor sigue cerrado
 * con el motivo y "Reintentar" (`reloadBoard`).
 *
 * Firma de frases (`phrasesSig`): cada PUT lleva la del último tablero leído.
 * Si un re-análisis movió las frases mientras tanto, el agente guarda esas
 * líneas como `stale` (nunca las engancha a la frase equivocada) y la
 * respuesta del PUT se adopta para que se vea. Un re-análisis (cambia
 * `analyzedAt`) vacía lo pendiente y relee el tablero ya reconciliado. Los PUT
 * van de a uno (dos en vuelo podían responder en desorden).
 *
 * El POST de generar ya no guarda brief/persona/rima/candados/melismas: van
 * por PUT, y `generate` vacía lo pendiente ANTES de pedir.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricBoard, LyricRequest, Passage, PassageAnalysis, PhraseMold } from "@hermes/shared";
import { usePlaygroundApi, type LyricBoardPatch } from "./api";

const emptyBoard = (sessionId: string, passageId: string): LyricBoard => ({
  sessionId,
  passageId,
  versions: [],
  mine: [],
  locked: [],
  melismaMode: "respetar",
  updatedAt: new Date().toISOString(),
});

export function useMemoData(sessionId: string, passage: Passage) {
  const api = usePlaygroundApi();
  const [analysis, setAnalysis] = useState<PassageAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState(true);
  const [board, setBoardState] = useState<LyricBoard>(() => emptyBoard(sessionId, passage.id));
  /** El tablero del agente ya llegó (o confirmó que no hay): recién ahí se puede escribir. */
  const [boardLoaded, setBoardLoaded] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [boardTick, setBoardTick] = useState(0);
  const boardLoadedRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const pendingPatch = useRef<LyricBoardPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Firma de frases del último tablero leído del agente (viaja en cada PUT). */
  const sigRef = useRef<string | undefined>(undefined);
  /** El PUT en vuelo (van de a uno). */
  const putting = useRef<Promise<void> | null>(null);
  /** El pasaje de AHORA: una respuesta de otro (el flush al cambiar de pasaje) no se adopta. */
  const keyRef = useRef(`${sessionId}/${passage.id}`);
  keyRef.current = `${sessionId}/${passage.id}`;

  const loadAnalysis = useCallback(async () => {
    try {
      const a = await api.analysis(sessionId, passage.id);
      setAnalysis(a);
      setAnalysisError(null);
    } catch (e) {
      setAnalysisError((e as Error).message);
    } finally {
      setLoadingAnalysis(false);
    }
  }, [api, sessionId, passage.id]);

  // Se relee cuando el pasaje cambia de estado (el poll de la sesión lo trae).
  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis, passage.status]);

  useEffect(() => {
    let cancelled = false;
    setBoardState(emptyBoard(sessionId, passage.id));
    setBoardLoaded(false);
    boardLoadedRef.current = false;
    setBoardError(null);
    api
      .lyrics(sessionId, passage.id)
      .then((b) => {
        if (cancelled) return;
        // null = el agente todavía no tiene tablero de este pasaje: el vacío ES el de verdad.
        if (b) setBoardState(b);
        sigRef.current = b?.phrasesSig;
        boardLoadedRef.current = true;
        setBoardLoaded(true);
      })
      .catch((e: Error) => {
        if (!cancelled) setBoardError(e.message || "no se pudo leer el tablero de letras");
      });
    return () => {
      cancelled = true;
    };
  }, [api, sessionId, passage.id, boardTick]);

  const reloadBoard = useCallback(() => setBoardTick((t) => t + 1), []);

  const flushBoard = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // De a uno: el siguiente sale cuando vuelva el que está en vuelo.
    while (putting.current) await putting.current.catch(() => undefined);
    const patch = pendingPatch.current;
    if (!Object.keys(patch).length) return;
    pendingPatch.current = {};
    const key = `${sessionId}/${passage.id}`;
    const run = (async () => {
      try {
        const sig = sigRef.current;
        const b = await api.putLyrics(sessionId, passage.id, sig ? { ...patch, phrasesSig: sig } : patch);
        if (b && keyRef.current === key) {
          if (b.phrasesSig) sigRef.current = b.phrasesSig;
          // Lo escrito MIENTRAS viajaba manda; lo demás (líneas que el agente marcó `stale`, versiones) es el suyo.
          setBoardState({ ...b, ...pendingPatch.current });
        }
        setSaveError(null);
      } catch (e) {
        // Lo no guardado vuelve a la cola (sin pisar lo que se escribió después).
        pendingPatch.current = { ...patch, ...pendingPatch.current };
        setSaveError((e as Error).message);
      }
    })();
    putting.current = run;
    await run;
    if (putting.current === run) putting.current = null;
  }, [api, sessionId, passage.id]);

  // Re-análisis del pasaje (cambia `analyzedAt`): las frases pueden haberse movido. Se manda lo
  // pendiente y se relee el tablero, que el agente devuelve reconciliado (`stale`, sin candados).
  const analyzedAt = analysis?.analyzedAt;
  const seenAnalysis = useRef<string | undefined>(undefined);
  useEffect(() => {
    const prev = seenAnalysis.current;
    seenAnalysis.current = analyzedAt;
    if (!prev || !analyzedAt || prev === analyzedAt || !boardLoadedRef.current) return;
    let cancelled = false;
    void (async () => {
      await flushBoard();
      const b = await api.lyrics(sessionId, passage.id).catch(() => null);
      if (cancelled || !b) return;
      sigRef.current = b.phrasesSig;
      setBoardState({ ...b, ...pendingPatch.current });
    })();
    return () => {
      cancelled = true;
    };
    // Solo al cambiar el análisis (el pasaje nuevo relee por su cuenta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyzedAt]);

  useEffect(
    () => () => {
      void flushBoard();
    },
    [flushBoard],
  );

  /** Cambio local inmediato + PUT diferido de lo acumulado. Antes de cargar el tablero, nada. */
  const patchBoard = useCallback(
    (patch: LyricBoardPatch, delay = 600) => {
      if (!boardLoadedRef.current) return;
      setBoardState((b) => ({ ...b, ...patch }));
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flushBoard(), delay);
    },
    [flushBoard],
  );

  const patchMold = useCallback(
    async (phrase: number, override: Partial<Pick<PhraseMold, "syllables" | "ending" | "rhyme">>) => {
      // Optimista: la tabla cambia al instante; el agente devuelve el análisis vigente.
      setAnalysis((a) =>
        a
          ? {
              ...a,
              phrases: a.phrases.map((p) =>
                p.idx === phrase ? { ...p, override: Object.keys(override).length ? { ...p.override, ...override } : undefined } : p,
              ),
            }
          : a,
      );
      try {
        setAnalysis(await api.patchMold(sessionId, passage.id, { phrase, override }));
      } catch (e) {
        setAnalysisError((e as Error).message);
        void loadAnalysis();
      }
    },
    [api, sessionId, passage.id, loadAnalysis],
  );

  // ── Generar (síncrono en el agente: 30-90 s, Detener aborta de verdad) ──
  const [generating, setGenerating] = useState<{ startedAt: number; count: number } | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const generate = useCallback(
    async (req: LyricRequest) => {
      if (abort.current) return;
      await flushBoard();
      const ctl = new AbortController();
      abort.current = ctl;
      setGenError(null);
      setGenerating({ startedAt: Date.now(), count: req.count });
      try {
        const b = await api.generate(sessionId, passage.id, req, ctl.signal);
        // Lo escrito DURANTE la generación manda sobre lo que devolvió el agente.
        setBoardState({ ...b, ...pendingPatch.current });
        if (b.phrasesSig) sigRef.current = b.phrasesSig;
        // Lo que devolvió el agente ES su tablero: ya se puede editar encima.
        boardLoadedRef.current = true;
        setBoardLoaded(true);
        setBoardError(null);
      } catch (e) {
        if ((e as Error).name === "AbortError") setGenError("Detenido: no se generó nada.");
        else setGenError((e as Error).message);
      } finally {
        abort.current = null;
        setGenerating(null);
      }
    },
    [api, flushBoard, passage.id, sessionId],
  );

  const stopGenerating = useCallback(() => abort.current?.abort(), []);

  return {
    analysis,
    analysisError,
    loadingAnalysis,
    reloadAnalysis: loadAnalysis,
    board,
    boardLoaded,
    boardError,
    reloadBoard,
    patchBoard,
    saveError,
    patchMold,
    generate,
    generating,
    genError,
    stopGenerating,
  };
}

export type MemoData = ReturnType<typeof useMemoData>;
