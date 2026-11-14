import { knownEventList } from '@vitreo/shared';
import type { ActionSource, AutomationReason } from '@vitreo/shared';
import { useEffect, useState } from 'react';

import { now as nowMs } from '../../app/clock.ts';
import { hubGet } from '../../data/hub.ts';

const LOOK_BACK_S = 30 * 24 * 3600;
// Events of types this app does not know are left out quietly (D108).
const eventList = knownEventList;

export interface LastWatering {
  /** Unix s. */
  ts: number;
  seconds: number;
  source: ActionSource;
  /** Why, for an automatic watering (A6). */
  reason?: AutomationReason;
}

/**
 * A pot's last watering in the hub's history (A5): the last 30 days. Null
 * while asking, `none` if there was none, `unknown` if the hub could not say.
 */
export function useLastWatering(zone: string): LastWatering | 'none' | 'unknown' | null {
  const [last, setLast] = useState<LastWatering | 'none' | 'unknown' | null>(null);
  useEffect(() => {
    let alive = true;
    const to = Math.floor(nowMs() / 1000);
    void hubGet(
      `/events?from=${(to - LOOK_BACK_S).toString()}&to=${to.toString()}`,
      eventList,
    ).then((result) => {
      if (!alive) return;
      if (!result.ok) {
        setLast('unknown');
        return;
      }
      const started = result.value.filter(
        (event) => event.type === 'watering.started' && event.zone === zone,
      );
      const latest = started.at(-1);
      setLast(
        latest?.type === 'watering.started'
          ? {
              ts: latest.ts,
              seconds: latest.seconds,
              source: latest.source,
              ...(latest.reason ? { reason: latest.reason } : {}),
            }
          : 'none',
      );
    });
    return () => {
      alive = false;
    };
  }, [zone]);
  return last;
}
