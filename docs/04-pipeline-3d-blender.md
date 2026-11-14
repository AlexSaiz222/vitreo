# 04 · Pipeline 3D con Blender

Cómo se modela el invernadero en Blender, con luz horneada, y cómo llega a la web.

**Quién hace qué (D54)**: el modelado lo hace **Claude directamente en Blender**, con la conexión desde la app de Claude (MCP) o con scripts `bpy`. La persona **no aprende Blender**: dirige la estética con referencias, capturas y comentarios, y decide qué se aprueba.

## El enfoque híbrido

| Qué | Dónde | Por qué |
|---|---|---|
| Forma, proporciones, biselados | Blender | Control fino y formas orgánicas |
| Luz, sombras, oclusión | Blender (horneado) | Calidad de render "de ilustración" a coste casi cero en la web |
| Estados (tierra húmeda, planta mustia) | Blender (shape keys) + código | Se modelan los extremos; el código mezcla según los datos |
| Movimiento, interacción, datos | Código (R3F) | Todo lo vivo |

## Parte 1 · Cómo se trabaja

El ciclo de cada pieza:

1. **Referencia**: la persona indica qué quiere (imágenes de `referencias/`, sobre todo ref-03, y comentarios).
2. **Modelado**: Claude lo construye en Blender. Siempre que se pueda, con un **script `bpy` reproducible** guardado en `assets/blender/scripts/` (por ejemplo `build_pot.py`), que reconstruye la pieza desde cero: así cada cambio es revisable en git y se puede repetir.
3. **Revisión en Blender**: render o captura de la vista; la persona comenta; se itera.
4. **Exportación y optimización** (Parte 7): `.glb` a `assets/export/`, luego `pnpm models`.
5. **Revisión en la app**: Claude la integra, comprueba presupuesto y rendimiento y hace capturas comparando con lo anterior (`pnpm capture`). La persona aprueba o pide cambios.

La persona no necesita tocar Blender. Si quiere mirar algo, basta con abrir el `.blend` y orbitar.

## Parte 2 · Cómo trabaja Claude con Blender

1. **Blender MCP** (conexión desde la app de Claude): Claude crea y modifica la escena directamente y puede ver el resultado. Ideal para iterar rápido y para lo orgánico (plantas, detalles).
2. **Scripts `bpy`**: para lo repetitivo y exacto (perfilería, cristales, macetas, renombrado según las convenciones, exportación). Se ejecutan desde la pestaña *Scripting* o vía MCP.

Reglas:

- Trabajar sobre `assets/blender/*.blend` versionados (Git LFS); las copias automáticas `*.blend1` no se suben.
- **`vitreo.blend` es el archivo maestro** (lo edita Claude en Blender): se incluye **siempre** en el commit cuando cambia, junto a los scripts de `assets/blender/scripts/` (`build_greenhouse.py`, `bake_lightmaps.py`, `export_vitreo.py`) y a lo exportado (`assets/export/`, `assets/textures/`). Así cada versión del modelo queda en el historial con el código que la genera.
- **`assets/blender/backups/` no se versiona** (`.gitignore`): son copias locales de versiones anteriores, y Git ya guarda el historial de cada una (las v12–v17 que llegaron a subirse siguen en commits anteriores).
- Toda pieza reutilizable debe poder **regenerarse por script**; lo que se haga a mano por MCP se anota en el propio `.blend` o en el script.
- El `.glb` exportado **nunca se edita a mano**: se corrige en Blender y se vuelve a exportar.
- Los colores salen de la paleta de tokens (`apps/web/src/styles/tokens.css`, `--scene-*`). En la app mandan los tokens: los materiales del `.glb` se sustituyen por los de la paleta.

## Parte 3 · Convenciones de la escena (contrato con el código)

El código encuentra los objetos **por su nombre**. Respetar esto es obligatorio.

```
Collection "structure"      base, gravel, path, steps, floor_main, frame_main,
                            frame_details (juntas y tornillos), gutter, glass_main,
                            door (empty en la bisagra) > door_leaf, vent_window ("open")
Collection "devices"        tank, tank_water, tank_hose, pump, grow_light (con la tira
                            "light_strip"), fan, fan_blades, sensor_box, vent_servo, cables
Collection "decor"          decor_ground, decor_plants
Collection "plants"
    plant_<id>              p. ej. plant_basil_01
      pot_<id>
      soil_<id>             material propio (se oscurece con la humedad)
      foliage_<id>          con shape keys: "wilt", "grow_0..3"
Collection "helpers"        cam_home, cam_focus_<id>, anchor_<id>  (empties)
Collection "preview"        cámara, sol y "página" para juzgar el render (no se exporta)
```

