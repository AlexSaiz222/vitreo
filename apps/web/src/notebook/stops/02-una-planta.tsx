import type { Stop } from '../content.ts';

/** Stop 2: one plant, its sheet, its watering and its limits (docs/03, docs/06; D15–D128). */
export const stop2: Stop = {
  number: 2,
  id: 'una-planta',
  title: 'Una planta',
  subtitle: 'Tocarla para saber cómo está, y regarla',
  lead: (
    <p>
      Cada maceta tiene su sensor de humedad. La planta lo dice antes que la cifra: la tierra se
      aclara al secarse, se oscurece al regarla, y las hojas bajan poco a poco cuando tiene sed.
    </p>
  ),
  tryIt: <>Toca la albahaca en la escena, o pulsa Regar y elige una planta.</>,
  sections: [
    {
      id: 'la-ficha',
      title: 'La ficha',
      body: (
        <>
          <p>
            Al tocar una planta, la cámara va hasta ella y su ficha se abre al lado, sin taparla: la
            humedad de la tierra en un dial, el punto en el que pide agua y un riego de 3, 5 o 10
            segundos. En el móvil la ficha sube desde abajo y deja la planta a la vista.
          </p>
          <p>
            Cada planta tiene un solo umbral, el de su riego, y lo usan a la vez la escena, los
            avisos, la gráfica y el riego automático. Dentro de la escena, cada planta tiene una
            zona táctil invisible de al menos 44 px que distingue un toque de un arrastre de la
            cámara.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'ficha',
        close: 'ficha-cerca',
        alt: 'La demo con la ficha de la albahaca abierta a la derecha: dial con un 47 % de tierra, «Está bien», pide agua por debajo del 40 %, los botones 3 s, 5 s y 10 s, «Regar ahora» y el último riego; a la izquierda, el invernadero con la albahaca resaltada.',
        caption: 'La ficha de la albahaca: humedad, umbral y riego.',
      },
    },
    {
      id: 'regar-y-poder-parar',
      title: 'Regar, y poder parar',
      body: (
        <>
          <p>
            El riego empieza al tocar, sin confirmaciones, y mientras dura se puede detener: parar
            es el deshacer honesto de una acción física. El agua sube a lo largo del botón con su
            cuenta atrás y termina en «Regada».
          </p>
          <p>
            La demo corre a una hora por minuto, así que un riego de 5 segundos duraría 80
            milisegundos. En pantalla dura sus 5 segundos de verdad; en casa manda el reloj del
            aparato.
          </p>
        </>
      ),
      visual: {
        kind: 'clip',
        clip: 'riego',
        alt: 'Se pulsa «Regar ahora» en la ficha de la albahaca: el botón pasa a «Regando · 4 s» con «Detener» al lado, el dial sube del 47 al 63 % y termina en «Regada».',
        caption: 'Un riego de 5 segundos, de principio a fin.',
      },
    },
    {
      id: 'que-se-riegue-sola',
      title: 'Que se riegue sola',
      body: (
        <>
          <p>
            El riego por umbral lo aplica el propio aparato con la configuración que le manda el
            hub, así que el invernadero de verdad seguirá regando con el PC apagado. Cada planta
            dice cuánto riega, cuántas veces al día como mucho, qué pausa deja entre riegos y si
            puede regar de noche.
          </p>
          <p>
            Probándolo salió un detalle: la albahaca pasaba nueve horas de noche por debajo de su
            umbral, esperando a las 08:00. Ahora, media hora antes de las noches tranquilas, se
            riega la maceta que cruzaría el umbral antes de la mañana al ritmo al que seca.
          </p>
        </>
      ),
      visual: {
        kind: 'phones',
        shots: [
          {
            image: 'movil-ficha',
            label: 'La ficha',
            alt: 'La ficha de la albahaca en el móvil, subida desde abajo: dial con un 48 %, los botones de duración y «Regar ahora»; arriba, la maceta en la escena.',
          },
          {
            image: 'movil-riego-auto',
            label: 'Regar sola',
            alt: 'El riego automático de la albahaca en el móvil: pide agua por debajo del 40 %, «Regar sola» activado, 5 s cada riego, como mucho 2 veces al día, 1 h de pausa, de noche no.',
          },
        ],
        caption: 'En el móvil: la ficha, y su riego automático más abajo.',
      },
    },
    {
      id: 'lo-que-no-se-sabe',
      title: 'Lo que no se sabe, no se inventa',
      body: (
        <>
          <p>
            Si un sensor deja de responder, la planta no se queda con su último valor: el dial dice
            «Sin dato», la cabecera dice qué sensor falla y la escena no le pinta una tierra que no
            conoce. Un dato desconocido nunca se enseña como un cero.
          </p>
          <p>
            Es otra de las situaciones de la demo, «Se rompe un sensor», que sale del mismo
            simulador que uso en casa.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'sensor-roto',
        close: 'sensor-roto-cerca',
        alt: 'La ficha de la albahaca con el sensor roto: el dial vacío con «Sin dato», «Sin lectura de humedad», y en la cabecera «El sensor de la albahaca no responde».',
        caption: 'Un sensor roto: sin dato, nunca inventado.',
      },
    },
    {
      id: 'limites-que-mandan',
      title: 'Límites que siempre mandan',
      body: (
        <>
          <p>
            Los límites de seguridad viven en el aparato, no en la app: un fallo de red no puede
            inundar ni cocer las plantas. Si no se sabe cuánta agua queda o el depósito está vacío,
            la bomba no arranca; a 35 °C salta la protección por calor; si se pierde la conexión, la
            bomba se para.
          </p>
          <p>
            Cuando uno de ellos impide algo, la app lo nombra y dice hasta cuándo, y la cabecera no
            dice «Todo bien» mientras haya uno activo.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'deposito-vacio',
        alt: 'La demo con el depósito vacío: la cabecera dice «El depósito está vacío», un aviso «El depósito está vacío: no se puede regar» y sobre los botones «Depósito vacío».',
        caption: 'Con el depósito vacío, la bomba no arranca en seco, y se dice.',
      },
    },
  ],
  decisions: [
    { id: 'D41', text: 'Más contraste entre tierra seca y húmeda, para que se lea de lejos.' },
    { id: 'D45', text: 'Riego de 3, 5 o 10 s; la cámara deja la planta junto a su ficha.' },
    { id: 'D83', text: 'Zonas táctiles en la escena; marcas que no se solapan.' },
    { id: 'D84', text: 'Detener en vez de deshacer el riego.' },
    { id: 'D100', text: 'Un solo umbral por planta.' },
    { id: 'D128', text: 'En la demo, «Regar ahora» dura sus segundos de verdad.' },
    { id: 'D89', text: 'Automatizaciones en el aparato; el hub es dueño de la configuración.' },
    { id: 'D106', text: 'Riego de tarde: ninguna maceta pasa la noche bajo el umbral.' },
    { id: 'D62', text: 'Un nivel desconocido no se dibuja como vacío.' },
    { id: 'D15', text: 'Los límites de riego y temperatura viven en el firmware.' },
    { id: 'D32', text: 'Los límites que aplica el simulador y debe copiar el firmware.' },
    { id: 'D85', text: 'Los límites de seguridad se nombran, con su hora de vuelta.' },
    {
      id: 'D125',
      text: '«Probar situaciones» completo; la cabecera no miente con un límite activo.',
    },
  ],
};
