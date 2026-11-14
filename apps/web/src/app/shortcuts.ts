import { useEffect } from 'react';
import { create } from 'zustand';

import { useSelection } from './selection.ts';
import { useView } from './view.ts';

/** Whether the list of keyboard shortcuts is open. */
export const useShortcutsHelp = create<{ open: boolean; set: (open: boolean) => void }>()(
  (set) => ({
    open: false,
    set: (open) => {
      set({ open });
    },
  }),
);

/** Keys that type text: shortcuts never fire there. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Keyboard shortcuts (docs/03, A2): 1–6 open a plant, L switches the grow
 * light, H goes back to the home view, ? lists them. Escape closes what is
 * open (each sheet handles it).
 */
export function useShortcuts({
  zones,
  toggleLight,
}: {
  zones: readonly { id: string }[];
  toggleLight: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (typing(event.target) || event.altKey) return;
      if (event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      const zone = Number.isInteger(index) ? zones[index] : undefined;
      if (zone) {
        useSelection.getState().open(zone.id);
      } else if (event.key === 'h' || event.key === 'H') {
        useView.getState().goHome();
      } else if (event.key === 'l' || event.key === 'L') {
        toggleLight();
      } else if (event.key === '?') {
        useShortcutsHelp.getState().set(true);
      } else {
        return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [zones, toggleLight]);
}
