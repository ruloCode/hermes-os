import { env } from "../env.js";
import { emit } from "../events.js";
import { nextRun } from "../scheduled/cron.js";
import { tvScene } from "./index.js";
import { alarmDue } from "./plan.js";
import { readScenes } from "./scenes.js";
import { readAlarm, writeAlarm, type AlarmState } from "./alarm.js";
import { wakeTriggerTimes } from "../wake/index.js";

export { nextAlarm, setNextAlarm } from "./alarm.js";

/**
 * El cuarto sigue tu reloj (idea 4, 2026-10-20): escenas con `cron` (cierre
 * del día, descanso) y con `before_alarm_min` (amanecer antes de tu hora de
 * despertar; 0 = a la hora: el despertar). La hora es el compromiso que dijiste
 * ("mañana me levanto a las 5:20") o, si no hay, la alarma del teléfono. Un
 * job de cada minuto mira qué tocaba DESDE la revisión anterior; lo que se perdió con el agente caído NO se recupera (prender luces a
 * destiempo es peor que no prenderlas).
 */

let lastCheck = new Date();

function fire(id: string, why: string): void {
  console.log(`[tv] escena ${id} (${why})`);
  void tvScene(id).then((r) => {
    if (r) emit({ kind: "tv", detail: `${r.name} (${why}) · ${r.steps.join(" · ")}` });
  });
}

/** Job de cada minuto. Devuelve los ids disparados (para el detalle del panel de jobs). */
export async function tickScenes(): Promise<string[]> {
  const now = new Date();
  const since = lastCheck;
  lastCheck = now;
  const { scenes } = await readScenes();
  const fired: string[] = [];
  let alarm: AlarmState | null = null;
  let times: string[] | null = null;
  for (const s of scenes) {
    if (s.cron) {
      const n = nextRun(s.cron, env.SCHEDULED_TZ, since);
      if (n && n <= now) {
        fire(s.id, "horario");
        fired.push(s.id);
      }
    }
    if (s.before_alarm_min != null) {
      alarm ??= await readAlarm();
      times ??= await wakeTriggerTimes(now);
      const at = times.find((t) => alarmDue(t, s.before_alarm_min!, now, alarm!.fired[s.id] ?? null));
      if (at) {
        alarm.fired[s.id] = at;
        await writeAlarm(alarm);
        fire(s.id, s.before_alarm_min ? `${s.before_alarm_min} min antes de tu hora` : "tu hora de despertar");
        fired.push(s.id);
      }
    }
  }
  return fired;
}
