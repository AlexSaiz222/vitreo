import { now as nowMs } from '../../app/clock.ts';
import { nightNow } from '../../app/dayNight.ts';
import { IN_DEMO } from '../../app/demo.ts';
import { currentLocation } from '../../app/location.ts';
import { greenhouseStore } from '../../data/greenhouse.ts';
import { useReplay } from '../../data/replay.ts';
import { sceneReading } from '../../data/sceneReading.ts';
import { outdoorNow, rainRecord } from '../../data/weather.ts';
import { wetnessFor } from '../../data/wetness.ts';
import { carryMix } from './carry.ts';
import type { MixInput } from './mix.ts';
import { runAmbient } from './run.ts';

export { useSound } from './run.ts';
export type { SoundStatus } from './run.ts';

/** What the twin shows now, for the mix. */
export function mixInput(): MixInput {
  const replaying = useReplay.getState().mode === 'replay';
  const state = greenhouseStore.getState();
  const live = sceneReading.live();
  const weather = outdoorNow();
  const wetness = weather ? wetnessFor(rainRecord(), nowMs() / 1000, weather.rain) : 0;
  return {
    night: nightNow(currentLocation()),
    vent: sceneReading.vent(),
    fan: sceneReading.fan(),
    // The past is not watered: the trickle is only for now.
    watering: !replaying && Object.keys(state.watering).length > 0,
    live,
    // AEMET (A10): none while rewinding, with the hub down or old data.
    weather: weather ? { wind: weather.wind, rain: weather.rain } : null,
    wetness,
  };
}

/**
 * The app's ambient sound (A9, D96): the bed follows the twin (run.ts). In
 * the demo, what it sounds like is also left for the notebook's page, so
 * the same sound goes on there (D129). The devices and the interface have
 * their own sounds and switches (touch.ts, D131).
 */
export function startAmbientSound(): () => void {
  const run = runAmbient(() => {
    const input = mixInput();
    if (IN_DEMO) carryMix(input);
    return input;
  });
  return run.stop;
}
