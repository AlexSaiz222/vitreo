// The notebook's pictures and clips ("Cómo se hizo", D133), taken from the
// REAL demo as it is today (development only, the driver of the landing
// video: demoDriver.mjs): every shot at the same size, on a faked clock, so
// they look like one app and can be taken again whenever it changes.
//
//   pnpm notebook:shots                 every picture and clip
//   pnpm notebook:shots ficha lluvia    only these (by id)
//   pnpm notebook:shots --stills        only the pictures; --clips, only the clips
//
// Pictures go to referencias/progreso/<DAY>-cuaderno-v3-<id>.png (the
// notebook only shows progress captures: list them in
// src/notebook/images.json and run `pnpm notebook:images`); clips to
// src/notebook/clips/<id>.mp4 (silent H.264 loops, Git LFS), with their
// first frame as a picture (`clip-<id>`) to stand in until they play.
/* global document -- inside page.evaluate, which runs in the page */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import {
  ROOT,
  easeInOut,
  ensureServer,
  launchBrowser,
  lerp3,
  newVisitorContext,
  openVisit,
  runFfmpeg,
  stopServer,
} from './demoDriver.mjs';

const DAY = '2026-11-10';
const STILLS = path.join(ROOT, 'referencias/progreso');
const CLIPS = path.join(ROOT, 'apps/web/src/notebook/clips');
const FRAMES = path.join(ROOT, 'video/frames-notebook');
const FPS = 30;

/** A desktop window the size the notebook shows it at, so the interface reads 1:1. */
const DESK = { width: 1200, height: 750 };
const PHONE = { width: 390, height: 844, phone: true };

/** Madrid in mid-November: noon, the end of the afternoon, the night. */
const NOON = Date.parse('2026-11-12T11:30:00Z');
const DUSK = Date.parse('2026-11-12T16:20:00Z');
const NIGHT = Date.parse('2026-11-12T20:30:00Z');
const DRY = 'cielo=seco';

// ─────────────────────────────────────────────────── helpers in the page

/** Only the 3D scene: for the pictures of the diorama itself. */
async function sceneOnly(visit, on = true) {
  await visit.page.evaluate((hide) => {
    document.getElementById('notebook-scene-only')?.remove();
    if (!hide) return;
    const style = document.createElement('style');
    style.id = 'notebook-scene-only';
    style.textContent = '#root * { visibility: hidden } #root canvas { visibility: visible }';
    document.head.append(style);
  }, on);
}

