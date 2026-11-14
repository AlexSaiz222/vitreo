import {
  fadeCurves,
  roomImpulse,
  softCeiling,
  SPREAD,
  stretchesUntil,
  STRETCH,
  VOICE_GAIN,
} from './bed.ts';
import type { Stretch } from './bed.ts';
import { BIRD_ACCENT, birdGap, DRIP, dripGap, dripHz, nextPhrase } from './accents.ts';
import { FADE_SECONDS, GLASS, LAYERS, LEVELS, ON_DEMAND } from './mix.ts';
import type { Layer, Mix } from './mix.ts';
import loops from './loops.json';

/**
 * The ambient sound (A9, D96; engine of D114) in Web Audio:
 *
 * - each layer plays as two voices, panned apart, each wandering through
 *   its loop in stretches that crossfade (bed.ts): a wide bed that never
 *   repeats the same way;
 * - the outside layers (birds, crickets, wind, rain) through the glass (a
 *   little quieter and less bright, mix.ts); the inside ones (fan, water)
 *   dry plus a short generated room;
 * - one master volume, then a soft ceiling, so nothing ever clips;
 * - at the device's own rate (48 kHz on most): nothing above 12 kHz is lost
 *   any more, where the rain and the water sparkle.
 *
 * Over the bed (D123): a blackbird's phrase now and then, and the gutter
 * dripping after the rain; both drawn at random, never on a beat.
 *
 * The loops are downloaded when sound is turned on, except the rain, the
 * first time it rains (D123); each is decoded only the first time it has to
 * sound (mono, so ≈ 9 MB a 48 s loop), so crickets never take memory on a
 * day visit. Every change is a fade.
 */
const MASTER_FADE_SECONDS = 0.25;
/** How far ahead the stretches are scheduled (s); apply() tops it up every second. */
const LOOKAHEAD_SECONDS = 8;
/** The low-pass with the window open: nothing heard is cut. */
const OPEN_HZ = 20_000;
/**
 * Each voice's level. Outside (stereo recordings): 1/√2, two voices add up
 * to one. Inside (fan, water: mono recordings, A9 played them on both
 * speakers at once): full, to keep the level the mix was tuned for.
 */
const INSIDE_VOICE_GAIN = 1;
/** How much of the inside layers goes to the room. */
const ROOM_SEND = 0.22;
const OUTSIDE: ReadonlySet<Layer> = new Set([
  'birds',
  'crickets',
  'wind',
  'rainLight',
  'rain',
  'rainHeavy',
]);
const MANIFEST: Record<Layer, { seconds: number; pad: number; hash: string }> = loops;
/** A layer that failed to download is not asked for again for this long (s). */
const RETRY_SECONDS = 30;
const { fadeIn, fadeOut } = fadeCurves();

/** Versioned by content, so a new cut of a loop is never served from an old cache. */
export const audioUrl = (layer: Layer) => `/audio/${layer}.ogg?v=${MANIFEST[layer].hash}`;
const BIRD_URL = `/audio/blackbird.ogg?v=${loops.blackbird.hash}`;

/** One voice of a layer: its stretches, one source each, through its panner. */
class Voice {
  private last: Stretch | null = null;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private readonly out: StereoPannerNode;

  constructor(
    private readonly context: BaseAudioContext,
    private readonly buffer: AudioBuffer,
    private readonly loop: { seconds: number; pad: number },
    pan: number,
    destination: AudioNode,
    private readonly random: () => number,
  ) {
    this.out = context.createStereoPanner();
    this.out.pan.value = pan;
    this.out.connect(destination);
  }

  /** Schedules every stretch needed until `until` (audio clock, s). */
  scheduleUntil(until: number): void {
    const now = this.context.currentTime;
    const next = stretchesUntil(this.random, this.loop.seconds, this.last, now + 0.05, until);
    for (const stretch of next) this.play(stretch);
    this.last = next.at(-1) ?? this.last;
  }

