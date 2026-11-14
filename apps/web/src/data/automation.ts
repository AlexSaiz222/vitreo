import { configState } from '@vitreo/shared';
import type { ConfigRules, ConfigState } from '@vitreo/shared';
import { create } from 'zustand';

import { greenhouseStore } from './greenhouse.ts';
import { hubGet, hubPut, useHub } from './hub.ts';

/**
 * The automations of `config` as the app sees them (A6, D89). A change goes
 * to the hub, which publishes a new revision; it only counts as active when
 * the greenhouse says so (`config.applied`), never before (D85: each change
 * shows its state, no undo).
 */
export type ConfigStatus =
  /** Sending it to the hub. */
  | 'saving'
  /** The hub has it; the greenhouse has not confirmed it (yet). */
  | 'pending'
  /** The greenhouse applies this revision. */
  | 'applied'
  /** The greenhouse refused it and keeps the previous one. */
  | 'rejected'
  /** The hub did not take it (down, or it refused the values). */
  | 'failed';

interface AutomationState {
  /** The hub's view: current config, what the device applied and refused. */
  state: ConfigState | null;
  saving: boolean;
  /** The last save failed: why, in words. */
  error: string | null;
}

export const useAutomation = create<AutomationState>()(() => ({
  state: null,
  saving: false,
  error: null,
}));

/** How a config state reads now. */
export function statusOf(store: AutomationState): ConfigStatus | null {
  if (store.saving) return 'saving';
  if (store.error) return 'failed';
  const state = store.state;
  if (!state) return null;
  if (state.rejected && state.rejected.rev >= state.config.rev) return 'rejected';
  if (state.appliedRev !== null && state.appliedRev >= state.config.rev) return 'applied';
  return 'pending';
}

/** Asks the hub for the current config and what the device confirmed. */
export async function loadAutomation(): Promise<boolean> {
  const result = await hubGet('/config', configState);
  if (result.ok) useAutomation.setState({ state: result.value });
  return result.ok;
}

let poll: ReturnType<typeof setInterval> | null = null;
const POLL_MS = 3_000;
const POLL_FOR_MS = 60_000;

/** While a revision waits for the device, ask the hub now and then too. */
function watchConfirmation(): void {
  if (poll) clearInterval(poll);
  const started = Date.now();
  poll = setInterval(() => {
    const status = statusOf(useAutomation.getState());
    if (status !== 'pending' || Date.now() - started > POLL_FOR_MS) {
      if (poll) clearInterval(poll);
      poll = null;
      return;
    }
    void loadAutomation();
  }, POLL_MS);
}

/**
 * Saves new rules: starts from the hub's current config (another phone may
 * have changed something), applies `change` to it, and sends it. Resolves
 * true when the hub has stored the new revision (not yet applied).
 */
export async function saveRules(change: (rules: ConfigRules) => ConfigRules): Promise<boolean> {
  useAutomation.setState({ saving: true, error: null });
  const fresh = await loadAutomation();
  const current = useAutomation.getState().state;
  if (!fresh || !current) {
    useAutomation.setState({
      saving: false,
      error: 'No se ha guardado: el hub no responde. Sigue como estaba.',
    });
    return false;
  }
  const { watering, light, ventilation } = current.config;
  const result = await hubPut('/config', configState, change({ watering, light, ventilation }));
  if (!result.ok) {
    useAutomation.setState({
      saving: false,
      error:
        result.reason === 'down'
          ? 'No se ha guardado: el hub no responde. Sigue como estaba.'
          : 'No se ha guardado: el hub no lo ha aceptado. Revisa los valores.',
    });
    return false;
  }
  useAutomation.setState({ saving: false, error: null, state: result.value });
  watchConfirmation();
  return true;
}

/** Forgets a failed save's message (the form changed again). */
export const clearAutomationError = (): void => {
  useAutomation.setState({ error: null });
};

/**
 * The greenhouse's own word, as soon as it arrives on the broker: a
 * `config.applied` or `config.rejected` event updates the state at once.
 */
export function startAutomationWatch(): () => void {
  // Whenever the hub answers (again), what the automations are.
  if (useHub.getState().status === 'up') void loadAutomation();
  const stopHub = useHub.subscribe((state, previous) => {
    if (state.status === 'up' && previous.status !== 'up') void loadAutomation();
  });
  const stopEvents = greenhouseStore.subscribe((store, previous) => {
    if (store.events === previous.events) return;
    // Events arrive one at a time: the newest is the new one.
    const event = store.events.at(-1);
    const current = useAutomation.getState().state;
    if (!event || !current) return;
    if (event.type === 'config.applied' && event.rev > (current.appliedRev ?? 0)) {
      const rejected =
        current.rejected && current.rejected.rev > event.rev ? current.rejected : null;
      useAutomation.setState({ state: { ...current, appliedRev: event.rev, rejected } });
    } else if (event.type === 'config.rejected' && event.rev !== undefined) {
      useAutomation.setState({
        state: { ...current, rejected: { rev: event.rev, reason: event.reason } },
      });
    }
  });
  return () => {
    stopHub();
    stopEvents();
  };
}
