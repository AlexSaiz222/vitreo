// Ambient sound loops (A9, D96, D123): free recordings (CC0 or public domain)
// cut into seamless loops. Run with `pnpm audio`.
//
//   1. Downloads each recording into assets/audio/.cache/ (not in git): the
//      original from Wikimedia Commons or the Internet Archive where a good
//      one exists; Freesound's high-quality preview for the rest (Freesound's
//      originals need an account).
//   2. Picks the steadiest stretch: the window whose loudness varies least
//      (no door, no voice, no single loud bird), away from the ends.
//   3. Makes it loop without a seam: the stretch is taken a little longer
//      and its tail is crossfaded into its head (equal power: these are
//      noisy, uncorrelated sounds), so the last sample leads into the first.
//   4. Sets each loop's loudness (EBU R128, integrated LUFS, measured by
//      ffmpeg) to the one the A9 mix was tuned for, so a better cut never
//      changes the balance; true peak never above −1 dBTP.
//   5. Pads the loop with a quarter second of itself on each side: Opus is
//      least exact at the very start and end of a stream, so the player
//      loops only the inner part (loopStart/loopEnd) and never plays them.
//   6. Encodes mono Opus in OGG at 48 kHz into apps/web/public/audio/ (Git
//      LFS), and writes features/sound/loops.json (length and padding of
//      each). Mono on purpose: the engine plays two voices of each loop at
//      different points, panned apart, which makes a wide stereo bed that
//      never repeats the same way (D114).
//
// Licences: every source is CC0 1.0, checked on its page; the table is in
// docs/02-direccion-artistica.md. Changing a source means updating it.
//
// The blackbird is not a loop: its loudest separate phrases, each evened out
// and laid end to end in one file, for the engine to play one now and then.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import ffmpeg from 'ffmpeg-static';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CACHE = path.join(ROOT, 'assets/audio/.cache');
const OUT = path.join(ROOT, 'apps/web/public/audio');
const RATE = 48_000;
/** Seconds of the loop's own continuation on each side (never played). */
const PAD = 0.25;
const MANIFEST = path.join(ROOT, 'apps/web/src/features/sound/loops.json');
/** Wikimedia asks every script to say who it is. */
const USER_AGENT = 'VitreoAudioBuild/1.0 (personal greenhouse project; https://vitreo-demo.vercel.app)';

/**
 * name → source and how to cut it. Seconds; kbps for Opus (mono); `lufs`,
 * the loudness of each loop as the A9 mix was tuned (measured on the
 * 2026-10-13 loops): a new cut keeps it, so only the sound gets better.
 * Long loops (D114): the engine wanders through them, so the longer, the
 * less anything repeats; each is as long as its recording allows, up to 48 s.
 */