  private play({ at, offset, length }: Stretch): void {
    const { context, loop } = this;
    const source = context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = true;
    source.loopStart = loop.pad;
    source.loopEnd = loop.pad + loop.seconds;
    const gain = context.createGain();
    gain.gain.value = 0;
    gain.gain.setValueCurveAtTime(fadeIn, at, STRETCH.fade);
    gain.gain.setValueCurveAtTime(fadeOut, at + length - STRETCH.fade, STRETCH.fade);
    source.connect(gain).connect(this.out);
    source.start(at, loop.pad + offset);
    source.stop(at + length + 0.05);
    this.playing.add(source);
    source.onended = () => {
      this.playing.delete(source);
      gain.disconnect();
    };
  }

  stop(): void {
    for (const source of this.playing) source.stop();
    this.playing.clear();
  }
}

export class AmbientEngine {
  private readonly master: GainNode;
  private readonly outside: GainNode;
  private readonly shelf: BiquadFilterNode;
  private readonly lowpass: BiquadFilterNode;
  private readonly inside: GainNode;
  private readonly gains = new Map<Layer, GainNode>();
  private readonly encoded = new Map<Layer, ArrayBuffer>();
  private readonly voices = new Map<Layer, Voice[]>();
  private readonly decoding = new Set<Layer>();
  private readonly retryAt = new Map<Layer, number>();
  private closed = false;
  private birdEncoded: ArrayBuffer | null = null;
  private birdBuffer: AudioBuffer | null = null;
  private lastPhrase: number | null = null;
  private accents: Mix['accents'] = { bird: 0, drips: 0 };
  /** When the next phrase and the next drop are due (audio clock, s); null: not drawn yet. */
  private nextBird: number | null = null;
  private nextDrip: number | null = null;

