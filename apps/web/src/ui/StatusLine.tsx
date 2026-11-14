import { useShallow } from 'zustand/react/shallow';

import { IN_DEMO } from '../app/demo.ts';
import { useHud } from '../app/hud.ts';
import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import { useReplay } from '../data/replay.ts';
import { selectHeld } from '../data/selectors.ts';
import { useReplaying } from '../data/shown.ts';
import { formatMoment } from '../features/history/format.ts';
import { formatHumidity, formatTemperature } from './format.ts';
import { outdoorAge, useOutdoor } from '../data/weather.ts';
import { CloudIcon, HistoryIcon, HumidityIcon, ThermometerIcon } from './primitives/index.ts';
import { statusSummary } from './statusPhrase.ts';
import { useZones } from './useZones.ts';

/**
 * docs/03: "22° · 64 % · Todo bien". One glance, one answer: normal is said
 * plainly and only what is not normal gets named. The title and the status
 * sit straight over the scene (no card, D81); a soft gradient of the page
 * colour behind them (.hud-scrim) keeps them readable whatever the camera
 * shows. The dot is a hint; the sentence always says it in words.
 */
export function StatusLine() {
  return useReplaying() ? <PastStatus /> : <LiveStatus />;
}

/**
 * Rewound (A5, D88): unmistakably the past, said in words with the date and
 * time, and that moment's readings. Not a live region: the scrubber already
 * speaks the instant, and this would chatter while it moves.
 */
function PastStatus() {
  const at = useReplay((state) => state.at);
  const shown = useReplay((state) => state.shown);
  const pending = useReplay((state) => state.pending);
  const air = shown?.air ?? null;
  return (
    <header className="status" data-freshness="past">
      <p className="status-name">Vitreo</p>
      <p className="status-line">
        {air?.temp != null && (
          <span className="status-reading">
            <ThermometerIcon />
            <span className="visually-hidden">Temperatura </span>
            {formatTemperature(air.temp)}
          </span>
        )}
        {air?.rh != null && (
          <span className="status-reading">
            <HumidityIcon />
            <span className="visually-hidden">Humedad </span>
            {formatHumidity(air.rh)}
          </span>
        )}
        <span className="status-phrase status-past">
          <HistoryIcon />
          {shown ? 'Así estaba el ' : pending ? 'Cargando el ' : 'Sin datos el '}
          {formatMoment(at)}
        </span>
      </p>
    </header>
  );
}

/**
 * Said while the first data has not arrived (D116). The demo starts its
 * simulated greenhouse in the browser, and its outside is simulated, never
 * AEMET's (D111); at home the hub brings AEMET's weather (D97).
 */
const WAITING_NOTE = IN_DEMO
  ? 'Arrancando el invernadero simulado en tu navegador. En el invernadero de verdad, el tiempo de fuera se sincroniza con AEMET.'
  : 'El tiempo de fuera se sincroniza con AEMET a través del hub; los datos de dentro llegan cuando el invernadero se conecte.';

function LiveStatus() {
  const freshness = useFreshness();
  const link = useGreenhouse((state) => state.link);
  const telemetry = useGreenhouse((state) => state.telemetry);
  const watering = useGreenhouse(useShallow((state) => Object.keys(state.watering)));
  const air = freshness.kind === 'waiting' ? null : (telemetry?.air ?? null);
  const zones = useZones();
  const heat = useGreenhouse((state) => selectHeld(state, 'over_temperature').active);
  const frost = useGreenhouse((state) => selectHeld(state, 'frost').active);
  const summary = statusSummary(freshness, link, telemetry, zones, new Set(watering), {
    heat,
    frost,
  });
  const tone = freshness.kind === 'waiting' ? 'idle' : summary.attention ? 'attention' : 'good';
  // Outdoor temperature (A10), measured by AEMET: labelled, so it is never
  // taken for the greenhouse's. Only when it is known and current. In the
  // demo, "fuera · simulado" (D111): never taken for an observation.
  const outdoor = useOutdoor();
  const outside = outdoor?.temp ?? null;
  const now = useGreenhouse((state) => state.now);
  const openGreenhouse = useHud((state) => state.openGreenhouse);
  // AEMET runs 1–2 h behind: past an hour, the reading says how old it is.
  const age = outdoorAge(outdoor?.observedAt ?? null, now);

  const readings = air?.temp != null || air?.rh != null || outside !== null;

  return (
    <header className="status" data-freshness={freshness.kind} data-attention={summary.attention}>
      <p className="status-name">Vitreo</p>
      <p className="status-line">
        {/* The readings open the greenhouse's sheet (A11): its climate, then and now. */}
        {readings && (
          <button
            type="button"
            className="status-readings"
            aria-haspopup="dialog"
            onClick={() => {
              openGreenhouse('climate');
            }}
          >
            <span className="visually-hidden">Ver el invernadero: </span>
            {air?.temp != null && (
              <span className="status-reading">
                <ThermometerIcon />
                <span className="visually-hidden">Temperatura </span>
                {formatTemperature(air.temp)}
                {outside !== null && <span className="status-where">dentro</span>}
              </span>
            )}
            {/* The humidity is the greenhouse's: next to its temperature, not after the outside's. */}
            {air?.rh != null && (
              <span className="status-reading">
                <HumidityIcon />
                <span className="visually-hidden">Humedad </span>
                {formatHumidity(air.rh)}
              </span>
            )}
            {outside !== null && (
              <span className="status-reading status-outside">
                <CloudIcon />
                <span className="visually-hidden">Temperatura </span>
                {formatTemperature(outside)}
                <span className="status-where">fuera</span>
                {IN_DEMO && <span className="status-where">· simulado</span>}
                {age && <span className="status-where status-age">· {age}</span>}
                {!IN_DEMO && <span className="visually-hidden"> (AEMET)</span>}
              </span>
            )}
          </button>
        )}
        {/* Only the sentence speaks when it changes: not every new reading. */}
        <span className="status-phrase" role="status">
          <span className="status-dot" data-tone={tone} aria-hidden="true" />
          {summary.text}
        </span>
      </p>
      {/* Waiting (D116): what is happening, and where the outside comes from. */}
      {freshness.kind === 'waiting' && <p className="status-note">{WAITING_NOTE}</p>}
    </header>
  );
}
