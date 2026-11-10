import assert from "node:assert/strict";
import { test } from "node:test";
import { broadcastFor, findHostByMac, normalizeMac } from "./lights.js";

test("normalizeMac acepta cualquier separador y descarta lo que no es una MAC", () => {
  assert.equal(normalizeMac("20:23:51:5a:30:8e"), "20:23:51:5A:30:8E");
  assert.equal(normalizeMac("20-23-51-5A-30-8E"), "20:23:51:5A:30:8E");
  assert.equal(normalizeMac("2023515A308E"), "20:23:51:5A:30:8E");
  assert.equal(normalizeMac("20:23:51"), "");
  assert.equal(normalizeMac(""), "");
});

test("broadcastFor calcula el broadcast de la LAN y salta las /32", () => {
  assert.equal(broadcastFor("192.168.0.171", "255.255.255.0"), "192.168.0.255");
  assert.equal(broadcastFor("10.1.2.3", "255.255.0.0"), "10.1.255.255");
  assert.equal(broadcastFor("100.101.5.6", "255.255.255.255"), null);
  assert.equal(broadcastFor("no-es-ip", "255.255.255.0"), null);
});

test("findHostByMac elige la IP del equipo con esa MAC, no la de otro Kasa", () => {
  const discovered = {
    "192.168.0.50": { system: { get_sysinfo: { alias: "enchufe", mac: "AA:BB:CC:DD:EE:FF" } } },
    "192.168.0.89": { system: { get_sysinfo: { alias: "luz led", mic_mac: "20:23:51:5A:30:8E" } } },
  };
  assert.equal(findHostByMac(discovered, "2023515a308e"), "192.168.0.89");
  assert.equal(findHostByMac(discovered, "aa-bb-cc-dd-ee-ff"), "192.168.0.50");
  assert.equal(findHostByMac(discovered, "11:22:33:44:55:66"), null);
  assert.equal(findHostByMac({}, "20:23:51:5A:30:8E"), null);
  assert.equal(findHostByMac(discovered, ""), null);
});

