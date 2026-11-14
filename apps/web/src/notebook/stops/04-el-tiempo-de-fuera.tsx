import type { Stop } from '../content.ts';

/** Stop 4: the weather outside, its rules and how the scene shows it (docs/05; D90–D122). */
export const stop4: Stop = {
  number: 4,
  id: 'el-tiempo-de-fuera',
  title: 'El tiempo de fuera',
  subtitle: 'Lluvia, viento y heladas, y lo que hace el invernadero con ellos',
  lead: (
    <p>
      El invernadero no vive aislado: si llueve, la ventana del tejado no debe quedarse abierta. En
      casa, el hub pregunta a AEMET; en la demo, el cielo es simulado y lo dice. Las reglas que
      deciden son las mismas.
    </p>
  ),
  tryIt: <>Abre «Demo · datos simulados» › Probar situaciones › Lluvia.</>,
  sections: [
    {
      id: 'aemet-y-un-cielo-simulado',
      title: 'AEMET en casa, un cielo simulado en la demo',
      body: (
        <>
          <p>
            El hub de casa pide a AEMET la observación de la estación más cercana cada diez minutos
            y la previsión cada hora. Con eso aplica sus reglas: con lluvia, nieve o viento fuerte,
            la ventana se queda cerrada y ventila solo el ventilador; si se prevé helada, avisa por
            la tarde.
          </p>
          <p>
            En la demo no hay AEMET: el tiempo es un cielo simulado de finales de octubre en Madrid,
            nunca atribuido a nadie, y la cabecera lo dice en cada momento: «17° fuera · simulado».
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'tiempo',
        close: 'tiempo-cerca',
        alt: 'Ajustes › Tiempo exterior en la demo, con lluvia: 16 °C, nuboso con lluvia escasa, 0,5 mm en la última hora, viento de 14 km/h, la estación «Simulado» y la fuente «simulado, no observado».',
        caption: 'Tiempo exterior: simulado, y dicho así.',
      },
    },
    {
      id: 'la-ventana-se-cierra-sola',
      title: 'Con lluvia, la ventana se cierra sola',
      body: (
        <>
          <p>
            El hub no cierra la ventana él mismo: le pide al aparato que la mantenga cerrada un rato
            y lo renueva mientras llueva. Así no se pelea con la ventilación del aparato, la
            protección por calor sigue mandando y abrirla a mano se respeta.
          </p>
          <p>
            En el menú Aire se lee el motivo: «Cerrada mientras llueva fuera: ventila solo el
            ventilador».
          </p>
        </>
      ),
      visual: {
        kind: 'clip',
        clip: 'lluvia',
        alt: 'El invernadero con la ventana del tejado abierta; empieza a llover, la ventana se cierra en un momento y caen trazos finos de lluvia alrededor.',
        caption:
          '«Probar situaciones › Lluvia»: la ventana se cierra en cuanto el hub ve la lluvia.',
      },
    },
    {
      id: 'la-lluvia-de-cerca',
      title: 'La lluvia, de cerca',
      body: (
        <>
          <p>
            La primera lluvia se veía barata: puntos iguales y un velo por encima. La rehíce por
            capas. En el cristal, gotas que la app genera al arrancar (no descarga nada) y que
            resbalan abriendo surcos en el vaho. Fuera, lluvia a tres profundidades que se inclina
            con el viento, salpica donde cae y gotea del canalón.
          </p>
          <p>
            Y el suelo se moja y se seca según la lluvia medida en las últimas horas, nunca a ojo.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'lluvia-cerca',
        alt: 'El invernadero de cerca durante un chubasco: gotas pequeñas en los cristales, trazos de lluvia fuera y el zócalo oscurecido por el agua.',
        caption: 'Media hora de chubasco: gotas en el cristal y el zócalo mojado.',
      },
    },
    {
      id: 'nieve-y-niebla',
      title: 'Nieve, niebla y helada',
      body: (
        <p>
          La nieve resbala por el cristal y se amontona contra la barra de cada paño, como en un
          invernadero de verdad; el viento la apila contra la base de las paredes, y cubre el
          zócalo, el camino y la perfilería; de noche la luna la mantiene clara. La niebla está
          dentro de la escena, no pintada encima. Con helada prevista, el hub avisa; y por debajo de
          5 °C el propio aparato cierra la ventana, aunque el hub no responda.
        </p>
      ),
      visual: {
        kind: 'image',
        image: 'c7-nieve-noche',
        alt: 'El invernadero de noche con la luz de cultivo encendida y copos cayendo: la nieve se amontona en la parte baja de cada paño del tejado, contra la barra, y cubre el zócalo, el camino y los escalones.',
        caption:
          'Nieve de noche, contra las barras del tejado y sobre el zócalo (en la demo no nieva).',
      },
    },
  ],
  decisions: [
    {
      id: 'D97',
      text: 'AEMET solo desde el hub; ventana cerrada con lluvia mediante una retención.',
    },
    {
      id: 'D111',
      text: 'Cielo simulado, nunca atribuido a AEMET, con las reglas de verdad del hub.',
    },
    { id: 'D118', text: 'Cristal mojado con gotas que resbalan y abren el vaho.' },
    { id: 'D119', text: 'Lluvia con profundidad, salpicaduras y goteo del canalón.' },
    { id: 'D120', text: 'El suelo se moja y se seca según la lluvia medida.' },
    { id: 'D127', text: 'La lluvia que cae, con un color propio de día.' },
    { id: 'D122', text: 'Nieve que se posa y niebla dentro de la escena.' },
    {
      id: 'D136',
      text: 'La nieve, contra las barras del tejado y sobre todo lo que mira arriba.',
    },
    { id: 'D90', text: 'Protección contra heladas a 5 °C, en el firmware.' },
  ],
};
