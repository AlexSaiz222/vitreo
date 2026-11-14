import { useEffect, useRef, useState } from 'react';

import { IN_DEMO } from '../app/demo.ts';
import { useHud } from '../app/hud.ts';
import { useSettings } from '../app/settings.ts';
import { useFreshness, useGreenhouse } from '../data/greenhouse.ts';
import { deviceKind, freshnessText } from './format.ts';
import { Button, MoistureDrop } from './primitives/index.ts';
import { useMediaQuery } from './useMediaQuery.ts';
import './Welcome.css';

const STEPS = 4;

/** Where the notebook's icon shows (D116): a computer with a mouse. */
const DESKTOP = '(min-width: 64rem) and (hover: hover) and (pointer: fine)';

function Step({ index }: { index: number }) {
  const desktop = useMediaQuery(DESKTOP);
  const freshness = useFreshness();
  const link = useGreenhouse((state) => state.link);
  const deviceId = useGreenhouse((state) => state.deviceId);
  const kind = deviceKind(useGreenhouse((state) => state.telemetry?.fw));
  switch (index) {
    case 0:
      return IN_DEMO ? (
        <>
          <h2 className="welcome-title">Vitreo</h2>
          <p className="welcome-text">
            Un invernadero pequeño de casa y su gemelo en la pantalla. Esto es una demo: el
            invernadero, su última semana y el tiempo de fuera son simulados, aquí, en tu navegador.
          </p>
          <p className="welcome-text welcome-soft">
            Nada sale de él y nada se guarda: al recargar, todo empieza de nuevo.
          </p>
        </>
      ) : (
        <>
          <h2 className="welcome-title">Vitreo</h2>
          <p className="welcome-text">
            Un invernadero pequeño de verdad y su gemelo en la pantalla: lo que ves es lo que pasa
            allí, ahora.
          </p>
        </>
      );
    case 1:
      return (
        <>
          <h2 className="welcome-title">Cómo leerlo</h2>
          <ul className="welcome-legend">
            <li>
              <MoistureDrop moisture={0.7} />
              <span>Gota llena, tierra oscura: húmeda.</span>
            </li>
            <li>
              <MoistureDrop moisture={0.12} thirsty />
              <span>Gota casi vacía y planta mustia: tiene sed.</span>
            </li>
            <li>
              <span className="welcome-mark" aria-hidden="true" />
              <span>Una marca cálida sobre una planta: algo pide atención.</span>
            </li>
            <li>
              <span className="welcome-asleep" aria-hidden="true" />
              <span>La escena gris: no llegan datos, y lo dice desde cuándo.</span>
            </li>
          </ul>
        </>
      );
    case 2:
      return (
        <>
          <h2 className="welcome-title">Tocar y mirar</h2>
          <p className="welcome-text">
            Toca una planta para verla y regarla. Arrastra para girar, pellizca para acercar; doble
            toque en un hueco para volver a la vista inicial.
          </p>
          <p className="welcome-text welcome-soft">
            Con teclado: Tab recorre las plantas, 1–6 abre una, L la luz, H la vista inicial y ? los
            atajos.
          </p>
        </>
      );
    default:
      return IN_DEMO ? (
        <>
          <h2 className="welcome-title">Qué probar</h2>
          <ul className="welcome-tries">
            <li>«Ver un día en un minuto»: amanecer, riegos, ventilación y noche.</li>
            <li>Rebobina la semana grabada: con lluvia, la ventana se quedó cerrada.</li>
            <li>«Probar situaciones › Lluvia», y mira qué hace el invernadero.</li>
            <li>Toca una planta para ver su tierra y regarla.</li>
            {desktop && (
              <li>
                El libro de arriba a la derecha: cómo se hizo, con las decisiones y las capturas.
              </li>
            )}
          </ul>
        </>
      ) : (
        <>
          <h2 className="welcome-title">Conexión</h2>
          <p className="welcome-text">
            {kind === 'simulator'
              ? 'Ahora mismo Vitreo muestra el simulador: datos de prueba, no un invernadero real.'
              : kind === 'device'
                ? `Vitreo sigue al invernadero «${deviceId}».`
                : 'Vitreo aún espera los primeros datos del invernadero.'}
          </p>
          <p className="welcome-status">{freshnessText(freshness, link)}</p>
        </>
      );
  }
}

/**
 * The welcome (docs/03 "Primera vez", A3): four short steps, shown once on
 * each device and again from Ajustes. In the demo (D112), what it is (all
 * simulated, nothing leaves the browser) and what to try. A native modal dialog: the page
 * behind is inert, Escape skips it, the focus comes back afterwards.
 */
export function Welcome() {
  const onboarded = useSettings((state) => state.onboarded);
  const setOnboarded = useSettings((state) => state.setOnboarded);
  const reopened = useHud((state) => state.panel === 'welcome');
  const setPanel = useHud((state) => state.setPanel);
  const open = !onboarded || reopened;
  const dialog = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const element = dialog.current;
    if (open && element && !element.open) {
      setStep(0);
      element.showModal();
      // The main action takes the focus (showModal would give it to Saltar).
      next.current?.focus();
    }
  }, [open]);

  // Seen, at once: the dialog's own close event comes a moment later, and a
  // reload in between must not show the welcome again.
  const seen = () => {
    setOnboarded(true);
    if (reopened) setPanel(null);
  };
  const finish = () => {
    seen();
    dialog.current?.close();
  };

  const last = step === STEPS - 1;
  return (
    <dialog
      ref={dialog}
      className="welcome"
      aria-labelledby="welcome-step"
      onCancel={seen}
      onClose={seen}
    >
      {open && (
        <>
          <div id="welcome-step" className="welcome-step">
            <Step index={step} />
          </div>
          <p className="welcome-progress">
            <span className="visually-hidden">{`Paso ${String(step + 1)} de ${String(STEPS)}`}</span>
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className="welcome-dot" data-current={i === step} aria-hidden="true" />
            ))}
          </p>
          <div className="welcome-actions">
            {last ? <span /> : <Button onClick={finish}>Saltar</Button>}
            <div className="welcome-nav">
              {step > 0 && (
                <Button
                  onClick={() => {
                    setStep(step - 1);
                  }}
                >
                  Atrás
                </Button>
              )}
              <Button
                variant="primary"
                ref={next}
                onClick={() => {
                  if (last) finish();
                  else setStep(step + 1);
                }}
              >
                {last ? 'Empezar' : 'Siguiente'}
              </Button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
