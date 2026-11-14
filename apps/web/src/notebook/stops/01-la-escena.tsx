import type { Stop } from '../content.ts';
import { Swatches } from '../Swatches.tsx';

/** Stop 1: the scene (docs/01, docs/02, docs/04; D04–D69). */
export const stop1: Stop = {
  number: 1,
  id: 'la-escena',
  title: 'La escena',
  subtitle: 'Un diorama que se lee de un vistazo',
  lead: (
    <p>
      Abrir Vitreo tenía que ser como asomarse a una ventana con plantas: en menos de dos segundos
      sabes si todo va bien. Por eso lo primero que ves no es un panel de control, sino el
      invernadero.
    </p>
  ),
  tryIt: <>Gira el invernadero arrastrándolo y acércate con la rueda o con dos dedos.</>,
  sections: [
    {
      id: 'el-3d-es-la-interfaz',
      title: 'El 3D es la interfaz',
      body: (
        <>
          <p>
            Los datos se leen primero en la escena y después, si quieres, en números: la tierra se
            oscurece al regarla, las hojas bajan cuando una planta tiene sed, la ventana del tejado
            está abierta o cerrada como la de verdad. Nada de gráficos por todas partes ni alarmas
            rojas.
          </p>
          <p>
            Cada elemento en pantalla tiene que ganarse su sitio. Lo demás aparece cuando lo pides:
            al tocar una planta, al abrir un menú o al pasar el ratón.
          </p>
        </>
      ),
    },
    {
      id: 'una-camara-de-ilustracion',
      title: 'Una cámara de ilustración',
      body: (
        <>
          <p>
            Probé una cámara en perspectiva y otra ortográfica sobre la misma escena. Con
            perspectiva, el invernadero se estrecha hacia el fondo; con la ortográfica, las líneas
            paralelas siguen siéndolo y el diorama se lee como una ilustración. Me quedé con la
            segunda, un poco más baja de lo habitual (23° de elevación) para que se vea natural.
          </p>
          <p>
            La cámara es libre pero guiada: gira y se acerca, no se desplaza, y al tocar una planta
            va sola hasta ella.
          </p>
        </>
      ),
      visual: {
        kind: 'image',
        image: 'modelo-cerca',
        alt: 'Vista cercana del invernadero en proyección ortográfica: el depósito con su visor de agua, el sensor en un poste y las macetas de albahaca, lechuga, cebollino, tomate cherry y fresa.',
        caption: 'De cerca, sin perspectiva: las líneas paralelas no se juntan.',
      },
    },
    {
      id: 'un-script-no-un-archivo',
      title: 'Un script, no un archivo',
      body: (
        <>
          <p>
            El diorama no está modelado a mano: un script de Blender lo construye entero, con todas
            sus medidas en un solo diccionario, a tamaño real (la maceta de la albahaca mide 13 cm).
            Cambiar el ancho de la puerta es cambiar un número y volver a generarlo.
          </p>
          <p>
            La app carga el modelo tal cual y busca cada pieza por su nombre (
            <code>pot_basil_01</code>, <code>vent_window</code>, <code>tank_water</code>…): dónde
            está cada planta o adónde mira la cámara lo dice el modelo, no el código. Los colores no
            salen de Blender sino de la paleta de la app, la misma de la interfaz, con una regla:
            las sombras son cálidas, nunca negras.
          </p>
          <Swatches
            label="La paleta de la escena"
            colors={[
              ['Perfilería', '--scene-frame'],
              ['Zócalo', '--scene-plinth'],
              ['Bandeja', '--scene-tray'],
              ['Terracota', '--scene-terracotta'],
              ['Hoja', '--scene-leaf-mid'],
              ['Sombra', '--scene-shadow'],
            ]}
          />
        </>
      ),
    },
    {
      id: 'luz-horneada',
      title: 'Luz horneada, de día y de noche',
      body: (
        <>
          <p>
            Las luces y las sombras suaves se calculan una vez en Blender y se guardan en imágenes:
            una de día, otra de noche y otra de la lámpara. La app las mezcla según la altura del
            sol donde está el invernadero y si la luz de cultivo está encendida. Hornear la luz bajó
            de 92 a 48 las llamadas de dibujo: la mayor mejora para el móvil.
          </p>
          <p>
            Todo tiene un presupuesto que se mide en cada cambio: menos de 4 MB, menos de 150 000
            triángulos, menos de 100 llamadas de dibujo y 60 fotogramas por segundo en un móvil
            medio. De noche, nada es negro puro.
          </p>
        </>
      ),
      visual: {
        kind: 'compare',
        before: {
          image: 'escena-dia',
          label: 'De día',
          alt: 'La demo de día: el invernadero sobre fondo crema, 21 grados dentro, «Todo bien», y abajo los botones Regar, Luz y Aire.',
        },
        after: {
          image: 'escena-noche',
          label: 'De noche',
          alt: 'La misma vista de noche: fondo azul tinta, el invernadero iluminado por dentro con luz cálida y unas luciérnagas alrededor.',
        },
        caption: 'El mismo encuadre a las 12:30 y a las 21:30. Arrastra para comparar.',
      },
    },
    {
      id: 'cuando-no-llegan-datos',
      title: 'Cuando no llegan datos, se adormece',
      body: (
        <>
          <p>
            Si el invernadero deja de hablar, el gemelo no finge: la escena pierde el color, la
            cabecera dice desde cuándo y los botones explican que las órdenes no pueden llegar. Con
            datos de hace unos minutos se apaga solo un poco; desconectado, casi del todo.
          </p>
          <p>Es la situación «Sin conexión» de la demo, con el estado seguro del propio aparato.</p>
        </>
      ),
      visual: {
        kind: 'compare',
        before: {
          image: 'escena-dia',
          label: 'En directo',
          alt: 'La demo en directo, con todos sus colores y «Todo bien».',
        },
        after: {
          image: 'escena-dormida',
          label: 'Sin conexión',
          alt: 'La misma vista sin conexión: el invernadero casi en grises, «Desconectado desde las 12:34» y sobre los botones «Sin conexión: las acciones vuelven al reconectar».',
        },
        caption: 'En directo y desconectado: el color es la frescura del dato.',
      },
    },
  ],
  decisions: [
    { id: 'D04', text: 'Vista isométrica tipo diorama, con cámara libre pero guiada.' },
    { id: 'D40', text: 'Cámara ortográfica; la perspectiva queda solo para comparar.' },
    { id: 'D60', text: 'Cámara más baja: 23° de elevación y 41° de giro.' },
    { id: 'D52', text: 'La paleta de la escena sale de la referencia; sombras cálidas.' },
    { id: 'D58', text: 'Archivo maestro y script paramétrico; el .glb nunca se edita a mano.' },
    { id: 'D57', text: 'Los modelos de Blender siempre a tamaño real: 1 unidad = 1 m.' },
    { id: 'D59', text: 'La escena es el .glb a tamaño real, buscada por nombres.' },
    { id: 'D64', text: 'Luz horneada: de 92 a 48 llamadas de dibujo.' },
    { id: 'D56', text: 'El presupuesto se mide por fotograma completo, en un test.' },
    { id: 'D69', text: 'De noche, un relleno suave para que nada quede negro.' },
    { id: 'D42', text: 'Día y noche según la altura del sol en la ubicación del invernadero.' },
    { id: 'D43', text: 'Sin conexión, saturación 0,2; con datos de hace más de 2 minutos, 0,6.' },
  ],
};
