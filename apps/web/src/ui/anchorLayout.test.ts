import { describe, expect, it } from 'vitest';

import { layoutMarkers, MARKER_GAP_PX } from './anchorLayout.ts';
import type { Marker, Placement, Rect } from './anchorLayout.ts';

const AREA: Rect = { x: 20, y: 20, w: 372, h: 875 };
const HEADER: Rect = { x: 20, y: 20, w: 372, h: 90 };
const DOCK: Rect = { x: 60, y: 790, w: 290, h: 100 };

const marker = (id: string, x: number, y: number, extra: Partial<Marker> = {}): Marker => ({
  id,
  point: { x, y },
  w: 80,
  h: 32,
  priority: 0,
  optional: false,
  ...extra,
});

const rect = (p: Placement, m: Pick<Marker, 'w' | 'h'>): Rect => ({
  x: p.x,
  y: p.y,
  w: m.w,
  h: m.h,
});
/** Every marker in these tests has the same size. */
const SIZE = { w: 80, h: 32 };
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layoutMarkers', () => {
  it('puts a marker just above its plant', () => {
    const m = marker('a', 200, 400);
    const [p] = layoutMarkers([m], AREA, []);
    expect(p).toEqual({
      id: 'a',
      mode: 'anchored',
      x: 160,
      y: 400 - 32 - MARKER_GAP_PX,
      leader: false,
    });
  });

  it('never lets markers cover each other, the header or the dock', () => {
    // Six plants close together, as at the home view on a phone.
    const markers = [
      marker('a', 150, 400),
      marker('b', 200, 405),
      marker('c', 250, 410),
      marker('d', 160, 450),
      marker('e', 210, 455),
      marker('f', 260, 460),
    ];
    const placed = layoutMarkers(markers, AREA, [HEADER, DOCK]);
    expect(placed).toHaveLength(6);
    const rects = placed.map((p) => rect(p, SIZE));
    for (const [i, a] of rects.entries()) {
      expect(overlaps(a, HEADER)).toBe(false);
      expect(overlaps(a, DOCK)).toBe(false);
      for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
    expect(placed.some((p) => p.mode === 'anchored' && p.leader)).toBe(true);
  });

  it('would rather not cover a neighbouring plant (D134)', () => {
    // Two pots, one behind the other on screen: the front name would sit on the back pot.
    const back = { id: 'back', x: 160, y: 340, w: 80, h: 50 };
    const front = { id: 'front', x: 165, y: 392, w: 80, h: 90 };
    const placed = layoutMarkers([marker('front', 205, 392)], AREA, [], [back, front]);
    const label = placed.find((p) => p.id === 'front');
    expect(label).toBeDefined();
    if (!label) return;
    // Above its plant it would lie whole on the back pot: it moves until it barely touches it.
    const r = rect(label, SIZE);
    const w = Math.min(r.x + r.w, back.x + back.w) - Math.max(r.x, back.x);
    const h = Math.min(r.y + r.h, back.y + back.h) - Math.max(r.y, back.y);
    const share = w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0;
    expect(share).toBeLessThan(0.4);
    expect(overlaps(r, front)).toBe(false);
  });

  it('keeps a leader from crossing another marker (D134)', () => {
    // Three plants in a column on screen: their names stack, each with a leader.
    const markers = [marker('a', 200, 400), marker('b', 204, 404), marker('c', 208, 408)];
    const placed = layoutMarkers(markers, AREA, []);
    expect(placed).toHaveLength(3);
    for (const p of placed) {
      const m = markers.find((candidate) => candidate.id === p.id);
      if (!m) continue;
      // The leader: a line from the plant to the nearer edge of its marker.
      const x = p.x + m.w / 2;
      const y = p.y + (p.y < m.point.y ? m.h : 0);
      for (const other of placed) {
        if (other.id === p.id) continue;
        const r = rect(other, SIZE);
        for (let t = 0.05; t < 1; t += 0.05) {
          const at = { x: m.point.x + (x - m.point.x) * t, y: m.point.y + (y - m.point.y) * t };
          const inside = at.x > r.x && at.x < r.x + r.w && at.y > r.y && at.y < r.y + r.h;
          expect(inside).toBe(false);
        }
      }
    }
  });

  it('sends a plant off screen to the edge, pointing at it', () => {
    const m = marker('a', 600, 400);
    const [p] = layoutMarkers([m], AREA, []);
    expect(p?.mode).toBe('edge');
    expect((p?.x ?? Infinity) + m.w).toBeLessThanOrEqual(AREA.x + AREA.w);
    if (p?.mode === 'edge') expect(Math.abs(p.angle)).toBeLessThan(Math.PI / 4);
  });

  it('treats a plant under the dock or the header as hidden', () => {
    const [p] = layoutMarkers([marker('a', 200, 820)], AREA, [HEADER, DOCK]);
    expect(p?.mode).toBe('edge');
  });

  it('drops a plain label when there is no room, never a warning', () => {
    const crowded: Rect = { x: 20, y: 20, w: 372, h: 760 };
    const placed = layoutMarkers(
      [marker('warn', 200, 400), marker('label', 210, 400, { optional: true, priority: 1 })],
      AREA,
      [crowded],
    );
    expect(placed.map((p) => p.id)).toEqual(['warn']);
  });

  it('places warnings before labels', () => {
    const placed = layoutMarkers(
      [marker('label', 200, 400, { optional: true, priority: 1 }), marker('warn', 200, 400)],
      AREA,
      [],
    );
    expect(placed[0]?.id).toBe('warn');
    expect(placed[0]?.mode === 'anchored' && placed[0].leader).toBe(false);
  });

  it('stacks several edge markers along the edge without overlap', () => {
    const markers = [marker('a', 700, 400), marker('b', 700, 405), marker('c', 700, 410)];
    const placed = layoutMarkers(markers, AREA, []);
    const rects = placed.map((p) => rect(p, SIZE));
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
    }
  });

  it('moves an edge marker inwards when a full-width header takes the edge', () => {
    const header: Rect = { x: 20, y: 20, w: 372, h: 160 };
    const m = marker('a', 200, -300);
    const [p] = layoutMarkers([m], AREA, [header]);
    expect(p?.mode).toBe('edge');
    expect(overlaps(rect(p ?? { id: 'a', mode: 'edge', x: 0, y: 0, angle: 0 }, SIZE), header)).toBe(
      false,
    );
  });
});