Así está `vitreo.glb` desde la v13: todo lo de arriba salvo `grow_0..3`. `pnpm models` comprueba que estén todos los nodos y que **cada material tenga un nombre conocido** (la app elige su color por el nombre):

| Material | Token | Dónde |
|---|---|---|
| `plinth`, `tray`, `path` | `--scene-plinth`, `--scene-tray`, `--scene-path` | Zócalo, bandeja (con grano de arena), camino y escalones |
| `floor`, `frame` | `--scene-frame` | Suelo y perfilería |
| `glass` | `--scene-glass` | Cristales (shader propio, casi invisible) |
| `terracotta`, `leaf`, `soil_<id>` | ver "Follaje" y las plantas | Plantas |
| `device`, `device_dark` | `--scene-device`, `--scene-device-dark` | Depósito, lámpara, ventilador, canalón, caja de sensores, servo / tapón, manguera, bomba, cables |
| `fan_back`, `fan_blade` | `--scene-fan-back`, `--scene-fan-blade` | Ventilador |
| `hardware`, `gasket` | `--scene-hardware`, `--scene-gasket` | Juntas, tornillos, tirador / burletes |
| `water` | `--scene-water` | Visor de nivel del depósito |
| `led` | `--scene-led` | Piloto de la caja de sensores |
| `light_strip` | `--scene-light-strip` (encendida: `--scene-night-glow`) | Tira de la lámpara |
| `decor` | `--scene-decor` (tinte) × `COLOR_0` | Decoración: usa su color de vértice |

- Nombres en **inglés**, `snake_case`, sin espacios ni acentos.
- `<id>` coincide con el identificador de la planta en la app y en MQTT (ver [`05-arquitectura.md`](05-arquitectura.md)).
- **Empties** (objetos vacíos) marcan puntos de cámara y anclas para etiquetas o partículas. Solo cuenta su **posición**: `cam_home` es el punto al que mira la cámara en reposo y `cam_focus_<id>` el punto al que mira al elegir una planta; la dirección de la vista (23° de elevación y 41° de azimut, como la cámara `preview_cam`, D60) y el zoom los pone la app.
- 1 unidad = 1 metro. Origen del mundo en el centro del zócalo, a ras de suelo. Cada planta (`plant_<id>`) con su origen en la base de la maceta.
- **Follaje**: un solo material (`leaf`) y dos atributos por vértice:
  - `tone` (color, el **atributo de color activo**, se exporta como `COLOR_0`): el color de cada hoja, pétalo o fruto, con los tokens `--scene-leaf-deep`, `-mid`, `-new`, `-light`, `--scene-flower-white`, `--scene-flower-heart` y `--scene-fruit`. La app cambia cada color por el **token más cercano** con su valor actual (D61), así que un ajuste de paleta no exige reexportar; `pnpm models` avisa si un color exportado se aleja de los tokens.
- **Decoración** (`decor_ground`, `decor_plants`): material `decor` y su color en `COLOR_0`, usado tal cual (multiplicado por `--scene-decor`); `decor_plants` lleva además `_WIND` y se mece como las plantas.
  - `_WIND` (float, atributo propio; el guion bajo inicial hace que el exportador lo incluya con ese nombre): cuánto se mueve con el viento, 0 en la base y 1 en las puntas.

### Escala (D57)

Los modelos de Blender son **siempre a tamaño real** (la maceta mide 13 cm). Con el invernadero completo en Blender (D59), la app ya monta todo **a 1:1**: el escalado temporal ×2,2 de la primera maceta ha desaparecido. La cámara y las luces se ajustan a los límites reales del modelo, así que cambiar de tamaño en Blender no exige tocar números en el código. El tamaño actual (86 × 52 cm, alero 34 cm, caballete 56 cm) es provisional hasta resolver P02.

### Dispositivos del diseño avanzado (colección `devices`)

