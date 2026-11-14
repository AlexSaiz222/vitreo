import type { Stop } from '../content.ts';

/** Stop 5: the hub, the history, rewinding and the journal (docs/05; D74–D129). */
export const stop5: Stop = {
  number: 5,
  id: 'la-memoria',
  title: 'La memoria',
  subtitle: 'Historial, rebobinar y un diario por planta',
  lead: (
    <p>
      Un pequeño servidor en casa lo recuerda todo: lo que dijo el invernadero, lo que hizo y por
      qué. En la demo es el mismo código, dentro de tu navegador, con un mes ya vivido.
    </p>
  ),
  tryIt: (
    <>
      Pulsa el reloj de arriba a la derecha para rebobinar, o abre una planta y baja hasta su
      historial.
    </>
  ),
  sections: [
    {
      id: 'un-hub-en-casa',
      title: 'Un hub en casa, y el mismo en tu navegador',
      body: (
        <>
          <p>
            El hub es un servidor Fastify con SQLite, en Docker: escucha todo lo que dice el
            invernadero, lo guarda y es el dueño de su configuración. Las lecturas en bruto se
            guardan 30 días; los resúmenes por hora, los riegos y las órdenes, para siempre. Ningún
            puerto se abre a la red de casa.
          </p>
          <p>
            Para la demo no escribí otro hub: separé sus piezas portátiles de las que necesitan Node
            y la demo monta el código del hub de verdad sobre SQLite compilado a WebAssembly, en un
            Web Worker. Un test hace las mismas peticiones por los dos caminos y exige respuestas
            idénticas byte a byte. Lo que solo tiene sentido en casa (avisos al móvil, descargas,
            fotos) se esconde en vez de fingirse.
          </p>
        </>
      ),
    },
    {
      id: 'los-huecos-como-huecos',
      title: 'Una gráfica con los huecos como huecos',
      body: (
        <>
          <p>
            La ficha de cada planta tiene su gráfica de 24 horas, 7 días o 30 días, dibujada a mano
            en SVG: una línea azul agua que se vuelve cálida bajo el umbral, sus riegos y sus notas
            debajo, y los huecos como huecos, nunca rellenados.
          </p>
          <p>
            La demo llega con un mes grabado con el mismo simulador: los últimos siete días lectura
            a lectura y el resto en los resúmenes por hora del propio hub, con el depósito rellenado
            cada semana, como haría yo.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'grafica',
        close: 'grafica-cerca',
        alt: 'La ficha de la albahaca en su historial de 30 días: una línea de humedad que oscila alrededor del 50 % del 13 de octubre a ahora, la franja del umbral, los riegos automáticos como puntos y dos notas.',
        caption: 'Treinta días de la albahaca: humedad, umbral, riegos y notas.',
      },
    },
    {
      id: 'rebobinar',
      title: 'Rebobinar',
      body: (
        <p>
          Todo el invernadero se puede rebobinar: una barra ocupa el sitio de los botones y la
          escena vuelve a ese momento, con su luz del día o de la noche, sus plantas y sus aparatos.
          Donde no hubo datos se ve dormida. Desde el pasado no se puede dar ninguna orden.
        </p>
      ),
      visual: {
        kind: 'clip',
        clip: 'rebobinar',
        alt: 'La barra de rebobinar sobre la escena: la línea de tiempo retrocede del jueves al martes, la cabecera dice «Así estaba…» con cada fecha y la página pasa de día a noche con el momento.',
        caption: 'Dos días y medio hacia atrás: la escena es la de cada momento.',
      },
    },
    {
      id: 'un-dia-en-un-minuto',
      title: 'Un día en un minuto',
      body: (
        <p>
          La demo tiene su propio reloj: una hora por minuto al llegar, o un día por minuto si
          quieres verlo pasar. El aparato simulado, el hub y el cielo avanzan juntos, y el sol, la
          noche y el historial los siguen. El día y la noche, aquí y en casa, siguen al sol de
          verdad donde está el invernadero.
        </p>
      ),
      visual: {
        kind: 'clip',
        clip: 'dia-en-un-minuto',
        alt: 'Se elige «Ver un día en un minuto» al final de la tarde: el sol se pone, la página pasa a azul tinta y el invernadero queda iluminado por la luz de cultivo.',
        caption: '«Ver un día en un minuto», de la tarde a la noche.',
      },
    },
    {
      id: 'un-diario-por-planta',
      title: 'Un diario por planta',
      body: (
        <>
          <p>
            Cada planta tiene su diario: mis notas y fotos junto a lo que el invernadero hizo por
            ella (riegos, avisos, cambios en su riego), por días, para que se lea como su historia.
            Las fotos pierden su ubicación antes de salir del móvil y se guardan solo en casa; por
            eso la demo no tiene fotos, y sus notas empiezan por «Ejemplo».
          </p>
          <p>
            Los avisos llegan al móvil uno por incidente, con un recordatorio como mucho cada cuatro
            horas, y de 23:00 a 08:00 solo suenan los críticos.
          </p>
        </>
      ),
      visual: {
        kind: 'phones',
        shots: [
          {
            image: 'movil-diario',
            label: 'El diario',
            alt: 'El diario de la albahaca en el móvil: etiquetas (Regada a mano, Siembra, Trasplante, Poda, Cosecha, Plaga, Hoja amarilla), un campo de nota y la primera nota de ejemplo de ayer.',
          },
        ],
        caption: 'El diario de la albahaca, con sus etiquetas.',
      },
    },
  ],
  decisions: [
    { id: 'D87', text: 'Hub con SQLite en un volumen de Docker, dueño de la configuración.' },
    { id: 'D77', text: 'Bruto 30 días; resúmenes por hora, eventos y órdenes para siempre.' },
    { id: 'D74', text: 'Todos los puertos de los contenedores, solo en 127.0.0.1.' },
    { id: 'D109', text: 'El hub de la demo es el código del hub sobre sql.js.' },
    { id: 'D110', text: 'En la demo se esconde lo que solo tiene sentido con el hub de casa.' },
    { id: 'D88', text: 'Gráfica propia con los huecos como huecos; rebobinar sin órdenes.' },
    { id: 'D129', text: 'Un mes grabado: 7 días en bruto y resúmenes por hora.' },
    { id: 'D112', text: 'La demo con su propio reloj: una hora o un día por minuto.' },
    { id: 'D42', text: 'Día y noche según el sol en la ubicación del invernadero.' },
    { id: 'D93', text: 'Diario con notas y fotos sin ubicación, guardadas solo en casa.' },
    { id: 'D91', text: 'Un aviso por incidente, recordatorio cada 4 h, silencio de noche.' },
  ],
};
