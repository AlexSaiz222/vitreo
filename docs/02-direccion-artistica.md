# 02 · Dirección artística

Este documento define cómo **se ve y se oye** el invernadero. La interfaz (botones, tipografía, paneles) está en [`03-diseno-ui.md`](03-diseno-ui.md).

## Concepto: "una lámina botánica que respira"

El invernadero es un **diorama** sobre un zócalo claro, flotando en un fondo blanco cálido, como una ilustración isométrica en un libro de papel grueso. Está quieto, pero vivo: las hojas se mecen, la luz cambia con la hora, el cristal se empaña con la humedad.

## Referencias

En `referencias/` (imágenes de referencia no incluidas en esta copia):

- **ref-03 (principal)** — `ref-03-objetivo.png` (imagen de referencia no incluida): es **exactamente la estética buscada** (D50). Diorama isométrico de aspecto arcilla: perfilería blanca con cantos muy redondeados y mate, cristal casi invisible, zócalo de arena cálida con una **bandeja hundida**, camino de la puerta a los escalones, macetas pequeñas con plántulas de 2–3 hojas redondeadas, oclusión ambiental suave y una sombra larga y suave hacia atrás a la derecha. Incluye además los elementos del diseño avanzado (ver más abajo).
- **Aproximación actual** — `aproximacion-ref.png` (imagen de referencia no incluida): la misma estética sin dispositivos; es lo que la escena provisional de código persigue hasta que llegue Blender.
- **ref-02 (secundaria)**: perfilería blanca, zócalo, escalones y vista isométrica; fue la principal hasta D50.
- **ref-01 (secundaria)**: aporta la calidez de la terracota y la variedad de plantas. Su perfilería gris azulada queda descartada.

Referencias de sensación para buscar inspiración (no para copiar): dioramas isométricos low-poly, juegos contemplativos de estilo "cozy", láminas botánicas antiguas, arquitectura de invernaderos victorianos simplificada.

## Forma

- **Estructura**: invernadero a dos aguas, perfiles blancos con **cantos muy redondeados**, material **mate tipo arcilla** (sin brillo especular), proporciones algo más "de juguete" que las reales.
- **Bordes suavizados**: redondeo generoso en todo (nada de aristas afiladas). Es lo que da el aspecto de objeto amable, casi de plastilina.
- **Zócalo/base**: plataforma de arena cálida con un **borde elevado y una bandeja interior hundida**, un camino de la puerta a los escalones y dos escalones. Delimita el diorama y le da peso.
- **Plantas**: **plántulas de 2–3 hojas redondeadas** sobre un tallo corto, lisas y mates; cada especie con una silueta algo distinta. Sin detalle fotográfico.
- **Macetas**: terracota lisa, **pequeñas y con aire entre ellas**, directamente en el suelo del invernadero (sin banco), con la tierra visible (indicador clave).
- **Densidad**: aire entre objetos. Mejor 6 plantas bien compuestas que 20 apelotonadas.

## Paleta de la escena

