// One-off generator for a tiny synthesized "reward chime" WAV asset.
// Run with: node scripts/generate-chime.js
// Produces a short two-note ascending chime (no external sound asset needed).
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 44100;

function tone(freq, durationSec, startGain, endGain) {
  const samples = Math.floor(SAMPLE_RATE * durationSec);
  const data = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) {
    const t = i / SAMPLE_RATE;
    const envelope = startGain + (endGain - startGain) * (i / samples);
    data[i] = Math.sin(2 * Math.PI * freq * t) * envelope;
  }
  return data;
}

function concat(...chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

// Two-note ascending chime: C6 -> E6, each with a quick attack and decay.
const note1 = tone(1046.5, 0.16, 0, 0.5);
const note1Tail = tone(1046.5, 0.1, 0.5, 0);
const note2 = tone(1318.5, 0.22, 0, 0.6);
const note2Tail = tone(1318.5, 0.18, 0.6, 0);
const samples = concat(note1, note1Tail, note2, note2Tail);

const bytesPerSample = 2;
const blockAlign = bytesPerSample;
const byteRate = SAMPLE_RATE * blockAlign;
const dataSize = samples.length * bytesPerSample;
const buffer = Buffer.alloc(44 + dataSize);

buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(SAMPLE_RATE, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(16, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);

for (let i = 0; i < samples.length; i += 1) {
  const clamped = Math.max(-1, Math.min(1, samples[i]));
  buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * bytesPerSample);
}

const outPath = path.join(__dirname, '..', 'assets', 'sounds', 'chime.wav');
fs.writeFileSync(outPath, buffer);
console.log(`Wrote ${outPath} (${buffer.length} bytes)`);
