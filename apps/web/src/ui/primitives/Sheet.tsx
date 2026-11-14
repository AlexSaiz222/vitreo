import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import { useMediaQuery } from '../useMediaQuery.ts';
import { IconButton } from './Button.tsx';
import { BackIcon, CloseIcon } from './icons.tsx';
import { ScrollRail } from './ScrollRail.tsx';
import './Sheet.css';

/** Below this width the sheet sits at the bottom, at half or full height. */
const NARROW = '(max-width: 47.99rem)';
/** A vertical drag longer than this is a swipe. */
const SWIPE_PX = 48;
/** A drag longer than this is not a tap. */
const DRAG_SLOP_PX = 8;

export interface SheetProps {
  title: ReactNode;
  /** A line under the title (the species, a hint). */
  subtitle?: ReactNode;
  onClose: () => void;
  /** What matters most: visible at half height on a phone. */
  children: ReactNode;
  /** Below the fold on a phone; keyboard focus there opens the sheet fully. */
  more?: ReactNode;
  className?: string;
  /** A page inside the sheet (Ajustes › Plantas): goes back one level. */
  back?: { label: string; onBack: () => void };
  /** Which page is shown: when it changes, the new title takes the focus. */
  page?: string;
  /** On a phone, open at full height (Ajustes: not a glance, a place to work). */
  full?: boolean;
}

/**
 * A floating panel over the scene (docs/03): at the side on a desktop; on a
 * phone at the bottom, opening at half height (swipe up for everything,
 * swipe down to go back or close). Opaque with a drop shadow (D72). The
 * scene stays usable, so it is not modal. On open the title takes the
 * focus; Escape closes it and the focus goes back to where it was.
 */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  more,
  className,
  back,
  page,
  full = false,
}: SheetProps) {
  const titleId = useId();
  const moreId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const onEscape = useEffectEvent(onClose);

  const narrow = useMediaQuery(NARROW);
  const [expanded, setExpanded] = useState(full);
  const [offset, setOffset] = useState(0);
  const drag = useRef<{ startY: number; moved: boolean; onHandle: boolean } | null>(null);

  useEffect(() => {
    const previous = document.activeElement;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEscape();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  // After the effect above has noted where the focus was.
  useEffect(() => {
    heading.current?.focus();
  }, [page]);

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!narrow) return;
    const target = event.target as HTMLElement;
    if (target.closest('button') && !target.closest('.ui-sheet-handle')) return;
    drag.current = {
      startY: event.clientY,
      moved: false,
      onHandle: target.closest('.ui-sheet-handle') !== null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    const dy = event.clientY - current.startY;
    if (Math.abs(dy) > DRAG_SLOP_PX) current.moved = true;
    // Follow the finger, but not above full height nor below the screen.
    setOffset(expanded ? Math.max(0, dy) : dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setOffset(0);
    // A tap on the handle. Handled here: with the pointer captured by the
    // grab area, the browser sends the click there, not to the button.
    if (!current.moved && current.onHandle) {
      setExpanded(!expanded);
      return;
    }
    const dy = event.clientY - current.startY;
    if (dy < -SWIPE_PX) setExpanded(true);
    else if (dy > SWIPE_PX) {
      if (expanded) setExpanded(false);
      else onClose();
    }
  };

  const size = narrow ? (expanded ? 'full' : 'half') : 'side';

  return (
    <section
      ref={panel}
      className={className ? `ui-sheet ${className}` : 'ui-sheet'}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-hud-obstacle=""
      data-size={size}
      data-dragging={offset !== 0}
      style={offset === 0 ? undefined : { translate: `0 ${offset.toString()}px` }}
    >
      <div
        className="ui-sheet-grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {narrow && more !== undefined && (
          <button
            type="button"
            className="ui-sheet-handle"
            aria-expanded={expanded}
            aria-controls={moreId}
            aria-label={expanded ? 'Mostrar menos' : 'Mostrar más detalles'}
            onClick={(event) => {
              // Keyboard (Enter, Space) only; a pointer is handled on release.
              if (event.detail === 0) setExpanded(!expanded);
            }}
          />
        )}
        <header className="ui-sheet-header">
          {back && <IconButton label={back.label} icon={<BackIcon />} onClick={back.onBack} />}
          <div className="ui-sheet-heading">
            <h2 id={titleId} ref={heading} className="ui-sheet-title" tabIndex={-1}>
              {title}
            </h2>
            {subtitle && <p className="ui-sheet-subtitle">{subtitle}</p>}
          </div>
          <IconButton label="Cerrar" icon={<CloseIcon />} onClick={onClose} />
        </header>
      </div>

      <div
        className="ui-sheet-body"
        onFocus={() => {
          // Keyboard focus below the fold opens the sheet, so it is never hidden.
          if (narrow && !expanded && more === undefined) setExpanded(true);
        }}
      >
        {children}
      </div>

      {more !== undefined && (
        <div
          id={moreId}
          className="ui-sheet-more"
          onFocus={() => {
            if (narrow) setExpanded(true);
          }}
        >
          {more}
        </div>
      )}
      <ScrollRail scroller={panel} />
    </section>
  );
}
