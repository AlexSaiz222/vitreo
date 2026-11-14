/**
 * Where to put the labels and warnings of the plants (A2), given where the
 * plants are on screen. Pure: no DOM, no three.js (unit-tested).
 *
 * Rules (docs/03, D83):
 * - A marker sits just above its plant. If that spot is taken (another
 *   marker, the header, the dock, the sheet), it moves up or down in steps,
 *   or sideways, with a thin leader back to the plant. Markers never cover
 *   each other nor the interface. Among the free spots it takes the calmest
 *   one (D134): near its plant, not over a neighbouring plant, and with a
 *   leader that crosses no other marker and no other leader.
 * - A plant outside the free area (off screen, or under the header, the dock
 *   or the sheet) gets an edge marker on the border of the free area,
 *   pointing towards it.
 * - Optional markers (plain labels) are dropped when there is no room and
 *   never go to the edge; warnings always find a place.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Marker {
  id: string;
  /** The plant on screen (CSS px). */
  point: { x: number; y: number };
  w: number;
  h: number;
  /** Lower goes first (warnings before labels). */
  priority: number;
  /** A label that may be left out when there is no room. */
  optional: boolean;
}

export type Placement =
  | { id: string; mode: 'anchored'; x: number; y: number; leader: boolean }
  /** `angle`: direction from the marker to the plant, radians (0 = right, π/2 = down). */
  | { id: string; mode: 'edge'; x: number; y: number; angle: number };

/** Space between a marker and its plant, and between markers. */
export const MARKER_GAP_PX = 6;
/** A marker further than this from its natural place gets a leader. */
const LEADER_PX = 10;
/** How many steps up/down and sideways to try before giving up on a spot. */
const STEPS = 6;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (r: Rect, area: Rect) =>
  r.x >= area.x && r.y >= area.y && r.x + r.w <= area.x + area.w && r.y + r.h <= area.y + area.h;

const contains = (area: Rect, p: { x: number; y: number }) =>
  p.x >= area.x && p.x <= area.x + area.w && p.y >= area.y && p.y <= area.y + area.h;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * What a spot costs, in pixels of distance from the natural one (D134):
 * covering a whole neighbouring plant, covering its own plant, a leader that
 * crosses another marker or another leader, and each pixel moved sideways.
 */
const COST = { neighbour: 120, own: 220, crossing: 400, sideways: 1.5 } as const;

interface Point {
  x: number;
  y: number;
}

