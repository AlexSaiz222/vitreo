import { useId, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import { startReplay } from '../../data/replay.ts';
import { ZONES } from '../../scene/zones.ts';
import { Button } from '../../ui/primitives/index.ts';
import { explainWatering } from '../automations/explain.ts';
import {
  gapSpans,
  indexAt,
  linePath,
  normalized,
  onSpans,
  valueAt,
  xOf,
  yOf,
} from '../history/chart.ts';
import type { Series } from '../history/chart.ts';
import { CHART_RANGES } from '../history/usePlantHistory.ts';
import type { ChartRange } from '../history/usePlantHistory.ts';
import type { GreenhouseWatering } from './useGreenhouseHistory.ts';

export interface ChartLine {
  key: string;
  /** "Dentro", "Fuera": said in the readout when there is more than one line. */
  label: string;
  series: Series;
  /** Outside (AEMET): a soft dashed line, never taken for the greenhouse's. */
  outside?: boolean;
}

/** Something that was on or open for part of the time (window, fan, light). */
export interface ChartActivity {
  key: string;
  label: string;
  /** Fraction of each bucket it was on (0–1). */
  series: Series;
  /** "abierta", "encendido": for the readout and the table. */
  on: string;
}

const time = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });
const day = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const dayTime = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const at = (seconds: number) => new Date(seconds * 1000);
/** "14:10" within the last day, "3 oct, 14:10" before. */
const when = (seconds: number, range: ChartRange): string =>
  range === '24h' ? time.format(at(seconds)) : dayTime.format(at(seconds));

/** "abierta", or "abierta un rato" when it was on for less than half the stretch. */
const activityText = (activity: ChartActivity, fraction: number) =>
  fraction >= 0.5 ? activity.on : `${activity.on} un rato`;

/**
 * One chart of the greenhouse sheet (A11), with the rules of the plant's
 * (A5, D88): gaps stay gaps; a finger, the mouse or the arrow keys show the
 * values and the time, and from there the whole greenhouse as it was; a
 * table for screen readers. Under the plot, when the window, the fan or the
 * light were on, so a peak can be read with its cause.
 */
