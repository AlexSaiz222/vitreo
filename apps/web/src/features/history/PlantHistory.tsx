import type { JournalTag } from '@vitreo/shared';
import { useId, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { KeyboardEvent, PointerEvent } from 'react';

import { IN_DEMO } from '../../app/demo.ts';
import { startReplay } from '../../data/replay.ts';
import type { ReplayRange } from '../../data/replay.ts';
import { hubUrl } from '../../data/hub.ts';
import { useJournal } from '../../data/journal.ts';
import type { ZoneLayout } from '../../scene/zones.ts';
import { ZONES } from '../../scene/zones.ts';
import { formatFraction } from '../../ui/format.ts';
import { HubNote } from '../../ui/HubNote.tsx';
import { Button, Segmented } from '../../ui/primitives/index.ts';
import { explainReason, explainWatering } from '../automations/explain.ts';
import { tagsText } from '../journal/tags.ts';
import { gapSpans, indexAt, linePath, readings, xOf, yOf } from './chart.ts';
import type { Series } from './chart.ts';
import { CHART_RANGES, usePlantHistory } from './usePlantHistory.ts';
import type { ChartRange, WateringMark } from './usePlantHistory.ts';
import './history.css';

const RANGES = (Object.keys(CHART_RANGES) as ChartRange[]).map((value) => ({
  value,
  label: CHART_RANGES[value].label,
}));

/** The soft band around the threshold, in moisture (0–1). */
const BAND = 0.06;
/** Fewer readings than this: not a chart yet, an honest empty state. */
const MIN_READINGS = 3;

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
const when = (seconds: number, range: ChartRange) =>
  range === '24h' ? time.format(at(seconds)) : dayTime.format(at(seconds));

const SOURCE: Record<WateringMark['source'], string> = {
  user: 'tú',
  automation: 'automático',
  agent: 'automático',
  safety: 'seguridad',
};

/**
 * "Historial" in the plant's sheet (A5, D88): its soil moisture over 24 h,
 * 7 or 30 days. The threshold is a soft band; below it the line turns warm
 * (thirsty); gaps stay gaps; waterings are marked by who started them. A
 * finger, the mouse or the arrow keys show the exact value and time, and
 * from there the whole greenhouse can be seen as it was (rewind).
 */
export function PlantHistory({ zone }: { zone: ZoneLayout }) {
  const [range, setRange] = useState<ChartRange>('7d');
  const history = usePlantHistory(zone.id, range);
  const data = history.data;
  const notes = useNoteMarks(zone.id);

  return (
    <div className="history">
      <Segmented label="Periodo" value={range} options={RANGES} onChange={setRange} />
      {data === null ? (
        history.status === 'loading' ? (
          <p className="plant-empty">Cargando el historial…</p>
        ) : (
          <HubNote
            up="No se ha podido cargar el historial."
            waiting="el historial vuelve cuando vuelva."
          />
        )
      ) : readings(data.series) < MIN_READINGS ? (
        <EmptyHistory since={data.since} />
      ) : (
        <Chart
          key={range}
          zone={zone}
          range={range}
          series={data.series}
          marks={data.marks}
          notes={notes}
          since={data.since}
        />
      )}
      {history.status === 'unavailable' && data !== null && (
        <HubNote
          up="No se ha podido actualizar: es la última gráfica que llegó."
          waiting="esta gráfica es la última que dio."
        />
      )}
      {/* No CSV in the demo (D110). */}
      {!IN_DEMO && data !== null && readings(data.series) >= MIN_READINGS && (
        <a
          className="ui-button history-csv"
          data-variant="neutral"
          data-size="md"
          href={hubUrl(
            `/telemetry.csv?from=${data.series.from.toString()}&to=${data.series.to.toString()}`,
          )}
          download
        >
          Descargar CSV ({CHART_RANGES[range].label})
        </a>
      )}
    </div>
  );
}

function EmptyHistory({ since }: { since: number | null }) {
  return (
    <p className="plant-empty history-empty">
      {since === null
        ? 'Aún no hay historial: el hub empieza a guardarlo en cuanto llegan datos.'
        : `Aún hay poco historial: el hub guarda datos desde el ${dayTime.format(at(since))}. La gráfica se irá llenando.`}
    </p>
  );
}

/** A note or a photo from the journal, on the chart (A8). */
interface NoteMark {
  id: string;
  /** Unix s. */
  t: number;
  kind: 'note' | 'photo';
  text: string | null;
  tags: readonly JournalTag[];
}

/** The plant's notes and photos (saved or still waiting), as chart marks. */
function useNoteMarks(zone: string): NoteMark[] {
  const entries = useJournal(useShallow((state) => state.byZone[zone]?.journal?.entries ?? NONE));
  const pending = useJournal(useShallow((state) => state.pending));
  const hidden = useJournal((state) => state.hidden);
  const marks = new Map<string, NoteMark>();
  for (const entry of [...entries, ...pending.filter((p) => p.zone === zone)]) {
    if (hidden.includes(entry.id)) continue;
    marks.set(entry.id, {
      id: entry.id,
      t: Math.floor(entry.createdAt / 1000),
      kind: entry.kind,
      text: entry.text,
      tags: entry.tags ?? [],
    });
  }
  return [...marks.values()];
}
const NONE: never[] = [];

const LONG_NOTE = 40;
/** "Nota: Primeras hojas…" or "Foto: hoja amarilla". */
function noteText(mark: NoteMark): string {
  const label = mark.kind === 'photo' ? 'Foto' : 'Nota';
  // Tags first (A12): "Nota: Regada a mano" explains the soil going up.
  const words = [tagsText(mark.tags), mark.text ?? ''].filter(Boolean).join(' · ');
  if (!words) return label;
  const text = words.length > LONG_NOTE ? `${words.slice(0, LONG_NOTE).trimEnd()}…` : words;
  return `${label}: ${text}`;
}

function Chart({
  zone,
  range,
  series,
  marks,
  notes,
  since,
}: {
  zone: ZoneLayout;
  range: ChartRange;
  series: Series;
  marks: WateringMark[];
  notes: NoteMark[];
  since: number | null;
}) {
  const id = useId();
  const [index, setIndex] = useState<number | null>(null);
  const line = linePath(series);
  const gaps = gapSpans(series, since);
  const threshold = yOf(zone.threshold);
  const bandTop = yOf(zone.threshold + BAND);
  const bandBottom = yOf(zone.threshold - BAND);
  const beforeHistory = since !== null && since > series.from ? xOf(series, since) : 0;
  const shownMarks = marks.filter((mark) => mark.t >= series.from && mark.t <= series.to);
  // Written after the chart was fetched: at its right edge, "ahora".
  const shownNotes = notes.filter((note) => note.t >= series.from);

  const value = index === null ? null : (series.values[index] ?? null);
  const bucket = index === null ? null : (series.ts[index] ?? null);
  // A watering in that stretch says who, and why if it was automatic (A6).
  const watered =
    bucket === null
      ? undefined
      : shownMarks.find((mark) => mark.t >= bucket && mark.t < bucket + series.step);
  // And so does a note or photo written then (A8).
  const noted =
    bucket === null
      ? undefined
      : shownNotes.find((note) => note.t >= bucket && note.t < bucket + series.step);
  const readout =
    bucket === null ? null : (
      <>
        {when(bucket, range)} ·{' '}
        {value === null ? 'sin datos' : <span className="reading">{formatFraction(value)}</span>}
        {watered &&
          ` · ${watered.source === 'user' ? 'Riego tuyo' : explainWatering(watered.reason)}`}
        {noted && ` · ${noteText(noted)}`}
      </>
    );

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
    if (bucket === null) return;
    // The rewind range that holds that instant.
    const replay: ReplayRange = range;
    startReplay(replay, { at: bucket + series.step / 2, zones: ZONES.map((z) => z.id) });
  };

  const x = index === null ? 0 : xOf(series, (series.ts[index] ?? 0) + series.step / 2);

  return (
    <figure className="history-chart" aria-labelledby={`${id}-caption`}>
      <figcaption id={`${id}-caption`} className="visually-hidden">
        Humedad de la tierra de {zone.name}, últimos {CHART_RANGES[range].label}. Pide agua por
        debajo del {formatFraction(zone.threshold)}.
      </figcaption>
      <div
        className="history-plot"
        role="group"
        tabIndex={0}
        aria-label={`Humedad de ${zone.name}. Flechas para recorrer.`}
        aria-describedby={`${id}-readout`}
        onPointerDown={pick}
        onPointerMove={(event) => {
          // A mouse shows the value while it hovers; a finger, while it touches.
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
          <defs>
            <clipPath id={`${id}-above`}>
              <rect x="0" y="0" width="100" height={threshold} />
            </clipPath>
            <clipPath id={`${id}-below`}>
              <rect x="0" y={threshold} width="100" height={100 - threshold} />
            </clipPath>
            <linearGradient id={`${id}-band`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className="history-band-edge" />
              <stop offset="0.5" className="history-band-core" />
              <stop offset="1" className="history-band-edge" />
            </linearGradient>
          </defs>
          {[0, 50, 100].map((y) => (
            <line key={y} className="history-grid" x1="0" x2="100" y1={y} y2={y} />
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
          <rect
            x="0"
            y={bandTop}
            width="100"
            height={bandBottom - bandTop}
            fill={`url(#${id}-band)`}
          />
          <path className="history-line" d={line} clipPath={`url(#${id}-above)`} />
          <path
            className="history-line"
            data-thirsty="true"
            d={line}
            clipPath={`url(#${id}-below)`}
          />
          {index !== null && <line className="history-cursor" x1={x} x2={x} y1="0" y2="100" />}
        </svg>
        {shownMarks.map((mark) => (
          <span
            key={mark.t}
            className="history-mark"
            data-source={mark.source === 'user' ? 'user' : 'auto'}
            style={{ left: `${xOf(series, mark.t).toString()}%` }}
            aria-hidden="true"
          />
        ))}
        {shownNotes.map((note) => (
          <span
            key={note.id}
            className="history-note"
            data-kind={note.kind}
            style={{ left: `${Math.min(100, xOf(series, note.t)).toString()}%` }}
            aria-hidden="true"
          />
        ))}
        {index !== null && value !== null && (
          <span
            className="history-dot"
            style={{ left: `${x.toString()}%`, top: `${yOf(value).toString()}%` }}
            aria-hidden="true"
          />
        )}
        <span className="history-axis-y" aria-hidden="true">
          <span>100 %</span>
          <span>50 %</span>
          <span>0 %</span>
        </span>
      </div>
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
        <li data-key="line">Humedad</li>
        <li data-key="thirsty">Con sed</li>
        <li data-key="band">Umbral</li>
        {shownMarks.some((mark) => mark.source === 'user') && <li data-key="user">Riego tuyo</li>}
        {shownMarks.some((mark) => mark.source !== 'user') && (
          <li data-key="auto">Riego automático</li>
        )}
        {shownNotes.length > 0 && <li data-key="note">Nota o foto</li>}
        {gaps.length > 0 && <li data-key="gap">Sin datos</li>}
      </ul>
      {/* Wrapped: a table takes its content's width whatever its own (A12, text at 200 %). */}
      <div className="visually-hidden">
        <table>
          <caption>Valores de humedad de {zone.name}</caption>
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Humedad</th>
            </tr>
          </thead>
          <tbody>
            {series.ts.map((t, i) => (
              <tr key={t}>
                <td>{when(t, range)}</td>
                <td>
                  {series.values[i] === null
                    ? 'sin datos'
                    : formatFraction(series.values[i] ?? null)}
                </td>
              </tr>
            ))}
            {shownMarks.map((mark) => (
              <tr key={`mark-${mark.t.toString()}`}>
                <td>{when(mark.t, range)}</td>
                <td>
                  Riego de {mark.seconds.toString()} s ({SOURCE[mark.source]})
                  {mark.reason ? `: ${explainReason(mark.reason)}` : ''}
                </td>
              </tr>
            ))}
            {shownNotes.map((note) => (
              <tr key={`note-${note.id}`}>
                <td>{when(note.t, range)}</td>
                <td>{noteText(note)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
