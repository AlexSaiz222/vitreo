// The landing video (D130, D132): a camera flight through the REAL demo
// (vite --mode demo, development only: `?video` turns on app/videoMode.ts)
// and what you can do in it, captured frame by frame at 30 fps on a clock
// Playwright fakes, so every run has the same camera, timing and interface.
// The soundtrack is rendered in the page from what happened (the app's own
// ambient, touches and devices, and a piece composed in code); then ffmpeg
// makes the MP4s.
//
//   pnpm video:landing               the whole video (and the version with the closing card)
//   pnpm video:landing --test        only a few frames at the key moments, to look at first
//   pnpm video:landing --audio-only  the soundtrack again, over the frames already recorded
//
// It starts `pnpm demo:dev` (port 5190) if nothing answers there. Frames go
// to video/frames/ (ignored by git), the videos to video/.
/* global window, document -- inside page.evaluate, which runs in the page */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  easeInOut,
  ensureServer,
  key,
  launchBrowser,
  lerp3,
  newVisitorContext,
  openVisit,
  pathThrough,
  runFfmpeg,
  stopServer,
} from './demoDriver.mjs';

const OUT = path.join(ROOT, 'video');
const FRAMES = path.join(OUT, 'frames');
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const TEST = process.argv.includes('--test');
const AUDIO_ONLY = process.argv.includes('--audio-only');
const TEST_AT = [3.6, 7.0, 9.8, 12.6, 20.5];

/**
 * The visit: 16:44 in Madrid in mid-November, the grow light still off. At
 * an hour a minute the actions fill the afternoon; then "Ver un día en un
 * minuto" takes it through the sunset (≈ 18:04) to the night.
 */
const START = Date.parse('2026-11-12T15:44:00Z');
const SECONDS = 24;

/** When each thing happens (s). */
const T = {
  light: 2.4,
  air: 4.9,
  fan: 5.5,
  window: 6.3,
  airAway: 7.4,
  bar: 7.7,
  situations: 8.1,
  rain: 8.5,
  barFold: 9.4,
  water: 10.5,
  basil: 11.0,
  waterNow: 11.8,
  scrollFrom: 12.3,
  scrollTo: 13.4,
  range: 13.7,
  closeSheet: 14.6,
  takeOver: 14.8,
  barAgain: 15.1,
  speed: 15.5,
  barAway: 16.3,
  card: 22.0,
};

// ─────────────────────────────────────────────────── the browser

await ensureServer();
const browser = await launchBrowser();
// Silent in the page: the soundtrack is rendered apart, from what happened.
// Day and night follow the sun: the night comes on its own.
const context = await newVisitorContext(browser, { width: WIDTH, height: HEIGHT });
const started = performance.now();
/** What happened, saved with the frames: `--audio-only` makes the soundtrack again from it. */
const RECORDED = path.join(FRAMES, 'recorded.json');
const recorded = AUDIO_ONLY ? JSON.parse(readFileSync(RECORDED, 'utf8')) : await capture();
if (!AUDIO_ONLY) writeFileSync(RECORDED, JSON.stringify(recorded));
const { samples, touches } = recorded;

