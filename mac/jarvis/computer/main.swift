// Petra Computer (GTD, 7 Nov 2026)
//
// Petra's hands on this Mac. A small menu-bar app that takes screenshots and moves the mouse,
// clicks, types and presses keys when the JARVIS bridge asks it to (bridge/computer.mjs, the
// `computer` tools Petra and her managers have). It is its own app so macOS asks for Screen
// Recording and Accessibility for "Petra Computer" alone, not for node or the terminal.
//
// It listens on 127.0.0.1:8795 only: one JSON request per line, one JSON reply per line.
//   status | request | displays | screenshot {display, maxWidth} | cursor
//   move {x,y} | click {x,y,button,count} | drag {x,y,toX,toY} | scroll {x,y,dx,dy}
//   type {text} | key {keys: "cmd+shift+k"} | busy {on, who}
// Coordinates are global screen points (the main display's top-left is 0,0).
//
// While it works, the menu bar shows "Petra ●" with a Stop item, and Esc anywhere stops it: the
// next request from the bridge is refused with "stopped", until the bridge starts a new task.
//
// Build: computer/build.sh (swiftc, ad-hoc signed). Rebuilding changes the signature, and
// macOS then asks for both permissions again.

import AppKit
import Network
import ApplicationServices

final class Hands: NSObject, NSApplicationDelegate {
    var listener: NWListener?
    var statusItem: NSStatusItem!
    var stoppedAt: Double = 0          // Esc or Stop: refuse actions until the bridge clears it
    var busyWho = ""
    var ownKeyAt: Double = 0          // its own key presses, so its own Esc is not taken as Luke's

    func applicationDidFinishLaunching(_ note: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        setBusy(false)
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "Stop Petra using the computer", action: #selector(stopNow), keyEquivalent: ""))
        menu.addItem(NSMenuItem(title: "Ask for permissions", action: #selector(askPermissions), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Petra Computer", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        statusItem.menu = menu
        NSEvent.addGlobalMonitorForEvents(matching: .keyDown) { [weak self] e in
            if e.keyCode == 53, let self, !self.busyWho.isEmpty, Date().timeIntervalSince1970 - self.ownKeyAt > 0.6 { self.stopNow() }   // Esc
        }
        startListening()
    }

    func setBusy(_ on: Bool, _ who: String = "") {
        busyWho = on ? who : ""
        DispatchQueue.main.async {
            self.statusItem.button?.title = on ? "Petra ●" : "Petra"
            self.statusItem.button?.toolTip = on ? "\(who) is using the computer. Press Esc to stop." : "Petra Computer: idle"
        }
    }
    @objc func stopNow() { stoppedAt = Date().timeIntervalSince1970; setBusy(false) }
    @objc func askPermissions() { _ = requestPermissions() }

    func requestPermissions() -> [String: Any] {
        let screen = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let access = AXIsProcessTrustedWithOptions(opts)
        return ["screen": screen, "accessibility": access]
    }

    // ------------------------------------------------------------ the socket
    func startListening() {
        let params = NWParameters.tcp
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: 8795)
        params.allowLocalEndpointReuse = true
        guard let l = try? NWListener(using: params) else { NSLog("Petra Computer: cannot listen on 8795"); exit(1) }
        l.newConnectionHandler = { [weak self] c in self?.serve(c) }
        l.start(queue: .global(qos: .userInitiated))
        listener = l
    }
    func serve(_ c: NWConnection) {
        c.start(queue: .global(qos: .userInitiated))
        var buffer = Data()
        func readMore() {
            c.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, done, err in
                if let data { buffer.append(data) }
                while let nl = buffer.firstIndex(of: 10) {
                    let line = buffer.subdata(in: buffer.startIndex..<nl)
                    buffer.removeSubrange(buffer.startIndex...nl)
                    var reply = self.handle(line)
                    reply.append(10)
                    c.send(content: reply, completion: .contentProcessed { _ in })
                }
                if done || err != nil { c.cancel() } else { readMore() }
            }
        }
        readMore()
    }

    func handle(_ line: Data) -> Data {
        var out: [String: Any]
        do {
            guard let req = try JSONSerialization.jsonObject(with: line) as? [String: Any], let cmd = req["cmd"] as? String else {
                throw Failure("bad request")
            }
            out = try run(cmd, req)
            out["ok"] = true
        } catch let f as Failure {
            out = ["ok": false, "error": f.message]
        } catch {
            out = ["ok": false, "error": "\(error)"]
        }
        out["stoppedAt"] = stoppedAt
        return (try? JSONSerialization.data(withJSONObject: out)) ?? Data("{\"ok\":false}".utf8)
    }