Objetos de las imágenes de diseño avanzado (`02-direccion-artistica.md`, D53). Cada uno representa un dato o actuador (`06-gemelo-digital.md`):

| Objeto | Qué es | En la app (D62) |
|---|---|---|
| `tank` | Depósito exterior, junto a la pared | — |
| `tank_water` | Agua del visor de nivel, con el origen en el fondo | Escala en altura = `tank.level` (suave); **oculta si el nivel es desconocido** (`null` no es "vacío") |
| `tank_hose`, `pump`, `cables`, `vent_servo` | Manguera, bomba, cables, servo de la ventana | — (la manguera podrá marcar el pulso de riego) |
| `grow_light` | Lámpara bajo el caballete; su tira inferior usa el material `light_strip` | La tira brilla con `actuators.growLight` y una luz cálida (siempre presente, intensidad 0 apagada) ilumina plantas y suelo: la tira mira hacia abajo y desde la cámara el encendido se lee en esa luz |
| `fan` | Carcasa del ventilador en el hastial | — |
| `fan_blades` | Aspas, con el origen en el eje | Giran en x con `actuators.fan` (1,5 vueltas/s, arranque y parada suaves); quietas con movimiento reducido |
| `vent_window` | Ventana de tejado con bisagra | Shape key `open` = `actuators.vent` |
| `sensor_box` | Caja de sensores; piloto con el material `led` | Piloto encendido mientras los datos llegan en directo |

`door` es un empty en la bisagra (girado −8°: puerta entreabierta) con la hoja `door_leaf` dentro; la app respeta su rotación. La **decoración** es opcional y hay que dosificarla para que no compita con las plantas reales.

Proyectan sombra solo las piezas grandes (zócalo, escalones, perfilería, puerta, ventana, canalón y dispositivos); la decoración, `frame_details`, los cables y el suelo no, para ahorrar triángulos en la pasada de sombras.

## Parte 4 · Estilo en Blender

- Formas: biselado pequeño en todo (*Bevel* con 2–3 segmentos). Perfiles blancos algo gruesos.
- Materiales: colores planos de la paleta ([`02-direccion-artistica.md`](02-direccion-artistica.md)), rugosidad alta (0,7–0,9), sin metalicidad.
- Luz de trabajo: un sol cálido bajo + un entorno blanco suave. Render en Cycles para hornear.
- Cristal: en Blender se usa solo como referencia visual; en la web tendrá un material propio más barato (transparencia + fresnel), porque la transmisión física es cara en móviles.

## Parte 5 · Horneado de luz

**Estado: en uso desde la v15** (D64). Lo hace `assets/blender/scripts/bake_lightmaps.py`.

### En Blender

1. **UV de luz.** Los objetos horneados (lista en el script y en `lightmaps.json`) reciben un único mapa UV, `UVMap_Light`, empaquetado en un atlas compartido; se exporta como `TEXCOORD_0` (es su única UV). Las piezas que compartían malla se han hecho únicas (cada maceta tiene su `pot_<id>`).
2. **Solo luz, sin color.** Cycles, *Diffuse* directo + indirecto, **sin *Color***: el lightmap guarda luz y sombra (con la oclusión), no el color del material.
3. **Tres atlas** de 2048 px (desde la v16; 1024 en la v15) sobre las mismas UV, con 16 px de margen entre islas (bordes extendidos): `day` (sol + cielo), `night` (luna + resplandor interior) y `lamp` (solo la lámpara de cultivo).
4. **Formato.** PNG sRGB de 8 bits normalizado: luz lineal = textura decodificada × `intensity` (en `assets/textures/lightmaps.json`, por atlas).
5. **Marca.** Cada objeto horneado lleva el extra `"lightmap": true`.

Horneados (v18): zócalo, bandeja, camino, escalones, suelo, perfilería, `decor_ground`, macetas y tierra. El canalón dejó de hornearse en la v18 (su lightmap salía como una franja negra) y pasa a sonda, como la puerta. **No** horneados (luz dinámica): cristal, follaje, `decor_plants`, `frame_details`, puerta, ventana, aspas y todos los dispositivos (el depósito y la bomba dejaron de hornearse en la v17). La app lo sabe por el extra `lightmap`: no hay que tocar código al cambiar la lista. Las hojas ya no dejan sombra dura en el horneado y la ventana se hornea sin ella.

