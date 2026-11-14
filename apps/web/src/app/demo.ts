/**
 * The public demo build (`vite --mode demo`, D66, D103). A constant, so the
 * home build leaves the demo's parts out and the demo build what it hides
 * (D110): web push, the CSV downloads and the journal's photos, which only
 * make sense with the real hub.
 */
export const IN_DEMO = import.meta.env.MODE === 'demo';