/** The visit, frame by frame: the frames on disk, and what happened at each. */
async function capture() {
  // Loading on the faked clock until the scene, the live readings and the hub are there.
  const visit = await openVisit(context, { start: START });
  const { page, advance, home, focus, centre, at } = visit;
  // The scene switches the light ON: it starts off (the automation may have
  // lit it in the afternoon light; a manual switch holds until daylight changes).
  const lightButton = page.getByRole('button', { name: /^Luz/ });
  if ((await lightButton.getAttribute('aria-pressed')) === 'true') {
    await lightButton.dispatchEvent('click');
    for (let i = 0; i < 20; i++) await advance(100);
  }

  const basil = await focus('basil_01');
  const tomato = await focus('tomato_01');
  const lamp = (await centre('grow_light')) ?? tomato;
  const fan = (await centre('fan')) ?? home.target;
  const vent = (await centre('vent_window')) ?? home.target;
  const plants = lerp3(basil, tomato, 0.5);

  // 0–2.4 s: in, turning. The light comes on over the pots; Aire: the fan and
  // the roof window, framed between them; out a little to see the rain come
  // and the window close; in again towards the plants.
  const flight = pathThrough([
    key(0, at(-0.62, 0.08, 0.86)),
    key(2.2, at(-0.28, 0.03, 1.3, lerp3(home.target, plants, 0.5))),
    key(4.4, at(-0.05, -0.02, 1.75, lerp3(plants, lamp, 0.55))),
    key(6.4, at(0.22, -0.04, 1.65, lerp3(fan, vent, 0.5))),
    key(8.6, at(0.3, 0.0, 1.2, lerp3(home.target, vent, 0.4))),
    key(10.4, at(0.18, 0.03, 1.35, lerp3(home.target, plants, 0.6))),
    key(T.basil, at(0.12, 0.04, 1.45, lerp3(plants, basil, 0.4))),
  ]);

  // ─────────────────────────────────────────────────── the visit, frame by frame

  let finale = null;
  let scrollStart = null;
  /** Each press, for the soundtrack: what the app plays for it. */
  const touches = [];
  const pressed = (t, cue) => touches.push({ t, cue });
  const click = async (locator, t, cue = 'press') => {
    await locator.dispatchEvent('click');
    if (cue) pressed(t, cue);
  };

  /** What happens at this instant, in the real interface. */
  async function interface_(t, last) {
    const once = (when) => t >= when && last < when;
    if (once(T.light)) await click(lightButton, t, 'switch');
    if (once(T.air)) await click(page.getByRole('button', { name: 'Aire', exact: true }), t);
    if (once(T.fan))
      await click(page.locator('.dock-popover').getByRole('button').first(), t, 'switch');
    if (once(T.window))
      await click(page.locator('.dock-popover').getByRole('radio', { name: 'Abierta' }), t);
    if (once(T.airAway)) await page.keyboard.press('Escape');
    if (once(T.water)) await click(page.getByRole('button', { name: 'Regar', exact: true }), t);
    if (once(T.basil)) {
      // The app's own move to the plant: the camera is handed back to it.
      await page.evaluate(() => window.__vitreo.setPose(null));
      await click(page.locator('.menu-row[data-zone="basil_01"]'), t, 'open');
    }
    if (once(T.waterNow)) await click(page.locator('.ui-sheet .primary-button'), t);
    if (t >= T.scrollFrom && t <= T.scrollTo + 0.05) {
      // The sheet down to its history, smoothly.
      scrollStart ??= await page.evaluate(() => {
        const sheet = document.querySelector('.ui-sheet');
        const goal = sheet?.querySelector('.history');
        const top = goal
          ? goal.getBoundingClientRect().top -
            sheet.getBoundingClientRect().top +
            sheet.scrollTop -
            24
          : sheet.scrollHeight;
        return {
          from: sheet.scrollTop,
          to: Math.min(top, sheet.scrollHeight - sheet.clientHeight),
        };
      });
      const s = easeInOut(Math.min(1, (t - T.scrollFrom) / (T.scrollTo - T.scrollFrom)));
      await page.evaluate(
        (y) => document.querySelector('.ui-sheet')?.scrollTo({ top: y }),
        scrollStart.from + (scrollStart.to - scrollStart.from) * s,
      );
      if (Math.round(t * FPS) % 5 === 0) pressed(t, 'scroll');
    }
    if (once(T.range))
      await click(page.locator('.ui-sheet').getByRole('radio', { name: '30 días' }), t);
    if (once(T.closeSheet)) {
      await page.keyboard.press('Escape');
      pressed(t, 'close');
    }
    if (once(T.takeOver)) {
      // From wherever the app's own move has left the camera: out to the
      // whole greenhouse for the rain, then round it into the night.
      const from = await page.evaluate(() => window.__vitreo.getPose());
      finale = pathThrough([
        key(T.takeOver, from),
        key(17.0, at(-0.2, 0.02, 1.05)),
        key(19.5, at(-0.42, 0.05, 0.96)),
        key(22.0, at(-0.6, 0.07, 0.9)),
        key(SECONDS, at(-0.72, 0.08, 0.87)),
      ]);
    }
    if (once(T.bar) || once(T.barAgain)) await unfoldBar(t);
    if (once(T.situations))
      await click(page.getByRole('button', { name: 'Probar situaciones' }), t);
    if (once(T.rain))
      await click(page.locator('.demo-menu .menu-row').filter({ hasText: 'Lluvia' }), t);
    if (once(T.speed)) await click(page.getByRole('radio', { name: 'Ver un día en un minuto' }), t);
    if (once(T.barFold) || once(T.barAway)) await foldBar(t);
  }

  /** The demo's line opens its row (the speeds, "Probar situaciones"), under the pointer. */
  async function unfoldBar(t) {
    const toggle = page.locator('.demo-label-toggle');
    const box = await toggle.boundingBox();
    if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    if ((await toggle.getAttribute('aria-expanded')) === 'false') await click(toggle, t);
  }

  /** It folds away again, and the pointer leaves for an empty corner. */
  async function foldBar(t) {
    const toggle = page.locator('.demo-label-toggle');
    if ((await toggle.getAttribute('aria-expanded')) === 'true') await click(toggle, t);
    await page.mouse.move(8, HEIGHT - 8);
  }

  function poseAt(t) {
    if (t < T.basil) return flight(t);
    if (finale && t >= T.takeOver) return finale(t);
    return null;
  }

  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(path.join(FRAMES, 'plain'), { recursive: true });
  mkdirSync(path.join(FRAMES, 'card'), { recursive: true });

  const total = Math.round(SECONDS * FPS);
  const lastFrame = TEST ? Math.round(Math.max(...TEST_AT) * FPS) : total - 1;
  const testFrames = new Set(TEST_AT.map((s) => Math.round(s * FPS)));
  /** What the greenhouse sounded like at each frame, for the soundtrack. */
  const samples = [];
  let lastT = -1;

  const shoot = (file) => visit.shoot(file, { format: 'jpeg', quality: 92 });

  for (let i = 0; i <= lastFrame; i++) {
    const t = i / FPS;
    await interface_(t, lastT);
    lastT = t;
    const pose = poseAt(t);
    if (pose) await page.evaluate((p) => window.__vitreo.setPose(p), pose);
    await advance(1000 / FPS);
    await page.evaluate(() => window.__vitreo.settle());
    samples.push({ t, sample: await page.evaluate(() => window.__vitreo.sample()) });
    const name = `${String(i).padStart(4, '0')}.jpg`;
    if (TEST) {
      if (testFrames.has(i)) await shoot(path.join(OUT, `test-${t.toFixed(1)}s.jpg`));
      continue;
    }
    await shoot(path.join(FRAMES, 'plain', name));
    // The closing card: its own frames, faded in over half a second.
    const card = Math.min(1, Math.max(0, (t - T.card) / 0.5));
    if (card > 0) {
      await page.evaluate((o) => window.__vitreo.endCard(o), easeInOut(card));
      await shoot(path.join(FRAMES, 'card', name));
      await page.evaluate(() => window.__vitreo.endCard(0));
    }
    if (i % 60 === 0)
      console.log(`frame ${i}/${total} (${((performance.now() - started) / 1000).toFixed(0)} s)`);
  }

  if (TEST) {
    await browser.close();
    console.log(`test frames → ${path.relative(ROOT, OUT)}/test-*.jpg`);
    process.exit(0);
  }
  await page.close();
  return { samples, touches };
}

