import type { WateringRule } from '@vitreo/shared';
import { useEffect, useId, useState } from 'react';
import type { SyntheticEvent } from 'react';

import {
  clearAutomationError,
  loadAutomation,
  saveRules,
  useAutomation,
} from '../../data/automation.ts';
import { useHub } from '../../data/hub.ts';
import type { ZoneLayout } from '../../scene/zones.ts';
import { Button, Segmented, Slider, TextField, Toggle } from '../../ui/primitives/index.ts';
import { useHubBlocker } from '../../ui/useHubBlocker.ts';
import { ConfigStatusLine } from './ConfigStatus.tsx';
import { wateringSummary } from './explain.ts';
import './automations.css';

const PER_DAY = [
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
] as const;

const PAUSE = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 h' },
  { value: '120', label: '2 h' },
  { value: '240', label: '4 h' },
] as const;

const NIGHT = { from: '22:00', to: '08:00' };

/**
 * "Riego" in the plant's sheet (A6, D89, D100): the pot's rule in `config`,
 * which the greenhouse applies itself (D73). Its threshold is the plant's,
 * on or off: below it the plant wilts in the scene and asks for water, and
 * that is where it waters itself when turned on. Automatic watering is off
 * until turned on; the proposal comes from the species (docs/08). Saved
 * explicitly, and only said to be active once the greenhouse confirms it.
 */
export function PlantAutomation({ zone }: { zone: ZoneLayout }) {
  const state = useAutomation((store) => store.state);
  const hubUp = useHub((store) => store.status === 'up');
  useEffect(() => {
    if (hubUp) void loadAutomation();
  }, [hubUp]);
  const rule = state?.config.watering.find((r) => r.zone === zone.id);
  const blocker = useHubBlocker('el riego automático se podrá cambiar cuando vuelva.');

  return (
    <section className="plant-section automation" aria-labelledby={`auto-${zone.id}`}>
      <h3 id={`auto-${zone.id}`} className="hud-label">
        Riego
      </h3>
      {rule ? (
        // A new revision (saved here or elsewhere) starts the form again.
        <WateringForm key={state?.config.rev} rule={rule} blocker={blocker} />
      ) : (
        <p className="plant-empty" data-tone={blocker ? 'attention' : undefined}>
          {blocker ?? 'Cargando…'}
        </p>
      )}
    </section>
  );
}

function WateringForm({ rule, blocker }: { rule: WateringRule; blocker: string | null }) {
  const [draft, setDraft] = useState<WateringRule>(rule);
  const saving = useAutomation((store) => store.saving);
  const blockerId = useId();
  const changed = JSON.stringify(draft) !== JSON.stringify(rule);
  const edit = (change: Partial<WateringRule>) => {
    setDraft({ ...draft, ...change });
    clearAutomationError();
  };
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (!changed || blocker) return;
    void saveRules((rules) => ({
      ...rules,
      watering: rules.watering.map((r) => (r.zone === draft.zone ? draft : r)),
    }));
  };

  return (
    <form className="automation-form" onSubmit={submit}>
      <div className="automation-threshold">
        <Slider
          label="Pide agua por debajo de"
          value={Math.round(draft.threshold * 100)}
          min={15}
          max={70}
          format={(value) => `${value.toString()} %`}
          onChange={(value) => {
            edit({ threshold: value / 100 });
          }}
        />
        <p className="settings-hint">
          {draft.enabled
            ? 'Por debajo se marchita, te avisa y riega sola.'
            : 'Por debajo se marchita y te avisa.'}
        </p>
      </div>
      <Toggle
        label="Regar sola"
        description={
          draft.enabled ? wateringSummary(draft) : 'Apagado: la riegas tú, cuando quieras.'
        }
        checked={draft.enabled}
        onChange={(enabled) => {
          edit({ enabled });
        }}
      />
      {draft.enabled && (
        <div className="automation-fields">
          <Slider
            label="Cada riego"
            value={draft.seconds}
            min={1}
            max={15}
            format={(value) => `${value.toString()} s`}
            onChange={(seconds) => {
              edit({ seconds });
            }}
          />
          <div className="automation-pair">
            <div className="automation-choice">
              <span className="automation-label">Como mucho al día</span>
              <Segmented
                label="Como mucho al día"
                value={String(Math.min(Math.max(draft.maxPerDay, 1), 4)) as '1' | '2' | '3' | '4'}
                options={PER_DAY}
                onChange={(value) => {
                  edit({ maxPerDay: Number(value) });
                }}
              />
            </div>
            <div className="automation-choice">
              <span className="automation-label">Pausa tras regar</span>
              <Segmented
                label="Pausa tras regar"
                value={PAUSE.find((p) => Number(p.value) === draft.cooldownMinutes)?.value ?? '60'}
                options={PAUSE}
                onChange={(value) => {
                  edit({ cooldownMinutes: Number(value) });
                }}
              />
            </div>
          </div>
          <Toggle
            label="De noche no"
            description={
              draft.quiet
                ? `No riega de ${draft.quiet.from} a ${draft.quiet.to}.`
                : 'Puede regar a cualquier hora.'
            }
            checked={draft.quiet !== null}
            onChange={(on) => {
              edit({ quiet: on ? (rule.quiet ?? NIGHT) : null });
            }}
          />
          {draft.quiet && (
            <div className="settings-pair">
              <TextField
                label="Desde"
                type="time"
                value={draft.quiet.from}
                onChange={(event) => {
                  if (draft.quiet && event.target.value)
                    edit({ quiet: { ...draft.quiet, from: event.target.value } });
                }}
              />
              <TextField
                label="Hasta"
                type="time"
                value={draft.quiet.to}
                onChange={(event) => {
                  if (draft.quiet && event.target.value)
                    edit({ quiet: { ...draft.quiet, to: event.target.value } });
                }}
              />
            </div>
          )}
        </div>
      )}
      {blocker && (
        <p id={blockerId} className="settings-hint" data-tone="attention">
          {blocker}
        </p>
      )}
      <Button
        type="submit"
        variant="primary"
        disabled={!changed || blocker !== null || saving}
        aria-describedby={blocker ? blockerId : undefined}
      >
        Guardar
      </Button>
      <ConfigStatusLine />
    </form>
  );
}
