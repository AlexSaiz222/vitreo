import { describe, expect, it } from 'vitest';

import { COOLDOWN_MS, createTouchGate, pressCue, shapeOf, TOUCH_LEVELS } from './touchSound.ts';
import type { CueShape, TouchCue } from './touchSound.ts';

const CUES: TouchCue[] = [
  'hover',
  'press',
  'on',
  'off',
  'open',
  'close',
  'scroll',
  'step',
  'switch',
];
/** C major pentatonic, every octave the cues use. */
const PENTATONIC = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25];

/** The loudest a cue could get if all its parts peaked together (they do not: the tune comes later). */
const ceiling = (shape: CueShape) =>
  [...shape.key, ...shape.notes].reduce((sum, part) => sum + part.level, 0);

describe('the interface sounds (D128, D129)', () => {
  it.each(CUES)('%s is short, never near full scale, and its tune is on the scale', (cue) => {
    const shape = shapeOf(cue);
    expect(shape.key.length + shape.notes.length).toBeGreaterThan(0);
    for (const hit of shape.key) {
      // A key is a knock, not a note: gone in a tenth of a second.
      expect(hit.decay).toBeLessThanOrEqual(0.1);
      expect(hit.level).toBeGreaterThan(0);
    }
    for (const note of shape.notes) {
      expect(PENTATONIC).toContain(note.hz);
      expect(note.decay).toBeLessThanOrEqual(0.45);
    }
    // Far from clipping at full volume: the parts never peak together (the
    // tune comes after the key), and a press measured offline peaks at
    // about half this sum (D131: 0.63 at full volume).
    expect(ceiling(shape)).toBeLessThan(1.5);
  });

  it('a hover is quieter than a press, and a scroll quieter still', () => {
    expect(TOUCH_LEVELS.hover).toBeLessThan(TOUCH_LEVELS.press);
    expect(TOUCH_LEVELS.scroll).toBeLessThan(TOUCH_LEVELS.hover);
    expect(TOUCH_LEVELS.panel).toBeLessThan(TOUCH_LEVELS.press);
  });

  it('a key falls in pitch, as a knock does', () => {
    for (const hit of shapeOf('press').key.filter((part) => part.kind === 'tone')) {
      expect(hit.toHz).toBeLessThan(hit.hz);
    }
  });

  it('switching on goes up and off goes down', () => {
    const [onFirst, onLast] = shapeOf('on').notes;
    const [offFirst, offLast] = shapeOf('off').notes;
    expect(onLast?.hz).toBeGreaterThan(onFirst?.hz ?? Infinity);
    expect(offLast?.hz).toBeLessThan(offFirst?.hz ?? 0);
  });

  it('a wobble detunes a hair, never off the note', () => {
    const plain = shapeOf('on').notes[0]?.hz ?? 0;
    const bent = shapeOf('on', 1).notes[0]?.hz ?? 0;
    expect(bent).not.toBe(plain);
    expect(Math.abs(bent / plain - 1)).toBeLessThan(0.02);
  });

  it('the same kind does not rattle', () => {
    const gate = createTouchGate();
    expect(gate('hover', 0)).toBe(true);
    expect(gate('hover', COOLDOWN_MS.hover - 1)).toBe(false);
    expect(gate('press', 1)).toBe(true);
    expect(gate('hover', COOLDOWN_MS.hover + 1)).toBe(true);
  });

  it('switches go up or down; a device button clicks like a wall switch', () => {
    const element = (attributes: Record<string, string>) =>
      ({ getAttribute: (name: string) => attributes[name] ?? null }) as unknown as Element;
    expect(pressCue(element({ role: 'switch', 'aria-checked': 'true' }))).toBe('on');
    expect(pressCue(element({ role: 'switch', 'aria-checked': 'false' }))).toBe('off');
    expect(pressCue(element({ 'aria-pressed': 'false' }))).toBe('switch');
    expect(pressCue(element({ 'aria-pressed': 'true' }))).toBe('switch');
    expect(pressCue(element({}))).toBe('press');
  });

  it('a wall switch is two clicks: contact, then seat', () => {
    const starts = new Set(shapeOf('switch').key.map((hit) => hit.at));
    expect(starts.size).toBe(2);
  });
});
