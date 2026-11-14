// The public demo's greenhouse (D66, D103), in a Web Worker: the same
// simulated device as the daily simulator (@vitreo/sim-core, safety limits
// included), with the page in place of the broker; its hub, the hub's own
// code on sql.js (demo/hub.ts), answering the page's API requests; and the
// sky over both, simulated (demo/outside.ts, D111). All on the demo's own
// clock, at 60× or a day a minute (D112), carrying on from the recorded
// week (week.json), which ends today. Nothing leaves the visitor's browser.
import { addExampleNotes, sowExamplePlants } from './examples.ts';
import { topic } from '@vitreo/shared';
import type { PortableHub } from '@vitreo/hub/portable';

import weekUrl from '../../demo/week.json?url';
import { DemoEngine } from './engine.ts';
import type { Delivery, HubPast } from './engine.ts';
import { DemoOutside } from './outside.ts';
import { ARRIVAL_SPEED, DRY_ARRIVAL, videoWallStart } from './protocol.ts';
import type { DemoSpeed, ToPage, ToWorker } from './protocol.ts';
import { DEMO_DEVICE_ID, DEMO_LOCATION, DEMO_TIME_ZONE } from './setup.ts';
import { arrivalPast, demoWeekFile } from './week.ts';

// Development only (the landing video, scripts/landing-video.mjs): the
// page's clock is this one's, moved on frame by frame (`video-wall`), so a
// recording comes out the same every time. In a build the branch is gone.
const VIDEO_START = import.meta.env.DEV ? videoWallStart(self.name) : null;
let videoWall = VIDEO_START ?? 0;
if (import.meta.env.DEV && VIDEO_START !== null) Date.now = () => videoWall;

/** How often the simulated time is moved on (ms of the wall clock). */
const STEP_EVERY_MS = 100;
/** At most this much simulated time per step; a slower device runs a little slower. */
const MAX_SECONDS_PER_STEP = 600;
/** The page's reading at most this often (the hub hears every one). */
const READING_EVERY_MS = 200;
/** The clock is told again this often, so the page's never drifts. */
const CLOCK_EVERY_MS = 2_000;

/** The demo's clock: simulated ms = `simAt` + (wall ms − `wallAt`) × `speed`. */
let speed: DemoSpeed = ARRIVAL_SPEED;
let clock = { simAt: Date.now(), wallAt: Date.now() };
const simNow = () => clock.simAt + (Date.now() - clock.wallAt) * speed;

function post(message: ToPage): void {
  postMessage(message);
}

function tellTheClock(): void {
  post({ kind: 'clock', simAt: clock.simAt, wallAt: clock.wallAt, speed });
}

// To the page: everything, except that readings come at most every 200 ms
// (at a day a minute the device sends dozens a second); the last one always.
let reading: Delivery | null = null;
let readingSentAt = 0;
function toPage(message: Delivery): void {
  if (message.topic.endsWith('/telemetry')) {
    reading = message;
    return;
  }
  post({ kind: 'message', topic: message.topic, payload: message.payload });
}
function flushReading(force = false): void {
  if (!reading) return;
  const now = Date.now();
  if (!force && now - readingSentAt < READING_EVERY_MS) return;
  post({ kind: 'message', topic: reading.topic, payload: reading.payload });
  reading = null;
  readingSentAt = now;
}

const arrival = Date.now();
const outside = new DemoOutside(arrival, DEMO_TIME_ZONE, {
  shower: self.name !== DRY_ARRIVAL && VIDEO_START === null,
});

// The recorded week, and the hub, each in a chunk of its own, together.
const week = fetch(weekUrl)
  .then((response) => response.json())
  .then((json) => demoWeekFile.parse(json));
const hubModule = import('./hub.ts');

let engine: DemoEngine | null = null;

