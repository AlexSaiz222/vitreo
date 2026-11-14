/**
 * The interface's own sounds (D128, D129): a soft key under the finger,
 * made here in Web Audio with nothing to download. A key is a clean, very
 * short tick (its edge) over a round knock that falls in pitch (its body),
 * with a breath of air at the contact; switches and panels add a tint of
 * tune, on one pentatonic scale (any two notes sound well together). The
 * kinds:
 *
 * - hover: the lightest tick (only with a mouse);
 * - press: a key going down;
 * - on / off: the key, then two notes that go up (on) or down (off);
 * - open / close: a softer key, and two notes that rise as a panel opens
 *   and fall as it closes;
 * - scroll: a whisper of paper, spaced out, while a panel scrolls;
 * - step: the tick of a slider moving;
 * - switch: a wall switch, contact and seat (the light's and the fan's
 *   buttons, D131); the device answers with its own sound.
 *
 * Levels measured against the day bed at the default volume: with D129 a
 * press stood about 24 dB over it for its first 10 ms and a hover about
 * 14; D131 raised every one by about 5 dB more, as asked.
 *
 * Pure description here (what to play); `TouchSounds` plays it.
 */
export type TouchCue =
  'hover' | 'press' | 'on' | 'off' | 'open' | 'close' | 'scroll' | 'step' | 'switch';

/**
 * Which cue a press makes, once the control has taken its new state.
 * Switches go up or down: they change at once. A device's button (the
 * light, the fan: `aria-pressed`) clicks like a wall switch; the device
 * itself is heard when the greenhouse answers.
 */
export function pressCue(element: Element): TouchCue {
  const state =
    'checked' in element && element.getAttribute('type') === 'checkbox'
      ? String(element.checked)
      : element.getAttribute('role') === 'switch'
        ? element.getAttribute('aria-checked')
        : null;
  if (state === 'true') return 'on';
  if (state === 'false') return 'off';
  if (element.getAttribute('aria-pressed') !== null) return 'switch';
  return 'press';
}

/** C major pentatonic around middle C (Hz): C4 D4 E4 G4 A4 C5 D5 E5. */
const SCALE = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25] as const;

/** A tone of the tune. */
export interface Note {
  /** Seconds after the cue. */
  at: number;
  hz: number;
  /** Peak gain, before the volume. */
  level: number;
  /** Seconds to fade to silence. */
  decay: number;
}

/** One part of the key: a pitched tone gliding `hz` → `toHz`, or a band of noise around `hz`. */
export interface Hit {
  kind: 'tone' | 'air';
  at: number;
  hz: number;
  /** Where a tone's pitch ends, at its decay. */
  toHz?: number;
  level: number;
  decay: number;
}

export interface CueShape {
  key: Hit[];
  notes: Note[];
}

/** Peak levels (signals near full scale), before the volume. */
export const TOUCH_LEVELS = {
  hover: 0.28,
  press: 0.5,
  panel: 0.32,
  tune: 0.16,
  scroll: 0.18,
  step: 0.2,
  switch: 0.5,
} as const;

/**
 * A key going down at `level`: edge, body and a breath at the contact. The
 * body is pitched where a phone's small speaker still plays it, with its
 * octave over it for presence.
 */
function keyAt(level: number, tune: (hz: number) => number): Hit[] {
  return [
    { kind: 'tone', at: 0, hz: tune(1760), toHz: tune(1560), level: level * 0.42, decay: 0.014 },
    { kind: 'tone', at: 0, hz: tune(340), toHz: tune(200), level, decay: 0.075 },
    { kind: 'tone', at: 0, hz: tune(680), toHz: tune(400), level: level * 0.3, decay: 0.035 },
    { kind: 'air', at: 0, hz: 3600, level: level * 0.22, decay: 0.01 },
  ];
}

/** What a cue sounds like. `wobble` (−1…1) detunes it a hair, so repeats never sound stamped. */
export function shapeOf(cue: TouchCue, wobble = 0): CueShape {
  const tune = (hz: number) => hz * (1 + wobble * 0.012);
  const note = (at: number, step: number, share: number, decay: number): Note => ({
    at,
    hz: tune(SCALE[step] ?? SCALE[0]),
    level: TOUCH_LEVELS.tune * share,
    decay,
  });
  switch (cue) {
    case 'hover':
      return {
        key: [
          {
            kind: 'tone',
            at: 0,
            hz: tune(2350),
            toHz: tune(2200),
            level: TOUCH_LEVELS.hover,
            decay: 0.012,
          },
          {
            kind: 'tone',
            at: 0,
            hz: tune(520),
            toHz: tune(400),
            level: TOUCH_LEVELS.hover * 0.6,
            decay: 0.03,
          },
        ],
        notes: [],
      };
    case 'press':
      return { key: keyAt(TOUCH_LEVELS.press, tune), notes: [] };
    case 'on':
      return {
        key: keyAt(TOUCH_LEVELS.press, tune),
        notes: [note(0.035, 3, 0.8, 0.18), note(0.1, 5, 1, 0.26)],
      };
    case 'off':
      return {
        key: keyAt(TOUCH_LEVELS.press, tune),
        notes: [note(0.035, 4, 0.8, 0.18), note(0.1, 2, 0.9, 0.26)],
      };
    case 'open':
      return {
        key: keyAt(TOUCH_LEVELS.panel, tune),
        notes: [note(0.03, 2, 0.8, 0.3), note(0.11, 4, 1, 0.42)],
      };
    case 'close':
      return {
        key: keyAt(TOUCH_LEVELS.panel, tune),
        notes: [note(0.03, 4, 0.7, 0.24), note(0.1, 1, 0.75, 0.32)],
      };
    case 'switch': {
      // Contact: a bright tick with a small body. Seat, 22 ms later: a
      // lower clack, as the rocker settles.
      const level = TOUCH_LEVELS.switch;
      return {
        key: [
          {
            kind: 'tone',
            at: 0,
            hz: tune(2600),
            toHz: tune(2300),
            level: level * 0.5,
            decay: 0.01,
          },
          { kind: 'tone', at: 0, hz: tune(900), toHz: tune(620), level: level * 0.55, decay: 0.03 },
          { kind: 'air', at: 0, hz: 4200, level: level * 0.25, decay: 0.008 },
          { kind: 'tone', at: 0.022, hz: tune(420), toHz: tune(250), level, decay: 0.06 },
          {
            kind: 'tone',
            at: 0.022,
            hz: tune(1500),
            toHz: tune(1300),
            level: level * 0.3,
            decay: 0.012,
          },
        ],
        notes: [],
      };
    }
    case 'scroll':
      return {
        key: [{ kind: 'air', at: 0, hz: 2200, level: TOUCH_LEVELS.scroll, decay: 0.03 }],
        notes: [],
      };
    case 'step':
      return {
        key: [
          {
            kind: 'tone',
            at: 0,
            hz: tune(1980),
            toHz: tune(1860),
            level: TOUCH_LEVELS.step,
            decay: 0.009,
          },
          {
            kind: 'tone',
            at: 0,
            hz: tune(440),
            toHz: tune(360),
            level: TOUCH_LEVELS.step * 0.5,
            decay: 0.025,
          },
        ],
        notes: [],
      };
  }
}

