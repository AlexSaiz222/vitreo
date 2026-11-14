import { useHub } from '../data/hub.ts';
import { hubDownText } from './hubText.ts';

/** The hub can take changes now? Else the sentence that says why not. */
export function useHubBlocker(waiting: string): string | null {
  const status = useHub((state) => state.status);
  const downSince = useHub((state) => state.downSince);
  const device = useHub((state) => state.health?.device);
  const why = hubDownText(status, downSince, device);
  if (why === null) return null;
  return status === 'unknown' ? why : `${why}: ${waiting}`;
}
