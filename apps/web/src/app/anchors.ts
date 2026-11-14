/**
 * Where each plant is on screen, from the scene to the HUD, every frame
 * (A2: labels, anchored warnings, keyboard targets). Interface state, not
 * device state. It goes through a plain callback, not a React store: the
 * HUD moves its elements directly, so following the camera at 60 fps
 * re-renders nothing.
 */
export interface PlantOnScreen {
  /** CSS pixels from the top left of the viewport: the top of the plant. */
  x: number;
  y: number;
  /** In front of the camera (not behind it). */
  inFront: boolean;
  /** Another plant stands between the camera and this one. */
  occluded: boolean;
  /** The whole plant on screen (pot and leaves), CSS pixels. */
  body: { x: number; y: number; w: number; h: number };
}

export interface AnchorFrame {
  width: number;
  height: number;
  plants: ReadonlyMap<string, PlantOnScreen>;
}

type Listener = (frame: AnchorFrame) => void;
const listeners = new Set<Listener>();

export function publishAnchors(frame: AnchorFrame): void {
  for (const listener of listeners) listener(frame);
}

export function subscribeAnchors(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * A press that moved less than this is a tap, more is a drag (orbit). A
 * finger always moves a little: ~10 px, as touch platforms do (D84).
 */
export const TAP_SLOP_PX = 10;

/** docs/03: whatever can be tapped is at least 44 px across. */
const TAP_MIN_PX = 44;
let markers: readonly { zone: string; x: number; y: number; w: number; h: number }[] = [];

/** Where the plant markers are now (the HUD writes it after each layout). */
export function setMarkerRects(rects: typeof markers): void {
  markers = rects;
}

/**
 * The plant whose marker is under a tap, if any. The markers let the
 * pointer through (a drag that starts on one still turns the camera), so a
 * tap on one is recognised here, with at least 44 px around it.
 */
export function markerAt(x: number, y: number): string | null {
  for (const m of markers) {
    const padX = Math.max(0, (TAP_MIN_PX - m.w) / 2);
    const padY = Math.max(0, (TAP_MIN_PX - m.h) / 2);
    if (x >= m.x - padX && x <= m.x + m.w + padX && y >= m.y - padY && y <= m.y + m.h + padY) {
      return m.zone;
    }
  }
  return null;
}
