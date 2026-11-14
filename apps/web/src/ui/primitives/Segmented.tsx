import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

import { nextIndex } from './keyboard.ts';
import './Segmented.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  /** Names the group for screen readers. */
  label: string;
  value: T | null;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /**
   * Waiting for an answer to the last choice: it takes no other choice, but
   * keeps its look (a flat, grey group for a blink reads as a flash).
   */
  busy?: boolean;
}

/**
 * A radio group drawn as a pill: one Tab stop; the arrows (and Home/End)
 * move and choose, as radios do. Every option keeps its width whatever is
 * chosen (room for the dot and the heavier weight), so a choice fades in
 * place and nothing slides.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  busy = false,
}: SegmentedProps<T>) {
  const group = useRef<HTMLDivElement>(null);
  const tabStop = value ?? options[0]?.value;
  const choose = (chosen: T) => {
    if (!busy) onChange(chosen);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextIndex(event.key, index, options.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    event.preventDefault();
    if (busy) return;
    onChange(option.value);
    group.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div ref={group} className="ui-segmented" role="radiogroup" aria-label={label}>
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="ui-segmented-option"
          aria-checked={option.value === value}
          tabIndex={option.value === tabStop ? 0 : -1}
          disabled={disabled}
          aria-disabled={busy || undefined}
          onClick={() => {
            choose(option.value);
          }}
          onKeyDown={(event) => {
            onKeyDown(event, index);
          }}
        >
          <span className="ui-segmented-label" data-label={option.label}>
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
