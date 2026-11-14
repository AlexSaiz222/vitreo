import { useState } from 'react';

import { dismiss, undo, useUndo } from '../app/undo.ts';
import { getCommands } from '../data/greenhouse.ts';
import { alertSentence, useAlerts } from './alerts.ts';
import { useFailures } from './failures.ts';
import { useZones } from './useZones.ts';
import { Toast, ToastStack, UndoIcon } from './primitives/index.ts';

/** More than this and the rest fold into one line. */
const MAX_TOASTS = 3;

/**
 * Notices under the header (docs/03, A2, D85): orders that failed (refused,
 * never answered, or not sent), "Deshacer" for destructive actions (none
 * yet), then the warnings about the whole greenhouse (the tank, a sensor of
 * the air or the light). Successful toggles say nothing. Plant warnings live on the plants; the
 * connection is in the status line and the dock. Critical ones stay until
 * they are solved; the rest can be closed, and come back only if they go
 * away and happen again. Never modal; they never cover the header (they sit
 * below it) or the dock.
 */
export function AlertStack() {
  const offers = useUndo((state) => state.offers);
  const failures = useFailures();
  const zones = useZones();
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const alerts = useAlerts().filter(
    (alert) => !alert.zone && alert.kind !== 'disconnected' && alert.kind !== 'stale',
  );
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  // Forget what was closed once it is over, so it can be said again.
  const active = new Set(alerts.map((alert) => alert.id));
  const stillClosed = [...closed].filter((id) => active.has(id));
  if (stillClosed.length !== closed.size) setClosed(new Set(stillClosed));

  const notices = [
    ...failures
      .filter((f) => !dismissed.has(f.requestId))
      .map((f) => (
        <Toast
          key={`failed-${f.requestId}`}
          tone="attention"
          {...(f.retry
            ? {
                action: {
                  label: 'Reintentar',
                  onAction: () => {
                    void getCommands()?.retry(f.requestId);
                  },
                },
              }
            : {})}
          onDismiss={() => {
            setDismissed(new Set([...dismissed, f.requestId]));
          }}
        >
          {f.message}
        </Toast>
      )),
    ...[...offers].reverse().map((offer) => (
      <Toast
        key={`undo-${offer.id.toString()}`}
        action={{
          label: 'Deshacer',
          icon: <UndoIcon />,
          onAction: () => {
            undo(offer.id);
          },
        }}
        onDismiss={() => {
          dismiss(offer.id);
        }}
      >
        {offer.message}
      </Toast>
    )),
    ...alerts
      .filter((alert) => !closed.has(alert.id))
      .map((alert) => (
        <Toast
          key={alert.id}
          tone="attention"
          important={alert.severity === 'critical'}
          {...(alert.severity === 'critical'
            ? {}
            : {
                onDismiss: () => {
                  setClosed(new Set([...closed, alert.id]));
                },
              })}
        >
          {alertSentence(alert, zones)}
        </Toast>
      )),
  ];
  const hidden = notices.length - MAX_TOASTS;

  return (
    <ToastStack>
      {notices.slice(0, MAX_TOASTS)}
      {hidden > 0 && (
        <p className="alert-more">
          {hidden === 1 ? 'Y 1 aviso más' : `Y ${hidden.toString()} avisos más`}
        </p>
      )}
    </ToastStack>
  );
}
