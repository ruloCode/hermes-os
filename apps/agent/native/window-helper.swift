// Helper nativo del control por gestos: lo que robotjs no puede.
//  - displays : geometría real de TODOS los monitores (CGDisplayBounds)
//  - windowAt : qué ventana hay bajo un punto global (CGWindowList)
//  - moveWindow / setFrame : teletransporte y acomodo (snap) vía Accessibility API
//  - focus    : traer una app/ventana al frente
//
// Protocolo: NDJSON por stdin/stdout, proceso persistente hijo del agente
// (hereda el permiso de Accessibility del node del LaunchAgent — mismo
// "responsible process", no aparece aparte en TCC).
//
// Compilar: apps/agent/scripts/build-window-helper.sh (lo hace windows.ts
// solo la primera vez). Nota: kCGWindowName exige permiso de Screen
// Recording — sin él seguimos operando con app+bounds (title llega vacío).

import Foundation
import CoreGraphics
import AppKit
import ApplicationServices

func jsonLine(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let s = String(data: data, encoding: .utf8) else { return }
    print(s)
    fflush(stdout)
}

func fail(_ id: Any, _ msg: String) {
    jsonLine(["id": id, "ok": false, "error": msg])
}

// ── displays ────────────────────────────────────────────────────────────
// Además del rect completo va el área VISIBLE (sin menubar ni Dock) para
// acomodar ventanas (snap/maximizar). NSScreen la da en coordenadas Cocoa
// (origen abajo-izquierda de la pantalla principal): se convierte al sistema
// CG (origen arriba-izquierda) restando contra el alto de la principal.
func listDisplays() -> [[String: Any]] {
    var count: UInt32 = 0
    var ids = [CGDirectDisplayID](repeating: 0, count: 16)
    CGGetActiveDisplayList(16, &ids, &count)
    let main = CGMainDisplayID()
    let primaryH = NSScreen.screens.first?.frame.height ?? CGDisplayBounds(main).height
    let key = NSDeviceDescriptionKey("NSScreenNumber")
    return (0..<Int(count)).map { i in
        let b = CGDisplayBounds(ids[i])
        var out: [String: Any] = [
            "id": Int(ids[i]),
            "x": Int(b.origin.x), "y": Int(b.origin.y),
            "w": Int(b.size.width), "h": Int(b.size.height),
            "main": ids[i] == main,
        ]
        if let screen = NSScreen.screens.first(where: {
            ($0.deviceDescription[key] as? NSNumber)?.uint32Value == ids[i]
        }) {
            let vf = screen.visibleFrame
            out["vx"] = Int(vf.origin.x)
            out["vy"] = Int(primaryH - (vf.origin.y + vf.size.height))
            out["vw"] = Int(vf.size.width)
            out["vh"] = Int(vf.size.height)
        }
        return out
    }
}

// ── windowAt ────────────────────────────────────────────────────────────
// CGWindowList viene ordenada del frente hacia atrás; la primera ventana de
// capa 0 (apps normales — se saltan menubar/dock/overlays) que contiene el
// punto es la que el usuario "ve" bajo el cursor.
func windowAt(x: Double, y: Double) -> [String: Any]? {
    guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements],
                                                kCGNullWindowID) as? [[String: Any]] else { return nil }
    for w in list {
        guard let layer = w[kCGWindowLayer as String] as? Int, layer == 0,
              let b = w[kCGWindowBounds as String] as? [String: Double],
              let bx = b["X"], let by = b["Y"], let bw = b["Width"], let bh = b["Height"],
              x >= bx, x < bx + bw, y >= by, y < by + bh,
              let pid = w[kCGWindowOwnerPID as String] as? Int else { continue }
        return [
            "pid": pid,
            "app": w[kCGWindowOwnerName as String] as? String ?? "",
            "title": w[kCGWindowName as String] as? String ?? "",
            "x": Int(bx), "y": Int(by), "w": Int(bw), "h": Int(bh),
        ]
    }
    return nil
}

// ── AX: localizar la ventana de un pid más cercana a una posición ───────
func axWindow(pid: pid_t, nearX: Double, nearY: Double) -> AXUIElement? {
    let app = AXUIElementCreateApplication(pid)
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success,
          let windows = value as? [AXUIElement], !windows.isEmpty else { return nil }
    var best: (AXUIElement, Double)? = nil
    for win in windows {
        var posRef: CFTypeRef?
        guard AXUIElementCopyAttributeValue(win, kAXPositionAttribute as CFString, &posRef) == .success else { continue }
        var p = CGPoint.zero
        AXValueGetValue(posRef as! AXValue, .cgPoint, &p)
        let d = abs(p.x - nearX) + abs(p.y - nearY)
        if best == nil || d < best!.1 { best = (win, d) }
    }
    return best?.0
}

func moveWindow(pid: pid_t, fromX: Double, fromY: Double, toX: Double, toY: Double) -> Bool {
    guard let win = axWindow(pid: pid, nearX: fromX, nearY: fromY) else { return false }
    var point = CGPoint(x: toX, y: toY)
    guard let axPoint = AXValueCreate(.cgPoint, &point) else { return false }
    return AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, axPoint) == .success
}

