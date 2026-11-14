import { sunTimes } from '@vitreo/shared';
import type { ConfigRules } from '@vitreo/shared';
import { useEffect, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';

import {
  clearAutomationError,
  loadAutomation,
  saveRules,
  useAutomation,
} from '../../data/automation.ts';
import { now as nowMs } from '../../app/clock.ts';
import { useHub } from '../../data/hub.ts';
import { formatTime } from '../../ui/format.ts';
import { Button, Segmented, Slider, TextField, Toggle } from '../../ui/primitives/index.ts';
import { useHubBlocker } from '../../ui/useHubBlocker.ts';
import { ConfigStatusLine } from './ConfigStatus.tsx';
import { lightSummary, ventilationSummary } from './explain.ts';
import './automations.css';

type Climate = Pick<ConfigRules, 'ventilation' | 'light'>;

const HYSTERESIS = [
  { value: '1', label: '1 °C' },
  { value: '2', label: '2 °C' },
  { value: '3', label: '3 °C' },
] as const;
const MODES = [
  { value: 'schedule', label: 'Horario' },
  { value: 'sun', label: 'Con el sol' },
] as const;
const SUNRISE = [
  { value: '-60', label: '−1 h' },
  { value: '0', label: 'Amanecer' },
  { value: '60', label: '+1 h' },
] as const;
const SUNSET = [
  { value: '0', label: 'Anochecer' },
  { value: '60', label: '+1 h' },
  { value: '120', label: '+2 h' },
  { value: '180', label: '+3 h' },
] as const;
/** "Poca luz natural": what the light rule checks against when asked to. */
const LOW_DAYLIGHT_LUX = 3000;

/**
 * Ajustes › Ventilación y luz (A6, D89): the greenhouse's own rules in
 * `config`, which it applies with the PC off (D73). Fan then window, each
 * with hysteresis; the light by the clock or by the sun where the greenhouse
 * is. Saved explicitly; "Aplicado" only when the greenhouse confirms.
 */
export function ClimatePage() {
  const state = useAutomation((store) => store.state);
  const hubUp = useHub((store) => store.status === 'up');
  useEffect(() => {
    if (hubUp) void loadAutomation();
  }, [hubUp]);
  const blocker = useHubBlocker('la ventilación y la luz se podrán cambiar cuando vuelva.');
  if (!state) {
    return (
      <p className="settings-hint" data-tone={blocker ? 'attention' : undefined}>
        {blocker ?? 'Cargando…'}
      </p>
    );
  }
  const { ventilation, light } = state.config;
  return <ClimateForm key={state.config.rev} saved={{ ventilation, light }} blocker={blocker} />;
}

function ClimateForm({ saved, blocker }: { saved: Climate; blocker: string | null }) {
  const [draft, setDraft] = useState<Climate>(saved);
  const saving = useAutomation((store) => store.saving);
  const location = useHub((store) => store.settings?.location ?? null);
  const blockerId = useId();
  // Today, for the preview of the sun (fixed while the page is open).
  const [today] = useState(() => nowMs() / 1000);
  const changed = JSON.stringify(draft) !== JSON.stringify(saved);
  const v = draft.ventilation;
  const light = draft.light;
  const set = (change: Partial<Climate>) => {
    setDraft({ ...draft, ...change });
    clearAutomationError();
  };
  const setVentilation = (change: Partial<Climate['ventilation']>) => {
    const next = { ...v, ...change };
    // The window opens at or above the fan.
    set({ ventilation: { ...next, windowAbove: Math.max(next.windowAbove, next.fanAbove) } });
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!changed || blocker) return;
    void saveRules((rules) => ({ ...rules, ...draft }));
  };

  // Today's window where the greenhouse is, in this device's clock.
  const sun = location ? sunTimes(today, location.lat, location.lng) : null;
  const preview =
    light.mode === 'sun'
      ? sun
        ? `Hoy, de ${formatTime((sun.sunrise + light.sunriseOffset * 60) * 1000)} a ${formatTime((sun.sunset + light.sunsetOffset * 60) * 1000)}.`
        : 'Hoy allí el sol no sale o no se pone.'
      : null;

  return (
    <form className="settings-page automation-form" onSubmit={submit}>
      <p className="settings-hint">
        El invernadero lo aplica solo, también con el PC apagado. Los límites de seguridad (bomba,
        depósito, calor) van aparte y siempre mandan.
      </p>

      <section className="settings-section" aria-labelledby="climate-vent">
        <h3 id="climate-vent" className="hud-label">
          Ventilación
        </h3>
        <Toggle
          label="Ventilar sola"
          description={
            v.enabled ? ventilationSummary(v) : 'Apagada: el ventilador y la ventana los mueves tú.'
          }
          checked={v.enabled}
          onChange={(enabled) => {
            setVentilation({ enabled });
          }}
        />
        {v.enabled && (
          <div className="automation-fields settings-fields">
            <Slider
              label="Ventilador desde"
              value={v.fanAbove}
              min={18}
              max={40}
              format={(value) => `${value.toString()} °C`}
              onChange={(fanAbove) => {
                setVentilation({ fanAbove });
              }}
            />
            <Slider
              label="Ventana también desde"
              value={v.windowAbove}
              min={v.fanAbove}
              max={42}
              format={(value) => `${value.toString()} °C`}
              onChange={(windowAbove) => {
                setVentilation({ windowAbove });
              }}
            />
            <div className="automation-choice">
              <span className="automation-label">Paran por debajo, con un margen de</span>
              <Segmented
                label="Margen para parar"
                value={
                  String(Math.min(Math.max(Math.round(v.hysteresis), 1), 3)) as '1' | '2' | '3'
                }
                options={HYSTERESIS}
                onChange={(value) => {
                  setVentilation({ hysteresis: Number(value) });
                }}
              />
            </div>
            <Slider
              label="O con humedad desde"
              value={v.maxRh}
              min={60}
              max={98}
              format={(value) => `${value.toString()} %`}
              onChange={(maxRh) => {
                setVentilation({ maxRh });
              }}
            />
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="climate-light">
        <h3 id="climate-light" className="hud-label">
          Luz de cultivo
        </h3>
        <Toggle
          label="Encender la luz sola"
          description={light.enabled ? lightSummary(light) : 'Apagada: la enciendes tú.'}
          checked={light.enabled}
          onChange={(enabled) => {
            set({ light: { ...light, enabled } });
          }}
        />
        {light.enabled && (
          <div className="automation-fields settings-fields">
            <Segmented
              label="Cuándo"
              value={light.mode}
              options={MODES}
              onChange={(mode) => {
                if (mode === light.mode) return;
                set({
                  light:
                    mode === 'sun'
                      ? {
                          enabled: true,
                          mode: 'sun',
                          sunriseOffset: 0,
                          sunsetOffset: 120,
                          belowLux: light.belowLux,
                        }
                      : {
                          enabled: true,
                          mode: 'schedule',
                          on: '07:00',
                          off: '21:00',
                          belowLux: light.belowLux,
                        },
                });
              }}
            />
            {light.mode === 'sun' && !location && (
              <p className="settings-hint" data-tone="attention">
                Pon la ubicación en Ajustes › Ubicación: sin ella el invernadero no sabe cuándo
                amanece.
              </p>
            )}
            {light.mode === 'schedule' ? (
              <div className="settings-pair">
                <TextField
                  label="Enciende"
                  type="time"
                  value={light.on}
                  onChange={(event) => {
                    if (event.target.value) set({ light: { ...light, on: event.target.value } });
                  }}
                />
                <TextField
                  label="Apaga"
                  type="time"
                  value={light.off}
                  onChange={(event) => {
                    if (event.target.value) set({ light: { ...light, off: event.target.value } });
                  }}
                />
              </div>
            ) : (
              <>
                <div className="automation-choice">
                  <span className="automation-label">Enciende</span>
                  <Segmented
                    label="Enciende"
                    value={String(light.sunriseOffset) as (typeof SUNRISE)[number]['value']}
                    options={SUNRISE}
                    onChange={(value) => {
                      set({ light: { ...light, sunriseOffset: Number(value) } });
                    }}
                  />
                </div>
                <div className="automation-choice">
                  <span className="automation-label">Apaga</span>
                  <Segmented
                    label="Apaga"
                    value={String(light.sunsetOffset) as (typeof SUNSET)[number]['value']}
                    options={SUNSET}
                    onChange={(value) => {
                      set({ light: { ...light, sunsetOffset: Number(value) } });
                    }}
                  />
                </div>
              </>
            )}
            <Toggle
              label="Solo con poca luz natural"
              description="Espera mientras el sol da luz de sobra."
              checked={light.belowLux !== null}
              onChange={(on) => {
                set({ light: { ...light, belowLux: on ? LOW_DAYLIGHT_LUX : null } });
              }}
            />
            {preview && <p className="settings-hint">{preview}</p>}
          </div>
        )}
      </section>

      {blocker && (
        <p id={blockerId} className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!changed || blocker !== null || saving || (light.mode === 'sun' && !location)}
        aria-describedby={blocker ? blockerId : undefined}
      >
        Guardar
      </Button>
      <ConfigStatusLine />
    </form>
  );
}
