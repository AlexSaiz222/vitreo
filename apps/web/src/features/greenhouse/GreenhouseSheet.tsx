import { GREENHOUSE_JOURNAL, GREENHOUSE_TAGS } from '@vitreo/shared';
import { useEffect, useRef, useState } from 'react';

import { IN_DEMO } from '../../app/demo.ts';
import { useHud } from '../../app/hud.ts';
import type { GreenhouseSection } from '../../app/hud.ts';
import { useFreshness, useGreenhouse } from '../../data/greenhouse.ts';
import { hubUrl, useHub } from '../../data/hub.ts';
import { loadWeather, outdoorAge, useOutdoor, useWeatherHub } from '../../data/weather.ts';
import { formatFraction, formatTime } from '../../ui/format.ts';
import { HubNote } from '../../ui/HubNote.tsx';
import { Segmented, Sheet } from '../../ui/primitives/index.ts';
import { useHubBlocker } from '../../ui/useHubBlocker.ts';
import { useZones } from '../../ui/useZones.ts';
import { niceDomain, readings } from '../history/chart.ts';
import { Journal } from '../journal/PlantJournal.tsx';
import { CHART_RANGES } from '../history/usePlantHistory.ts';
import type { ChartRange } from '../history/usePlantHistory.ts';
import { weatherWhyNot } from '../weather/whyNot.ts';
import { TimeChart } from './TimeChart.tsx';
import { useGreenhouseHistory } from './useGreenhouseHistory.ts';
import type { GreenhouseHistory } from './useGreenhouseHistory.ts';
import '../history/history.css';
import './greenhouse.css';

const RANGES = (Object.keys(CHART_RANGES) as ChartRange[]).map((value) => ({
  value,
  label: CHART_RANGES[value].label,
}));
/** Fewer readings than this: not a chart yet, an honest empty state. */
const MIN_READINGS = 3;

const NB = String.fromCharCode(0xa0);
const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const degrees = (value: number) => `${decimal.format(value)}${NB}°C`;
const percent = (value: number) => `${whole.format(value)}${NB}%`;
const lux = (value: number) => `${whole.format(value)}${NB}lx`;
/** Axis labels: "40 klx" above a thousand, so they fit. */
const luxAxis = (value: number) =>
  value >= 1000 ? `${decimal.format(value / 1000)}${NB}klx` : `${whole.format(value)}${NB}lx`;
const dayTime = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The greenhouse's own sheet (A11): its climate and its tank, as the plant's
 * sheet is for a plant. Opened from the header's readings (climate) or the
 * dock's tank line (tank). Now, then 24 h, 7 or 30 days: temperature and air
 * humidity inside and outside (AEMET), light with the grow light, the tank
 * with every watering, and under the temperature when the window, the fan and
 * the light were on.
 */
export function GreenhouseSheet() {
  const open = useHud((state) => state.panel === 'greenhouse');
  const section = useHud((state) => state.section);
  const setPanel = useHud((state) => state.setPanel);
  return open ? (
    <GreenhousePanel
      section={section}
      onClose={() => {
        setPanel(null);
      }}
    />
  ) : null;
}

