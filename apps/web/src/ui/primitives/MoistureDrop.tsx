import { useId } from 'react';

import './MoistureDrop.css';

/** The drop's outline on the 24 px grid: tip at y 2.8, bottom at y 20.2. */
const DROP = 'M12 2.8c3.4 4.1 6.3 7.7 6.3 11.2a6.3 6.3 0 0 1-12.6 0c0-3.5 2.9-7.1 6.3-11.2z';
const TOP = 2.8;
const BOTTOM = 20.3;

export interface MoistureDropProps {
  /** Soil moisture 0–1; null when the sensor has no reading (an empty, dashed drop). */
  moisture: number | null;
  /** Below the plant's threshold: the outline takes the warm tone. */
  thirsty?: boolean;
}

/**
 * A water drop filled from the bottom as far as the soil is wet (68 % → two
 * thirds full). Decorative: the percentage is always written next to it.
 */
export function MoistureDrop({ moisture, thirsty = false }: MoistureDropProps) {
  const clipId = useId();
  const level = moisture === null ? 0 : Math.min(1, Math.max(0, moisture));
  const height = (BOTTOM - TOP) * level;
  return (
    <svg
      className="ui-moisture-drop"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      data-state={moisture === null ? 'unknown' : thirsty ? 'thirsty' : 'ok'}
    >
      <clipPath id={clipId}>
        <path d={DROP} />
      </clipPath>
      {height > 0 && (
        <rect
          className="ui-moisture-drop-water"
          x="0"
          y={BOTTOM - height}
          width="24"
          height={height}
          clipPath={`url(#${clipId})`}
        />
      )}
      <path className="ui-moisture-drop-outline" d={DROP} />
    </svg>
  );
}
