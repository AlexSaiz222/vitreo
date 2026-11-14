import { describe, expect, it } from 'vitest';

import { readViewOptions } from './viewOptions.ts';

describe('readViewOptions', () => {
  it('defaults to the orthographic camera and no forced theme', () => {
    expect(readViewOptions('')).toEqual({
      camera: 'orthographic',
      theme: null,
      zoom: 1,
      stats: false,
      azimuth: null,
      look: null,
    });
  });

  it('reads the camera and theme', () => {
    expect(readViewOptions('?camera=perspective&theme=night&zoom=1.5')).toEqual({
      camera: 'perspective',
      theme: 'night',
      zoom: 1.5,
      stats: false,
      azimuth: null,
      look: null,
    });
  });

  it('ignores unknown values', () => {
    expect(readViewOptions('?camera=fisheye&theme=dusk&zoom=abc')).toEqual({
      camera: 'orthographic',
      theme: null,
      zoom: 1,
      stats: false,
      azimuth: null,
      look: null,
    });
  });

  it('reads an azimuth in degrees to look from elsewhere', () => {
    expect(readViewOptions('?azimuth=221').azimuth).toBe(221);
    expect(readViewOptions('?azimuth=abc').azimuth).toBeNull();
  });

  it('reads a node to look at, for close-ups', () => {
    expect(readViewOptions('?look=tank').look).toBe('tank');
    expect(readViewOptions('?look=').look).toBeNull();
  });

  it('turns the frame counter on with ?stats', () => {
    expect(readViewOptions('?stats').stats).toBe(true);
  });

  it('keeps zoom within the orbit limits', () => {
    expect(readViewOptions('?zoom=10').zoom).toBe(3.5);
    expect(readViewOptions('?zoom=0.1').zoom).toBe(0.75);
  });
});
