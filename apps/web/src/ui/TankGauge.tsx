import { TANK_EMPTY_LEVEL, TANK_LOW_LEVEL } from '@vitreo/shared';

import { useHud } from '../app/hud.ts';
import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import { formatFraction } from './format.ts';
import { MoistureDrop } from './primitives/index.ts';

/**
 * The tank, always in view (A2): a compact line in the dock, next to the
 * actions that use the water, with the same drop as the plants, filled to
 * the tank level. Low or empty: warm outline and words. Unknown: an empty,
 * dashed drop. Without a connection the dock already says so, and an old
 * level is not shown as current. A tap opens the greenhouse's sheet at its
 * tank (A11): the level over time, with every watering.
 */
export function TankGauge() {
  const freshness = useFreshness().kind;
  const openGreenhouse = useHud((state) => state.openGreenhouse);
  const level = useGreenhouse((state) => state.telemetry?.tank.level ?? null);
  if (freshness === 'disconnected' || freshness === 'waiting') return null;
  const empty = level !== null && level <= TANK_EMPTY_LEVEL;
  const low = level !== null && level < TANK_LOW_LEVEL;
  const text =
    level === null
      ? 'Depósito · sin dato'
      : empty
        ? 'Depósito vacío'
        : `Depósito · ${formatFraction(level)}${low ? ' · queda poco' : ''}`;
  return (
    <button
      type="button"
      className="dock-tank"
      data-low={low}
      aria-haspopup="dialog"
      onClick={() => {
        openGreenhouse('tank');
      }}
    >
      <MoistureDrop moisture={level} thirsty={low} />
      <span>
        {text}
        {freshness === 'stale' && <span className="dock-tank-old"> (dato antiguo)</span>}
        <span className="visually-hidden">: ver su historial</span>
      </span>
    </button>
  );
}
