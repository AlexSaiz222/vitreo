// The trailer's music, composed in code (no samples, no licences): calm and
// warm, to sit under the app's own sounds (make-assets.mjs mixes them). A soft
// pad, an electric piano in eighths with an echo, a round bass and a light
// brushed beat that rests for the title, the night and the closing card. No
// hits, no risers: the presses are sounded by the app itself. 96 BPM: a beat
// is 0.625 s and a bar 2.5 s; the film changes scene on bar lines.
//
//   node make-soundtrack.mjs      → assets/music.wav (the same bytes every run)
/* global console -- a Node script */
import { Buffer } from 'node:buffer';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const RATE = 44_100;
const SECONDS = 48.5;
const BEAT = 0.625;
const BAR = BEAT * 4;
const N = Math.ceil(SECONDS * RATE);

/**
 * The film (s), as in index.html: the title, the flight through the app (the
 * night falls in its last bar), the phone, the notebook, the closing card.
 */
const AT = { flight: 2.5, night: 30, phone: 32.5, notebook: 37.5, end: 42.5 };

const stereo = () => [new Float32Array(N), new Float32Array(N)];
const master = stereo();
/** What ducks under the kick (pad, bass, arpeggio): the pulse of the track. */
const pumped = stereo();

let seed = 20261112;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const noise = () => random() * 2 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Adds a mono voice at `start`, panned -1 … 1. `voice(t)` is the sample t seconds in. */
function add(bus, start, seconds, pan, voice) {
  const first = Math.max(0, Math.floor(start * RATE));
  const count = Math.min(N - first, Math.floor(seconds * RATE));
  const l = Math.cos(((pan + 1) * Math.PI) / 4);
  const r = Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = 0; i < count; i++) {
    const s = voice(i / RATE);
    bus[0][first + i] += s * l;
    bus[1][first + i] += s * r;
  }
}

/** One-pole filters as stateful functions. */
function lowpass(cutoffAt) {
  let y = 0;
  return (x, t) => {
    y += (1 - Math.exp((-2 * Math.PI * cutoffAt(t)) / RATE)) * (x - y);
    return y;
  };
}
function highpass(cutoff) {
  const low = lowpass(() => cutoff);
  return (x, t) => x - low(x, t);
}

// ── Where the beat plays ─────────────────────────────────────────────────
/** 0 none, 0.6 light, 1 full: it rests for the title, the night and the closing card. */
const drive = (t) => {
  if (t < AT.flight + BAR || t >= AT.end) return 0;
  if (t >= AT.night && t < AT.phone) return 0;
  if (t >= AT.notebook) return 0.6;
  return 1;
};

// ── Harmony: Dmaj7 · Bm7 · Gmaj7 · A6, a bar each ────────────────────────
const CHORDS = [
  [38, 57, 61, 66, 69], // Dmaj7
  [35, 57, 62, 66, 69], // Bm7
  [31, 59, 62, 66, 71], // Gmaj7
  [33, 57, 61, 64, 66], // A6
];
const chordAt = (t) => CHORDS[Math.floor(Math.max(0, t) / BAR) % CHORDS.length];

// Pad: two detuned triangles a note, slow in and out, under everything.
for (let start = 0; start < SECONDS; start += BAR) {
  const chord = chordAt(start + 0.01);
  for (const [n, midi] of chord.slice(1).entries()) {
    for (const detune of [-0.07, 0.07]) {
      const f = hz(midi - 12 + detune);
      const filter = lowpass(() => 1400);
      add(pumped, start, BAR + 0.8, (n - 1.5) * 0.4 + detune * 3, (t) => {
        const env = Math.min(1, t / 0.5) * Math.min(1, (BAR + 0.8 - t) / 0.8);
        const tri = 2 * Math.abs(2 * ((t * f) % 1) - 1) - 1;
        return filter(tri, t) * env * 0.06;
      });
    }
  }
}

// Keys: an electric piano (a sine with a little of its octave), in eighths
// with a few rests to breathe and an echo; every other note at night.
const keyNote = (start, midi, gain, pan) => {
  const f = hz(midi);
  add(pumped, start, 1.4, pan, (s) => {
    const env = Math.exp(-s * 3.4) * Math.min(1, s / 0.006);
    return (
      (Math.sin(2 * Math.PI * f * s) + 0.3 * Math.sin(2 * Math.PI * 2 * f * s) * Math.exp(-s * 9)) *
      env *
      gain
    );
  });
};
const PATTERN = [1, 3, 2, 4, 3, 2, 4, 3];
for (let step = 0, t = 0; t < AT.end + BAR; step++, t += BEAT / 2) {
  const calm = t < AT.flight || (t >= AT.night && t < AT.phone) || t >= AT.end;
  if (calm && step % 2 === 1) continue;
  if (!calm && random() < 0.16) continue;
  const midi = chordAt(t)[PATTERN[step % PATTERN.length]] + 12;
  const swing = step % 2 === 1 ? 0.03 : 0;
  const fade = t >= AT.end ? Math.max(0, 1 - (t - AT.end) / BAR) : 1;
  const gain = (step % 4 === 0 ? 0.1 : 0.07) * (0.85 + random() * 0.3) * fade;
  keyNote(t + swing, midi, gain, step % 2 ? 0.35 : -0.35);
  keyNote(t + swing + BEAT * 0.75, midi, gain * 0.28, step % 2 ? -0.5 : 0.5);
}

