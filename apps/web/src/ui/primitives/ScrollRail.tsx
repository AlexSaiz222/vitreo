import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

import { THUMB_INSET_PX as INSET_PX, thumbPlace } from './scrollThumb.ts';

/** How long the thumb stays after the last scroll (ms), as --duration-scroll-fade. */
const FADE_MS = 900;

/**
 * The sheets' own scrollbar: a thin rounded thumb a little in from the edge,
 * instead of the system's (on Windows a wide grey bar with arrows that cut
 * the panel's rounded corner). It shows while scrolling and under the
 * pointer, then fades; it can be dragged. Decoration for the eye: the wheel,
 * touch and the keyboard scroll the panel as always, and screen readers do
 * not need it.
 */
export function ScrollRail({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; startTop: number } | null>(null);

  useEffect(() => {
    const element = scroller.current;
    const bar = thumb.current;
    // Without layout (tests), there is nothing to place.
    if (!element || !bar || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    let fade: ReturnType<typeof setTimeout> | undefined;
    const place = () => {
      frame = 0;
      const at = thumbPlace(element.scrollTop, element.scrollHeight, element.clientHeight);
      if (!at) {
        bar.dataset['hidden'] = 'true';
        return;
      }
      delete bar.dataset['hidden'];
      bar.style.height = `${at.height.toString()}px`;
      bar.style.transform = `translateY(${at.top.toString()}px)`;
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    const onScroll = () => {
      later();
      bar.dataset['active'] = 'true';
      clearTimeout(fade);
      fade = setTimeout(() => {
        if (!drag.current) delete bar.dataset['active'];
      }, FADE_MS);
    };
    // The content grows and shrinks (more details, a chart arriving).
    const resize = new ResizeObserver(later);
    const watch = () => {
      resize.disconnect();
      resize.observe(element);
      for (const child of element.children) resize.observe(child);
    };
    const children = new MutationObserver(() => {
      watch();
      later();
    });
    watch();
    children.observe(element, { childList: true });
    element.addEventListener('scroll', onScroll, { passive: true });
    place();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fade);
      resize.disconnect();
      children.disconnect();
      element.removeEventListener('scroll', onScroll);
    };
  }, [scroller]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scroller.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    drag.current = { startY: event.clientY, startTop: element.scrollTop };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.currentTarget.dataset['active'] = 'true';
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = scroller.current;
    const current = drag.current;
    if (!element || !current) return;
    const at = thumbPlace(element.scrollTop, element.scrollHeight, element.clientHeight);
    if (!at) return;
    const travel = element.clientHeight - INSET_PX * 2 - at.height;
    const room = element.scrollHeight - element.clientHeight;
    if (travel <= 0) return;
    element.scrollTo({
      top: current.startTop + ((event.clientY - current.startY) * room) / travel,
    });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    delete event.currentTarget.dataset['active'];
  };

  return (
    <div
      ref={thumb}
      className="ui-scroll-thumb"
      aria-hidden="true"
      data-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
