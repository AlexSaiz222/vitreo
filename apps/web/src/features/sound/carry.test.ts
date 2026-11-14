import { describe, expect, it } from 'vitest';

import { parseCarried, RESTING_DAY } from './carry.ts';

describe('the sound carried to the notebook (D129)', () => {
  it('reads back what the demo was sounding, never a watering', () => {
    const night = {
      night: 1,
      vent: 0.5,
      fan: true,
      watering: true,
      live: true,
      weather: { wind: 0.2, rain: 0.6 },
      wetness: 0.4,
    };
    expect(parseCarried(JSON.stringify(night))).toEqual({ ...night, watering: false });
  });

  it('plays a resting day on its own, or with anything odd', () => {
    expect(parseCarried(null)).toEqual(RESTING_DAY);
    expect(parseCarried('not json')).toEqual(RESTING_DAY);
    expect(parseCarried(JSON.stringify({ night: 3 }))).toEqual(RESTING_DAY);
    expect(
      parseCarried(JSON.stringify({ ...RESTING_DAY, weather: { wind: 'strong', rain: 0 } })),
    ).toEqual(RESTING_DAY);
  });

  it('takes an older note without the wetness as dry', () => {
    const { wetness: _, ...older } = RESTING_DAY;
    expect(parseCarried(JSON.stringify({ ...older, vent: 1 }))).toEqual({
      ...RESTING_DAY,
      vent: 1,
    });
  });
});
