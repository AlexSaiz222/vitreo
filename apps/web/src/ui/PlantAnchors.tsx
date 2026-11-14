import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { setMarkerRects, subscribeAnchors } from '../app/anchors.ts';
import type { AnchorFrame } from '../app/anchors.ts';
import { useHud } from '../app/hud.ts';
import { useSelection } from '../app/selection.ts';
import { useShortcutsHelp } from '../app/shortcuts.ts';
import { useView } from '../app/view.ts';
import { useShownMoistures } from '../data/shown.ts';
import { wiltAmount } from '../scene/wilt.ts';
import { ZONES } from '../scene/zones.ts';

const ZONE_IDS = ZONES.map((zone) => zone.id);
import { alertSentence, alertShort, useAlerts } from './alerts.ts';
import { layoutMarkers } from './anchorLayout.ts';
import type { Marker, Rect } from './anchorLayout.ts';
import { formatFraction, plantMood } from './format.ts';
import { AttentionIcon, ChevronIcon } from './primitives/index.ts';
import { useZones } from './useZones.ts';

/** The interface is measured again every so many frames (it rarely moves). */
const MEASURE_EVERY_FRAMES = 10;

/** Everything the plant markers must never cover. */
const OBSTACLES = '[data-hud-obstacle]';

function measureObstacles(): Rect[] {
  return [...document.querySelectorAll<HTMLElement>(OBSTACLES)]
    .map((element) => element.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
}

function gutter(width: number): number {
  const value = getComputedStyle(document.documentElement).getPropertyValue(
    width >= 768 ? '--gutter-desktop' : '--gutter-mobile',
  );
  return Number.parseFloat(value) || 20;
}

/**
 * Labels and warnings on the plants (A2, D83), quiet by default:
 * - a plant that needs something carries a small warm mark that follows it;
 *   it says what ("Albahaca · Sed") when that helps (pointer, focus, zoomed
 *   in) or when it moves to the edge (off screen or under the interface),
 *   pointing at the plant; behind another plant it shows as behind; a tap
 *   on it opens the plant;
 * - a plain name only while it helps: under the pointer, with keyboard focus,
 *   or zoomed in far enough for names to fit;
 * - nothing covers another marker, the header or the dock.
 * Each plant also has an invisible keyboard target (Tab, Enter). Markers let
 * the pointer through to the 3D scene, so a drag that starts on one still
 * turns the camera; a tap on one is recognised by the scene (markerAt).
 */
export function PlantAnchors() {
  const alerts = useAlerts();
  const selected = useSelection((state) => state.zoneId);
  const menu = useHud((state) => state.menu);
  const helpOpen = useShortcutsHelp((state) => state.open);
  const panel = useHud((state) => state.panel);
  // While a dock menu or a sheet is open the markers step aside (D85): the
  // header lists what needs attention, and the Regar menu shows each plant.
  const quiet = selected !== null || menu !== null || panel !== null || helpOpen;
  const open = useSelection((state) => state.open);
  const hovered = useView((state) => state.hovered);
  const [focused, setFocused] = useState<string | null>(null);
  const roomy = useView((state) => state.zoomedIn);
  const moisture = useShownMoistures(ZONE_IDS);
  const zones = useZones();

  const markers = useRef(new Map<string, HTMLElement>());
  const targets = useRef(new Map<string, HTMLElement>());
  const leaders = useRef(new Map<string, HTMLElement>());
  const sizes = useRef(new Map<string, { w: number; h: number }>());
  const shown = useRef(new Map<string, { optional: boolean; priority: number }>());

  // What each plant shows, decided by React (it changes rarely).
  const plan = zones.map((zone, index) => {
    const alert = alerts.find((a) => a.zone === zone.id);
    const helps = hovered === zone.id || focused === zone.id || roomy;
    const kind: 'warning' | 'label' | null = quiet
      ? null
      : alert
        ? 'warning'
        : helps
          ? 'label'
          : null;
    const value = moisture[index] ?? null;
    const thirsty = wiltAmount(value, zone.threshold) > 0;
    return { zone, index, alert, kind, expanded: helps, value, thirsty };
  });
  const visibleKey = plan.map((p) => `${p.zone.id}:${p.kind ?? '-'}`).join(',');
  // What the per-frame layout should place, kept in sync after each render.
  useLayoutEffect(() => {
    shown.current = new Map(
      plan
        .filter((p) => p.kind !== null)
        .map((p) => [p.zone.id, { optional: p.kind === 'label', priority: p.index }]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `plan` is rebuilt every render; its content is `visibleKey`.
  }, [visibleKey]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset['zone'];
        if (id) {
          const box = entry.borderBoxSize[0];
          sizes.current.set(id, { w: box?.inlineSize ?? 0, h: box?.blockSize ?? 0 });
        }
      }
    });
    for (const element of markers.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
    };
  });

  useEffect(() => {
    let frames = 0;
    let obstacles: Rect[] = [];
    const place = (frame: AnchorFrame) => {
      if (frames++ % MEASURE_EVERY_FRAMES === 0) obstacles = measureObstacles();
      const g = gutter(frame.width);
      const area = { x: g, y: g, w: frame.width - 2 * g, h: frame.height - 2 * g };

      const input: Marker[] = [];
      for (const [id, { optional, priority }] of shown.current) {
        const plant = frame.plants.get(id);
        const size = sizes.current.get(id);
        if (!plant || !size || size.w === 0) continue;
        // A plain name for a plant hidden behind another would point at the wrong one.
        if (optional && plant.occluded) continue;
        input.push({
          id,
          point: { x: plant.x, y: plant.y },
          w: size.w,
          h: size.h,
          priority: priority + (optional ? 100 : 0),
          optional,
        });
      }
      const bodies = [...frame.plants].map(([id, plant]) => ({ id, ...plant.body }));
      const placements = new Map(
        layoutMarkers(input, area, obstacles, bodies).map((p) => [p.id, p]),
      );
      // For taps: the markers let the pointer through to the scene.
      setMarkerRects(
        [...placements.values()].map((p) => ({
          zone: p.id,
          x: p.x,
          y: p.y,
          ...(sizes.current.get(p.id) ?? { w: 0, h: 0 }),
        })),
      );

      for (const zone of ZONES) {
        const plant = frame.plants.get(zone.id);
        const marker = markers.current.get(zone.id);
        const leader = leaders.current.get(zone.id);
        const target = targets.current.get(zone.id);
        const placement = placements.get(zone.id);
        if (marker) {
          marker.dataset['placed'] = String(placement !== undefined);
          marker.dataset['occluded'] = String(plant?.occluded ?? false);
          if (placement) {
            marker.dataset['mode'] = placement.mode;
            marker.style.transform = `translate(${placement.x.toFixed(1)}px, ${placement.y.toFixed(1)}px)`;
            const arrow = marker.querySelector<HTMLElement>('.plant-marker-arrow');
            if (arrow && placement.mode === 'edge') {
              arrow.style.transform = `rotate(${placement.angle.toFixed(3)}rad)`;
            }
          }
        }
        if (leader) {
          const show = placement?.mode === 'anchored' && placement.leader && plant !== undefined;
          leader.dataset['placed'] = String(show);
          if (show) {
            const size = sizes.current.get(zone.id) ?? { w: 0, h: 0 };
            const ex = placement.x + size.w / 2;
            const ey = placement.y + (placement.y < plant.y ? size.h : 0);
            const length = Math.hypot(ex - plant.x, ey - plant.y);
            const angle = Math.atan2(ey - plant.y, ex - plant.x);
            leader.style.width = `${length.toFixed(1)}px`;
            leader.style.transform = `translate(${plant.x.toFixed(1)}px, ${plant.y.toFixed(1)}px) rotate(${angle.toFixed(3)}rad)`;
          }
        }
        if (target && plant) {
          // The keyboard target sits on the plant, or on its edge marker.
          const size = sizes.current.get(zone.id) ?? { w: 0, h: 0 };
          const at =
            placement?.mode === 'edge'
              ? { x: placement.x + size.w / 2, y: placement.y + size.h / 2 }
              : {
                  x: Math.min(Math.max(plant.x, area.x), area.x + area.w),
                  y: Math.min(Math.max(plant.y, area.y), area.y + area.h),
                };
          target.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px)`;
        }
      }
    };
    return subscribeAnchors(place);
  }, []);

  return (
    <div className="plant-anchors">
      {plan.map(({ zone, alert, kind, expanded, value, thirsty }) => (
        <div key={zone.id} className="plant-anchor">
          <span
            className="plant-leader"
            data-placed="false"
            aria-hidden="true"
            ref={(element) => {
              if (element) leaders.current.set(zone.id, element);
              else leaders.current.delete(zone.id);
            }}
          />
          {kind !== null && (
            <span
              className="plant-marker"
              data-zone={zone.id}
              data-kind={kind}
              data-expanded={expanded}
              data-placed="false"
              aria-hidden="true"
              ref={(element) => {
                if (element) markers.current.set(zone.id, element);
                else markers.current.delete(zone.id);
              }}
            >
              {kind === 'warning' && alert ? (
                <>
                  <AttentionIcon />
                  <span className="plant-marker-text">
                    <span className="plant-marker-name">{zone.name} · </span>
                    {alertShort(alert)}
                  </span>
                </>
              ) : (
                <>
                  <span>{zone.name}</span>
                  <span className="plant-marker-detail">{formatFraction(value)}</span>
                </>
              )}
              <span className="plant-marker-arrow">
                <ChevronIcon />
              </span>
            </span>
          )}
          <button
            type="button"
            className="plant-target"
            data-zone={zone.id}
            aria-label={`${zone.name}: ${formatFraction(value)}, ${
              alert
                ? // "la albahaca tiene sed", but "Pepa tiene sed": a given name keeps its capital.
                  zone.article
                  ? alertSentence(alert, zones).toLowerCase()
                  : alertSentence(alert, zones)
                : plantMood(value, thirsty).toLowerCase()
            }`}
            ref={(element) => {
              if (element) targets.current.set(zone.id, element);
              else targets.current.delete(zone.id);
            }}
            onFocus={() => {
              setFocused(zone.id);
            }}
            onBlur={() => {
              setFocused((current) => (current === zone.id ? null : current));
            }}
            onClick={() => {
              open(zone.id);
            }}
          />
        </div>
      ))}
    </div>
  );
}
