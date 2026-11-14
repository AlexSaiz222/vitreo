import { useEffect, useId, useRef, useState } from 'react';

import { useHud } from '../app/hud.ts';
import type { DockMenu } from '../app/hud.ts';
import { useSelection } from '../app/selection.ts';
import { useView } from '../app/view.ts';
import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import {
  selectAutomationNote,
  selectFrost,
  selectHeld,
  selectLastCommand,
  selectSoilMoisture,
} from '../data/selectors.ts';
import { useWeatherHub } from '../data/weather.ts';
import { explainReason } from '../features/automations/explain.ts';
import type { CommandMessage } from '@vitreo/shared';
import { wiltAmount } from '../scene/wilt.ts';
import { FAN_MINUTES, moveWindow, switchFan, switchLight, WINDOW_POSITIONS } from './actions.ts';
import { commandText, formatDegrees, formatFraction, plantMood } from './format.ts';
import {
  AirIcon,
  AttentionIcon,
  Button,
  Chip,
  DropIcon,
  LightIcon,
  ListRow,
  MoistureDrop,
  Segmented,
  Surface,
  SwapText,
} from './primitives/index.ts';
import { TankGauge } from './TankGauge.tsx';
import { useZone, useZones } from './useZones.ts';
import { useClock } from './useClock.ts';

/**
 * How long an order may wait for its answer before the menu says
 * "Enviando…" (ms, wall clock): a quick answer, the usual one, shows only
 * the new state, with no word that comes and goes in a blink.
 */
const QUIET_PENDING_MS = 600;

