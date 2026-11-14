import type { HTMLAttributes } from 'react';

import './Surface.css';

export type Elevation = 'flat' | 'float' | 'raised-sm' | 'raised-md' | 'inset-sm' | 'inset-md';

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'nav' | 'footer';
  /**
   * `float` is for panels over the 3D canvas: opaque, with a soft drop
   * shadow. Raised and inset are for what sits inside them (D72).
   */
  elevation?: Elevation;
  padding?: 'none' | 'md' | 'lg';
}

export function Surface({
  as: Tag = 'div',
  elevation = 'raised-md',
  padding = 'none',
  className,
  ...rest
}: SurfaceProps) {
  return (
    <Tag
      className={className ? `ui-surface ${className}` : 'ui-surface'}
      data-elevation={elevation}
      data-padding={padding}
      {...rest}
    />
  );
}

/** A raised card with room inside: the usual block of content in a panel. */
export function Card(props: Omit<SurfaceProps, 'elevation'>) {
  return <Surface elevation="raised-md" padding="md" {...props} />;
}
