/**
 * Prototype switches read from the URL (phase 1), so both cameras and both
 * themes can be compared side by side and captured by Playwright:
 *
 *   ?camera=orthographic | perspective
 *   ?theme=day | night
 *   ?zoom=1.8            (like the user zooming in; 1 = default framing)
 *   ?stats               (frames per second, to check performance on a phone)
 *   ?azimuth=221         (degrees around the diorama; 221 looks from the back)
 *   ?look=tank           (centre the view on a node of the model, for close-ups)
 *
 * Without ?theme=, day and night follow the real sun (src/app/dayNight.ts).
 */
export type CameraKind = 'orthographic' | 'perspective';
export type ThemeChoice = 'day' | 'night';

export interface ViewOptions {
  camera: CameraKind;
  theme: ThemeChoice | null;
  zoom: number;
  stats: boolean;
  /** Degrees; null keeps the default view (D60). */
  azimuth: number | null;
  /** A node of the model to centre the view on; null looks at cam_home. */
  look: string | null;
}

export function readViewOptions(search: string): ViewOptions {
  const params = new URLSearchParams(search);
  const camera = params.get('camera');
  const theme = params.get('theme');
  const zoom = Number(params.get('zoom') ?? '1');
  const azimuth = params.has('azimuth') ? Number(params.get('azimuth')) : Number.NaN;
  const look = params.get('look');
  return {
    camera: camera === 'perspective' ? 'perspective' : 'orthographic',
    theme: theme === 'day' || theme === 'night' ? theme : null,
    zoom: Number.isFinite(zoom) ? Math.min(3.5, Math.max(0.75, zoom)) : 1,
    stats: params.has('stats'),
    azimuth: Number.isFinite(azimuth) ? azimuth : null,
    look: look !== null && look !== '' ? look : null,
  };
}

export const viewOptions = readViewOptions(typeof location === 'undefined' ? '' : location.search);
