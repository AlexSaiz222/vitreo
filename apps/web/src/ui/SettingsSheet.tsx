import { useState } from 'react';

import { IN_DEMO } from '../app/demo.ts';
import { useHud } from '../app/hud.ts';
import { ActiveAutomations } from '../features/automations/ActiveAutomations.tsx';
import { useSettings } from '../app/settings.ts';
import type { Quality } from '../app/settings.ts';
import { useThemeSetting } from '../app/themeChoice.ts';
import type { ThemeSetting } from '../app/themeChoice.ts';
import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import { useAutomation } from '../data/automation.ts';
import { usePush } from '../data/push.ts';
import { AlertsPage } from '../features/alerts/AlertsPage.tsx';
import { formatBytes, storageText, useHubStorage } from '../data/storage.ts';
import { useHub } from '../data/hub.ts';
import { ClimatePage } from '../features/automations/ClimatePage.tsx';
import { SoundSection } from '../features/sound/SoundSection.tsx';
import { WeatherPage } from '../features/weather/WeatherPage.tsx';
import { useOutdoor, useWeatherHub } from '../data/weather.ts';
import { deviceKind, formatTime, freshnessText } from './format.ts';
import { hubDownText } from './hubText.ts';
import {
  AirIcon,
  AttentionIcon,
  Button,
  CloudIcon,
  IconButton,
  ListRow,
  LocationIcon,
  Segmented,
  Sheet,
  SettingsIcon,
} from './primitives/index.ts';
import { LocationPage, PlantPage, PlantsPage } from './settings/GreenhousePages.tsx';
import { useZone } from './useZones.ts';

const APPEARANCE = [
  { value: 'auto', label: 'Auto' },
  { value: 'day', label: 'Día' },
  { value: 'night', label: 'Noche' },
] as const satisfies readonly { value: ThemeSetting; label: string }[];

const APPEARANCE_HINT: Record<ThemeSetting, string> = {
  auto: 'Sigue al sol donde está el invernadero.',
  day: 'Siempre de día.',
  night: 'Siempre de noche.',
};

const QUALITY = [
  { value: 'auto', label: 'Auto' },
  { value: 'high', label: 'Alta' },
  { value: 'low', label: 'Baja' },
  { value: 'flat', label: 'Sin 3D' },
] as const satisfies readonly { value: Quality; label: string }[];

const QUALITY_HINT: Record<Quality, string> = {
  auto: 'Alta, y baja sola si el móvil va justo.',
  high: 'La escena a la resolución de la pantalla.',
  low: 'Menos resolución: más fluida y gasta menos batería.',
  flat: 'Sin escena: las plantas en una lista. No descarga el modelo 3D.',
};

/** The top-right button: Ajustes (A3). */
export function SettingsButton() {
  const setPanel = useHud((state) => state.setPanel);
  return (
    <IconButton
      className="hud-floating settings-button"
      size="lg"
      icon={<SettingsIcon />}
      label="Ajustes"
      onClick={() => {
        setPanel('settings');
      }}
    />
  );
}

type Page =
  | { name: 'main' }
  | { name: 'plants' }
  | { name: 'plant'; zone: string }
  | { name: 'location' }
  | { name: 'climate' }
  | { name: 'weather' }
  | { name: 'alerts' };

/**
 * Ajustes (A3, D86; A4, D87). Its first page is about this device:
 * appearance, quality of the 3D, the welcome again, and what is this. A
 * change applies at once and the control shows it, so there is nothing to
 * undo (D85). Plantas and Ubicación belong to the greenhouse: the hub keeps
 * them, each on its own page.
 */
