/**
 * Development only: the landing video's soundtrack (D130, D132), rendered
 * offline in the page by apps/web/scripts/landing-video.mjs. Nothing in the
 * app imports it, so no build carries it.
 *
 * Three layers, all made here or by the app's own code:
 *
 * - a short cozy piece, composed and synthesised here (no recording, no
 *   licence): warm pad, soft electric-piano arpeggios, a round bass and a
 *   light, brushed beat at 100 BPM that comes in with the first action and
 *   leaves for the night;
 * - the greenhouse itself: the ambient engine, moved frame by frame to the
 *   mix the app had (day, the window open, the rain, the night);
 * - the interface's touches at the instant each press happened, and the
 *   devices whenever the data said they changed (the same code as the app).
 */
import { createCueGate, cuesBetween } from '../features/sound/deviceCues.ts';
import type { DeviceState } from '../features/sound/deviceCues.ts';
import { DeviceSounds } from '../features/sound/deviceSound.ts';
import { AmbientEngine } from '../features/sound/engine.ts';
import { LAYERS, mixFor } from '../features/sound/mix.ts';
import { shapeOf, TouchSounds } from '../features/sound/touchSound.ts';
import type { TouchCue } from '../features/sound/touchSound.ts';
import type { VideoSample } from './videoMode.ts';

export interface SoundtrackInput {
  seconds: number;
  /** One sample a frame: what the greenhouse sounded like then. */
  frames: { t: number; sample: VideoSample }[];
  /** Each press, as the app would sound it. */
  touches: { t: number; cue: TouchCue }[];
  rate?: number;
  /** Which layers to render (all by default): one alone, to measure the balance. */
  layers?: Partial<Record<'music' | 'ambient' | 'touches' | 'devices', boolean>>;
}

const BPM = 100;
const BEAT = 60 / BPM;
const BAR = BEAT * 4;

/**
 * Levels of the layers, before the final loudness pass (ffmpeg loudnorm);
 * the volumes go through the app's square curve. Balanced by measuring
 * each layer alone (EBU R128): the greenhouse about 8 LU under the music,
 * so the birds, the rain and the crickets are heard; the devices' loudest
 * moments about level with it; the touches, short, over it.
 */
const MIX = { music: 0.45, ambientVolume: 0.88, touchVolume: 0.9, deviceVolume: 0.94 } as const;

/** A seeded random: the same piece every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Cmaj7 · Am7 · Fmaj7 · G6, twice, then F and a C to rest on. */
const CHORDS: { root: number; tones: number[] }[] = [
  { root: 36, tones: [60, 64, 67, 71] },
  { root: 33, tones: [57, 60, 64, 67] },
  { root: 29, tones: [53, 57, 60, 64] },
  { root: 31, tones: [55, 59, 62, 64] },
  { root: 36, tones: [60, 64, 67, 71] },
  { root: 33, tones: [57, 60, 64, 67] },
  { root: 29, tones: [53, 57, 60, 64] },
  { root: 31, tones: [55, 59, 62, 64] },
  { root: 29, tones: [53, 57, 60, 64] },
  { root: 36, tones: [60, 64, 67, 74] },
];

function impulse(context: BaseAudioContext, seconds: number, random: () => number): AudioBuffer {
  const length = Math.ceil(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (random() * 2 - 1) * (1 - i / length) ** 2.6;
    }
  }
  return buffer;
}