function GreenhousePanel({
  section,
  onClose,
}: {
  section: GreenhouseSection;
  onClose: () => void;
}) {
  const [range, setRange] = useState<ChartRange>('24h');
  const history = useGreenhouseHistory(range);
  const data = history.data;
  const tank = useRef<HTMLElement>(null);
  const ready = data !== null;
  // Opened from the tank: there, once the charts above have their height.
  useEffect(() => {
    if (section === 'tank' && ready) tank.current?.scrollIntoView({ block: 'start' });
  }, [section, ready]);

  const enough = data !== null && readings(data.temp) >= MIN_READINGS;
  return (
    <Sheet
      className="sheet greenhouse-sheet"
      full
      // A soft hyphen: with text at 200 % on a phone it breaks as "Inverna-dero" (A12).
      title={'Inverna­dero'}
      subtitle="Clima y depósito"
      page={section}
      onClose={onClose}
    >
      <Now />
      <div className="greenhouse-range">
        <Segmented label="Periodo" value={range} options={RANGES} onChange={setRange} />
      </div>
      {data === null ? (
        history.status === 'loading' ? (
          <p className="plant-empty">Cargando el historial…</p>
        ) : (
          <HubNote
            up="No se ha podido cargar el historial."
            waiting="el historial vuelve cuando vuelva."
          />
        )
      ) : !enough ? (
        <p className="plant-empty history-empty">
          {data.since === null
            ? 'Aún no hay historial: el hub empieza a guardarlo en cuanto llegan datos.'
            : `Aún hay poco historial: el hub guarda datos desde el ${dayTime.format(data.since * 1000)}. Las gráficas se irán llenando.`}
        </p>
      ) : (
        <Charts data={data} range={range} tankRef={tank} />
      )}
      {history.status === 'unavailable' && data !== null && (
        <HubNote
          up="No se ha podido actualizar: son las últimas gráficas que llegaron."
          waiting="estas gráficas son las últimas que dio."
        />
      )}
      <section className="plant-section" aria-labelledby="greenhouse-journal">
        <h3 id="greenhouse-journal" className="hud-label">
          Diario del invernadero
        </h3>
        <Journal
          subject={{
            id: GREENHOUSE_JOURNAL,
            name: 'el invernadero',
            of: 'del invernadero',
            placeholder: 'Qué ha pasado: el depósito, un sensor, un tubo, una fuga…',
            invite:
              'Aún no hay notas. Apunta aquí lo que no es de una planta: rellenar el depósito, cambiar un sensor, un fallo de verdad.',
            tags: GREENHOUSE_TAGS,
          }}
        />
      </section>
      {/* No CSV in the demo (D110): only the real hub's data is worth keeping. */}
      {!IN_DEMO && data !== null && enough && (
        <section className="plant-section greenhouse-export" aria-labelledby="greenhouse-csv">
          <h3 id="greenhouse-csv" className="hud-label">
            Datos
          </h3>
          <a
            className="ui-button history-csv"
            data-variant="neutral"
            data-size="md"
            href={hubUrl(
              `/telemetry.csv?from=${data.temp.from.toString()}&to=${data.temp.to.toString()}`,
            )}
            download
          >
            Invernadero, CSV ({CHART_RANGES[range].label})
          </a>
          {data.outside && (
            <a
              className="ui-button history-csv"
              data-variant="neutral"
              data-size="md"
              href={hubUrl(
                `/weather.csv?from=${data.temp.from.toString()}&to=${data.temp.to.toString()}`,
              )}
              download
            >
              Fuera (AEMET), CSV
            </a>
          )}
        </section>
      )}
    </Sheet>
  );
}

/** Right now, in words: inside, outside (or why not), light and tank. */
function Now() {
  const freshness = useFreshness().kind;
  const telemetry = useGreenhouse((state) => (freshness === 'waiting' ? null : state.telemetry));
  const now = useGreenhouse((state) => state.now);
  const outdoor = useOutdoor();
  const weather = useWeatherHub((store) => store.state);
  const hubUp = useHub((store) => store.status === 'up');
  const blocker = useHubBlocker('el tiempo de fuera vuelve con él.');
  useEffect(() => {
    if (hubUp) void loadWeather();
  }, [hubUp]);
  const whyNot = weatherWhyNot(weather, outdoor, blocker);
  const age = outdoorAge(outdoor?.observedAt ?? null, now);
  // The station's humidity, from the same observation (only while it is current).
  const outsideRh = outdoor ? (weather?.weather?.observation?.rh ?? null) : null;
  const air = telemetry?.air ?? null;
  const old = freshness === 'stale' || freshness === 'disconnected';
  const join = (parts: (string | null)[]) => parts.filter(Boolean).join(' · ') || 'Sin dato';
  return (
    <dl className="plant-facts greenhouse-now">
      <div className="plant-fact">
        <dt className="hud-label">Dentro</dt>
        <dd>
          {telemetry === null
            ? 'Esperando al invernadero'
            : join([
                air?.temp == null ? null : degrees(air.temp),
                air?.rh == null ? null : `${percent(air.rh)} de humedad`,
              ])}
          {old && telemetry?.ts !== undefined && (
            <span className="greenhouse-old"> (a las {formatTime(telemetry.ts * 1000)})</span>
          )}
        </dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Fuera</dt>
        <dd>
          {outdoor
            ? `${join([
                outdoor.temp === null ? null : degrees(outdoor.temp),
                outsideRh === null ? null : `${percent(outsideRh)} de humedad`,
              ])} · ${IN_DEMO ? 'simulado' : 'AEMET'}${age ? `, ${age}` : ''}`
            : (whyNot ?? 'Sin dato')}
        </dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Luz</dt>
        <dd>
          {telemetry === null
            ? 'Sin dato'
            : join([
                telemetry.light.lux === null ? null : lux(telemetry.light.lux),
                `luz de cultivo ${telemetry.actuators.growLight ? 'encendida' : 'apagada'}`,
              ])}
        </dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Depósito</dt>
        <dd>{telemetry === null ? 'Sin dato' : formatFraction(telemetry.tank.level)}</dd>
      </div>
    </dl>
  );
}