export function TimeChart({
  name,
  range,
  lines,
  domain,
  format,
  axis,
  since,
  shade,
  activity = [],
  waterings = [],
  zoneName,
}: {
  /** "Temperatura": for the caption, the table and the keyboard hint. */
  name: string;
  range: ChartRange;
  /** The first is the greenhouse's own: its gaps are the ones shown. */
  lines: ChartLine[];
  domain: readonly [number, number];
  format: (value: number) => string;
  /** Labels for the top, middle and bottom of the y axis. */
  axis: readonly [string, string, string];
  since: number | null;
  /** A soft wash behind the line where this was on (the grow light). */
  shade?: { label: string; series: Series };
  activity?: ChartActivity[];
  waterings?: GreenhouseWatering[];
  zoneName?: (zone: string) => string;
}) {
  const id = useId();
  const [index, setIndex] = useState<number | null>(null);
  const [primary] = lines;
  if (!primary) return null;
  const series = primary.series;
  const gaps = gapSpans(series, since);
  const beforeHistory = since !== null && since > series.from ? xOf(series, since) : 0;
  const shownWaterings = waterings.filter((w) => w.t >= series.from && w.t <= series.to);
  const shaded = shade ? onSpans(shade.series) : [];
  const several = lines.length > 1;

  const bucket = index === null ? null : (series.ts[index] ?? null);
  const mid = bucket === null ? null : bucket + series.step / 2;
  const value = index === null ? null : (series.values[index] ?? null);
  const readout =
    bucket === null || mid === null
      ? null
      : [
          when(bucket, range),
          ...lines.map((line) => {
            const v = line === primary ? value : valueAt(line.series, mid);
            const text = v === null ? 'sin datos' : format(v);
            return several ? `${line.label.toLowerCase()} ${text}` : text;
          }),
          ...[...activity, ...(shade ? [{ ...shade, key: 'shade', on: 'encendida' }] : [])]
            .map((a) => ({ a, f: valueAt(a.series, mid) }))
            .filter(({ f }) => f !== null && f > 0)
            .map(({ a, f }) => `${a.label.toLowerCase()} ${activityText(a, f ?? 0)}`),
          ...shownWaterings
            .filter((w) => w.t >= bucket && w.t < bucket + series.step)
            .map(
              (w) =>
                `${w.source === 'user' ? 'riego tuyo' : explainWatering(w.reason).toLowerCase()} (${zoneName?.(w.zone) ?? w.zone})`,
            ),
        ].join(' · ');

  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setIndex(indexAt(series, ((event.clientX - box.left) / box.width) * 100));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = series.ts.length - 1;
    const moves: Record<string, number> = {
      ArrowLeft: (index ?? last + 1) - 1,
      ArrowRight: (index ?? -1) + 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setIndex(Math.min(Math.max(next, 0), last));
  };
  const toPast = () => {
    if (mid === null) return;
    startReplay(range, { at: mid, zones: ZONES.map((z) => z.id) });
  };
  const x = mid === null ? 0 : xOf(series, mid);
  const yValue = (v: number) => yOf(normalized({ ...series, values: [v] }, domain).values[0] ?? 0);

  return (
    <figure className="history-chart climate-chart" aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`} className="visually-hidden">
        {name}, últimos {CHART_RANGES[range].label}.
      </figcaption>
      <div
        className="history-plot"
        role="group"
        tabIndex={0}
        aria-label={`${name}. Flechas para recorrer.`}
        aria-describedby={`${id}-readout`}
        onPointerDown={pick}
        onPointerMove={(event) => {
          if (event.pointerType === 'mouse' || event.buttons > 0) pick(event);
        }}
        onKeyDown={onKey}
      >
        <svg
          className="history-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {[0, 50, 100].map((y) => (
            <line key={y} className="history-grid" x1="0" x2="100" y1={y} y2={y} />
          ))}
          {shaded.map((span) => (
            <rect
              key={`shade-${span.start.toString()}`}
              className="climate-shade"
              x={xOf(series, span.start)}
              y="0"
              width={xOf(series, span.end) - xOf(series, span.start)}
              height="100"
            />
          ))}
          {beforeHistory > 0 && (
            <rect className="history-before" x="0" y="0" width={beforeHistory} height="100" />
          )}
          {gaps.map((gap) => (
            <rect
              key={gap.start}
              className="history-gap"
              x={xOf(series, gap.start)}
              y="0"
              width={xOf(series, gap.end) - xOf(series, gap.start)}
              height="100"
            />
          ))}
          {[...lines].reverse().map((line) => (
            <path
              key={line.key}
              className="history-line climate-line"
              data-line={line.outside ? 'outside' : line.key}
              d={linePath(normalized(line.series, domain))}
            />
          ))}
          {index !== null && <line className="history-cursor" x1={x} x2={x} y1="0" y2="100" />}
        </svg>
        {shownWaterings.map((w) => (
          <span
            key={`${w.zone}-${w.t.toString()}`}
            className="history-mark"
            data-source={w.source === 'user' ? 'user' : 'auto'}
            style={{ left: `${xOf(series, w.t).toString()}%` }}
            aria-hidden="true"
          />
        ))}
        {index !== null && value !== null && (
          <span
            className="history-dot climate-dot"
            style={{ left: `${x.toString()}%`, top: `${yValue(value).toString()}%` }}
            aria-hidden="true"
          />
        )}
        <span className="history-axis-y" aria-hidden="true">
          {axis.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </span>
      </div>
      {activity.length > 0 && (
        <div className="climate-activity" aria-hidden="true">
          {activity.map((a) => (
            <div key={a.key} className="climate-activity-row">
              <span className="climate-activity-label">{a.label}</span>
              <span className="climate-activity-track">
                {onSpans(a.series).map((span) => (
                  <span
                    key={span.start}
                    className="climate-activity-on"
                    data-activity={a.key}
                    style={{
                      left: `${xOf(series, span.start).toString()}%`,
                      width: `${(xOf(series, span.end) - xOf(series, span.start)).toString()}%`,
                    }}
                  />
                ))}
                {index !== null && (
                  <span className="climate-activity-cursor" style={{ left: `${x.toString()}%` }} />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="history-axis-x" aria-hidden="true">
        <span>{range === '24h' ? time.format(at(series.from)) : day.format(at(series.from))}</span>
        <span>ahora</span>
      </div>
      <p id={`${id}-readout`} className="history-readout" aria-live="polite">
        {readout ?? 'Toca la gráfica para ver el valor y la hora.'}
      </p>
      {readout !== null && (
        <Button className="history-past" onClick={toPast}>
          Ver el invernadero así
        </Button>
      )}
      <ul className="history-legend" aria-hidden="true">
        {lines.map((line) => (
          <li key={line.key} data-key={line.outside ? 'outside' : `climate-${line.key}`}>
            {line.label}
          </li>
        ))}
        {shade && shaded.length > 0 && <li data-key="shade">{shade.label}</li>}
        {shownWaterings.some((w) => w.source === 'user') && <li data-key="user">Riego tuyo</li>}
        {shownWaterings.some((w) => w.source !== 'user') && (
          <li data-key="auto">Riego automático</li>
        )}
        {gaps.length > 0 && <li data-key="gap">Sin datos</li>}
      </ul>
      {/* Wrapped: a table takes its content's width whatever its own (A12, text at 200 %). */}
      <div className="visually-hidden">
        <table>
          <caption>Valores de {name.toLowerCase()}</caption>
          <thead>
            <tr>
              <th scope="col">Hora</th>
              {lines.map((line) => (
                <th key={line.key} scope="col">
                  {line.label}
                </th>
              ))}
              {[...activity, ...(shade ? [{ ...shade, key: 'shade' }] : [])].map((a) => (
                <th key={a.key} scope="col">
                  {a.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.ts.map((t, i) => (
              <tr key={t}>
                <td>{when(t, range)}</td>
                {lines.map((line) => {
                  const v =
                    line === primary
                      ? (series.values[i] ?? null)
                      : valueAt(line.series, t + series.step / 2);
                  return <td key={line.key}>{v === null ? 'sin datos' : format(v)}</td>;
                })}
                {[...activity, ...(shade ? [{ ...shade, key: 'shade' }] : [])].map((a) => {
                  const f = valueAt(a.series, t + series.step / 2);
                  return (
                    <td key={a.key}>
                      {f === null ? 'sin datos' : `${Math.round(f * 100).toString()} % del tiempo`}
                    </td>
                  );
                })}
              </tr>
            ))}
            {shownWaterings.map((w) => (
              <tr key={`w-${w.zone}-${w.t.toString()}`}>
                <td>{when(w.t, range)}</td>
                <td colSpan={lines.length + activity.length + (shade ? 1 : 0)}>
                  Riego de {w.seconds.toString()} s, {zoneName?.(w.zone) ?? w.zone} (
                  {w.source === 'user' ? 'tuyo' : 'automático'})
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
