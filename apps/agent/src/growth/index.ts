import { env } from "../env.js";
import { emit } from "../events.js";
import { getUpcomingCalendar } from "../calendar.js";
import { listGoals } from "../habits/goals.js";
import { checkinHabit, habitDoneDates, habitDoneOn } from "../habits/store.js";
import { listLiveMeetings } from "../meetings/live.js";
import { phoneLink } from "../phone/link.js";
import { saveActa, writeActa } from "./acta.js";
import { createCompanion } from "./companion.js";
import { fileGrowthStore } from "./store.js";

/** El compañero real: disco en ~/.hermes-os/growth, metas en Supabase, avisos por el WS del teléfono. */
export const companion = createCompanion({
  store: fileGrowthStore(),
  now: () => new Date(),
  tz: env.SCHEDULED_TZ,
  listGoals: async () =>
    (await listGoals()).map((g) => ({
      id: g.id,
      title: g.title,
      status: g.status,
      due_date: g.due_date ?? null,
      created_at: g.created_at ?? null,
      target_value: g.target_value ?? null,
      current_value: g.current_value,
      unit: g.unit ?? null,
    })),
  habitDoneOn,
  habitDates: habitDoneDates,
  // Un día hacia atrás y uno adelante: planOccurrence se queda con los de HOY.
  eventsToday: async () => {
    const cal = await getUpcomingCalendar(1, 50, 1);
    return cal.configured ? cal.events.map((e) => ({ title: e.title, start: e.start, end: e.end, allDay: e.allDay })) : [];
  },
  // Solo una junta que de verdad corre: las terminadas se retienen un rato en memoria.
  liveMeeting: () => listLiveMeetings().some((m) => m.status === "connecting" || m.status === "live"),
  notify: (input) => phoneLink.notify(input),
  sendCallSchedule: (next) => phoneLink.sendCallSchedule(next),
  checkinHabit: async (habitId, date, note) => !!(await checkinHabit(habitId, { date, note, source: "phone" })),
  writeActa,
  saveActa,
  onEvent: (detail) => emit({ kind: "phone", detail }),
});

/** Conecta el compañero al enlace del teléfono (una vez, al arrancar). */
export function wireCompanion(): void {
  phoneLink.onFrame((f) => {
    void companion.handleFrame(f).catch((err) => console.error("[growth] respuesta:", err instanceof Error ? err.message : err));
  });
  // Cada teléfono que se conecta recibe la próxima llamada semanal.
  phoneLink.onHello(() => {
    void companion.pushSchedule().catch(() => false);
  });
}
