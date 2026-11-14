// The trailer's footage (video/trailer): one flight through the REAL demo
// that goes from function to function, close to what changes (the lamp, the
// fan and the roof window, a plant's sheet, the tank, the rain, the night),
// a few seconds of it on a phone, and a quick scroll down the notebook. Frame
// by frame at 30 fps on a clock Playwright fakes, as `pnpm video:landing`
// does (D130). With each clip of the app goes what the app itself sounded
// like (its ambience, touches and devices, rendered by the app's own code:
// src/app/videoSoundtrack.ts, without its music); the trailer adds its music.
//
//   pnpm video:trailer            the clips and their sound → video/trailer/assets/
//   pnpm video:trailer --test     a few frames of the flight, to look at first
//   pnpm video:trailer --notebook only the notebook's clip again
//
// The moments of T are the ones video/trailer/index.html cuts on: keep both
// in step. Frames go to video/frames-trailer/ (ignored by git).
/* global window, document -- inside page.evaluate, which runs in the page */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
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

const FRAMES = path.join(ROOT, 'video', 'frames-trailer');
const ASSETS = path.join(ROOT, 'video', 'trailer', 'assets');
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const TEST = process.argv.includes('--test');
const NOTEBOOK_ONLY = process.argv.includes('--notebook');
const TEST_AT = [1.0, 3.8, 7.0, 8.6, 12.2, 15.0, 16.6, 20.0, 22.4, 23.6, 25.6, 27.0, 29.0];
const PHONE_TEST_AT = [0.5, 1.6, 3.0, 5.0];

/** 16:37 in Madrid in mid-November: the afternoon, then a day in a minute into the night. */
const START = Date.parse('2026-11-12T15:37:00Z');
/** The flight is the first 30 s; the rest is the night, slowly, for the closing card. */
const SECONDS = 36;
const PHONE_SECONDS = 5.5;
const PHONE = { width: 390, height: 844, scale: 2 };

/**
 * When each thing happens (s). Unhurried: every press has a second or more
 * to be seen before the next, and the demo's own row stays open five seconds.
 */
const T = {
  light: 2.6,
  air: 5.5,
  fan: 6.4,
  window: 7.8,
  airAway: 9.6,
  water: 10.4,
  basil: 11.3,
  waterNow: 12.8,
  scrollFrom: 14.2,
  scrollTo: 15.4,
  range: 15.9,
  closeSheet: 17.6,
  takeOver: 17.8,
  bar: 21.2,
  situations: 22.0,
  rain: 23.0,
  speed: 25.2,
  barAway: 26.2,
};
/** On the phone (s of its own clip). */
const P = { water: 1.0, basil: 2.0, scrollFrom: 3.4, scrollTo: 4.8 };

await ensureServer();
const browser = await launchBrowser();
const started = performance.now();
mkdirSync(ASSETS, { recursive: true });

function encode(dir, file) {
  runFfmpeg(
    [
      '-framerate',
      String(FPS),
      '-i',
      path.join(dir, '%04d.jpg'),
      '-c:v',
      'libx264',
      '-crf',
      '16',
      '-preset',
      'medium',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(FPS),
      // Every frame a keyframe: the trailer seeks into it at any instant.
      '-g',
      '1',
      '-an',
      path.join(ASSETS, file),
    ],
    file,
  );
}

// ─────────────────────────────────────────────────── recording a visit

/**
 * A visit frame by frame: `act(t, last)` presses what is due, `poseAt(t)`
 * places the camera (null leaves it to the app). Returns what the greenhouse
 * sounded like at each frame.
 */
async function record({ visit, seconds, act, poseAt, name, testAt, scale = 1 }) {
  const { page, advance } = visit;
  const dir = path.join(FRAMES, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const total = Math.round(seconds * FPS);
  const lastFrame = TEST ? Math.round(Math.max(...testAt) * FPS) : total - 1;
  const testFrames = new Set(testAt.map((s) => Math.round(s * FPS)));
  const samples = [];
  let lastT = -1;
  for (let i = 0; i <= lastFrame; i++) {
    const t = i / FPS;
    await act(t, lastT);
    lastT = t;
    const pose = poseAt(t);
    if (pose) await page.evaluate((p) => window.__vitreo.setPose(p), pose);
    await advance(1000 / FPS);
    await page.evaluate(() => window.__vitreo.settle());
    samples.push({ t, sample: await page.evaluate(() => window.__vitreo.sample()) });
    if (TEST) {
      if (testFrames.has(i))
        await visit.shoot(path.join(FRAMES, `test-${name}-${t.toFixed(1)}s.jpg`), {
          format: 'jpeg',
          quality: 90,
          scale,
        });
      continue;
    }
    await visit.shoot(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), {
      format: 'jpeg',
      quality: 94,
      scale,
    });
    if (i % 120 === 0) console.log(`${name} ${i}/${total}`);
  }
  return samples;
}

