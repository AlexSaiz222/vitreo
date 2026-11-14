import { readFileSync } from 'node:fs';

import { getPosition } from 'suncalc';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8');

/** The sun function inlined in index.html, loaded as real code. */
function inlineSunAltitude(): (ms: number, lat: number, lng: number) => number {
  const match = /\/\* sun:start \*\/([\s\S]*?)\/\* sun:end \*\//.exec(html);
  if (!match?.[1]) throw new Error('sun function not found in index.html');
  type SunAltitude = (ms: number, lat: number, lng: number) => number;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(`${match[1]}; return sunAltitude;`) as () => SunAltitude;
  return factory();
}

describe('theme boot script in index.html', () => {
  it('computes the same sun altitude as suncalc', () => {
    const sunAltitude = inlineSunAltitude();
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const start = Date.parse('2020-01-01T00:00:00Z');
    const end = Date.parse('2040-01-01T00:00:00Z');
    for (let i = 0; i < 500; i++) {
      const ms = start + random() * (end - start);
      const lat = -60 + random() * 120;
      const lng = -180 + random() * 360;
      const expected = getPosition(new Date(ms), lat, lng).altitude;
      expect(Math.abs(sunAltitude(ms, lat, lng) - expected)).toBeLessThan(0.02);
    }
  });

  it('paints the same backgrounds as the tokens', () => {
    const day = /:root \{[\s\S]*?--bg: (#[0-9a-f]{6});/.exec(tokens)?.[1];
    const night = /:root\[data-theme='night'\] \{[\s\S]*?--bg: (#[0-9a-f]{6});/.exec(tokens)?.[1];
    expect(day).toBeDefined();
    expect(night).toBeDefined();
    expect(html).toContain(`background: ${day ?? ''};`);
    expect(html).toContain(`background: ${night ?? ''};`);
    expect(html).toContain(`setAttribute('content', '${night ?? ''}')`);
  });

  it('uses the same horizon as the app', () => {
    const app = readFileSync(new URL('./dayNight.ts', import.meta.url), 'utf8');
    expect(app).toContain('const HORIZON = -0.833;');
    expect(html).toContain('<= -0.833');
  });
});
