import { useEffect, useId, useState } from 'react';

import { useSelection } from '../app/selection.ts';
import { getCommands, useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import {
  selectLastWatering,
  selectLastWateringCommand,
  selectLastWateringStart,
} from '../data/selectors.ts';
import { wiltAmount } from '../scene/wilt.ts';
import type { ZoneLayout } from '../scene/zones.ts';
import { stopWatering } from './actions.ts';
import {
  blockedUntil,
  formatFraction,
  formatTime,
  formatWhen,
  plantMood,
  refusalText,
  wateringText,
} from './format.ts';
import {
  Button,
  CheckIcon,
  DialGauge,
  DropIcon,
  Segmented,
  Sheet,
  StopIcon,
} from './primitives/index.ts';
import { wateringElapsedMs } from '../data/store.ts';
import type { ActiveWatering } from '../data/store.ts';
import { useReplay } from '../data/replay.ts';
import { useShownMoisture } from '../data/shown.ts';
import { formatMoment } from '../features/history/format.ts';
import { explainWatering } from '../features/automations/explain.ts';
import { PlantAutomation } from '../features/automations/PlantAutomation.tsx';
import { PlantHistory } from '../features/history/PlantHistory.tsx';
import { PlantJournal } from '../features/journal/PlantJournal.tsx';
import { useLastWatering } from '../features/history/useLastWatering.ts';
import { useClock } from './useClock.ts';
import { useHub } from '../data/hub.ts';
import { plantAge } from '../features/plants/age.ts';
import { PlantPage } from './settings/GreenhousePages.tsx';
import { useZone } from './useZones.ts';

/** Durations offered for "Regar ahora" (the firmware allows up to 15 s). */
const DURATIONS = [
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
  { value: '10', label: '10 s' },
] as const;
type Duration = (typeof DURATIONS)[number]['value'];

/** How long "Regada" stays on the button after a watering ends (ms). */
const DONE_MS = 2500;

/** True for a moment after a watering on screen ends: the press gets its answer. */
function useWateringDone(watering: ActiveWatering | undefined): boolean {
  const [done, setDone] = useState(false);
  const [was, setWas] = useState(watering);
  if (was !== watering) {
    setWas(watering);
    if (was !== undefined && watering === undefined) setDone(true);
    if (watering !== undefined) setDone(false);
  }
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => {
      setDone(false);
    }, DONE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [done]);
  return done;
}

/**
 * The water rising along the button for the watering's seconds. Its start
 * is fixed when it appears (a sheet opened mid-watering starts part full);
 * CSS runs the rest, so it moves smoothly between the clock's ticks.
 */
function WaterFill({ seconds, elapsed }: { seconds: number; elapsed: number }) {
  const [style] = useState(() => ({
    animationDuration: `${(seconds * 1000).toString()}ms`,
    animationDelay: `${(-Math.min(elapsed, seconds * 1000)).toString()}ms`,
  }));
  return <span className="water-fill" aria-hidden="true" style={style} />;
}