/** The piece, on `out`. Drums from the first action (`beatFrom`) until the night (`beatTo`). */
function composeMusic(
  context: BaseAudioContext,
  out: AudioNode,
  seconds: number,
  beatFrom: number,
  beatTo: number,
): void {
  const random = seeded(2026);
  const room = context.createConvolver();
  room.buffer = impulse(context, 1.8, seeded(7));
  const roomSend = context.createGain();
  roomSend.gain.value = 0.28;
  roomSend.connect(room).connect(out);
  let noise: AudioBuffer | null = null;
  const noiseBuffer = () => {
    if (noise) return noise;
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = noise.getChannelData(0);
    const r = seeded(11);
    for (let i = 0; i < data.length; i++) data[i] = r() * 2 - 1;
    return noise;
  };

  const voice = (gain: number, wet = 0) => {
    const node = context.createGain();
    node.gain.value = gain;
    node.connect(out);
    if (wet > 0) {
      const send = context.createGain();
      send.gain.value = wet;
      node.connect(send).connect(roomSend);
    }
    return node;
  };

  // Pad: two detuned triangles, a warm low-pass, slow in and out.
  const pad = (at: number, length: number, midi: number, level: number) => {
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1300;
    filter.Q.value = 0.6;
    const env = context.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(level, at + 0.45);
    env.gain.setValueAtTime(level, at + length - 0.2);
    env.gain.linearRampToValueAtTime(0, at + length + 0.7);
    filter.connect(env).connect(voice(1, 0.6));
    for (const cents of [-7, 7]) {
      const osc = context.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = hz(midi);
      osc.detune.value = cents;
      osc.connect(filter);
      osc.start(at);
      osc.stop(at + length + 0.8);
    }
  };

  // Keys: an electric piano, a sine with its octave, a soft bell decay.
  const key = (at: number, midi: number, level: number) => {
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.3);
    env.connect(voice(1, 0.5));
    const body = context.createOscillator();
    body.frequency.value = hz(midi);
    body.connect(env);
    const bell = context.createOscillator();
    const bellGain = context.createGain();
    bell.frequency.value = hz(midi) * 2;
    bellGain.gain.setValueAtTime(0.32, at);
    bellGain.gain.exponentialRampToValueAtTime(0.01, at + 0.4);
    bell.connect(bellGain).connect(env);
    for (const osc of [body, bell]) {
      osc.start(at);
      osc.stop(at + 1.35);
    }
  };

  // Bass: round, short, with a little of its second harmonic.
  const bass = (at: number, length: number, midi: number) => {
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.24, at + 0.015);
    env.gain.exponentialRampToValueAtTime(0.12, at + 0.25);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    env.connect(voice(1));
    const osc = context.createOscillator();
    osc.frequency.value = hz(midi);
    const second = context.createOscillator();
    const secondGain = context.createGain();
    second.frequency.value = hz(midi) * 2;
    secondGain.gain.value = 0.18;
    osc.connect(env);
    second.connect(secondGain).connect(env);
    for (const o of [osc, second]) {
      o.start(at);
      o.stop(at + length + 0.02);
    }
  };

  const kick = (at: number) => {
    const env = context.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.42, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.32);
    env.connect(voice(1));
    const osc = context.createOscillator();
    osc.frequency.setValueAtTime(115, at);
    osc.frequency.exponentialRampToValueAtTime(46, at + 0.13);
    osc.connect(env);
    osc.start(at);
    osc.stop(at + 0.34);
  };

  const hiss = (
    at: number,
    length: number,
    type: BiquadFilterType,
    freq: number,
    q: number,
    level: number,
  ) => {
    const source = context.createBufferSource();
    source.buffer = noiseBuffer();
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = context.createGain();
    env.gain.setValueAtTime(level, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(env).connect(voice(1, 0.15));
    source.start(at, random() * 0.5);
    source.stop(at + length + 0.01);
  };

  const ARP = [0, 2, 1, 3, 2, 1, 3, 2];
  const bars = Math.ceil(seconds / BAR);
  for (let b = 0; b < bars; b++) {
    const chord = CHORDS[Math.min(b, CHORDS.length - 1)];
    if (!chord) continue;
    const at = b * BAR;
    const last = b === bars - 1;
    const night = at >= beatTo;
    const length = last ? Math.max(0.5, seconds - at - 0.9) : BAR;
    for (const tone of chord.tones) pad(at, length, tone - 12, last ? 0.05 : 0.038);
    // The arpeggio: every eighth by day, sparser at night, a few rests to breathe.
    for (let step = 0; step < 8; step++) {
      const t = at + step * (BEAT / 2);
      if (t >= seconds - 0.4) break;
      if (night && step % 2 === 1) continue;
      if (!night && random() < 0.18) continue;
      const tone = chord.tones[ARP[step] ?? 0] ?? chord.root;
      const swing = step % 2 === 1 ? 0.035 : 0;
      key(t + swing, tone + 12, (step % 4 === 0 ? 0.11 : 0.075) * (0.85 + random() * 0.3));
    }
    // The bass and the beat, once the first thing happens and until the night.
    if (at + BAR > beatFrom && !night && !last) {
      bass(at, BEAT * 1.6, chord.root);
      bass(at + BEAT * 2, BEAT * 1.2, chord.root);
      bass(at + BEAT * 3.5, BEAT * 0.45, chord.root + 7);
      for (let beat = 0; beat < 4; beat++) {
        const t = at + beat * BEAT;
        if (t < beatFrom || t >= beatTo) continue;
        if (beat === 0 || beat === 2) kick(t);
        if (beat === 1 || beat === 3) hiss(t, 0.09, 'bandpass', 1900, 1.4, 0.16);
        for (const half of [0, 0.5]) {
          const h = t + half * BEAT + (half ? 0.035 : 0);
          if (h >= beatFrom + BAR) hiss(h, 0.035, 'highpass', 7200, 0.7, half ? 0.07 : 0.045);
        }
      }
    } else if (night && !last) {
      bass(at, BAR * 0.9, chord.root);
    }
  }
}