// Bass: round, on the first and third beats; one long note a bar when calm.
const bass = (start, seconds, midi, gain) => {
  const f = hz(midi);
  add(pumped, start, seconds, 0, (s) => {
    const env = Math.min(1, s / 0.015) * Math.exp(-s * 1.6) * Math.min(1, (seconds - s) / 0.08);
    return (Math.sin(2 * Math.PI * f * s) + 0.16 * Math.sin(2 * Math.PI * 2 * f * s)) * env * gain;
  });
};
for (let t = AT.flight; t < AT.end + BAR; t += BAR) {
  const root = chordAt(t + 0.01)[0];
  if (drive(t + 0.01)) {
    bass(t, BEAT * 1.7, root, 0.3);
    bass(t + BEAT * 2, BEAT * 1.3, root, 0.26);
    bass(t + BEAT * 3.5, BEAT * 0.45, root + 7, 0.2);
  } else {
    bass(t, BAR * 0.95, root, 0.22);
  }
}

// The beat: a soft kick on one and three, a brush on two and four, a shaker.
const kicks = [];
const kick = (start, gain) => {
  kicks.push(start);
  add(master, start, 0.34, 0, (t) => {
    const f = 46 + 70 * Math.exp(-t * 24);
    return Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 10) * Math.min(1, t / 0.004) * gain;
  });
};
const brush = (start, gain) => {
  const body = lowpass(() => 2400);
  const air = highpass(1200);
  add(master, start, 0.14, -0.1, (t) => air(body(noise(), t), t) * Math.exp(-t * 30) * gain);
};
const shaker = (start, gain) => {
  const filter = highpass(7000);
  add(master, start, 0.05, 0.25, (t) => {
    return filter(noise(), t) * Math.exp(-t * 70) * Math.min(1, t / 0.004) * gain;
  });
};
for (let step = 0, t = AT.flight; t < AT.end; step++, t += BEAT / 2) {
  const level = drive(t);
  if (!level) continue;
  const beat = (step / 2) % 4;
  if (beat === 0 || beat === 2) kick(t, 0.34 * level);
  if (beat === 1 || beat === 3) brush(t, 0.13 * level);
  shaker(t + (step % 2 ? 0.03 : 0), (step % 2 ? 0.05 : 0.03) * level);
}

// The closing card: its chord, spread, like a small music box.
const bell = (start, midi, gain, pan = 0) => {
  const f = hz(midi);
  add(master, start, 2.4, pan, (t) => {
    const env = Math.exp(-t * 2.4) * Math.min(1, t / 0.004);
    return (
      (Math.sin(2 * Math.PI * f * t) +
        0.3 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 7)) *
      env *
      gain
    );
  });
};
for (const [i, midi] of [74, 78, 81, 85].entries())
  bell(AT.end + i * 0.14, midi, 0.07, i * 0.3 - 0.45);

// ── The pump, a small room, a ceiling, and out ───────────────────────────
for (let i = 0, k = 0; i < N; i++) {
  const t = i / RATE;
  while (k + 1 < kicks.length && kicks[k + 1] <= t) k++;
  const since = kicks.length && kicks[k] <= t ? t - kicks[k] : 1;
  const duck = 1 - 0.22 * Math.exp(-since * 7);
  master[0][i] += pumped[0][i] * duck;
  master[1][i] += pumped[1][i] * duck;
}
for (const [channel, delays] of [
  [master[0], [0.0297, 0.0371, 0.0411]],
  [master[1], [0.0307, 0.0359, 0.0423]],
]) {
  const dry = Float32Array.from(channel);
  for (const seconds of delays) {
    const d = Math.floor(seconds * RATE);
    const buffer = new Float32Array(N);
    let damp = 0;
    for (let i = 0; i < N; i++) {
      const back = i >= d ? buffer[i - d] : 0;
      damp += 0.4 * (back - damp);
      buffer[i] = dry[i] + damp * 0.72;
      channel[i] += buffer[i] * 0.06;
    }
  }
}
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (SECONDS - i / RATE) / 3, i / RATE / 0.02);
  for (const channel of master) {
    channel[i] = Math.tanh(channel[i] * 1.1) * fade;
    peak = Math.max(peak, Math.abs(channel[i]));
  }
}
const gain = 0.89 / peak; // −1 dBFS

const data = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(master[0][i] * gain * 32767), i * 4);
  data.writeInt16LE(Math.round(master[1][i] * gain * 32767), i * 4 + 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + data.length, 4);
header.write('WAVEfmt ', 8);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(2, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 4, 28);
header.writeUInt16LE(4, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(data.length, 40);
const out = path.join(import.meta.dirname, 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, 'music.wav'), Buffer.concat([header, data]));
console.log(`assets/music.wav · ${SECONDS.toFixed(1)} s · ${kicks.length} kicks`);