function SheetContent({ zone, onClose }: { zone: ZoneLayout; onClose: () => void }) {
  const reasonId = useId();
  const [seconds, setSeconds] = useState<Duration>('5');

  const moisture = useShownMoisture(zone.id);
  // Rewound (A5): the past is shown, and it cannot be watered.
  const pastAt = useReplay((state) => (state.mode === 'replay' ? state.at : null));
  const lastData = useGreenhouse((state) => state.telemetry?.ts ?? null);
  const lastWatering = useGreenhouse((state) => selectLastWatering(state, zone.id));
  const stored = useLastWatering(zone.id);
  const sessionStart = useGreenhouse((state) => selectLastWateringStart(state, zone.id));
  const entry = useGreenhouse((state) => selectLastWateringCommand(state, zone.id));
  const watering = useGreenhouse((state) => state.watering[zone.id]);
  const freshness = useFreshness();

  const pending = watering !== undefined || entry?.status === 'pending';
  const now = useClock(pending || entry !== null);
  // Blocked by a temporary safety limit: disabled until then, and it says why (D85).
  const blocked = blockedUntil(entry, now) !== null;
  const busy = pending || blocked;
  const refusal = entry ? refusalText(entry, now) : null;
  const status = wateringText(entry, watering, now);
  const canRetry = entry?.status === 'timeout' || entry?.status === 'failed';
  const unavailable =
    pastAt !== null || freshness.kind === 'disconnected' || freshness.kind === 'waiting';
  const thirsty = wiltAmount(moisture, zone.threshold) > 0;
  const sownAt = useHub((state) => state.plants?.find((p) => p.zone === zone.id)?.sownAt ?? null);
  const age = plantAge(sownAt, now);
  // Where the water fill starts (ms into the watering): CSS runs it smoothly
  // from there to the end, at home and in the demo alike (D128).
  const elapsed = watering ? Math.max(0, wateringElapsedMs(watering, now)) : null;
  // A short "done" after a watering ends on its own, so the press has an answer.
  const done = useWateringDone(watering);

  const water = () => {
    const commands = getCommands();
    if (!commands) return;
    if (canRetry) void commands.retry(entry.command.requestId);
    else void commands.send({ action: 'water', zone: zone.id, seconds: Number(seconds) });
  };

  // The newer of this session's and the hub's (A5).
  const fromHub = typeof stored === 'object' && stored !== null ? stored : null;
  const latest =
    lastWatering && (!fromHub || lastWatering.ts >= fromHub.ts)
      ? {
          ts: lastWatering.ts,
          seconds: lastWatering.seconds,
          source: lastWatering.source,
          reason: sessionStart?.zone === zone.id ? sessionStart.reason : undefined,
        }
      : fromHub;
  // Every automatic watering says why (A6): "Riego automático · tierra 33 % < 35 %".
  const lastWateringText = latest
    ? `${formatWhen(latest.ts * 1000, now)} · ${Math.round(latest.seconds).toString()} s · ${
        latest.source === 'user' ? 'tú' : explainWatering(latest.reason)
      }`
    : stored === 'none'
      ? 'Ninguno en los últimos 30 días'
      : 'Sin registros en esta sesión';

  const honesty =
    pastAt !== null
      ? `Así estaba el ${formatMoment(pastAt)}`
      : freshness.kind === 'live' || lastData === null
        ? null
        : `Último dato a las ${formatTime(lastData * 1000)}`;

  const more = (
    <>
      <dl className="plant-facts">
        <div className="plant-fact">
          <dt className="hud-label">Último riego</dt>
          <dd>{lastWateringText}</dd>
        </div>
      </dl>
      <PlantAutomation zone={zone} />
      {/* Its name, sowing day and age, and a new plant in the pot (A12). */}
      <section className="plant-section plant-identity" aria-labelledby={`plant-${zone.id}`}>
        <h3 id={`plant-${zone.id}`} className="hud-label">
          Planta
        </h3>
        <PlantPage zoneId={zone.id} />
      </section>
      <section className="plant-section">
        <h3 className="hud-label">Historial</h3>
        <PlantHistory zone={zone} />
      </section>
      <section className="plant-section">
        <h3 className="hud-label">Diario</h3>
        <PlantJournal zone={zone} />
      </section>
    </>
  );

  return (
    <Sheet
      className="sheet"
      title={zone.name}
      // Only the Latin name in italics; a given name keeps the species in
      // sight: "Albahaca · Ocimum basilicum".
      subtitle={
        <>
          {zone.article ? null : `${zone.speciesName} · `}
          <i lang="la">{zone.species}</i>
        </>
      }
      onClose={onClose}
      more={more}
    >
      <div className="plant-reading">
        <DialGauge
          label="Humedad de la tierra"
          value={moisture}
          valueText={formatFraction(moisture)}
          threshold={zone.threshold}
          caption="Tierra"
          size="md"
        />
        <div className="plant-reading-text">
          <p className="plant-mood" data-thirsty={thirsty}>
            {plantMood(moisture, thirsty)}
          </p>
          {honesty && (
            <p className="plant-honesty" data-tone={pastAt === null ? undefined : 'past'}>
              {honesty}
            </p>
          )}
          <p className="plant-hint">Pide agua por debajo del {formatFraction(zone.threshold)}.</p>
          {age && <p className="plant-hint">{age}.</p>}
        </div>
      </div>

      <div className="plant-actions">
        {/* Stays while watering (disabled), so the row never jumps. */}
        <Segmented
          label="Duración del riego"
          value={seconds}
          options={DURATIONS}
          disabled={busy}
          onChange={setSeconds}
        />
        <div className="plant-water-row">
          <Button
            variant="primary"
            size="lg"
            className="primary-button"
            data-zone={zone.id}
            data-watering={watering !== undefined}
            data-done={done && watering === undefined && status === null}
            icon={done && watering === undefined && status === null ? <CheckIcon /> : <DropIcon />}
            disabled={unavailable || busy}
            aria-describedby={unavailable || refusal ? reasonId : undefined}
            onClick={water}
          >
            {status ?? (done ? 'Regada' : canRetry ? 'Reintentar' : 'Regar ahora')}
            {watering !== undefined && elapsed !== null && (
              <WaterFill key={watering.shownAt} seconds={watering.seconds} elapsed={elapsed} />
            )}
          </Button>
          {watering !== undefined && (
            // Watering cannot be undone; it can be stopped (D84).
            <Button
              icon={<StopIcon />}
              onClick={() => {
                stopWatering(zone.id);
              }}
            >
              Detener
            </Button>
          )}
        </div>
        <span className="visually-hidden" aria-live="polite">
          {status ?? (done ? 'Regada' : null)}
        </span>
      </div>
      {unavailable ? (
        <p id={reasonId} className="plant-reason">
          {pastAt !== null
            ? 'Estás viendo el pasado: vuelve a ahora para regar.'
            : 'Sin conexión con el invernadero: no se puede regar ahora.'}
        </p>
      ) : (
        refusal && (
          <p id={reasonId} className="plant-reason" data-tone="attention">
            {refusal}
          </p>
        )
      )}
    </Sheet>
  );
}

/** docs/03: the plant's detail sheet (bottom on mobile, side on desktop). */
export function PlantSheet() {
  const zoneId = useSelection((state) => state.zoneId);
  const close = useSelection((state) => state.close);
  const zone = useZone(zoneId);
  if (!zone) return null;
  return <SheetContent key={zone.id} zone={zone} onClose={close} />;
}
