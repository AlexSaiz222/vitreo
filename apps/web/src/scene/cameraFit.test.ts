import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { AZIMUTH, ELEVATION, projectedSize, VIEW_DIRECTION } from './cameraFit.ts';

describe('projectedSize', () => {
  it('measures a box seen from the front as its own width and height', () => {
    const box = new Box3(new Vector3(-1, 0, -0.5), new Vector3(1, 0.5, 0.5));
    const size = projectedSize(box, new Vector3(0, 0, 1));
    expect(size.width).toBeCloseTo(2);
    expect(size.height).toBeCloseTo(0.5);
  });

  it('widens a flat square seen at 45° by √2', () => {
    const box = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 0, 0.5));
    const diagonal = new Vector3(1, 0.8, 1).normalize();
    expect(projectedSize(box, diagonal).width).toBeCloseTo(Math.SQRT2);
  });

  it('scales with the box (a real-size scene needs a closer zoom, not new numbers)', () => {
    const box = new Box3(new Vector3(-0.55, 0, -0.39), new Vector3(0.69, 0.64, 0.39));
    const half = box.clone();
    half.min.multiplyScalar(0.5);
    half.max.multiplyScalar(0.5);
    expect(projectedSize(half).width).toBeCloseTo(projectedSize(box).width / 2);
    expect(projectedSize(half).height).toBeCloseTo(projectedSize(box).height / 2);
  });

  it('looks down at its elevation, so depth adds to the height on screen', () => {
    expect(VIEW_DIRECTION.length()).toBeCloseTo(1);
    // A flat disc-like square: its depth along the view is its width across.
    const flat = new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 0, 0.5));
    const along = Math.abs(Math.sin(AZIMUTH)) + Math.abs(Math.cos(AZIMUTH));
    expect(projectedSize(flat).height).toBeCloseTo(along * Math.sin(ELEVATION));
  });
});
