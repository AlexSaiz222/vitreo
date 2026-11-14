import { useHud } from '../app/hud.ts';
import { useSelection } from '../app/selection.ts';
import { GreenhouseIcon, IconButton } from './primitives/index.ts';

/**
 * The greenhouse's own sheet (A11, D128), with the round buttons at the top
 * right: the readings in the header open it too, but text over the scene
 * does not look like something to press for whoever arrives.
 */
export function GreenhouseButton() {
  const openGreenhouse = useHud((state) => state.openGreenhouse);
  const close = useSelection((state) => state.close);
  return (
    <IconButton
      className="hud-floating greenhouse-button"
      size="lg"
      icon={<GreenhouseIcon />}
      label="Invernadero"
      aria-haspopup="dialog"
      onClick={() => {
        close();
        openGreenhouse('climate');
      }}
    />
  );
}