/** Shortest time between two cues of the same kind (ms): nothing rattles. */
export const COOLDOWN_MS: Record<TouchCue, number> = {
  hover: 70,
  press: 40,
  switch: 60,
  on: 40,
  off: 40,
  open: 250,
  close: 250,
  scroll: 160,
  step: 55,
};

/** Lets a cue through unless the same kind just played. */
export function createTouchGate(): (cue: TouchCue, now: number) => boolean {
  const last = new Map<TouchCue, number>();
  return (cue, now) => {
    const before = last.get(cue);
    if (before !== undefined && now - before < COOLDOWN_MS[cue]) return false;
    last.set(cue, now);
    return true;
  };
}

/** Attack of every part (s): fast enough to click, slow enough not to pop. */
const ATTACK = 0.0015;

/**
 * Plays the cues on its own small audio context (low latency: a tap must be
 * heard under the finger, not after it), through a gentle low-pass that
 * keeps the tick clean and never sharp.
 */
export class TouchSounds {
  private readonly out: GainNode;
  private noise: AudioBuffer | null = null;

  constructor(private readonly context: BaseAudioContext) {
    const lowpass = context.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 7000;
    lowpass.Q.value = 0.5;
    this.out = context.createGain();
    this.out.connect(lowpass).connect(context.destination);
  }

  get running(): boolean {
    return this.context instanceof AudioContext ? this.context.state === 'running' : true;
  }

  async resume(): Promise<void> {
    if (this.context instanceof AudioContext && this.context.state !== 'running') {
      await this.context.resume();
    }
  }

  async close(): Promise<void> {
    if (this.context instanceof AudioContext) await this.context.close();
  }

  play(shape: CueShape, volume: number, at = this.context.currentTime + 0.003): void {
    const scale = volume * volume;
    if (scale <= 0) return;
    for (const hit of shape.key) {
      if (hit.kind === 'tone') this.tone(at + hit.at, hit, scale);
      else this.air(at + hit.at, hit, scale);
    }
    for (const note of shape.notes) this.mallet(at + note.at, note, scale);
  }

  private envelope(at: number, level: number, decay: number): GainNode {
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + ATTACK);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    gain.connect(this.out);
    return gain;
  }

  private tone(at: number, hit: Hit, scale: number): void {
    const source = this.context.createOscillator();
    source.type = 'sine';
    source.frequency.setValueAtTime(hit.hz, at);
    if (hit.toHz) source.frequency.exponentialRampToValueAtTime(hit.toHz, at + hit.decay);
    source.connect(this.envelope(at, hit.level * scale, hit.decay));
    source.start(at);
    source.stop(at + hit.decay + 0.02);
  }

  private air(at: number, hit: Hit, scale: number): void {
    const { context } = this;
    if (!this.noise) {
      const buffer = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.1),
        context.sampleRate,
      );
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const band = context.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = hit.hz;
    band.Q.value = 1.1;
    source.connect(band).connect(this.envelope(at, hit.level * scale, hit.decay));
    source.start(at);
    source.stop(at + hit.decay + 0.01);
  }

  /** A note of the tune: a sine with a softer partial at 4× that dies sooner (wood). */
  private mallet(at: number, note: Note, scale: number): void {
    const { context } = this;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, note.level * scale), at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.decay);
    gain.connect(this.out);
    const body = context.createOscillator();
    body.type = 'sine';
    body.frequency.value = note.hz;
    body.connect(gain);
    const wood = context.createOscillator();
    const woodGain = context.createGain();
    wood.type = 'sine';
    wood.frequency.value = note.hz * 4;
    woodGain.gain.setValueAtTime(0.18, at);
    woodGain.gain.exponentialRampToValueAtTime(0.001, at + note.decay * 0.35);
    wood.connect(woodGain).connect(gain);
    for (const source of [body, wood]) {
      source.start(at);
      source.stop(at + note.decay + 0.02);
    }
  }
}
