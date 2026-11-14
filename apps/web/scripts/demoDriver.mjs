// Driving the REAL demo from outside (development only), shared by the
// landing video (landing-video.mjs, D130) and the notebook's pictures
// (notebook-shots.mjs): `vite --mode demo` on :5190, `?video` turning on
// app/videoMode.ts, and a clock Playwright fakes, so every run has the same
// hour, camera and interface.
/* global window, document -- inside page.evaluate, which runs in the page */
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import { chromium } from '@playwright/test';

export const ROOT = path.resolve(import.meta.dirname, '../../..');
const DEMO = 'http://localhost:5190';
const ffmpeg = createRequire(path.join(ROOT, 'package.json'))('ffmpeg-static');

/** ffmpeg, quiet unless it fails. */
export function runFfmpeg(args, what) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    stdio: 'inherit',
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${what}`);
}

// ─────────────────────────────────────────────────── camera paths

export const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/** A pose as numbers: azimuth, polar, log zoom, target x, y, z. */
const toVec = (p) => [p.azimuth, p.polar, Math.log(p.zoom), ...p.target];
const toPose = (v) => ({
  azimuth: v[0],
  polar: v[1],
  zoom: Math.exp(v[2]),
  target: [v[3], v[4], v[5]],
});

/** A key pose of a path, at `t` seconds. */
export const key = (t, pose) => ({ t, v: toVec(pose) });

/**
 * Through every key pose, smoothly (cubic Hermite with Catmull-Rom tangents
 * on the key times): it never stops between them, only at the ends.
 */
export function pathThrough(keys) {
  const tangents = keys.map((k, i) => {
    if (i === 0 || i === keys.length - 1) return k.v.map(() => 0);
    const before = keys[i - 1];
    const after = keys[i + 1];
    return k.v.map((_, j) => (after.v[j] - before.v[j]) / (after.t - before.t));
  });
  return (t) => {
    if (t <= keys[0].t) return toPose(keys[0].v);
    const last = keys.at(-1);
    if (t >= last.t) return toPose(last.v);
    const i = keys.findIndex((k, n) => t >= k.t && t <= keys[n + 1].t);
    const a = keys[i];
    const b = keys[i + 1];
    const h = b.t - a.t;
    const s = (t - a.t) / h;
    const h00 = 2 * s ** 3 - 3 * s ** 2 + 1;
    const h10 = s ** 3 - 2 * s ** 2 + s;
    const h01 = -2 * s ** 3 + 3 * s ** 2;
    const h11 = s ** 3 - s ** 2;
    return toPose(
      a.v.map(
        (_, j) =>
          h00 * a.v[j] + h10 * h * tangents[i][j] + h01 * b.v[j] + h11 * h * tangents[i + 1][j],
      ),
    );
  };
}

// ─────────────────────────────────────────────────── the server and the browser

async function serverUp() {
  try {
    return (await fetch(`${DEMO}/`)).ok;
  } catch {
    return false;
  }
}

let server = null;

/** The dev server this module started, with everything under it (on Windows, pnpm's shell holds vite). */
export function stopServer() {
  if (!server?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F']);
  else server.kill();
  server = null;
}

/** `pnpm demo:dev` if nothing answers on :5190; stopped on the way out, also when something fails. */
export async function ensureServer() {
  if (await serverUp()) return;
  server = spawn('pnpm', ['demo:dev'], { cwd: ROOT, shell: true, stdio: 'ignore' });
  process.on('exit', stopServer);
  for (let i = 0; i < 120 && !(await serverUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await serverUp())) throw new Error('the demo dev server did not start on :5190');
}

export async function launchBrowser() {
  return chromium.launch({
    channel: 'chrome',
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=default'],
  });
}

/**
 * A visitor who has seen the welcome, at high quality, with every sound off
 * in the page (a soundtrack, if any, is rendered apart) and day and night
 * following the sun.
 */
export async function newVisitorContext(browser, { width, height, scale = 1, phone = false }) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    isMobile: phone,
    hasTouch: phone,
  });
  await context.addInitScript(() => {
    localStorage.setItem('vitreo.onboarded', 'forever');
    localStorage.setItem('vitreo.quality', 'high');
    localStorage.setItem('vitreo.sound', '0');
    localStorage.setItem('vitreo.touchSounds', '0');
    localStorage.setItem('vitreo.deviceSounds', '0');
    sessionStorage.setItem('vitreo.theme', 'auto');
  });
  return context;
}

// ─────────────────────────────────────────────────── a visit on a faked clock

/**
 * Opens the demo at `start` (ms, UTC) on Playwright's clock and waits until
 * the scene, the live readings and the camera API are there. Time then moves
 * only when told: `advance` (the page and the demo's worker) or `wait`
 * (the same, in steps, with a breath of real time for the worker to answer).
 */
export async function openVisit(context, { start, query = '', ready: until = 'scene' }) {
  const withScene = until === 'scene';
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 300)));
  await page.clock.install({ time: start });
  const cdp = await context.newCDPSession(page);

  let owed = 0;
  async function advance(ms) {
    owed += ms;
    const whole = Math.floor(owed);
    owed -= whole;
    if (whole > 0) await page.clock.runFor(whole);
    await page.evaluate(() => window.__vitreo?.syncWorker?.());
  }
  async function wait(ms, step = 100) {
    for (let done = 0; done < ms; done += step) {
      await advance(Math.min(step, ms - done));
      await new Promise((r) => setTimeout(r, 15));
    }
    await page.evaluate(() => window.__vitreo?.settle?.());
  }

  await page.goto(`${DEMO}/?video${query ? `&${query}` : ''}`);
  for (let i = 0; ; i++) {
    let ready = false;
    try {
      await advance(100);
      // Without the 3D (`ready: 'live'`), only the live readings.
      ready = await page.evaluate(
        (scene) =>
          document.querySelector('.status')?.getAttribute('data-freshness') === 'live' &&
          typeof window.__vitreo?.sample === 'function' &&
          (!scene ||
            (document.documentElement.dataset.sceneReady === 'true' &&
              typeof window.__vitreo?.setPose === 'function')),
        withScene,
      );
    } catch (error) {
      // A fresh dev server reloads the page once it has optimised its deps.
      if (!String(error).includes('Execution context was destroyed')) throw error;
    }
    if (ready) break;
    if (i > 600) throw new Error('the scene never got ready');
    await new Promise((r) => setTimeout(r, 30));
  }
  // Two more seconds for what fades in.
  for (let i = 0; i < 20; i++) await advance(100);

  const home = withScene ? await page.evaluate(() => window.__vitreo.homePose()) : null;
  const visit = {
    page,
    cdp,
    advance,
    wait,
    home,
    focus: (zone) => page.evaluate((z) => window.__vitreo.focusOf(z), zone),
    centre: (name) => page.evaluate((n) => window.__vitreo.centerOf(n), name),
    /** A pose relative to the home view. */
    at: (dAz, dPolar, zoom, target = home.target) => ({
      azimuth: home.azimuth + dAz,
      polar: home.polar + dPolar,
      zoom,
      target,
    }),
    setPose: (pose) => page.evaluate((p) => window.__vitreo.setPose(p), pose),
    settle: () => page.evaluate(() => window.__vitreo.settle?.()),
    /** A click that never waits on actionability (which hangs under the faked frames). */
    click: (locator) => locator.dispatchEvent('click'),
    /** The page as it is now, through CDP (a screenshot that does not wait for frames). */
    async shoot(file, { format = 'png', quality, scale = 1 } = {}) {
      // CDP takes the page at one pixel per CSS pixel unless it is told the scale.
      const size = page.viewportSize();
      const { data } = await cdp.send('Page.captureScreenshot', {
        format,
        ...(quality === undefined ? {} : { quality }),
        ...(scale === 1 || !size ? {} : { clip: { x: 0, y: 0, ...size, scale } }),
      });
      writeFileSync(file, Buffer.from(data, 'base64'));
    },
  };
  return visit;
}

export const lerp3 = (a, b, s) => a.map((x, i) => x + (b[i] - x) * s);
