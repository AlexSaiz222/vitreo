# 03 · Diseño de interfaz

La interfaz es un **marco silencioso** alrededor del invernadero. Tiene que ser bonita como una página de un libro de arte y a la vez muy fácil de usar con una mano en el móvil.

## Principios

1. **La escena ocupa toda la pantalla.** La interfaz flota encima, en los bordes, y deja respirar el centro.
2. **Un vistazo, una respuesta.** Arriba, una sola línea dice cómo está todo.
3. **Acciones a un toque, confirmación a dos.** Lo frecuente (regar, luz) es inmediato; lo delicado pide confirmación o se puede deshacer.
4. **Texto antes que iconos sueltos.** Los iconos acompañan a palabras, no las sustituyen (salvo los universales).
5. **Estados siempre visibles.** Cualquier acción muestra que está ocurriendo y cuándo termina. Con ratón, lo que se puede pulsar se acerca un poco al pasar por encima (D131): un tono más claro y algo más de relieve, nunca hundido (eso es pulsado), junto al toque que suena entonces.
6. **Nada depende solo del color o del 3D.** Toda la información de la escena existe también en texto accesible.

## Tokens de diseño

Definidos como variables CSS en `apps/web/src/styles/tokens.css`. Esta tabla es la fuente de verdad.

### Color (UI)

| Token | Día | Noche | Uso |
|---|---|---|---|
| `--bg` | `#FAF9F6` | `#161A22` | Fondo (coincide con la escena) |
| `--neu-base` | `--scene-frame` (`#F1ECE3`) | azul tinta de la noche + luna + un toque de la lámpara | Superficie de paneles y controles (neumorfismo, D72, D80) |
| `--ink` | `#1E2320` | `#ECE8E1` | Texto principal |
| `--ink-soft` | `#5E655F` | `#A6ABB3` | Texto secundario |
| `--line` | `rgba(30,35,32,0.08)` | `rgba(236,232,225,0.10)` | Divisores y bordes |
| `--accent` | `#5E8C58` | `#9BC38E` | Estado "bien", señales pequeñas (punto de activo, progreso) |
| `--water` | `#7EA9CC` | `#6F97B8` | Relleno de lo que es agua: la gota de humedad, el tinte de la acción principal (D81) |
| `--water-ink` | `#2D5A7B` | `#B8D6EE` | Texto e icono de la acción principal (≥ 4,5:1 sobre `--primary-fill`) |
| `--warm` | `#C9774F` | `#E39B75` | Atención suave ("tiene sed") |
| `--focus` | `#3D6FB6` | `#8FB4EA` | Anillo de foco de teclado |

No hay rojo en la paleta. Un problema serio (depósito vacío, sensor roto) usa `--warm` + texto claro + icono.

Contraste mínimo **WCAG AA** (4,5:1 texto normal) comprobado en ambos modos sobre `--bg` y sobre `--neu-base`; iconos, indicadores y anillo de foco ≥ 3:1 (WCAG 1.4.11). `--warm` (2,9:1 sobre la base de día) es solo para rellenos; el texto, los iconos y los bordes de aviso usan `--warm-ink`. Lo comprueban `tokens.test.ts` y axe (e2e) de día y de noche.

### Tipografía

- **Texto e interfaz: Schibsted Grotesk** (D82), pesos 400 y 500 y cursiva 400 (los nombres latinos). **Titulares: Young Serif**, solo a tamaño de titular (el título de la app y los nombres de las plantas, `--text-28` o más; nunca por debajo de ≈ 24 px; lo comprueba `cssRules.test.ts`). Tokens `--font-sans` y `--font-display`.
- **Lo justo**: `pnpm fonts` (`assets/scripts/subset-fonts.mjs`) recorta a latín + español (ASCII, Latin-1, rayas, comillas, puntos suspensivos, €, →, −), limita el eje de peso de Schibsted a 400–500 y fija la cursiva en 400: tres woff2 en `apps/web/public/fonts/`, **81,5 KB** en total. La PWA los guarda (funcionan sin conexión) e `index.html` precarga los dos de pie.
- **Nada salta al cargar**: `font-display: swap` con alternativas locales ajustadas a sus métricas (`size-adjust` y `ascent`/`descent`/`line-gap-override` sobre Georgia, Roboto y Arial), generadas en `src/styles/fonts.css`.
- **Cifras tabulares solo en las lecturas vivas que cambian** (estado, marcas de las plantas, depósito, dial, deslizador, cuentas atrás y temporizadores, estado de las órdenes, y la clase `.reading` para un valor dentro de un texto, como el "56 %" de una fila del menú Regar). Las listas estáticas (Acerca de, los datos de la hoja, los detalles de las filas) y el texto corrido conservan las proporcionales: con las tabulares, Schibsted también ensancha los dos puntos, el punto y la coma ("16 : 44"). `cssRules.test.ts` lo comprueba en los dos sentidos (D87).
- Escala: 12 · 14 · 16 · 20 · 28 · 40 px, en `rem` (`--text-*`): crece con el tamaño de texto del navegador o del móvil, hasta el 200 % sin romper nada (A12). Lo que rodea a un número (el dial, la columna del eje de las gráficas) se mide también en texto. Cuerpo a 16 en móvil.
- Pesos: 400 y 500. Nada de negritas gruesas.
- Interlineado generoso (1,5 texto, 1,15 titulares). Algo de espaciado en mayúsculas pequeñas para etiquetas.

