// Generates a real, deterministic 16 kHz interleaved-stereo float32 raw
// sample buffer for testing the live-transcript sidecar's per-channel VAD +
// speaker attribution (mic=L, system=R — see simple_recorder.py's
// _live_stdin_consumer). Unlike make-wav.js's synthetic sine tone (fine for
// plumbing-only smokes since a non-speech WAV just returns an empty
// transcript), this fixture needs to trigger Silero VAD for real and produce
// real, distinguishable transcript text on each channel — a sine wave can't
// do either.
//
// Uses macOS's built-in `say` (TTS) + `afconvert` (both ship with every Mac,
// no extra install) to synthesize two distinct short sentences, one per
// channel, rather than checking in binary audio fixtures. This only ever
// runs on macOS (the @pipeline spec that uses it skips loudly everywhere
// else / when parakeet-mlx isn't usable — see the spec for why: parakeet-mlx
// needs Metal, which GitHub-hosted macOS CI runners don't have).
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SAMPLE_RATE = 16000;

/** Parse a canonical or extended WAV file and return its data-chunk bytes as
 *  a Float32Array. Scans chunks properly (doesn't assume a fixed 44-byte
 *  header) since afconvert's float-PCM WAVE output can include extra
 *  chunks (e.g. `fact`) ahead of `data`. */
function readWavFloat32(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${filePath} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  while (offset < buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (chunkId === 'data') {
      const floatCount = chunkSize / 4;
      const samples = new Float32Array(floatCount);
      for (let i = 0; i < floatCount; i++) {
        samples[i] = buf.readFloatLE(dataStart + i * 4);
      }
      return samples;
    }
    // Chunks are padded to an even byte boundary.
    offset = dataStart + chunkSize + (chunkSize % 2);
  }
  throw new Error(`${filePath}: no data chunk found`);
}

/** Synthesize `text` via `say`, convert to 16 kHz mono float32 WAV via
 *  `afconvert`, and return the raw samples. Throws if either tool is
 *  unavailable (non-macOS) — callers should catch and skip loudly. */
function synthesizeSpeech(text, tmpDir, stem) {
  const aiffPath = path.join(tmpDir, `${stem}.aiff`);
  const wavPath = path.join(tmpDir, `${stem}.wav`);
  execSync(`say -o ${JSON.stringify(aiffPath)} ${JSON.stringify(text)}`);
  execSync(
    `afconvert -f WAVE -d LEF32@${SAMPLE_RATE} -c 1 ${JSON.stringify(aiffPath)} ${JSON.stringify(wavPath)}`,
  );
  return readWavFloat32(wavPath);
}

/**
 * Build an interleaved-stereo (mic=L, system=R) 16 kHz float32 raw buffer
 * from two distinct sentences, arranged sequentially (mic speaks fully,
 * then system speaks fully, with silence padding around each) so this
 * fixture doesn't also have to reason about the bleed-dedup hold window —
 * that's a separate concern from proving per-channel routing works.
 *
 * Returns `{ buffer, micText, sysText }` — `buffer` is a Node Buffer ready
 * to write straight to the sidecar's stdin.
 */
function makeSequentialStereoSpeech({
  micText = 'The quick brown fox jumps over the lazy dog',
  sysText = 'Pack my box with five dozen liquor jugs',
} = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stenoai-e2e-speech-'));
  try {
    const micSamples = synthesizeSpeech(micText, tmpDir, 'mic');
    const sysSamples = synthesizeSpeech(sysText, tmpDir, 'sys');

    const pad = new Float32Array(Math.round(SAMPLE_RATE * 0.75)); // 750ms silence
    // mic speaks (padded both sides), then silence, then system speaks
    // (padded both sides) — non-overlapping in time.
    const micTrack = concat([pad, micSamples, pad]);
    const silentTrack = new Float32Array(micTrack.length);
    const sysTrack = concat([pad, sysSamples, pad]);
    const silentTrack2 = new Float32Array(sysTrack.length);

    const micFull = concat([micTrack, silentTrack2]);
    const sysFull = concat([silentTrack, sysTrack]);

    const interleaved = new Float32Array(micFull.length * 2);
    for (let i = 0; i < micFull.length; i++) {
      interleaved[i * 2] = micFull[i];
      interleaved[i * 2 + 1] = sysFull[i];
    }
    return {
      buffer: Buffer.from(interleaved.buffer, interleaved.byteOffset, interleaved.byteLength),
      micText,
      sysText,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** True if `say` + `afconvert` are both present (i.e. this is macOS). */
function hasMacSpeechTools() {
  try {
    execSync('command -v say && command -v afconvert', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

module.exports = { makeSequentialStereoSpeech, hasMacSpeechTools };
