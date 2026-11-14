import { useShallow } from 'zustand/react/shallow';

import { useSelection } from '../app/selection.ts';
import { useSettings } from '../app/settings.ts';
import { useGreenhouse } from '../data/greenhouse.ts';
import { useShownMoistures } from '../data/shown.ts';
import { wiltAmount } from '../scene/wilt.ts';
import { ZONES } from '../scene/zones.ts';

const ZONE_IDS = ZONES.map((zone) => zone.id);
import { formatFraction, plantMood } from './format.ts';
import { AttentionIcon, Chip, ListRow, MoistureDrop } from './primitives/index.ts';
import { useZones } from './useZones.ts';

/**
 * The greenhouse without 3D (A3, D86): every plant with its water drop,
 * moisture and mood, the same actions through its sheet. For phones that
 * struggle, for a quiet glance, and as the fallback when WebGL cannot run;
 * it never downloads the 3D model.
 */
export function PlantList2D() {
  const open = useSelection((state) => state.open);
  const webglFailed = useSettings((state) => state.webglFailed);
  const moisture = useShownMoistures(ZONE_IDS);
  const watering = useGreenhouse(useShallow((state) => Object.keys(state.watering)));
  const zones = useZones();

  return (
    <section className="plant-list" aria-labelledby="plant-list-title">
      <h2 id="plant-list-title" className="hud-label">
        Plantas
      </h2>
      {webglFailed && (
        <p className="plant-list-note">
          Este dispositivo no puede mostrar el invernadero en 3D: aquí está en lista.
        </p>
      )}
      <ul className="plant-list-items">
        {zones.map((zone, index) => {
          const value = moisture[index] ?? null;
          const thirsty = wiltAmount(value, zone.threshold) > 0;
          const mood = watering.includes(zone.id) ? 'Regando' : plantMood(value, thirsty);
          return (
            <li key={zone.id}>
              <ListRow
                className="menu-row"
                data-zone={zone.id}
                icon={<MoistureDrop moisture={value} thirsty={thirsty} />}
                title={zone.name}
                detail={
                  value === null ? (
                    'Sin lectura del sensor'
                  ) : (
                    <>
                      <span className="reading">{formatFraction(value)}</span> ·{' '}
                      {mood.toLowerCase()}
                    </>
                  )
                }
                muted={value === null}
                trailing={
                  thirsty ? (
                    <Chip tone="attention" icon={<AttentionIcon />}>
                      Sed
                    </Chip>
                  ) : undefined
                }
                onClick={() => {
                  open(zone.id);
                }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