// Posición + tamaño en una (snap/maximizar/centrar). El tamaño va antes y
// después de la posición: algunas apps recortan el tamaño si la posición
// nueva no cabe con el tamaño viejo, y otras al revés.
func setFrame(pid: pid_t, fromX: Double, fromY: Double, x: Double, y: Double, w: Double, h: Double) -> Bool {
    guard let win = axWindow(pid: pid, nearX: fromX, nearY: fromY) else { return false }
    var point = CGPoint(x: x, y: y)
    var size = CGSize(width: w, height: h)
    guard let axPoint = AXValueCreate(.cgPoint, &point),
          let axSize = AXValueCreate(.cgSize, &size) else { return false }
    _ = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, axSize)
    let okPos = AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, axPoint) == .success
    let okSize = AXUIElementSetAttributeValue(win, kAXSizeAttribute as CFString, axSize) == .success
    return okPos && okSize
}

// ── Agarre: la ventana se resuelve UNA vez (AX enumera todas las ventanas
// del proceso) y luego cada `drag` solo escribe la posición — a 15-30 Hz
// re-enumerar por frame se nota.
var grabbed: [Int: AXUIElement] = [:]
var nextGrabId = 1

func grabWindow(pid: pid_t, nearX: Double, nearY: Double) -> Int? {
    guard let win = axWindow(pid: pid, nearX: nearX, nearY: nearY) else { return nil }
    let id = nextGrabId
    nextGrabId += 1
    grabbed[id] = win
    return id
}

func dragWindow(id: Int, x: Double, y: Double) -> Bool {
    guard let win = grabbed[id] else { return false }
    var point = CGPoint(x: x, y: y)
    guard let axPoint = AXValueCreate(.cgPoint, &point) else { return false }
    return AXUIElementSetAttributeValue(win, kAXPositionAttribute as CFString, axPoint) == .success
}

func focusWindow(pid: pid_t, nearX: Double, nearY: Double) -> Bool {
    guard let app = NSRunningApplication(processIdentifier: pid) else { return false }
    app.activate()
    if let win = axWindow(pid: pid, nearX: nearX, nearY: nearY) {
        AXUIElementPerformAction(win, kAXRaiseAction as CFString)
    }
    return true
}

// ── Loop principal ──────────────────────────────────────────────────────
while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8),
          let req = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          let cmd = req["cmd"] as? String else { continue }
    let id = req["id"] ?? 0

    switch cmd {
    case "displays":
        jsonLine(["id": id, "ok": true, "data": listDisplays()])
    case "windowAt":
        guard let x = req["x"] as? Double, let y = req["y"] as? Double else {
            fail(id, "x/y requeridos"); continue
        }
        if let w = windowAt(x: x, y: y) {
            jsonLine(["id": id, "ok": true, "data": w])
        } else {
            jsonLine(["id": id, "ok": true, "data": NSNull()])
        }
    case "moveWindow":
        guard let pid = req["pid"] as? Int,
              let fx = req["fromX"] as? Double, let fy = req["fromY"] as? Double,
              let tx = req["toX"] as? Double, let ty = req["toY"] as? Double else {
            fail(id, "pid/fromX/fromY/toX/toY requeridos"); continue
        }
        let ok = moveWindow(pid: pid_t(pid), fromX: fx, fromY: fy, toX: tx, toY: ty)
        jsonLine(["id": id, "ok": ok, "error": ok ? NSNull() : "AX no pudo mover (¿permiso Accessibility?)"])
    case "setFrame":
        guard let pid = req["pid"] as? Int,
              let fx = req["fromX"] as? Double, let fy = req["fromY"] as? Double,
              let x = req["x"] as? Double, let y = req["y"] as? Double,
              let w = req["w"] as? Double, let h = req["h"] as? Double else {
            fail(id, "pid/fromX/fromY/x/y/w/h requeridos"); continue
        }
        let ok = setFrame(pid: pid_t(pid), fromX: fx, fromY: fy, x: x, y: y, w: w, h: h)
        jsonLine(["id": id, "ok": ok, "error": ok ? NSNull() : "AX no pudo acomodar la ventana (¿permiso Accessibility?)"])
    case "grab":
        guard let pid = req["pid"] as? Int,
              let x = req["x"] as? Double, let y = req["y"] as? Double else {
            fail(id, "pid/x/y requeridos"); continue
        }
        if let g = grabWindow(pid: pid_t(pid), nearX: x, nearY: y) {
            jsonLine(["id": id, "ok": true, "data": g])
        } else {
            fail(id, "AX no encontró la ventana (¿permiso Accessibility?)")
        }
    case "drag":
        guard let g = req["grab"] as? Int,
              let x = req["x"] as? Double, let y = req["y"] as? Double else {
            fail(id, "grab/x/y requeridos"); continue
        }
        jsonLine(["id": id, "ok": dragWindow(id: g, x: x, y: y)])
    case "release":
        if let g = req["grab"] as? Int { grabbed.removeValue(forKey: g) }
        jsonLine(["id": id, "ok": true])
    case "focus":
        guard let pid = req["pid"] as? Int else { fail(id, "pid requerido"); continue }
        let x = req["x"] as? Double ?? 0
        let y = req["y"] as? Double ?? 0
        jsonLine(["id": id, "ok": focusWindow(pid: pid_t(pid), nearX: x, nearY: y)])
    case "ping":
        jsonLine(["id": id, "ok": true, "data": "pong"])
    default:
        fail(id, "cmd desconocido: \(cmd)")
    }
}
