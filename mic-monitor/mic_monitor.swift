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
func pidsCapturingInput() -> Set<pid_t> {
    var listAddr = AudioObjectPropertyAddress(
        mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain
    )
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(
        AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &size
    ) == noErr else { return [] }

    let count = Int(size) / MemoryLayout<AudioObjectID>.size
    if count == 0 { return [] }
    var processes = [AudioObjectID](repeating: 0, count: count)
    guard AudioObjectGetPropertyData(
        AudioObjectID(kAudioObjectSystemObject), &listAddr, 0, nil, &size, &processes
    ) == noErr else { return [] }

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

    var pids: Set<pid_t> = []
    for proc in processes {
        var isRunningInput: UInt32 = 0
        var s1 = UInt32(MemoryLayout<UInt32>.size)
        guard AudioObjectGetPropertyData(proc, &inputAddr, 0, nil, &s1, &isRunningInput) == noErr,
              isRunningInput != 0
        else { continue }

        var pid: pid_t = 0
        var s2 = UInt32(MemoryLayout<pid_t>.size)
        if AudioObjectGetPropertyData(proc, &pidAddr, 0, nil, &s2, &pid) == noErr {
            pids.insert(pid)
        }
    }
    return pids
}

func appInfo(for pid: pid_t) -> (bundleId: String?, name: String?) {
    if let app = NSRunningApplication(processIdentifier: pid) {
        return (app.bundleIdentifier, app.localizedName)
    }
    return (nil, nil)
}

let POLL_INTERVAL: TimeInterval = 1.0
// Sentinel PID for the macOS 12/13 fallback path where we know the device is
// in use but can't attribute it to a specific process.
let FALLBACK_PID: pid_t = -1

var lastActivePIDs: Set<pid_t> = []

while true {
    var currentPIDs: Set<pid_t> = []

    if #available(macOS 14.0, *) {
        currentPIDs = pidsCapturingInput()
    } else if let device = defaultInputDevice(), deviceIsRunningSomewhere(device) {
        currentPIDs = [FALLBACK_PID]
    }

    let now = Date().timeIntervalSince1970

    for pid in currentPIDs.subtracting(lastActivePIDs) {
        let (bundleId, name) = (pid == FALLBACK_PID) ? (nil, nil) : appInfo(for: pid)
        emit(MicEvent(
            event: "start",
            app_id: bundleId,
            app_name: name,
            pid: pid == FALLBACK_PID ? nil : pid,
            ts: now
        ))
    }
    for pid in lastActivePIDs.subtracting(currentPIDs) {
        let (bundleId, name) = (pid == FALLBACK_PID) ? (nil, nil) : appInfo(for: pid)
        emit(MicEvent(
            event: "stop",
            app_id: bundleId,
            app_name: name,
            pid: pid == FALLBACK_PID ? nil : pid,
            ts: now
        ))
    }

    lastActivePIDs = currentPIDs
    Thread.sleep(forTimeInterval: POLL_INTERVAL)
}