  /**
   * `context`: the device's own by default; an OfflineAudioContext renders
   * the mix to a file (to listen to a change before it ships). `random`:
   * where each stretch starts.
   */
  constructor(
    private readonly context: BaseAudioContext = new AudioContext({ latencyHint: 'playback' }),
    private readonly random: () => number = Math.random,
  ) {
    // A soft ceiling, not a compressor (whose built-in make-up gain would
    // make everything louder): untouched below −2 dBFS, rounded above, so
    // the sum never clips.
    const ceiling = context.createWaveShaper();
    ceiling.curve = softCeiling();
    ceiling.oversample = '2x';
    ceiling.connect(context.destination);
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(ceiling);

    // The glass (D114): quieter, a high shelf and a gentle low-pass, eased by mix.glass.
    this.outside = context.createGain();
    this.shelf = context.createBiquadFilter();
    this.shelf.type = 'highshelf';
    this.shelf.frequency.value = GLASS.shelfHz;
    this.lowpass = context.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.Q.value = 0.5;
    this.outside.connect(this.shelf).connect(this.lowpass).connect(this.master);

    // Inside the glass: dry, plus a little of a short room.
    this.inside = context.createGain();
    this.inside.connect(this.master);
    const room = context.createConvolver();
    const [left, right] = roomImpulse(context.sampleRate, random);
    const impulse = context.createBuffer(2, left.length, context.sampleRate);
    impulse.copyToChannel(left, 0);
    impulse.copyToChannel(right, 1);
    room.buffer = impulse;
    const send = context.createGain();
    send.gain.value = ROOM_SEND;
    this.inside.connect(send).connect(room).connect(this.master);

    for (const layer of LAYERS) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(OUTSIDE.has(layer) ? this.outside : this.inside);
      this.gains.set(layer, gain);
    }
  }

  /** Suspended until a tap or a key (browsers ask for a gesture). */
  get running(): boolean {
    return this.context.state === 'running';
  }

  private async fetchLayer(layer: Layer): Promise<ArrayBuffer> {
    const response = await fetch(audioUrl(layer));
    if (!response.ok) throw new Error(`${layer}: ${response.status.toString()}`);
    return response.arrayBuffer();
  }

  /** Downloads the loops of every day and the blackbird (the rain waits for the rain). */
  async load(): Promise<void> {
    const [bird] = await Promise.all([
      fetch(BIRD_URL).then((response) => {
        if (!response.ok) throw new Error(`blackbird: ${response.status.toString()}`);
        return response.arrayBuffer();
      }),
      ...LAYERS.filter((layer) => !ON_DEMAND.has(layer)).map(async (layer) => {
        this.encoded.set(layer, await this.fetchLayer(layer));
      }),
    ]);
    this.birdEncoded = bird;
  }

  /** Decodes the blackbird, the first time it has to sing. */
  async prepareAccents(): Promise<void> {
    const encoded = this.birdEncoded;
    if (this.birdBuffer || !encoded) return;
    this.birdEncoded = null;
    const buffer = await this.context.decodeAudioData(encoded);
    if (!this.closed) this.birdBuffer = buffer;
  }

  /** Downloads (if it has to) and decodes `layer`, and starts its two voices (once). */
  async start(layer: Layer): Promise<void> {
    if (this.voices.has(layer) || this.decoding.has(layer)) return;
    if (!this.encoded.has(layer) && !ON_DEMAND.has(layer)) return;
    if ((this.retryAt.get(layer) ?? 0) > this.context.currentTime) return;
    this.decoding.add(layer);
    try {
      const encoded = this.encoded.get(layer) ?? (await this.fetchLayer(layer));
      const buffer = await this.context.decodeAudioData(encoded);
      if (this.closed) return;
      this.encoded.delete(layer);
      const spread = OUTSIDE.has(layer) ? SPREAD.outside : SPREAD.inside;
      const gain = this.gains.get(layer);
      if (!gain) return;
      const voiceGain = this.context.createGain();
      voiceGain.gain.value = OUTSIDE.has(layer) ? VOICE_GAIN : INSIDE_VOICE_GAIN;
      voiceGain.connect(gain);
      const voices = [-spread, spread].map(
        (pan) => new Voice(this.context, buffer, MANIFEST[layer], pan, voiceGain, this.random),
      );
      this.voices.set(layer, voices);
      for (const voice of voices) voice.scheduleUntil(this.context.currentTime + LOOKAHEAD_SECONDS);
    } catch {
      // No network for the rain, say: the rest keeps sounding; it tries again later.
      this.retryAt.set(layer, this.context.currentTime + RETRY_SECONDS);
    } finally {
      this.decoding.delete(layer);
    }
  }

  /** Schedules every started layer and what sounds on its own until `until` (audio clock, s). */
  scheduleUntil(until: number): void {
    for (const voices of this.voices.values())
      for (const voice of voices) voice.scheduleUntil(until);
    this.scheduleBird(until);
    this.scheduleDrips(until);
  }

  /** A phrase now and then, somewhere to one side, through the glass like the other birds. */
  private scheduleBird(until: number): void {
    const { context } = this;
    if (this.accents.bird <= 0 || !this.birdBuffer) {
      this.nextBird = null;
      return;
    }
    this.nextBird ??= context.currentTime + birdGap(this.random) * this.random();
    const phrases = loops.blackbird.phrases;
    while (this.nextBird < until) {
      const phrase = nextPhrase(this.random, phrases.length, this.lastPhrase);
      this.lastPhrase = phrase;
      const clip = phrases[phrase];
      if (!clip) return;
      const at = Math.max(context.currentTime + 0.02, this.nextBird);
      const source = context.createBufferSource();
      source.buffer = this.birdBuffer;
      const gain = context.createGain();
      gain.gain.value =
        LEVELS.accentBird *
        this.accents.bird *
        (BIRD_ACCENT.quietest + (1 - BIRD_ACCENT.quietest) * this.random());
      const pan = context.createStereoPanner();
      pan.pan.value = (this.random() * 2 - 1) * BIRD_ACCENT.pan;
      source.connect(gain).connect(pan).connect(this.outside);
      source.start(at, clip.at, clip.seconds);
      source.onended = () => {
        pan.disconnect();
      };
      this.nextBird = at + clip.seconds + birdGap(this.random);
    }
  }

  /** The gutter after the rain (D123): each drop, a little rising note, made here. */
  private scheduleDrips(until: number): void {
    const { context } = this;
    if (this.accents.drips <= 0) {
      this.nextDrip = null;
      return;
    }
    this.nextDrip ??= context.currentTime + dripGap(this.random, this.accents.drips);
    while (this.nextDrip < until) {
      const at = Math.max(context.currentTime + 0.02, this.nextDrip);
      const hz = dripHz(this.random);
      const tone = context.createOscillator();
      tone.frequency.setValueAtTime(hz, at);
      tone.frequency.exponentialRampToValueAtTime(hz * DRIP.rise, at + DRIP.seconds);
      const gain = context.createGain();
      const peak = DRIP.peak * (0.4 + 0.6 * this.random());
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(peak, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + DRIP.seconds);
      const pan = context.createStereoPanner();
      pan.pan.value = (this.random() * 2 - 1) * DRIP.pan;
      tone.connect(gain).connect(pan).connect(this.outside);
      tone.start(at);
      tone.stop(at + DRIP.seconds + 0.02);
      tone.onended = () => {
        pan.disconnect();
      };
      this.nextDrip = at + dripGap(this.random, this.accents.drips);
    }
  }

  /**
   * Fades each layer, the glass and the volume toward `mix` and `volume`;
   * `fadeSeconds`, when given, for every layer instead of its own (a start).
   */
  apply(mix: Mix, volume: number, fadeSeconds?: number): void {
    const now = this.context.currentTime;
    for (const layer of LAYERS) {
      const target = mix.gains[layer];
      this.gains.get(layer)?.gain.setTargetAtTime(target, now, fadeSeconds ?? FADE_SECONDS[layer]);
      // A layer that has to sound is decoded now; it fades in from silence.
      if (target > 0) void this.start(layer);
    }
    this.accents = mix.accents;
    if (mix.accents.bird > 0) void this.prepareAccents();
    this.scheduleUntil(now + LOOKAHEAD_SECONDS);
    const glass = Math.min(1, Math.max(0, mix.glass));
    const glassFade = fadeSeconds ?? 2;
    this.outside.gain.setTargetAtTime(10 ** ((GLASS.levelDb * glass) / 20), now, glassFade);
    this.shelf.gain.setTargetAtTime(GLASS.shelfDb * glass, now, glassFade);
    // Geometric, so the change of brightness sounds even.
    this.lowpass.frequency.setTargetAtTime(
      OPEN_HZ * (GLASS.lowpassHz / OPEN_HZ) ** glass,
      now,
      glassFade,
    );
    // A gentle curve: the slider's middle sounds like the middle.
    this.master.gain.setTargetAtTime(volume * volume, now, MASTER_FADE_SECONDS);
  }

  async resume(): Promise<void> {
    if (
      !this.closed &&
      this.context instanceof AudioContext &&
      this.context.state === 'suspended'
    ) {
      await this.context.resume();
    }
  }

  /** Fades out and pauses (the app went to the background). */
  async pause(): Promise<void> {
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.08);
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (!this.closed && this.context instanceof AudioContext && this.context.state === 'running') {
      await this.context.suspend();
    }
  }

  /** Fades out, then frees everything (sound turned off). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.master.gain.setTargetAtTime(0, this.context.currentTime, 0.15);
    await new Promise((resolve) => setTimeout(resolve, 600));
    for (const voices of this.voices.values()) for (const voice of voices) voice.stop();
    this.voices.clear();
    this.encoded.clear();
    if (this.context instanceof AudioContext) await this.context.close();
  }
}