| Uso | Color | Notas |
|---|---|---|
| Fondo (día) | `#FAF9F6` | Blanco cálido, nunca `#FFFFFF` puro (ref-03: `#FBF9F5`) |
| Perfilería | `#F1ECE3` | Blanco arcilla, mate; se separa del fondo por sombra y oclusión |
| Zócalo (borde y cara superior) | `#EDD5B8` | Arena cálida, extraída de ref-03 (antes crema `#F3EEE4`) |
| Bandeja hundida | `#CBAA87` | Arena algo más oscura, con grano fino (sustituye a la grava) |
| Camino y escalones | `#E6CEB1` | Algo más claro que la bandeja |
| Cristal | `#DCEBEA`, con presencia pero transparente | Velo lechoso leve en su tinte, más marcado en los bordes (fresnel), y un reflejo suave: el tejado refleja el cielo y las paredes la página (D67). De noche casi desaparece, con un halo cálido |
| Terracota | `#BB7547` / sombra `#A86C43` | Extraída de ref-03; el acento cálido principal |
| Tierra seca | `#B39A7C` | Polvorienta y mate |
| Tierra húmeda | `#3A281E` | Oscura y algo brillante (única excepción al "sin especular": es un dato); se interpola según la humedad real |
| Hoja clara | `#ABAC68` | Verdes oliva de ref-03 |
| Hoja media | `#849050` | |
| Hoja profunda | `#687A3F` | |
| Flor (acento) | `#E7A6A1` / `#F3E3B0` | Usar con mucha moderación |
| Hoja nueva | `#97A05A` | Brotes y hojas jóvenes (`leaf_new` en Blender) |
| Pétalo | `#F7F2E8` | Flor de la fresa |
| Corazón de la flor | `#E6C97A` |  |
| Fruto | `#C4604F` | La fresa; color de planta, no de alerta (las alertas usan `--warm`) |
| Tomate verde | `#A3AD66` | Tomates cherry sin madurar |
| Flor de cebollino | `#C4A6C8` | Lila suave; con moderación, como todas las flores |
| Tutor | `#C8B38C` | Caña del tomate |
| Dispositivos | `#F1EDE6` | Depósito, ventilador, lámpara, canalón, caja de sensores: blanco roto, mate |
| Dispositivos (oscuro) | `#9A948C` | Tapón, manguera, cables, bomba |
| Fondo del ventilador | `#BDB6AC` |  |
| Aspas | `#D3CCC2` |  |
| Herrajes | `#D6CFC4` | Juntas, tornillos y tirador (`frame_details`, puerta) |
| Juntas de goma | `#A39D95` | Burletes del cristal |
| Agua | `#9CC9C4` | Visor de nivel del depósito |
| Piloto | `#9BC38E` | Caja de sensores: encendido con datos en directo, apagado si no |
| Tira de la lámpara | `#FFF3DF` | Apagada; encendida brilla con la luz interior `#FFD9A8` |
| Decoración (tinte) | `#FFFFFF` | Multiplica el color de vértice de `decor_ground` y `decor_plants`; blanco = colores tal como salen de Blender |
| Fondo (noche) | `#161A22` | Azul tinta, cálido, nunca negro puro |
| Fondo (atardecer) | `#E9BFA2` | Por donde pasa la página entre el día y la noche (D135): el cálido de una puesta de sol, no el gris de mezclar crema y azul |
| Luz interior (noche) | `#FFD9A8` | Brillo de lámpara |
| Sol (día) | `#FFE2BF` | Sol cálido de media tarde, el mismo del horneado v19 (D71; antes `#FFDBBA`); en la escena se usa suavizado hacia blanco para no teñir la arena |
| Luna (noche) | `#9FB0D0` | Luz ambiente fría y tenue |
| Sombra | `#9C8670` | Sombras **cálidas** y suaves como en ref-03, nunca negras ni grises (antes azuladas, `#6B7A90`) |
| Cielo (relleno) | `#F4ECE1` | Luz cálida que reciben las zonas en sombra de día; el cielo del horneado v19 (D71; antes `#F3ECE2`) |

Los valores viven en `apps/web/src/styles/tokens.css` (`--scene-*`); esta tabla y los tokens deben coincidir (hay un test que lo comprueba).

Reglas: **ningún color saturado fuera de las plantas y la terracota**. El verde es el protagonista; el resto acompaña.

## Ideas de diseño avanzado

**Estado: ideas, no se implementan todavía** (D53). Las imágenes muestran una versión más completa del diorama, con los dispositivos reales a la vista:

- `ref-03-objetivo.png` (imagen de referencia no incluida) (también la referencia principal de estética)
- `ref-03-modelo2.png` (imagen de referencia no incluida)
- `bffedbed-2e3e-45b4-bd39-b7eb2ae79a45.jpg` (imagen de referencia no incluida) (variante con más extras)

