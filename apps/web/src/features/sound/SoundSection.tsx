import { useSettings } from '../../app/settings.ts';
import { Slider, Toggle } from '../../ui/primitives/index.ts';
import { useSound } from './ambient.ts';
import type { SoundStatus } from './ambient.ts';

const STATUS: Record<SoundStatus, string> = {
  off: 'Apagado. Pájaros de día, grillos de noche, la lluvia si llueve, el ventilador y el agua cuando funcionan.',
  loading: 'Cargando los sonidos…',
  'waiting-tap': 'Toca la pantalla para que empiece a sonar.',
  playing: 'Suena lo que pasa en el invernadero.',
  failed: 'No se han podido cargar los sonidos. Apágalo y vuelve a probar.',
};

const percent = (value: number) =>
  `${Math.round(value * 100).toString()}${String.fromCharCode(0xa0)}%`;

/**
 * Ajustes › Sonido (A9, D96): off by default. Since D131 three switches of
 * their own (the ambient, the devices, the touches), so turning the ambient
 * off keeps the others; one volume for all, once any of them is on.
 */
export function SoundSection() {
  const sound = useSettings((state) => state.sound);
  const volume = useSettings((state) => state.volume);
  const setSound = useSettings((state) => state.setSound);
  const setVolume = useSettings((state) => state.setVolume);
  const deviceSounds = useSettings((state) => state.deviceSounds);
  const setDeviceSounds = useSettings((state) => state.setDeviceSounds);
  const touchSounds = useSettings((state) => state.touchSounds);
  const setTouchSounds = useSettings((state) => state.setTouchSounds);
  const status = useSound((state) => state.status);
  return (
    <section className="settings-section" aria-labelledby="settings-sound">
      <h3 id="settings-sound" className="hud-label">
        Sonido
      </h3>
      <Toggle
        label="Sonido ambiente"
        description={STATUS[sound ? status : 'off']}
        checked={sound}
        onChange={setSound}
      />
      <Toggle
        label="Sonidos de los aparatos"
        description="La bomba, el interruptor de la luz, el ventilador y la ventana, solo cuando cambian de verdad. Con o sin el ambiente."
        checked={deviceSounds}
        onChange={setDeviceSounds}
      />
      <Toggle
        label="Sonidos al tocar"
        description="Una tecla suave al pasar por los botones y pulsarlos, y al abrir o cerrar un panel. Con o sin el ambiente."
        checked={touchSounds}
        onChange={setTouchSounds}
      />
      <Slider
        label="Volumen"
        value={volume}
        min={0}
        max={1}
        step={0.05}
        format={percent}
        disabled={!sound && !deviceSounds && !touchSounds}
        onChange={setVolume}
      />
      <p className="settings-hint">
        Solo suena con la app abierta. Ambiente: grabaciones de dominio público (CC0). Aparatos,
        goteo del canalón y toques: sintetizados aquí, sin grabaciones.
      </p>
    </section>
  );
}