async function openBarRow(visit) {
  const toggle = visit.page.locator('.demo-label-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await visit.click(toggle);
  await visit.wait(400);
}

/** "Probar situaciones" › one of them, as a visitor does. */
async function situation(visit, title) {
  await openBarRow(visit);
  await visit.click(visit.page.getByRole('button', { name: 'Probar situaciones' }));
  await visit.wait(400);
  await visit.click(visit.page.getByRole('button', { name: new RegExp(`^${title}`) }));
  await visit.wait(400);
  const toggle = visit.page.locator('.demo-label-toggle');
  if ((await toggle.getAttribute('aria-expanded')) === 'true') await visit.click(toggle);
}

/** Waits (on the demo's clock) until `predicate` holds in the page. */
async function until(visit, predicate, arg, limit = 30_000) {
  for (let waited = 0; waited < limit; waited += 200) {
    if (await visit.page.evaluate(predicate, arg)) return;
    await visit.wait(200);
  }
  throw new Error(`never happened: ${String(predicate).slice(0, 120)}`);
}

const statusSays = (visit, text) =>
  until(visit, (t) => document.querySelector('.status')?.textContent?.includes(t) ?? false, text);

async function openBasil(visit) {
  await visit.page.locator('.plant-target[data-zone="basil_01"]').focus();
  await visit.page.keyboard.press('Enter');
  await until(visit, () => document.querySelector('.ui-sheet h2')?.textContent === 'Albahaca');
  await visit.wait(1800);
}

/** The open sheet scrolled to one of its sections. */
async function sheetTo(visit, selector, offset = 16) {
  await visit.page.evaluate(
    ({ selector: s, offset: o }) => {
      const sheet = document.querySelector('.ui-sheet');
      const goal = sheet?.querySelector(s);
      if (!sheet || !goal) throw new Error(`no ${s} in the sheet`);
      const top =
        goal.getBoundingClientRect().top - sheet.getBoundingClientRect().top + sheet.scrollTop - o;
      sheet.scrollTo({ top });
    },
    { selector, offset },
  );
  await visit.wait(600);
}

async function openSettings(visit, row) {
  await visit.click(visit.page.getByRole('button', { name: 'Ajustes' }));
  await visit.wait(700);
  if (row) {
    await visit.click(visit.page.getByRole('button', { name: new RegExp(`^${row}`) }));
    await visit.wait(900);
  }
}

// ─────────────────────────────────────────────────── the pictures

/** Nothing to do first: the demo as it opens. */
const asItIs = () => Promise.resolve();

/**
 * Each picture: where and when, and what to do before it is taken.
 * `device`: DESK or PHONE; `ready`: 'scene' (default) or 'live' (no 3D).
 */
const STILL_SHOTS = {
  'escena-dia': { start: NOON, query: DRY, take: asItIs },
  'escena-noche': { start: NIGHT, query: DRY, take: asItIs },
  'escena-dormida': {
    start: NOON,
    query: DRY,
    async take(v) {
      await situation(v, 'Sin conexión');
      await statusSays(v, 'Desconectado');
      await v.wait(3000);
    },
  },
  'modelo-cerca': {
    start: NOON,
    query: DRY,
    async take(v) {
      const basil = await v.focus('basil_01');
      const tomato = await v.focus('tomato_01');
      const tank = (await v.centre('tank')) ?? basil;
      await v.setPose(v.at(-0.22, 0.02, 1.75, lerp3(lerp3(basil, tomato, 0.5), tank, 0.3)));
      await sceneOnly(v);
      await v.wait(600);
    },
  },
  ficha: {
    start: NOON,
    query: DRY,
    async take(v) {
      await openBasil(v);
    },
  },
  grafica: {
    start: NOON,
    query: DRY,
    async take(v) {
      await openBasil(v);
      await sheetTo(v, '.history', 64);
      await v.click(v.page.locator('.ui-sheet').getByRole('radio', { name: '30 días' }));
      await v.wait(2500);
    },
  },
  'deposito-vacio': {
    start: NOON,
    query: DRY,
    async take(v) {
      await situation(v, 'Depósito vacío');
      await statusSays(v, 'El depósito está vacío');
      await openBasil(v);
    },
  },
  'sensor-roto': {
    start: NOON,
    query: DRY,
    async take(v) {
      await situation(v, 'Se rompe un sensor');
      await statusSays(v, 'El sensor de la albahaca');
      await openBasil(v);
    },
  },
  'lluvia-cerca': {
    start: NOON,
    query: DRY,
    async take(v) {
      await situation(v, 'Lluvia');
      // A while into the shower: the glass full of drops, the plinth wet.
      await v.wait(30_000, 250);
      const vent = (await v.centre('vent_window')) ?? v.home.target;
      await v.setPose(v.at(0.12, 0.0, 2.3, lerp3(v.home.target, vent, 0.3)));
      await sceneOnly(v);
      await v.wait(1500);
    },
  },
  tiempo: {
    start: NOON,
    query: DRY,
    async take(v) {
      await situation(v, 'Lluvia');
      await v.wait(9000);
      await openSettings(v, 'Tiempo exterior');
    },
  },
  invernadero: {
    start: NOON,
    query: DRY,
    async take(v) {
      await v.click(v.page.getByRole('button', { name: 'Invernadero', exact: true }));
      await v.wait(3500);
    },
  },
  sonido: {
    start: NOON,
    query: DRY,
    storage: { 'vitreo.sound': '1', 'vitreo.touchSounds': '1', 'vitreo.deviceSounds': '1' },
    async take(v) {
      // A first touch, as a visitor's: the browser lets the sound start.
      await v.page.mouse.click(300, 400);
      await v.wait(800);
      await openSettings(v);
      await v.page.evaluate(() => {
        const sheet = document.querySelector('.ui-sheet');
        const goal = [...(sheet?.querySelectorAll('h3') ?? [])].find((h) =>
          h.textContent?.startsWith('Sonido'),
        );
        if (sheet && goal)
          sheet.scrollTo({
            top:
              goal.getBoundingClientRect().top -
              sheet.getBoundingClientRect().top +
              sheet.scrollTop -
              16,
          });
      });
      await v.wait(600);
    },
  },
  'movil-escena': { device: PHONE, start: NOON, query: DRY, take: asItIs },
  'movil-noche': { device: PHONE, start: NIGHT, query: DRY, take: asItIs },
  'movil-ficha': {
    device: PHONE,
    start: NOON,
    query: DRY,
    async take(v) {
      await openBasil(v);
    },
  },
  'movil-riego-auto': {
    device: PHONE,
    start: NOON,
    query: DRY,
    async take(v) {
      await openBasil(v);
      await sheetTo(v, '.automation');
      await v.wait(1500);
    },
  },
  'movil-diario': {
    device: PHONE,
    start: NOON,
    query: DRY,
    async take(v) {
      await openBasil(v);
      await sheetTo(v, '.journal', 40);
      await v.wait(1500);
    },
  },
  'movil-sin-3d': {
    device: PHONE,
    start: NOON,
    query: DRY,
    ready: 'live',
    async take(v) {
      await v.wait(1500);
    },
  },
};

// ─────────────────────────────────────────────────── the clips

/**
 * Each clip: where and when, what to do before it starts (`setup`), and at
 * each frame (`frame(v, t, last)`: `t` seconds in, `last` the frame before).
 */
const CLIP_SHOTS = {
  // The diorama, turning a little and back: a loop with no seam.
  escena: {
    start: NOON,
    query: DRY,
    seconds: 8,
    async setup(v) {
      await sceneOnly(v);
    },
    async frame(v, t) {
      const swing = Math.sin((2 * Math.PI * t) / 8);
      await v.setPose(v.at(-0.1 + 0.32 * swing, 0.03, 1.2));
    },
  },
  riego: {
    start: NOON,
    query: DRY,
    seconds: 7,
    async setup(v) {
      await openBasil(v);
    },
    async frame(v, t, last) {
      if (t >= 0.8 && last < 0.8) await v.click(v.page.locator('.ui-sheet .primary-button'));
    },
  },
  aire: {
    start: NOON,
    query: DRY,
    seconds: 6,
    async setup(v) {
      // The fan and the roof window above the Aire panel, which opens low in the middle.
      const fan = (await v.centre('fan')) ?? v.home.target;
      const vent = (await v.centre('vent_window')) ?? v.home.target;
      const [x, y, z] = lerp3(fan, vent, 0.5);
      await v.setPose(v.at(0.2, -0.03, 1.18, [x, y - 0.2, z]));
    },
    async frame(v, t, last) {
      const once = (when) => t >= when && last < when;
      if (once(0.5)) await v.click(v.page.getByRole('button', { name: 'Aire', exact: true }));
      if (once(1.3)) await v.click(v.page.locator('.dock-popover').getByRole('button').first());
      if (once(2.4))
        await v.click(v.page.locator('.dock-popover').getByRole('radio', { name: 'Abierta' }));
    },
  },
  luz: {
    start: DUSK,
    query: DRY,
    seconds: 5,
    async setup(v) {
      const light = v.page.getByRole('button', { name: /^Luz/ });
      if ((await light.getAttribute('aria-pressed')) === 'true') {
        await v.click(light);
        await v.wait(2000);
      }
      const basil = await v.focus('basil_01');
      const tomato = await v.focus('tomato_01');
      const lamp = (await v.centre('grow_light')) ?? tomato;
      await v.setPose(v.at(-0.05, -0.02, 1.6, lerp3(lerp3(basil, tomato, 0.5), lamp, 0.5)));
    },
    async frame(v, t, last) {
      if (t >= 1.0 && last < 1.0) await v.click(v.page.getByRole('button', { name: /^Luz/ }));
    },
  },
  lluvia: {
    start: NOON,
    query: DRY,
    seconds: 8,
    async setup(v) {
      // The roof window open first, so the rain has something to close.
      await v.click(v.page.getByRole('button', { name: 'Aire', exact: true }));
      await v.wait(500);
      await v.click(v.page.locator('.dock-popover').getByRole('radio', { name: 'Abierta' }));
      await v.wait(2500);
      await v.page.keyboard.press('Escape');
      await v.wait(500);
      // Close to the roof window: it shuts as soon as the hub sees the rain.
      const vent = (await v.centre('vent_window')) ?? v.home.target;
      const [x, y, z] = vent;
      await v.setPose(v.at(0.18, 0.0, 1.6, [x, y - 0.12, z]));
    },
    async frame(v, t, last) {
      if (t >= 1.2 && last < 1.2) await situation(v, 'Lluvia');
    },
  },
  rebobinar: {
    start: NOON,
    query: DRY,
    seconds: 7,
    async setup(v) {
      await v.click(v.page.getByRole('button', { name: 'Rebobinar' }));
      await v.wait(600);
      const timeline = v.page.getByRole('region', { name: 'Rebobinar' });
      await v.click(timeline.getByRole('radio', { name: '7 días' }));
      await until(
        v,
        () => !document.querySelector('.timeline-note')?.textContent?.includes('Cargando'),
      );
      await v.wait(800);
      this.range = await v.page.evaluate(() => {
        const input = document.querySelector('.timeline-input');
        return { min: Number(input.min), max: Number(input.max), value: Number(input.value) };
      });
    },
    async frame(v, t) {
      // Back over two days and a half, easing in and out.
      const { max, value } = this.range;
      const from = value || max;
      const s = easeInOut(Math.min(1, Math.max(0, (t - 0.6) / 5.4)));
      const at = Math.round(from - s * 2.5 * 86_400);
      await v.page.evaluate((seconds) => {
        const input = document.querySelector('.timeline-input');
        input.value = String(seconds);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }, at);
    },
  },
  'dia-en-un-minuto': {
    start: Date.parse('2026-11-12T16:35:00Z'),
    query: DRY,
    seconds: 7,
    async setup(v) {
      await openBarRow(v);
      await v.setPose(v.at(-0.1, 0.03, 1.02));
    },
    async frame(v, t, last) {
      if (t >= 0.4 && last < 0.4)
        await v.click(v.page.getByRole('radio', { name: 'Ver un día en un minuto' }));
      if (t >= 1.4 && last < 1.4) {
        const toggle = v.page.locator('.demo-label-toggle');
        if ((await toggle.getAttribute('aria-expanded')) === 'true') await v.click(toggle);
      }
    },
  },
};

// ─────────────────────────────────────────────────── taking them

const args = process.argv.slice(2);
const onlyStills = args.includes('--stills');
const onlyClips = args.includes('--clips');
const ids = args.filter((a) => !a.startsWith('--'));
const wanted = (id) => ids.length === 0 || ids.includes(id);

await ensureServer();
const browser = await launchBrowser();

async function visitFor(shot, scale) {
  const device = shot.device ?? DESK;
  const context = await newVisitorContext(browser, { ...device, scale });
  const storage = {
    ...shot.storage,
    ...(shot.ready === 'live' ? { 'vitreo.quality': 'flat' } : {}),
  };
  await context.addInitScript((entries) => {
    for (const [name, value] of Object.entries(entries)) localStorage.setItem(name, value);
  }, storage);
  const visit = await openVisit(context, {
    start: shot.start,
    query: shot.query ?? '',
    ready: shot.ready ?? 'scene',
  });
  return { visit, context };
}

mkdirSync(STILLS, { recursive: true });
mkdirSync(CLIPS, { recursive: true });

if (!onlyClips) {
  for (const [id, shot] of Object.entries(STILL_SHOTS)) {
    if (!wanted(id)) continue;
    const { visit, context } = await visitFor(shot, 2);
    await shot.take(visit);
    await visit.settle();
    const file = path.join(STILLS, `${DAY}-cuaderno-v3-${id}.png`);
    await visit.shoot(file, { scale: 2 });
    console.log(`picture ${id} → ${path.relative(ROOT, file)}`);
    await context.close();
  }
}

if (!onlyStills) {
  for (const [id, shot] of Object.entries(CLIP_SHOTS)) {
    if (!wanted(id)) continue;
    const dir = path.join(FRAMES, id);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const { visit, context } = await visitFor(shot, 1.25);
    await shot.setup.call(shot, visit);
    const total = Math.round(shot.seconds * FPS);
    let last = -1;
    for (let i = 0; i < total; i++) {
      const t = i / FPS;
      await shot.frame.call(shot, visit, t, last);
      last = t;
      await visit.advance(1000 / FPS);
      await visit.settle();
      await visit.shoot(path.join(dir, `${String(i).padStart(4, '0')}.jpg`), {
        format: 'jpeg',
        quality: 92,
      });
    }
    await context.close();
    const out = path.join(CLIPS, `${id}.mp4`);
    // Silent, small, and playing everywhere: H.264, no sound track.
    runFfmpeg(
      [
        '-framerate',
        String(FPS),
        '-i',
        path.join(dir, '%04d.jpg'),
        '-an',
        '-c:v',
        'libx264',
        '-crf',
        '27',
        '-preset',
        'slow',
        '-pix_fmt',
        'yuv420p',
        '-vf',
        'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        '-movflags',
        '+faststart',
        out,
      ],
      id,
    );
    // Its first frame, as a picture, until it plays (and for reduced motion).
    runFfmpeg(
      ['-i', path.join(dir, '0000.jpg'), path.join(STILLS, `${DAY}-cuaderno-v3-clip-${id}.png`)],
      `${id} poster`,
    );
    console.log(`clip ${id} → ${path.relative(ROOT, out)}`);
  }
}

await browser.close();
stopServer();