### Espacio, forma y sombra

- Rejilla de **8 px** (con 4 px para ajustes finos).
- Márgenes de pantalla: 20 px móvil, 32–48 px escritorio.
- Radios generosos: `--radius-card` 20 px, `--radius-float` 28 px (paneles sobre la escena), `--radius-pill` para botones.
- **Material neumórfico** (D72, D80; imagen de referencia no incluida): superficies del mismo color que se distinguen solo por la luz, siempre **arriba a la izquierda** (la del sol del diorama):
  - `--elev-raised-sm` y `--elev-raised-md` (en relieve; no hay más niveles), `--elev-inset-sm` y `--elev-inset-md` (huecos), `--elev-pressed` (al pulsar);
  - derivados de la paleta con `color-mix()`: luz `--neu-light`, sombra `--neu-dark` (cálida, de `--scene-shadow`, nunca negra);
  - **paneles sobre la escena 3D**: opacos, con `--elev-float` (sombra de caída suave); el relieve y los huecos van **dentro**; sin cristal ni `backdrop-filter`;
  - **estados**: pulsado o activo = hundido **y además** acento, icono o texto (un punto `--accent`, un tic); nunca solo la sombra;
  - **desactivado**: plano, sin luz ni sombra, sobre `--surface-disabled`, con texto e icono atenuados y el motivo al lado ("Sin conexión: las acciones vuelven al reconectar");
  - **sin dato**: la fila o el control conserva su superficie y solo se atenúa su contenido;
  - **hundido significa "pulsado, seleccionado o campo"**, y nada más (D81): un hueco en cualquier otro sitio parece un botón o un campo que no existe. Los iconos decorativos van sin pozo; los bloques de datos son filas sobre la superficie separadas por una línea fina (`--line`). Lo comprueba `cssRules.test.ts` (los `--elev-inset-*` y `--elev-pressed` solo en selectores de estado o de campo, y ninguna pantalla usa superficies hundidas).
- **Acción principal** (D81, sustituye el relleno de tinta de D46): botón en relieve algo mayor que los demás, teñido de agua (`--primary-fill`) con texto e icono en `--water-ink`. Es lo único azul de la interfaz.
- **Gota de humedad** (`MoistureDrop`): en la lista de plantas, una gota sin superficie, llena desde abajo hasta la humedad de la tierra (68 % → dos tercios), en `--water`; con sed, contorno `--warm-ink`; sin dato, contorno discontinuo y vacía. Es decorativa: el porcentaje va siempre escrito al lado.
- **Cabecera sobre la escena** (D81): sin tarjeta. El título y el estado van directamente sobre el 3D; un degradado suave del color de fondo (`.hud-scrim`) los hace legibles sea cual sea el ángulo. El estado lleva iconos pequeños (temperatura, humedad) y un punto de estado (`--accent` bien, `--warm-ink` atención, `--ink-soft` esperando); la frase lo dice siempre con palabras.
- **Día/noche**: botón de icono (sol, luna, medio disco para "auto"), centrado ópticamente, con nombre accesible.
- Solo sombras estáticas (nada animado en bucle).

### Movimiento

- Duraciones: 140 ms (pulsar: relieve → hueco, `--duration-press`), 150 ms (micro), 300 ms (paneles), 600–900 ms (cámara). Todas × `--motion-scale`.
- Curva por defecto: `cubic-bezier(0.22, 1, 0.36, 1)` (salida suave).
- Nada rebota. Nada parpadea.
- `prefers-reduced-motion`: sin desplazamientos, solo fundidos.

## Primitivas

