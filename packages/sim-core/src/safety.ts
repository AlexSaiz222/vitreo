import { MAX_WATER_SECONDS } from '@vitreo/shared';

/**
 * The same safety limits the firmware applies (docs/05-arquitectura.md).
 * They are constants on purpose: nothing received over MQTT can change them.
 */
export const SAFETY = {
  /** Longest single watering. */
  pumpMaxSecondsPerCommand: MAX_WATER_SECONDS,
  /** Pumping allowed in any rolling hour. */
  pumpMaxSecondsPerHour: 60,
  /** At or below this level the float switch reads "empty" and the pump cannot start. */
  tankEmptyLevel: 0.05,
  /** Above this, forced ventilation and grow light off. */
  overTemperatureC: 35,
  /** Forced ventilation is released below this (hysteresis). */
  overTemperatureClearC: 32,
  /**
   * Frost protection (D90): below this the window closes and the fan stays
   * off, whatever automations or orders ask. Madrid freezes in winter.
   */
  frostC: 5,
  /** Frost protection is released above this (hysteresis). */
  frostClearC: 7,
} as const;
