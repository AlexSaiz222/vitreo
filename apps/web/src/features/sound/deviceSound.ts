import type { DeviceCue } from './deviceCues.ts';

/**
 * What the devices sound like (D121): made here, in Web Audio, with nothing to
 * download. D78 turned down synthesis for birds, which sound false; a small
 * motor or a relay is simple machinery. When there are recordings of the real
 * greenhouse (phase 3) they can replace these one by one.
 *
 * Levels are peak gains on signals near full scale, so it is easy to compare
 * them with the bed in an offline render. D121 played them under the bed;
 * D131 raised them so that they are heard over it (the fan 12 dB, the
 * window and the relay 15, the pump 3), and gave them their own switch and
 * audio context, with or without the ambient sound. Measured against the
 * day bed at the default volume, over their loudest 200 ms: the fan about
 * 12 dB over it, the window 10, the pump 12; the relay's click, about 19
 * over it for its 10 ms.
 */
export const DEVICE_LEVELS = { pump: 0.07, relay: 0.64, fan: 0.55, window: 0.28 } as const;

const NOISE_SECONDS = 2;

/** Each engine's own noise, made once: every whoosh and click starts from it. */
function noiseBuffer(context: BaseAudioContext, random: () => number): AudioBuffer {
  const buffer = context.createBuffer(1, NOISE_SECONDS * context.sampleRate, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
  return buffer;
}

export class DeviceSounds {
  private readonly noise: AudioBuffer;
  /** The pump, while it runs: it hums until the data says it stopped. */
  private pump: { stop: (at: number) => void } | null = null;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly out: AudioNode,
    private readonly random: () => number,
  ) {
    this.noise = noiseBuffer(context, random);
  }

  play(cue: DeviceCue, at = this.context.currentTime + 0.01): void {
    if (cue === 'pump-start') this.pumpStart(at);
    else if (cue === 'pump-stop') this.pumpStop(at);
    else if (cue === 'relay') this.relay(at);
    else if (cue === 'fan-up') this.fanSweep(at, true);
    else if (cue === 'fan-down') this.fanSweep(at, false);
    else this.window(at, cue.seconds);
  }

  /** The pump stops at once with the sound off or the app closing. */
  silence(at = this.context.currentTime): void {
    this.pumpStop(at);
  }

  private noiseSource(at: number, seconds: number): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    source.start(at, this.random() * NOISE_SECONDS);
    source.stop(at + seconds);
    return source;
  }

  private filter(type: BiquadFilterType, hz: number, q = 0.8): BiquadFilterNode {
    const node = this.context.createBiquadFilter();
    node.type = type;
    node.frequency.value = hz;
    node.Q.value = q;
    return node;
  }

  /** A small DC pump: a low hum with its overtones, that spins up and winds down. */
  private pumpStart(at: number): void {
    if (this.pump) return;
    const { context } = this;
    const SPIN_UP = 0.28;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(DEVICE_LEVELS.pump, at + SPIN_UP);
    const body = this.filter('lowpass', 520, 0.7);
    body.connect(gain).connect(this.out);
    const motor = context.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(58, at);
    motor.frequency.exponentialRampToValueAtTime(96, at + SPIN_UP);
    motor.connect(body);
    // A fifth above and a little off: real motors are never one clean tone.
    const second = context.createOscillator();
    const secondGain = context.createGain();
    second.type = 'triangle';
    second.frequency.setValueAtTime(90, at);
    second.frequency.exponentialRampToValueAtTime(146, at + SPIN_UP);
    secondGain.gain.value = 0.5;
    second.connect(secondGain).connect(body);
    // Water going through it.
    const rush = context.createBufferSource();
    rush.buffer = this.noise;
    rush.loop = true;
    const rushGain = context.createGain();
    rushGain.gain.value = 0.22;
    rush
      .connect(this.filter('bandpass', 900, 0.6))
      .connect(rushGain)
      .connect(gain);
    motor.start(at);
    second.start(at);
    rush.start(at, this.random() * NOISE_SECONDS);
    this.pump = {
      stop: (when) => {
        const WIND_DOWN = 0.4;
        gain.gain.cancelScheduledValues(when);
        gain.gain.setValueAtTime(DEVICE_LEVELS.pump, when);
        gain.gain.linearRampToValueAtTime(0, when + WIND_DOWN);
        motor.frequency.setValueAtTime(96, when);
        motor.frequency.exponentialRampToValueAtTime(46, when + WIND_DOWN);
        second.frequency.setValueAtTime(146, when);
        second.frequency.exponentialRampToValueAtTime(70, when + WIND_DOWN);
        for (const source of [motor, second, rush]) source.stop(when + WIND_DOWN + 0.05);
      },
    };
  }

  private pumpStop(at: number): void {
    this.pump?.stop(at);
    this.pump = null;
  }

  /** A relay: two tiny ticks, contact and bounce, a touch of body under them. */
  private relay(at: number): void {
    const tick = (when: number, level: number) => {
      const gain = this.context.createGain();
      gain.gain.setValueAtTime(level, when);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.012);
      this.noiseSource(when, 0.015)
        .connect(this.filter('bandpass', 3200, 1.1))
        .connect(gain)
        .connect(this.out);
    };
    tick(at, DEVICE_LEVELS.relay);
    tick(at + 0.009, DEVICE_LEVELS.relay * 0.35);
    const thump = this.context.createOscillator();
    const thumpGain = this.context.createGain();
    thump.frequency.setValueAtTime(190, at);
    thump.frequency.exponentialRampToValueAtTime(90, at + 0.03);
    thumpGain.gain.setValueAtTime(DEVICE_LEVELS.relay * 0.35, at);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.035);
    thump.connect(thumpGain).connect(this.out);
    thump.start(at);
    thump.stop(at + 0.04);
  }

  /** Air through the blades as they pick up or lose speed; the bed's fan does the rest. */
  private fanSweep(at: number, up: boolean): void {
    const SECONDS = up ? 1.5 : 2;
    const low = 170;
    const high = 720;
    const band = this.filter('bandpass', up ? low : high, 1.2);
    band.frequency.setValueAtTime(up ? low : high, at);
    band.frequency.exponentialRampToValueAtTime(up ? high : low, at + SECONDS);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(DEVICE_LEVELS.fan, at + SECONDS * 0.35);
    gain.gain.linearRampToValueAtTime(0, at + SECONDS);
    this.noiseSource(at, SECONDS).connect(band).connect(gain).connect(this.out);
  }

  /** The window's servo: a small geared whine with a flutter, for as long as it travels. */
  private window(at: number, seconds: number): void {
    const { context } = this;
    const EDGE = Math.min(0.08, seconds / 4);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(DEVICE_LEVELS.window, at + EDGE);
    gain.gain.setValueAtTime(DEVICE_LEVELS.window, at + seconds - EDGE);
    gain.gain.linearRampToValueAtTime(0, at + seconds);
    const band = this.filter('bandpass', 1050, 2.2);
    band.connect(gain).connect(this.out);
    const whine = context.createOscillator();
    whine.type = 'sawtooth';
    // The load changes as it travels: the pitch sags and recovers a little.
    whine.frequency.setValueAtTime(205, at);
    whine.frequency.linearRampToValueAtTime(186, at + seconds * 0.55);
    whine.frequency.linearRampToValueAtTime(214, at + seconds);
    const flutterDepth = context.createGain();
    flutterDepth.gain.value = 0.3;
    const flutter = context.createOscillator();
    flutter.frequency.value = 31;
    const tremolo = context.createGain();
    tremolo.gain.value = 0.7;
    flutter.connect(flutterDepth).connect(tremolo.gain);
    whine.connect(tremolo).connect(band);
    whine.start(at);
    flutter.start(at);
    whine.stop(at + seconds + 0.02);
    flutter.stop(at + seconds + 0.02);
  }
}