Toda pantalla se construye con `apps/web/src/ui/primitives/` (D72): `Surface`/`Card`, `Button` (píldora; la principal rellena de `--ink`, D46), `IconButton` (nombre obligatorio), `Toggle` (`role="switch"`), `Segmented` (grupo de radios con flechas), `Slider` (el `range` nativo), `DialGauge` (dial con marcas; el valor siempre en texto; sin dato, "—" y "sin dato", nunca 0), `ListRow`, `Chip`, `Sheet` (lateral en escritorio; abajo en el móvil, a media altura y deslizable) y `Toast`. Catálogo en desarrollo: `?ui=lab`.

## Estructura de la pantalla principal

```
┌──────────────────────────────────────────────┐
│ Vitreo                                  (⚙)  │  ← nombre y Ajustes
│ 23° dentro · 12° fuera · 64 % · Todo bien (↺) │  ← línea de estado; rebobinar
│                                               │
│               [ INVERNADERO 3D ]              │  ← escena a pantalla completa
│                                               │
│       ┌─────────────────────────────────┐     │
│       │        💧 Depósito · 80 %        │     │  ← el depósito, siempre
│       │   Regar   ·   Luz   ·   Aire     │     │  ← dock de acciones
│       └─────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

- **Arriba**: el nombre y, a la derecha, **Ajustes** y **Rebobinar** (y "Vista inicial" cuando la cámara se ha movido). Sin reloj ni menú "⋯" (D100): la hora es la del teléfono, y Día/noche está en Ajustes › Apariencia.
- **Línea de estado**: temperatura dentro y fuera (AEMET) · humedad · frase humana ("Todo bien", "La albahaca tiene sed", "Desconectado desde las 14:10"). Las lecturas abren la hoja del invernadero (A11).
- **Dock**: el depósito (abre la hoja del invernadero en Depósito) y Regar · Luz · Aire. Con texto grande pasa a dos filas.
- **De día por defecto (D116)**: sin nada elegido, la app es de día; Ajustes › Apariencia ofrece Auto (el sol de verdad), Día y Noche.
- **Esperando los primeros datos (D116)**: bajo "Esperando datos del invernadero…", una frase que dice qué pasa y de dónde llega el tiempo de fuera (AEMET en casa; en la demo, que es simulado y que en el de verdad se sincroniza con AEMET).
- **En un ordenador con ratón, el invernadero manda (D115)**: el dock son tres iconos redondos (Regar, Luz, Aire; la luz encendida, con su punto); sus palabras, el estado de la luz y el depósito se abren al pasar el ratón por el dock o al llegar con el teclado, y siguen abiertos mientras uno de sus menús lo está. El depósito bajo o vacío no se esconde. La línea de la demo deja a la vista solo "Demo · datos simulados" (con una flecha pequeña); la hora, la velocidad y "Probar situaciones" se abren igual. "Cómo se hizo" es un icono redondo más, con Ajustes y Rebobinar (solo en el ordenador, D116), que ya no empujan hacia abajo lo que va bajo el título. En el móvil (sin ratón) todo sigue como antes, con las palabras a la vista.
- **Teclado** (escritorio y móvil con teclado): los atajos de "Teclado" más abajo; `?` los lista. Sin paleta de comandos (D100).

## Interacción con plantas

1. Tocas una planta → la cámara se acerca y aparece una **hoja de detalle** (panel inferior en móvil, lateral en escritorio). En la escena, las demás macetas se atenúan (más de noche, porque el fondo ya es oscuro) y la elegida recibe una leve luz cálida, con un fundido suave (D68).
2. La hoja muestra: nombre y especie, la humedad de la tierra en un dial con la marca de su umbral, "cómo está" en una frase, "Pide agua por debajo del 40 %" y su edad ("Sembrada hace 23 días"). Debajo: último riego, **Riego** (su umbral y "Regar sola", D100), **Planta** (nombre, siembra, edad y "Planta nueva en esta maceta", A12), **Historial** (24 h · 7 días · 30 días) y **Diario**.
3. Acciones: **Regar ahora** (con duración elegible) y **Detener**, **añadir una nota o una foto** (con etiquetas: "Regada a mano" sola ya es una nota), cambiar su umbral o su riego automático, su nombre o su siembra.
4. Deslizar hacia abajo, tocar fuera, `Esc` o alejar con la rueda del ratón (o pellizcando en el trackpad) sobre la escena → se cierra la hoja y vuelve la vista general. Acercar con la rueda mantiene la planta abierta. Mientras la cámara se mueve (al abrir o al volver), cualquier giro de rueda o arrastre manda: la cámara deja de imponer su zoom y solo termina de recentrar.

## Las plantas en la escena (A2, D83)

El diorama es el protagonista: lo que se pone encima es pequeño, legible sobre cualquier fondo (sobre su propia superficie opaca) y solo aparece cuando ayuda.

- **Tocar una planta**: cada maceta tiene una zona táctil invisible **dentro de la escena 3D**, de al menos 44 px a cualquier zoom. Al ser parte de la escena (no HTML encima), un arrastre que empieza sobre una planta sigue girando la cámara. Un toque admite ≈ 10 px de movimiento del dedo (lo normal en pantallas táctiles); más es un arrastre (D84).
- **Nombres**: solo con el puntero encima, con el foco del teclado, o con la cámara acercada (≥ 1,8 × la vista inicial), y nunca para una planta tapada por otra. Si no caben, no se ponen.
- **Avisos anclados** (sed, sensor sin dato): una marca cálida pequeña que sigue a la planta; dice qué pasa ("Albahaca · Sed") con el puntero, el foco, acercado o en el borde. Detrás de otra planta: sin relieve y con borde discontinuo. Fuera de la pantalla, o bajo la cabecera, el dock o la hoja: **en el borde**, con una flecha hacia la planta. Tocar una marca abre la planta. Nunca se tapan entre sí ni tapan la cabecera, los avisos o el dock; si hace falta, se desplazan con una línea fina hasta su planta.
- **Avisos bajo la cabecera** (como mucho tres, "Y 2 avisos más"): **órdenes que fallan** (rechazadas, sin respuesta del invernadero —con "Reintentar"— o sin conexión) y avisos generales (depósito, sensores del aire o la luz). Los críticos se quedan hasta resolverse; el resto se puede cerrar y vuelve solo si el problema reaparece. **Un cambio que sale bien no dice nada**: el propio control muestra el estado (D85). La conexión ya la dicen la línea de estado y el dock.
- **Con un menú del dock o una hoja abiertos, las marcas de las plantas se apartan** (D85): la cabecera ya nombra lo que pide atención y el menú Regar muestra cada planta con su gota y su sed. Vuelven al cerrarlo.
- **Aire** es un globo pequeño justo encima de su botón, del tamaño de su contenido (ventilador y ventana), sin huecos.
- **Depósito siempre a la vista**: una línea en el dock, junto a las acciones que usan el agua, con la misma gota de agua llena hasta el nivel; poco o vacío, contorno cálido y palabras; sin dato, gota discontinua.
- **Sin "Deshacer" para los conmutadores** (luz, ventilador, ventana, día/noche): el botón muestra el estado y es el camino de vuelta (D85). "Deshacer" queda para acciones destructivas que un toque no revierte (p. ej. borrar una nota del diario, A8). **El riego empieza al momento** y, mientras dura, se ve su progreso y **"Detener"** para la bomba (orden `waterStop`, D84).
- **Un límite de seguridad se nombra y dice hasta cuándo** (D85): el botón de riego queda desactivado (plano, D81) con "Disponible a las 13:47" y, debajo, "Límite de riego por hora (60 s) · vuelve a las 13:47".
- **Vista inicial**: el botón aparece solo cuando la cámara se ha movido; también doble toque en un espacio vacío o la tecla H.
- **Teclado**: Tab recorre las seis plantas (cada una con su nombre, humedad y aviso para el lector de pantalla), 1–6 abre una, L enciende o apaga la luz, H vuelve a la vista inicial, ? lista los atajos. Sin Ctrl + Z (D85).

## Ajustes, calidad y bienvenida (A3, D86)

- **Ajustes** se abre con el botón redondo de arriba a la derecha (sustituye al de día/noche, que pasa dentro). Son los de **este dispositivo**, guardados en el navegador: **Apariencia** (Auto · Día · Noche), **Calidad del 3D**, **Ver la bienvenida** y **Acerca de** (simulador o invernadero real, conexión, versión). Un cambio se aplica al momento y el control lo muestra: no hay "Deshacer" (D85). Plantas y ubicación son del invernadero y llegan con el hub (A4).
- **Calidad del 3D**: **Auto** (alta, y baja sola si los fotogramas van lentos), **Alta** (la resolución de la pantalla), **Baja** (1 px por px CSS: en un móvil, varias veces menos píxeles) y **Sin 3D**: las plantas en una lista con su gota, humedad y sed, las mismas acciones por su hoja, y **sin descargar el modelo**. Si el dispositivo no puede con WebGL, o la escena falla, se pasa solo a la lista y Ajustes lo explica.
- **Bienvenida** ("Primera vez"): un diálogo nativo con cuatro pasos (qué es Vitreo; cómo leerlo: gota, sed, marca cálida, escena gris; tocar y mirar; la conexión, que dice con honradez si es el simulador). Se ve una vez por dispositivo, se puede saltar (Esc) y se vuelve a ver desde Ajustes.

## Plantas, ubicación y el hub (A4, D87)

- **Ajustes** tiene dos páginas del **invernadero** (no de este dispositivo), que guarda el hub: **Plantas** (nombre y fecha de siembra de cada maceta) y **Ubicación** (latitud y longitud, con "Usar dónde estoy" y, al momento, a qué hora amanece y anochece allí). Se entra desde una fila y se vuelve con la flecha de la cabecera; el título de cada página recibe el foco. En el móvil, Ajustes se abre **a toda altura**: no es un vistazo, es un sitio donde se trabaja.
- **Nombres**: un nombre propio se usa **sin artículo** en las frases ("Pepa tiene sed", "El sensor de Pepa no responde"); el de la especie, con él y con la contracción ("del perejil", nunca "de el"). La ficha de la planta mantiene la especie a la vista: "Albahaca · *Ocimum basilicum*". Solo el nombre latino va en cursiva. Vaciar el nombre vuelve al de la especie; la maceta (`basil_01`) no cambia nunca, así el historial sigue siendo suyo.
- **Guardar** se habilita solo con un cambio y el hub disponible. Al guardar, una línea de estado dice "Guardando…", "Guardado." o, en tono cálido, por qué no ("No se ha guardado: el hub no responde. La planta sigue como estaba."). Nada se muestra como guardado hasta que el hub lo confirma.
- **Con el hub caído** (PC dormido, Docker parado) el invernadero sigue igual: escena, controles, avisos y estado van por el broker. **No hay alarma en la cabecera**: cada sitio que necesita el hub lo dice con calma y en tono cálido, "El hub no responde desde las 16:50: los nombres se podrán cambiar cuando vuelva.", y el botón que depende de él queda deshabilitado y descrito por esa frase. Los nombres y la ubicación se ven como el hub los dijo la última vez (guardados en este dispositivo). Acerca de tiene una fila **Hub** ("Conectado · último dato guardado a las 16:43" o "El hub no responde desde las 16:44"). La app pregunta cada 30 s y al volver al primer plano.

## Historial y rebobinar (A5, D88)

- **Historial** en la ficha de la planta (sustituye a "Últimos 7 días"): la humedad de su tierra en **24 h · 7 días · 30 días**. La línea va en azul agua (`--chart-line`) y, **por debajo del umbral, en cálido** (`--chart-thirsty`): los ratos con sed se ven sin leer nada. El umbral es una **banda suave** (`--chart-band`), nunca una raya dura. Los **huecos se quedan en hueco** (la línea se corta y una veladura `--chart-gap` lo marca), nunca se interpolan; lo anterior al primer dato del hub no cuenta como hueco. Los **riegos** van debajo: punto lleno los tuyos, anillo los automáticos. Al tocar (o con el ratón, o con las flechas) se ven **el valor y la hora exactos**, y desde ahí "Ver el invernadero así" abre el rebobinado en ese momento. Hay una tabla equivalente para lectores de pantalla y **"Descargar CSV"** del periodo visible.
- **Estado vacío honrado**: con menos de tres lecturas no hay gráfica, sino una frase: "Aún hay poco historial: el hub guarda datos desde el 8 oct, 16:08. La gráfica se irá llenando." Con el hub caído, la última gráfica que llegó y la nota tranquila de siempre.
- **Último riego** sale del historial del hub (30 días), con quién lo hizo: "hoy a las 03:48 · 5 s · automático".
- **Rebobinar**: el botón redondo con el reloj hacia atrás (bajo Ajustes). La **barra de rebobinar ocupa el sitio del dock**, así que desde el pasado no se puede ordenar nada; la ficha de la planta dice "Estás viendo el pasado: vuelve a ahora para regar" y su botón queda deshabilitado. La línea de estado cambia a **"Así estaba el jue, 8 oct, 13:18"** (con el reloj, en `--water-ink`) y las lecturas de entonces; los avisos se apartan mientras tanto. Encima de la línea de tiempo se ve **dónde hay datos y dónde no**. En un hueco, la escena se duerme (`--scene-saturation-asleep`) y lo dice: "Sin datos a esta hora". Mientras carga un tramo dice "Cargando", no "sin datos". **"Volver a ahora"** (o Escape) devuelve el directo de un toque. El día y la noche siguen la hora rebobinada.
- **Cifras tabulares solo en el valor**: el número de la lectura de la gráfica va en `.reading`; la hora del rebobinado, no (esta fuente ensancha ":" y ",").

## El invernadero entero: clima y depósito (A11, D100)

- **Dónde se abre**: tocando las lecturas de la cabecera ("16° dentro · 9° fuera · 78 %", que son un botón: "Ver el invernadero") o la línea del depósito del dock, que la abre en **Depósito**. También `?open=greenhouse` (y `greenhouse:tank`). Es una hoja como la de Ajustes, a toda altura en el móvil.
- **Ahora**: dentro (temperatura y humedad), fuera (AEMET, con su edad, o por qué no hay nada, con las mismas frases que Ajustes › Tiempo exterior), luz (lux y si la luz de cultivo está encendida) y depósito.
- **Gráficas** de **24 h · 7 días · 30 días** (24 h de entrada: el ciclo del día), con las reglas del historial de la planta: huecos en hueco, valor y hora al tocar (o con las flechas), "Ver el invernadero así", tabla para lectores de pantalla.
  - **Temperatura**: dentro en tinta (`--chart-air`), fuera discontinua y suave (`--chart-outside`): nunca se confunde con la del invernadero. Debajo, tres franjas alineadas con la gráfica: cuándo estuvieron la **ventana** abierta, el **ventilador** y la **luz** encendidos (`--chart-activity`), así un pico de las 15:00 se lee con su causa. La lectura al tocar lo dice: "19:15 · dentro 17 °C · fuera 9 °C · ventana abierta un rato · luz encendida".
  - **Humedad del aire**: dentro y fuera, 0–100 %.
  - **Luz**: lux en el color de acento, con los ratos de **luz de cultivo** como un velo de su propio brillo (`--chart-grow`, más tenue de noche).
  - **Depósito**: el nivel, con **cada riego** debajo (punto lleno los tuyos, anillo los automáticos) y la cuenta: "5 riegos en este periodo: 2 tuyos y 3 automáticos."
- **Fuera es de AEMET y lo dice**: "Fuera: AEMET, estación <nombre de la estación>, una lectura por hora." Si en el periodo no hubo datos de AEMET, "Fuera: AEMET no dio datos en este periodo." y solo la línea de dentro. Sus huecos (AEMET tarde o caído) también se quedan en hueco.
- **Datos**: "Invernadero, CSV" (todo lo de dentro, en bruto) y "Fuera (AEMET), CSV" del periodo visible, con la fuente en cada fila.
- **La cabecera habla menos**: solo la frase ("Todo bien", "La albahaca tiene sed") es la región viva que se anuncia; las lecturas, que cambian cada 30 s, ya no.

## Automatizaciones (A6, D89)

- **Riego** en la ficha de cada planta (sustituye a "Aún no configurado"): primero su **umbral**, "Pide agua por debajo de", que es el de la planta con el riego automático encendido o apagado (D100: por debajo se marchita, avisa y, si riega sola, riega); después "Regar sola" (apagado de serie) y, al encenderlo, segundos por riego, máximo al día, pausa tras regar y "De noche no" con su horario. Debajo del interruptor, una frase lo resume: "Riega 5 s por debajo del 35 %, como mucho 2 veces al día, con 1 h de pausa; de noche no (22:00–08:00)." Valores propuestos por la especie (docs/08).
- **Ajustes › Ventilación y luz**: "Ventilar sola" (ventilador desde, ventana también desde, margen para parar, o con humedad desde) y "Encender la luz sola" (horario, o con el sol: desde el amanecer y hasta el anochecer, con desplazamientos; "solo con poca luz natural"), con la vista previa "Hoy, de 08:17 a 21:46". La fila de Ajustes dice qué hay encendido ("Ventila sola · Luz con el sol") o "Apagadas: las mueves tú".
- **El estado de cada cambio, sin fingir** (D85): "Guardando…", y **"Aplicado en el invernadero"** (con una marca) solo cuando el invernadero lo confirma; mientras no, un tranquilo **"Pendiente: el invernadero aún no lo ha confirmado."**. Si lo rechaza, en tono cálido: sigue con lo anterior. Sin "Deshacer": se cambia otra vez y se guarda.
- **Cada acción automática explica por qué**: "Último riego" ("hoy a las 03:48 · 5 s · Riego automático · tierra 33 % < 35 %"), la lectura de la gráfica al tocar un riego, el menú Aire ("Automático: 28,4 °C ≥ 28 °C") y la luz del dock ("Encendida · auto", con el motivo al pasar por encima). Solo mientras ese estado siga siendo obra de la automatización.

## El cierre de la fase A: diario, planta y maceta (A12, D100–D102)

- **Etiquetas en el diario**: encima de la nota, botones que se hunden al elegirlos (D81), y en la entrada, en una línea antes del texto. De una planta: Regada a mano, Siembra, Trasplante, Poda, Cosecha, Plaga, Hoja amarilla. Del invernadero: Depósito rellenado, Mantenimiento, Sensor cambiado, Fallo, Fuga. **Una etiqueta sola es una nota**: "Regada a mano" con un toque y "Guardar nota". La lectura de la gráfica la dice ("Nota: Regada a mano"), así una subida de la tierra sin riego tiene explicación.
- **Diario del invernadero**, en su hoja (A11): lo que no es de una planta (rellenar el depósito, cambiar un sensor, un fallo de verdad), con las mismas reglas que el de una planta (primero en el móvil, "Se guardará cuando el hub responda", "Deshacer" al borrar).
- **Planta**, en la ficha: nombre y siembra (los mismos que Ajustes › Plantas), su edad ("Sembrada hace 23 días", también bajo el dial) y, si llegó después de otra, "En esta maceta desde el 15 de octubre". **"Planta nueva en esta maceta"** explica lo que va a pasar y pide el nombre y la siembra de la nueva: la de antes queda en el diario ("Planta nueva en la maceta. Antes estaba Pepa, sembrada el 20 de agosto.") y la maceta empieza de nuevo. No se deshace; por eso se confirma.
- **Automatizaciones activas** en Ajustes: una fila por lo que se mueve solo (el riego de cada planta, ventilación, luz, las reglas del tiempo), con su frase, que lleva a donde se cambia. "Ninguna: todo lo mueves tú." si no hay.
- **Texto al 200 %**: el dock pasa a dos filas, el dial y la columna del eje de las gráficas crecen con el texto, el valor de un deslizador no se parte, y un título largo se divide con guion ("Inverna-dero"); las tablas para lectores de pantalla no ensanchan la hoja.

## Avisos (A7, D91)

- **Ajustes › Avisos** empieza por el límite honesto, en tono cálido: "Los avisos los envía el hub del PC: con el PC apagado o dormido no llega ninguno." Si el hub no responde, lo dice también.
- **"Activar avisos"** es el único sitio donde se pide el permiso del navegador (nunca al cargar). Si el navegador no puede (sin instalar la app en un móvil) o el permiso está bloqueado, lo explica y dice cómo arreglarlo. Activado: "Probar aviso" (le llega solo a ese dispositivo) y "Desactivar avisos".
- **Qué avisa**: un interruptor por tipo (Depósito, Límites de seguridad, Previsión de helada, Sin datos, Plantas con sed), con lo que significa y si suena de noche. Se guarda al momento en este dispositivo y en el hub. Debajo, la política en una frase: horas de silencio 23:00–08:00 salvo los críticos, un aviso por cosa, recordatorio como mucho cada 4 h y "Resuelto".
- **Últimos avisos**: los incidentes del hub, abiertos primero, con cuándo empezaron, si siguen abiertos o cuándo se resolvieron, y "sin enviar (horas de silencio)" cuando esperaron.
- **La helada y el calor** que mantiene el dispositivo salen también entre los avisos de la app: "Ventana cerrada por frío · 4,2 °C".
- Tocar una notificación abre la app en lo que avisa: la ficha de la planta, el menú Regar (depósito) o el menú Aire.

## Pantallas y vistas

| Vista | Contenido |
|---|---|
| Invernadero (inicio) | Escena + estado + dock |
| Detalle de planta | Hoja de detalle sobre la escena |
| Historial | Línea de tiempo deslizable: la escena "rebobina" a ese momento; gráficos minimalistas debajo |
| Invernadero (su hoja) | Ahora, gráficas de clima y depósito, el diario del invernadero, CSV (A11) |
| Automatizaciones | Cada una donde actúa: el riego en la ficha de su planta, ventilación y luz en Ajustes, el tiempo exterior en Ajustes. **"Automatizaciones activas"** en Ajustes las lista todas, de solo lectura, y cada fila lleva a su sitio (D100) |
| Diario | Notas y fotos por planta con etiquetas, junto a lo que hizo el invernadero, por días; el del invernadero en su hoja (A8, A12) |
| Ajustes | Apariencia, calidad del 3D, sonido; Plantas, Avisos, Ventilación y luz, Tiempo exterior, Ubicación; automatizaciones activas; bienvenida; acerca de. Sin unidades: °C, %, lux y es-ES (D100) |
| Primera vez | Bienvenida en 4 pasos (qué es, cómo leerlo, tocar y mirar, la conexión) |

## Patrones de feedback

- **Acción en curso**: el botón se convierte en un indicador de progreso lineal fino ("Regando · 4 s").
- **Acción confirmada**: el invernadero real confirma (ACK) → pequeño cambio en la escena + texto breve. Si no hay confirmación en 5 s, se avisa con calma y se ofrece reintentar.
- **Sin "Deshacer" en los ajustes ni los conmutadores** (D85): el control muestra el estado y es el camino de vuelta. "Deshacer" solo al borrar una nota o una foto del diario. Lo que no se puede deshacer (una planta nueva en la maceta) se explica y se confirma antes.
- **Avisos**: tarjetas pequeñas que se apilan arriba, se cierran solas si no son importantes. Nunca modales para avisos.
- **Vacío**: textos amables e ilustrados ("Aún no hay notas. Cuéntale algo a tu albahaca.").

## Usabilidad y accesibilidad (checklist)

Marcada el 2026-10-15 (A12), cada punto con su prueba:

- [x] Objetivos táctiles ≥ 44 × 44 px. `a11y.spec.ts` mide cada botón, enlace, campo, interruptor y opción en el inicio, la ficha, Ajustes y la hoja del invernadero, en móvil y escritorio; `interface.spec.ts`, la zona táctil de cada planta a cualquier zoom.
- [x] Acciones principales alcanzables con el pulgar (mitad inferior en móvil): el dock va abajo y la ficha se abre a media altura con "Regar ahora" a la vista (capturas `…-faseA-2-*`, `…-faseA-12-*`).
- [x] Navegación completa con teclado, foco visible con `--focus`: `interface.spec.ts` ("every plant is reachable with the keyboard", "shortcuts: 1–6, H and ?"), la bienvenida y el asa de la hoja con teclado (`settings.spec.ts`, `watering.spec.ts`), las gráficas con las flechas (`history.spec.ts`, `a11.spec.ts`).
- [x] Toda la escena tiene un **resumen accesible** (lista de plantas y su estado) para lectores de pantalla: `a11y.spec.ts` ("the scene has a text summary"); y la vista "Sin 3D" es una lista.
- [x] Contraste AA en día y noche: `tokens.test.ts` (cada par de tokens) y axe en `a11y.spec.ts` (inicio, ficha y hoja del invernadero, de día y de noche; con la hoja ya quieta, no a medio aparecer).
- [x] Textos escalables hasta 200 % sin romper el diseño: `a11y.spec.ts` (sin desplazamiento lateral, sin texto cortado y nada fuera de la pantalla, en móvil y escritorio); capturas `…-faseA-12-texto-200-*`.
- [x] `prefers-reduced-motion` respetado: `a11y.spec.ts` (`--motion-scale` vale 0) y `watering.spec.ts`. `prefers-color-scheme`, **a propósito no** (P11): el día y la noche siguen al sol del invernadero, y Ajustes › Apariencia deja fijarlos (`tokens.test.ts`, "follows the real sun").
- [x] Funciona sin sonido y sin 3D: el sonido está apagado de serie; `settings.spec.ts` ("without 3D the plants are a list and the model is never downloaded").
- [x] Idioma: español; fechas y números con formato `es-ES`: `<html lang="es">`, `format.test.ts` ("number formatting (es-ES)").

## Rendimiento como parte del diseño

Una app bonita que va a tirones deja de ser bonita.

- Objetivo: 60 fps en un móvil de gama media; primera carga útil < 3 s en wifi.
- La interfaz aparece antes que el 3D (el diorama llega con un fundido).
- Degradado automático de calidad si baja el rendimiento (ver [`05-arquitectura.md`](05-arquitectura.md)).

## Cómo se diseña

1. Bocetos rápidos de pantallas (Claude puede generarte mockups para opinar sobre ellos).
2. Prototipo real en la fase 1 con geometría provisional: la estética se decide **en el navegador**, no en imágenes estáticas.
3. Revisión sistemática: captura de pantalla → crítica con Claude → ajuste de tokens.
