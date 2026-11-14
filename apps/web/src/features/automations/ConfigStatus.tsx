import { statusOf, useAutomation } from '../../data/automation.ts';
import { CheckIcon } from '../../ui/primitives/index.ts';
import { statusText } from './explain.ts';

/**
 * The state of the automations' config, in words (A6, D85, D89): "Guardando…",
 * then "Aplicado en el invernadero" when the device confirms, or a calm
 * "Pendiente…" while it has not. A refusal or a failed save in the warm tone.
 */
export function ConfigStatusLine() {
  const store = useAutomation();
  const status = statusOf(store);
  const text =
    status === 'failed' ? store.error : statusText(status, store.state?.rejected?.reason ?? null);
  const tone = status === 'rejected' || status === 'failed' ? 'attention' : status;
  return (
    <p className="settings-hint config-status" role="status" data-tone={tone ?? undefined}>
      {status === 'applied' && <CheckIcon />}
      {text}
    </p>
  );
}
