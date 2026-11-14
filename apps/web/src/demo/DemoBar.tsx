import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

import { chooseSpeed, useDemoSpeed } from '../data/demoClock.ts';
import { tryScenario } from '../data/demoScenarios.ts';
import {
  AttentionIcon,
  Button,
  CheckIcon,
  ChevronIcon,
  CloudIcon,
  DropIcon,
  HumidityIcon,
  ListRow,
  Segmented,
  Surface,
  ThermometerIcon,
} from '../ui/primitives/index.ts';
import { useClock } from '../ui/useClock.ts';
import type { DemoScenario, DemoSpeed } from './protocol.ts';
import './DemoBar.css';

const SPEEDS: readonly { value: `${DemoSpeed}`; label: string }[] = [
  { value: '60', label: 'Normal' },
  { value: '1440', label: 'Ver un día en un minuto' },
];
const PACE: Record<DemoSpeed, string> = { 60: 'una hora por minuto', 1440: 'un día por minuto' };

/** What a visitor can make happen (D111, D125); each one, in words that say what it shows. */
const SITUATIONS: readonly {
  name: DemoScenario;
  icon: ReactNode;
  title: string;
  detail: string;
}[] = [
  {
    name: 'rain',
    icon: <CloudIcon />,
    title: 'Lluvia',
    detail: 'Media hora de lluvia: la ventana se cierra sola',
  },
  {
    name: 'heat',
    icon: <ThermometerIcon />,
    title: 'Ola de calor',
    detail: '36 °C dentro: ventilación forzada y luz apagada',
  },
  {
    name: 'tank',
    icon: <DropIcon />,
    title: 'Depósito vacío',
    detail: 'La bomba no arranca en seco, y la app lo avisa',
  },
  {
    name: 'sensor',
    icon: <HumidityIcon />,
    title: 'Se rompe un sensor',
    detail: 'La albahaca se queda sin lectura: nunca se inventa',
  },
  {
    name: 'offline',
    icon: <AttentionIcon />,
    title: 'Sin conexión',
    detail: 'El invernadero deja de responder, y se ve',
  },
  {
    name: 'normal',
    icon: <CheckIcon />,
    title: 'Volver a la normalidad',
    detail: 'Se acaba todo lo anterior; las plantas siguen igual',
  },
];

const clock = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The demo, said plainly (D103, D112): "Demo · datos simulados", always
 * under the status line; its clock and its two speeds, an hour a minute
 * (on arrival) or "Ver un día en un minuto"; and "Probar situaciones",
 * what a visitor can make happen (D111: rain first). Only the label shows
 * until asked (D115; D124 on a phone, where the rest took a fifth of the
 * screen): the clock, the speeds and "Probar situaciones" open with a tap
 * on the label, or when the pointer or the keyboard comes to it.
 * The notebook is a round icon at the top right (NotebookButton). Built into the demo
 * only (App.tsx loads it lazily there).
 */
/** `live`: not while rewound, where nothing can be made to happen and time stands still. */
export default function DemoBar({ live }: { live: boolean }) {
  const [open, setOpen] = useState(false);
  const [unfolded, setUnfolded] = useState(false);
  const menuId = useId();
  const rowId = useId();
  const speed = useDemoSpeed((state) => state.speed);
  const now = useClock(live && speed !== null, 1000);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div className="demo-bar" data-hud-obstacle="">
      <p className="demo-label">
        {live ? (
          <button
            type="button"
            className="demo-label-name demo-label-toggle"
            aria-expanded={unfolded}
            aria-controls={rowId}
            onClick={() => {
              setUnfolded(!unfolded);
            }}
          >
            Demo · datos simulados
            <span className="demo-label-more" aria-hidden="true">
              <ChevronIcon />
            </span>
          </button>
        ) : (
          <span className="demo-label-name">Demo · datos simulados</span>
        )}
        {live && speed !== null && (
          <span className="demo-label-clock">
            {clock.format(now)} · {PACE[speed]}
          </span>
        )}
      </p>
      {live && (
        <div className="demo-bar-row" id={rowId}>
          {speed !== null && (
            <Segmented
              label="Velocidad de la demo"
              value={`${speed}` as const}
              options={SPEEDS}
              onChange={(value) => {
                chooseSpeed(Number(value) as DemoSpeed);
              }}
            />
          )}
          <Button
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => {
              setOpen(!open);
            }}
          >
            Probar situaciones
          </Button>
        </div>
      )}
      {live && open && (
        <Surface
          id={menuId}
          elevation="float"
          className="dock-menu demo-menu"
          role="group"
          aria-label="Probar situaciones"
        >
          <ul className="dock-menu-list">
            {SITUATIONS.map((situation) => (
              <li key={situation.name}>
                <ListRow
                  className="menu-row"
                  icon={situation.icon}
                  title={situation.title}
                  detail={situation.detail}
                  onClick={() => {
                    tryScenario(situation.name);
                    setOpen(false);
                  }}
                />
              </li>
            ))}
          </ul>
        </Surface>
      )}
    </div>
  );
}
