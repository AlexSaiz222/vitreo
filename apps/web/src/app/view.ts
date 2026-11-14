import { create } from 'zustand';

/**
 * The camera, as the interface sees it (interface state, not device state).
 * The HUD asks for the home view (button, double tap, H); the scene eases
 * back to it and says whether the camera is away from it, so the button
 * only shows when it would do something. `hovered` is the plant under the
 * pointer in the 3D scene, for its label.
 */
interface ViewState {
  homeRequests: number;
  away: boolean;
  hovered: string | null;
  /** Zoomed in well past the home view: plant names fit (A2). */
  zoomedIn: boolean;
  /** Zoomed in at all: the dock folds so it covers less of the greenhouse (D134). */
  closer: boolean;
  goHome: () => void;
  setAway: (away: boolean) => void;
  setHovered: (zoneId: string | null) => void;
  setZoomedIn: (zoomedIn: boolean) => void;
  setCloser: (closer: boolean) => void;
}

export const useView = create<ViewState>()((set) => ({
  homeRequests: 0,
  away: false,
  hovered: null,
  zoomedIn: false,
  closer: false,
  goHome: () => {
    set((state) => ({ homeRequests: state.homeRequests + 1 }));
  },
  setAway: (away) => {
    set((state) => (state.away === away ? state : { away }));
  },
  setHovered: (hovered) => {
    set((state) => (state.hovered === hovered ? state : { hovered }));
  },
  setZoomedIn: (zoomedIn) => {
    set((state) => (state.zoomedIn === zoomedIn ? state : { zoomedIn }));
  },
  setCloser: (closer) => {
    set((state) => (state.closer === closer ? state : { closer }));
  },
}));
