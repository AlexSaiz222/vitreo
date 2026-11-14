import type { ReactNode } from 'react';

import './Chip.css';

export interface ChipProps {
  children: ReactNode;
  icon?: ReactNode;
  /** `attention` uses the warm tone, never red (docs/03). */
  tone?: 'neutral' | 'good' | 'attention';
}

/** A small status label: always words, an icon only alongside them. */
export function Chip({ children, icon, tone = 'neutral' }: ChipProps) {
  return (
    <span className="ui-chip" data-tone={tone}>
      {icon}
      <span>{children}</span>
    </span>
  );
}