### En `pnpm models`

- Comprueba que cada objeto de `lightmaps.json` exista, tenga `TEXCOORD_0` y el extra, y que nada diga estar horneado sin estar en la lista.
- Conserva las UV de luz con **14 bits** (meshopt cuantiza; 12 por defecto sería poco para un atlas).
- Convierte los atlas a **WebP calidad 90** (a 2048 px, ≈ 1 MB los tres, frente a 6,3 MB en PNG; menos calidad crea bandas en los degradados) y escribe `apps/web/public/models/lightmaps.json` para la app. Modelo y texturas comparten el presupuesto de 4 MB (v16: ≈ 2,1 MB). Si un día no cabe: bajar la calidad o pasar a KTX2.

### En la app (`scene/lightmaps.ts`)

- Los objetos marcados usan su material de siempre (color del token, color de vértice, tierra según la humedad, atenuado de la selección), pero **solo con la luz horneada**: color × (día ↔ noche + lámpara × encendido) × exposición. No reciben luz ni sombras dinámicas (nada se ilumina dos veces); la emisión sí se suma, y la tierra conserva el brillo especular de mojada (es un dato).
- **Día ↔ noche** se mezcla de forma continua con la altura real del sol (suncalc): todo día con el sol a +6°, todo noche a −6° (fin del crepúsculo civil). Con `?theme=` forzado, 0 o 1. El tema de la interfaz sigue cambiando en el horizonte.
- **Lámpara**: el atlas `lamp` se suma con `actuators.growLight` (fundido de 0,3 s). La tira `light_strip` es emisiva aparte, y una luz dinámica sigue iluminando lo que no está horneado (hojas).
- **Exposición**: × 2^−0,45, la del render de Blender (`preview`), para que la app se parezca al render.
- **Balance de blancos y contraste de día** (D134, `DAY_GRADE` en `scene/lightmaps.ts`): la luz horneada de día sale cálida entera (el sol y su rebote en la arena), y multiplicada por un blanco lo volvía melocotón. `pnpm models` mide su tinte medio (`atlases.day.tint`) y el shader lo quita casi todo, sube un poco el contraste con un hombro suave (una cara al sol enseña el color de su token, sin quemarse) y devuelve calidez solo a la sombra (`--scene-shadow`). Vale igual para las sondas. Tras rehornear no hay que tocar nada: el tinte se vuelve a medir.
- **Sol** en la dirección del de Blender (`preview_sun`) para lo no horneado.
- **Sin mapa de sombras** (D67): las sombras sobre la página son **estáticas**, una textura dibujada una vez (`scene/groundShadow.ts`): la de contacto bajo el zócalo y los escalones, y de día la sombra larga del invernadero, su planta proyectada en la dirección del sol y muy difuminada. Con sombras dinámicas, la perfilería dejaba franjas duras en la página.
- **Comprobar desde otro ángulo**: `?azimuth=221` mira desde atrás (captura `…-trasera.png`).
- **Primeros planos**: `?look=<nodo>` centra la vista en una pieza (p. ej. `?look=tank&zoom=3.5`). `pnpm capture` lo usa para el marcador del depósito al 0, 50 y 100 % (`…-deposito-*.png`): `tank_water` tiene el origen en la base de la ventana del marcador y escala en altura con `tank.level`.
- **Sin N8AO**: la oclusión está horneada.
- **Relleno nocturno** (D69): de noche, lo horneado y lo iluminado por sonda reciben una luz muy suave, entre la luna y la luz interior, para que la cara exterior de la perfilería no quede negra.
- **Sondas de luz para lo no horneado** (D68): `pnpm models` guarda en `lightmaps.json`, para cada malla sin horneado, un **cubo de luz ambiente**: la luz que llega de cada una de las seis direcciones (±x, ±y, ±z), en los tres atlas, calculada con las 400 muestras horneadas más cercanas (sin las caras que miran al suelo; en cada dirección, de día el cuarto más luminoso de las que miran hacia ella (D70), porque las superficies vecinas se hornearon a la sombra de la propia pieza; de noche y para la lámpara, todas, D69). La app ilumina esas piezas solo con su sonda (`probeLight` en `scene/lightmaps.ts`): mezcla día ↔ noche y lámpara como los lightmaps, y el cubo da luz distinta a cada cara según hacia dónde mira. Así la puerta, la ventana (también abierta), el ventilador o el depósito casan con la perfilería horneada de día, de noche y con la lámpara. Quedan con luz dinámica solo las hojas, la vegetación decorativa, la tira de la lámpara y el piloto.
- **Filtrado**: con mipmaps y **anisotropía 4**. Las islas están a 19 px (a 2048), así que los mipmaps solo mezclarían vecinas desde el nivel 3 (8× de reducción), que la cámara no alcanza; la anisotropía mantiene en niveles finos las superficies rasantes (el suelo a 23°). Sin mipmaps (`LinearFilter`) no habría ninguna mezcla, pero las sombras horneadas parpadearían al orbitar. Comprobado con capturas de móvil y zoom mínimo: sin costuras con ninguna de las tres opciones.

