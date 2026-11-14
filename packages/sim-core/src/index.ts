// The simulated greenhouse and its firmware, without a network (D66, D103):
// the daily and e2e simulators (apps/simulator) run it over MQTT, the public
// demo in a Web Worker. Pure: time only moves when the caller says so.
export { attributionOf, DeviceCore } from './device.ts';
export type { DeviceLink, DeviceOptions } from './device.ts';
export { FIRMWARE_VERSION, GreenhouseSim, simMemory } from './greenhouse.ts';
export type {
  CommandResult,
  Scenario,
  ScenarioChange,
  SensorTarget,
  SimMemory,
  SimSnapshot,
} from './greenhouse.ts';
export { DEFAULT_PARAMS, simParamsSchema, withOverrides } from './params.ts';
export type { SimParams, ZoneParams } from './params.ts';
export { SAFETY } from './safety.ts';
export { statusPublication } from './status.ts';
export type { StatusPublication } from './status.ts';
export { dailyCurve, MADRID_LATE_OCTOBER } from './outside.ts';
export type { OutsideCurve, OutsideDay, OutsideWeather, RainSpell } from './outside.ts';
export {
  ACCELERATED_WEEK_START,
  acceleratedWeek,
  runWeek,
  summarizeWeek,
  weekRunConfig,
} from './week.ts';
export type { PlantSummary, WeekOptions, WeekRecord, WeekSummary } from './week.ts';
