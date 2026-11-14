import { useHub } from '../data/hub.ts';
import { hubDownText } from './hubText.ts';

/** One line in a sheet: what `up` says, or why not and what happens meanwhile. */
export function HubNote({ up, waiting }: { up: string; waiting: string }) {
  const status = useHub((state) => state.status);
  const downSince = useHub((state) => state.downSince);
  const device = useHub((state) => state.health?.device);
  const why = hubDownText(status, downSince, device);
  return (
    <p className="plant-empty" data-hub={status}>
      {why === null ? up : status === 'unknown' ? why : `${why}: ${waiting}`}
    </p>
  );
}
