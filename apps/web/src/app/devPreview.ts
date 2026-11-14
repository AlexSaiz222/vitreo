/**
 * Development-only switches for phase A (docs/09), read from the URL. Not in
 * production builds: main.tsx only looks at them under import.meta.env.DEV.
 *
 *   ?ui=lab           the primitives catalogue instead of the app
 */
export interface DevPreview {
  lab: boolean;
}

export function readDevPreview(search: string): DevPreview {
  return { lab: new URLSearchParams(search).get('ui') === 'lab' };
}