export function SettingsSheet() {
  const open = useHud((state) => state.panel === 'settings');
  const setPanel = useHud((state) => state.setPanel);
  // A fresh first page every time it opens.
  return open ? (
    <SettingsPanel
      onClose={() => {
        setPanel(null);
      }}
    />
  ) : null;
}

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<Page>({ name: 'main' });
  const plant = useZone(page.name === 'plant' ? page.zone : null);
  const toMain = () => {
    setPage({ name: 'main' });
  };

  switch (page.name) {
    case 'main':
      return (
        <Sheet className="settings-sheet" full title="Ajustes" page="main" onClose={onClose}>
          <DevicePage onGo={setPage} />
        </Sheet>
      );
    case 'plants':
      return (
        <Sheet
          className="settings-sheet"
          full
          title="Plantas"
          page="plants"
          back={{ label: 'Volver a Ajustes', onBack: toMain }}
          onClose={onClose}
        >
          <PlantsPage
            onOpen={(zone) => {
              setPage({ name: 'plant', zone });
            }}
          />
        </Sheet>
      );
    case 'plant':
      return (
        <Sheet
          className="settings-sheet"
          full
          title={plant?.name ?? 'Planta'}
          subtitle={plant?.article === null ? plant.speciesName : undefined}
          page={`plant:${page.zone}`}
          back={{
            label: 'Volver a Plantas',
            onBack: () => {
              setPage({ name: 'plants' });
            },
          }}
          onClose={onClose}
        >
          <PlantPage zoneId={page.zone} />
        </Sheet>
      );
    case 'alerts':
      return (
        <Sheet
          className="settings-sheet"
          full
          title="Avisos"
          page="alerts"
          back={{ label: 'Volver a Ajustes', onBack: toMain }}
          onClose={onClose}
        >
          <AlertsPage />
        </Sheet>
      );
    case 'climate':
      return (
        <Sheet
          className="settings-sheet"
          full
          title="Ventilación y luz"
          page="climate"
          back={{ label: 'Volver a Ajustes', onBack: toMain }}
          onClose={onClose}
        >
          <ClimatePage />
        </Sheet>
      );
    case 'weather':
      return (
        <Sheet
          className="settings-sheet"
          full
          title="Tiempo exterior"
          page="weather"
          back={{ label: 'Volver a Ajustes', onBack: toMain }}
          onClose={onClose}
        >
          <WeatherPage />
        </Sheet>
      );
    case 'location':
      return (
        <Sheet
          className="settings-sheet"
          full
          title="Ubicación"
          page="location"
          back={{ label: 'Volver a Ajustes', onBack: toMain }}
          onClose={onClose}
        >
          <LocationPage />
        </Sheet>
      );
  }
}

/** The hub in one line, for Acerca de. */
function useHubLine(): string {
  const status = useHub((state) => state.status);
  const downSince = useHub((state) => state.downSince);
  const health = useHub((state) => state.health);
  const why = hubDownText(status, downSince, health?.device);
  if (why !== null) return why;
  if (health && !health.mqtt) return 'Conectado, pero sin el broker: el historial espera';
  return health?.lastTelemetry
    ? `Conectado · último dato guardado a las ${formatTime(health.lastTelemetry * 1000)}`
    : 'Conectado';
}