| Elemento | Aspecto | Qué representa |
|---|---|---|
| Depósito exterior con manguera | Bidón blanco redondeado junto a la pared, tapón oscuro, manguera hasta el interior | Nivel del depósito y riego (ver `06-gemelo-digital.md`) |
| Barra de luz de cultivo | Barra fina bajo el caballete, luz cálida | Luz de cultivo encendida/apagada |
| Ventilador en el hastial | Rejilla circular con aspas en el frontón | Ventilador |
| Ventana de tejado | Panel del tejado que se abre sobre una bisagra | Ventana (servo), con su apertura real |
| Caja de sensores | Cajita gris en la perfilería | Dónde está la electrónica; su estado (conectado, dormido) |
| Puerta con tirador | Puerta de cristal con marco y tirador | Decorativa por ahora; en el futuro, el acceso a la "vista interior" |
| Vegetación y piedras exteriores | Matas redondeadas, gramíneas y cantos rodados en la bandeja de arena | **Decorativa y opcional**: dosificarla, que no compita con las plantas reales ni rompa el aire del diorama |

En la variante `bffedbed…jpg` aparecen además paneles solares, un visor de nivel en el depósito y un manómetro: se anotan como posibilidades, sin compromiso.

Cómo se relaciona cada objeto con los datos: [`06-gemelo-digital.md`](06-gemelo-digital.md). Nombres en Blender: [`04-pipeline-3d-blender.md`](04-pipeline-3d-blender.md).

## Luz

La luz hace el 70 % del estilo.

- **Día**: sol lateral desde delante a la izquierda, apenas cálido. Una sombra **larga y suave hacia atrás a la derecha**, cálida, nunca negra (ref-03).
- **Los blancos, blancos** (D134): el sol es cálido, pero la escena se ve con balance de blancos, como una foto bien revelada: la perfilería enseña su `#F1ECE3` y el zócalo su arena; la calidez queda en las sombras.
- **Aspecto de arcilla**: materiales mates, **sin brillo especular** (salvo la tierra húmeda, que lo usa para comunicar humedad).
- **Oclusión ambiental** suave en rincones, uniones y bases de macetas. En Blender, horneada; en la escena provisional, N8AO en tiempo real.
- **Sombra de contacto** difusa bajo el zócalo, para que el diorama "pose" sobre el papel.
- **Horneado (bake)**: la iluminación se calcula en Blender y se guarda en texturas (lightmaps). En la web la luz real es mínima, así se ve igual de bonito en un móvil modesto. Detalle técnico en [`04-pipeline-3d-blender.md`](04-pipeline-3d-blender.md).

## Día y noche

**De día por defecto (D116)**: sin nada elegido, la escena es de día; seguir la hora real del sol es la opción Auto de Ajustes › Apariencia, y Noche la fuerza.

- Sincronizado con la **hora real** y la salida/puesta de sol de tu ubicación (librería `suncalc`). También se puede forzar manualmente.
- Técnica: se hornean **dos juegos de luz** (día y noche) y el shader mezcla entre ellos. Transición lenta (minutos reales en el amanecer/atardecer; 1,5 s si cambias a mano).
- **Desde A9 (D96)** todo lo demás de la escena sigue la misma mezcla: el fondo, las luces en directo, el cristal y las sombras sobre la página. La interfaz cambia de tema en el horizonte con un fundido de 2,4 s, al paso de la escena (las superficies se funden; el texto sobre ellas cambia de una vez a mitad, para que nunca desaparezca; **lo escrito directamente sobre la página, el título y el estado, cambia de tinta cuando la página de verdad se oscurece**, no por reloj; D135); instantáneo con movimiento reducido. **El fondo pasa por un atardecer cálido** (`--scene-dusk-bg`), no por gris, y el velo de la cabecera lleva en cada instante el color real de la página.
- **Noche**: fondo azul tinta, el invernadero se ilumina desde dentro. Si la luz de cultivo real está encendida, el digital brilla más cálido y se ve el halo en el cristal. Algunas luciérnagas o motas de polvo muy sutiles.
- **Amanecer y atardecer**: tintes rosados y dorados de pocos minutos. Es el momento "regalo" de la app.