Resultado (`pnpm perf`, GPU del portátil): de 92 a **48 *draw calls*** y de ≈ 116 k a **≈ 88 k triángulos** por frame, a 60 fps (v15); con 6 macetas (v16), **54 *draw calls* y ≈ 102 k triángulos**. Con la luz cálida de la v19 (D71: sol `#FFE2BF`, cielo `#F4ECE1`, los mismos que `--scene-sun` y `--scene-sky`), 53 *draw calls* y ≈ 105 k triángulos. Sin pasada de sombras por frame ni pasadas de oclusión.

### Problemas resueltos en la v16

- El canto del hueco de la ventana salía oscuro con la ventana abierta: ahora se hornea **sin la ventana**.
- Costuras oscuras en el borde del zócalo: eran **solapes** de piezas; el borde es ahora de una sola pieza, con más margen UV y bordes extendidos. También se hornea sin el suelo de la vista previa.

Pendiente de ajuste fino: con la lámpara encendida, las macetas salen algo más saturadas que en el render (el suelo coincide).

## Parte 6 · Estados con *shape keys*

Las *shape keys* son versiones deformadas de un mismo objeto que se mezclan de 0 a 1. Se exportan en glTF como *morph targets* y el código las controla.

| Shape key | Objeto | Controlado por |
|---|---|---|
| `wilt` | `foliage_*` | Humedad de tierra baja (mustia) |
| `grow_0..3` | `foliage_*` | Etapa de crecimiento (manual o por días) |
| `open` | `vent_window` | Posición del servo |
| `fog` (opcional) | `glass_*` | Mejor hacerlo por shader |

## Parte 7 · Exportar y optimizar

Proceso real, probado con el primer ejercicio (`plant_basil_01`) y con el diorama completo (`vitreo.glb`).

### El diorama en cinco pasos

**Orden**: `build_greenhouse.py` → `bake_lightmaps.py` → exportar → `pnpm models`. **Si se regenera el modelo hay que volver a hornear**: la reconstrucción pierde la UV de luz.

| Paso | Cómo | Qué hace |
|---|---|---|
| 1. Regenerar | En Blender, con `assets/blender/vitreo.blend` abierto, ejecutar `assets/blender/scripts/build_greenhouse.py` (pestaña *Scripting*, o por la conexión de Claude) y **guardar** | Reconstruye desde cero las colecciones `structure`, `plants`, `helpers` y `preview`. Las medidas están en el diccionario `P` (planta 86 × 52 cm, alero 34 cm, caballete 56 cm, zócalo 110 × 78 cm, macetas a ±21 / ±12 cm…); las macetas y la tierra salen de `exercises/pot_basil_01.blend` y las plántulas se generan en el propio script |
| 2. Hornear | En Blender, ejecutar `assets/blender/scripts/bake_lightmaps.py` (Cycles; tarda) y **guardar** | Crea la UV de luz, hornea los tres atlas en `assets/textures/` y escribe `lightmaps.json` (Parte 5) |
| 3. Exportar | `pnpm models:export` | Abre Blender sin ventana y ejecuta `scripts/export_vitreo.py`: exporta `structure`, `plants`, `helpers` y `devices` (no `preview`) a `assets/export/vitreo.glb` con las opciones de la tabla de abajo. No guarda nada en el `.blend`. Busca Blender en `$BLENDER`, en las carpetas habituales (también Steam) o en el `PATH` |
| 4. Optimizar | `pnpm models` | Comprueba el contrato y el horneado, optimiza y convierte los lightmaps a WebP (ver 2 y Parte 5) |
| 5. Comprobar | `pnpm capture`, `pnpm perf` | Capturas (incluida la comparación con ref-03 y el render) y rendimiento |

