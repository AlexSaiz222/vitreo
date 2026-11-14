import { IN_DEMO } from '../../app/demo.ts';
import { useSelection } from '../../app/selection.ts';
import { useAutomation } from '../../data/automation.ts';
import { useWeatherHub } from '../../data/weather.ts';
import { zoneOf } from '../../scene/zones.ts';
import { AirIcon, CloudIcon, DropIcon, LightIcon, ListRow } from '../../ui/primitives/index.ts';
import { useZones } from '../../ui/useZones.ts';
import { lightSummary, ventilationSummary, wateringSummary } from './explain.ts';

/**
 * "Automatizaciones activas" in Ajustes (A12, D100): everything the
 * greenhouse does on its own right now, in one place, read-only. Each
 * automation is still changed where it acts (the plant's sheet, Ventilación
 * y luz, Tiempo exterior); a row takes you there.
 */
export function ActiveAutomations({ onGo }: { onGo: (page: 'climate' | 'weather') => void }) {
  const config = useAutomation((store) => store.state?.config ?? null);
  const weather = useWeatherHub((store) => store.state?.rules ?? null);
  const zones = useZones();
  const open = useSelection((state) => state.open);

  if (!config) {
    return <p className="settings-hint">Se ven cuando el hub responda.</p>;
  }
  const watering = config.watering.filter((rule) => rule.enabled);
  const rows = [
    ...watering.map((rule) => {
      const zone = zones.find((z) => z.id === rule.zone);
      return (
        <li key={rule.zone}>
          <ListRow
            className="menu-row"
            icon={<DropIcon />}
            title={zone ? `Riego ${zoneOf(zone)}` : `Riego de ${rule.zone}`}
            detail={wateringSummary(rule)}
            onClick={() => {
              open(rule.zone);
            }}
          />
        </li>
      );
    }),
    config.ventilation.enabled && (
      <li key="ventilation">
        <ListRow
          className="menu-row"
          icon={<AirIcon />}
          title="Ventilación"
          detail={ventilationSummary(config.ventilation)}
          onClick={() => {
            onGo('climate');
          }}
        />
      </li>
    ),
    config.light.enabled && (
      <li key="light">
        <ListRow
          className="menu-row"
          icon={<LightIcon />}
          title="Luz de cultivo"
          detail={lightSummary(config.light)}
          onClick={() => {
            onGo('climate');
          }}
        />
      </li>
    ),
    weather?.closeWindow && (
      <li key="close-window">
        <ListRow
          className="menu-row"
          icon={<CloudIcon />}
          title="Ventana cerrada con lluvia o viento"
          detail={`El hub lo pide con ${IN_DEMO ? 'el tiempo simulado' : 'lo que dice AEMET'}; ventila solo el ventilador.`}
          onClick={() => {
            onGo('weather');
          }}
        />
      </li>
    ),
    weather?.frostWarning && (
      <li key="frost">
        <ListRow
          className="menu-row"
          icon={<CloudIcon />}
          title="Aviso de helada"
          detail={`Por la tarde, si ${IN_DEMO ? 'se' : 'AEMET'} prevé helada esta noche.`}
          onClick={() => {
            onGo('weather');
          }}
        />
      </li>
    ),
  ].filter(Boolean);

  return rows.length === 0 ? (
    <p className="settings-hint">Ninguna: todo lo mueves tú.</p>
  ) : (
    <ul className="settings-list">{rows}</ul>
  );
}