## Vida (animación)

Todo lento, con ruido orgánico, nada en bucle evidente.

- Hojas que se mecen (shader de viento con máscara por color de vértice: la base quieta, las puntas se mueven).
- Motas de polvo flotando en los haces de luz (día) / luciérnagas (noche). **Hecho en A9 (D96)**: motas doradas dentro del invernadero según los lux (sin lectura, ninguna) y unas pocas luciérnagas alrededor ya de noche; cada sistema es una sola llamada de dibujo, animada en el *shader*.
- Condensación en el cristal ligada a la humedad real. **Hecho en A9**: bruma más densa abajo y algunas gotas cuando es espesa, desde 82 % y plena a 96 % de `air.rh`.
- El viento sobre las hojas sale de los datos (A9): más con el ventilador y con la ventana abierta.
- **El tiempo de fuera (A10, D97)**, desde AEMET y siempre con calma: las **nubes** suavizan la luz (el sol más débil, su sombra larga se va, la luz horneada con menos contraste) y agrisan un poco la página; la **lluvia** son trazos finos y escasos alrededor del invernadero, nunca dentro, y gotas en el cristal (alguna resbala); la **niebla**, un velo del color de la página, más espeso abajo; la **nieve**, pocos copos lentos, y la que se posa se amontona contra la barra de abajo de cada paño del tejado y contra la base de las paredes, con volumen (el resto del cristal, limpio) y cubre como un manto el zócalo, el camino y la perfilería, clara también de noche (D136); el **viento** mueve las plantas de fuera, y las de dentro solo si la ventana está abierta. Sin luciérnagas con lluvia, nieve o niebla. Calidad Auto: la mitad de gotas y copos; Baja, movimiento reducido y Sin 3D: ninguno (las nubes, la niebla y las gotas quietas del cristal sí, que no se mueven). Al abrir la app la escena ya tiene el tiempo que hace; un cambio tarda decenas de segundos, como el cielo. Sin datos: escena neutra.
- Al regar: gotas cayendo, la tierra se oscurece en 2–3 s.
- Ventilador girando si está encendido; ventana que se abre de verdad.
- Respetar `prefers-reduced-motion`: se detienen las animaciones decorativas, se mantienen las que informan.

## Cámara

- Vista inicial baja y natural, como la cámara de los renders de Blender: **23° de elevación, 41° de azimut** (D60; antes 35° y 45°). El diorama ocupa unos **dos tercios** del encuadre, con aire alrededor.
- **Libre pero guiada**: órbita con inercia, zoom limitado, sin poder ir bajo el suelo ni atravesar la estructura.
- Al tocar una planta, la cámara se acerca con una curva suave y la encuadra; al cerrar, vuelve.
- Doble toque / botón: volver a la vista inicial.
- **Cámara ortográfica** (isométrica pura), decidida en la fase 1 (D40). La perspectiva cerrada (FOV ≈ 22°) queda solo para comparar, con `?camera=perspective`.

## Sonido

Opcional, **desactivado por defecto**, con un único control de volumen y silencio. **Hecho en A9 (D96)**: Ajustes › Sonido; mezcla en Web Audio que sigue al gemelo (pájaros de día, grillos de noche, el viento algo más fuerte con la ventana abierta, el zumbido del ventilador y el agua al regar, solo con datos en directo); lo de fuera llega filtrado por el cristal con la ventana cerrada; fundidos siempre; se pausa con la app oculta. La lluvia llega con AEMET (A10): solo cuando llueve, más fuerte cuanto más llueve, filtrada por el cristal con la ventana cerrada.

