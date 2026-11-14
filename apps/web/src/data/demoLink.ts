import { setClock } from '../app/clock.ts';
import { inVideoMode, videoApi } from '../app/videoMode.ts';
import { DRY_ARRIVAL, VIDEO_WORKER_PREFIX } from '../demo/protocol.ts';
import type { ToPage, ToWorker } from '../demo/protocol.ts';
import { CommandService } from './commands.ts';
import { setDemoSpeedSender, useDemoSpeed } from './demoClock.ts';
import { setDemoScenarios } from './demoScenarios.ts';
import { setWateringOnWallClock } from './store.ts';
import { setDemoHub } from './hubFetch.ts';
import type { Connection } from './mqttClient.ts';
import { routeMessage } from './router.ts';
import { STALE_AFTER_MS } from './store.ts';
import type { GreenhouseStore } from './store.ts';

/**
 * How often the store's "now" moves on: every second, as a simulated
 * minute or more goes by in one (5 s at home, mqttClient.ts).
 */
const CLOCK_TICK_MS = 1_000;

/**
 * The public demo's link (D66, D103): the greenhouse runs in a Web Worker
 * in this browser and speaks the MQTT contract; the store, the commands
 * with their acks and the scene do not know the difference. Built only
 * into the demo (`vite --mode demo`), which has no MQTT client at all.
 */
export function connectDemo(store: GreenhouseStore): Connection {
  // `?cielo=seco`: the visitor arrives without the shower (the e2e tests of
  // "Probar situaciones › Lluvia"). Told by the worker's name: it reads it
  // before its first tick.
  const dry = new URLSearchParams(location.search).get('cielo') === 'seco';
  // Development only (the landing video): the worker runs on this page's clock.
  const video = import.meta.env.DEV && inVideoMode();
  const worker = new Worker(new URL('../demo/worker.ts', import.meta.url), {
    type: 'module',
    name: video
      ? `${VIDEO_WORKER_PREFIX}${Date.now().toString()}`
      : dry
        ? DRY_ARRIVAL
        : 'vitreo-demo',
  });
  let alive = true;
  let caughtUp: (() => void) | null = null;
  if (import.meta.env.DEV && video) {
    videoApi().syncWorker = () =>
      new Promise<void>((resolve) => {
        caughtUp = resolve;
        const message: ToWorker = { kind: 'video-wall', at: Date.now() };
        worker.postMessage(message);
      });
  }
  document.title = 'Vitreo · Demo';

  // The demo's clock (D112), as the worker tells it, for the whole page. It
  // never goes back: if the worker falls behind, the page waits for it.
  let told: Extract<ToPage, { kind: 'clock' }> | null = null;
  let shown = Date.now();
  const now = () => {
    const at = told ? told.simAt + (Date.now() - told.wallAt) * told.speed : Date.now();
    shown = Math.max(shown, at);
    return shown;
  };
  setClock(now);
  setDemoSpeedSender((speed) => {
    const message: ToWorker = { kind: 'speed', speed };
    worker.postMessage(message);
  });

  const commands = new CommandService(
    store,
    {
      get connected() {
        return alive;
      },
      publish: (name, payload) => {
        const message: ToWorker = { kind: 'publish', topic: name, payload };
        worker.postMessage(message);
        return Promise.resolve();
      },
    },
    { now },
  );

  // The hub's API, answered by the hub's code in the worker (D103, step 2).
  let nextId = 1;
  // Starting (its WebAssembly on the way) is not "down": a request waits.
  let hubStarting = true;
  const pending = new Map<number, (answer: Extract<ToPage, { kind: 'response' }>) => void>();
  setDemoHub(async (url, init) => {
    const id = nextId++;
    const raw = init?.body;
    const body =
      raw instanceof Blob
        ? new Uint8Array(await raw.arrayBuffer())
        : typeof raw === 'string'
          ? raw
          : undefined;
    const contentType =
      new Headers(init?.headers).get('content-type') ?? (raw instanceof Blob ? raw.type : null);
    const answer = new Promise<Extract<ToPage, { kind: 'response' }>>((resolve, reject) => {
      pending.set(id, resolve);
      // The caller's timeout, as with fetch: a hub that does not answer is
      // "down". Not while it starts: then the answer only comes later.
      init?.signal?.addEventListener('abort', () => {
        if (hubStarting) return;
        pending.delete(id);
        reject(new DOMException('timed out', 'AbortError'));
      });
    });
    const request: ToWorker = {
      kind: 'request',
      id,
      method: init?.method ?? 'GET',
      url: new URL(url, location.href).pathname + new URL(url, location.href).search,
      ...(body === undefined ? {} : { body }),
      ...(contentType ? { contentType } : {}),
    };
    worker.postMessage(request);
    const { status, type, headers, body: payload } = await answer;
    // A copy on its own ArrayBuffer: what Response takes.
    const bytes = typeof payload === 'string' ? payload : new Uint8Array(payload);
    return new Response(status === 204 ? null : bytes, {
      status,
      headers: { 'content-type': type, ...headers },
    });
  });

  // At 60× a watering lasts a blink: on screen it takes its real seconds (D128).
  setWateringOnWallClock(true);
  setDemoScenarios((name) => {
    const message: ToWorker = { kind: 'scenario', name };
    worker.postMessage(message);
  });

  store.getState().setLink('connected', now());
  worker.addEventListener('message', (event: MessageEvent<ToPage>) => {
    const data = event.data;
    if (import.meta.env.DEV && data.kind === 'video-ack') {
      caughtUp?.();
      caughtUp = null;
      return;
    }
    if (data.kind === 'hub') {
      hubStarting = false;
      return;
    }
    if (data.kind === 'response') {
      pending.get(data.id)?.(data);
      pending.delete(data.id);
      return;
    }
    if (data.kind === 'clock') {
      told = data;
      useDemoSpeed.setState({ speed: data.speed });
      // Stale after the same 2 minutes of the wall clock, at any speed.
      store.getState().setStaleAfter(STALE_AFTER_MS * data.speed);
      store.getState().tick(now());
      return;
    }
    if (data.kind === 'message') routeMessage(store, commands, data.topic, data.payload, now());
  });
  worker.addEventListener('error', (event) => {
    console.warn(`[vitreo] demo greenhouse: ${event.message}`);
    alive = false;
    store.getState().setLink('offline', now());
  });

  const clock = setInterval(() => {
    store.getState().tick(now());
  }, CLOCK_TICK_MS);

  return {
    commands,
    close() {
      clearInterval(clock);
      setDemoHub(null);
      setDemoScenarios(null);
      setWateringOnWallClock(false);
      setDemoSpeedSender(null);
      setClock(null);
      commands.dispose();
      worker.terminate();
    },
  };
}
