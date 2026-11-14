import { useEffect, useState } from 'react';

import { now as nowMs } from '../app/clock.ts';

/** Current time, refreshed while something time-dependent is on screen. */
export function useClock(active: boolean, everyMs = 250): number {
  const [now, setNow] = useState(() => nowMs());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(nowMs());
    }, everyMs);
    return () => {
      clearInterval(timer);
    };
  }, [active, everyMs]);
  return now;
}