| Capa | Cuándo | Carácter |
|---|---|---|
| Pájaros lejanos | Día | Muy bajo, espaciado, sin bucle audible |
| Grillos | Noche | Suave, intermitente |
| Lluvia suave | Opcional: si llueve fuera (API del tiempo) o como ambiente elegido | Sobre cristal, filtrada |
| Agua | Al regar | Chorrito breve y claro |
| Ventilador | Si está encendido | Zumbido muy leve |
| Interfaz | Acciones importantes | Sonidos tipo madera/cristal, casi imperceptibles |

- Técnica (D114, sustituye a la de D96): Web Audio a la frecuencia del propio dispositivo (48 kHz en casi todos: ya no se pierde nada por encima de 12 kHz). `pnpm audio` elige el tramo más estable de cada grabación (**hasta 48 s**, lo que dé de sí), funde su cola con su principio y lo deja **en mono**, a la **sonoridad para la que se ajustó la mezcla** (EBU R128, LUFS; con un limitador suave si un canto suelto pasaría de −1 dBTP), en Opus/OGG de 40–80 kbps. Cada capa suena como **dos voces separadas en estéreo** que recorren el bucle a trozos de 14–28 s desde puntos al azar, fundiéndose a igual potencia: un fondo ancho que nunca se repite igual (`features/sound/bed.ts`). Lo de dentro (ventilador, agua) lleva además una sala corta generada (sin grabar); lo de fuera pasa por **el cristal**: algo más bajo y menos brillante con la ventana cerrada (estante de −9 dB desde 2,5 kHz, paso bajo suave a 7 kHz, −2 dB), nada con ella abierta. Al final, un techo suave que solo actúa por encima de −2 dBFS. Se descargan al activar el sonido (≈ 1,7 MB; las cuatro lluvias, ≈ 1,5 MB más, la primera vez que llueve: D123) y cada capa se decodifica la primera vez que tiene que sonar (≈ 9 MB un bucle de 48 s; de día no se decodifican los grillos).
- Fuentes: grabaciones propias o bancos con licencia CC0 (p. ej. Freesound filtrando por CC0). Anotar siempre la licencia.

**Licencias de los sonidos** (todas CC0 1.0; D123, comprobadas el 2026-11-09 en la página de cada archivo: Wikimedia Commons o Internet Archive. Las de Freesound se comprobaron allí el 2026-10-13; son sus vistas previas de calidad alta, porque los originales piden cuenta):

| Capa | Grabación | Autor | Página | Origen |
|---|---|---|---|---|
| Pájaros | *Waidachswald Oberschefflenz, Abend* | Evillan | <https://commons.wikimedia.org/wiki/File:Waidachswald_Oberschefflenz_Abend_20250616_2005.ogg> | Commons, Vorbis 160 kbps |
| Mirlo (frases sueltas) | *Чорний дрізд* | Kossstja | <https://commons.wikimedia.org/wiki/File:%D0%A7%D0%BE%D1%80%D0%BD%D0%B8%D0%B9_%D0%B4%D1%80%D1%96%D0%B7%D0%B4.ogg> | Commons, Vorbis 320 kbps |
| Grillos | *Crickets At Night - Raw sound* | Defelozedd94 | <https://freesound.org/people/Defelozedd94/sounds/522299/> | Freesound, vista previa |
| Viento | *a gentle breeze, wind 3* | mario1298 | <https://freesound.org/people/mario1298/sounds/181252/> | Freesound, vista previa |
| Agua | *water-trickle* | FractalStudios | <https://commons.wikimedia.org/wiki/File:363120_fractalstudios_water-trickle.wav> | Commons, WAV original |
| Ventilador | *Humming of a fan* | edhutschek | <https://freesound.org/people/edhutschek/sounds/219247/> | Freesound, vista previa |
| Llovizna | *long_easy_rain_08* | joedeshon | <https://archive.org/details/soundica-fs-430765-long-easy-rain-08-wav> | Internet Archive (copia de Freesound), MP3 183 kbps |
| Lluvia | *Light Rain Distant Thunder* | kvgarlic | <https://commons.wikimedia.org/wiki/File:Light_Rain_Distant_Thunder_July_5th_2016.wav> | Commons, WAV 48 kHz |
| Chaparrón | *Rain in the VietNam* | ltruong267 | <https://archive.org/details/soundica-fs-812780-rain-in-the-vietnam> | Internet Archive (copia de Freesound), AAC mono |
| Lluvia en el cristal | *Rain balcony window perspective* | supersnd | <https://freesound.org/people/supersnd/sounds/592345/> | Freesound, vista previa |