    struct Failure: Error { let message: String; init(_ m: String) { message = m } }
    func num(_ r: [String: Any], _ k: String, _ d: Double? = nil) throws -> Double {
        if let v = r[k] as? Double { return v }
        if let v = r[k] as? Int { return Double(v) }
        if let d { return d }
        throw Failure("missing \(k)")
    }
    let actions: Set<String> = ["move", "click", "drag", "scroll", "type", "key"]

    func run(_ cmd: String, _ r: [String: Any]) throws -> [String: Any] {
        if actions.contains(cmd) {
            if !AXIsProcessTrusted() { throw Failure("no Accessibility permission: System Settings → Privacy & Security → Accessibility → turn on Petra Computer") }
            if let since = r["since"] as? Double, stoppedAt > since { throw Failure("stopped: Luke pressed Esc or Stop") }
        }
        switch cmd {
        case "status":
            return ["screen": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted(), "displays": displays(), "busy": busyWho]
        case "request":
            return DispatchQueue.main.sync { requestPermissions() }
        case "displays":
            return ["displays": displays()]
        case "busy":
            setBusy((r["on"] as? Bool) ?? false, (r["who"] as? String) ?? "Petra")
            return [:]
        case "cursor":
            let p = CGEvent(source: nil)?.location ?? .zero
            return ["x": p.x, "y": p.y]
        case "screenshot":
            return try screenshot(display: Int(try num(r, "display", 0)), maxWidth: try num(r, "maxWidth", 1440))
        case "move":
            post(.mouseMoved, try point(r), .left)
            return [:]
        case "click":
            let p = try point(r)
            let button: CGMouseButton = (r["button"] as? String) == "right" ? .right : .left
            let count = Int(try num(r, "count", 1))
            post(.mouseMoved, p, button)
            usleep(60_000)
            for n in 1...max(1, min(count, 3)) {
                let down = button == .right ? CGEventType.rightMouseDown : .leftMouseDown
                let up = button == .right ? CGEventType.rightMouseUp : .leftMouseUp
                post(down, p, button, clicks: n); usleep(30_000)
                post(up, p, button, clicks: n); usleep(60_000)
            }
            return [:]
        case "drag":
            let a = try point(r), b = CGPoint(x: try num(r, "toX"), y: try num(r, "toY"))
            post(.mouseMoved, a, .left); usleep(80_000)
            post(.leftMouseDown, a, .left); usleep(120_000)
            let steps = 24
            for i in 1...steps {
                let t = Double(i) / Double(steps)
                post(.leftMouseDragged, CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), .left)
                usleep(16_000)
            }
            usleep(150_000)
            post(.leftMouseUp, b, .left)
            return [:]
        case "scroll":
            let p = try point(r)
            post(.mouseMoved, p, .left); usleep(40_000)
            let dy = Int32(try num(r, "dy", 0)), dx = Int32(try num(r, "dx", 0))
            CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0)?.post(tap: .cghidEventTap)
            return [:]
        case "type":
            guard let text = r["text"] as? String else { throw Failure("missing text") }
            typeText(text)
            return [:]
        case "key":
            guard let keys = r["keys"] as? String else { throw Failure("missing keys") }
            try pressKeys(keys)
            return [:]
        default:
            throw Failure("unknown command \(cmd)")
        }
    }

    func point(_ r: [String: Any]) throws -> CGPoint { CGPoint(x: try num(r, "x"), y: try num(r, "y")) }
    func post(_ type: CGEventType, _ p: CGPoint, _ button: CGMouseButton, clicks: Int = 1) {
        guard let e = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: p, mouseButton: button) else { return }
        if clicks > 1 { e.setIntegerValueField(.mouseEventClickState, value: Int64(clicks)) }
        e.post(tap: .cghidEventTap)
    }

    // ------------------------------------------------------------ the screen
    func displays() -> [[String: Any]] {
        var ids = [CGDirectDisplayID](repeating: 0, count: 16)
        var n: UInt32 = 0
        CGGetActiveDisplayList(16, &ids, &n)
        let mouse = CGEvent(source: nil)?.location ?? .zero
        return (0..<Int(n)).map { i in
            let b = CGDisplayBounds(ids[i])
            return ["index": i, "x": b.origin.x, "y": b.origin.y, "width": b.width, "height": b.height,
                    "main": CGDisplayIsMain(ids[i]) != 0, "hasCursor": b.contains(mouse)]
        }
    }

    func screenshot(display: Int, maxWidth: Double) throws -> [String: Any] {
        if !CGPreflightScreenCaptureAccess() { throw Failure("no Screen Recording permission: System Settings → Privacy & Security → Screen & System Audio Recording → turn on Petra Computer") }
        let list = displays()
        guard display >= 0, display < list.count else { throw Failure("no display \(display); there are \(list.count)") }
        let d = list[display]
        let file = NSTemporaryDirectory() + "petra-screen-\(UUID().uuidString).png"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
        p.arguments = ["-x", "-C", "-D", String(display + 1), "-t", "png", file]
        try p.run(); p.waitUntilExit()
        defer { try? FileManager.default.removeItem(atPath: file) }
        guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil),
              let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { throw Failure("screenshot failed") }
        let pointsW = d["width"] as! Double, pointsH = d["height"] as! Double
        let scale = min(1.0, maxWidth / pointsW)                     // image pixels per screen point
        let w = Int((pointsW * scale).rounded()), h = Int((pointsH * scale).rounded())
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw Failure("resize failed") }
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let small = ctx.makeImage() else { throw Failure("resize failed") }
        let rep = NSBitmapImageRep(cgImage: small)
        guard let jpg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.72]) else { throw Failure("encode failed") }
        return ["image": jpg.base64EncodedString(), "width": w, "height": h, "scale": scale,
                "originX": d["x"]!, "originY": d["y"]!, "display": display, "displays": list]
    }

    // ------------------------------------------------------------ the keyboard
    func typeText(_ text: String) {
        let units = Array(text.utf16)
        var i = 0
        while i < units.count {
            let chunk = Array(units[i..<min(i + 16, units.count)])
            if chunk.count == 1 && (chunk[0] == 10 || chunk[0] == 13) {
                tap(36, []); i += 1; continue                      // a new line is Return
            }
            if let nl = chunk.firstIndex(where: { $0 == 10 || $0 == 13 }), nl > 0 {
                sendUnicode(Array(chunk[0..<nl])); i += nl; continue
            }
            sendUnicode(chunk); i += chunk.count
        }
    }
    func sendUnicode(_ chunk: [UniChar]) {
        var c = chunk
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { continue }
            e.keyboardSetUnicodeString(stringLength: c.count, unicodeString: &c)
            e.post(tap: .cghidEventTap)
            usleep(8_000)
        }
        usleep(12_000)
    }

    let keyCodes: [String: CGKeyCode] = [
        "a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7, "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
        "y": 16, "t": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
        "]": 30, "o": 31, "u": 32, "[": 33, "i": 34, "p": 35, "return": 36, "enter": 36, "l": 37, "j": 38, "'": 39, "k": 40, ";": 41,
        "\\": 42, ",": 43, "/": 44, "n": 45, "m": 46, ".": 47, "tab": 48, "space": 49, "`": 50, "delete": 51, "backspace": 51,
        "escape": 53, "esc": 53, "forwarddelete": 117, "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
        "left": 123, "right": 124, "down": 125, "up": 126,
        "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97, "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
    ]
    func pressKeys(_ combo: String) throws {
        for step in combo.split(separator: " ") {                    // "cmd+a cmd+c" is two presses
            var flags: CGEventFlags = []
            var key: CGKeyCode?
            for part in step.lowercased().split(separator: "+").map(String.init) {
                switch part {
                case "cmd", "command", "⌘": flags.insert(.maskCommand)
                case "shift", "⇧": flags.insert(.maskShift)
                case "opt", "option", "alt", "⌥": flags.insert(.maskAlternate)
                case "ctrl", "control", "⌃": flags.insert(.maskControl)
                case "fn": flags.insert(.maskSecondaryFn)
                default:
                    guard let k = keyCodes[part] else { throw Failure("unknown key \(part)") }
                    key = k
                }
            }
            guard let key else { throw Failure("no key in \(step)") }
            tap(key, flags)
            usleep(80_000)
        }
    }
    func tap(_ key: CGKeyCode, _ flags: CGEventFlags) {
        ownKeyAt = Date().timeIntervalSince1970
        for down in [true, false] {
            guard let e = CGEvent(keyboardEventSource: nil, virtualKey: key, keyDown: down) else { continue }
            e.flags = flags
            e.post(tap: .cghidEventTap)
            usleep(20_000)
        }
    }
}

let app = NSApplication.shared
let hands = Hands()
app.delegate = hands
app.setActivationPolicy(.accessory)
app.run()