// ─────────────────────────────────────────────────── the soundtrack

console.log(
  `soundtrack: ${touches.length.toString()} presses, ${samples.length.toString()} samples`,
);
// Rendered in a fresh page on the real clock (OfflineAudioContext needs no
// time of its own), from the same dev server: the app's own sound code.
const audioPage = await context.newPage();
await audioPage.goto('http://localhost:5190/?cielo=seco');
const pcm = await audioPage.evaluate(
  async ({ seconds, frames, presses }) => {
    const { renderSoundtrack } = await import('/src/app/videoSoundtrack.ts');
    const { left, right } = await renderSoundtrack({ seconds, frames, touches: presses });
    // 16-bit, interleaved, as base64: small enough to carry out of the page.
    const out = new Int16Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
      out[2 * i] = Math.max(-1, Math.min(1, left[i] ?? 0)) * 32767;
      out[2 * i + 1] = Math.max(-1, Math.min(1, right[i] ?? 0)) * 32767;
    }
    const bytes = new Uint8Array(out.buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      text += String.fromCharCode(...bytes.subarray(i, i + 32768));
    }
    return btoa(text);
  },
  { seconds: SECONDS, frames: samples, presses: touches },
);
await browser.close();
stopServer();

const RATE = 48_000;
const data = Buffer.from(pcm, 'base64');
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
const rawWav = path.join(FRAMES, 'soundtrack-raw.wav');
writeFileSync(rawWav, Buffer.concat([header, data]));

const run = runFfmpeg;

// A web video's loudness (EBU R128, −16 LUFS, peaks under −1.5 dB), the
// last half second faded out.
const soundtrack = path.join(FRAMES, 'soundtrack.wav');
run(
  [
    '-i',
    rawWav,
    '-af',
    `loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=${(SECONDS - 0.6).toString()}:d=0.6`,
    '-ar',
    String(RATE),
    soundtrack,
  ],
  'loudness',
);

// ─────────────────────────────────────────────────── the videos

// The closing card's frames over the plain ones, for the second video.
const cardFrom = Math.ceil(T.card * FPS) + 1;
mkdirSync(path.join(FRAMES, 'with-card'), { recursive: true });
for (const name of readdirSync(path.join(FRAMES, 'plain'))) {
  const index = Number(name.slice(0, 4));
  copyFileSync(
    index >= cardFrom ? path.join(FRAMES, 'card', name) : path.join(FRAMES, 'plain', name),
    path.join(FRAMES, 'with-card', name),
  );
}

function encode(dir, file, crf, preset = 'veryfast') {
  run(
    [
      '-framerate',
      String(FPS),
      '-i',
      path.join(dir, '%04d.jpg'),
      '-i',
      soundtrack,
      '-c:v',
      'libx264',
      '-crf',
      String(crf),
      '-preset',
      preset,
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      path.join(OUT, file),
    ],
    file,
  );
}

encode(path.join(FRAMES, 'plain'), 'vitreo_landing.mp4', 18);
encode(path.join(FRAMES, 'with-card'), 'vitreo_landing_cta.mp4', 18);
// For the web page: lighter, the same picture to the eye.
encode(path.join(FRAMES, 'with-card'), 'vitreo_landing_web.mp4', 24, 'slow');
// The poster: the greenhouse close, its light just on.
copyFileSync(
  path.join(FRAMES, 'plain', `${String(Math.round(3.8 * FPS)).padStart(4, '0')}.jpg`),
  path.join(OUT, 'vitreo_landing_poster.jpg'),
);
console.log(
  `videos → ${path.relative(ROOT, OUT)}/ in ${((performance.now() - started) / 1000).toFixed(0)} s`,
);