/**
 * What the app sounded like through a clip (ambience, touches, devices; no
 * music), rendered by the app's own sound code in a page on the real clock.
 */
async function appSounds(seconds, samples, touches, file) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://localhost:5190/?cielo=seco');
  const pcm = await page.evaluate(
    async ({ seconds: length, frames, presses }) => {
      const { renderSoundtrack } = await import('/src/app/videoSoundtrack.ts');
      const { left, right } = await renderSoundtrack({
        seconds: length,
        frames,
        touches: presses,
        layers: { music: false },
      });
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
    { seconds, frames: samples, presses: touches },
  );
  await context.close();
  const rate = 48_000;
  const data = Buffer.from(pcm, 'base64');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path.join(ASSETS, file), Buffer.concat([header, data]));
}

/** The sheet of a plant down to its history, smoothly, between two instants. */
function sheetScroller(page, from, to) {
  let start = null;
  return async (t) => {
    if (t < from || t > to + 0.05) return false;
    start ??= await page.evaluate(() => {
      const sheet = document.querySelector('.ui-sheet');
      if (!sheet) return null;
      const goal = sheet.querySelector('.history');
      const top = goal
        ? goal.getBoundingClientRect().top -
          sheet.getBoundingClientRect().top +
          sheet.scrollTop -
          24
        : sheet.scrollHeight;
      return { from: sheet.scrollTop, to: Math.min(top, sheet.scrollHeight - sheet.clientHeight) };
    });
    if (!start) return false;
    const s = easeInOut(Math.min(1, (t - from) / (to - from)));
    await page.evaluate(
      (y) => document.querySelector('.ui-sheet')?.scrollTo({ top: y }),
      start.from + (start.to - start.from) * s,
    );
    return true;
  };
}

// ─────────────────────────────────────────────────── the flight

async function flight() {
  const context = await newVisitorContext(browser, { width: WIDTH, height: HEIGHT });
  const visit = await openVisit(context, { start: START });
  const { page, advance, home, focus, centre, at } = visit;
  // The light starts off, so the film switches it on.
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
  const tank = (await centre('tank')) ?? home.target;
  const plants = lerp3(basil, tomato, 0.5);

  // One slow line, never a jump: in from far, turning; down to the pots as
  // the lamp comes on; up to the fan and across to the roof window as they
  // answer; back for a plant.
  const first = pathThrough([
    key(0, at(-0.6, 0.08, 0.85)),
    key(2.6, at(-0.32, 0.03, 1.15, lerp3(home.target, plants, 0.5))),
    key(4.8, at(-0.08, -0.02, 1.65, lerp3(plants, lamp, 0.5))),
    key(7.2, at(0.14, -0.04, 1.85, lerp3(fan, vent, 0.3))),
    key(9.4, at(0.26, -0.05, 1.85, lerp3(fan, vent, 0.8))),
    key(10.6, at(0.2, 0.01, 1.5, lerp3(home.target, plants, 0.6))),
    key(T.basil, at(0.14, 0.03, 1.45, lerp3(plants, basil, 0.4))),
  ]);
  let second = null;
  /** Each press, for the sound: what the app plays for it. */
  const touches = [];
  const click = async (locator, t, cue = 'press') => {
    await locator.dispatchEvent('click');
    if (cue) touches.push({ t, cue });
  };
  const scroll = sheetScroller(page, T.scrollFrom, T.scrollTo);
  const toggle = page.locator('.demo-label-toggle');

  /** What happens at this instant, in the real interface. */
  async function act(t, last) {
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
    if ((await scroll(t)) && Math.round(t * FPS) % 6 === 0) touches.push({ t, cue: 'scroll' });
    if (once(T.range))
      await click(page.locator('.ui-sheet').getByRole('radio', { name: '30 días' }), t);
    if (once(T.closeSheet)) {
      await page.keyboard.press('Escape');
      touches.push({ t, cue: 'close' });
    }
    if (once(T.takeOver)) {
      // From where the app left the camera: past the tank and its gauge, out
      // to the whole greenhouse for the rain, round it into the night, and
      // slowly in to the light inside.
      const from = await page.evaluate(() => window.__vitreo.getPose());
      second = pathThrough([
        key(T.takeOver, from),
        key(20.2, at(-0.3, 0.0, 1.5, lerp3(tank, home.target, 0.35))),
        key(23.0, at(-0.12, 0.03, 1.1)),
        key(26.0, at(0.06, 0.05, 1.0)),
        key(29.0, at(-0.14, 0.05, 1.1)),
        key(32.5, at(-0.36, 0.02, 1.45, plants)),
        key(SECONDS, at(-0.52, 0.02, 1.55, plants)),
      ]);
    }
    // The demo's own row, open for as long as it is used: the rain, then a
    // day in a minute.
    if (once(T.bar)) {
      const box = await toggle.boundingBox();
      if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await click(toggle, t);
    }
    if (once(T.situations))
      await click(page.getByRole('button', { name: 'Probar situaciones' }), t);
    if (once(T.rain))
      await click(page.locator('.demo-menu .menu-row').filter({ hasText: 'Lluvia' }), t);
    if (once(T.speed)) await click(page.getByRole('radio', { name: 'Ver un día en un minuto' }), t);
    if (once(T.barAway)) {
      if ((await toggle.getAttribute('aria-expanded')) === 'true') await click(toggle, t);
      await page.mouse.move(8, HEIGHT - 8);
    }
  }

  const samples = await record({
    visit,
    seconds: SECONDS,
    act,
    poseAt: (t) => (t < T.basil ? first(t) : second && t >= T.takeOver ? second(t) : null),
    name: 'app',
    testAt: TEST_AT,
  });
  await context.close();
  if (TEST) return;
  encode(path.join(FRAMES, 'app'), 'footage.mp4');
  await appSounds(SECONDS, samples, touches, 'app-flight.wav');
}

