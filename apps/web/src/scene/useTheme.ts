import { useSyncExternalStore } from 'react';

import type { ThemeMode } from '../app/dayNight.ts';

export type { ThemeMode };

/** The theme in effect, from the resolved `color-scheme` set by tokens.css. */
function readTheme(): ThemeMode {
  return getComputedStyle(document.documentElement).colorScheme === 'dark' ? 'night' : 'day';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    observer.disconnect();
  };
}

export function useTheme(): ThemeMode {
  return useSyncExternalStore(subscribe, readTheme, () => 'day');
}
