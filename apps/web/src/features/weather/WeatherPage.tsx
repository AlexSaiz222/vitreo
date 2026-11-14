import { FROST_WARNING_C, readSky, STRONG_WIND } from '@vitreo/shared';
import type { WeatherNow, WeatherState } from '@vitreo/shared';
import { useEffect } from 'react';

import { IN_DEMO } from '../../app/demo.ts';
import { useHub } from '../../data/hub.ts';
import { loadWeather, saveWeatherRules, useOutdoor, useWeatherHub } from '../../data/weather.ts';
import { formatDegrees, formatTime } from '../../ui/format.ts';
import { Toggle } from '../../ui/primitives/index.ts';
import { useHubBlocker } from '../../ui/useHubBlocker.ts';
import { kmh } from '../automations/explain.ts';
import { weatherWhyNot } from './whyNot.ts';

const NB = String.fromCharCode(0xa0);
const mm = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const at = (unixSeconds: number) => formatTime(unixSeconds * 1000);
/** "6:00", as in "a las 6:00". */
const hour = (unixSeconds: number) => at(unixSeconds).replace(/^0(\d)/, '$1');

function rainText(now: WeatherNow, state: WeatherState): string {
  const observation = state.weather?.observation;
  if (now.rainFrom === 'gauge' && now.precipValue !== null) {
    return `${now.snow > 0 ? 'Nieve, ' : ''}${mm.format(now.precipValue)}${NB}mm en la última hora`;
  }
  if (now.rainFrom === 'forecast') return now.snow > 0 ? 'Nieve prevista ahora' : 'Prevista ahora';
  return observation?.precip === null ? 'Sin dato' : 'No llueve';
}

/** What AEMET says now: measured at the station, and this hour's forecast. */
function Now({ now, state }: { now: WeatherNow; state: WeatherState }) {
  const weather = state.weather;
  const observation = weather?.observation ?? null;
  const forecast = weather?.forecast ?? null;
  const sky = readSky(forecast?.sky ?? null);
  const wind =
    observation?.windSpeed != null
      ? `${kmh(observation.windSpeed)}${observation.windGust != null ? `, rachas de ${kmh(observation.windGust)}` : ''}`
      : forecast?.windSpeed != null
        ? `${kmh(forecast.windSpeed)} (previsto)`
        : 'Sin dato';
  const tonight = weather?.tonight ?? null;
  return (
    <dl className="plant-facts">
      <div className="plant-fact">
        <dt className="hud-label">Temperatura</dt>
        <dd>{now.temp === null ? 'Sin dato' : formatDegrees(now.temp)}</dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Cielo</dt>
        <dd>{forecast?.skyText ?? (sky ? '—' : 'Sin previsión para esta hora')}</dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Lluvia</dt>
        <dd>{rainText(now, state)}</dd>
      </div>
      <div className="plant-fact">
        <dt className="hud-label">Viento</dt>
        <dd>{wind}</dd>
      </div>
      {tonight && (
        <div className="plant-fact">
          <dt className="hud-label">Esta noche</dt>
          <dd>
            Mínima de {formatDegrees(tonight.min)} a las {hour(tonight.at)}
          </dd>
        </div>
      )}
      {observation && (
        <div className="plant-fact">
          <dt className="hud-label">Estación</dt>
          <dd>
            {observation.station.name}, a las {at(observation.at)}
          </dd>
        </div>
      )}
      {forecast && (
        <div className="plant-fact">
          <dt className="hud-label">Previsión</dt>
          <dd>
            {forecast.municipality.name}, hecha a las {at(forecast.issuedAt)}
          </dd>
        </div>
      )}
    </dl>
  );
}

const CAUSE = { rain: 'la lluvia', snow: 'la nieve', wind: 'el viento fuerte' } as const;
const OUTSIDE = {
  rain: 'Llueve fuera',
  snow: 'Nieva fuera',
  wind: 'Hace viento fuerte fuera',
} as const;