export const SOURCES = [
  // A German forest on a summer evening: separate birds with air between them
  // ("distant, spaced": docs/02). A dawn chorus measured as a solid wall.
  {
    name: 'birds',
    page: 'https://commons.wikimedia.org/wiki/File:Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg',
    url: 'https://upload.wikimedia.org/wikipedia/commons/6/65/Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg',
    range: [15, 190],
    seconds: 96,
    crossfade: 4,
    kbps: 64,
    lufs: -17.1,
  },
  {
    name: 'crickets',
    page: 'https://freesound.org/people/Defelozedd94/sounds/522299/',
    url: 'https://cdn.freesound.org/previews/522/522299_9084007-hq.ogg',
    seconds: 48,
    crossfade: 3,
    kbps: 56,
    lufs: -21.3,
  },
  {
    name: 'wind',
    page: 'https://freesound.org/people/mario1298/sounds/181252/',
    url: 'https://cdn.freesound.org/previews/181/181252_499617-hq.ogg',
    seconds: 48,
    crossfade: 4,
    kbps: 48,
    lufs: -24.1,
  },
  // A small burn through a wood, the lossless original.
  {
    name: 'water',
    page: 'https://commons.wikimedia.org/wiki/File:363120_fractalstudios_water-trickle.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/363120_fractalstudios_water-trickle.wav',
    seconds: 24,
    crossfade: 2,
    kbps: 64,
    lufs: -24.3,
  },
  {
    name: 'fan',
    page: 'https://freesound.org/people/edhutschek/sounds/219247/',
    url: 'https://cdn.freesound.org/previews/219/219247_2444153-hq.ogg',
    seconds: 10,
    crossfade: 1.5,
    kbps: 40,
    lufs: -24.3,
  },
  // Rain (A10, D97, D123): only when the data says it rains. Three weights
  // that the mix crosses by how hard it rains, all at one loudness.
  // A drizzle: the long tail of a 24-minute shower, once the first burst is over.
  {
    name: 'rainLight',
    page: 'https://archive.org/details/soundica-fs-430765-long-easy-rain-08-wav',
    url: 'https://archive.org/download/soundica-fs-430765-long-easy-rain-08-wav/430765.mp3',
    range: [300, 1400],
    seconds: 48,
    crossfade: 3,
    kbps: 64,
    lufs: -26.5,
  },
  // Steady rain in deep woods, the lossless 48 kHz original. High-passed: its
  // far-off thunder is rumble, and here there are no storms (D96).
  {
    name: 'rain',
    page: 'https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav',
    url: 'https://upload.wikimedia.org/wikipedia/commons/b/b6/Light_Rain_Distant_Thunder_July_5th_2016.wav',
    range: [12, 108],
    highpass: 140,
    seconds: 48,
    crossfade: 3,
    kbps: 80,
    lufs: -26.5,
  },
  // A downpour: the first minutes of a monsoon shower.
  {
    name: 'rainHeavy',
    page: 'https://archive.org/details/soundica-fs-812780-rain-in-the-vietnam',
    url: 'https://archive.org/download/soundica-fs-812780-rain-in-the-vietnam/812780__ltruong267__rain-in-the-vietnam.m4a',
    range: [10, 290],
    seconds: 48,
    crossfade: 3,
    kbps: 80,
    lufs: -26.5,
  },
  // Rain on a window from the inside, close: what you hear next to the glass.
  // One channel: its two microphones, summed, cancel each other in stripes.
  {
    name: 'rainGlass',
    page: 'https://freesound.org/people/supersnd/sounds/592345/',
    url: 'https://cdn.freesound.org/previews/592/592345_3877322-hq.ogg',
    leftOnly: true,
    seconds: 28,
    crossfade: 3,
    kbps: 80,
    lufs: -26.5,
  },
];

/** A blackbird, phrase by phrase: heard now and then, on its own (D123). */
export const PHRASES = {
  name: 'blackbird',
  page: 'https://commons.wikimedia.org/wiki/File:%D0%A7%D0%BE%D1%80%D0%BD%D0%B8%D0%B9_%D0%B4%D1%80%D1%96%D0%B7%D0%B4.ogg',
  url: 'https://upload.wikimedia.org/wikipedia/commons/b/b1/%D0%A7%D0%BE%D1%80%D0%BD%D0%B8%D0%B9_%D0%B4%D1%80%D1%96%D0%B7%D0%B4.ogg',
  count: 8,
  /** Its song is all above this (Hz); below is a helicopter far away. */
  highpass: 1000,
  /** A phrase is at most this far below the loudest block (dB) … */
  belowPeakDb: 24,
  /** … lasts this long (s) … */
  minSeconds: 1.4,
  maxSeconds: 6,
  /** … and silences shorter than this (s) do not end it. */
  gapSeconds: 0.3,
  lufs: -20,
  kbps: 64,
};

/** The loudest a loop's true peak may be (dBTP). */
const MAX_TRUE_PEAK = -1;

function run(args, input) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    input,
    maxBuffer: 1 << 30,
  });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

/** Decodes to mono float32 at 48 kHz: all of it or `range` (s), both channels or the left, maybe high-passed. */
function decode(file, { range, leftOnly = false, highpass } = {}) {
  const seek = range ? ['-ss', String(range[0]), '-t', String(range[1] - range[0])] : [];
  const filters = [...(leftOnly ? ['pan=mono|c0=c0'] : []), ...(highpass ? [`highpass=f=${highpass.toString()}`] : [])];
  const mono = [...(leftOnly ? [] : ['-ac', '1']), ...(filters.length ? ['-af', filters.join(',')] : [])];
  const raw = run([...seek, '-i', file, '-f', 'f32le', ...mono, '-ar', String(RATE), '-']);
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** Integrated loudness (LUFS) and true peak (dBTP) of mono PCM, by ffmpeg's EBU R128 meter. */
function measure(pcm) {
  const result = spawnSync(
    ffmpeg,
    ['-hide_banner', '-nostats', '-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-',
      '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { input: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), maxBuffer: 1 << 30 },
  );
  // Only the summary: every frame logs its own momentary values before it.
  const log = result.stderr.toString().split('Summary:').pop() ?? '';
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(log)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(log)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`no loudness: ${log}`);
  return { lufs, peak };
}

/** RMS of each half second. */
function loudness(pcm) {
  const block = RATE / 2;
  const out = [];
  for (let i = 0; i + block <= pcm.length; i += block) {
    let sum = 0;
    for (let j = i; j < i + block; j++) sum += pcm[j] * pcm[j];
    out.push(Math.sqrt(sum / block));
  }
  return out;
}

/** Start (s) of the steadiest window of `length` s, at least 2 s from the ends. */
function steadiest(levels, length) {
  const blocks = Math.ceil(length * 2);
  let best = { start: 4, score: Infinity };
  for (let i = 4; i + blocks <= levels.length - 4; i++) {
    const window = levels.slice(i, i + blocks);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    if (mean < 1e-3) continue;
    const peak = Math.max(...window);
    const spread = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / window.length);
    // Spikes weigh most: one sudden sound is worse than a gentle swell.
    const score = peak / mean + (2 * spread) / mean;
    if (score < best.score) best = { start: i / 2, score };
  }
  return best;
}

