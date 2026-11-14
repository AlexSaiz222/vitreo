import { create } from 'zustand';

/**
 * Which plant the detail sheet shows. Interface state, not device state:
 * the scene may set it (tapping a pot) as well as read it.
 */
interface SelectionState {
  zoneId: string | null;
  open: (zoneId: string) => void;
  close: () => void;
}

export const useSelection = create<SelectionState>()((set) => ({
  zoneId: null,
  open: (zoneId) => {
    set({ zoneId });
  },
  close: () => {
    set({ zoneId: null });
  },
}));
