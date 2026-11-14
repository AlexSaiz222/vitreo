import type { Stop } from '../content.ts';

/** Stop 6: the sound (docs/02; D96–D131). */
export const stop6: Stop = {
  number: 6,
  id: 'el-sonido',
  title: 'El sonido',
  subtitle: 'Un ambiente que sigue al invernadero',
  lead: (
    <p>
      Con el sonido encendido se oye lo que pasa: pájaros de día, grillos de noche, la lluvia si
      llueve, el ventilador y el agua cuando funcionan. Empieza apagado: nadie oye nada que no haya
      pedido.
    </p>
  ),
  tryIt: <>Enciéndelo con el botón Sonido de este cuaderno, o en Ajustes › Sonido.</>,
  sections: [
    {
      id: 'un-ambiente-que-no-se-repite',
      title: 'Un ambiente que no se repite',
      body: (
        <>
          <p>
            Todo son grabaciones de dominio público (CC0). Cada capa suena con dos voces que
            recorren su bucle a trozos desde puntos al azar, con fundidos largos, así que el fondo
            nunca se oye repetido. La lluvia tiene tres intensidades que se funden según la lluvia
            medida, un mirlo canta de vez en cuando, y el canalón gotea solo cuando ha parado y el
            suelo sigue mojado.
          </p>
          <p>
            El cristal es un filtro: con la ventana cerrada, lo de fuera llega más apagado; al
            abrirla, se abre también el sonido.
          </p>
        </>
      ),
    },
    {
      id: 'aparatos-que-suenan-cuando-cambian',
      title: 'Aparatos que suenan cuando cambian de verdad',
      body: (
        <p>
          La bomba que arranca y para, el clic del relé de la luz, el ventilador al acelerar y el
          servo de la ventana están sintetizados en el propio navegador. Solo suenan cuando los
          datos dicen que el aparato ha cambiado: nunca con datos viejos, al rebobinar ni por la
          primera lectura. Al pulsar Luz o el ventilador se oye además un interruptor de pared, y
          después el aparato responde.
        </p>
      ),
    },
    {
      id: 'toques-como-una-tecla',
      title: 'Toques como una tecla suave',
      body: (
        <>
          <p>
            Pasar el ratón por un botón o pulsarlo suena como una tecla suave, sintetizada en la
            escala pentatónica. Su volumen no se eligió de oído sino midiendo: al pulsar, unos 30 dB
            por encima del ambiente de día en sus primeros 10 milisegundos, para que nunca quede
            tapado.
          </p>
          <p>Ambiente, aparatos y toques tienen cada uno su interruptor, y un volumen común.</p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'sonido',
        close: 'sonido-cerca',
        alt: 'Ajustes › Sonido en la demo: tres interruptores encendidos (Sonido ambiente, Sonidos de los aparatos, Sonidos al tocar) con lo que suena en cada uno, el volumen al 60 % y una nota sobre las grabaciones CC0.',
        caption: 'Ajustes › Sonido: tres interruptores y un volumen.',
      },
    },
  ],
  decisions: [
    { id: 'D96', text: 'Sonido ambiente apagado por defecto, con licencias CC0.' },
    { id: 'D114', text: 'Motor a 48 kHz: dos voces por capa y el cristal como filtro.' },
    { id: 'D123', text: 'Lluvia en tres intensidades, un mirlo suelto y goteo del canalón.' },
    { id: 'D121', text: 'Los aparatos suenan solo cuando los datos dicen que cambiaron.' },
    { id: 'D128', text: 'Sonidos al tocar, sintetizados en la pentatónica.' },
    { id: 'D129', text: 'Toques como una tecla suave, medidos contra el ambiente.' },
    { id: 'D131', text: 'Más altos, y un interruptor para cada tipo de sonido.' },
  ],
};
