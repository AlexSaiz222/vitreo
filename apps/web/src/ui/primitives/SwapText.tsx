import type { ReactNode } from 'react';

import './SwapText.css';

export interface SwapTextProps {
  /** Every text this place can show ("Encender 10 min", "Apagar"). */
  texts: readonly ReactNode[];
  /** Which one is shown now. */
  shown: number;
}

/**
 * Words that change in place without moving anything: all of them are laid
 * one over another, so the place is always as wide as the longest, and the
 * change is a short crossfade. The hidden ones are out of the accessible
 * name at once (`aria-hidden`, then `visibility: hidden` once faded): a
 * screen reader hears only the one shown.
 */
export function SwapText({ texts, shown }: SwapTextProps) {
  return (
    <span className="ui-swap-text">
      {texts.map((text, index) => (
        <span key={index} data-shown={index === shown} aria-hidden={index !== shown || undefined}>
          {text}
        </span>
      ))}
    </span>
  );
}
