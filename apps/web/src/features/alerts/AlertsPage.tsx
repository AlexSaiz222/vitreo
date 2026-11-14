import { PUSH_TYPES, QUIET_HOURS } from '@vitreo/shared';
import type { Incident, PushType } from '@vitreo/shared';
import { useEffect } from 'react';

import { IN_DEMO } from '../../app/demo.ts';
import { useHub } from '../../data/hub.ts';
import {
  checkPush,
  disablePush,
  enablePush,
  loadIncidents,
  setPushTypes,
  testPush,
  usePush,
} from '../../data/push.ts';
import { hubDownText } from '../../ui/hubText.ts';
import { Button, Toggle } from '../../ui/primitives/index.ts';
import './alerts.css';

const TYPES: Record<PushType, { label: string; description: string }> = {
  tank: {
    label: 'Depósito',
    description: 'Queda poca agua, o está vacío (vacío suena también de noche).',
  },
  safety: {
    label: 'Límites de seguridad',
    description: 'Helada o demasiado calor dentro, límite de la bomba. Suenan también de noche.',
  },
  frost_forecast: {
    label: 'Previsión de helada',
    description: 'AEMET prevé helada esta noche: un aviso por la tarde, de 19:00 a 23:00.',
  },
  no_data: { label: 'Sin datos', description: '15 minutos sin lecturas del invernadero.' },
  thirsty: { label: 'Plantas con sed', description: 'Más de 3 horas con sed y sin regar.' },
};

const when = new Intl.DateTimeFormat('es-ES', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Ajustes › Avisos (A7, D91): notifications on this device. The permission is
 * asked only on "Activar avisos". Every type can be switched off; critical
 * ones ring in quiet hours. And the honest limit: the hub on the PC sends
 * them, so with the PC off or asleep, nothing arrives. In the demo (D110),
 * only the warnings themselves: there is no hub to send them to a phone.
 */
export function AlertsPage() {
  const store = usePush();
  const hubStatus = useHub((state) => state.status);
  const downSince = useHub((state) => state.downSince);
  const hubWhy = hubDownText(hubStatus, downSince, undefined);
  useEffect(() => {
    if (!IN_DEMO) void checkPush();
    if (hubStatus === 'up') void loadIncidents();
  }, [hubStatus]);

  return (
    <div className="settings-page alerts-page">
      {IN_DEMO && (
        <p className="settings-hint">
          En el invernadero real, el hub avisa al móvil. En la demo, los avisos se ven aquí y en la
          app.
        </p>
      )}
      {!IN_DEMO && (
        <>
          <p className="settings-hint" data-tone="attention">
            Los avisos los envía el hub del PC: con el PC apagado o dormido no llega ninguno. Al
            abrir la app, los avisos siguen ahí.
          </p>
          {hubWhy && hubStatus !== 'unknown' && (
            <p className="settings-hint" data-tone="attention">
              {hubWhy}: ahora mismo no se envían.
            </p>
          )}
          <PushSettings />
        </>
      )}

      <section className="settings-section" aria-labelledby="alerts-history">
        <h3 id="alerts-history" className="hud-label">
          Últimos avisos
        </h3>
        {store.incidents === null ? (
          <p className="settings-hint">{hubWhy ? 'Se verán cuando vuelva el hub.' : 'Cargando…'}</p>
        ) : store.incidents.length === 0 ? (
          <p className="settings-hint">Ninguno todavía.</p>
        ) : (
          <ul className="alerts-history">
            {store.incidents.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** This device's notifications: on or off, and which kinds (not in the demo, D110). */
function PushSettings() {
  const store = usePush();
  const toggle = (type: PushType, on: boolean) => {
    void setPushTypes(on ? [...store.types, type] : store.types.filter((t) => t !== type));
  };
  return (
    <>
      <section className="settings-section" aria-labelledby="alerts-device">
        <h3 id="alerts-device" className="hud-label">
          En este dispositivo
        </h3>
        {store.state === 'unsupported' && (
          <p className="settings-hint">
            Este navegador no puede recibir avisos. En el móvil, instala Vitreo en la pantalla de
            inicio y ábrelo desde allí.
          </p>
        )}
        {store.state === 'denied' && (
          <p className="settings-hint" data-tone="attention">
            Los avisos están bloqueados para Vitreo en este navegador. Permítelos en los ajustes del
            sitio (el candado junto a la dirección) y vuelve aquí.
          </p>
        )}
        {store.state === 'off' && (
          <Button variant="primary" disabled={store.busy} onClick={() => void enablePush()}>
            Activar avisos
          </Button>
        )}
        {store.state === 'on' && (
          <div className="alerts-actions">
            <p className="settings-hint">Avisos activados en este dispositivo.</p>
            <Button disabled={store.busy} onClick={() => void testPush()}>
              Probar aviso
            </Button>
            <Button disabled={store.busy} onClick={() => void disablePush()}>
              Desactivar avisos
            </Button>
          </div>
        )}
        <p className="settings-hint" role="status" data-tone={store.message?.tone}>
          {store.message?.text}
        </p>
      </section>

      <section className="settings-section" aria-labelledby="alerts-types">
        <h3 id="alerts-types" className="hud-label">
          Qué avisa
        </h3>
        <div className="alerts-types">
          {PUSH_TYPES.map((type) => (
            <Toggle
              key={type}
              label={TYPES[type].label}
              description={TYPES[type].description}
              checked={store.types.includes(type)}
              onChange={(on) => {
                toggle(type, on);
              }}
            />
          ))}
        </div>
        <p className="settings-hint">
          De {QUIET_HOURS.from} a {QUIET_HOURS.to} solo suenan los críticos (depósito vacío, límites
          de seguridad); el resto espera a la mañana, si sigue pasando. Un aviso por cada cosa, un
          recordatorio como mucho cada 4 horas, y "Resuelto" cuando se arregla.
        </p>
      </section>
    </>
  );
}

function IncidentRow({ incident }: { incident: Incident }) {
  const open = incident.resolvedAt === null;
  return (
    <li className="alerts-item" data-open={open} data-critical={incident.critical}>
      <span className="alerts-item-title">{incident.title}</span>
      <span className="alerts-item-body">{incident.body}</span>
      <span className="alerts-item-when">
        {when.format(incident.openedAt)} ·{' '}
        {open
          ? 'sigue abierto'
          : `resuelto ${when.format(incident.resolvedAt ?? incident.openedAt)}`}
        {incident.notifiedAt === null ? ' · sin enviar (horas de silencio)' : ''}
      </span>
    </li>
  );
}
