import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

import './TextField.css';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  /** A line under the field: what it is for, or why it is wrong. */
  hint?: ReactNode;
  /** The hint explains a problem (warm, never red; docs/03). */
  invalid?: boolean;
}

/**
 * A text input: a sunken well (inset means input, D81), the label above, an
 * optional hint below linked by aria-describedby. Native input underneath:
 * the keyboard, autofill and the date picker come for free.
 */
export function TextField({ label, hint, invalid, className, ...rest }: TextFieldProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={className ? `ui-text-field ${className}` : 'ui-text-field'}>
      <label className="ui-text-field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="ui-text-field-input"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="ui-text-field-hint" data-invalid={invalid ? 'true' : undefined}>
          {hint}
        </p>
      )}
    </div>
  );
}

export interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  hint?: ReactNode;
  invalid?: boolean;
}

/** The same well for several lines (a journal note, A8). */
export function TextArea({ label, hint, invalid, className, rows = 3, ...rest }: TextAreaProps) {
  const id = useId();
  const hintId = useId();
  return (
    <div className={className ? `ui-text-field ${className}` : 'ui-text-field'}>
      <label className="ui-text-field-label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        className="ui-text-field-input"
        data-multiline="true"
        aria-invalid={invalid ? true : undefined}
        aria-describedby={hint ? hintId : undefined}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="ui-text-field-hint" data-invalid={invalid ? 'true' : undefined}>
          {hint}
        </p>
      )}
    </div>
  );
}
