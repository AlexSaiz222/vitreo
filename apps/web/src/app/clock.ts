/**
 * The app's "now" (ms). At home, the wall clock. In the public demo (D112),
 * the demo's own clock, which runs at an hour or a day a minute: the sun,
 * the day/night theme, "hace 3 min", today's history and the rewind follow
 * it. Set only by the demo's link (data/demoLink.ts).
 */
let source: () => number = Date.now;

export const now = (): number => source();

export function setClock(next: (() => number) | null): void {
  source = next ?? Date.now;
}
