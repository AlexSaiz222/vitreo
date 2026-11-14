/** The thumb is never shorter than this (px), as --scroll-thumb-min. */
const MIN_THUMB_PX = 32;
/** Space above and below the thumb's travel (px): clear of the panel's rounded corners. */
export const THUMB_INSET_PX = 22;

/** Where the sheets' scrollbar thumb goes (ScrollRail), in the scroller's content coordinates (px). */
export function thumbPlace(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): { top: number; height: number } | null {
  const room = scrollHeight - clientHeight;
  if (room <= 1 || clientHeight <= 0) return null;
  const track = clientHeight - THUMB_INSET_PX * 2;
  const height = Math.min(track, Math.max(MIN_THUMB_PX, (track * clientHeight) / scrollHeight));
  const through = Math.min(1, Math.max(0, scrollTop / room));
  return { top: scrollTop + THUMB_INSET_PX + (track - height) * through, height };
}