/** How much of `a` lies inside `b`, 0-1. */
function covered(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? (w * h) / (a.w * a.h || 1) : 0;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const side = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

function segmentCrossesRect(a: Point, b: Point, r: Rect): boolean {
  if (contains(r, a) || contains(r, b)) return true;
  const corners: Point[] = [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
  return corners.some((corner, i) => {
    const next = corners[(i + 1) % 4];
    return next !== undefined && segmentsCross(a, b, corner, next);
  });
}

/** The leader of a marker at `spot`: from its plant to the nearer edge of the marker. */
function leaderOf(m: Marker, spot: Point): [Point, Point] {
  return [m.point, { x: spot.x + m.w / 2, y: spot.y + (spot.y < m.point.y ? m.h : 0) }];
}

/** Spots to try for a marker over its plant: above, further up/down, and sideways. */
function candidates(m: Marker): { x: number; y: number }[] {
  const above = { x: m.point.x - m.w / 2, y: m.point.y - m.h - MARKER_GAP_PX };
  const below = { x: m.point.x - m.w / 2, y: m.point.y + MARKER_GAP_PX };
  const step = m.h + MARKER_GAP_PX;
  const spots = [above];
  for (let k = 1; k <= STEPS; k++) {
    spots.push({ x: above.x, y: above.y - k * step });
    spots.push({ x: below.x, y: below.y + (k - 1) * step });
  }
  for (const side of [1, -1]) {
    for (const reach of [0.5, 1]) {
      const shift = side * (m.w * reach + MARKER_GAP_PX);
      spots.push(
        { x: above.x + shift, y: above.y },
        { x: above.x + shift, y: above.y - step },
        { x: below.x + shift, y: below.y },
      );
    }
  }
  return spots;
}

/** Where a straight line from the centre of `area` towards `p` leaves the area. */
function edgePoint(area: Rect, p: { x: number; y: number }) {
  const cx = area.x + area.w / 2;
  const cy = area.y + area.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const t = Math.min(
    dx === 0 ? Infinity : Math.abs(area.w / 2 / dx),
    dy === 0 ? Infinity : Math.abs(area.h / 2 / dy),
  );
  return { x: cx + dx * t, y: cy + dy * t, vertical: Math.abs(dx * t) >= area.w / 2 - 0.5 };
}

export function layoutMarkers(
  markers: readonly Marker[],
  /** The free area: the viewport minus the margins. */
  area: Rect,
  /** The interface: header, toasts, dock, sheet. Nothing may cover them. */
  obstacles: readonly Rect[],
  /** The plants themselves on screen: a marker would rather not cover one. */
  bodies: readonly (Rect & { id: string })[] = [],
): Placement[] {
  const taken: Rect[] = [...obstacles];
  const placedMarkers: Rect[] = [];
  const leaders: [Point, Point][] = [];
  const cost = (m: Marker, spot: Point, natural: Point): number => {
    const r = { ...spot, w: m.w, h: m.h };
    const moved = Math.hypot(spot.x - natural.x, spot.y - natural.y);
    // A leader reads best straight up or down: sideways costs more than its distance.
    let total = moved + Math.abs(spot.x - natural.x) * COST.sideways;
    for (const body of bodies) {
      total += covered(r, body) * (body.id === m.id ? COST.own : COST.neighbour);
    }
    if (moved > LEADER_PX) {
      const [from, to] = leaderOf(m, spot);
      if (placedMarkers.some((other) => segmentCrossesRect(from, to, other))) {
        total += COST.crossing;
      }
      if (leaders.some(([a, b]) => segmentsCross(from, to, a, b))) total += COST.crossing;
    }
    // A marker laid over another marker's leader.
    if (leaders.some(([a, b]) => segmentCrossesRect(a, b, r))) total += COST.crossing;
    return total;
  };
  const placements: Placement[] = [];
  const free = (r: Rect) => inside(r, area) && !taken.some((t) => overlaps(r, t));

  const ordered = [...markers].sort((a, b) => a.priority - b.priority);
  for (const m of ordered) {
    const visible = contains(area, m.point) && !obstacles.some((o) => contains(o, m.point));
    if (visible) {
      const natural = candidates(m)[0];
      const spots = candidates(m)
        .map((c) => ({ x: clamp(c.x, area.x, area.x + area.w - m.w), y: c.y }))
        .filter((c) => free({ ...c, w: m.w, h: m.h }));
      if (natural && spots.length > 0) {
        // The calmest free spot; the first of equals, so a lone marker sits above its plant.
        let spot = spots[0] ?? natural;
        let best = Infinity;
        for (const c of spots) {
          const value = cost(m, c, natural);
          if (value < best - 0.5) {
            best = value;
            spot = c;
          }
        }
        const r = { ...spot, w: m.w, h: m.h };
        taken.push(r);
        placedMarkers.push(r);
        const moved = Math.hypot(spot.x - natural.x, spot.y - natural.y);
        if (moved > LEADER_PX) leaders.push(leaderOf(m, spot));
        placements.push({ id: m.id, mode: 'anchored', ...spot, leader: moved > LEADER_PX });
        continue;
      }
    }
    if (m.optional) continue;

    // At the edge of the free area, towards the plant, sliding along it if taken.
    const edge = edgePoint(area, m.point);
    const start = {
      x: clamp(edge.x - m.w / 2, area.x, area.x + area.w - m.w),
      y: clamp(edge.y - m.h / 2, area.y, area.y + area.h - m.h),
    };
    // Slide along the edge; if the whole edge is taken (a full-width header),
    // step inwards, away from it.
    const slide = edge.vertical
      ? { x: 0, y: m.h + MARKER_GAP_PX }
      : { x: m.w + MARKER_GAP_PX, y: 0 };
    const inward = edge.vertical
      ? { x: edge.x < area.x + area.w / 2 ? m.w + MARKER_GAP_PX : -(m.w + MARKER_GAP_PX), y: 0 }
      : { x: 0, y: edge.y < area.y + area.h / 2 ? m.h + MARKER_GAP_PX : -(m.h + MARKER_GAP_PX) };
    let spot = start;
    search: for (let depth = 0; depth <= STEPS * 2; depth++) {
      for (let k = 0; k <= STEPS * 2; k++) {
        const n = Math.ceil(k / 2) * (k % 2 === 0 ? 1 : -1);
        const c = {
          x: clamp(start.x + n * slide.x + depth * inward.x, area.x, area.x + area.w - m.w),
          y: clamp(start.y + n * slide.y + depth * inward.y, area.y, area.y + area.h - m.h),
        };
        if (free({ ...c, w: m.w, h: m.h })) {
          spot = c;
          break search;
        }
      }
    }
    taken.push({ ...spot, w: m.w, h: m.h });
    const angle = Math.atan2(m.point.y - (spot.y + m.h / 2), m.point.x - (spot.x + m.w / 2));
    placements.push({ id: m.id, mode: 'edge', ...spot, angle });
  }
  return placements;
}