/** `gainDb` louder, through ffmpeg's limiter (fast attack, slow release) below the peak limit. */
function limit(pcm, gainDb) {
  const ceiling = 10 ** ((MAX_TRUE_PEAK - 0.5) / 20);
  const raw = run(
    ['-f', 'f32le', '-ar', String(RATE), '-ac', '1', '-i', '-',
      '-af', `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${ceiling.toFixed(4)}:attack=2:release=120:level=disabled`,
      '-f', 'f32le', '-'],
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
  );
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice(0, pcm.length);
}

/** The loop: `seconds` long, its head crossfaded with the following tail, at `lufs`. */
function loop(pcm, start, seconds, crossfade, lufs) {
  const frames = Math.round(seconds * RATE);
  const fade = Math.round(crossfade * RATE);
  const from = Math.round(start * RATE);
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const head = pcm[from + f];
    if (f < fade) {
      // Equal power: sin/cos keep the loudness steady through the seam.
      const t = (f + 0.5) / fade;
      const tail = pcm[from + frames + f];
      out[f] = head * Math.sin((t * Math.PI) / 2) + tail * Math.cos((t * Math.PI) / 2);
    } else {
      out[f] = head;
    }
  }
  // To the mix's loudness. A loop whose peaks would pass the limit there (a
  // single loud bird call) goes through a gentle limiter first, instead of
  // being left quieter than the mix expects.
  let level = out;
  let measured = measure(level);
  if (measured.peak + (lufs - measured.lufs) > MAX_TRUE_PEAK) {
    level = limit(level, lufs - measured.lufs);
    measured = measure(level);
  }
  const gainDb = Math.min(lufs - measured.lufs, MAX_TRUE_PEAK - measured.peak);
  const gain = 10 ** (gainDb / 20);
  for (let i = 0; i < level.length; i++) out[i] = level[i] * gain;
  // [end of loop] + loop + [start of loop]: it wraps the same way it plays.
  const pad = Math.round(PAD * RATE);
  const padded = new Float32Array(out.length + 2 * pad);
  padded.set(out.subarray(out.length - pad), 0);
  padded.set(out, pad);
  padded.set(out.subarray(0, pad), pad + out.length);
  return { pcm: padded, lufs: measured.lufs + gainDb, peak: measured.peak + gainDb };
}

/** Each download is cached under its URL: a new source is never read from an old file. */
async function fetchSource(source) {
  const key = createHash('sha256').update(source.url).digest('hex').slice(0, 8);
  const cached = path.join(CACHE, `${source.name}-${key}`);
  if (!existsSync(cached)) {
    const response = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT } });
    if (!response.ok) throw new Error(`${source.name}: ${response.status.toString()}`);
    writeFileSync(cached, Buffer.from(await response.arrayBuffer()));
  }
  return cached;
}

/** Mono Opus in OGG at 48 kHz; returns the content's hash. */
function encode(pcm, file, kbps) {
  run(
    [
      '-y',
      '-f',
      'f32le',
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-i',
      '-',
      '-c:a',
      'libopus',
      '-b:a',
      `${kbps.toString()}k`,
      '-application',
      'audio',
      '-map_metadata',
      '-1',
      // The same bytes on every run (Ogg would pick a random stream serial):
      // a loop's hash changes only when its sound does.
      '-fflags',
      '+bitexact',
      file,
    ],
    Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
  );
  // The app asks for ?v=<hash>, so a new cut is never served from an old cache.
  return createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
}

