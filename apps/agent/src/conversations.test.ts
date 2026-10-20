import assert from "node:assert/strict";
import test from "node:test";
import { splitBySession, type StoredMessage } from "./conversations.js";

const m = (sessionId: string | undefined, role: "user" | "assistant", content: string, ts: string): StoredMessage => ({
  role,
  content,
  ts,
  sessionId,
});

test("la conversación en curso se separa por hilo (sesión) y deja fuera QA y mensajes sin sesión", () => {
  const msgs = [
    m("web-1", "user", "plan de la semana", "2026-10-14T05:00:00Z"),
    m("web-1", "assistant", "va", "2026-10-14T05:00:01Z"),
    m("phone-a", "user", "abre whatsapp", "2026-10-14T06:00:00Z"),
    m("qa-candado-1", "user", "prueba", "2026-10-14T07:00:00Z"),
    m(undefined, "user", "viejo sin sesión", "2026-10-01T07:00:00Z"),
    // El mismo hilo de la web retomado más tarde sigue siendo UN hilo.
    m("web-1", "user", "¿y el jueves?", "2026-10-15T05:00:00Z"),
  ];
  const by = splitBySession(msgs);
  assert.deepEqual([...by.keys()], ["web-1", "phone-a"]);
  assert.equal(by.get("web-1")?.length, 3);
});
