// mic_monitor — emits JSON-line events when any app starts/stops capturing the mic.
//
// Output: one JSON object per line on stdout, e.g.
//   {"event":"start","app_id":"com.apple.Safari","app_name":"Safari","pid":1234,"ts":1715534400.123}
//   {"event":"stop","app_id":"com.apple.Safari","app_name":"Safari","pid":1234,"ts":1715534950.456}
//
// On macOS 14.0+ we attribute the event to a specific process via the audio
// process-object API. On 12.x–13.x we fall back to a device-level signal and
// emit events without app_id/app_name/pid (the consumer should still show
// "Meeting detected" without an app name).
//
// Field contract (kept deliberately portable for a future Windows helper):
//   event   — required, "start" | "stop"
//   app_id  — opaque identifier; bundle id on macOS, exe path on Windows
//   app_name — display name
//   pid     — process id
//   ts      — unix timestamp (seconds, fractional)
//
// stdout is line-unbuffered so each event reaches the parent immediately.
// If the parent dies the OS will deliver SIGPIPE on the next write; we let it
// kill us and rely on the parent's respawn loop.

import Foundation
import CoreAudio
import AppKit

setbuf(stdout, nil)

struct MicEvent: Codable {
    let event: String
    let app_id: String?
    let app_name: String?
    let pid: Int32?
    let ts: Double
}

let encoder: JSONEncoder = {
    let e = JSONEncoder()
    e.outputFormatting = []
    return e
}()

func emit(_ event: MicEvent) {
    if let data = try? encoder.encode(event), let line = String(data: data, encoding: .utf8) {
        print(line)
    }
}

func defaultInputDevice() -> AudioDeviceID? {
    var deviceID: AudioDeviceID = 0
    var size = UInt32(MemoryLayout<AudioDeviceID>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyDefaultInputDevice,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    let status = AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject),
        &address, 0, nil, &size, &deviceID
    )
    return (status == noErr && deviceID != 0) ? deviceID : nil
}

func deviceIsRunningSomewhere(_ deviceID: AudioDeviceID) -> Bool {
    var isRunning: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    var address = AudioObjectPropertyAddress(
        mSelector: kAudioDevicePropertyDeviceIsRunningSomewhere,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    return AudioObjectGetPropertyData(deviceID, &address, 0, nil, &size, &isRunning) == noErr
        && isRunning != 0
}

@available(macOS 14.0, *)
func processObjectsCapturingInput() -> [pid_t: AudioObjectID] {
    var listAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &size
    ) == noErr else { return [:] }

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    if count == 0 { return [:] }
    var processes = [AudioObjectID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &size, &processes
    ) == noErr else { return [:] }

    var inputAddr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyIsRunningInput,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var pidAddr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyPID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )

    var procByPID: [pid_t: AudioObjectID] = [:]
    for proc in processes {
        var isRunningInput: UInt32 = 0
        var s1 = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(proc, &inputAddr, 0, nil, &s1, &isRunningInput) == noErr,
              isRunningInput != 0
        else { continue }

        var pid: pid_t = 0
        var s2 = UInt32(MemoryLayout<pid_t>.size)
        if AudioObjectGetPropertyData(proc, &pidAddr, 0, nil, &s2, &pid) == noErr {
            procByPID[pid] = proc
        }
    }
    return procByPID
}

// Bundle id straight from the CoreAudio process object. The pid capturing
// input is often a helper/XPC child (browser GPU process, app media helper)
// that NSRunningApplication can't resolve — it only knows LaunchServices
// apps — but coreaudiod records the client's bundle id for every process
// object it vends.
@available(macOS 14.0, *)
func processBundleID(_ proc: AudioObjectID) -> String? {
    var addr = AudioObjectPropertyAddress(
        mSelector: kAudioProcessPropertyBundleID,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size = UInt32(MemoryLayout<CFString?>.size)
    var value: CFString?
    let status = withUnsafeMutablePointer(to: &value) {
        AudioObjectGetPropertyData(proc, &addr, 0, nil, &size, $0)
    }
    guard status == noErr, let s = value as String?, !s.isEmpty else { return nil }
    return s
}

func processPath(_ pid: pid_t) -> String? {
    var buf = [CChar](repeating: 0, count: 4096)
    let n = proc_pidpath(pid, &buf, UInt32(buf.count))
    guard n > 0 else { return nil }
    return String(cString: buf)
}

// Last-resort bundle id: helpers live inside the owning .app bundle, so the
// exe path usually contains it (…/Foo.app/Contents/…).
func bundleIDFromPath(_ path: String) -> String? {
    guard let range = path.range(of: ".app/") else { return nil }
    let appPath = String(path[..<range.lowerBound]) + ".app"
    return Bundle(path: appPath)?.bundleIdentifier
}

@available(macOS 14.0, *)
func appInfo(for pid: pid_t, procObject: AudioObjectID?) -> (bundleId: String?, name: String?) {
    if let app = NSRunningApplication(processIdentifier: pid), let bid = app.bundleIdentifier {
        return (bid, app.localizedName)
    }
    var bundleId: String? = procObject.flatMap { processBundleID($0) }
    var name: String? = nil
    if let path = processPath(pid) {
        name = (path as NSString).lastPathComponent
        if bundleId == nil { bundleId = bundleIDFromPath(path) }
    }
    return (bundleId, name)
}

let POLL_INTERVAL: TimeInterval = 1.0
// Sentinel PID for the macOS 12/13 fallback path where we know the device is
// in use but can't attribute it to a specific process.
let FALLBACK_PID: pid_t = -1

var lastActivePIDs: Set<pid_t> = []
// Info resolved at start time, replayed at stop time — the CoreAudio process
// object (and often the process itself) is gone once the mic is released.
var infoCache: [pid_t: (String?, String?)] = [:]

while true {
    var procByPID: [pid_t: AudioObjectID] = [:]
    var currentPIDs: Set<pid_t> = []

    if #available(macOS 14.0, *) {
        procByPID = processObjectsCapturingInput()
        currentPIDs = Set(procByPID.keys)
    } else if let device = defaultInputDevice(), deviceIsRunningSomewhere(device) {
        currentPIDs = [FALLBACK_PID]
    }

    let now = Date().timeIntervalSince1970

    for pid in currentPIDs.subtracting(lastActivePIDs) {
        var info: (String?, String?) = (nil, nil)
        if pid != FALLBACK_PID, #available(macOS 14.0, *) {
            info = appInfo(for: pid, procObject: procByPID[pid])
        }
        infoCache[pid] = info
        emit(MicEvent(
            event: "start",
            app_id: info.0,
            app_name: info.1,
            pid: pid == FALLBACK_PID ? nil : pid,
            ts: now
        ))
    }
    for pid in lastActivePIDs.subtracting(currentPIDs) {
        let info = infoCache.removeValue(forKey: pid) ?? (nil, nil)
        emit(MicEvent(
            event: "stop",
            app_id: info.0,
            app_name: info.1,
            pid: pid == FALLBACK_PID ? nil : pid,
            ts: now
        ))
    }

    lastActivePIDs = currentPIDs
    Thread.sleep(forTimeInterval: POLL_INTERVAL)
}
