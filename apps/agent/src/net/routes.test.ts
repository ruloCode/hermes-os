import assert from "node:assert/strict";
import test from "node:test";
import type { NetworkInterfaceInfo } from "node:os";
import { currentRoutes, detectTailnetIp, isTailnetIp } from "./routes.js";

const v4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: "255.255.255.0",
  family: "IPv4",
  mac: "00:00:00:00:00:00",
  internal,
  cidr: `${address}/24`,
});

test("el rango de Tailscale es 100.64.0.0/10 y nada más", () => {
  assert.equal(isTailnetIp("100.64.0.1"), true);
  assert.equal(isTailnetIp("100.101.7.42"), true);
  assert.equal(isTailnetIp("100.127.255.254"), true);
  assert.equal(isTailnetIp("100.63.0.1"), false); // justo antes del rango
  assert.equal(isTailnetIp("100.128.0.1"), false); // justo después
  assert.equal(isTailnetIp("192.168.0.170"), false);
});

test("la IP de Tailscale se encuentra por rango, no por el nombre de la interfaz (utun cambia)", () => {
  const ifaces = {
    lo0: [v4("127.0.0.1", true)],
    en0: [v4("192.168.0.170")],
    utun7: [v4("100.88.12.3")],
  };
  assert.equal(detectTailnetIp(ifaces), "100.88.12.3");
  assert.equal(detectTailnetIp({ en0: [v4("192.168.0.170")] }), null);
});

test("las rutas usan la IP LAN de AHORA y prefieren el nombre MagicDNS sobre la IP 100.x", () => {
  const base = { lanIp: "192.168.0.170", tailnetIp: "100.88.12.3", port: 8650, machine: "mac-mini" };
  assert.deepEqual(currentRoutes({ ...base, tailnetUrl: "" }), {
    machine: "mac-mini",
    lan: "http://192.168.0.170:8650",
    tailnet: "http://100.88.12.3:8650",
  });
  assert.equal(
    currentRoutes({ ...base, tailnetUrl: "https://mac-mini.tail1234.ts.net/" }).tailnet,
    "https://mac-mini.tail1234.ts.net",
  );
  // Sin Tailscale ni LAN no se inventa nada.
  assert.deepEqual(currentRoutes({ lanIp: null, tailnetIp: null, tailnetUrl: "", port: 8650, machine: "x" }), {
    machine: "x",
    lan: null,
    tailnet: null,
  });
});
