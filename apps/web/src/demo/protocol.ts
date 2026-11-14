/**
 * Between the page and the demo's worker: the same topics and payloads as
 * MQTT (docs/05), so the page reads them through the same router and the
 * same zod schemas; and the hub's API requests, answered by the hub's own
 * code in the worker (D103, step 2). Only the transport is different.
 */
export type ToPage =
  | { kind: 'message'; topic: string; payload: string }
  /** The hub has started (or could not): until then, a request only waits. */
  | { kind: 'hub'; started: boolean }
  /**
   * The demo's clock (D112): simulated ms = `simAt` + (wall ms − `wallAt`)
   * × `speed`. Told on every change, and every few seconds.
   */
  | { kind: 'clock'; simAt: number; wallAt: number; speed: DemoSpeed }
  | {
      kind: 'response';
      id: number;
      status: number;
      type: string;
      headers: Record<string, string>;
      body: string | Uint8Array;
    }
  /** Development only (the landing video): the worker has caught up with `video-wall`. */
  | { kind: 'video-ack' };

/** The worker's name when the visitor arrives without the shower (`?cielo=seco`). */
export const DRY_ARRIVAL = 'vitreo-demo:seco';

/**
 * Development only (the landing video, `?video`): the worker is named
 * `video:<wall ms>` and takes its wall clock from the page, frame by frame,
 * so a recording is the same every time. Arrives without the shower.
 */
export const VIDEO_WORKER_PREFIX = 'video:';

/** The start of a video worker's wall clock, or null for any other worker. */
export function videoWallStart(name: string): number | null {
  if (!name.startsWith(VIDEO_WORKER_PREFIX)) return null;
  const at = Number(name.slice(VIDEO_WORKER_PREFIX.length));
  return Number.isFinite(at) ? at : null;
}

/** "Probar situaciones" (D103, D111): what the visitor can make happen. */
export type DemoScenario = 'rain' | 'heat' | 'tank' | 'sensor' | 'offline' | 'normal';

/**
 * How fast the demo runs (D103, D112): an hour a minute, or a day a minute
 * ("Ver un día en un minuto"). It arrives at 60×.
 */
export const DEMO_SPEEDS = [60, 1440] as const;
export type DemoSpeed = (typeof DEMO_SPEEDS)[number];
export const ARRIVAL_SPEED: DemoSpeed = 60;

export type ToWorker =
  | { kind: 'publish'; topic: string; payload: string }
  | { kind: 'scenario'; name: DemoScenario }
  | { kind: 'speed'; speed: DemoSpeed }
  /** Development only (the landing video): the page's wall clock now; answered by `video-ack`. */
  | { kind: 'video-wall'; at: number }
  | {
      kind: 'request';
      id: number;
      method: string;
      /** From `/api/v1`, with the query string. */
      url: string;
      body?: string | Uint8Array;
      contentType?: string;
    };