Regla: el `.glb` nunca se edita a mano y el `.blend` tampoco se toca a mano sin pasar el cambio al script (si una pieza se ajusta a mano por la conexión, se anota y se lleva a `build_greenhouse.py` antes de dar el cambio por bueno).

El render de referencia se hace con la cámara de la colección `preview` y se guarda en `referencias/progreso/<fecha>-blender-invernadero-vN.png`; `pnpm capture` toma el de mayor `N` para la comparación.

### 1. Exportar desde Blender

Lo hace `export_vitreo.py`. A mano: *File → Export → glTF 2.0*, con estas opciones:

| Opción | Valor |
|---|---|
| Formato | glTF Binary (`.glb`) |
| Incluir | Solo la jerarquía de la pieza (`plant_<id>` y sus hijos) |
| Transformación | +Y arriba |
| Malla | Aplicar modificadores, normales, UV |
| Color de vértice | El activo (`tone`) → `COLOR_0` |
| Atributos | Sí: exporta los atributos que empiezan por `_` (`_WIND`) |
| Shape keys | Sí, con normales (se exportan como *morph targets*, con su nombre) |
| Materiales | Exportar, con *Backface Culling* (la app los sustituye por la paleta) |
| Compresión | **No** (la hace el paso 2) |
| Animaciones | No |

Destino: `assets/export/plant_<id>.glb`, con el nombre de su nodo raíz.

### 2. Optimizar: `pnpm models`

`assets/scripts/optimize-models.mjs` (gltf-transform + meshoptimizer) procesa todo `assets/export/` y escribe `apps/web/public/models/`:

1. **Comprueba el contrato**: en cualquier archivo, cada `plant_<id>` con `pot_<id>`, `soil_<id>`, `foliage_<id>`, la shape key `wilt`, el tono (`COLOR_0`) y el viento (`_WIND`); en `vitreo.glb`, además, la estructura (`base`, `gravel`, `path`, `steps`, `floor_main`, `frame_main`, `glass_main`, `door`), `vent_window` con `open`, `cam_home`, un `cam_focus_<id>` por planta y **una planta por cada zona de la app** (`scene/zones.ts`). Rechaza el antiguo nombre `pot_<id>.glb`. Si falta algo, falla y no copia nada.
2. **Optimiza**: `dedup` (de mallas, accesores y texturas; **no de materiales**: sus nombres son el contrato con la app aunque Blender les dé los mismos valores, y en la v13 la perfilería acababa con el material del zócalo), `prune` (conservando atributos y los empties, que son nodos hoja) y **meshopt** (reordenar, cuantizar, comprimir). Conserva shape keys, `COLOR_0` y `_WIND`. La cuantización mueve la escala a los nodos y lleva el **origen de cada nodo con malla al centro de su malla** (lo compensa en la geometría, así que todo queda en su sitio): por eso la app copia las transformaciones de cada nodo. Para lo que la app escala o gira sobre su origen (`tank_water`, `fan_blades`), el pipeline separa el nodo en un empty con el origen de Blender y la malla como hija `<nombre>_mesh`; `door` ya llega así desde Blender (empty en la bisagra con `door_leaf`).
3. **Informa** de tamaño, triángulos y *draw calls*, y avisa de lo que conviene corregir en Blender: materiales de doble cara, demasiados triángulos o materiales, y **tonos de hoja que no coinciden con los tokens** (lee `tokens.css` y dice el token más cercano).
4. **Limpia** de `apps/web/public/models/` los modelos que ya no están en `assets/export/`.

### 3. Componente: `pnpm models:jsx <nombre>`

