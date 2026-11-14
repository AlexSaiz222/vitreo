// Valid example messages, mirroring docs/05-arquitectura.md. Used by tests.

export const telemetryExample = {
  v: 1,
  ts: 1790780400,
  air: { temp: 22.4, rh: 64.1 },
  light: { lux: 8200 },
  soil: [
    { id: 'basil_01', moisture: 0.42, cal: 1 },
    { id: 'parsley_01', moisture: 0.58, cal: 1 },
  ],
  tank: { level: 0.7 },
  actuators: { pump: false, growLight: true, fan: false, vent: 0.0 },
  fw: '0.3.1',
  rssi: -58,
};

export const commandExamples = [
  { v: 1, requestId: 'a1b2', source: 'user', action: 'water', zone: 'basil_01', seconds: 5 },
  { v: 1, requestId: 'b2c3', source: 'user', action: 'waterStop', zone: 'basil_01' },
  { v: 1, requestId: 'b2c4', source: 'user', action: 'waterStop' },
  { v: 1, requestId: 'c3d4', source: 'automation', action: 'growLight', on: true },
  { v: 1, requestId: 'e5f6', source: 'user', action: 'vent', open: 0.6 },
  { v: 1, requestId: 'g7h8', source: 'agent', action: 'fan', on: true, minutes: 10 },
  { v: 1, requestId: 'i9j0', source: 'user', action: 'fan', on: false },
  {
    v: 1,
    requestId: 'hub-hold-1',
    source: 'automation',
    action: 'outdoorHold',
    on: true,
    minutes: 30,
    reason: { kind: 'weather', cause: 'rain', value: 1.2, limit: 0.1 },
  },
  { v: 1, requestId: 'hub-hold-2', source: 'automation', action: 'outdoorHold', on: false },
] as const;

export const ackExamples = [
  { v: 1, requestId: 'a1b2', ts: 1790780401, source: 'user', result: 'ok' },
  {
    v: 1,
    requestId: 'a1b2',
    ts: 1790780401,
    source: 'user',
    result: 'rejected',
    reason: 'tank_empty',
  },
  {
    v: 1,
    requestId: 'k1l2',
    ts: 1790780401,
    source: 'user',
    result: 'rejected',
    reason: 'safety_limit',
    limit: 'pump_max_per_hour',
    retryAt: 1790781200,
  },
] as const;

export const eventExamples = [
  {
    v: 1,
    ts: 1790780401,
    type: 'watering.started',
    source: 'user',
    requestId: 'a1b2',
    zone: 'basil_01',
    seconds: 5,
  },
  {
    v: 1,
    ts: 1790780406,
    type: 'watering.finished',
    source: 'user',
    requestId: 'a1b2',
    zone: 'basil_01',
    seconds: 4.8,
  },
  {
    v: 1,
    ts: 1790780406,
    type: 'safety.triggered',
    source: 'safety',
    limit: 'tank_empty',
    zone: 'basil_01',
  },
  { v: 1, ts: 1790780406, type: 'sensor.error', sensor: 'soil', zone: 'parsley_01' },
  { v: 1, ts: 1790780406, type: 'sensor.error', sensor: 'air', detail: 'no response' },
  {
    v: 1,
    ts: 1790780407,
    type: 'watering.started',
    source: 'automation',
    zone: 'basil_01',
    seconds: 5,
    reason: { kind: 'soil', moisture: 0.33, threshold: 0.35 },
  },
  {
    v: 1,
    ts: 1790780408,
    type: 'automation.switched',
    source: 'automation',
    target: 'fan',
    value: true,
    reason: { kind: 'temperature', value: 28.4, limit: 28 },
  },
  { v: 1, ts: 1790780409, type: 'config.applied', rev: 3 },
  {
    v: 1,
    ts: 1790780410,
    type: 'config.rejected',
    rev: 4,
    reason: 'unsupported_version',
    version: 1,
    keeps: 3,
  },
] as const;

export const configExample = {
  v: 2,
  rev: 3,
  ts: 1790780400,
  tz: 'CET-1CEST,M3.5.0,M10.5.0/3',
  location: { lat: 40.42, lng: -3.7 },
  watering: [
    {
      zone: 'basil_01',
      enabled: true,
      threshold: 0.4,
      seconds: 5,
      maxPerDay: 2,
      cooldownMinutes: 60,
      quiet: { from: '22:00', to: '08:00' },
    },
    {
      zone: 'strawberry_01',
      enabled: false,
      threshold: 0.35,
      seconds: 5,
      maxPerDay: 2,
      cooldownMinutes: 60,
      quiet: null,
    },
  ],
  light: { enabled: true, mode: 'schedule', on: '07:00', off: '21:00', belowLux: 3000 },
  ventilation: { enabled: true, fanAbove: 28, windowAbove: 31, hysteresis: 2, maxRh: 85 },
};

/** A1-era config (v1): a device that knows only v2 refuses it. */
export const configV1Example = {
  v: 1,
  rev: 1,
  ts: 1790780400,
  tz: 'CET-1CEST,M3.5.0,M10.5.0/3',
  watering: [{ zone: 'basil_01', enabled: false, threshold: 0.4, seconds: 5, maxPerDay: 2 }],
  light: { enabled: false, on: '07:00', off: '21:00' },
  ventilation: { enabled: false, maxTemp: 28, maxRh: 85 },
};

/** Outdoor weather (A10): a grey, drizzly hour at Madrid, Retiro. */
export const weatherExample = {
  v: 1,
  ts: 1790780400,
  source: 'aemet',
  observation: {
    station: { id: '3195', name: 'MADRID RETIRO' },
    at: 1790776800,
    temp: 12.4,
    rh: 88,
    windSpeed: 3.1,
    windGust: 7.2,
    windDir: 230,
    precip: 0.4,
    visibility: null,
  },
  forecast: {
    municipality: { id: '28079', name: 'Madrid' },
    issuedAt: 1790758800,
    hour: 1790780400,
    sky: '45',
    skyText: 'Muy nuboso con lluvia escasa',
    temp: 12,
    precip: 0.2,
    snow: 0,
    windSpeed: 15 / 3.6,
    windGust: 30 / 3.6,
  },
  tonight: { min: 8, at: 1790830800 },
} as const;