/** The window rule now, in one line. */
function windowText(window: WeatherState['window']): string | null {
  if (window.at === null || window.cause === null) return null;
  const when = formatTime(window.at);
  const why = CAUSE[window.cause];
  switch (window.state) {
    case 'asking':
      return `A las ${when} pidió mantener la ventana cerrada por ${why}.`;
    case 'holding':
      return `Desde las ${when}, la ventana sigue cerrada por ${why} y ventila solo el ventilador. Cuando pase, el invernadero vuelve a sus reglas.`;
    case 'held-by-heat':
      return `${OUTSIDE[window.cause]}, pero dentro hace demasiado calor: la protección por calor deja la ventana abierta.`;
    case 'left-open':
      return `${OUTSIDE[window.cause]}; abriste la ventana tú y se queda así hasta que pase.`;
    case 'idle':
      return null;
  }
}

/**
 * Ajustes › Tiempo exterior (A10, D97): what AEMET says now (or why there is
 * nothing), its attribution and update time (their terms), and the hub's
 * two weather rules, each switched here.
 */
export function WeatherPage() {
  const state = useWeatherHub((store) => store.state);
  const saving = useWeatherHub((store) => store.saving);
  const error = useWeatherHub((store) => store.error);
  const hubUp = useHub((store) => store.status === 'up');
  const now = useOutdoor();
  const blocker = useHubBlocker('el tiempo exterior y sus reglas vuelven con él.');
  useEffect(() => {
    if (hubUp) void loadWeather();
  }, [hubUp]);
  const whyNot = weatherWhyNot(state, now, blocker);
  const rules = state?.rules ?? null;
  const windowLine = state && rules?.closeWindow ? windowText(state.window) : null;
  const updated = state?.lastSuccessAt ?? null;

  return (
    <>
      <section className="settings-section" aria-labelledby="weather-now">
        <h3 id="weather-now" className="hud-label">
          Ahora fuera
        </h3>
        {whyNot && (
          <p className="settings-hint" role="status" data-tone={blocker ? 'attention' : undefined}>
            {whyNot}
          </p>
        )}
        {now && state && <Now now={now} state={state} />}
        {state?.weather && (
          <p className="settings-hint">
            {IN_DEMO
              ? 'Fuente: simulado, no observado: un cielo de finales de octubre en Madrid.'
              : 'Fuente: AEMET.'}
            {updated !== null && ` Actualizado a las ${formatTime(updated)}.`} La escena lo muestra
            con calma: nubes, lluvia, niebla, nieve y el viento por la ventana abierta.
          </p>
        )}
      </section>

      <section className="settings-section" aria-labelledby="weather-rules">
        <h3 id="weather-rules" className="hud-label">
          Reglas del hub
        </h3>
        <Toggle
          label="Cerrar la ventana con lluvia o viento"
          description={`Con lluvia, nieve o viento de ${kmh(STRONG_WIND.mean)} (rachas de ${kmh(STRONG_WIND.gust)}), la ventana se queda cerrada y ventila solo el ventilador. Si dentro hace demasiado calor, la protección por calor la abre; si la abres tú, se respeta.`}
          checked={rules?.closeWindow ?? false}
          disabled={!hubUp || !rules || saving}
          onChange={(checked) => {
            void saveWeatherRules({ closeWindow: checked });
          }}
        />
        {windowLine && (
          <p className="settings-hint" role="status">
            {windowLine}
          </p>
        )}
        <Toggle
          label="Avisar de heladas"
          description={`Por la tarde, entre las 19:00 y las 23:00, si ${IN_DEMO ? 'se' : 'AEMET'} prevé ${FROST_WARNING_C.toString()}${NB}°C o menos esta noche. Llega como «Previsión de helada», que cada dispositivo puede apagar en Avisos.`}
          checked={rules?.frostWarning ?? false}
          disabled={!hubUp || !rules || saving}
          onChange={(checked) => {
            void saveWeatherRules({ frostWarning: checked });
          }}
        />
        {error && (
          <p className="settings-hint" role="status" data-tone="attention">
            {error}
          </p>
        )}
        <p className="settings-hint">
          Funcionan en el hub, con el PC encendido. Las reglas del propio invernadero (Ventilación y
          luz) siguen funcionando sin él.
        </p>
      </section>
    </>
  );
}
