import { emit } from "../events.js";
import { tvAdbKey, tvAdbPlay, tvSnapshot } from "./adb.js";
import { adStep, newAdTracker, newVideoWatch, videoEndStep } from "./plan.js";

/**
 * Vigilante del video que puso Hermes: salta los anuncios en cuanto se puede
 * (un OK sobre "Saltar", solo con anuncio DETECTADO — sobre el video, OK lo
 * pausa) y sabe cuándo terminó el video, para que una escena siga con lo que
 * viene ("cuando acabe la meditación, música"). Uno a la vez: poner otro
 * video reemplaza al anterior. Lógica de decisión pura en plan.ts.
 */

export type VideoEnd = { verdict: "ended" | "abandoned"; reason: string };

interface Watch {
  gen: number;
  id: string;
  result: VideoEnd | null;
}

let gen = 0;
let current: Watch | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function watchYouTube(id: string, durationS: number | null, opts: { skipAds?: boolean } = {}): void {
  const w: Watch = { gen: ++gen, id, result: null };
  current = w;
  const skipAds = opts.skipAds !== false;
  const started = Date.now();
  // Tope duro: la duración + 15 min de anuncios y pausas; sin duración, 3 h.
  const hardStop = started + (durationS ? durationS * 1000 + 15 * 60_000 : 3 * 3600_000);
  void (async () => {
    let ads = newAdTracker();
    let vw = newVideoWatch();
    while (w.gen === gen && Date.now() < hardStop) {
      const snap = await tvSnapshot();
      const now = Date.now();
      if (skipAds) {
        const a = adStep(snap.yt, ads, now);
        if (a.newAd) console.log(`[tv] anuncio #${a.tracker.ads} en ${id}`);
        if (a.action === "skip") {
          const ok = await tvAdbKey("ok");
          console.log(`[tv] anuncio #${a.tracker.ads}: OK para saltar a los ${snap.yt?.position_s ?? "?"} s (intento ${a.tracker.presses})${ok ? "" : " — adb no respondió"}`);
          emit({ kind: "tv", detail: `tv · salté un anuncio (${snap.yt?.position_s ?? "?"} s)` });
        } else if (a.action === "resume") {
          await tvAdbPlay();
          console.log(`[tv] el OK cayó sobre el video y lo pausó: play`);
        }
        ads = a.tracker;
      }
      const v = videoEndStep(snap, vw, durationS, now - started, now);
      vw = v.watch;
      if (v.verdict !== "waiting") {
        w.result = { verdict: v.verdict, reason: v.reason ?? "" };
        console.log(`[tv] video ${id}: ${v.verdict} — ${v.reason ?? ""} (iba en ${vw.lastPos} s)`);
        break;
      }
      // Con anuncio en pantalla se mira seguido (saltar ≤2 s después de que se pueda).
      const isAd = snap.yt?.state === "playing" && !snap.yt.seekable;
      await sleep(isAd ? 1000 : 2500);
    }
    if (!w.result && w.gen === gen) w.result = { verdict: "ended", reason: "se acabó el tiempo de vigilancia" };
  })();
}

/**
 * Espera el final del video vigilado. `stillCurrent` = la escena sigue vigente
 * (si arrancó otra, se deja de esperar). Sin video vigilado no hay nada que
 * esperar. `timeout` = pasó max_ms sin terminar (la escena sigue).
 */
export async function waitVideoEnd(maxMs: number, stillCurrent: () => boolean): Promise<VideoEnd | { verdict: "timeout"; reason: string }> {
  const w = current;
  if (!w) return { verdict: "ended", reason: "no había un video de Hermes sonando" };
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (w.result) return w.result;
    if (w !== current) return { verdict: "abandoned", reason: "pusieron otro video" };
    if (!stillCurrent()) return { verdict: "abandoned", reason: "arrancó otra escena" };
    await sleep(1000);
  }
  return { verdict: "timeout", reason: `pasaron ${Math.round(maxMs / 60_000)} min y no terminó` };
}