const deviceStateOf = (sample: VideoSample): DeviceState | null =>
  sample.actuators ? { live: sample.live, ...sample.actuators } : null;

/** The whole soundtrack, stereo, at `rate`. */
export async function renderSoundtrack(
  input: SoundtrackInput,
): Promise<{ left: Float32Array; right: Float32Array; rate: number }> {
  const rate = input.rate ?? 48_000;
  const { seconds, frames, touches } = input;
  const on = (layer: 'music' | 'ambient' | 'touches' | 'devices') => input.layers?.[layer] ?? true;
  const context = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);

  // The music, its own bus.
  if (on('music')) {
    const music = context.createGain();
    music.gain.value = MIX.music;
    music.connect(context.destination);
    const firstPress = touches[0]?.t ?? 2;
    const night = frames.find((f) => f.sample.mix.night >= 0.6)?.t ?? seconds;
    composeMusic(context, music, seconds, firstPress, Math.min(night, seconds - BAR));
  }

  // The greenhouse: the ambient engine, moved to each frame's mix.
  if (on('ambient')) {
    const engine = new AmbientEngine(context, seeded(99));
    await engine.load();
    await Promise.all(LAYERS.map((layer) => engine.start(layer)));
    await engine.prepareAccents();
    const at = (t: number) => frames.reduce((best, f) => (f.t <= t ? f : best), frames[0] ?? null);
    const first = frames[0];
    if (first) engine.apply(mixFor(first.sample.mix), MIX.ambientVolume, 0.4);
    for (let t = 0.25; t < seconds; t += 0.25) {
      const frame = at(t);
      if (!frame) continue;
      void context.suspend(t).then(() => {
        engine.apply(mixFor(frame.sample.mix), MIX.ambientVolume, 0.6);
        void context.resume();
      });
    }
  }

  // The touches, at each press.
  if (on('touches')) {
    const touch = new TouchSounds(context);
    const wobble = seeded(5);
    for (const press of touches) {
      touch.play(shapeOf(press.cue, wobble() * 2 - 1), MIX.touchVolume, press.t);
    }
  }

  // The devices, whenever the data said they changed.
  if (on('devices')) {
    const deviceLevel = context.createGain();
    deviceLevel.gain.value = MIX.deviceVolume * MIX.deviceVolume;
    deviceLevel.connect(context.destination);
    const devices = new DeviceSounds(context, deviceLevel, seeded(3));
    const gate = createCueGate();
    let before: DeviceState | null = null;
    for (const frame of frames) {
      const now = deviceStateOf(frame.sample);
      if (!now) continue;
      for (const cue of cuesBetween(before, now)) {
        if (gate(cue, frame.t * 1000)) devices.play(cue, frame.t + 0.02);
      }
      before = now;
    }
    devices.play('pump-stop', seconds - 0.05);
  }

  const rendered = await context.startRendering();
  return { left: rendered.getChannelData(0), right: rendered.getChannelData(1), rate };
}
