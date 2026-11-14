/**
 * Geometry of the small history charts (A5, D88), in a 0–100 box that the
 * SVG stretches to its size. Pure functions: tested without a browser.
 */
export interface Series {
  /** Bucket starts, Unix s. */
  ts: readonly number[];
  /** One value per bucket; null = no reading (a gap, or a broken sensor). */
  values: readonly (number | null)[];
  step: number;
  from: number;
  to: number;
}

/** x (0–100) of an instant. */
export const xOf = (series: Series, t: number): number =>
  ((t - series.from) / (series.to - series.from)) * 100;

/** y (0–100, 0 at the top) of a value between 0 and 1. */
export const yOf = (value: number): number => (1 - Math.min(1, Math.max(0, value))) * 100;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * The line through the readings, at the middle of each bucket. It breaks at
 * every missing value: a gap is drawn as a gap, never bridged. A reading
 * alone between gaps is a dot (a zero-length segment with a round cap).
 */
export function linePath(series: Series): string {
  const parts: string[] = [];
  let open = false;
  series.values.forEach((value, i) => {
    if (value === null) {
      open = false;
      return;
    }
    const x = round(xOf(series, (series.ts[i] ?? 0) + series.step / 2));
    const y = round(yOf(value));
    const next = series.values[i + 1];
    if (!open) {
      parts.push(`M${x.toString()} ${y.toString()}`);
      // Alone: a dot.
      if (next === null || next === undefined) parts.push('h0.01');
      open = true;
    } else {
      parts.push(`L${x.toString()} ${y.toString()}`);
    }
  });
  return parts.join(' ');
}

export interface Span {
  start: number;
  end: number;
}

/**
 * Runs of buckets with no reading, as time spans (Unix s). Only from the
 * first reading on: before it there is no history yet, which is not a gap.
 */
export function gapSpans(series: Series, since: number | null): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;
  for (const [i, value] of series.values.entries()) {
    const t = series.ts[i] ?? 0;
    const before = since === null || t + series.step <= since;
    if (value === null && !before) {
      start ??= t;
    } else if (start !== null) {
      spans.push({ start, end: t });
      start = null;
    }
  }
  if (start !== null) spans.push({ start, end: series.to });
  return spans;
}

/** The bucket under an x (0–100), clamped to the series. */
export function indexAt(series: Series, x: number): number {
  const t = series.from + (x / 100) * (series.to - series.from);
  const i = Math.floor((t - (series.ts[0] ?? series.from)) / series.step);
  return Math.min(Math.max(i, 0), series.ts.length - 1);
}

/** How many buckets hold a reading. */
export const readings = (series: Series): number =>
  series.values.filter((value) => value !== null).length;

/** The series with its values mapped into 0–1 over [min, max], for `yOf` and `linePath`. */
export function normalized(series: Series, [min, max]: readonly [number, number]): Series {
  const span = max - min || 1;
  return {
    ...series,
    values: series.values.map((value) => (value === null ? null : (value - min) / span)),
  };
}

/**
 * A round range for the y axis around every value (A11): its ends on whole
 * `unit`s, at least `minSpan` wide, never below `floor` (lux and % start at
 * 0). Without values, `fallback`.
 */
export function niceDomain(
  values: readonly (number | null)[],
  {
    unit,
    minSpan,
    floor,
    fallback,
  }: {
    unit: number;
    minSpan: number;
    floor?: number;
    fallback: readonly [number, number];
  },
): [number, number] {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return [fallback[0], fallback[1]];
  let min = Math.floor(Math.min(...known) / unit) * unit;
  let max = Math.ceil(Math.max(...known) / unit) * unit;
  if (max - min < minSpan) {
    const grow = Math.ceil((minSpan - (max - min)) / 2 / unit) * unit;
    min -= grow;
    max += grow;
  }
  if (floor !== undefined && min < floor) {
    max += floor - min;
    min = floor;
  }
  return [min, max];
}

/** The value of a series at an instant (the bucket that holds it), or null. */
export function valueAt(series: Series, t: number): number | null {
  const i = Math.floor((t - (series.ts[0] ?? series.from)) / series.step);
  return i < 0 || i >= series.values.length ? null : (series.values[i] ?? null);
}

/** Runs of buckets where something was on, as time spans. */
export function onSpans(series: Series): Span[] {
  const spans: Span[] = [];
  let start: number | null = null;
  for (const [i, value] of series.values.entries()) {
    const t = series.ts[i] ?? 0;
    if (value !== null && value > 0) start ??= t;
    else if (start !== null) {
      spans.push({ start, end: t });
      start = null;
    }
  }
  if (start !== null) spans.push({ start, end: series.to });
  return spans;
}