**Licencias de las fuentes**: Young Serif (The Young Serif Project Authors) y Schibsted Grotesk (The Schibsted-Grotesk Project Authors), las dos con la SIL Open Font License 1.1. Se usan recortadas (`pnpm fonts`); el texto de cada licencia va junto a los archivos, en `apps/web/public/fonts/`.

El goteo del canalón no es una grabación: cada gota se sintetiza en Web Audio (D123), sin descarga ni licencia.

Los **toques de la interfaz** (D128, D129) tampoco: una tecla suave sintetizada en Web Audio. Cada toque es un "tic" limpio y muy corto (un seno agudo que se apaga en 10–15 ms, el borde de la tecla) sobre un golpe redondo que cae de tono (340 → 200 Hz, el cuerpo, con su octava encima para que se oiga en el altavoz de un móvil) y un soplo de aire en el contacto; paso bajo a 7 kHz, para que suene limpio y nunca afilado. Al pasar el ratón por un botón, el tic más ligero; al pulsar, la tecla; un interruptor añade dos notas que suben al encender y bajan al apagar, y abrir o cerrar un panel, una tecla más suave con dos notas que suben o bajan (las notas, en la pentatónica de do, para que dos seguidas nunca desafinen); al hacer *scroll* en un panel, un susurro de papel espaciado. **Niveles medidos contra el ambiente de día** al volumen por defecto (D129; con D128 el ambiente los tapaba): en sus primeros 10 ms, una pulsación queda unos 24 dB por encima, abrir un panel unos 20, pasar el ratón unos 14 y el *scroll* apenas 2. Con D131, unos 5 dB más cada uno (pulsar, unos 30; pasar el ratón, unos 22), y **los botones de un aparato (la luz, el ventilador) suenan como un interruptor de pared**: el contacto y, 22 ms después, el asiento; el aparato responde después con su propio sonido. Con su propio contexto de audio de baja latencia, para que suenen bajo el dedo, el mismo que los **sonidos de los aparatos** desde D131 (la bomba, el relé de la luz, el ventilador al arrancar o pararse y el servo de la ventana; solo cuando los datos dicen que cambiaron). Medidos contra el ambiente de día al volumen por defecto, en sus 200 ms más fuertes: el ventilador, unos 12 dB por encima; la ventana, 10; la bomba, 13; el clic del relé, unos 19 en sus 10 ms. **Ambiente, aparatos y toques tienen cada uno su interruptor** (D131): quitar el ambiente ya no quita los otros dos. Un volumen para los tres. Quien llega por primera vez no oye nada (D96).

Cambiar una fuente es cambiar `assets/scripts/build-audio.mjs` y esta tabla. `pnpm audio` da los mismos bytes en cada ejecución (`-fflags +bitexact`): el *hash* de un bucle solo cambia si cambia su sonido.
- Mezcla: nada por encima de un volumen "de fondo". Es un ambiente, no una banda sonora.

## Estados especiales

- **Desconectado**: el invernadero se desatura ligeramente y la luz se vuelve neutra, como dormido. Un texto discreto explica desde cuándo.
- **Cargando**: el diorama aparece "dibujándose" (fundido + leve subida), nunca un spinner.
- **Alerta suave**: la planta afectada lo muestra (hoja caída, tierra clara) y aparece un pequeño punto en ella. Nada rojo.

## Lo que evitamos

Realismo fotográfico, texturas de alta frecuencia, brillo especular exagerado, bloom fuerte, colores neón, sombras negras, cámaras que marean, animaciones rápidas.
