import { IN_DEMO } from '../app/demo.ts';
import { useShownMoisture } from '../data/shown.ts';
import { wiltAmount } from '../scene/wilt.ts';
import type { ZoneLayout } from '../scene/zones.ts';
import { formatFraction } from './format.ts';
import { useZones } from './useZones.ts';

function ZoneSummary({ zone }: { zone: ZoneLayout }) {
  const moisture = useShownMoisture(zone.id);
  const feeling =
    moisture === null ? '' : wiltAmount(moisture, zone.threshold) > 0 ? ', tiene sed' : ', bien';
  return (
    <li>
      {zone.name}: tierra al {formatFraction(moisture)}
      {feeling}
    </li>
  );
}

/** Text version of the scene for screen readers: nothing depends only on the 3D. */
export function SceneSummary() {
  const zones = useZones();
  return (
    <section className="visually-hidden" aria-label="Resumen del invernadero">
      {IN_DEMO && <p>Demo · datos simulados.</p>}
      <ul>
        {zones.map((zone) => (
          <ZoneSummary key={zone.id} zone={zone} />
        ))}
      </ul>
    </section>
  );
}
