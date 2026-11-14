import { useId } from 'react';

import { CheckIcon } from './icons.tsx';
import './Toggle.css';

export interface ToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

/** An on/off switch (`role="switch"`): Space or Enter toggle it. */
export function Toggle({ label, description, checked, onChange, disabled }: ToggleProps) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      role="switch"
      className="ui-toggle"
      aria-checked={checked}
      aria-describedby={description ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="ui-toggle-text">
        <span>{label}</span>
        {description && (
          <span id={descriptionId} className="ui-toggle-description">
            {description}
          </span>
        )}
      </span>
      <span className="ui-toggle-track" aria-hidden="true">
        <span className="ui-toggle-knob">{checked && <CheckIcon />}</span>
      </span>
    </button>
  );
}
