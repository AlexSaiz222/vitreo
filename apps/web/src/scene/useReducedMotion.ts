import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/** Whether the user asked for reduced motion (kept up to date). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const media = matchMedia(QUERY);
      media.addEventListener('change', onChange);
      return () => {
        media.removeEventListener('change', onChange);
      };
    },
    () => matchMedia(QUERY).matches,
    () => false,
  );
}