/** True once the order `requestId` has waited longer than QUIET_PENDING_MS. */
function useSlowAnswer(requestId: string | null): boolean {
  const [slow, setSlow] = useState<string | null>(null);
  useEffect(() => {
    if (requestId === null) return;
    const timer = setTimeout(() => {
      setSlow(requestId);
    }, QUIET_PENDING_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [requestId]);
  return requestId !== null && slow === requestId;
}

/**
 * Status of the latest command matching `match`, refreshed while it matters.
 * While it waits, its control takes no new order but keeps its look
 * (`aria-disabled`): turning grey for the instant the answer takes read as
 * a flash.
 */
function useCommandStatus(match: (command: CommandMessage) => boolean) {
  const entry = useGreenhouse((state) => selectLastCommand(state, match));
  const now = useClock(entry !== null);
  const pending = entry?.status === 'pending';
  const slow = useSlowAnswer(pending ? entry.command.requestId : null);
  return { entry, text: pending && !slow ? null : commandText(entry, now), pending };
}

function WaterMenu({ id, onChoose }: { id: string; onChoose: (zoneId: string) => void }) {
  const zones = useZones();
  return (
    <Surface
      id={id}
      elevation="float"
      className="dock-menu"
      data-hud-obstacle=""
      role="group"
      aria-label="Elige una planta para regar"
    >
      <ul className="dock-menu-list">
        {zones.map((zone) => (
          <li key={zone.id}>
            <PlantChoice zoneId={zone.id} onChoose={onChoose} />
          </li>
        ))}
      </ul>
    </Surface>
  );
}

function PlantChoice({ zoneId, onChoose }: { zoneId: string; onChoose: (zoneId: string) => void }) {
  const zone = useZone(zoneId);
  const moisture = useGreenhouse((state) => selectSoilMoisture(state, zoneId));
  const watering = useGreenhouse((state) => state.watering[zoneId] !== undefined);
  if (!zone) return null;
  const thirsty = wiltAmount(moisture, zone.threshold) > 0;
  const mood = watering ? 'Regando' : plantMood(moisture, thirsty);
  return (
    <ListRow
      className="menu-row"
      data-zone={zoneId}
      icon={<MoistureDrop moisture={moisture} thirsty={thirsty} />}
      title={zone.name}
      detail={
        moisture === null ? (
          'Sin lectura del sensor'
        ) : (
          <>
            <span className="reading">{formatFraction(moisture)}</span> · {mood.toLowerCase()}
          </>
        )
      }
      muted={moisture === null}
      trailing={
        thirsty && !watering ? (
          <Chip tone="attention" icon={<AttentionIcon />}>
            Sed
          </Chip>
        ) : undefined
      }
      onClick={() => {
        onChoose(zoneId);
      }}
    />
  );
}

const OUTSIDE = { rain: 'Llueve fuera', snow: 'Nieva fuera', wind: 'Viento fuerte fuera' } as const;
const WHILE = {
  rain: 'llueva fuera',
  snow: 'nieve fuera',
  wind: 'haya viento fuerte fuera',
} as const;

function AirMenu({ id, disabled }: { id: string; disabled: boolean }) {
  const fanOn = useGreenhouse((state) => state.telemetry?.actuators.fan ?? false);
  const vent = useGreenhouse((state) => state.telemetry?.actuators.vent ?? null);
  const fan = useCommandStatus((c) => c.action === 'fan');
  const ventStatus = useCommandStatus((c) => c.action === 'vent');
  // Frost protection (D90) holds the window closed and the fan off.
  const frostActive = useGreenhouse((state) => selectFrost(state).active);
  const frostTemp = useGreenhouse((state) => selectFrost(state).temp);
  const frostNote = frostActive
    ? `Ventana cerrada por frío${frostTemp === null ? '' : ` · ${formatDegrees(frostTemp)}`}`
    : null;
  const frostId = useId();
  // Moved by the automation (A6): it says why.
  const fanEvent = useGreenhouse((state) => selectAutomationNote(state, 'fan'));
  const ventEvent = useGreenhouse((state) => selectAutomationNote(state, 'vent'));
  const fanNote = fanEvent ? `Automático: ${explainReason(fanEvent.reason)}` : undefined;
  // The hub's outdoor hold (A10), as the device reports it: closed for the
  // weather with the fan only, or open by heat protection or by you.
  const hold = useGreenhouse((state) => state.telemetry?.outdoorHold ?? null);
  const heatHeld = useGreenhouse((state) => selectHeld(state, 'over_temperature').active);
  const heatSaid = useWeatherHub((store) => store.state?.window.state === 'held-by-heat');
  const heat = heatHeld || heatSaid;
  const ventNote = ventEvent
    ? ventEvent.reason.kind === 'weather'
      ? `Cerrada: ${explainReason(ventEvent.reason)}`
      : `Automática: ${explainReason(ventEvent.reason)}`
    : !hold || vent === null
      ? undefined
      : vent <= 0
        ? `Cerrada mientras ${WHILE[hold.cause]}: ventila solo el ventilador`
        : heat
          ? `${OUTSIDE[hold.cause]}, pero el calor dentro la mantiene abierta`
          : `${OUTSIDE[hold.cause]}; la abriste tú y se queda así mientras dure`;
  const position =
    vent === null
      ? null
      : (WINDOW_POSITIONS.find((p) => Math.abs(vent - p.open) < 0.25)?.value ?? null);

  // A small popover just above its button, sized to its content (D85).
  return (
    <Surface
      id={id}
      elevation="float"
      className="dock-popover"
      data-hud-obstacle=""
      role="group"
      aria-label="Aire"
    >
      <span className="hud-label">Ventilador</span>
      <Button
        icon={<AirIcon />}
        pressed={fanOn}
        disabled={disabled || (frostActive && !fanOn)}
        aria-disabled={fan.pending || undefined}
        aria-describedby={frostActive ? frostId : undefined}
        onClick={() => {
          if (!fan.pending) switchFan(!fanOn);
        }}
      >
        <SwapText
          texts={[`Encender ${FAN_MINUTES.toString()} min`, 'Apagar']}
          shown={fanOn ? 1 : 0}
        />
      </Button>
      {(fan.text ?? fanNote) && (
        <span className="menu-status" data-prose={fan.text ? undefined : ''} aria-live="polite">
          {fan.text ?? fanNote}
        </span>
      )}
      <span className="hud-label">Ventana</span>
      <Segmented
        label="Ventana"
        value={position}
        options={WINDOW_POSITIONS}
        disabled={disabled || frostActive}
        busy={ventStatus.pending}
        onChange={(value) => {
          const chosen = WINDOW_POSITIONS.find((p) => p.value === value);
          if (chosen) moveWindow(chosen.open);
        }}
      />
      {frostNote ? (
        <span id={frostId} className="menu-status" data-tone="attention" aria-live="polite">
          {frostNote}
        </span>
      ) : (
        (ventStatus.text ?? ventNote) && (
          <span
            className="menu-status"
            data-prose={ventStatus.text ? undefined : ''}
            aria-live="polite"
          >
            {ventStatus.text ?? ventNote}
          </span>
        )
      )}
    </Surface>
  );
}

function LightButton({ disabled, reason }: { disabled: boolean; reason: string | undefined }) {
  const on = useGreenhouse((state) => state.telemetry?.actuators.growLight ?? false);
  const light = useCommandStatus((c) => c.action === 'growLight');
  const auto = useGreenhouse((state) => selectAutomationNote(state, 'growLight'));
  const tail = auto ? ' · auto' : '';
  return (
    <Button
      icon={<LightIcon />}
      detail={
        light.text ?? <SwapText texts={[`Apagada${tail}`, `Encendida${tail}`]} shown={on ? 1 : 0} />
      }
      title={auto ? `Automática: ${explainReason(auto.reason)}` : undefined}
      pressed={on}
      disabled={disabled}
      aria-disabled={light.pending || undefined}
      aria-describedby={reason}
      onClick={() => {
        if (!light.pending) switchLight(!on);
      }}
    >
      Luz
    </Button>
  );
}

/**
 * docs/03: "Regar · Luz · Aire" at thumb height, on a floating bar (D72).
 * Light is one tap; watering goes through the plant's detail sheet; air
 * offers the fan and the window. Without a connection the buttons stay
 * visible but flat, and the bar says why.
 */
export function Dock() {
  const menu = useHud((state) => state.menu);
  const setMenu = useHud((state) => state.setMenu);
  const openSheet = useSelection((state) => state.open);
  const freshness = useFreshness();
  const unavailable = freshness.kind === 'disconnected' || freshness.kind === 'waiting';
  const closer = useView((state) => state.closer);
  const dock = useRef<HTMLElement>(null);
  const waterId = useId();
  const airId = useId();
  const reasonId = useId();
  const reason = unavailable ? reasonId : undefined;

  // Without a connection nothing can be done: close any open menu.
  const visibleMenu = unavailable ? null : menu;

  useEffect(() => {
    if (!visibleMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenu(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [visibleMenu, setMenu]);

  // Zoomed in, the dock folds to a slim row so it covers less of the
  // greenhouse (D134); open, or with something to say, it stays whole.
  const folded = closer && visibleMenu === null && !unavailable;

  const toggle = (next: DockMenu) => {
    setMenu(menu === next ? null : next);
  };

  return (
    <nav ref={dock} className="dock" aria-label="Acciones" data-folded={folded}>
      {visibleMenu === 'water' && (
        <WaterMenu
          id={waterId}
          onChoose={(zoneId) => {
            setMenu(null);
            openSheet(zoneId);
          }}
        />
      )}
      <Surface elevation="float" className="dock-bar" data-hud-obstacle="">
        {visibleMenu === 'air' && <AirMenu id={airId} disabled={unavailable} />}
        {unavailable && (
          <p id={reasonId} className="dock-reason">
            {freshness.kind === 'waiting'
              ? 'Esperando al invernadero'
              : 'Sin conexión: las acciones vuelven al reconectar'}
          </p>
        )}
        <TankGauge />
        <ul className="dock-buttons">
          <li>
            <Button
              icon={<DropIcon />}
              aria-expanded={visibleMenu === 'water'}
              aria-controls={waterId}
              aria-describedby={reason}
              disabled={unavailable}
              onClick={() => {
                toggle('water');
              }}
            >
              Regar
            </Button>
          </li>
          <li>
            <LightButton disabled={unavailable} reason={reason} />
          </li>
          <li>
            <Button
              icon={<AirIcon />}
              aria-expanded={visibleMenu === 'air'}
              aria-controls={airId}
              aria-describedby={reason}
              disabled={unavailable}
              onClick={() => {
                toggle('air');
              }}
            >
              Aire
            </Button>
          </li>
        </ul>
      </Surface>
    </nav>
  );
}
