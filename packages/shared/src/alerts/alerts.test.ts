import { describe, expect, it } from 'vitest';

import { telemetryMessage } from '../mqtt/telemetry.ts';
import type { TelemetryMessage } from '../mqtt/telemetry.ts';
import { telemetryExample } from '../mqtt/fixtures.ts';
import { GREENHOUSE_ZONES, plantThresholds, SPECIES, SPECIES_KINDS } from '../species/index.ts';
import {
  deriveAlerts,
  incidentKey,
  PUSH_RULES,
  TANK_EMPTY_LEVEL,
  TANK_LOW_LEVEL,
} from './index.ts';

const ZONES = [
  { id: 'basil_01', waterBelow: 0.4 },
  { id: 'parsley_01', waterBelow: 0.4 },
];

function telemetry(change: (t: TelemetryMessage) => void = () => undefined): TelemetryMessage {
  const t = telemetryMessage.parse(structuredClone(telemetryExample));
  change(t);
  return t;
}

describe('deriveAlerts', () => {
  it('says nothing when all is well', () => {
    expect(deriveAlerts('live', telemetry(), ZONES)).toEqual([]);
  });

  it('names a thirsty plant, below its own threshold only', () => {
    const alerts = deriveAlerts(
      'live',
      telemetry((t) => {
        t.soil[0] = { id: 'basil_01', moisture: 0.39, cal: 1 };
        t.soil[1] = { id: 'parsley_01', moisture: 0.4, cal: 1 };
      }),
      ZONES,
    );
    expect(alerts.map((a) => a.id)).toEqual(['thirsty:basil_01']);
    expect(alerts[0]?.zone).toBe('basil_01');
  });

  it('treats a broken soil sensor as its own warning, never as dry', () => {
    const alerts = deriveAlerts(
      'live',
      telemetry((t) => {
        t.soil[0] = { id: 'basil_01', moisture: null, cal: 1 };
      }),
      ZONES,
    );
    expect(alerts.map((a) => a.id)).toEqual(['soil_sensor:basil_01']);
  });

  it('a zone missing from the telemetry counts as a missing reading', () => {
    const alerts = deriveAlerts('live', telemetry(), [
      ...ZONES,
      { id: 'tomato_01', waterBelow: 0.45 },
    ]);
    expect(alerts.map((a) => a.id)).toEqual(['soil_sensor:tomato_01']);
  });

  it.each([
    [TANK_EMPTY_LEVEL, 'tank_empty', 'critical'],
    [TANK_LOW_LEVEL - 0.01, 'tank_low', 'attention'],
    [null, 'tank_sensor', 'attention'],
  ] as const)('tank at %s → %s (%s)', (level, id, severity) => {
    const alerts = deriveAlerts(
      'live',
      telemetry((t) => {
        t.tank.level = level;
      }),
      ZONES,
    );
    expect(alerts).toEqual([{ id, kind: id, severity }]);
  });

  it('puts critical first, then global, then plants in order', () => {
    const alerts = deriveAlerts(
      'live',
      telemetry((t) => {
        t.soil[0] = { id: 'basil_01', moisture: 0.1, cal: 1 };
        t.soil[1] = { id: 'parsley_01', moisture: 0.1, cal: 1 };
        t.air.temp = null;
        t.tank.level = 0;
      }),
      ZONES,
    );
    expect(alerts.map((a) => a.id)).toEqual([
      'tank_empty',
      'air_sensor',
      'thirsty:basil_01',
      'thirsty:parsley_01',
    ]);
  });

  it('without fresh data, reports only the connection (old readings are not new news)', () => {
    const dry = telemetry((t) => {
      t.soil[0] = { id: 'basil_01', moisture: 0.1, cal: 1 };
    });
    expect(deriveAlerts('disconnected', dry, ZONES).map((a) => a.id)).toEqual(['disconnected']);
    expect(deriveAlerts('stale', dry, ZONES).map((a) => a.id)).toEqual(['stale']);
    expect(deriveAlerts('waiting', null, ZONES)).toEqual([]);
  });

  it('gives stable, unique ids', () => {
    const t = telemetry((tt) => {
      tt.soil[0] = { id: 'basil_01', moisture: 0.1, cal: 1 };
    });
    const ids = deriveAlerts('live', t, ZONES).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(deriveAlerts('live', t, ZONES).map((a) => a.id)).toEqual(ids);
  });
});

describe('species sheets', () => {
  it.each(SPECIES_KINDS)('%s has a name, an article and a threshold in 0–1', (kind) => {
    const sheet = SPECIES[kind];
    expect(sheet.kind).toBe(kind);
    expect(sheet.name.length).toBeGreaterThan(0);
    expect(['el', 'la']).toContain(sheet.article);
    expect(sheet.waterBelow).toBeGreaterThan(0);
    expect(sheet.waterBelow).toBeLessThan(1);
  });
});

describe('held safety limits and notifications (A7, D90, D91)', () => {
  it('a held limit is a critical warning with the temperature now', () => {
    const cold = { ...telemetryExample, air: { temp: 4.2, rh: 80 } } as TelemetryMessage;
    expect(deriveAlerts('live', cold, [], [{ limit: 'frost', value: 4.4 }])).toEqual([
      { id: 'frost', kind: 'frost', severity: 'critical', value: 4.2 },
    ]);
  });

  it('notifies the agreed types, with their delays, from the same warnings', () => {
    expect(PUSH_RULES.tank_empty).toEqual({ type: 'tank', critical: true, afterMs: 0 });
    expect(PUSH_RULES.frost?.critical).toBe(true);
    expect(PUSH_RULES.stale?.afterMs).toBe(15 * 60_000);
    expect(PUSH_RULES.thirsty).toMatchObject({ type: 'thirsty', critical: false });
    // Broken sensors stay in the app (D91).
    expect(PUSH_RULES.soil_sensor).toBeUndefined();
    expect(incidentKey({ id: 'stale', kind: 'stale', severity: 'attention' })).toBe('no_data');
    expect(incidentKey({ id: 'disconnected', kind: 'disconnected', severity: 'critical' })).toBe(
      'no_data',
    );
  });
});

describe('plantThresholds (D100)', () => {
  it('takes each pot from its watering rule, on or off, and the species where there is none', () => {
    const thresholds = plantThresholds([
      { zone: 'basil_01', threshold: 0.5 },
      { zone: 'lettuce_01', threshold: 0.3 },
    ]);
    expect(thresholds.get('basil_01')).toBe(0.5);
    expect(thresholds.get('lettuce_01')).toBe(0.3);
    expect(thresholds.get('parsley_01')).toBe(SPECIES.parsley.waterBelow);
    expect(plantThresholds(null).get('basil_01')).toBe(SPECIES.basil.waterBelow);
    expect(plantThresholds(null).size).toBe(GREENHOUSE_ZONES.length);
  });
});
