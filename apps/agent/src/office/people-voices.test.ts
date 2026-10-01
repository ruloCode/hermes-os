import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assignVoices, baseVoiceName, spanishCatalog, voiceTimbre, type SystemVoice, type VoiceRequest } from "@hermes/shared";

/** Lo que Chrome expone en macOS (medido el 2026-10-01 con speechSynthesis.getVoices()). */
const CHROME_MAC: SystemVoice[] = [
  ...["Eddy", "Flo", "Grandma", "Grandpa", "Reed", "Rocko", "Sandy", "Shelley"].flatMap((n) => [
    { name: `${n} (Spanish (Spain))`, lang: "es-ES" },
    { name: `${n} (Spanish (Mexico))`, lang: "es-MX" },
  ]),
  { name: "Mónica", lang: "es-ES" },
  { name: "Paulina", lang: "es-MX" },
  { name: "Samantha", lang: "en-US" },
  { name: "Thomas", lang: "fr-FR" },
];

const ROLES: VoiceRequest[] = ["reception", "barista", "rooftop", "queue"].map((r) => ({ id: `npc:${r}`, role: r }));
const crowd = (n: number, from = 0): VoiceRequest[] => Array.from({ length: n }, (_, i) => ({ id: `amb-${from + i}`, low: i % 3 === 0 }));

describe("voces de la gente", () => {
  it("el catálogo deja solo español, sin repetidos y con los abuelos al final", () => {
    const c = spanishCatalog([...CHROME_MAC, CHROME_MAC[0]]);
    assert.equal(c.length, 18);
    assert.ok(c.every((v) => v.lang.startsWith("es")));
    assert.ok(c.slice(-4).every((v) => /Grand/.test(v.name)));
  });

  it("con las voces de macOS, 9 personas y 4 roles tienen 13 voces distintas (sin tocar el tono)", () => {
    const m = assignVoices([...ROLES, ...crowd(9)], CHROME_MAC);
    assert.equal(m.size, 13);
    const names = [...m.values()].map((v) => v.voice);
    assert.equal(new Set(names).size, 13, "ninguna voz repetida");
    assert.ok([...m.values()].every((v) => v.key.endsWith("#0")));
  });

  it("las voces de abuelos (caricaturescas) quedan para cuando no hay otras", () => {
    const m = assignVoices([...ROLES, ...crowd(9)], CHROME_MAC);
    assert.ok([...m.values()].every((v) => !/Grand/.test(v.voice)), "usó un abuelo habiendo voces libres");
    const many = assignVoices([...ROLES, ...crowd(16)], CHROME_MAC);
    // 20 personas y 18 voces: se usan las 18 (abuelos incluidos) antes de repetir alguna.
    assert.equal(new Set([...many.values()].map((v) => v.voice)).size, 18);
  });

  it("los roles tienen voz fija", () => {
    const m = assignVoices([...crowd(9), ...ROLES], CHROME_MAC);
    assert.equal(m.get("npc:reception")!.voice, "Paulina");
    assert.equal(m.get("npc:barista")!.voice, "Mónica");
    assert.equal(baseVoiceName(m.get("npc:rooftop")!.voice), "Reed");
    assert.equal(m.get("npc:rooftop")!.lang, "es-MX");
    assert.equal(baseVoiceName(m.get("npc:queue")!.voice), "Shelley");
  });

  it("es pegajosa: quien sigue en el edificio conserva su voz cuando otros entran y salen", () => {
    const a = assignVoices([...ROLES, ...crowd(8)], CHROME_MAC);
    const b = assignVoices([...ROLES, ...crowd(7, 1), { id: "amb-20" }, { id: "amb-21" }], CHROME_MAC, a);
    for (let i = 1; i < 8; i++) assert.deepEqual(b.get(`amb-${i}`), a.get(`amb-${i}`), `amb-${i} cambió de voz`);
    const keys = [...b.values()].map((v) => v.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("nunca hay dos perfiles iguales, aunque el sistema tenga solo dos voces", () => {
    const two = [CHROME_MAC[0], CHROME_MAC[17]];
    const m = assignVoices([...ROLES, ...crowd(9)], two);
    const keys = [...m.values()].map((v) => v.key);
    assert.equal(keys.length, 13);
    assert.equal(new Set(keys).size, 13);
    // Las repetidas se separan por tono de verdad (no un 2 %).
    const sameVoice = [...m.values()].filter((v) => v.voice === two[0].name).map((v) => v.pitch).sort((x, y) => x - y);
    for (let i = 1; i < sameVoice.length; i++) assert.ok(sameVoice[i] - sameVoice[i - 1] > 0.1, `tonos muy cercanos: ${sameVoice}`);
  });

  it("sin voces en español (headless) igual hay perfiles únicos", () => {
    const m = assignVoices([...ROLES, ...crowd(9)], []);
    const keys = [...m.values()].map((v) => v.key);
    assert.equal(new Set(keys).size, 13);
    assert.ok([...m.values()].every((v) => v.voice === ""));
  });

  it("una barba prefiere voz grave cuando hay", () => {
    const m = assignVoices([{ id: "barba-1", low: true }, { id: "barba-2", low: true }, { id: "barba-3", low: true }], CHROME_MAC);
    for (const v of m.values()) assert.notEqual(voiceTimbre(v.voice), "high", `${v.voice} es aguda`);
  });

  it("tono y velocidad quedan en rango de speechSynthesis", () => {
    const m = assignVoices([...ROLES, ...crowd(30)], CHROME_MAC.slice(0, 3));
    for (const v of m.values()) {
      assert.ok(v.pitch >= 0.5 && v.pitch <= 2, `pitch ${v.pitch}`);
      assert.ok(v.rate >= 0.5 && v.rate <= 2, `rate ${v.rate}`);
    }
  });

  it("es determinista", () => {
    assert.deepEqual([...assignVoices([...ROLES, ...crowd(9)], CHROME_MAC)], [...assignVoices([...ROLES, ...crowd(9)], CHROME_MAC)]);
  });
});
