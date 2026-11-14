import type { Stop } from '../content.ts';

/** Stop 3: the fan, the roof window and the grow light (docs/05, docs/06; D30–D129). */
export const stop3: Stop = {
  number: 3,
  id: 'aire-y-luz',
  title: 'Aire y luz',
  subtitle: 'El ventilador, la ventana del tejado y la luz de cultivo',
  lead: (
    <p>
      Nada en la escena es decorado si representa algo. Si las aspas giran, es porque el ventilador
      de verdad está en marcha; si la ventana se abre, es porque el aparato dice que se ha abierto.
    </p>
  ),
  tryIt: <>Pulsa Aire y enciende el ventilador o abre la ventana; o toca Luz.</>,
  sections: [
    {
      id: 'cada-aparato-es-un-dato',
      title: 'Cada aparato es un dato',
      body: (
        <>
          <p>
            La ventana del tejado se abre como la de verdad, las aspas giran con el ventilador, la
            tira de la lámpara se enciende con la luz de cultivo y el agua del visor sube y baja con
            el depósito. La escena solo lee lo que el aparato informa: si el sensor del depósito no
            sabe cuánta agua hay, el visor no se dibuja.
          </p>
          <p>
            Cada orden lleva un identificador y el aparato confirma cada una. Mientras llega la
            respuesta, el control no parpadea ni se pone gris: solo dice «Enviando…» si tarda más de
            medio segundo. Y sin conexión, una orden falla al momento: nada se guarda para más
            tarde, porque una ventana que se abre horas después es peor que una que no se abre.
          </p>
        </>
      ),
      visual: {
        kind: 'clip',
        clip: 'aire',
        alt: 'Se abre el menú Aire sobre la escena: se enciende el ventilador, que pasa a «Apagar», y se elige «Abierta» en la ventana; en el tejado, la ventana se levanta.',
        caption: 'Aire: el ventilador y la ventana, en el menú y en la escena.',
      },
    },
    {
      id: 'la-luz-que-parpadeaba',
      title: 'La luz que parpadeaba',
      body: (
        <>
          <p>
            La luz de cultivo se enciende cuando falta luz. Al simular una semana entera, la lámpara
            parpadeaba entre 280 y 780 veces al día: el sensor de luz también la ve, así que
            encendida sumaba sus 4000 lux y la regla la apagaba, y apagada volvía a faltar luz.
          </p>
          <p>
            No era cosa del simulador: el sensor de verdad también la verá, y un relé así se gasta.
            Ahora el aparato mide cuánto añade la lámpara al encenderla y lo descuenta, con 15
            minutos como mínimo entre dos cambios: de 2778 cambios en la semana a 28.
          </p>
        </>
      ),
      visual: {
        kind: 'clip',
        clip: 'luz',
        alt: 'Al final de la tarde se pulsa Luz: la tira de la lámpara se enciende y las macetas y el suelo del invernadero se iluminan con una luz cálida.',
        caption: 'La luz de cultivo, a última hora de la tarde: su luz también está horneada.',
      },
    },
    {
      id: 'el-ventilador-y-el-frio',
      title: 'Un ventilador que no enfría de noche',
      body: (
        <>
          <p>
            El ventilador también ventila por humedad, y la misma semana simulada destapó que con
            frío se pasaba la noche encendido, enfriando más el invernadero. Ahora solo ventila por
            humedad con el aire a 10 °C o más: la noche más fría pasó de 4,9 °C a 5,9 °C. Por debajo
            de 5 °C, la ventana se cierra, porque en Madrid hiela en invierno.
          </p>
          <p>
            La hoja del invernadero lo enseña todo junto: dentro y fuera, la luz y el depósito, y
            franjas de cuándo estuvieron abiertos la ventana, el ventilador y la luz.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'invernadero',
        close: 'invernadero-cerca',
        alt: 'La hoja del invernadero junto a la escena: dentro 20,9 °C y 71 % de humedad, fuera 17,2 °C simulado, la luz en lux y el depósito al 72 %, una gráfica de temperatura de 24 horas y franjas de ventana, ventilador y luz.',
        caption: 'La hoja del invernadero: clima, depósito y cuándo funcionó cada aparato.',
      },
    },
    {
      id: 'el-aire-tambien-se-ve',
      title: 'El aire también se ve',
      body: (
        <p>
          Con la humedad muy alta, el cristal se empaña. De día flotan motas doradas según la luz
          que haya; de noche, unas pocas luciérnagas. Las hojas se mueven con el ventilador y con la
          ventana abierta. Acogedor, no un juego: cada efecto cuesta una sola llamada de dibujo,
          baja con la calidad y desaparece con «reducir movimiento».
        </p>
      ),
      visual: {
        kind: 'phones',
        shots: [
          {
            image: 'movil-escena',
            label: 'De día',
            alt: 'La demo en el móvil de día: el invernadero de cerca, con la cabecera, «Todo bien» y los botones redondos.',
          },
          {
            image: 'movil-noche',
            label: 'De noche',
            alt: 'La demo en el móvil de noche: el invernadero iluminado sobre fondo azul tinta, con alguna luciérnaga.',
          },
        ],
        caption: 'El mismo invernadero en el móvil, de día y de noche.',
      },
    },
  ],
  decisions: [
    { id: 'D62', text: 'Cada aparato conectado a su dato.' },
    { id: 'D30', text: 'Órdenes idempotentes: reintentar sin riesgo de hacerlo dos veces.' },
    { id: 'D31', text: 'Sin conexión, las órdenes fallan al momento: nada se encola.' },
    { id: 'D129', text: 'Controles sin fogonazos: «Enviando…» solo si tarda más de 0,6 s.' },
    { id: 'D105', text: 'La luz descuenta su propia lámpara; ventilador por humedad desde 10 °C.' },
    { id: 'D104', text: 'La semana se comprueba acelerada, como test.' },
    { id: 'D90', text: 'Protección contra heladas a 5 °C, constante del firmware.' },
    {
      id: 'D96',
      text: 'Atmósfera: condensación, motas, luciérnagas y viento, con su coste medido.',
    },
  ],
};
