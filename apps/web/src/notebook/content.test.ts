import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CLIP_IDS } from './clips.ts';
import { DECISIONS_SO_FAR, STOPS } from './content.ts';
import type { Visual } from './content.ts';
import sizes from './img/sizes.json';

/**
 * The notebook (D113, D133) says only what happened: every decision it
 * cites is in docs/11, every picture is a progress capture with words for
 * whoever cannot see it, every clip has its first frame as a picture, and
 * what is on disk is exactly what the lists say.
 */
const ROOT = path.resolve(import.meta.dirname, '../../../..');
const decisions = readFileSync(path.join(ROOT, 'docs/11-decisiones.md'), 'utf8');
const list = JSON.parse(readFileSync(path.join(import.meta.dirname, 'images.json'), 'utf8')) as {
  id: string;
  from: string;
  width: number;
}[];
const sections = STOPS.flatMap((stop) => stop.sections);
const visuals = sections.flatMap((section) => (section.visual ? [section.visual] : []));

/** Every picture a visual shows, with the words for it. */
function picturesOf(visual: Visual): { image: string; alt: string }[] {
  switch (visual.kind) {
    case 'image':
      return visual.close ? [visual, { image: visual.close, alt: visual.alt }] : [visual];
    case 'clip':
      return [{ image: `clip-${visual.clip}`, alt: visual.alt }];
    case 'compare':
      return [visual.before, visual.after];
    case 'phones':
    case 'strip':
      return visual.shots;
  }
}

describe('the notebook (D113, D133)', () => {
  it('cites only decisions recorded in docs/11, and counts them right', () => {
    const cited = STOPS.flatMap((stop) => stop.decisions.map((d) => d.id));
    expect(cited.length).toBeGreaterThan(0);
    expect(cited.filter((id) => !decisions.includes(`| ${id} |`))).toEqual([]);
    expect(decisions).toContain(`| D${String(DECISIONS_SO_FAR)} |`);
    expect(decisions).not.toContain(`| D${String(DECISIONS_SO_FAR + 1)} |`);
  });

  it('cites each decision once per stop', () => {
    for (const stop of STOPS) {
      const ids = stop.decisions.map((d) => d.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('numbers the stops one after another', () => {
    expect(STOPS.map((stop) => stop.number)).toEqual(STOPS.map((_, i) => i + 1));
  });

  it('gives every stop and section its own anchor', () => {
    const ids = [...STOPS.map((s) => s.id), ...sections.map((s) => s.id)];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('describes every picture and clip in words', () => {
    const alts = visuals.flatMap(picturesOf).map((p) => p.alt);
    expect(alts.length).toBeGreaterThan(0);
    expect(alts.filter((alt) => alt.trim().length < 20)).toEqual([]);
  });

  it('shows only pictures on the list, and every clip has its first frame there', () => {
    const shown = visuals.flatMap(picturesOf).map((p) => p.image);
    expect(shown.filter((id) => !(id in sizes))).toEqual([]);
    for (const id of CLIP_IDS) expect(Object.keys(sizes)).toContain(`clip-${id}`);
  });

  it('shows only progress captures, each made and none left over', () => {
    expect(list.filter(({ from }) => !from.startsWith('referencias/progreso/'))).toEqual([]);
    // The public snapshot ships without referencias/, so the sources can only be checked here.
    if (existsSync(path.join(ROOT, 'referencias')))
      for (const { from } of list) expect(existsSync(path.join(ROOT, from))).toBe(true);
    expect(Object.keys(sizes).sort()).toEqual(list.map(({ id }) => id).sort());
    const files = readdirSync(path.join(import.meta.dirname, 'img')).filter((f) =>
      f.endsWith('.webp'),
    );
    expect(files.sort()).toEqual(list.map(({ id }) => `cuaderno-${id}.webp`).sort());
  });

  it('has every clip it names on disk, and no other', () => {
    const files = readdirSync(path.join(import.meta.dirname, 'clips')).filter((f) =>
      f.endsWith('.mp4'),
    );
    expect(files.sort()).toEqual(CLIP_IDS.map((id) => `${id}.mp4`).sort());
  });
});