function DevicePage({ onGo }: { onGo: (page: Page) => void }) {
  const setPanel = useHud((state) => state.setPanel);
  const theme = useThemeSetting((state) => state.setting);
  const setTheme = useThemeSetting((state) => state.set);
  const quality = useSettings((state) => state.quality);
  const setQuality = useSettings((state) => state.setQuality);
  const autoLowered = useSettings((state) => state.autoLowered);
  const webglFailed = useSettings((state) => state.webglFailed);
  const freshness = useFreshness();
  const link = useGreenhouse((state) => state.link);
  const deviceId = useGreenhouse((state) => state.deviceId);
  const kind = deviceKind(useGreenhouse((state) => state.telemetry?.fw));
  const hubLine = useHubLine();
  const storage = useHubStorage();
  const named = useHub((state) => state.plants?.filter((p) => p.name !== null).length ?? 0);
  const climate = useAutomation((store) => store.state?.config);
  const pushState = usePush((store) => store.state);
  const alertsDetail = IN_DEMO
    ? 'Los avisos de la demo'
    : pushState === 'on'
      ? 'Activados en este dispositivo'
      : pushState === 'unsupported'
        ? 'Este navegador no los recibe'
        : pushState === 'denied'
          ? 'Bloqueados en este navegador'
          : 'Notificaciones del invernadero';
  const climateParts = climate
    ? [
        climate.ventilation.enabled ? 'Ventila sola' : null,
        climate.light.enabled
          ? climate.light.mode === 'sun'
            ? 'Luz con el sol'
            : 'Luz con horario'
          : null,
      ].filter((part): part is string => part !== null)
    : null;
  const climateDetail =
    climateParts === null
      ? 'Automáticas, en el invernadero'
      : climateParts.length > 0
        ? climateParts.join(' · ')
        : 'Apagadas: las mueves tú';

  // Outdoor weather (A10): what it is now, or why there is none, in a few words.
  const outdoor = useOutdoor();
  const weatherStatus = useWeatherHub((store) => store.state?.status ?? null);
  const weatherDetail =
    outdoor?.temp != null
      ? `Ahora ${Math.round(outdoor.temp).toString()}° fuera · ${IN_DEMO ? 'simulado' : 'AEMET'}`
      : IN_DEMO
        ? 'Lluvia, viento y niebla, simulados'
        : weatherStatus === 'no-key'
          ? 'Sin clave de AEMET'
          : weatherStatus === 'failing'
            ? 'AEMET no responde'
            : 'Lluvia, viento y heladas, de AEMET';

  const qualityHint = webglFailed
    ? 'Este dispositivo no puede mostrar el 3D: el invernadero se ve en lista.'
    : quality === 'auto' && autoLowered
      ? 'Auto ha bajado la calidad para que vaya fluido.'
      : QUALITY_HINT[quality];

  return (
    <>
      <section className="settings-section" aria-labelledby="settings-appearance">
        <h3 id="settings-appearance" className="hud-label">
          Apariencia
        </h3>
        <Segmented label="Apariencia" value={theme} options={APPEARANCE} onChange={setTheme} />
        <p className="settings-hint">{APPEARANCE_HINT[theme]}</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-quality">
        <h3 id="settings-quality" className="hud-label">
          Calidad del 3D
        </h3>
        <Segmented
          label="Calidad del 3D"
          value={webglFailed ? 'flat' : quality}
          options={QUALITY}
          disabled={webglFailed}
          onChange={setQuality}
        />
        <p className="settings-hint">{qualityHint}</p>
      </section>

      <SoundSection />

      <section className="settings-section" aria-labelledby="settings-greenhouse">
        <h3 id="settings-greenhouse" className="hud-label">
          Invernadero
        </h3>
        <ul className="settings-list">
          <li>
            <ListRow
              className="menu-row"
              title="Plantas"
              detail={
                named > 0
                  ? `Nombres y siembra · ${named.toString()} con nombre`
                  : 'Nombres y siembra'
              }
              onClick={() => {
                onGo({ name: 'plants' });
              }}
            />
          </li>
          <li>
            <ListRow
              className="menu-row"
              icon={<AttentionIcon />}
              title="Avisos"
              detail={alertsDetail}
              onClick={() => {
                onGo({ name: 'alerts' });
              }}
            />
          </li>
          <li>
            <ListRow
              className="menu-row"
              icon={<AirIcon />}
              title="Ventilación y luz"
              detail={climateDetail}
              onClick={() => {
                onGo({ name: 'climate' });
              }}
            />
          </li>
          <li>
            <ListRow
              className="menu-row"
              icon={<CloudIcon />}
              title="Tiempo exterior"
              detail={weatherDetail}
              onClick={() => {
                onGo({ name: 'weather' });
              }}
            />
          </li>
          <li>
            <ListRow
              className="menu-row"
              icon={<LocationIcon />}
              title="Ubicación"
              detail="Para el día y la noche"
              onClick={() => {
                onGo({ name: 'location' });
              }}
            />
          </li>
        </ul>
      </section>

      <section className="settings-section" aria-labelledby="settings-active">
        <h3 id="settings-active" className="hud-label">
          Automatizaciones activas
        </h3>
        <ActiveAutomations
          onGo={(name) => {
            onGo({ name });
          }}
        />
      </section>

      <section className="settings-section" aria-labelledby="settings-welcome">
        <h3 id="settings-welcome" className="hud-label">
          Bienvenida
        </h3>
        <Button
          onClick={() => {
            setPanel('welcome');
          }}
        >
          Ver la bienvenida
        </Button>
      </section>

      <section className="settings-section" aria-labelledby="settings-about">
        <h3 id="settings-about" className="hud-label">
          Acerca de
        </h3>
        <dl className="plant-facts">
          <div className="plant-fact">
            <dt className="hud-label">Invernadero</dt>
            <dd>{kind === 'simulator' ? `Simulador (${deviceId}, datos de prueba)` : deviceId}</dd>
          </div>
          <div className="plant-fact">
            <dt className="hud-label">Conexión</dt>
            <dd>{freshnessText(freshness, link)}</dd>
          </div>
          <div className="plant-fact">
            <dt className="hud-label">Hub</dt>
            <dd>{hubLine}</dd>
          </div>
          {/* What the hub keeps (A8); the Hub row above says when it is down. */}
          {storage && (
            <div className="plant-fact">
              <dt className="hud-label">Almacenamiento</dt>
              <dd>{storageText(storage)}</dd>
            </div>
          )}
          {storage && (
            <div className="plant-fact">
              <dt className="hud-label">Fotos, último mes</dt>
              <dd>{formatBytes(storage.photosLast30DaysBytes)}</dd>
            </div>
          )}
          <div className="plant-fact">
            <dt className="hud-label">Versión</dt>
            <dd>{__APP_BUILD__}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}
