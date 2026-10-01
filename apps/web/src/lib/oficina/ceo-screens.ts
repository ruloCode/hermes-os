// Pantallas de la oficina de CEO (además del monitor grande de uso de Claude):
//   · Bandeja: quién te necesita AHORA (permisos abiertos, con su comando o
//     plan), cuántos trabajan y la cola de agentes. Datos de /office/events y
//     GET /office/queue — los mismos de la Recepción y del tablero de la cola.
//   · Reloj y agenda: la hora local y los próximos eventos del calendario real
//     (snapshot.calendar de GET /dashboard). Sin calendario configurado lo dice.

import * as THREE from "three";
import { queueCounts, type OfficeWorker, type QueueState, type UpcomingCalendar } from "@hermes/shared";
import { mesh, toon } from "./toon";
import { clip } from "./terminal";
import type { BoardSpot } from "./room";

const PX = 900;

abstract class CanvasScreen {
  readonly group = new THREE.Group();
  readonly surface: THREE.Mesh;
  protected readonly canvas = document.createElement("canvas");
  protected readonly ctx: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private key = "-";

  constructor(
    readonly spot: BoardSpot,
    protected readonly font: string,
  ) {
    this.canvas.width = Math.round(spot.w * PX);
    this.canvas.height = Math.round(spot.h * PX);
    this.ctx = this.canvas.getContext("2d")!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 8;
    this.group.add(mesh(new THREE.BoxGeometry(spot.w + 0.05, spot.h + 0.05, 0.04), toon("#1f2024"), 0, 0, -0.022, false));
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(spot.w, spot.h), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }));
    this.surface.position.z = 0.001;
    (this.surface.material as THREE.Material).userData.outlineParameters = { visible: false };
    this.group.add(this.surface);
    this.group.position.set(spot.x, spot.y, spot.z);
    this.group.rotation.y = spot.rotY;
  }

  /** Repinta solo si cambió lo que se ve. */
  protected repaint(key: string, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void) {
    if (key === this.key) return;
    this.key = key;
    const g = this.ctx;
    g.fillStyle = "#15161f";
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.textBaseline = "middle";
    g.textAlign = "left";
    paint(g, this.canvas.width, this.canvas.height);
    this.tex.needsUpdate = true;
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    (this.surface.material as THREE.Material).dispose();
    this.tex.dispose();
    this.group.removeFromParent();
  }
}

/** Quién te necesita y la cola (monitor chico del escritorio). */
export class CeoInbox extends CanvasScreen {
  lines: string[] = [];