Genera con **gltfjsx** un andamiaje en `assets/generated/<nombre>.tsx` (no es código de la app): muestra nodos, transformaciones, materiales y shape keys del modelo optimizado. En Windows gltfjsx estropea la ruta y repite la cabecera; el script lo corrige. **No funciona con `vitreo.glb`**: gltfjsx 6.5 lleva dentro un three.js antiguo cuyo cargador falla con una malla con shape keys compartida por varios nodos (`foliage_seedling`). Sirve para modelos sueltos; para el diorama basta con `pnpm models` y el listado de nodos de este documento.

La app no usa el andamiaje: sus componentes son genéricos y buscan los nodos por nombre (`apps/web/src/scene/models/`):

- `diorama.ts` (`useDiorama`): carga `vitreo.glb` y lee de los empties el punto de reposo de la cámara (`cam_home`), el foco de cada planta (`cam_focus_<id>`), los límites del diorama y de las plantas, y lo que pisa la página (`base`, `steps`).
- `GreenhouseModel.tsx`: estructura, dispositivos y decoración, recorriendo cada nodo y sus hijos con sus transformaciones (los empties incluidos), con los **materiales de la paleta** según el nombre del material de Blender (tabla de la Parte 3). Los dispositivos responden al store como dice la tabla de dispositivos. La arena de la bandeja recibe coordenadas de textura desde arriba (en Blender no tiene UV).
- `PlantModel.tsx`: cada `plant_<id>` donde lo pone el `.glb`, conectada al store como sigue.
- `CameraRig` encuadra el diorama entero por su tamaño real proyectado (`scene/cameraFit.ts`) y `Lights` deriva del mismo tamaño la posición del sol, las sombras y la luz nocturna. La sombra de asentamiento bajo el zócalo es una textura difuminada dibujada una vez con la planta de `base` y `steps` (el zócalo no se mueve).

Cada planta:

- **Geometría** del `.glb`; **materiales** de la paleta (mate, sin especular).
- **Tierra**: color y brillo según la humedad del store (lógica en `scene/potLook.ts`).
- **`wilt`**: la shape key sigue al umbral de la planta.
- **Color**: `COLOR_0` como color de vértice, cambiado por el token más cercano (`scene/models/leafTones.ts`); el material es blanco y uno solo.
- **Escala e inclinación** de cada nodo (`foliage_<id>`, `pot_<id>`) tal como vienen de Blender.
- **Viento**: el shader (`scene/wind.ts`, compartido con la decoración) lee `_WIND` (en three, `_wind`) y mece las hojas unos milímetros, lento, con una fase propia por planta; se detiene con `prefers-reduced-motion`.

Una planta nueva necesita su `plant_<id>` y su `cam_focus_<id>` en Blender y su zona en `scene/zones.ts`; `pnpm models` avisa si falta una de las dos partes.

### 4. Comprobar

- `pnpm perf`: fps, *draw calls* y triángulos **por frame** (escena, sombras y post-procesado) con la GPU del PC.
- En el móvil: abrir la app con `?stats` para ver los fps.
- `pnpm e2e`: el presupuesto de *draw calls* y triángulos es un test.
- `pnpm capture`: capturas de la app, la ventana cerrada y abierta, y la comparación a tres bandas ref-03 · render de Blender · app (`…-comparacion-ref-03-blender.png`).

### Presupuesto

| Métrica | Objetivo |
|---|---|
| Tamaño de los `.glb` | < 4 MB en total (ideal < 2 MB) |
| Triángulos por frame | < 150 k (contando las pasadas de sombra) |
| *Draw calls* por frame | < 100 (ídem) |
| Por planta (guía) | ≤ 3 000 triángulos y ≤ 3 *draw calls* |
| Texturas | Atlas 2048 px máx., KTX2 |

## Estructura de archivos 3D

```
assets/
  blender/
    vitreo.blend            archivo maestro (D58)
    exercises/              prácticas (pot_basil_01.blend: maceta y tierra que usa el maestro)
    scripts/                bpy: build_greenhouse.py (generador paramétrico), export_vitreo.py,
                            build_pot.py
  scripts/                  pipeline: export-blender.mjs (pnpm models:export),
                            optimize-models.mjs (pnpm models)
  generated/                andamiajes de gltfjsx (referencia, no se usan en la app)
  textures/                 lightmaps horneados (PNG) y lightmaps.json
  export/                   vitreo.glb tal como sale de Blender
apps/web/public/models/     vitreo.glb optimizado (lo que carga la app)
apps/web/src/scene/models/  diorama.ts, GreenhouseModel, PlantModel, leafTones
```

