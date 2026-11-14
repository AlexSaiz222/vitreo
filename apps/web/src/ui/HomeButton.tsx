import { useView } from '../app/view.ts';
import { HomeIcon, IconButton } from './primitives/index.ts';

/**
 * Back to the whole diorama (A2): only while the camera is away from it, so
 * it never sits there doing nothing. Also: double tap on empty space, or H.
 */
export function HomeButton() {
  const away = useView((state) => state.away);
  const goHome = useView((state) => state.goHome);
  if (!away) return null;
  return (
    <IconButton
      className="hud-floating home-button"
      size="lg"
      icon={<HomeIcon />}
      label="Vista inicial"
      onClick={goHome}
    />
  );
}
