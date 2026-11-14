import { useEffect, useLayoutEffect, useRef } from 'react';

import { useHud } from '../../app/hud.ts';
import { useSelection } from '../../app/selection.ts';
import {
  replayColumns,
  scrubTo,
  setReplayRange,
  startReplay,
  stopReplay,
  useReplay,
} from '../../data/replay.ts';
import type { ReplayRange } from '../../data/replay.ts';
import { ZONES } from '../../scene/zones.ts';
import { HubNote } from '../../ui/HubNote.tsx';
import { Button, HistoryIcon, IconButton, Segmented, Surface } from '../../ui/primitives/index.ts';
import { formatMoment } from './format.ts';
import './timeline.css';

const RANGES = [
  { value: '24h', label: '24 h' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
] as const satisfies readonly { value: ReplayRange; label: string }[];

const short = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' });
const clock = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/** The top-right button that opens the past (A5). */
export function RewindButton() {
  const setPanel = useHud((state) => state.setPanel);
  const close = useSelection((state) => state.close);
  return (
    <IconButton
      className="hud-floating rewind-button"
      size="lg"
      icon={<HistoryIcon />}
      label="Rebobinar"
      onClick={() => {
        setPanel(null);
        close();
        startReplay('24h', { zones: ZONES.map((zone) => zone.id) });
      }}
    />
  );
}

/**
 * Coverage of the window under the scrubber: a bar where there are readings,
 * nothing in a gap, a faint wash where its chunk has not arrived yet. Drawn
 * once per chunk, not per frame.
 */
function Coverage() {
  const revision = useReplay((state) => state.revision);
  const from = useReplay((state) => state.from);
  const to = useReplay((state) => state.to);
  const data = replayColumns();
  if (!data) return null;
  const width = to - from;
  // Continuous runs of buckets with readings, one bar each (no seams).
  const runs: { start: number; end: number }[] = [];
  data.ts.forEach((t, i) => {
    if ((data.n[i] ?? 0) === 0) return;
    const last = runs.at(-1);
    if (last?.end === t) last.end = t + data.step;
    else runs.push({ start: t, end: t + data.step });
  });
  return (
    <svg
      // Redrawn when a chunk arrives (the columns are mutated in place).
      data-revision={revision}
      className="timeline-coverage"
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {runs.map((run) => (
        <rect
          key={run.start}
          className="timeline-data"
          x={((run.start - from) / width) * 100}
          y="0"
          width={((run.end - run.start) / width) * 100}
          height="10"
        />
      ))}
    </svg>
  );
}

/**
 * The rewind bar (A5, D88): it takes the dock's place while the twin shows
 * the past, so nothing can be ordered from there. The scrubber is a native
 * range (keyboard, touch and screen readers for free), uncontrolled: moving
 * it updates the scene on the next frame and its own label directly, with no
 * React render per step. "Volver a ahora" brings the live greenhouse back.
 */
export function Timeline() {
  const range = useReplay((state) => state.range);
  const from = useReplay((state) => state.from);
  const to = useReplay((state) => state.to);
  const at = useReplay((state) => state.at);
  const gap = useReplay((state) => state.gap);
  const load = useReplay((state) => state.load);
  const loaded = useReplay((state) => state.loaded);
  const chunks = useReplay((state) => state.chunks);
  const pending = useReplay((state) => state.pending);
  const jump = useReplay((state) => state.jump);
  const input = useRef<HTMLInputElement>(null);
  const label = useRef<HTMLElement>(null);
  const back = useRef<HTMLButtonElement>(null);

  // Escape, like closing a sheet, goes back to now.
  useEffect(() => {
    back.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') stopReplay();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // The label, the fill and the spoken value are written straight to the DOM
  // (never rendered by React), so the thumb moves with no render per step.
  const show = (value: number) => {
    const element = input.current;
    if (label.current) label.current.textContent = formatMoment(value);
    if (!element) return;
    element.style.setProperty('--fill', `${(((value - from) / (to - from)) * 100).toString()}%`);
    element.setAttribute('aria-valuetext', formatMoment(value));
  };
  const onInput = () => {
    if (!input.current) return;
    const value = Number(input.current.value);
    scrubTo(value);
    show(value);
  };
  // A new window (range), or an instant set from elsewhere (the chart).
  useLayoutEffect(() => {
    if (input.current) input.current.value = String(at);
    show(at);
    // Only when the window changes or the app moves the cursor (the newest
    // reading on opening): while scrubbing, the input leads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, jump]);

  const start =
    range === '24h' ? clock.format(new Date(from * 1000)) : short.format(new Date(from * 1000));
  const note = pending
    ? `Cargando el historial (${loaded.toString()} de ${chunks.toString()})…`
    : gap
      ? 'Sin datos a esta hora: el invernadero aparece dormido.'
      : null;

  return (
    <Surface
      elevation="float"
      className="timeline"
      data-hud-obstacle=""
      role="region"
      aria-label="Rebobinar"
    >
      <div className="timeline-head">
        <p className="timeline-when">
          <span className="hud-label">Así estaba</span>
          <strong ref={label} className="timeline-moment" />
        </p>
        <Button ref={back} variant="primary" onClick={stopReplay}>
          Volver a ahora
        </Button>
      </div>
      <Segmented label="Periodo" value={range} options={RANGES} onChange={setReplayRange} />
      <div className="timeline-track">
        <Coverage />
        <input
          key={`${from.toString()}-${to.toString()}`}
          ref={input}
          className="timeline-input"
          type="range"
          min={from}
          max={to}
          step={60}
          defaultValue={at}
          aria-label="Momento"
          onInput={onInput}
        />
      </div>
      <div className="timeline-ends" aria-hidden="true">
        <span>{start}</span>
        <span>ahora</span>
      </div>
      {load === 'failed' ? (
        <HubNote
          up="No se ha podido cargar todo el historial."
          waiting="el historial vuelve cuando vuelva."
        />
      ) : (
        <p className="timeline-note" aria-live="polite">
          {note ?? 'Mueve la línea: la escena y los datos cambian a ese momento.'}
        </p>
      )}
    </Surface>
  );
}
