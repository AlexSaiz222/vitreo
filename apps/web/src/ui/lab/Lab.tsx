import { lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';

import {
  AirIcon,
  AttentionIcon,
  Button,
  CheckIcon,
  Chip,
  DialGauge,
  DropIcon,
  IconButton,
  LightIcon,
  ListRow,
  MoistureDrop,
  Segmented,
  SettingsIcon,
  Sheet,
  Slider,
  SunIcon,
  Surface,
  Toast,
  Toggle,
  UndoIcon,
} from '../primitives/index.ts';
import { formatFraction } from '../format.ts';
import './lab.css';

const Scene = lazy(() => import('../../scene/Scene.tsx'));

const WINDOW = [
  { value: 'closed', label: 'Cerrada' },
  { value: 'half', label: 'Media' },
  { value: 'open', label: 'Abierta' },
] as const;
const APPEARANCE = [
  { value: 'auto', label: 'Auto' },
  { value: 'day', label: 'Día' },
  { value: 'night', label: 'Noche' },
] as const;
const DURATION = [
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
  { value: '10', label: '10 s' },
] as const;

const percent = (value: number) => formatFraction(value / 100);
/** A non-breaking space keeps the unit with its number, as Intl does for %. */
const seconds = (value: number) => `${value.toString()}\u00a0s`;
/** The basil's reading in the examples. */
const BASIL = 0.42;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Surface as="section" elevation="float" padding="lg" className="lab-section">
      <h2 className="lab-heading">{title}</h2>
      {children}
    </Surface>
  );
}

/**
 * The primitives catalogue (phase A1, development only: `?ui=lab`), over the
 * real scene, to approve the neumorphic look by day and by night before the
 * HUD moves to it. Every control works.
 */