Usar **Git LFS** para `.blend`, texturas y `.glb`.

## Orden de trabajo

1. ✓ Ejercicio de la maceta (`plant_basil_01`), pipeline completo hasta verla en la web (ver abajo).
2. ✓ Bloqueo (*blockout*) del invernadero: proporciones y encuadre, comparado con ref-03 (renders v1–v3).
3. ✓ Estructura final generada por script (`build_greenhouse.py`).
4. ✓ Zócalo, grava, camino y escalones (sin mesas: D51).
5. Macetas ✓ y plántula genérica ✓; faltan las plantas por especie.
6. Iluminación y horneado día/noche.
7. Shape keys ✓ (`wilt`, `open`) y nombres ✓; faltan `grow_0..3` y los dispositivos (`devices`).
8. ✓ Exportar, optimizar, integrar (D59). Falta revisar en el móvil real.

## Primer ejercicio: `plant_basil_01`

Resultado: el pipeline funciona de punta a punta y la albahaca de Blender sustituye a su maceta provisional en la app, conectada al store (tierra, `wilt`, viento y tono de las hojas).

| | Primera versión | Segunda versión (correcciones hechas) |
|---|---|---|
| Archivo | `pot_basil_01.glb` | `plant_basil_01.glb` |
| Tamaño exportado → optimizado | 138 KB → 50 KB | 60 KB → 24 KB |
| Triángulos | 6 800 (maceta 5 760, hojas 720, tierra 320) | 2 448 (maceta 1 408, hojas 720, tierra 320) |
| *Draw calls* | 5 | 3 |
| Escena completa (`pnpm perf`, GPU del PC) | 60 fps · 77 *draw calls* · ≈ 56 k triángulos | 60 fps · 73 *draw calls* · ≈ 48 k triángulos |

**Correcciones** tras la primera versión, todas hechas en la segunda:

1. ✓ **Maceta demasiado densa** (5 760 triángulos): sin subdivisión, 1 408. La planta entera queda en 2 448 (guía ≤ 3 000).
2. ✓ **Hojas en 3 materiales**: un solo material `leaf`; el tono va en `COLOR_0` y el viento en `_WIND`.
3. ✓ **Colores de las hojas con la paleta antigua**: ahora con los tokens. Queda un matiz: el tono claro salió como `#97A05A` en vez de `#ABAC68` (`pnpm models` lo avisa); en la app no se nota, porque manda la paleta.
4. ✓ **Materiales de doble cara**: *Backface Culling* activado.
5. ✓ **`wilt` demasiado extremo**: ahora caen las puntas y se inclina el tallo.
6. ✓ **Hojas pequeñas**: un 35 % más grandes.
7. ✓ **Nombre de archivo**: `plant_basil_01.glb`, como su raíz.
8. **Escala**: decidido (D57), ver "Escala" en la Parte 3. El ×2,2 es temporal.

## Lecciones del prototipo de la fase 1

La escena provisional hecha por código (`apps/web/src/scene/`) sirve de referencia para el modelo real, con estas salvedades:

- En la primera pasada de la fase 1 las macetas estaban **sobredimensionadas** (≈ 0,44 m de diámetro) para que la tierra se leyera; tras ref-03 (D51) son pequeñas (≈ 0,29 m), en el suelo y sin banco. En Blender hay que **revisar la escala y el número de macetas** (4 ahora; la propuesta de `08-plantas.md` es de 4 zonas más una bandeja) buscando el equilibrio entre realismo y legibilidad de la tierra, que es el indicador clave.
- Las plantas deben quedar **más estrechas que la boca de la maceta** para que la tierra siga visible desde la cámara isométrica.
- Decisiones que conviene conservar (ref-03): perfiles con cantos muy redondeados y mates, oclusión ambiental suave (en el prototipo, N8AO y un truco de shader en las uniones; en Blender, AO horneada), zócalo de arena con bandeja hundida y laterales algo más oscuros hacia abajo, sombra larga y suave hacia atrás a la derecha, cristal casi invisible y cámara ortográfica (D40).
- Paleta de referencia: `apps/web/src/styles/tokens.css` (`--scene-*`) y la tabla de `02-direccion-artistica.md`.
