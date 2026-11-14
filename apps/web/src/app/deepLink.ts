import { ZONES } from '../scene/zones.ts';
import { useHud } from './hud.ts';
import { useSelection } from './selection.ts';

/**
 * Opens the app on what a notification is about (A7, D91): `?open=plant:<id>`
 * (that plant's sheet), `?open=tank` (the Regar menu, by the tank),
 * `?open=air` (the Aire menu) or `?open=greenhouse` (its sheet, A11;
 * `greenhouse:tank` at the tank). The parameter is then removed, so a
 * reload does not open it again.
 */
export function openFromUrl(location: Location = window.location): void {
  const params = new URLSearchParams(location.search);
  const target = params.get('open');
  if (!target) return;
  if (target.startsWith('plant:')) {
    const zone = target.slice('plant:'.length);
    if (ZONES.some((z) => z.id === zone)) useSelection.getState().open(zone);
  } else if (target === 'tank') {
    useHud.getState().setMenu('water');
  } else if (target === 'air') {
    useHud.getState().setMenu('air');
  } else if (target === 'greenhouse' || target === 'greenhouse:tank') {
    useHud.getState().openGreenhouse(target === 'greenhouse' ? 'climate' : 'tank');
  }
  params.delete('open');
  const rest = params.toString();
  window.history.replaceState(
    null,
    '',
    `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`,
  );
}