export function Lab() {
  const [light, setLight] = useState(true);
  const [autoWater, setAutoWater] = useState(true);
  const [alerts, setAlerts] = useState(false);
  const [vent, setVent] = useState<(typeof WINDOW)[number]['value']>('half');
  const [appearance, setAppearance] = useState<(typeof APPEARANCE)[number]['value']>('auto');
  const [duration, setDuration] = useState<(typeof DURATION)[number]['value']>('5');
  const [threshold, setThreshold] = useState(35);
  const [waterSeconds, setWaterSeconds] = useState(5);
  const [sheet, setSheet] = useState(false);

  return (
    <main className="lab">
      <div className="lab-scene" aria-hidden="true">
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </div>

      <h1 className="lab-title">Primitivas · A1</h1>

      <div className="lab-grid">
        <Section title="Superficies">
          <div className="lab-swatches">
            {(['raised-sm', 'raised-md', 'inset-sm', 'inset-md'] as const).map((elevation) => (
              <Surface key={elevation} elevation={elevation} className="lab-swatch">
                {elevation}
              </Surface>
            ))}
          </div>
        </Section>

        <Section title="Botones">
          <div className="lab-row">
            <Button variant="primary" size="lg" icon={<DropIcon />}>
              Regar {seconds(5)}
            </Button>
          </div>
          <div className="lab-row">
            <Button
              icon={<LightIcon />}
              pressed={light}
              onClick={() => {
                setLight(!light);
              }}
            >
              Luz
            </Button>
            <Button icon={<AirIcon />}>Aire</Button>
          </div>
          <div className="lab-field">
            <Button icon={<DropIcon />} disabled aria-describedby="lab-reason">
              Regar
            </Button>
            <p id="lab-reason" className="lab-soft">
              Sin conexión: las acciones vuelven al reconectar
            </p>
          </div>
          <div className="lab-row">
            <IconButton label="Ajustes" icon={<SettingsIcon />} />
            <IconButton label="Día y noche" icon={<SunIcon />} pressed />
            <IconButton label="Deshacer" icon={<UndoIcon />} size="lg" />
          </div>
        </Section>

        <Section title="Dock (vista previa)">
          <Surface elevation="raised-md" className="lab-dock">
            <Button icon={<DropIcon />}>Regar</Button>
            <Button
              icon={<LightIcon />}
              pressed={light}
              onClick={() => {
                setLight(!light);
              }}
            >
              Luz
            </Button>
            <Button icon={<AirIcon />}>Aire</Button>
          </Surface>
          <p className="lab-note">
            Luz encendida: hundida, punto de acento e icono en verde. Nunca solo la sombra.
          </p>
        </Section>

        <Section title="Interruptores">
          <Toggle
            label="Riego automático"
            description={`Cuando baje del ${percent(threshold)}`}
            checked={autoWater}
            onChange={setAutoWater}
          />
          <Toggle
            label="Avisos en el móvil"
            description="Depósito, límites de seguridad, sin datos"
            checked={alerts}
            onChange={setAlerts}
          />
        </Section>

        <Section title="Segmentado">
          <div className="lab-field">
            <span className="lab-label">Ventana</span>
            <Segmented label="Ventana" value={vent} options={WINDOW} onChange={setVent} />
          </div>
          <div className="lab-field">
            <span className="lab-label">Apariencia</span>
            <Segmented
              label="Apariencia"
              value={appearance}
              options={APPEARANCE}
              onChange={setAppearance}
            />
          </div>
        </Section>

        <Section title="Deslizador">
          <Slider
            label="Umbral de riego"
            value={threshold}
            min={10}
            max={80}
            onChange={setThreshold}
            format={percent}
          />
          <Slider
            label="Duración"
            value={waterSeconds}
            min={1}
            max={15}
            onChange={setWaterSeconds}
            format={seconds}
          />
        </Section>

        <Section title="Indicadores">
          <div className="lab-dials">
            <DialGauge
              label="Humedad de la tierra"
              value={BASIL}
              valueText={formatFraction(BASIL)}
              threshold={threshold / 100}
              caption="Albahaca"
            />
            <DialGauge label="Humedad de la tierra" value={null} valueText="" caption="Perejil" />
          </div>
          <div className="lab-row">
            <DialGauge label="Depósito" value={0.7} valueText={formatFraction(0.7)} size="sm" />
            <span>Depósito · {formatFraction(0.7)}</span>
            <DialGauge label="Depósito" value={null} valueText="" size="sm" />
            <span className="lab-soft">Depósito · sin dato</span>
          </div>
        </Section>

        <Section title="Lista">
          <ListRow
            icon={<MoistureDrop moisture={BASIL} />}
            title="Albahaca"
            detail={`${formatFraction(BASIL)} · bien`}
          />
          <ListRow
            icon={<MoistureDrop moisture={0.18} thirsty />}
            title="Perejil"
            detail={`${formatFraction(0.18)} · tiene sed`}
            trailing={
              <Chip tone="attention" icon={<AttentionIcon />}>
                Sed
              </Chip>
            }
          />
          <ListRow
            icon={<MoistureDrop moisture={null} />}
            title="Lechuga"
            detail="Sin dato del sensor"
            muted
          />
        </Section>

        <Section title="Chips">
          <div className="lab-row">
            <Chip tone="good" icon={<CheckIcon />}>
              En directo
            </Chip>
            <Chip>Simulador</Chip>
            <Chip tone="attention" icon={<AttentionIcon />}>
              Tiene sed
            </Chip>
          </div>
        </Section>

        <Section title="Avisos">
          <div className="lab-toasts">
            <Toast action={{ label: 'Deshacer', icon: <UndoIcon />, onAction: () => undefined }}>
              Umbral de la albahaca: {percent(threshold)}
            </Toast>
            <Toast tone="attention" onDismiss={() => undefined}>
              Queda poca agua en el depósito.
            </Toast>
          </div>
        </Section>

        <Section title="Hoja">
          <Button
            onClick={() => {
              setSheet(true);
            }}
          >
            Abrir la hoja de la albahaca
          </Button>
        </Section>
      </div>

      {sheet && (
        <Sheet
          title="Albahaca"
          subtitle="Ocimum basilicum"
          onClose={() => {
            setSheet(false);
          }}
        >
          <p className="lab-mood">Está bien.</p>
          <Button variant="primary" size="lg" icon={<DropIcon />}>
            Regar {seconds(Number(duration))}
          </Button>
          <div className="lab-dials">
            <DialGauge
              label="Humedad de la tierra"
              value={BASIL}
              valueText={formatFraction(BASIL)}
              threshold={threshold / 100}
              caption="Tierra"
            />
          </div>
          <div className="lab-field">
            <span className="lab-label">Duración del riego</span>
            <Segmented
              label="Duración del riego"
              value={duration}
              options={DURATION}
              onChange={setDuration}
            />
          </div>
          <Toggle
            label="Riego automático"
            description={`Cuando baje del ${percent(threshold)}`}
            checked={autoWater}
            onChange={setAutoWater}
          />
        </Sheet>
      )}
    </main>
  );
}
