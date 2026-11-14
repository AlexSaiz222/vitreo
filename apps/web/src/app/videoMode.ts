/**
 * Development only: the landing video (apps/web/scripts/landing-video.mjs)
 * drives the real app from outside, frame by frame, through
 * `window.__vitreo`. On with `?video` under `vite` (dev); every caller also
 * checks `import.meta.env.DEV`, so none of it reaches a build.
 *
 * Time is the page's own, faked by Playwright (`page.clock`): Date,
 * timers, requestAnimationFrame and performance.now. What it does not
 * reach, this moves on with it: the demo's worker (`syncWorker`) and the
 * CSS transitions and animations (`settle`).
 */

import type { MixInput } from '../features/sound/mix.ts';

/** Where the camera looks from: around `target`, the orthographic zoom relative to the home framing. */
export interface CameraPose {
  target: [number, number, number];
  /** Around the vertical (rad), as three.js Spherical's theta. */
  azimuth: number;
  /** From straight above (rad), as Spherical's phi. */
  polar: number;
  /** 1 = the home framing of the whole diorama. */
  zoom: number;
}

export interface VideoApi {
  /** The page's wall clock to the demo's worker; resolves once it has caught up. */
  syncWorker?: () => Promise<void>;
  /** Holds the camera at `pose` every frame; null hands it back to the app. */
  setPose?: (pose: CameraPose | null) => void;
  getPose?: () => CameraPose;
  /** The home view, as a pose. */
  homePose?: () => CameraPose;
  /** Where the app looks at a plant (`cam_focus_<id>`), or null. */
  focusOf?: (zone: string) => [number, number, number] | null;
  /** The centre of one of the model's objects (`fan`, `vent_window`, `grow_light`…), or null. */
  centerOf?: (name: string) => [number, number, number] | null;
  /** Every CSS transition and animation, paused at the page's (faked) time. */
  settle?: () => void;
  /** The closing card over the scene, 0–1. */
  endCard?: (opacity: number) => void;
  /** What the greenhouse sounds like now: the ambient mix and the devices, for the soundtrack. */
  sample?: () => VideoSample;
}

export interface VideoSample {
  mix: MixInput;
  actuators: { pump: boolean; growLight: boolean; fan: boolean; vent: number } | null;
  live: boolean;
}

export function inVideoMode(): boolean {
  return import.meta.env.DEV && new URLSearchParams(location.search).has('video');
}

export function videoApi(): VideoApi {
  const host = window as unknown as { __vitreo?: VideoApi };
  host.__vitreo ??= {};
  return host.__vitreo;
}

/** When each animation started, on the page's clock. */
const started = new WeakMap<Animation, number>();

/**
 * Pauses every animation and sets it to where the page's clock says it is.
 * A new one is taken as started where it already is now (a negative delay
 * included), give or take the few real milliseconds since it was made.
 */
export function settleAnimations(): void {
  const now = performance.now();
  for (const animation of document.getAnimations()) {
    let start = started.get(animation);
    if (start === undefined) {
      const at = Number(animation.currentTime ?? 0);
      start = now - at;
      started.set(animation, start);
    }
    animation.pause();
    animation.currentTime = now - start;
  }
}

/** The closing card: the app's own fonts and colours, over a soft veil of the page. */
export function showEndCard(opacity: number): void {
  let card = document.getElementById('video-end-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'video-end-card';
    card.innerHTML =
      '<p class="video-end-title">Vitreo</p><p class="video-end-line">Probar la demo · vitreo-demo.vercel.app</p>';
    const style = document.createElement('style');
    style.textContent = `
      #video-end-card {
        position: fixed; inset: 0; z-index: 9999; display: grid; place-content: center;
        gap: var(--space-3); text-align: center; pointer-events: none;
        background: color-mix(in srgb, var(--bg) 62%, transparent);
      }
      .video-end-title {
        margin: 0; font-family: var(--font-display); font-size: calc(var(--text-40) * 2.4);
        line-height: 1; color: var(--ink);
      }
      .video-end-line {
        margin: 0; font-family: var(--font-sans); font-size: calc(var(--text-28) * 1.15);
        font-weight: var(--weight-medium); color: var(--ink);
      }`;
    document.head.append(style);
    document.body.append(card);
  }
  card.style.opacity = String(opacity);
  card.style.display = opacity <= 0 ? 'none' : 'grid';
}