function Charts({
  data,
  range,
  tankRef,
}: {
  data: GreenhouseHistory;
  range: ChartRange;
  tankRef: React.RefObject<HTMLElement | null>;
}) {
  const zones = useZones();
  const nameOf = (zone: string) => zones.find((z) => z.id === zone)?.name ?? zone;
  const outside = data.outside;
  const outsideKnown = outside !== null && readings(outside.temp) > 0;
  const tempDomain = niceDomain([...data.temp.values, ...(outside?.temp.values ?? [])], {
    unit: 5,
    minSpan: 10,
    fallback: [0, 40],
  });
  // A whole number in the middle of the axis: never "17,5 °C".
  if ((tempDomain[1] - tempDomain[0]) % 10 !== 0) tempDomain[1] += 5;
  const tempMid = (tempDomain[0] + tempDomain[1]) / 2;
  const luxValues = data.lux.values;
  const luxMax = Math.max(0, ...luxValues.filter((v): v is number => v !== null));
  const luxUnit = luxMax > 20_000 ? 10_000 : luxMax > 2_000 ? 1_000 : 100;
  const luxDomain = niceDomain(luxValues, {
    unit: luxUnit,
    minSpan: luxUnit,
    floor: 0,
    fallback: [0, 1000],
  });
  const mine = data.waterings.filter((w) => w.source === 'user').length;
  const automatic = data.waterings.length - mine;
  const outsideNote = IN_DEMO
    ? 'Fuera: simulado, no observado.'
    : outsideKnown
      ? `Fuera: AEMET${outside.station ? `, estación ${outside.station}` : ''}, una lectura por hora.`
      : outside === null
        ? 'Fuera: el hub no ha dado el tiempo de fuera.'
        : 'Fuera: AEMET no dio datos en este periodo.';

  return (
    <>
      <section className="plant-section" aria-labelledby="greenhouse-temp">
        <h3 id="greenhouse-temp" className="hud-label">
          Temperatura
        </h3>
        <TimeChart
          name="Temperatura dentro y fuera"
          range={range}
          lines={[
            { key: 'inside', label: 'Dentro', series: data.temp },
            ...(outsideKnown
              ? [{ key: 'outside', label: 'Fuera', series: outside.temp, outside: true }]
              : []),
          ]}
          domain={tempDomain}
          format={degrees}
          axis={[degrees(tempDomain[1]), degrees(tempMid), degrees(tempDomain[0])]}
          since={data.since}
          activity={[
            { key: 'vent', label: 'Ventana', series: data.vent, on: 'abierta' },
            { key: 'fan', label: 'Ventilador', series: data.fan, on: 'encendido' },
            { key: 'light', label: 'Luz', series: data.growLight, on: 'encendida' },
          ]}
        />
        <p className="settings-hint">{outsideNote}</p>
      </section>
      <section className="plant-section" aria-labelledby="greenhouse-rh">
        <h3 id="greenhouse-rh" className="hud-label">
          Humedad del aire
        </h3>
        <TimeChart
          name="Humedad del aire dentro y fuera"
          range={range}
          lines={[
            { key: 'inside', label: 'Dentro', series: data.rh },
            ...(outsideKnown
              ? [{ key: 'outside', label: 'Fuera', series: outside.rh, outside: true }]
              : []),
          ]}
          domain={[0, 100]}
          format={percent}
          axis={[percent(100), percent(50), percent(0)]}
          since={data.since}
        />
      </section>
      <section className="plant-section" aria-labelledby="greenhouse-light">
        <h3 id="greenhouse-light" className="hud-label">
          Luz
        </h3>
        <TimeChart
          name="Luz natural en el invernadero"
          range={range}
          lines={[{ key: 'lux', label: 'Luz', series: data.lux }]}
          domain={luxDomain}
          format={lux}
          axis={[luxAxis(luxDomain[1]), luxAxis(luxDomain[1] / 2), luxAxis(0)]}
          since={data.since}
          shade={{ label: 'Luz de cultivo', series: data.growLight }}
        />
      </section>
      <section
        ref={tankRef}
        className="plant-section greenhouse-tank"
        aria-labelledby="greenhouse-tank"
      >
        <h3 id="greenhouse-tank" className="hud-label">
          Depósito
        </h3>
        <TimeChart
          name="Agua en el depósito"
          range={range}
          lines={[{ key: 'tank', label: 'Depósito', series: data.tank }]}
          domain={[0, 1]}
          format={(value) => formatFraction(value)}
          axis={[percent(100), percent(50), percent(0)]}
          since={data.since}
          waterings={data.waterings}
          zoneName={nameOf}
        />
        <p className="settings-hint">
          {data.waterings.length === 0
            ? 'Ningún riego en este periodo.'
            : `${data.waterings.length.toString()} ${data.waterings.length === 1 ? 'riego' : 'riegos'} en este periodo: ${mine.toString()} ${mine === 1 ? 'tuyo' : 'tuyos'} y ${automatic.toString()} ${automatic === 1 ? 'automático' : 'automáticos'}.`}
        </p>
      </section>
    </>
  );
}
