import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is the main action, filled with ink (D46); one per view. */
  variant?: 'neutral' | 'primary';
  size?: 'md' | 'lg';
  icon?: ReactNode;
  /** For buttons that switch something on and off (aria-pressed). */
  pressed?: boolean;
  /** A second, smaller line: the state ("Encendida") or what is happening. */
  detail?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'neutral',
  size = 'md',
  icon,
  pressed,
  detail,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={className ? `ui-button ${className}` : 'ui-button'}
      data-variant={variant}
      data-size={size}
      aria-pressed={pressed}
      {...rest}
    >
      {icon}
      {detail === undefined ? (
        <span>{children}</span>
      ) : (
        <span className="ui-button-text">
          <span>{children}</span>
          <span className="ui-button-detail">{detail}</span>
        </span>
      )}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Required: an icon alone says nothing to a screen reader (docs/03). */
  label: string;
  icon: ReactNode;
  size?: 'md' | 'lg';
  pressed?: boolean;
}

export function IconButton({
  label,
  icon,
  size = 'md',
  pressed,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={className ? `ui-icon-button ${className}` : 'ui-icon-button'}
      data-size={size}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      {...rest}
    >
      {icon}
    </button>
  );
}