// ─────────────────────────────────────────────────── the phone

/** The same app in a hand: a plant's sheet opened from the dock, and down to its history. */
async function phone() {
  const context = await newVisitorContext(browser, { ...PHONE, phone: true });
  const visit = await openVisit(context, { start: START });
  const { page, at } = visit;
  const drift = pathThrough([key(0, at(-0.22, 0.03, 1.15)), key(P.basil, at(-0.08, 0.02, 1.3))]);
  const touches = [];
  const click = async (locator, t, cue = 'press') => {
    await locator.dispatchEvent('click');
    touches.push({ t, cue });
  };
  const scroll = sheetScroller(page, P.scrollFrom, P.scrollTo);
  async function act(t, last) {
    const once = (when) => t >= when && last < when;
    if (once(P.water)) await click(page.getByRole('button', { name: 'Regar', exact: true }), t);
    if (once(P.basil)) {
      await page.evaluate(() => window.__vitreo.setPose(null));
      await click(page.locator('.menu-row[data-zone="basil_01"]'), t, 'open');
    }
    if ((await scroll(t)) && Math.round(t * FPS) % 6 === 0) touches.push({ t, cue: 'scroll' });
  }
  const samples = await record({
    visit,
    seconds: PHONE_SECONDS,
    act,
    poseAt: (t) => (t < P.basil ? drift(t) : null),
    name: 'phone',
    testAt: PHONE_TEST_AT,
    scale: PHONE.scale,
  });
  await context.close();
  if (TEST) return;
  encode(path.join(FRAMES, 'phone'), 'phone.mp4');
  await appSounds(PHONE_SECONDS, samples, touches, 'app-phone.wav');
}

// ─────────────────────────────────────────────────── the notebook

/** Down the notebook ("Cómo se hizo", D133) in six seconds: how it was made, at a glance. */
async function notebook() {
  const seconds = 6;
  const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();
  await page.goto('http://localhost:5190/cuaderno', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const cdp = await context.newCDPSession(page);
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight,
  );
  const dir = path.join(FRAMES, 'notebook');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const total = seconds * FPS;
  for (let i = 0; i < total; i++) {
    // A little of the top first, then steadily down.
    const s = i / (total - 1);
    await page.evaluate((y) => window.scrollTo(0, y), height * 0.62 * s ** 1.4);
    await page.waitForTimeout(20);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94 });
    writeFileSync(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), Buffer.from(data, 'base64'));
  }
  await context.close();
  encode(dir, 'notebook.mp4');
}

try {
  mkdirSync(FRAMES, { recursive: true });
  if (!NOTEBOOK_ONLY) {
    await flight();
    await phone();
  }
  if (!TEST) await notebook();
} finally {
  await browser.close();
  stopServer();
}
console.log(
  TEST
    ? `test frames → video/frames-trailer/test-*.jpg`
    : `footage → video/trailer/assets/ in ${((performance.now() - started) / 1000).toFixed(0)} s`,
);
