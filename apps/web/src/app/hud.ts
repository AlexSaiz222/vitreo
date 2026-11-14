import { create } from 'zustand';

/**
 * Which dock menu or panel is open (interface state). The plant markers hide
 * while one is open, or a sheet (D85): the header and the menu already say
 * what needs attention.
 */
export type DockMenu = 'water' | 'air';

/**
 * A panel over the scene that is not a plant: Ajustes, the welcome (A3) or
 * the greenhouse's own sheet, its climate and tank (A11).
 */
export type HudPanel = 'settings' | 'welcome' | 'greenhouse';

/** Where the greenhouse sheet opens: its climate (the header) or its tank (the dock). */
export type GreenhouseSection = 'climate' | 'tank';

interface HudState {
  menu: DockMenu | null;
  panel: HudPanel | null;
  section: GreenhouseSection;
  setMenu: (menu: DockMenu | null) => void;
  setPanel: (panel: HudPanel | null) => void;
  openGreenhouse: (section: GreenhouseSection) => void;
}

export const useHud = create<HudState>()((set) => ({
  menu: null,
  panel: null,
  section: 'climate',
  setMenu: (menu) => {
    set({ menu });
  },
  setPanel: (panel) => {
    set({ panel, menu: null });
  },
  openGreenhouse: (section) => {
    set({ panel: 'greenhouse', section, menu: null });
  },
}));
