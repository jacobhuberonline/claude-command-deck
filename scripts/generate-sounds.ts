import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sampleRate = 44100;
const outputDirectory = join(process.cwd(), 'public', 'sounds');

interface Tone {
  startMs: number;
  durationMs: number;
  frequency: number;
  gain: number;
}

const soundSet: Record<string, Tone[]> = {
  'session-ready.wav': [
    { startMs: 0, durationMs: 95, frequency: 392, gain: 0.16 },
    { startMs: 82, durationMs: 120, frequency: 587.33, gain: 0.12 },
  ],
  'estimated-completion.wav': [
    { startMs: 0, durationMs: 135, frequency: 440, gain: 0.12 },
    { startMs: 138, durationMs: 150, frequency: 659.25, gain: 0.1 },
  ],
  'attention.wav': [{ startMs: 0, durationMs: 190, frequency: 783.99, gain: 0.11 }],
  'auth-connected.wav': [
    { startMs: 0, durationMs: 90, frequency: 493.88, gain: 0.1 },
    { startMs: 76, durationMs: 115, frequency: 659.25, gain: 0.11 },
  ],
  'auth-disconnected.wav': [
    { startMs: 0, durationMs: 110, frequency: 196, gain: 0.12 },
    { startMs: 170, durationMs: 120, frequency: 196, gain: 0.1 },
  ],
  'error.wav': [
    { startMs: 0, durationMs: 100, frequency: 392, gain: 0.11 },
    { startMs: 82, durationMs: 110, frequency: 329.63, gain: 0.1 },
    { startMs: 178, durationMs: 130, frequency: 261.63, gain: 0.09 },
  ],
  'reload-all-complete.wav': [
    { startMs: 0, durationMs: 85, frequency: 349.23, gain: 0.1 },
    { startMs: 72, durationMs: 85, frequency: 523.25, gain: 0.1 },
    { startMs: 144, durationMs: 110, frequency: 698.46, gain: 0.09 },
  ],
  'reload-all-warning.wav': [
    { startMs: 0, durationMs: 115, frequency: 293.66, gain: 0.11 },
    { startMs: 158, durationMs: 115, frequency: 246.94, gain: 0.11 },
  ],
};

mkdirSync(outputDirectory, { recursive: true });

Object.entries(soundSet).forEach(([fileName, tones]) => {
  const durationMs = Math.max(...tones.map((tone) => tone.startMs + tone.durationMs)) + 30;
  const samples = synthesize(tones, durationMs);
  writeFileSync(join(outputDirectory, fileName), encodeWav(samples));
});

function synthesize(tones: Tone[], durationMs: number): Int16Array {
  const sampleCount = Math.ceil((durationMs / 1000) * sampleRate);
  const samples = new Int16Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const timeMs = (sampleIndex / sampleRate) * 1000;
    let value = 0;

    tones.forEach((tone) => {
      const relativeMs = timeMs - tone.startMs;
      if (relativeMs < 0 || relativeMs > tone.durationMs) {
        return;
      }

      const envelope = raisedCosineEnvelope(relativeMs, tone.durationMs);
      const phase = 2 * Math.PI * tone.frequency * (relativeMs / 1000);
      value += Math.sin(phase) * tone.gain * envelope;
    });

    samples[sampleIndex] = clamp16(value);
  }

  return samples;
}

function raisedCosineEnvelope(positionMs: number, durationMs: number): number {
  const attackMs = Math.min(18, durationMs / 3);
  const releaseMs = Math.min(42, durationMs / 2);

  if (positionMs < attackMs) {
    return 0.5 - 0.5 * Math.cos(Math.PI * (positionMs / attackMs));
  }

  const releaseStart = durationMs - releaseMs;
  if (positionMs > releaseStart) {
    return 0.5 - 0.5 * Math.cos(Math.PI * ((durationMs - positionMs) / releaseMs));
  }

  return 1;
}

function clamp16(value: number): number {
  return Math.max(-32767, Math.min(32767, Math.round(value * 32767)));
}

function encodeWav(samples: Int16Array): Buffer {
  const dataLength = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataLength);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  for (let index = 0; index < samples.length; index += 1) {
    buffer.writeInt16LE(samples[index]!, 44 + index * 2);
  }

  return buffer;
}