/** Every phrase, in samples: runs of sound with their short silences bridged. */
function findPhrases(pcm, { belowPeakDb, minSeconds, maxSeconds, gapSeconds }) {
  const block = Math.round(RATE * 0.02);
  const levels = [];
  for (let i = 0; i + block <= pcm.length; i += block) {
    let sum = 0;
    for (let j = i; j < i + block; j++) sum += pcm[j] * pcm[j];
    levels.push(Math.sqrt(sum / block));
  }
  const threshold = Math.max(...levels) * 10 ** (-belowPeakDb / 20);
  const gapBlocks = Math.round(gapSeconds / 0.02);
  const runs = [];
  let from = -1;
  let last = -1;
  levels.forEach((level, i) => {
    if (level < threshold) return;
    if (from >= 0 && i - last > gapBlocks) {
      runs.push([from, last + 1]);
      from = i;
    }
    if (from < 0) from = i;
    last = i;
  });
  if (from >= 0) runs.push([from, last + 1]);
  return runs
    .map(([a, b]) => ({
      start: a * block,
      end: b * block,
      loudest: Math.max(...levels.slice(a, b)),
    }))
    .filter(({ start, end }) => {
      const seconds = (end - start) / RATE;
      return seconds >= minSeconds && seconds <= maxSeconds;
    });
}

/** The blackbird: its loudest phrases, each evened out, one after another in a single file. */
async function buildPhrases(spec) {
  const pcm = decode(await fetchSource(spec), spec);
  const found = findPhrases(pcm, spec);
  if (found.length < spec.count) {
    throw new Error(`${spec.name}: only ${found.length.toString()} phrases`);
  }
  // The loudest are the nearest and cleanest; kept in the recording's order.
  const chosen = [...found]
    .sort((a, b) => b.loudest - a.loudest)
    .slice(0, spec.count)
    .sort((a, b) => a.start - b.start);
  const lead = Math.round(RATE * 0.04);
  const tail = Math.round(RATE * 0.15);
  const gap = Math.round(RATE * 0.3);
  const pieces = chosen.map(({ start, end }) => {
    const piece = pcm.slice(Math.max(0, start - lead), Math.min(pcm.length, end + tail));
    for (let i = 0; i < lead; i++) piece[i] *= i / lead;
    for (let i = 0; i < tail; i++) piece[piece.length - 1 - i] *= i / tail;
    const { lufs, peak } = measure(piece);
    const gain = 10 ** (Math.min(spec.lufs - lufs, MAX_TRUE_PEAK - peak) / 20);
    return piece.map((x) => x * gain);
  });
  const total = pieces.reduce((sum, piece) => sum + piece.length + gap, gap);
  const sprite = new Float32Array(total);
  const phrases = [];
  let at = gap;
  for (const piece of pieces) {
    sprite.set(piece, at);
    phrases.push({
      at: Number((at / RATE).toFixed(3)),
      seconds: Number((piece.length / RATE).toFixed(3)),
    });
    at += piece.length + gap;
  }
  const file = path.join(OUT, `${spec.name}.ogg`);
  const hash = encode(sprite, file, spec.kbps);
  console.log(
    `${spec.name.padEnd(9)} ${phrases.length.toString()} of ${found.length.toString()} phrases, ${(total / RATE).toFixed(1)} s → ${Math.round(statSync(file).size / 1000).toString()} KB`,
  );
  return { phrases, hash, page: spec.page };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const source of SOURCES) {
    const pcm = decode(await fetchSource(source), source);
    const levels = loudness(pcm);
    const length = source.seconds + source.crossfade;
    if (length + 4 > pcm.length / RATE) throw new Error(`${source.name}: recording too short`);
    const { start, score } = steadiest(levels, length);
    const cut = loop(pcm, start, source.seconds, source.crossfade, source.lufs);
    const file = path.join(OUT, `${source.name}.ogg`);
    const hash = encode(cut.pcm, file, source.kbps);
    manifest[source.name] = { seconds: source.seconds, pad: PAD, hash, page: source.page };
    const from = start + (source.range?.[0] ?? 0);
    console.log(
      `${source.name.padEnd(9)} ${source.seconds.toString()} s from ${from.toFixed(1)} s (steadiness ${score.toFixed(2)}), ${cut.lufs.toFixed(1)} LUFS, ${cut.peak.toFixed(1)} dBTP → ${Math.round(statSync(file).size / 1000).toString()} KB`,
    );
  }
  manifest[PHRASES.name] = await buildPhrases(PHRASES);
  mkdirSync(path.dirname(MANIFEST), { recursive: true });
  writeFileSync(
    MANIFEST,
    `${JSON.stringify(manifest, null, 2)}
`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) await main();
