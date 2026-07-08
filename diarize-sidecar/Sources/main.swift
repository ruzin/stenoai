// diarize-sidecar — offline speaker diarization via FluidAudio's Sortformer.
//
// Usage:
//   steno-diarize <audio-file>
//
// Sortformer has a fixed 4-speaker-slot architecture (SortformerConfig.numSpeakers
// is hardcoded to 4) — there is no speaker-count hint to pass, unlike the
// previous OfflineDiarizerManager-based version of this tool.
//
// Output (stdout): one JSON line on success
//   [{"speakerId":"SPEAKER_0","start":0.0,"end":3.2}, ...]
//
// Exit 0 on success, 1 on failure (error written to stderr).
// stdout is unbuffered so the parent receives the line immediately.
//
// Audio loading avoids all CoreAudio file APIs (which fail with error
// 1954115647 when spawned from a PyInstaller bundle) by delegating to
// ffmpeg, which uses its own decoders entirely outside CoreAudio. This is
// also why we call SortformerDiarizer.processComplete(_:sourceSampleRate:)
// with raw samples rather than the processComplete(audioFileURL:) overload —
// that overload internally uses AudioConverter.resampleAudioFile, which
// calls AVAudioFile(forReading:) and would reintroduce the same crash.

import Foundation
import FluidAudio

setbuf(stdout, nil)

// Segments shorter than this are spurious artifacts (an ~80ms noise-blip
// pattern observed empirically against real meeting audio), dropped before
// emitting rather than surfaced as a phantom speaker turn.
let minSegmentDurationSeconds: Float = 0.25

func fail(_ message: String) -> Never {
    fputs("steno-diarize error: \(message)\n", stderr)
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("usage: steno-diarize <audio-file>")
}

let inputPath = CommandLine.arguments[1]

guard FileManager.default.fileExists(atPath: inputPath) else {
    fail("file not found: \(inputPath)")
}

// Locate ffmpeg. The binary lives next to steno-diarize in the bundle;
// fall back to common Homebrew / system paths for terminal use.
func findFfmpeg() -> String? {
    let execDir = URL(fileURLWithPath: CommandLine.arguments[0])
        .resolvingSymlinksInPath()
        .deletingLastPathComponent()
        .path
    let candidates = [
        "\(execDir)/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
}

// Decode any audio format to 16 kHz mono Float32 using ffmpeg, writing
// output to a temp file.
//
// Uses terminationHandler + CheckedContinuation so the Task suspends
// instead of blocking a thread. ffmpeg stdin is redirected to /dev/null
// to prevent it from blocking on an inherited terminal.
func loadSamplesViaFfmpeg(path: String) async throws -> [Float] {
    guard let ffmpegPath = findFfmpeg() else {
        throw NSError(domain: "steno-diarize", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "ffmpeg not found"])
    }
    let tmpURL = URL(fileURLWithPath: NSTemporaryDirectory())
        .appendingPathComponent("steno-diarize-\(UUID().uuidString).f32le")
    defer { try? FileManager.default.removeItem(at: tmpURL) }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: ffmpegPath)
    process.arguments = [
        "-loglevel", "error",
        "-i", path,
        "-ar", "16000",
        "-ac", "1",
        "-f", "f32le",
        "-y",
        tmpURL.path,
    ]
    // Redirect stdin to /dev/null so ffmpeg never blocks waiting for
    // interactive input on an inherited terminal.
    process.standardInput = FileHandle.nullDevice
    // Redirect ffmpeg stderr to /dev/null. When steno-diarize is spawned by
    // Python with capture_output=True, our own stderr is a pipe that Python
    // only drains after we exit. ffmpeg inherits that pipe and fills the
    // buffer with progress/profiling lines, causing it to block — which means
    // terminationHandler never fires and steno-diarize hangs. /dev/null
    // prevents the buffer fill; ffmpeg errors are still visible via exit status.
    process.standardError = FileHandle(forWritingAtPath: "/dev/null")

    try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
        process.terminationHandler = { p in
            if p.terminationStatus == 0 {
                cont.resume()
            } else {
                cont.resume(throwing: NSError(
                    domain: "steno-diarize", code: Int(p.terminationStatus),
                    userInfo: [NSLocalizedDescriptionKey: "ffmpeg exited \(p.terminationStatus)"]))
            }
        }
        do {
            try process.run()
        } catch {
            cont.resume(throwing: error)
        }
    }

    let rawData = try Data(contentsOf: tmpURL, options: .mappedIfSafe)

    guard !rawData.isEmpty else {
        throw NSError(domain: "steno-diarize", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "ffmpeg produced no output"])
    }

    // f32le on Apple Silicon (little-endian) — reinterpret bytes as Float directly.
    return rawData.withUnsafeBytes { ptr in
        Array(ptr.bindMemory(to: Float.self))
    }
}

// Keep the main run loop alive so dispatch sources (including the
// process-exit source that drives terminationHandler) can fire normally.
// sema.wait() blocks the main thread, which prevents dispatch delivery
// and causes terminationHandler to never fire.
Task {
    do {
        // .cpuAndNeuralEngine forces genuine ANE execution — the default
        // .all silently routes Sortformer to GPU instead (confirmed via
        // Activity Monitor during evaluation).
        let models = try await SortformerModels.loadFromHuggingFace(
            config: .default,
            computeUnits: .cpuAndNeuralEngine
        )
        let diarizer = SortformerDiarizer()
        diarizer.initialize(models: models)

        let samples = try await loadSamplesViaFfmpeg(path: inputPath)
        let timeline = try diarizer.processComplete(samples, sourceSampleRate: nil)

        struct Segment: Encodable {
            let speakerId: String
            let start: Double
            let end: Double
        }

        let output = timeline.speakers.values
            .flatMap { $0.finalizedSegments }
            .filter { $0.duration >= minSegmentDurationSeconds }
            .map { seg in
                Segment(
                    speakerId: "SPEAKER_\(seg.speakerIndex)",
                    start: Double(seg.startTime),
                    end: Double(seg.endTime)
                )
            }
            .sorted { $0.start < $1.start }

        let encoded = try JSONEncoder().encode(output)
        guard let line = String(data: encoded, encoding: .utf8) else {
            exit(1)
        }
        print(line)
        exit(0)
    } catch {
        fputs("steno-diarize error: \(error)\n", stderr)
        exit(1)
    }
}

RunLoop.main.run()
