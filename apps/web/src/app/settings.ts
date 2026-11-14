import { IN_DEMO } from './demo.ts';
import { create } from 'zustand';

/**
 * This device's settings (A3, D86), remembered in the browser: they belong
 * to this phone or this computer, not to the greenhouse (plants and the
 * location come with the hub, A4). Appearance (day/night) lives in
 * themeChoice.ts, which the boot script also reads.
 */
export type Quality = 'auto' | 'high' | 'low' | 'flat';
/** What the scene actually does. */
export type EffectiveQuality = 'high' | 'low' | 'flat';

const QUALITY_KEY = 'vitreo.quality';
/** Ambient sound (A9): off unless chosen, and its volume (0–1). */
const SOUND_KEY = 'vitreo.sound';
const VOLUME_KEY = 'vitreo.volume';
/**
 * The devices' own sounds (D121) and the interface's (D128): each its own
 * switch since D131, not under the ambient one. Never chosen, each follows
 * the ambient switch as it was: off on a first visit (D96), and as before
 * for whoever had the sound on.
 */
const DEVICE_SOUNDS_KEY = 'vitreo.deviceSounds';
const TOUCH_SOUNDS_KEY = 'vitreo.touchSounds';

function initialEffect(key: string): boolean {
  const stored = read(key);
  return stored === null ? read(SOUND_KEY) === '1' : stored !== '0';
}
export const DEFAULT_VOLUME = 0.6;

function initialVolume(): number {
  const stored = Number(read(VOLUME_KEY));
  return read(VOLUME_KEY) !== null && Number.isFinite(stored)
    ? Math.min(1, Math.max(0, stored))
    : DEFAULT_VOLUME;
}
/** The welcome has been seen on this device. */
export const ONBOARDED_KEY = 'vitreo.onboarded';

/**
 * Whether the welcome was seen. At home, once on this device. In the demo
 * (D126), once a visit: everything else starts anew when it is opened again,
 * so the welcome that says so does too. The e2e tests skip it with "forever".
 */
function readOnboarded(): boolean {
  if (!IN_DEMO) return read(ONBOARDED_KEY) === '1';
  try {
    if (sessionStorage.getItem(ONBOARDED_KEY) === '1') return true;
  } catch {
    // Storage blocked: it shows again, which is harmless.
  }
  return read(ONBOARDED_KEY) === 'forever';
}

function writeOnboarded(onboarded: boolean): void {
  if (!IN_DEMO) {
    write(ONBOARDED_KEY, onboarded ? '1' : '0');
    return;
  }
  try {
    sessionStorage.setItem(ONBOARDED_KEY, onboarded ? '1' : '0');
  } catch {
    // Not remembered; it applies this visit.
  }
}

export function isQuality(value: unknown): value is Quality {
  return value === 'auto' || value === 'high' || value === 'low' || value === 'flat';
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered (private window, storage blocked); it applies this visit.
  }
}

/** ?quality= wins (captures and tests), then what was chosen, then auto. */
function initialQuality(search: string): Quality {
  const fromUrl = new URLSearchParams(search).get('quality');
  if (isQuality(fromUrl)) return fromUrl;
  const stored = read(QUALITY_KEY);
  return isQuality(stored) ? stored : 'auto';
}

interface SettingsState {
  quality: Quality;
  /** Auto lowered the quality this visit because frames were too slow. */
  autoLowered: boolean;
  /** The 3D could not start on this device (no WebGL, or it failed). */
  webglFailed: boolean;
  onboarded: boolean;
  /** Ambient sound (A9, D96): off by default; it starts only after a tap. */
  sound: boolean;
  volume: number;
  deviceSounds: boolean;
  touchSounds: boolean;
  setQuality: (quality: Quality) => void;
  setSound: (sound: boolean) => void;
  setVolume: (volume: number) => void;
  setDeviceSounds: (on: boolean) => void;
  setTouchSounds: (on: boolean) => void;
  lowerAuto: () => void;
  markWebglFailed: () => void;
  setOnboarded: (onboarded: boolean) => void;
}

export const useSettings = create<SettingsState>()((set) => ({
  quality: initialQuality(typeof location === 'undefined' ? '' : location.search),
  autoLowered: false,
  webglFailed: false,
  onboarded: readOnboarded(),
  sound: read(SOUND_KEY) === '1',
  volume: initialVolume(),
  deviceSounds: initialEffect(DEVICE_SOUNDS_KEY),
  touchSounds: initialEffect(TOUCH_SOUNDS_KEY),
  setQuality: (quality) => {
    write(QUALITY_KEY, quality);
    set({ quality });
  },
  setSound: (sound) => {
    write(SOUND_KEY, sound ? '1' : '0');
    set({ sound });
  },
  setDeviceSounds: (deviceSounds) => {
    write(DEVICE_SOUNDS_KEY, deviceSounds ? '1' : '0');
    set({ deviceSounds });
  },
  setTouchSounds: (touchSounds) => {
    write(TOUCH_SOUNDS_KEY, touchSounds ? '1' : '0');
    set({ touchSounds });
  },
  setVolume: (volume) => {
    const clamped = Math.min(1, Math.max(0, volume));
    write(VOLUME_KEY, clamped.toString());
    set({ volume: clamped });
  },
  lowerAuto: () => {
    set({ autoLowered: true });
  },
  markWebglFailed: () => {
    set({ webglFailed: true });
  },
  setOnboarded: (onboarded) => {
    writeOnboarded(onboarded);
    set({ onboarded });
  },
}));

/** What the scene does now: no 3D if it cannot run; Auto may have lowered it. */
export function effectiveQuality(state: {
  quality: Quality;
  autoLowered: boolean;
  webglFailed: boolean;
}): EffectiveQuality {
  if (state.webglFailed || state.quality === 'flat') return 'flat';
  if (state.quality === 'auto') return state.autoLowered ? 'low' : 'high';
  return state.quality;
}

export function useEffectiveQuality(): EffectiveQuality {
  return useSettings(effectiveQuality);
}

/** Whether this browser can draw WebGL at all (checked once, before loading the 3D). */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null || canvas.getContext('webgl') !== null;
  } catch {
    return false;
  }
}
