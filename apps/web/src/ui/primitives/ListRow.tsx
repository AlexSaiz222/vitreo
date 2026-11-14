import type { ButtonHTMLAttributes, ReactNode } from 'react';

import { ChevronIcon } from './icons.tsx';
import './ListRow.css';

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  title: ReactNode;
  detail?: ReactNode;
  /** A decorative icon at the start (not a control). */
  icon?: ReactNode;
  /** Something at the end instead of the chevron (a chip, a value). */
  trailing?: ReactNode;
  /** No data to show: same surface, muted content (it can still be opened). */
  muted?: boolean;
}

/** A row that leads somewhere: raised, it sinks when pressed. */
export function ListRow({
  title,
  detail,
  icon,
  trailing,
  muted,
  className,
  type = 'button',
  ...rest
}: ListRowProps) {
  return (
    <button
      type={type}
      className={className ? `ui-list-row ${className}` : 'ui-list-row'}
      data-muted={muted}
      {...rest}
    >
      {icon && (
        <span className="ui-list-row-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="ui-list-row-text">
        <span className="ui-list-row-title">{title}</span>
        {detail && <span className="ui-list-row-detail">{detail}</span>}
      </span>
      {trailing ?? <ChevronIcon />}
    </button>
  );
}