  setData(workers: OfficeWorker[], nicks: ReadonlyMap<string, string>, queue: QueueState | null | undefined) {
    const asking = workers.filter((w) => w.status === "needs_you" && w.approval);
    const working = workers.filter((w) => w.status === "working" || w.status === "thinking" || w.status === "starting").length;
    const q = queue ? queueCounts(queue.items) : null;
    const rows = asking.map((w) => `✋ ${nicks.get(w.id) ?? w.name}: ${w.approval!.summary}`);
    this.lines = rows;
    const key = JSON.stringify([rows, working, q, queue === undefined ? "loading" : queue === null ? "off" : queue.items.filter((i) => i.status === "queued").map((i) => i.title)]);
    this.repaint(key, (g, w, h) => {
      const f = this.font;
      g.fillStyle = "#f4f1ea";
      g.font = `800 44px ${f}`;
      g.fillText("Te necesitan", 30, 46);
      g.fillStyle = asking.length ? "#d97757" : "#6ccb8f";
      g.font = `800 44px ${f}`;
      g.textAlign = "right";
      g.fillText(String(asking.length), w - 30, 46);
      g.textAlign = "left";
      g.font = `500 26px ${f}`;
      if (!asking.length) {
        g.fillStyle = "#9aa3b2";
        g.fillText("Nadie espera tu permiso.", 30, 104);
      }
      rows.slice(0, 3).forEach((r, i) => {
        g.fillStyle = "#f4f1ea";
        g.fillText(clip(g, r, w - 60), 30, 104 + i * 40);
      });
      const y = 104 + Math.max(1, Math.min(3, rows.length)) * 40 + 20;
      g.strokeStyle = "rgba(255,255,255,0.1)";
      g.beginPath();
      g.moveTo(30, y);
      g.lineTo(w - 30, y);
      g.stroke();
      g.fillStyle = "#cdd6f4";
      g.font = `600 28px ${f}`;
      g.fillText(`${working} trabajando · cola: ${q ? `${q.running} en curso, ${q.queued} esperando` : queue === null ? "sin respuesta" : "…"}`, 30, y + 40);
      const next = queue?.items.filter((i) => i.status === "queued").slice(0, 2) ?? [];
      g.fillStyle = "#9aa3b2";
      g.font = `500 24px ${f}`;
      next.forEach((it, i) => g.fillText(clip(g, `… ${it.title}`, w - 60), 30, y + 82 + i * 34));
    });
  }
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Reloj grande y la agenda real (muro este, junto al ventanal). */
export class CeoAgenda extends CanvasScreen {
  setData(cal: UpcomingCalendar | null, now: Date) {
    const events = cal?.configured ? cal.events.filter((e) => e.startsInMin > -60).slice(0, 4) : [];
    const key = JSON.stringify([hhmm(now), now.toDateString(), cal ? { c: cal.configured, s: cal.stale, e: events.map((e) => [e.title, e.start, e.allDay]) } : null]);
    this.repaint(key, (g, w) => {
      const f = this.font;
      g.fillStyle = "#f4f1ea";
      g.font = `800 120px ${f}`;
      g.fillText(hhmm(now), 34, 92);
      g.fillStyle = "#9aa3b2";
      g.font = `500 30px ${f}`;
      g.fillText(now.toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long" }), 36, 176);
      g.font = `500 28px ${f}`;
      if (!cal) {
        g.fillText("Agenda: sin datos del dashboard.", 36, 250);
        return;
      }
      if (!cal.configured) {
        g.fillText("Agenda: calendario sin configurar.", 36, 250);
        return;
      }
      if (!events.length) {
        g.fillText(cal.stale ? "Agenda: sin conexión con el calendario." : "Sin eventos próximos.", 36, 250);
        return;
      }
      events.forEach((e, i) => {
        const y = 250 + i * 46;
        const d = new Date(e.start);
        const today = d.toDateString() === now.toDateString();
        g.fillStyle = e.startsInMin < 0 ? "#6ccb8f" : "#e7b04e";
        g.font = `600 26px ${f}`;
        g.fillText(e.allDay ? "todo el día" : today ? hhmm(d) : d.toLocaleDateString("es-CO", { weekday: "short", hour: "numeric", minute: "2-digit" }), 36, y);
        g.fillStyle = "#f4f1ea";
        g.font = `500 26px ${f}`;
        g.fillText(clip(g, e.title, w - 280), 250, y);
      });
    });
  }
}

/** Pantalla de la sala de juntas (café): la próxima junta del calendario real. */
export class MeetingScreen extends CanvasScreen {
  /** Lo que dice (QA). */
  text = "";

  setData(cal: UpcomingCalendar | null, now: Date) {
    const next = cal?.configured ? (cal.events.find((e) => !e.allDay && e.startsInMin > -60) ?? null) : null;
    const when = next
      ? next.startsInMin < 0
        ? `empezó hace ${-next.startsInMin} min`
        : next.startsInMin < 60
          ? `en ${next.startsInMin} min`
          : new Date(next.start).toDateString() === now.toDateString()
            ? `hoy a las ${hhmm(new Date(next.start))}`
            : new Date(next.start).toLocaleDateString("es-CO", { weekday: "long", hour: "numeric", minute: "2-digit" })
      : "";
    this.text = !cal ? "Sin datos del dashboard." : !cal.configured ? "Calendario sin configurar." : next ? `${next.title} · ${when}` : cal.stale ? "Sin conexión con el calendario." : "Sin juntas próximas.";
    this.repaint(JSON.stringify([this.text, next?.location ?? null]), (g, w, h) => {
      const f = this.font;
      g.fillStyle = "#9aa3b2";
      g.font = `600 40px ${f}`;
      g.fillText("Sala de juntas · próxima", 46, 64);
      g.fillStyle = "#f4f1ea";
      g.font = `800 64px ${f}`;
      if (!next) {
        g.fillStyle = "#cdd6f4";
        g.font = `600 48px ${f}`;
        g.fillText(this.text, 46, h / 2 + 20);
        return;
      }
      g.fillText(clip(g, next.title, w - 92), 46, 200);
      g.fillStyle = next.startsInMin < 0 ? "#6ccb8f" : "#e7b04e";
      g.font = `600 46px ${f}`;
      g.fillText(when, 46, 300);
      if (next.location) {
        g.fillStyle = "#9aa3b2";
        g.font = `500 36px ${f}`;
        g.fillText(clip(g, next.location, w - 92), 46, 380);
      }
    });
  }
}
