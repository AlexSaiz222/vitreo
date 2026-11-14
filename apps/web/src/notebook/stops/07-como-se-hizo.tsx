import type { Stop } from '../content.ts';

/**
 * Stop 7: how it was made, briefly: the interface, the tests, what failed,
 * how it changed, the device as designed and what AI could do with it
 * (docs/03, docs/07, docs/09, docs/12, the test week's report; D32–D133).
 */
export const stop7: Stop = {
  number: 7,
  id: 'como-se-hizo',
  title: 'Cómo se hizo',
  subtitle: 'La interfaz, las pruebas, el aparato y la IA',
  lead: (
    <p>
      Lo que no se ve en la demo: de qué está hecha la interfaz, cómo se prueba todo y qué salió mal
      por el camino. Y cómo cambió en seis semanas, del primer prototipo a hoy.
    </p>
  ),
  sections: [
    {
      id: 'relieve-no-cristal',
      title: 'Una interfaz del mismo material que el diorama',
      body: (
        <>
          <p>
            La interfaz es neumórfica, como material y no como panel de control: superficies del
            color de la perfilería, en relieve, con la luz arriba a la izquierda, como el sol del
            diorama. Los paneles son opacos, sin cristal ni desenfoque. Hundido solo significa
            pulsado, seleccionado o un campo para escribir, y un test lo comprueba en cada hoja de
            estilos.
          </p>
          <p>
            El relieve solo no basta, así que ningún estado depende de la sombra: lo encendido lleva
            además un punto, un icono o un texto. Las letras son Young Serif para los titulares y
            Schibsted Grotesk para todo lo demás, con cifras que no bailan cuando una lectura
            cambia.
          </p>
        </>
      ),
    },
    {
      id: 'para-todos',
      title: 'Sin 3D, y para todos',
      body: (
        <>
          <p>
            La calidad tiene cuatro niveles: Auto, Alta, Baja y Sin 3D. Sin 3D es una lista de
            plantas que ni siquiera descarga el modelo, y es lo que sale solo si el navegador no
            tiene WebGL o la escena falla: nunca una página en blanco.
          </p>
          <p>
            Todo cumple el contraste AA, cada objetivo táctil mide al menos 44 px, se usa entero con
            el teclado, la escena tiene un resumen en texto para los lectores de pantalla y la app
            sigue funcionando con el texto al doble de tamaño.
          </p>
        </>
      ),
      visual: {
        kind: 'phones',
        shots: [
          {
            image: 'movil-sin-3d',
            label: 'Sin 3D',
            alt: 'La demo en el móvil sin 3D: la lista de las seis plantas con su humedad y su estado, y abajo el depósito al 72 % y los botones Regar, Luz y Aire.',
          },
        ],
        caption: 'Sin 3D: las mismas plantas y los mismos botones, en una lista.',
      },
    },
    {
      id: 'la-semana-de-prueba',
      title: 'La semana de prueba: 11,3 horas de 187',
      body: (
        <>
          <p>
            En octubre dejé una semana entera con todo encendido: riego de las seis plantas,
            ventilación, luz y noches tranquilas. Se grabaron 11,3 horas de unas 187. El resto se
            perdió en cinco apagones: Windows Update reinició el PC y Docker no arrancó (33,5
            horas), el PC estuvo apagado varias veces y, al volver una de ellas, la comprobación que
            debía repararlo todo se abrió en una ventana, se cerró con ella y nada volvió a mirar en
            3,4 días.
          </p>
          <p>
            La lección: un portátil no es un servidor. Los fallos del arranque se arreglaron (todo
            vuelve solo con Docker y una comprobación cada 30 minutos), pero la prueba continua irá
            a una Raspberry Pi. Mientras, la semana se comprueba acelerada: el mismo aparato
            simulado, siete días en unos 5 segundos, como test. Así salieron la luz que parpadeaba y
            el ventilador que enfriaba de noche.
          </p>
        </>
      ),
    },
    {
      id: 'un-solo-camino',
      title: 'Un solo camino para publicar',
      body: (
        <>
          <p>
            Publicar tiene una sola puerta: un comando que se niega si no estoy en la rama principal
            o si hay cambios sin guardar o sin subir. Nació de un error que pasó dos veces al
            principio, publicar en casa algo que nadie había revisado. La demo sigue la misma regla
            y, antes de subirse, revisa la carpeta entera: si aparece una clave, la ubicación de
            casa o una dirección de la red privada, no se sube nada.
          </p>
          <p>
            Hay más de 1000 pruebas automáticas. Las de extremo a extremo nunca tocan el invernadero
            en uso: cada una levanta su propio simulador, su hub y su servidor, en paralelo y con la
            GPU de verdad. La suite completa pasó de 25 minutos a poco más de 4.
          </p>
        </>
      ),
    },
    {
      id: 'evolucion',
      title: 'Evolución',
      body: (
        <>
          <p>
            El primer día ya había un invernadero en pantalla, hecho con cajas y cilindros desde el
            código y con datos en directo de un invernadero simulado. Al día siguiente encontré la
            imagen que se convirtió en la referencia (perfilería blanca y redondeada, terracota y un
            zócalo de arena) y la escena provisional se acercó a ella.
          </p>
          <p>
            Después llegó el diorama de Blender: de la versión 1 a la 19 en dos días. Una hiedra
            trepando por la esquina se probó y no se quedó; una luz cálida de media tarde, sí.
          </p>
          <p>
            Escribí el código y los modelos 3D con ayuda de Claude Code. Cada decisión quedó
            apuntada en un registro numerado, y aquí las cito por su número al final de cada parada.
          </p>
        </>
      ),
      visual: {
        kind: 'strip',
        shots: [
          {
            image: 'c1-primer-dia',
            label: '30 sep · primer prototipo',
            alt: 'El primer prototipo: un invernadero blanco con cuatro macetas sobre un zócalo, hecho con geometría desde el código, con la temperatura y la humedad arriba.',
          },
          {
            image: 'c1-provisional',
            label: '1 oct · escena provisional',
            alt: 'La escena provisional: un invernadero blanco con cuatro macetas de terracota sobre un zócalo de arena con su escalón, aún sin aparatos.',
          },
          {
            image: 'c2-v1',
            label: '3 oct · Blender, versión 1',
            alt: 'Render de Blender, versión 1: un invernadero blanco y sencillo con cuatro macetas sobre un zócalo de arena.',
          },
          {
            image: 'c2-v19',
            label: '4 oct · Blender, versión 19',
            alt: 'Render de Blender, versión 19: el invernadero con seis plantas, depósito, ventilador, lámpara, plantas fuera y luz cálida.',
          },
          {
            image: 'evolucion-hoy',
            label: 'Hoy',
            alt: 'La demo hoy, de día: el invernadero con sus seis plantas, la cabecera y los botones Regar, Luz y Aire.',
          },
        ],
        caption: 'Del primer día a hoy. Las capturas antiguas, tal como se hicieron.',
      },
    },
    {
      id: 'el-aparato-fisico',
      title: 'El aparato físico',
      body: (
        <>
          <p>
            La demo funciona con un simulador que habla el mismo protocolo que el aparato real:
            cambiar uno por otro no toca ni la app ni el hub. El aparato está diseñado así:
          </p>
          <ul>
            <li>
              <strong>El cerebro</strong>: un ESP32 con wifi, que publica sus lecturas por MQTT y
              confirma cada orden que recibe.
            </li>
            <li>
              <strong>El aire y la luz</strong>: un SHT31 para la temperatura y la humedad, y un
              BH1750 que mide los lux.
            </li>
            <li>
              <strong>La tierra</strong>: un sensor capacitivo en cada maceta (los resistivos se
              corroen), calibrado en seco y en agua.
            </li>
            <li>
              <strong>El riego</strong>: una bomba peristáltica por maceta, que dosifica sin gotear
              y sin válvulas, y un flotador en el depósito.
            </li>
            <li>
              <strong>Los aparatos</strong>: una barra LED de cultivo, un ventilador de 12 V y un
              microservo que abre la ventana del tejado, conmutados con MOSFET.
            </li>
          </ul>
          <p>
            Una sola fuente de 12 V lo alimenta todo, con un reductor a 5 V y un fusible. La
            electrónica va arriba y el agua abajo, en una caja estanca, y nada de 230 V se cablea a
            mano. La seguridad vive en el propio aparato: tiempo máximo por riego, nada de bombear
            con el depósito vacío, ventana cerrada por debajo de 5 °C y estado seguro al arrancar o
            al perder la conexión, aunque el hub no responda. Una Raspberry Pi haría de hub
            encendido día y noche, y una cámara con encuadre fijo podría sacar cada día la misma
            foto de cada planta.
          </p>
        </>
      ),
    },
    {
      id: 'la-ia',
      title: 'Preparado para aprender',
      body: (
        <>
          <p>
            Cada lectura se guarda en bruto, cada acción con su origen (usuario, automatización o
            seguridad) y el diario lleva etiquetas como plaga o regada a mano: los datos ya sirven
            para entrenar. Tres modelos tienen sentido aquí:
          </p>
          <ul>
            <li>
              <strong>Previsión de la humedad</strong> de cada maceta a 24 horas, para regar antes y
              lo justo: primero la curva de secado de cada maceta, luego gradient boosting con el
              aire, la luz y los riegos.
            </li>
            <li>
              <strong>Detección de fallos</strong> por los residuos frente a esa previsión: «he
              regado y la humedad no sube» es una bomba atascada o un tubo suelto.
            </li>
            <li>
              <strong>Control del clima con MPC</strong>: temperatura y humedad en su rango con el
              menor gasto de ventilador, ventana y luz.
            </li>
          </ul>
          <p>
            Cada uno se mide contra la regla por umbral de hoy, y ninguno puede saltarse los límites
            del firmware.
          </p>
        </>
      ),
    },
  ],
  decisions: [
    { id: 'D72', text: 'Neumorfismo como lenguaje de material; paneles opacos.' },
    { id: 'D80', text: 'Dos niveles de relieve, luz siempre arriba a la izquierda.' },
    { id: 'D81', text: 'Hundido = pulsado, seleccionado o campo.' },
    { id: 'D82', text: 'Young Serif para titulares y Schibsted Grotesk para la interfaz.' },
    { id: 'D86', text: 'Calidad Auto · Alta · Baja · Sin 3D.' },
    { id: 'D102', text: 'Texto al 200 % comprobado en los tests de accesibilidad.' },
    { id: 'D94', text: 'Todo en Docker con reinicio automático y una comprobación que repara.' },
    {
      id: 'D104',
      text: 'La semana no se repite en tiempo real: se acelera; la prueba continua, a la Pi.',
    },
    { id: 'D92', text: 'Publicar solo con pnpm release, desde main limpio y subido.' },
    { id: 'D112', text: 'pnpm demo:release y su comprobación antes de subir.' },
    { id: 'D95', text: 'e2e en paralelo con pilas aisladas: de 25,2 a 4,2 min.' },
    { id: 'D50', text: 'Una imagen pasa a ser la referencia principal.' },
    { id: 'D58', text: 'El diorama, un script paramétrico de Blender.' },
    { id: 'D71', text: 'Luz cálida de media tarde; hiedra probada y descartada.' },
    {
      id: 'D32',
      text: 'Los límites de seguridad del simulador, los mismos que llevará el firmware.',
    },
    { id: 'D99', text: 'Los primeros modelos, propios y entrenados con los datos reales.' },
    { id: 'D133', text: 'Este cuaderno, como un recorrido por la demo.' },
  ],
};
