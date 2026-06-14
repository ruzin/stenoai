// Generate a synthetic mono 16 kHz 16-bit PCM WAV with a real RIFF header (not
// null bytes — mirrors the on-the-fly idea from tests/test_audio_preprocess.py
// but produces a file the transcriber actually decodes). A low sine tone is
// enough: Parakeet returns an empty transcript on non-speech, which is exactly
// what the plumbing + HEARTBEAT smoke wants — the pipeline still runs end to
// end and emits HEARTBEAT. Stays well above the transcriber's 1 KB stub floor
// (5 s ≈ 160 KB). No checked-in binary fixtures.
const fs = require('fs');

function makeWav(
  filePath,
  { seconds = 5, sampleRate = 16000, freq = 220, amplitude = 0.05 } = {},
) {
  const numSamples = Math.floor(seconds * sampleRate);
  const dataBytes = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataBytes);

  // RIFF/WAVE header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  // fmt chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM fmt chunk size
  buf.writeUInt16LE(1, 20); // audio format = PCM
  buf.writeUInt16LE(1, 22); // channels = 1
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate (sampleRate * blockAlign)
  buf.writeUInt16LE(2, 32); // block align (channels * bytesPerSample)
  buf.writeUInt16LE(16, 34); // bits per sample
  // data chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);

  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(
      amplitude * 32767 * Math.sin((2 * Math.PI * freq * i) / sampleRate),
    );
    buf.writeInt16LE(sample, 44 + i * 2);
  }

  fs.writeFileSync(filePath, buf);
  return filePath;
}

module.exports = { makeWav };