const started = week.then((file) => {
  // The device carries on from the last hour of the week before now, and
  // catches up to now in a moment (an hour at most, a second at a time).
  const past = arrivalPast(file, arrival);
  const running = new DemoEngine({
    startMs: past.memory.savedAt,
    outside,
    memory: past.memory,
    onMessage: toPage,
  });
  running.advanceTo(arrival);
  clock = { simAt: running.now, wallAt: Date.now() };
  engine = running;
  tellTheClock();
  flushReading(true);
  setInterval(step, STEP_EVERY_MS);
  setInterval(tellTheClock, CLOCK_EVERY_MS);
  return {
    running,
    past: {
      fromMs: past.fromMs,
      rawFromMs: past.rawFromMs,
      messages: past.messages,
      summaries: past.summaries,
    } satisfies HubPast,
  };
});

function step(): void {
  if (!engine) return;
  const target = simNow();
  engine.advanceTo(target, MAX_SECONDS_PER_STEP);
  // Behind (a slow device, a tab in the background): the clock waits for it.
  if (target - engine.now > MAX_SECONDS_PER_STEP * 1000) {
    clock = { simAt: engine.now, wallAt: Date.now() };
    tellTheClock();
  }
  // The recorded week's hourly summaries, one per step until done.
  engine.catchUp();
  flushReading();
}

const ready: Promise<PortableHub | null> = Promise.all([started, hubModule])
  .then(([{ running, past }, { startDemoHub }]) =>
    startDemoHub({
      device: DEMO_DEVICE_ID,
      timeZone: DEMO_TIME_ZONE,
      seedLocation: { ...DEMO_LOCATION },
      ...running.hubWiring(),
    }).then(async (hub) => {
      running.attach(hub, past);
      if (hub.context.journal) addExampleNotes(hub.context.journal, running.now);
      await sowExamplePlants((request) => hub.request(request), running.now, DEMO_TIME_ZONE);
      flushReading(true);
      post({ kind: 'hub', started: true });
      return hub;
    }),
  )
  .catch((error: unknown) => {
    // No hub (its WebAssembly did not load): the greenhouse still runs, with
    // the rules it keeps, and the page says the hub is not answering, as at home.
    console.warn(`[vitreo] demo hub: ${String(error)}`);
    post({ kind: 'hub', started: false });
    return null;
  });

async function answer(request: Extract<ToWorker, { kind: 'request' }>): Promise<void> {
  const hub = await ready;
  if (!hub) {
    // As nginx answers when the hub is down: the page says so calmly.
    post({
      kind: 'response',
      id: request.id,
      status: 503,
      type: 'application/json; charset=utf-8',
      headers: {},
      body: JSON.stringify({ error: 'the demo hub did not start' }),
    });
    return;
  }
  const response = await hub.request({
    method: request.method,
    url: request.url,
    ...(request.body === undefined ? {} : { body: request.body }),
    ...(request.contentType === undefined ? {} : { contentType: request.contentType }),
  });
  post({ kind: 'response', id: request.id, ...response });
}

addEventListener('message', (event: MessageEvent<ToWorker>) => {
  const data = event.data;
  // Development only: the landing video's page has moved its clock on.
  if (import.meta.env.DEV && VIDEO_START !== null && data.kind === 'video-wall') {
    videoWall = data.at;
    step();
    flushReading(true);
    post({ kind: 'video-ack' });
    return;
  }
  switch (data.kind) {
    case 'request':
      void answer(data);
      return;
    case 'speed':
      // From this instant on, at the new pace.
      clock = { simAt: simNow(), wallAt: Date.now() };
      speed = data.speed;
      tellTheClock();
      return;
    case 'scenario':
      // "Probar situaciones": it happens now, and the hub hears it at once.
      engine?.scenario(data.name);
      flushReading(true);
      return;
    case 'publish':
      // An order from the page: the hub records it, the device acts on it.
      if (data.topic === topic(DEMO_DEVICE_ID, 'cmd')) {
        engine?.command(data.payload);
        flushReading(true);
      }
  }
});
