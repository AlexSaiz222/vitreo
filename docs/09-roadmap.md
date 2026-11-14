# 09 · Hoja de ruta

Fases pensadas para que siempre haya **algo bonito funcionando**. Duraciones orientativas para un proyecto personal a ratos. Las fases 2 y 3 pueden ir en paralelo (Blender mientras llega el hardware).

**Orden actual (D99)**: cerrar la fase A → hardware (fases 3–5, después de Navidad) → meses de datos reales → fase B, modelos propios. Sin funciones con LLM por ahora.

## Fase 0 · Cimientos (≈ 1 fin de semana)

- Repositorio con la estructura de [`05-arquitectura.md`](05-arquitectura.md), pnpm workspaces, TypeScript estricto, ESLint/Prettier, Git LFS.
- `CLAUDE.md` y esta carpeta `docs/` dentro del repo.
- `packages/shared` con los tipos y esquemas del contrato MQTT.
- Mosquitto en local con Docker.

**Hecho cuando**: `pnpm dev` arranca una página en blanco y el broker acepta conexiones.

## Fase 1 · Prototipo visual (≈ 2–3 semanas)

El objetivo es **decidir la estética en el navegador** antes de modelar en serio.

- Escena R3F con geometría provisional generada por código (invernadero de cajas y cilindros con la paleta real).
- Cámara isométrica: probar ortográfica vs. perspectiva cerrada; órbita con límites e inercia.
- Luz, sombra de contacto, fondo blanco, niebla leve.
- Shell de interfaz: barra superior, línea de estado, dock, hoja de detalle, tokens de diseño.
- Simulador publicando datos; la tierra cambia de color y la planta se mustia.
- Día/noche manual.
- PWA instalable.

**Hecho cuando**: se puede instalar en el móvil, se ve bonito, y tocar "Regar" en el simulador oscurece la tierra.

**Estado (2026-09-30)**: hecho. La PWA se sirve por HTTPS con Tailscale (D48) para instalarla en el móvil; `pnpm e2e` comprueba que "Regar" oscurece la tierra. Capturas en `referencias/progreso/`.

## Fase 2 · Blender (≈ 3–6 semanas, en paralelo)

Modela **Claude** en Blender (MCP o scripts `bpy`); la persona dirige la estética con referencias y capturas (D54).

- ✓ Ejercicio de la maceta (`plant_basil_01`), con pipeline completo hasta la web: `pnpm models`, `pnpm models:jsx`, `PotModel`. Segunda versión con todas las correcciones (`04-pipeline-3d-blender.md`).
- ✓ Modelos siempre a tamaño real (D57); el escalado temporal ya no existe.
- ✓ Blockout y estructura por script (`build_greenhouse.py`, D58), zócalo, camino y escalones; macetas y plántula genérica.
- ✓ Pipeline con un comando por paso: `pnpm models:export` → `pnpm models`.
- ✓ La geometría provisional sustituida por `vitreo.glb` (D59): cámara desde `cam_home` y `cam_focus_<id>`, ventana conectada a `actuators.vent`.
- ✓ Plantas por especie (escala e inclinación por nodo); dispositivos, juntas, canalón y decoración conectados al store (v13, D62). Cámara como la de Blender (D60).
- Revisar la v13 en el móvil real (carga y 60 fps) **antes de hornear**.
- ✓ Horneado día/noche con la luz de la lámpara aparte (v15, D64; `04-pipeline-3d-blender.md`, Parte 5). Pendiente en el horneado: el canto del hueco de la ventana y costuras en esquinas del zócalo.
- `grow_0..3`.
- ✓ **6 macetas (D63, v16)**: cebollino y tomate cherry enano modelados (maceta y tierra del tomate a escala 1,2), disposición 3 × 2; `chives_01` y `tomato_01` en `zones.ts`, en el simulador, en los e2e y en el contrato de `pnpm models`; tokens de sus colores (D65). Queda para la fase 3: 6 sensores y más riego (`07-hardware.md`).
- ✓ **v19 (D71)**: luz cálida de media tarde (sol `#FFE2BF`, cielo `#F4ECE1`) en Blender, horneado, tokens y sondas; hiedra probada y descartada. `pnpm models`: 2,1 MB de 4, ≈ 105 k triángulos, 52 *draw calls*; `pnpm perf` (portátil): 60 fps, 53 *draw calls*.

**Hecho cuando**: el modelo final carga en < 3 s en el móvil y va a 60 fps.

## Fase A · Mejoras de la app, con interfaz neumórfica (aprobada el 2026-10-07, D72–D79)

Recupera el plan de interfaz aplazado el 2026-10-03 y reúne lo que antes estaba repartido entre las fases 4, 6 y 7 (historial, automatizaciones, avisos, diario, atmósfera). Todo se desarrolla contra `apps/simulator`; lo que necesita hardware sigue en las fases 3–5. AEMET va al final.

### Reglas de la fase

**Estilo: neumorfismo, solo como lenguaje de material** (imagen de referencia no incluida). Se toma el material, no la composición de *dashboard*: el invernadero 3D sigue siendo el protagonista y el HUD sigue siendo compacto.

- **Superficies del mismo color**, en relieve, con una luz clara arriba a la izquierda y una sombra suave abajo a la derecha. Huecos hundidos (*inset*) para lo pulsado y lo activo. Botones en píldora, un indicador de dial con marcas, radios generosos y una paleta casi monocroma con acentos mínimos.
- **Una sola dirección de luz** (arriba a la izquierda) para todos los brillos y sombras, la misma del sol del diorama.
- **Sobre el lienzo 3D**: los paneles flotantes son **opacos**, con una sombra de caída normal y suave. El relieve y los huecos van **dentro** de los paneles. Sin cristal ni `backdrop-filter`, lo que además ahorra trabajo a la GPU: el desenfoque sobre un lienzo WebGL se recalcula en cada frame.
- **Tokens derivados de los que ya existen**, con `color-mix()`:
  - la base de día sale de `--scene-frame` (blanco arcilla, el de la perfilería);
  - las sombras salen de `--scene-shadow` (cálidas, nunca negras, D52);
  - la base de noche sale de `--scene-night-bg` mezclado con `--scene-night-glow`: oscuro cálido, brillo más sutil y sombra más profunda.
  - Los valores exactos se fijan con capturas en A1.
- **Usabilidad antes que estética**:
  - texto ≥ 4,5:1 sobre todas las superficies, comprobado en `tokens.test.ts`;
  - indicadores de estado, iconos y anillo de foco ≥ 3:1 frente a la base (WCAG 1.4.11; el relieve por sí solo no llega);
  - ningún estado depende solo de la sombra: un interruptor activo va hundido **y además** lleva acento, icono o texto;
  - anillo de foco visible con `--focus`;
  - objetivos ≥ `--target-min`;
  - la pulsación (relieve → hueco) dura `--duration-press` (140 ms) × `--motion-scale`, así que es instantánea con `prefers-reduced-motion`.
- **La acción principal** (Regar) sigue rellena de `--ink` (D46). Es el único acento fuerte de la interfaz.
- **Rendimiento**: solo `box-shadow` estáticas (sin animar la sombra en bucle). 60 fps en el móvil con el HUD abierto: `pnpm perf` mide también con la hoja y los Ajustes abiertos, y en el móvil se mira con `?stats`.
- **Reglas como código** (D49): un test recorre los `.css` de `apps/web/src` y falla si encuentra `backdrop-filter` o un color literal fuera de `tokens.css`.
- **Cada pantalla nueva usa las primitivas de A1**. No se escriben botones ni paneles sueltos.

**Forma de trabajo en cada incremento**:
- una rama por incremento;
- `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm e2e` (la suite rápida, ≈ 2 min) en cada cambio; `pnpm e2e:full` (todo, con las capturas de cada fase, ≈ 4 min) antes del *merge* y de `pnpm release` (D95);
- en lo visual, capturas de **día y noche × móvil y escritorio** (`CAPTURE_TAG=faseA-<n>`);
- docs en español; código y commits en inglés;
- al terminar: *merge* a `main`, *push* y `pnpm release` (D92: la única forma de publicar, solo desde `main` limpio y subido);
- las decisiones nuevas se registran en `11-decisiones.md`.

**Contrato**: todo cambio se hace primero en `packages/shared` (zod) y en `docs/05`. Los campos y tipos nuevos son aditivos y opcionales, y se mantiene `"v": 1`. Hoy todos los consumidores están en el monorepo y aún no hay firmware; cuando lo haya, un cambio incompatible subirá `v`.

### A0 · Dirección estable (antes de A7) ✓

- La máquina que sirve Vitreo se llama **`vitreo`** en Tailscale: la app vive en `https://vitreo.<tailnet>.ts.net` (D75). Hoy es el PC; cuando llegue la Raspberry Pi, el PC cambia de nombre y la Pi toma `vitreo`, con el hub y su base de datos (donde están las suscripciones *push*). Se reinstala la PWA una vez, ahora.
- Todos los puertos de los contenedores se publican en `127.0.0.1` y nunca se usa Tailscale Funnel (D74).
- Procedimiento en `05-arquitectura.md`, "Acceso desde el móvil".

### A1 · Sistema de diseño neumórfico y migración del HUD ✓

**Hecho (2026-10-08, D80)**: tokens y primitivas, HUD migrado (título y estado en su propia superficie, dock, hoja), Figtree + Instrument Serif, noche azul tinta con un toque de lámpara, test de reglas de CSS, tests de primitivas, axe en el HUD real de día y de noche, `pnpm perf` con la hoja abierta (60 fps en el portátil). Capturas `…-faseA-1-*`. Pendiente de la persona: 60 fps en el móvil con `?stats` y elegir la cursiva del nombre latino.

**Ajustes tras usarlo (D81, 2026-10-08)**: hundido solo para pulsado/seleccionado/campo, gota de humedad en la lista, acción principal teñida de agua, día/noche como botón de icono y cabecera sin tarjeta; P08 reabierta con tres parejas. Capturas `…-hud-antes-*`, `…-hud-despues-*`, `…-hud-antes-despues-*` y `…-hud-fuentes-comparacion-*`. Aprobados el 2026-10-08, con las tipografías de D82 (Young Serif + Schibsted Grotesk, 81,5 KB).

- **Alcance**:
  - **Tokens**: `--surface` pasa a ser opaco (`--surface-raised`, `--surface-inset`). Se añaden:
    - `--neu-light` y `--neu-dark`;
    - relieve `--elev-raised-sm` / `--elev-raised-md` / `--elev-raised-lg`;
    - hueco `--elev-inset-sm` / `--elev-inset-md` y `--elev-pressed`;
    - `--elev-float`, la sombra de caída de los paneles sobre el lienzo;
    - `--radius-card`, `--radius-pill` y `--duration-press`.
    - Variante de noche completa. Se retiran `--blur-panel` y `--shadow-soft`.
  - **Primitivas** en `apps/web/src/ui/primitives/`:
    - `Surface` / `Card` (en relieve, hundida o flotante);
    - `Button` (píldora; la principal en `--ink`) e `IconButton` (con `aria-label` obligatorio por tipo);
    - `Toggle` (`role="switch"`), `Segmented` (`radiogroup` con flechas) y `Slider` (el `input range` nativo con estilo: teclado y lectores gratis);
    - `DialGauge` (SVG con marcas, `role="meter"`; el valor siempre en texto; `null` → "—" y "sin dato");
    - `ListRow`, `Chip` y `Sheet` (la hoja actual extraída: lateral en escritorio, inferior en móvil, foco atrapado, `Esc`, arrastre);
    - **`Toast`**, que no estaba en la lista y hace falta para los avisos apilados y "Deshacer".
  - **Catálogo de primitivas** solo en desarrollo (`?ui=lab`), de día y de noche, para capturas y tests de accesibilidad.
  - **Migración** a las primitivas de `StatusLine`, `ThemeToggle`, `Dock` y `PlantSheet`. Se mantienen sus textos, comportamiento y tests.
  - **Tipografías** (P08): 2–3 opciones de sans humanista o geométrica suave, con cifras tabulares, todos los glifos del español y poco peso, en capturas del HUD real (día y noche, móvil). Elige la persona. Se sirven desde la app (precacheadas por la PWA, sin Google Fonts en tiempo de ejecución).
  - **Punto de control**: antes de migrar el HUD, la persona aprueba el aspecto con capturas de las primitivas (día y noche, móvil y escritorio).
- **Paquetes y ficheros**:
  - `apps/web/src/styles/tokens.css`, `tokens.test.ts`, `base.css`;
  - `apps/web/src/ui/primitives/*` (un `.tsx` y un `.css` por primitiva; se mantiene CSS plano, lo que cierra P12);
  - `apps/web/src/ui/{StatusLine,ThemeToggle,Dock,PlantSheet}.tsx`, `ui.css`;
  - `apps/web/e2e/{captures,perf}.spec.ts`;
  - `docs/03` (tokens, sombras, paneles) y `CLAUDE.md` (tokens `--elev-*`).
  - Dependencias de desarrollo: `@testing-library/react`, `jsdom` y `@axe-core/playwright`.
- **Contrato**: ninguno.
- **Tests**:
  - contraste de texto e indicadores en día y noche sobre la base y el hueco;
  - el test de CSS (sin `backdrop-filter` ni literales);
  - Vitest + Testing Library para teclado y ARIA de cada primitiva (`Toggle` con Espacio, `Segmented` con flechas, `Slider` con Inicio/Fin, `Sheet` devuelve el foco);
  - axe en Playwright sobre el HUD y el catálogo, de día y de noche;
  - `pnpm perf` con la hoja abierta.
- **Verificar en el móvil**:
  - abrir la PWA de día y de noche (botón Día/noche);
  - pulsar Luz y Aire: se hunde en ≈ 140 ms, con acento e icono;
  - abrir una planta y regar;
  - con "Reducir animaciones" de Android, la pulsación es instantánea;
  - `?stats` con la hoja abierta: 60 fps.
- **Decisiones a registrar**: los valores de los tokens neumórficos (D72 ya fija el estilo); CSS plano por primitiva (cierra P12); tipografías (cierra P08).

### A2 · Plan de interfaz: tocar, encontrar y avisar

**Hecho (2026-10-08, D83, D84)**: zonas táctiles en la escena, nombres y avisos anclados con oclusión y borde, avisos generales y "Deshacer" bajo la cabecera, depósito en el dock, vista inicial, atajos, fichas de especie y reglas de avisos en `shared`. Riego inmediato con "Detener" (orden `waterStop`). 60 fps en el portátil con varios avisos. Capturas `…-faseA-2-*`. El menú ⋯ pasa a A3. Revisión en el móvil (D85): e2e aislados del simulador en uso, límites de seguridad con nombre y hora, sin "Deshacer" en los conmutadores (avisos solo para fallos), marcas que se apartan con menús y hojas, Aire en un globo compacto. Capturas `…-faseA-2-revision-*`.

- **Alcance**:
  - **Zonas de toque invisibles** de ≥ 44 px por planta, porque a tamaño real una maceta mide ≈ 30 px en el móvil. Son botones HTML anclados a la planta con `<Html>` de drei, en el punto más alto del contorno de `plant_<id>`. Se calcula en la app: no hace falta tocar Blender ni rehornear.
  - **Etiqueta** con el nombre y el estado en una frase al pasar el ratón o al enfocar con teclado. `Tab` recorre las plantas en orden y `Enter` abre la hoja.
  - **Avisos anclados**: un `Chip` con icono y texto ("Tiene sed", "Sin dato") solo sobre las plantas que necesitan algo.
  - **Vista inicial**: botón, doble toque en el fondo y tecla `H`.
  - **Atajos**: `1`–`6` para las plantas, `L` para la luz, `Esc` y `?` para la lista de atajos.
  - **Barra superior** (docs/03): Vitreo · hora · estado día/noche · menú. El menú solo enseña lo que ya existe; no hay entradas desactivadas.
  - **Depósito siempre visible**: `DialGauge` compacto en la barra o la línea de estado, con texto. `null` → "Depósito: sin dato"; vacío → `--warm`.
  - **Avisos apilados** arriba con `Toast`: los no importantes se cierran solos, los importantes se quedan; `aria-live` y nunca modales.
  - **"Deshacer"** (5 s) como infraestructura del `Toast`. Su primer uso real llega en A3 y luego en A6.
  - **Fichas de especie** en `packages/shared/src/species/` (nombres, artículo, nombre científico, umbral por defecto, rangos cómodos, horas de luz). Cierra D38; `zones.ts` se queda solo con lo visual.
  - **Avisos derivados** en `packages/shared/src/alerts/` (función pura sobre la telemetría, la frescura de los datos y las especies). La usa la app ahora y el hub en A7, con la misma regla.
- **Paquetes y ficheros**:
  - `packages/shared/src/{species,alerts}/`;
  - `apps/web/src/scene/` (anclas y zonas de toque, que solo leen del store);
  - `apps/web/src/ui/{TopBar,TankGauge,AlertStack,PlantAnchors}.tsx`;
  - `apps/web/src/app/shortcuts.ts`;
  - `statusPhrase.ts`, que pasa a usar las fichas.
- **Contrato**: sin cambios en MQTT. En `shared` se añaden los módulos `species` y `alerts`, que no son topics.
- **Tests**:
  - unidad de `alerts` (sed, sensor roto, depósito bajo o vacío, datos antiguos, desconexión; IDs estables y sin duplicados);
  - unidad de las fichas (cada zona de `ZONES` tiene ficha);
  - e2e:
    - tocar la zona de cada planta abre su hoja (en móvil);
    - con el teclado se llega a las 6;
    - con `soil 0.1` desde el simulador aparece "Tiene sed" sobre esa maceta y en la pila;
    - el depósito muestra "sin dato" con el sensor roto;
  - axe; capturas.
- **Verificar en el móvil**:
  - tocar cada maceta con el pulgar sin fallar;
  - secar una maceta desde el PC (`curl …/soil`): aparece el aviso anclado y en la pila;
  - vaciar el depósito (`tank_empty`): el indicador pasa a `--warm` con texto;
  - doble toque: vuelve a la vista inicial.

### A3 · Ajustes del dispositivo, modo sin 3D y bienvenida

**Hecho en `feat/phase-a3-settings` (2026-10-08, D86), revisado, en `main` y publicado**: Ajustes (apariencia, calidad, bienvenida, acerca de) desde el botón de arriba a la derecha, calidad Auto/Alta/Baja/Sin 3D con lista de plantas sin 3D (también como respaldo sin WebGL), bienvenida en cuatro pasos. Sin "Deshacer" (D85). Capturas `…-faseA-3-*`.

- **Alcance**:
  - **Ajustes** en un `Sheet`, con lo que es de **este dispositivo** (en `localStorage`, con `try/catch`):
    - **Apariencia**: Auto / Día / Noche con `Segmented`; sustituye al botón del HUD y lo respeta el script inicial (D67).
    - **Calidad**:
      - **Auto** baja a Baja si el frame pasa del presupuesto (`PerformanceMonitor`).
      - **Alta** es la actual.
      - **Baja**: `dpr` 1 y sin fresnel del cristal; más adelante, sin partículas.
      - **Sin 3D**: no descarga la escena y muestra una vista 2D con la lista de plantas, sus `DialGauge` y acciones. Es también el respaldo si WebGL falla y cumple el punto de docs/03.
    - **"Ver la bienvenida"** y **Acerca de** (versión, dispositivo, conexión).
  - Primer uso real de **"Deshacer"** al cambiar un ajuste.
  - **Bienvenida** (docs/03 "Primera vez"):
    - tres pantallas: qué es Vitreo; cómo leer la escena (tierra oscura = húmeda, planta mustia = sed, escena gris = sin conexión); tocar una planta y los atajos;
    - un paso de conexión con el estado real (en directo, simulador o sin conexión);
    - se ve una vez, se puede saltar y funciona con teclado.
  - **Lo que se mueve de sitio** respecto a tu lista de Ajustes:
    - **Ubicación** y **Plantas** son del invernadero, no del móvil: el PC y el móvil deben coincidir, y el hub y el simulador también las usan. Por eso llegan con el hub (A4).
    - **Sonido** llega con la atmósfera (A9). Un interruptor que no hace nada no sería honesto.
- **Paquetes y ficheros**: `apps/web/src/features/settings/`, `features/onboarding/`, `features/list-view/`; `app/themeChoice.ts` y `app/quality.ts`; `scene/Scene.tsx` (calidad); `App.tsx`.
- **Contrato**: ninguno.
- **Tests**:
  - unidad del almacén de ajustes (lectura con el almacenamiento bloqueado);
  - e2e:
    - el tema se conserva al recargar;
    - "Sin 3D" no pide `vitreo.glb` (se comprueba en la red);
    - la bienvenida sale una vez;
    - "Deshacer" restaura;
  - axe; capturas (también de la vista 2D).
- **Verificar en el móvil**: primera apertura en una ventana de incógnito (bienvenida); poner Sin 3D y comprobar que la lista se lee con TalkBack; volver a Auto.

### A4 · Hub: historial en SQLite y API

**Hecho en `feat/phase-a4-hub` (2026-10-08, D87), revisado, en `main` y publicado**: hub en Docker con la base de datos en un volumen, copias y archivo en `data/hub/`, sesión MQTT persistente (sin huecos en reinicios cortos, comprobado), restauración probada, API `/api/v1` (salud, plantas, ajustes, config, historial, CSV, eventos), `config` por defecto apagada, Ajustes › Plantas y › Ubicación, mensajes tranquilos con el hub caído. Capturas `…-faseA-4-*`.

- **Alcance**:
  - **Hub portátil**: en Docker, en el mismo `docker-compose` que el broker. La imagen `node:24-bookworm-slim` es multiarquitectura, así que en la Raspberry Pi basta con copiar `infra/`, `.env` y la carpeta de datos. Nada depende de Windows.
  - **Base de datos y servidor**:
    - SQLite con `better-sqlite3` + Drizzle, en modo WAL;
    - migraciones generadas y versionadas, aplicadas al arrancar;
    - **Retención** (D77): telemetría en bruto 30 días en la base de datos y, después, **archivada comprimida por meses** fuera de ella (`data/hub/archive/AAAA-MM.csv.gz`, incluida en la copia), no borrada; agregados por hora (media, mínimo y máximo; tiempo encendido de cada actuador) para siempre; eventos, órdenes, ACK y `config`, para siempre;
    - copia nocturna con `VACUUM INTO` a `data/hub/backups/`, conservando 7.
    - Escucha solo en la red interna de Docker (D28); si publica un puerto, en `127.0.0.1` (D74).
  - **Ingesta MQTT** como usuario `hub` (`vitreo/+/#`), con la validación de `shared`. Guarda:
    - la telemetría **en bruto**, cada mensaje con su `ts` y la hora de recepción;
    - la tierra por zona con `cal`;
    - `status` (incluido el LWT), `event`, `cmd`, `ack` (con `source`) y `config`.
    - Un mensaje inválido se registra y no tumba el hub.
  - **API** `/api/v1` (Fastify, esquemas de `shared`):
    - `health`;
    - `devices`, `devices/:id/latest`;
    - `devices/:id/telemetry?from&to&step`, en bruto o por intervalos con media, mínimo y máximo;
    - `devices/:id/events`, `devices/:id/export.csv`;
    - `plants` (nombre visible y fecha de siembra; los IDs no cambian);
    - `settings` (ubicación y zona horaria). La ubicación vive en `.env` y en la base de datos del hub, redondeada a 2 decimales; **nunca en el repositorio** (D79).
  - **Mismo origen**: nginx pasa `/api/` al hub; en desarrollo lo hace el *proxy* de Vite. La app usa `/api` relativo, y `VITE_API_URL` sigue sirviendo para cambiarlo.
  - **Ajustes › Plantas** (renombrar) y **Ajustes › Ubicación**. La app la usa para el día/noche, con `VITE_LOCATION_*` de `.env` como respaldo.
  - **El hub solo funciona con el PC encendido** hasta la Pi: la app lo dice con claridad ("Historial y avisos en pausa: el hub no responde desde…"), y el dispositivo sigue con sus automatizaciones básicas (D73).
  - TanStack Query para las lecturas HTTP.
- **Paquetes y ficheros**:
  - `apps/hub/src/{db,ingest,api,backup}/`, `apps/hub/drizzle/`;
  - `infra/hub/Dockerfile`, `infra/docker-compose.yml` (servicio `hub` y volumen de datos), `infra/web/nginx.conf`;
  - `packages/shared/src/api/`;
  - `apps/web/src/data/api.ts`, `features/settings/`;
  - `.env.example`, `docs/05`.
- **Contrato**: sin cambios en MQTT. Esquemas HTTP nuevos en `packages/shared/src/api/` (versionados por ruta, `/api/v1`).
- **Tests**:
  - hub en Vitest con SQLite en memoria;
  - ingesta de los *fixtures* de `shared` (válidos, inválidos, sensor `null`, LWT);
  - API con `fastify.inject` (intervalos, CSV, plantas, ajustes);
  - migración desde cero;
  - e2e con el hub levantado: renombrar una planta en Ajustes y verla en otra pestaña tras recargar.
- **Verificar en el móvil**:
  - `https://vitreo.<tailnet>.ts.net/api/v1/health`;
  - renombrar una planta desde el móvil y verla en el PC;
  - dejarlo 24 h con el simulador y descargar el CSV.
- **Checklist de docs/12 que se cumple aquí**: telemetría en bruto (30 días) y agregados, origen de cada acción con su resultado, IDs estables, calibración versionada y exportación.

### A5 · Gráfico de historial y "rebobinar"

**Hecho en `feat/phase-a5-history` (2026-10-08, D88), revisado, en `main` y publicado**: historial de la planta (24 h · 7 d · 30 d, banda de umbral, huecos, riegos tuyo/automático, valor al tocar, CSV), último riego desde el hub, rebobinar con la barra en el sitio del dock y la escena leída por fotograma (60 fps barriendo una semana). Capturas `…-faseA-5-*`. Queda para A6+: las gráficas de temperatura, aire, luz y depósito (la API ya las da).

- **Alcance**:
  - **Historial** (`features/history/`):
    - rangos de 24 h, 7 días y 30 días;
    - gráficos pequeños en SVG propio (sin librería), con los tokens: humedad por planta con la banda del umbral, temperatura, humedad del aire, luz y depósito;
    - marcas de riego con su origen (tú, automático, seguridad);
    - huecos sin datos dibujados como huecos, nunca interpolados;
    - teclado, y una tabla equivalente para lectores de pantalla.
  - En la hoja de la planta, un **gráfico de 7 días** y el **último riego** sustituyen el estado vacío de D45.
  - **Rebobinar**:
    - una línea de tiempo (`Slider`) alimenta el store desde el historial, con `mode: 'live' | 'replay'` (docs/05); la escena no cambia porque solo lee del store;
    - el día/noche sigue la hora rebobinada;
    - la línea de estado dice "Así estaba el 3 oct a las 14:10", con "Volver al directo";
    - las órdenes se desactivan con una explicación;
    - sin datos a esa hora, la escena aparece "dormida" con un texto que lo dice.
- **Paquetes y ficheros**: `apps/hub/src/api/` (`snapshot?at=` y submuestreo); `packages/shared/src/api/`; `apps/web/src/data/{store,greenhouse,selectors}.ts` (modo *replay*); `features/history/`; `ui/PlantSheet.tsx`.
- **Contrato**: sin cambios en MQTT. En la API se añaden `snapshot` (última telemetría ≤ `at`, con su `ts` y un aviso de hueco si pasan más de 2 min, D34) y `telemetry?step`.
- **Tests**:
  - unidad del submuestreo, de la detección de huecos y del store en *replay* (nunca mezcla datos en vivo);
  - e2e:
    - abrir el historial;
    - arrastrar a ayer: cambian el color de la tierra y el texto;
    - las órdenes quedan desactivadas;
    - "Volver al directo";
  - capturas; `pnpm perf` con el historial abierto.
- **Verificar en el móvil**: rebobinar a la noche anterior con el pulgar; regar una maceta y ver la marca "tú" en su gráfico.

### A6 · Automatizaciones

**Hecho en `feat/phase-a6-automations` (2026-10-08, D89), revisado, en `main` y publicado**: `config` v2 (con rechazo de versiones desconocidas), riego por maceta con pausa y noches sin riego, ventilación en dos pasos con histéresis, luz por horario o con el sol (ubicación en `config`), simulador que aplica `config` como el firmware, confirmación `config.applied` y estado de cada cambio sin fingir, explicación de cada acción automática. Capturas `…-faseA-6-*`. Aplazado: el motor de reglas de nivel superior del hub (ninguna regla lo necesita todavía).

- **Alcance**, con el reparto de D73 y docs/05:
  - **Reglas básicas en el dispositivo, vía `config`**: riego por umbral (con `maxPerDay`), horario de luz (con `belowLux`) y ventilación. Así el invernadero sigue cuidándose con el PC apagado. Los **límites de seguridad** los aplica siempre el dispositivo, pero no viajan en `config`: son constantes del firmware (D22).
    - El **hub es el dueño de `config`**: guarda las revisiones, sube `rev` y la publica retenida. La app la edita a través de la API, porque `web` no puede publicar `config` (D23).
  - **El simulador aplica `config`** como lo hará el firmware, y lo deja escrito para la fase 5, como en D32.
    - Hoy el simulador solo se suscribe a `cmd` y **no tiene ninguna automatización de luz**. El comentario de `captures.spec.ts` y la nota de D65 que la mencionan son inexactos y se corrigen aquí.
    - Sus acciones salen con `source: "automation"`.
  - **Reglas de nivel superior en el hub** (docs/05: "si hace calor y es de día, ventila 10 min y avísame"):
    - motor de reglas con plantillas de docs/06;
    - pausa entre disparos y máximo diario por regla;
    - sus órdenes van por `cmd` con `source: "automation"` y `ruleId`;
    - nunca por encima de los límites del firmware.
  - **Interfaz** (`features/automations/`):
    - lista en lenguaje natural con `Toggle`;
    - edición en `Sheet` con `Slider` y `Segmented`;
    - "Pendiente de confirmar" hasta que el dispositivo confirma, luego "Guardado" + "Deshacer", que vuelve a la revisión anterior.
    - La hoja de la planta muestra el siguiente riego automático (sustituye el estado vacío de D45).
- **Paquetes y ficheros**:
  - `packages/shared/src/mqtt/{event,command,ack}.ts` y `api/`;
  - `apps/simulator/src/model/{greenhouse,automation}.ts`, `device.ts` (se suscribe a `config`);
  - `apps/hub/src/{config,rules}/`;
  - `apps/web/src/features/automations/`;
  - `docs/05`, `docs/06`.
- **Contrato** (`v: 1`):
  - evento nuevo `config.applied` `{ rev }`: el dispositivo confirma qué revisión aplica;
  - `ruleId` opcional en `cmd`, `ack` y `watering.*`, para poder explicar cada acción ("he regado porque…", docs/12).
  - El esquema de `config` ya existe y no cambia.
- **Tests**:
  - simulador: riego por umbral que respeta `maxPerDay` y los límites de seguridad; horario que cruza la medianoche con `tz`; `config` inválida ignorada;
  - hub: revisiones y retenido; motor con reloj falso (pausa entre disparos, máximo diario);
  - e2e: activar "Regar la albahaca por debajo del 35 %", secarla desde el simulador, y ver el riego "automático" en el historial y la tierra oscurecerse.
- **Verificar en el móvil**: activar una regla y ver "Guardado"; forzar sequía desde el PC; ver la marca "automático" en el gráfico; "Deshacer".

### A7 · Avisos y notificaciones *push*

**Hecho en `feat/phase-a7-alerts` (2026-10-08, D91), revisado, en `main` y publicado**: motor de incidentes en el hub con la misma `deriveAlerts` que la app, web push con VAPID en `.env`, Ajustes › Avisos (activar al tocar, tipos, "Probar aviso", últimos avisos, límite honesto), la notificación abre la app en lo que avisa. Capturas `…-faseA-7-*`. Queda fuera: avisos de sensores rotos y de automatizaciones por *push* (solo en la app, D91).

- **Alcance**:
  - **Motor de avisos en el hub**, con la misma función de `shared/alerts` que la app y además:
    - sin datos durante **15 min** (no 10, para no avisar por cortes breves del wifi);
    - depósito bajo (< 20 %) y vacío;
    - `safety.triggered`, `sensor.error`;
    - una planta con sed que sigue sin regar varias horas;
    - avisos de automatizaciones ("He abierto la ventana").
  - **Política de notificaciones** (D76):
    - **una notificación por incidente**, como mucho un recordatorio cada 4 h mientras siga abierto, y una actualización "resuelto" al cerrarse (sustituye a la notificación anterior);
    - **críticos** (límite de seguridad, depósito vacío): ignoran las horas de silencio;
    - el resto respeta las horas de silencio, 23:00–08:00 por defecto;
    - cada tipo se puede desactivar en Ajustes.
  - **Web push**:
    - con `web-push` y claves VAPID en `.env` (un script las genera una vez);
    - el *service worker* pasa de `generateSW` a `injectManifest` para poder recibir *push*;
    - pulsar la notificación abre la app en lo que avisa.
  - **Ajustes › Avisos**:
    - activar las notificaciones (el permiso se pide solo al tocar);
    - qué tipos avisan (todos desactivables) y horas de silencio;
    - el estado del hub ("Los avisos dependen del hub: activo desde…").
  - **Lista de avisos** en la app, con su historial.
  - **Límite honesto**: con el PC apagado o dormido no hay *push*, y la app lo dice.
- **Paquetes y ficheros**: `apps/hub/src/{alerts,push}/`; `packages/shared/src/{alerts,api}/`; `apps/web/src/sw.ts`, `vite.config.ts`, `features/alerts/`, `features/settings/`.
- **Contrato**: sin cambios en MQTT. En la API: suscripciones *push*, preferencias y lista de avisos.
- **Tests**:
  - motor con reloj falso: un aviso por incidente, recordatorio a las 4 h y no antes, "resuelto", críticos durante las horas de silencio, sin datos a los 15 min y no a los 10;
  - envío con un servidor *push* falso;
  - `pnpm pwa:check` sigue limpio;
  - e2e: el aviso aparece en la lista y en la pila.
- **Verificar en el móvil**: instalar la PWA y activar avisos; bloquear el móvil; desde el PC, `tank_empty` → notificación en ≈ 1 min; al tocarla se abre la app en el depósito.

### A8 · Diario de planta

**Hecho en `feat/phase-a8-journal` (2026-10-12, D93), revisado, en `main` y publicado**: notas y fotos por planta en "Diario", junto a los riegos, avisos y cambios del riego automático de esa planta; fotos de la cámara o la galería reducidas a 1600 px y ~300 KB y sin metadatos (comprobado en el móvil y en el hub); fotos en el volumen de Docker y en las copias nocturnas; marcas en el gráfico; "Deshacer" al borrar; sin hub, la copia del móvil y "Se guardará cuando el hub responda"; Ajustes › Acerca de dice cuánto ocupa. Capturas `…-faseA-8-*`. Cambios sobre el plan de abajo: 1600 px sin miniatura (no 2048 px), fotos en el volumen (no en `data/hub/photos/`); las etiquetas y la fecha de siembra en el diario quedan para más adelante (la fecha de siembra ya está en Ajustes › Plantas).

- **Alcance**:
  - **Notas, fotos y etiquetas** por planta. Las etiquetas (siembra, trasplante, poda, cosecha, plaga, hoja amarilla) tienen IDs estables y textos en español; son las etiquetas futuras de docs/12.
  - **Fecha de siembra**.
  - **Vista Diario**, estilo cuaderno, y "Añadir nota o foto" desde la hoja.
  - **Fotos**:
    - con la cámara del móvil (`capture="environment"`);
    - reducidas en el navegador a 2048 px más una miniatura;
    - al recodificarlas se pierden los metadatos EXIF, incluido el GPS;
    - se guardan en el disco del hub (`data/hub/photos/`, incluido en la copia).
  - Estado vacío amable (docs/03).
- **Fuera de alcance**: que el diario cambie la etapa del 3D. Necesita las *shape keys* `grow_0..3`, aún pendientes en Blender (fase 2).
- **Paquetes y ficheros**: `apps/hub/src/journal/`; `packages/shared/src/api/`; `apps/web/src/features/journal/`, `ui/PlantSheet.tsx`.
- **Contrato**: sin cambios en MQTT. En la API: entradas del diario y subida de fotos (tipo comprobado por los bytes de cabecera, tamaño máximo).
- **Tests**:
  - hub: validación de la subida y que la foto guardada no lleva EXIF;
  - e2e: nota con foto de prueba → aparece en la hoja y en el diario;
  - capturas.
- **Verificar en el móvil**: hacer una foto a una planta desde la PWA, etiquetarla y verla en el PC.

### A9 · Atmósfera

**Hecho en `feat/phase-a9-atmosphere` (2026-10-13, D96), revisado, en `main` y publicado**: sonido ambiente (Ajustes › Sonido, apagado por defecto, CC0, bucles cortos Opus que se descargan solo al activarlo, mezcla en Web Audio que sigue al gemelo, fundidos, pausa con la app oculta); la escena pasa de día a noche con todo el crepúsculo y la interfaz con un fundido de 4 s; motas de polvo de día y luciérnagas de noche; condensación según `air.rh`; viento en las hojas según ventilador y ventana. Calidad Auto: menos partículas; Baja, movimiento reducido y Sin 3D: ninguna. 55 *draw calls*. El simulador tiene el escenario `humid`. Capturas y grabación `…-faseA-9-*`. Cambios sobre el plan de abajo: bucles cortos (no ≥ 60 s), grillos y agua (la lluvia espera a AEMET), luciérnagas; las gotas sobre la tierra al regar quedan fuera (el agua ya se oye y la tierra ya se oscurece).

- **Alcance**:
  - **Sonido ambiente**, desactivado por defecto (D13, D78):
    - **grabaciones CC0** de pájaros, lluvia y viento (los pájaros sintetizados suenan falsos), en bucles cortos sin cortes, Opus/OGG;
    - se descargan solo al activar el sonido;
    - **Web Audio** para la mezcla, los fundidos y el ambiente de día, noche y tiempo (ventilador y bomba como capas);
    - solo empieza tras un gesto y se pausa con la pestaña oculta.
    - **Ajustes › Sonido** (activar y volumen).
  - **Viento**: las hojas se mueven más con el ventilador (`_WIND`). El viento exterior espera a AEMET.
  - **Partículas**:
    - motas de polvo en la luz, según los lux y la hora, en una sola malla instanciada; sin ellas en calidad Baja;
    - gotas sobre la tierra mientras riega, sincronizadas con los eventos.
  - **Condensación** en el cristal según `air.rh`, más intensa abajo (docs/06).
  - **Transición lenta del tema** de la interfaz al cambiar día/noche (la escena ya se mezcla); instantánea con movimiento reducido.
- **Paquetes y ficheros**: `apps/web/src/features/sound/`, `scene/` (partículas, viento), `shaders/glass.ts`; `apps/web/public/audio/` (LFS; licencias en docs/02); `styles/tokens.css`.
- **Contrato**: ninguno.
- **Tests**:
  - unidad de los mapeos (humedad → empañado, lux → motas, ventilador → viento);
  - e2e: sin sonido por defecto y sin descargar audio hasta activarlo;
  - `pnpm perf` con las partículas: presupuesto < 100 *draw calls*.
- **Verificar en el móvil**: activar el sonido; forzar humedad alta desde el PC y ver el empañado; regar y ver las gotas; `?stats`.

### A10 · Tiempo exterior con AEMET (cuando haya clave)

**Hecho en `feat/phase-a10-weather` (2026-10-13, D97), revisado, en `main` y publicado**: el hub consulta AEMET (observación cada 10 min, previsión horaria cada hora), lo guarda (`weather_observations`, `weather_forecasts`) y lo publica retenido en `…/weather`; sobrevive a AEMET lento o caído (lo último, con su edad) y a un reinicio. Escena: nubes, lluvia, niebla, nieve y viento con calma (calidad y movimiento reducido como A9; +1 *draw call* con lluvia o nieve). Sonido de lluvia (CC0). Cabecera: "23° dentro · 12° fuera". Ajustes › Tiempo exterior: lo que dice AEMET con "Fuente: AEMET" y la hora, o por qué no hay nada; las dos primeras reglas del hub (ventana cerrada con lluvia o viento mediante una retención que el dispositivo cumple, con solo el ventilador, salvo protección por calor o apertura a mano; aviso de helada por la tarde, con su propio tipo de aviso), cada una con su interruptor. Capturas `…-faseA-10-*`. Cliente comprobado contra AEMET real con la clave (estación elegida, acentos, previsión). Ajustes del 2026-10-14: la retención arranca también con la previsión de la hora (AEMET va 1–2 h por detrás), "· hace 1 h" junto a "fuera" y por qué se saltan las estaciones sin observaciones horarias (docs/05). Contrato: el de abajo, ampliado (`observation`, `forecast`, `tonight`), la orden `outdoorHold` y `telemetry.outdoorHold`.

- **Alcance**:
  - El hub consulta AEMET OpenData cada 10–15 min: la observación de la estación más cercana y la previsión horaria del municipio para el cielo.
  - Lo guarda junto a la telemetría (checklist de docs/12) y lo publica retenido.
  - **La escena lo refleja con calma**:
    - nubes → luz difusa y fondo algo más gris;
    - lluvia → gotas en el cristal (y su capa de sonido);
    - niebla → velo; nieve → copos escasos;
    - viento → hojas, solo con la ventana abierta.
  - Sin datos o con datos viejos: escena neutra y un texto que lo dice. "Fuente: AEMET".
- **Paquetes y ficheros**: `packages/shared/src/mqtt/{topics,weather}.ts`; `infra/mosquitto/acl` (el `hub` publica `weather`); `apps/hub/src/weather/`; `apps/web/src/data/`, `scene/`; `.env.example` (`AEMET_API_KEY`, `AEMET_MUNICIPIO`, `AEMET_ESTACION`). Municipio: Madrid, `28079` (comprobado en AEMET); la estación más cercana se elige en A10. Los valores reales solo en `.env` (D79).
- **Contrato**: canal nuevo `vitreo/<deviceId>/weather`, retenido y publicado por el hub: `{ v: 1, ts, source: "aemet", station, observedAt, temp, rh, wind: { speed, dir }, precip, sky }`, con `null` si falta un dato.
- **Tests**:
  - esquema y *fixtures*;
  - cliente de AEMET con respuestas grabadas (sin red en los tests);
  - datos viejos → neutro;
  - e2e con un `weather` publicado a mano.
- **Verificar en el móvil**: comparar la escena con el cielo real; desconectar la clave y ver el texto honesto.

### Cierre de la fase A (aprobado el 2026-10-14, D100)

Sale de la auditoría del 2026-10-14 contra docs/01, docs/03 y esta hoja de ruta. En este orden, para que la semana de prueba no espere al resto:

1. **Un umbral por planta y el simulador que no olvida** (`feat/a12-plant-threshold`, publicado antes que lo demás). **Hecho el 2026-10-14, en `main` y publicado (c6837e2)**; capturas `…-faseA-12-umbral-*` y `…-faseA-12-sed-*`.
   - el umbral de cada planta es el de su regla en `config`, con el riego automático encendido o apagado; lo usan la escena, los avisos de la app y del hub, la banda del gráfico y el riego automático; se cambia en la ficha ("Riego" › "Pide agua por debajo de");
   - el simulador diario guarda su invernadero y sigue donde estaba tras `pnpm release` o un reinicio del PC.
2. **La semana de prueba**: todas las automatizaciones del hub diario encendidas (riego de las seis plantas, ventilación y luz). **Empezó el 2026-10-14 a las 22:59:44** (config rev 3, aplicada por el dispositivo; noches tranquilas 22:00–08:00). Informe hacia el 2026-10-21 a las 23:00. **Incidencia**: del 2026-10-15 04:13 al 2026-10-16 13:42 (33,5 h) no hubo datos: Windows Update reinició el PC y Docker Desktop no volvió al iniciar sesión (su arranque estaba apagado); la tarea de inicio de sesión esperó y Windows la cortó sin aviso. Arreglo en `fix/boot-docker` (docs/05). El simulador siguió donde estaba ("2009 min away") y regó al volver. **Terminada el 2026-10-22, sin repetirla** (D104): grabó 11,3 h de ≈ 187. Hubo cinco apagones:
   - uno de Windows Update;
   - tres por el PC apagado;
   - otro de 3,7 días, porque la tarea de inicio de sesión se cortó y nada volvió a comprobarlo (`fix/repair-every-30-min`).

   Este portátil no es un servidor 24/7: la prueba continua pasa a la Raspberry Pi (fase 3), y la semana se comprueba acelerada.
3. **Mientras corre** (ninguna publicación reinicia el simulador):
   - **A11 · El invernadero entero: clima y depósito**. **Hecho en `feat/a11-greenhouse-sheet` (2026-10-15), en `main` y publicado (06cd752)**; capturas `…-faseA-11-*` (clima, temperatura con su lectura, luz y depósito en día y noche, móvil y escritorio; 7 días). Al tocar "23° dentro · 12° fuera" se abre la hoja "Invernadero", y la línea del depósito del *dock* la abre en Depósito. Gráficos de 24 h, 7 d y 30 d: temperatura dentro y fuera, humedad del aire dentro y fuera, luz (con la luz de cultivo encendida) y depósito (con cada riego). Debajo, cuándo estuvieron abiertos la ventana, el ventilador y la luz. Las reglas del gráfico de planta: los huecos son huecos, tocar da el valor y la hora con "Ver el invernadero así", tabla para lectores de pantalla y CSV. Fuera: "Fuente: AEMET", o por qué no hay nada. Capturas día y noche, móvil y escritorio, más 7 días, depósito, un hueco y AEMET sin datos.
   - **A12 · El resto del cierre**. **Hecho (2026-10-15, D102), revisado, en `main` y publicado el 2026-10-16**; capturas `…-faseA-12-*` (planta, diario con etiquetas, diario del invernadero, automatizaciones activas, texto al 200 %) y `…-faseA-11-datos-reales-dia-movil` (la hoja con los datos de la semana de prueba). Además de lo previsto: el simulador ya no anota un cambio de la luz que no cambia nada (cada reinicio apuntaba "luz apagada" de noche), y el texto al 200 % arregla el dock, el dial, el eje de las gráficas y los títulos largos.
     - la ficha de la planta con nombre, siembra y edad;
     - el diario con etiquetas (regada a mano, siembra, trasplante, poda, cosecha, plaga, hoja amarilla), notas del invernadero en la hoja de A11 y un capítulo nuevo cuando cambia la planta de una maceta;
     - el archivo con la hora de llegada al hub y los mensajes inválidos;
     - texto al 200 % en móvil y escritorio, y la checklist de docs/03 marcada con pruebas;
     - "Automatizaciones activas" en Ajustes: una lista de solo lectura que lleva a cada sitio;
     - docs/03 al día (sin Ctrl+K, unidades ni reloj en la cabecera), estados de esta hoja de ruta, el arreglo del test de Ajustes (`resetHub`, hoy solo en la rama aparcada) y el aviso de Node de `pnpm release`.
4. **El informe de la semana**. **Hecho el 2026-10-22** ([`informes/2026-10-22-semana-de-prueba.md`](informes/2026-10-22-semana-de-prueba.md)), con las 11,3 h grabadas, los apagones como incidencias y la **semana acelerada** (D104): siete días de las mismas reglas en segundos, con semilla fija y como test (`packages/sim-core/src/week.test.ts`).

   Reveló dos cosas, arregladas el 2026-10-22 (D105), y con ellas se añadió el riego de tarde (D106):
   - la luz de cultivo parpadeaba, porque su propia luz contaba como luz del día;
   - por humedad, el ventilador iba toda la noche cuando hacía frío, hasta la protección contra la helada;
   - con las noches tranquilas, la albahaca pasaba 9 h por debajo del umbral esperando a las 08:00.
5. **Ahora que la semana terminó, en su rama**: el simulador diario toma de AEMET la temperatura y la humedad de fuera (con su curva propia si AEMET no responde). Hoy se inventa la suya, y por la noche el invernadero sale 4–5 °C más frío que la calle real en la misma gráfica (A11). No antes, para que la semana sea coherente.

Fuera del cierre: demo pública (D66, plan al final), motor de reglas del hub (D89), *push* de sensores rotos (D91), gotas en la tierra (D96), cámara, etapas de crecimiento en 3D.

**Hecho cuando** la fase esté completa:
- A1–A10 en `main` ✓ (A10 publicado el 2026-10-13);
- 60 fps en el móvil con el HUD abierto;
- la checklist de accesibilidad de docs/03 marcada;
- el estado vacío de D45 sustituido por datos reales;
- el invernadero se cuida y avisa solo con el simulador durante una semana: comprobado con la semana acelerada (D104), como test. La prueba continua, en la Raspberry Pi (fase 3).

## Fase 3 · Hardware básico (≈ 2–3 semanas)

- Compra (presupuesto elegido en [`07-hardware.md`](07-hardware.md)).
- ESP32 leyendo sensores en protoboard; calibración de tierra.
- Publicación de telemetría MQTT según el contrato, con lo que pedirá la fase B (D99): la lectura en bruto de cada sensor junto a la normalizada, la versión de calibración también en el depósito, y por qué arrancó el dispositivo y cuánto lleva encendido.
- El dispositivo real con su propio `deviceId` desde el primer día (los datos del simulador quedan aparte).
- **Una segunda copia fuera del PC, antes de empezar a guardar datos reales** (propuesta de D100, por montar):
  - cada noche, después de la copia de las 03:00, una tarea programada guarda con [restic](https://restic.net) en un disco externo la última copia de la base de datos, el archivo mensual y las fotos del diario (las copia cada noche el hub a `data/hub/backups/photos/`, D101);
  - restic cifra siempre, guarda versiones y comprueba lo guardado, así que vale igual si el disco sale de casa; la contraseña, fuera del repo;
  - `pnpm status` dice cuándo fue la última copia y avisa si tiene más de 7 días o el disco no está;
  - el mismo repositorio de restic puede ir después a la Pi o a otra casa sin cambiar nada;
  - probado restaurando en una carpeta aparte.
- **La prueba continua, en la Raspberry Pi** (D104):
  - el PC no es un servidor 24/7 (informe de la semana de prueba): el hub, el broker y el simulador diario pasan a la Pi, que no se apaga ni se actualiza sola de madrugada;
  - una semana seguida con el simulador antes de conectar el ESP32, vigilada por `pnpm status`;
  - sus huecos, si los hay, salen en la app y en el informe como huecos.
- **El montaje de cada maceta, con fecha** (fase B, punto 3): volumen, sustrato y a qué profundidad va el sensor, apuntado al montar (una nota del invernadero con la etiqueta "Mantenimiento" vale para empezar).
- **La prueba de restaurar, una vez y de verdad, en la Raspberry Pi** (D101): copia (`pnpm hub:backup`), borrar una foto de prueba del volumen, `pnpm hub:restore` y la foto de vuelta, igual byte a byte; y `pnpm status` avisando si a la copia le falta una foto. Con el hub de verdad, no en el PC durante una semana de prueba.
- OTA.

**Hecho cuando**: Mosquitto recibe telemetría real válida cada 30 s durante 24 h seguidas.

## Fase 4 · Gemelo vivo (≈ 1 semana)

- La app conmuta entre simulador y dispositivo real.
- Estado de desconexión y datos antiguos con el dispositivo real.
- El historial, la API y el hub ya existen (A4).

**Hecho cuando**: mojas una maceta a mano y el 3D lo refleja en menos de 1 minuto.

## Fase 5 · Control y seguridad (≈ 2 semanas)

- Actuadores montados: bombas, luz, ventilador, servo.
- Órdenes con ACK, tiempo de espera y reintento; `requestId` idempotente (D30).
- Límites de seguridad en firmware, probados a propósito (cortar wifi a mitad de riego); comportamiento de D32.
- El firmware aplica `config` y confirma con `config.applied`, como el simulador (A6).
- Montaje definitivo en caja y en el invernadero.
- El caudal de cada bomba o emisor (ml/s), medido y guardado como calibración con versión, para saber cuánta agua es cada riego (fase B).

**Hecho cuando**: una semana de riego automático sin intervención ni sustos.

## Fase B · Modelos propios (después de meses de datos reales)

**Replanteada el 2026-10-14 (D99), sustituye al plan de IA de D98.** Por ahora no hay funciones con LLM, ni en la nube ni en local: primero, una app completa y que funcione. La fase B pasa a ser **modelos de series temporales entrenados en casa con los datos de este invernadero**. Empieza solo cuando haya **meses de datos del hardware real** (fases 3–5): entrenados con el simulador, aprenderían el simulador.

### Los tres modelos

Salen de `12-ideas-ia.md` (IA01 e IA03):

- **Previsión de la humedad de la tierra**: para cada maceta, cuánta tendrá dentro de 6, 12 y 24 h, a partir de:
  - su curva de secado;
  - la temperatura y la humedad del aire, y la luz;
  - el tiempo de fuera y su previsión.

  Es la pieza en la que se apoyan los otros dos.
- **Riego predictivo por planta** (IA01): regar antes de cruzar el umbral, y la cantidad justa.
  - Primero solo avisa, en la ficha de la planta: "Mañana a media tarde bajará del 35 %".
  - Si se activa, es una regla más de `config`, con los límites del firmware de siempre.
- **Fallos de sensores y fugas** (IA03):
  - un sensor bloqueado, con deriva o desconectado;
  - "se ha regado y la tierra no sube": la bomba, un tubo o el depósito;
  - "la tierra o el depósito bajan más rápido de lo que explica el secado": una fuga o un drenaje excesivo.

  Llegan como avisos de la app, en tono Vitreo: "Creo que el sensor de la albahaca se ha quedado fijo desde ayer".

### Cómo se trabaja

- **En casa**: entrenamiento y uso en el PC o en la Pi, con lo que guarda el hub (la base de datos y el archivo mensual). Nada sale de casa.
- **Siempre contra la línea base** (principio 4 de `12`): la regla por umbral y una curva de secado exponencial ajustada a cada maceta. Si un modelo no la mejora, no entra.
- **Validación honrada**: se separa por tiempo (se entrena con los meses anteriores y se evalúa con el siguiente), nunca al azar. Métricas:
  - error de la previsión a 6, 12 y 24 h;
  - agua usada y horas por debajo del umbral, frente a la regla por umbral;
  - en los fallos, aciertos y falsas alarmas sobre los fallos anotados en el diario y sobre fallos provocados a propósito (sacar un sensor de la tierra, cerrar un tubo).
- **La IA propone, la seguridad dispone**: ningún modelo salta los límites del firmware, y una regla nueva se activa con un toque y se explica en una frase.
- Las herramientas (lenguaje y librerías) se deciden al empezar, con los datos delante.

**Empieza** con al menos tres meses de datos reales, mejor si incluyen un cambio de estación, y con el diario anotado (riegos a mano, mantenimiento, fallos de verdad).

### Lo que ya guarda el hub para estos modelos

Comprobado en el código el 2026-10-14:

| Qué | Dónde | Cuánto tiempo |
|---|---|---|
| Telemetría en bruto cada 30 s: aire, luz, tierra por maceta (con su versión de calibración), depósito, actuadores, `fw` y `rssi`, con la hora del dispositivo | La base de datos, y después `data/hub/archive/telemetry-<dispositivo>-AAAA-MM.ndjson.gz`, el mensaje tal cual (D77) | Siempre |
| Medias, mínimos y máximos por hora, y el tiempo encendido de cada actuador | La base de datos | Siempre |
| Riegos con su duración real, origen y motivo; límites de seguridad; sensores sin dato; cambios de las reglas del dispositivo | Eventos | Siempre |
| Órdenes y sus ACK, con su origen | La base de datos | Siempre |
| Cada `config` (umbrales, horarios), con cuándo la aplicó el dispositivo | La base de datos | Siempre |
| Conexiones y desconexiones (LWT) | La base de datos | Siempre |
| Tiempo de fuera: la observación horaria de AEMET y cada previsión tal como se emitió | La base de datos | Siempre |
| Notas y fotos del diario, con su fecha | La base de datos y el volumen de fotos | Siempre |

Los datos del simulador y los reales ya van separados, por el `deviceId` (`sim` frente al del dispositivo real) y por la versión de firmware (`…-sim`). Basta con que el dispositivo real tenga su propio id desde el primer día.

### Lo que falta

Hay que tenerlo antes de que empiecen los datos reales:

1. ✓ (A12, D102) **El riego a mano y las etiquetas del diario**, aplazados en A8 (D93). Regar con regadera no deja rastro, y para un modelo es una subida de la tierra sin riego: parece un fallo. Faltan las etiquetas: regada a mano, siembra, trasplante, poda, cosecha, plaga, hoja amarilla.
2. ✓ (A12, D102) **Notas del invernadero, no de una planta**: el mantenimiento y los fallos de verdad ("rellené el depósito", "cambié el sensor de la albahaca", "tubo suelto", "fuga"). Son las etiquetas con las que se evalúan los fallos.
3. ✓ en parte (A12, D102: capítulos por maceta; falta el montaje de cada maceta, que se apunta al montar el hardware, fase 3) **Qué planta hay en cada maceta, y desde cuándo**. `basil_01` es a la vez la maceta y la planta, y la tabla de plantas se sobrescribe: el nombre y la siembra no tienen historial. Si se cambia la planta de una maceta, su historial mezcla dos plantas. También falta el montaje de cada maceta, con fecha: volumen, sustrato y profundidad del sensor.
4. ✓ (A12, D102) **Lo que pierde el archivo**:
   - la hora a la que llegó cada lectura al hub: solo guarda el mensaje del dispositivo, y esa hora sirve para ver si el reloj del dispositivo se desvía o hay retrasos;
   - los mensajes inválidos: quedan en una tabla limitada que se va borrando, y un sensor que empieza a mandar valores imposibles es justo un fallo.

   Es un cambio pequeño en el hub.
5. **La lectura en bruto de los sensores**:
   - la tierra viaja normalizada (0–1) con su versión de calibración, pero sin la lectura del ADC: con una calibración mala no hay forma de rehacerla, y la deriva se ve peor;
   - el depósito tampoco la lleva, y además no tiene versión de calibración.

   Serían campos opcionales del contrato, para que el firmware ya nazca con ellos (fase 3).
6. **Cuánta agua es un riego**: hoy se guardan los segundos, no el caudal. Hace falta el caudal de cada bomba o emisor (ml/s), medido al montar y guardado como calibración con versión (fase 5).
7. **Los reinicios del dispositivo**: `status` solo dice `online` u `offline`. Para distinguir un reinicio de un fallo de sensor, el firmware debería decir por qué arrancó y cuánto lleva encendido (fase 3).
8. **Una sola copia**: la base de datos, las copias nocturnas (con las fotos del diario) y el archivo viven en el disco del PC. Antes de que haya meses de datos que no se pueden repetir, hace falta una segunda copia fuera de esa máquina: la propuesta (restic cifrado a un disco USB) está en la fase 3.

Reparto:
- 1–4 son de software y entran en el cierre de la fase A.
- 5–7 son del contrato y el firmware, y van en las fases 3 y 5.
- 8 va en la fase 3, antes de que empiecen los datos reales.

### Aparcado: el asistente con LLM

La rama `feat/phase-b1-assistant` tiene el asistente que se planeó en D98. No se fusiona ni se borra.

- Está hecho y probado con un modelo falso:
  - en el hub, herramientas de solo lectura y un tope mensual;
  - propuestas que necesitan tu toque (`source: "agent"` + `confirmedBy: "user"`);
  - Ajustes › Asistente y `pnpm ai:eval`;
  - capturas `…-faseB-1-*`.
- Nunca se probó con el modelo real, porque no había clave.
- El resumen diario no se empezó.

Si se retoma, hay que llevar la rama al `main` de entonces y volver a comprobar los modelos y los precios en la documentación oficial.

## Fases 6 y 7 · Atmósfera y Memoria (absorbidas por la fase A)

Su contenido de software pasa a la fase A: atmósfera (A9), historial y rebobinar (A5), diario (A8), avisos y *push* (A7), automatizaciones ricas (A6), revisión de accesibilidad y rendimiento (reglas de la fase A). Queda para más adelante el **timelapse con cámara** (solo con el presupuesto C, `07-hardware.md`). Se conservan los números de fase para no romper referencias.

## Fase 8 · Fuera de casa

- Tailscale como primer paso.
- Endurecer autenticación si se pasa a nube.

## Fase futura · Demo pública (plan aprobado el 2026-10-22, D103)

**Aprobado el 2026-10-22 con las respuestas de D103**; se construye por pasos (punto 10). Objetivo: que cualquiera abra un enlace y use Vitreo completo en su navegador, sin el PC de casa, sin hub, sin broker y sin hardware (portfolio y tanteo de producto). Actualiza el plan del 2026-10-03 a la app de hoy (A0–A12): hoja del invernadero, diario con etiquetas y capítulos, rebobinado, AEMET, automatizaciones, "Sin 3D".

### 1. Todo en el navegador del visitante

- **`packages/sim-core`**: el modelo puro de `apps/simulator` (`model/greenhouse.ts`, `params.ts`, `safety.ts`, `random.ts`, la memoria de D100; solo dependen de `suncalc`, `zod` y `@vitreo/shared`) pasa a un paquete compartido. El simulador de Node lo usa igual que hoy; la web, dentro de un **Web Worker**. Los límites de seguridad viajan con el modelo.
- **El mismo contrato que MQTT**: el worker emite `{ topic, payload }` de `status`, `telemetry`, `event`, `ack` y `config`, y recibe `cmd`; en la web entran por `routeMessage` (la misma validación zod). Solo cambia el transporte (`data/demoLink.ts` junto a `data/mqttClient.ts`): el store, las órdenes con ACK y la escena no cambian.
- **Un "hub de demo" en el mismo worker** (**hecho el 2026-10-23, D109**: es el código del hub, no una copia; ver abajo): la app pide hoy al hub unas veinte rutas (`/plants`, `/settings`, `/config`, `/history`, `/events`, `/alerts`, `/journal/*`, `/weather*`, `/telemetry.csv`, `/weather.csv`, `/storage`, `/push/*`, `/health`). Las de lectura responden con la semana pregrabada (punto 3) más lo que el visitante va generando; las de escritura (nombres, notas, config, capítulos) se guardan solo en memoria. **Test de contrato**: las mismas peticiones al hub de verdad sembrado con la misma semana y al hub de demo pasan por los mismos esquemas de `packages/shared/src/api` y dan lo mismo.
- **Nada sale del navegador**: build sin cliente MQTT ni `VITE_MQTT_*` (el módulo no se importa), cabecera `Content-Security-Policy: connect-src 'self'` en el hosting (aunque un fallo intentara llamar fuera, el navegador lo corta) y un e2e que falla si la página hace una sola petición a otro origen. Nada toca el PC, la tailnet ni AEMET.

### 2. Hosting gratuito (P15)

| | Cloudflare Pages | GitHub Pages | Vercel Hobby |
|---|---|---|---|
| Con el repo privado | Sí (subida directa con `wrangler`, sin conectar el repo) | No en el plan gratis: solo repos públicos | Sí |
| Límites (gratis) | 500 builds/mes, 20 000 ficheros, 25 MiB por fichero; no publica límite de tráfico | Sitio ≤ 1 GB, 100 GB/mes de tráfico (límite blando) | ≈ 100 GB/mes de tráfico; solo uso personal, no comercial |
| Cabeceras propias (CSP) | Sí (`_headers`) | No | Sí (`vercel.json`) |
| Encaja con D92 | `pnpm demo:release` desde el PC: compila, comprueba y sube | Necesita Actions o la rama `gh-pages` | CLI o integración con Git |

**Decidido (D103): Vercel Hobby, subido desde el PC** con `pnpm demo:release`, como `pnpm release`: solo desde `main` limpio y subido.

- La CLI de Vercel sube la carpeta ya comprobada (`demo-dist/`). No se conecta el repositorio a Vercel: sigue privado tal cual, y la comprobación de secretos corre donde está `.env`.
- **Dirección**: `vitreo.vercel.app` está ocupada (el 2026-10-22 sirve otra aplicación). Se propone `vitreo-demo.vercel.app`, libre ese día.
- **Cabeceras estrictas** en `vercel.json`, todo del mismo sitio:
  - `Content-Security-Policy` con `default-src 'self'` y `connect-src 'self'`, sin orígenes de fuera;
  - `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `Permissions-Policy`, que niega cámara, micrófono y ubicación.
- Sin Web Analytics ni Speed Insights de Vercel (P16: ninguna analítica).
- **Hobby es solo para uso personal y no comercial.** Si Vitreo llega a ser comercial, hay que cambiar de hosting antes: Vercel Pro, Cloudflare Pages u otro (la comparación de arriba sigue valiendo).

### 3. Una semana pregrabada: la semana acelerada (D104)

- **La semana acelerada** (`acceleratedWeek()`, en `packages/sim-core/src/week.ts`): siete días del mismo dispositivo simulado, con las reglas de la semana de prueba (rev 3), calculados en segundos con una semilla fija. `pnpm demo:week` la escribe en un único fichero revisable (`apps/web/demo/week.json`), en formato compacto, por columnas:
  - telemetría: ≈ 22 000 lecturas, cada 30 s y en cada cambio;
  - eventos con su `source`: riegos, ventana, ventilador, luz y protecciones.
- **Sin nada personal, por construcción**: no sale del hub de casa, sino del simulador.
  - Dispositivo `demo` y Madrid centro (40,42, −3,70).
  - Plantas con el nombre de su especie.
  - Ninguna nota ni foto, y sin `requestId`.
- **El tiempo de fuera** es una curva plausible de finales de octubre en Madrid, no observada. La demo lo dice ("Fuera · simulado") y nunca lo atribuye a AEMET.
- **Fechas**: la semana se desplaza **días enteros** para que acabe hoy. La hora del día se conserva, así que el sol, los riegos de la mañana y las noches tranquilas siguen cuadrando. Desde el último instante sigue el simulador del worker con el estado de ese momento (la memoria de D100).
- **Honestidad**: toda la semana es simulada, y la demo lo dice.
- La semana ya lleva los arreglos del informe (D105) y el riego de tarde (D106): es `acceleratedWeek()` tal cual, así que el paso 7 la genera con ellos.
- El fichero pasa la comprobación de secretos (punto 6) igual que el bundle.

### 4. Control de velocidad: un día en un minuto

- **Velocidades**: 1× (tiempo real), 60× (una hora por minuto) y 1440× (**un día en un minuto**), más pausa. **Al llegar, 60×**, con un botón bien visible "**Ver un día en un minuto**" que pasa a 1440× (D103). El reloj de la demo manda sobre el sol, el tema día/noche, las noches tranquilas y el riego automático.
- **A 1440×, un segundo real son 24 minutos**: el modelo da pasos de como mucho 30 s simulados, unos 48 por segundo, que es barato.
- **Lo que dura segundos se sigue viendo**: un riego, abrir la ventana o el ventilador duran 20–40 s simulados, que serían 0,02 s reales. La escena los anima con su duración mínima de siempre (`--duration-*`) y la gráfica los marca.
- **El rebobinado** recorre la semana grabada más lo que el visitante haya generado.

### 5. "Demo" bien visible, y cada visitante empieza de cero

- "**Demo · datos simulados**" en la línea de estado, siempre visible y también en el resumen accesible. Lo mismo en el título de la pestaña.
- **Nada se guarda**: recargar es empezar de nuevo, con la misma semana y el simulador desde donde la dejó. La bienvenida corta (qué es y qué probar) sale una vez por dispositivo (D112). **"Cómo se hizo"**: el cuaderno en `/cuaderno` (D113, sustituye a "solo se reserva el sitio del enlace" de D103; ver "Cómo se hizo" más abajo).
- **Lo que necesita el hub se explica, no se finge**:

  | Función | Qué ve el visitante |
  |---|---|
  | Avisos *push* | Escondidos (D110): Ajustes › Avisos dice "En el invernadero real, el hub avisa al móvil" y enseña la lista de avisos. No se pide permiso de notificaciones. |
  | Fotos del diario | Escondidas (D110): el diario de la demo solo lleva notas. |
  | Copias, almacenamiento, estado del hub | "La demo no tiene hub". |
  | Tiempo de fuera | Simulado (una curva plausible de finales de octubre), dicho así. AEMET solo en el invernadero real. |
  | Ubicación | Madrid; sin "Usar dónde estoy" (D112). Otra se queda en la pestaña. |

- **Diario**: unas pocas notas escritas para la demo, cada una marcada "**Ejemplo**" (D103). Ninguna nota tuya.
- **CSV**: sin descarga en la demo (D110).
- **Escenarios** (del plan anterior): ola de calor, depósito vacío, desconexión, sensor roto, reiniciar. Van recogidos en un menú, "**Probar situaciones**" (D103), con los límites de seguridad de siempre.
- **Idioma**: solo español por ahora; el inglés será un paso aparte, que empieza por sacar los textos de la UI (P17, D103).

### 6. Lo que nunca puede salir en la demo, con una comprobación que falla

- **Nunca**:
  - las coordenadas de casa (exactas o a menos de 2 km);
  - `AEMET_API_KEY`;
  - `HUB_VAPID_PUBLIC_KEY`, `HUB_VAPID_PRIVATE_KEY` y `HUB_VAPID_SUBJECT`;
  - las contraseñas, usuarios y URL de MQTT;
  - la dirección de Tailscale (cualquier `ts.net` y el nombre de la tailnet);
  - IPs de la red de casa.
- **Dos barreras**:
  1. **Estructural**: el build de demo usa un `envDir` sin `.env` (con un `demo.env` versionado e inofensivo), así que ningún `VITE_*` de casa puede entrar.
  2. **Comprobación**: `pnpm demo:build` termina buscando en todo `demo-dist/` (sin *sourcemaps*) y en `week.json`. Los valores los lee de `.env` en ese momento, así que el propio check no contiene ninguno. También busca la firma de mqtt.js. Si aparece algo, falla y `pnpm demo:release` no sube nada.
- **Para el repositorio** ya existe la misma idea en `fix/test-coordinates` (`scripts/private.test.mjs`, pendiente de revisión): falla si una clave, una contraseña o un par de coordenadas a menos de 2 km de casa aparece en un fichero versionado.

### 7. ¿Repo público? (P18)

**Decidido por ahora (D103): opción A**, solo la demo; este repo sigue privado y sin reescribir. La opción B (repo nuevo sin historial) queda para más adelante. Los hechos, para entonces:

Revisado el 2026-10-16 sobre los 184 commits:

- **Secretos en el historial**: ninguno. Contraseñas de MQTT, claves VAPID, clave de AEMET y nombre de la tailnet: 0 commits. Los `ts.net` que salen son genéricos (docs, `.env.example`, un test).
- **Ubicación de casa en el historial**:
  - dos fixtures de test a 130–200 m de la ubicación redondeada de casa: `messages.test.ts` (ccd93b3, 2026-10-08) y `journal.test.ts`, el GPS falso de la foto (d1422b0, 2026-10-12);
  - la latitud de casa, sola, en un comentario de `GreenhousePages.tsx` (0204dbd, 2026-10-08).

  Ninguna está en el bundle. En `HEAD` se arreglan en `fix/test-coordinates`, pero **el historial las conserva**.
- **Tu correo personal** es el autor de los 184 commits.
- **Imágenes de referencia de terceros** en `referencias/` (`ref-01-…`, `ref-03-objetivo`, `ref-03-modelo2`, `aproximacion-ref`, `ui-neumorphism-01`): sin licencia conocida para redistribuirlas.
- **LFS**: ≈ 215 MB en `HEAD`, de ellos 196 MB en las 487 capturas de `referencias/progreso`. El plan gratis de GitHub da 10 GiB de almacenamiento y 10 GiB de descarga al mes; cada clon completo baja ≈ 215 MB, así que unos 45 clones al mes agotan la descarga y GitHub desactiva LFS en la cuenta hasta el mes siguiente.
- **Sin fichero `LICENSE`**: sin él, todos los derechos reservados. Las fuentes (OFL) y los sonidos (CC0) ya tienen su licencia en docs/02.
- **Las docs** dicen la ciudad (Madrid). Ninguna dirección. `.env` y `CLAUDE.local.md` no están versionados.
- **Cómo publicar**: tres opciones comparadas al final de este punto (7b).

**Commits que todavía llevan algo privado** (escaneado el 2026-10-16: el árbol completo de cada uno de los 188 commits de todas las ramas, no solo los cambios; el historial no se ha reescrito):

| Qué | Commits | Desde … hasta | En `HEAD` |
|---|---|---|---|
| Ubicación de casa: un par de coordenadas a menos de 2 km, o la latitud exacta | **82** | 0204dbd (2026-10-08) … 82c3d3f (2026-10-16); lo arregla 5490bde | No |
| — de ellos, con el par de coordenadas | 74 | ccd93b3 (2026-10-08) … 82c3d3f | No |
| — de ellos, solo la latitud (el comentario de `GreenhousePages.tsx`) | 8 | 0204dbd … d587570 (2026-10-08) | No |
| Imágenes de referencia de terceros (7 en `referencias/`: `ref-01`, `ref-02`, `ref-03-modelo2`, `ref-03-objetivo`, `aproximacion-ref`, `ui-neumorphism-01` y un `.jpg` sin nombre) | 188, todos | 15f4f73 (2026-09-30, el primero) … hoy | Sí |
| Tu correo personal como autor | 188, todos | | Sí |
| Claves, contraseñas, nombre de la tailnet, tu correo dentro de un fichero | 0 | | |

- **Dónde estaban las coordenadas**: `packages/shared/src/mqtt/messages.test.ts` (líneas 201, 218, 235 y 243, según la versión), `apps/hub/src/journal.test.ts` (40 y 42) y `apps/web/src/ui/settings/GreenhousePages.tsx` (29).
- **Ramas que las llevan**:
  - `main` hasta 82c3d3f;
  - `feat/phase-b1-assistant`, aparcada, que tiene 6 propios: 8936168, c8faa7e, 3a82c21, 3763293, a9877aa y 9e76f2d;
  - las ramas ya fusionadas que siguen en el PC o en GitHub: 15 en local (de `feat/phase-a4-hub` a `fix/boot-docker`) y 9 en GitHub.

  Reescribir el historial obligaría a tocarlas todas, o a borrar antes las fusionadas.
- **Los 82, en orden**: 0204dbd 5d4bc17 9a72ae5 93a0d76 309baa4 7c050f7 86998b3 d587570 ccd93b3 83ecfc8 427b1bc f8bd7c8 bb2e07f df4e20c c04a4d1 e89a1d4 d1164d6 dc4e921 1af7a77 49458c5 555d7e0 fcc40cb 72a1156 d1422b0 24090e2 269d8f8 ef36598 d042b97 9b4d3ea c34c977 13b8b0f ed0ed9c e58b538 c967568 4e8549d a3e1021 1139b72 7332ae6 61dc723 53751d3 4bf09eb 636de7a fa212ff 5bcc089 ac33fc3 edb0daf 9c9dcde db05221 4d74c96 216d952 bd7b1c3 13f91a8 c2899d5 8936168 c8faa7e 3a82c21 3763293 a9877aa 9e76f2d 7c65399 f2151eb 964e3ba 3b1a728 3b507f1 30b3da7 c6837e2 f21a30b 38a02d2 cb80b1e 3672a16 06cd752 012dc64 8182b47 4e660f0 22049c7 c4c4f3a 59238b8 a9ca83c c345ef3 115b528 51ad2e0 82c3d3f.

### 7b. Publicar desde un repo nuevo sin historial, o reescribir este

- **A · Solo la demo, sin código público** (la elegida, D103). `pnpm demo:release` sube el build a Vercel desde este repo, que sigue privado. No se publica código ni historial, así que no hay nada que limpiar.
- **B · Un repo nuevo sin historial**, y este se queda privado tal cual, con su historial, sus ramas y sus hashes. Dos variantes:
  - **B1 · Solo la demo**: el repo nuevo lleva el build ya comprobado. Así cabe GitHub Pages.
  - **B2 · La demo y el código**: el repo nuevo es una **foto** de un commit de `main`.

  Cómo se haría la foto: un script (`pnpm public:export`, por escribir) copia solo una lista permitida, es decir `apps/`, `packages/`, `docs/`, `infra/` y la raíz, pero no `referencias/`, `.claude/` ni nada ignorado. Luego le pasa la misma comprobación de secretos y coordenadas (`scripts/private.test.mjs` y la del punto 6) y hace un commit con el correo `noreply` de GitHub ("Vitreo, 2026-11-02"). Cada publicación nueva es otro commit de foto: el historial público es una sucesión de fotos, no los commits reales.
- **C · Reescribir este repo y hacerlo público.**

| | A · Solo la demo | B2 · Repo nuevo (foto) | C · Reescribir este |
|---|---|---|---|
| Qué ve el público | La demo | La demo, el código y las docs de hoy, sin historial | Todo, con el historial real ya limpio |
| Este repo | Privado, igual | Privado, igual | Cambian los 188 hashes; hay que reescribir o borrar las 25 ramas, la aparcada `feat/phase-b1-assistant` incluida |
| Trabajo de partida | Ninguno además de la demo | Medio: la lista permitida, el script y su comprobación | Alto: `git filter-repo` sobre 82 commits (coordenadas) y los 188 (referencias, correo), *push* forzado de todo y ≈ 85 hashes citados en las docs y en `CLAUDE.local.md` que dejan de apuntar a nada |
| Riesgo de que quede algo | Nulo: solo sale el build comprobado | Muy bajo: el repo nuevo nunca contuvo los datos | Real: GitHub sigue sirviendo los commits viejos por su hash en vistas en caché y en las referencias de PR hasta que Soporte las purga, y Soporte solo ayuda con datos sensibles. Las copias de fuera de GitHub los conservan |
| LFS | No usa | Sin capturas no hace falta: lo que queda son ≈ 15 MB y el fichero mayor tiene 3,5 MB, así que va como git normal y los clones no gastan la cuota de LFS (que es de la cuenta, compartida con este repo) | Los objetos LFS de los ficheros quitados siguen ocupando cuota hasta borrar y recrear el repo. Los clones bajan lo que quede, ≈ 215 MB si siguen las capturas |
| Mantenerlo | Nada | Un comando por publicación; el público va por detrás de `main` | Nada después, pero cada commit futuro es público |
| GitHub Pages | No (Vercel) | Sí | Sí |
| Marcha atrás | Borrar el proyecto de Vercel | Borrar el repo nuevo | Ninguna: una vez público, se pudo clonar |

- **B se puede hacer después de A** sin cambiar nada de este repo. **C es la única que toca el trabajo diario**: hashes, ramas y las docs que los citan.

### 8. Rendimiento en un móvil de gama media, y "Sin 3D"

- **Lo que ya hay**:
  - calidad Auto, que baja resolución y efectos en un dispositivo lento;
  - "Sin 3D" en Ajustes, y automático cuando no hay WebGL o falla (A3): la lista de plantas desde el principio, nunca una página en blanco;
  - modelo de 2,1 MB, 52 *draw calls*, 4,1 MB precacheados;
  - 60 fps medidos en el móvil, que **no es gama media**.
- **Lo que falta medir**: sin un Android de ≈ 200 € a mano (D103), se mide lo que se puede:
  - `pnpm perf` en el PC con la CPU frenada 4× y 6× y la red en 4G lento;
  - el render por software (SwiftShader), como cota pesimista de una GPU floja;
  - el móvil con `?stats`;
  - el coste del worker a 1440×.

  Que nada de eso es un móvil de gama media se dice en el informe. La medida en uno de verdad queda pendiente.
- **Objetivos**: primera carga < 5 s en 4G y ≥ 30 fps estables.
- Si con Auto ya en Baja sigue por debajo de 24 fps durante 5 s, la app **propone** "Sin 3D" con un aviso; nunca cambia sola sin decirlo.
- En "Sin 3D" la demo funciona entera: lista, hojas, gráficas, diario y velocidad.
- El *service worker* precachea después de la primera pintura, no antes.

### 9. Tests

e2e de la demo:
- carga con "Demo · datos simulados";
- a 1440×, un día en ≈ 1 minuto con amanecer, un riego automático, la ventana o el ventilador y la noche;
- rebobinar la semana grabada;
- el diario de la semana;
- el *push* explicado;
- ninguna petición a otro origen;
- sin WebGL, la vista "Sin 3D".

Además: el test de contrato del hub de demo, la comprobación de secretos (que debe fallar con un secreto plantado a propósito) y los e2e de siempre sin cambios.

### 10. Orden

1. `sim-core` y el worker. **Hecho** (2026-10-22).
2. El hub de demo y su test de contrato. **Hecho** (2026-10-23, D109), en dos pasos:
   - `refactor/hub-portable`: la lógica del hub sin Node y sus rutas sin Fastify, sin cambio de comportamiento (publicado el 2026-10-22, un día en el hub diario: `pnpm status` y el móvil en verde);
   - `feat/demo-2-hub`: ese mismo código sobre sql.js en el worker (`apps/hub/src/portable.ts`, `apps/web/src/demo/hub.ts`), y `apps/hub/src/contract.test.ts`, que manda los mismos mensajes y las mismas peticiones a Fastify sobre better-sqlite3 y al router portátil sobre sql.js y exige respuestas iguales byte a byte.

   Descarga de la primera visita, medida con el *build* de la demo (Brotli, como lo serviría Vercel): **≈ 2,4 MiB**, de ellos 0,31 MiB del hub (su código, 40 KiB, y SQLite en WebAssembly, 272 KiB), que llega después de la escena. Los avisos *push*, los CSV y las fotos del diario se esconden en la demo (D110). Pendiente para el paso siguiente: "Fuera" en la demo (sin AEMET, se queda en "Preguntando al hub…": el paso 3 pone "Fuera · simulado").
3. Velocidad y etiqueta. **Primero el tiempo de fuera** (2026-10-23, D111, `feat/demo-3-weather`; prioridad de la persona): un cielo simulado, sin red, que el hub de la demo publica en `weather` con `source: "simulated"` y sobre el que aplica sus propias reglas (la retención por lluvia cierra la ventana: "Cerrada mientras llueva fuera").
   - Cabecera "**fuera · simulado**" con su temperatura, y "simulado" en vez de AEMET en Ajustes, en la hoja del invernadero y en los motivos.
   - La semana de fuera (`MADRID_LATE_OCTOBER`) lleva un frente con lluvia (día 4: mañana mojada y un chubasco por la tarde; día 5: otro al amanecer), niebla espesa al amanecer del día 6 y neblina el 7, nubes y viento todos los días, sin llegar al viento fuerte de la regla de la ventana. La escena muestra los efectos de A10: lluvia alrededor, gotas en el cristal, niebla y nubes que suavizan la luz. La lluvia solo cae en días nublados, así que la luz del invernadero (que lee solo las nubes del día) y la semana acelerada no cambian.
   - **El visitante ve tiempo en el primer minuto**: llega en el último día de esa semana (como acabará la semana grabada del paso 7) y con un chubasco ya empezado, que dura unos 40 minutos; luego la semana sigue, con su niebla de madrugada. A 1440× un día cabe en un minuto, con su niebla y sus chubascos.
   - **"Probar situaciones › Lluvia"**: media hora de lluvia desde ese momento. Es el primer escenario del menú (el resto, en el paso 6). Junto a él, la etiqueta "**Demo · datos simulados**", siempre a la vista.
   - La velocidad, con el resto, en el paso siguiente (D112).
4. **Listo para publicar** (2026-10-23, D112, `feat/demo-publish`; lo pidió la persona de una vez: el resto de los pasos 3, 4, 6 y 7):
   - **Reloj propio**: el *worker* mueve juntos el dispositivo, el hub y el cielo, un segundo simulado cada vez (`apps/web/src/demo/engine.ts`); la página lo sigue (`app/clock.ts`). **Dos velocidades**: "Normal" (60×, al llegar) y "**Ver un día en un minuto**" (1440×); sin 1× ni pausa (decisión de la persona, ajusta el punto 4).
   - **Semana grabada**: `pnpm demo:week` graba siete días con ese mismo motor (con el hub y el cielo de la demo, así que lleva las retenciones por lluvia) en `apps/web/demo/week.json` (1,4 MiB; 91 KiB con Brotli). La demo la mueve días enteros para que acabe hoy y sigue desde la memoria del dispositivo de la última hora.
   - **Etiqueta** "Demo · datos simulados" (texto plano, con la hora simulada y el ritmo), en el resumen accesible y en el título de la pestaña ("Vitreo · Demo").
   - **Bienvenida**: la de casa, con el primer paso (qué es: todo simulado, nada sale del navegador) y el último (qué probar) propios de la demo.
   - **`pnpm demo:build`** (a `apps/web/demo-dist/`, con `vercel.json`) y su comprobación (`scripts/demo-check.mjs`, que falla con un secreto plantado: `scripts/demo-check.test.mjs`); **`pnpm demo:release`** la sube a Vercel (`vitreo-demo`) solo desde `main` limpio y subido.
   - Descarga de la primera visita (Brotli): **≈ 2,5 MiB**, con el hub, SQLite y la semana, que ahora cargan al llegar. El *service worker* precachea después ≈ 5,5 MiB más.

**Después de publicar** (lo que quedó fuera, por orden):
- Rendimiento (punto 8): `pnpm perf` con la CPU frenada, SwiftShader, el móvil con `?stats` y el coste del *worker* a 1440× (≈ 7 s de CPU por día simulado en el PC, es decir ≈ 12 % de un núcleo; en un móvil, más).
- ~~Lo que dura segundos, visible a 60× y 1440×~~ **Hecho (D126)**: "Regando" se ve al menos 1,5 s reales, solo en la demo.
- ~~Los resúmenes por hora de la semana grabada tardan ≈ 16 s~~ **Hecho (2026-11-09, `feat/soil-hour-index`)**: índice `soil(device, ts)`, también en el hub de casa. Una semana de lecturas: de 10,9 s a 0,34 s.
- ~~El rebobinado enseña el tiempo de fuera de ahora~~ **Ya no**: al rebobinar no se enseña tiempo de fuera (ni en la escena, ni en el sonido, ni en el texto), porque del cielo de entonces solo se guarda la estación (el pronóstico no). Enseñar el de entonces pediría guardar también las nubes y la niebla.
- ~~"Probar situaciones": ola de calor, depósito vacío, desconexión, sensor roto, reiniciar.~~ **Hecho (D125, `feat/demo-scenarios`)**: y "Volver a la normalidad" en lugar de reiniciar, para no perder la semana.
- ~~Notas de ejemplo en el diario ("Ejemplo") y Open Graph.~~ **Hecho (D126)**. ("Cómo se hizo": D113, abajo.)
- La semana se grabó en horario de invierno: hasta el 25 de octubre de 2026, rebobinada, amanece una hora antes de lo que dice la escena. Regrabarla en primavera (`pnpm demo:week`), cuando cambie la estación.
- ~~La bienvenida sale una vez por dispositivo (como en casa), no por sesión.~~ **Hecho (D126)**: una vez por visita en la demo.

Cada paso en su rama, con capturas antes del *merge*.

**"Cómo se hizo"** (D113, pedido el 2026-11-01): el cuaderno del proyecto, para el portfolio, en `vitreo-demo.vercel.app/cuaderno`. Capítulos con entradas fechadas, capturas de cada fase y las decisiones al margen, en primera persona (Claude Code, en una línea de herramientas). Hecho y publicado el 2026-11-01: el capítulo 1 en `feat/notebook-1` y los otros seis de una vez, a petición de la persona:
1. **Una ventana con plantas**: la idea y la dirección de arte (30 sep – 1 oct).
2. **El diorama**: Blender, luz horneada y un presupuesto (3–7 oct, D54–D71).
3. **El gemelo**: un simulador y lo que la escena sabe leer (30 sep – 13 oct).
4. **La interfaz**: neumorfismo como material (7–15 oct, D72–D86).
5. **Memoria y tiempo**: hub, historial, reglas y AEMET (8–15 oct, D87–D102).
6. **Cuando falla**: la semana de prueba y los apagones (8–23 oct, D85–D106).
7. **La demo**: todo en tu navegador, y este cuaderno (22 oct – 6 nov, D103–D122; la entrada del 6 nov cuenta los efectos de tiempo).

Rediseño del 2026-11-05 (D117, pedido por la persona: "navegación intuitiva, mejores imágenes y colocación"): índice fijo que sigue la lectura (barra arriba e índice en diálogo en el móvil), "Lo esencial" para el portfolio, capítulos como tarjetas, capturas recortadas, numeradas y ampliables, y la captura de hoy de día y de noche.

Al añadir una fase nueva, su capítulo o su entrada se escriben en `apps/web/src/notebook/chapters/` con sus capturas (`pnpm notebook:images`).

**Hecho cuando**:
- un enlace público abre la demo en un móvil de gama media y se ve "Demo · datos simulados";
- en un minuto se ve un día entero (amanecer, riegos, ventilación, noche);
- la semana grabada se rebobina;
- nada sale del navegador;
- la comprobación confirma que el bundle no lleva nada de `.env`.

**Decidido en D103** ([`11-decisiones.md`](11-decisiones.md)): P15 (hosting), P16 (analítica), P17 (idioma) y P18 (repo público, por ahora).

## Sonido y efectos con calidad profesional (aprobado el 2026-11-01)

Pedido por la persona el 2026-11-01: los sonidos y los efectos (lluvia, gotas en el cristal…) se notan baratos. **Plan aprobado el 2026-11-01**; el paso 1 empieza ya, porque no depende de las fuentes. Las tres preguntas de "Lo que tiene que decidir la persona" siguen abiertas. **Contradice dos decisiones**, que se cambiarían al aprobarlo: D78/D96 (solo grabaciones CC0, vistas previas de Freesound, 24 kHz, bucles cortos) si se eligen fuentes que no son CC0, y D96 en el formato de los bucles.

### Por qué suena y se ve barato (lo que hay hoy)

- **Sonido** (`features/sound/`, `pnpm audio`):
  - las fuentes son las **vistas previas** de Freesound (MP3/OGG ya comprimidos), que se vuelven a comprimir: dos pérdidas seguidas;
  - se reproducen a **24 kHz**, así que no hay nada por encima de 12 kHz: es justo donde están el brillo de la lluvia, el agua y los pájaros, y suena apagado, "de teléfono";
  - **bucles de 8 a 32 s**, una sola toma por capa: la repetición se oye a los pocos minutos;
  - **sin ningún sonido puntual**: ni un pájaro que canta solo, ni una gota del canalón, ni la bomba al arrancar; todo es una alfombra continua;
  - el "cristal" es un único filtro de paso bajo; no hay sensación de estar dentro de un invernadero ni posición en estéreo.
- **Lluvia** (`scene/Ambience.tsx`): 220 puntos que se dibujan como trazos finos, todos con la misma opacidad (0,45) y casi el mismo tamaño, en una sola capa. No hay salpicaduras al tocar el zócalo o el tejado, ni goteo del canalón, ni suelo mojado.
- **Gotas en el cristal** (`shaders/glass.ts`): salen de una cuadrícula con una función de azar: puntos redondos iguales, colocados en celdas, de color plano, sin brillo, sin borde oscuro y sin refracción. Las que resbalan lo hacen por columnas fijas.
- **Empañado**: un degradado liso; no tiene textura ni deja surcos donde resbala una gota.
- **Niebla**: un velo CSS por encima de todo (`FogVeil`), no dentro de la escena.

### Lo que se propone

**A. Sonido**
1. **Motor nuevo, con las mismas fuentes** (para oír la diferencia antes de cambiar nada más):
   - **48 kHz** y Opus de más calidad;
   - las capas largas, **en streaming** (`<audio>` + Web Audio), sin decodificarlas enteras: más duración sin más memoria;
   - **volumen igualado por sonoridad** (EBU R128 con ffmpeg en `pnpm audio`) y un limitador suave al final;
   - **sonidos puntuales repartidos al azar** sobre la alfombra (un canto suelto, un grillo, una gota), con su posición en estéreo y sin repetirse nunca igual;
   - **reverberación corta de invernadero** (una respuesta al impulso generada, sin grabar) para lo que suena dentro: bomba, agua, ventilador.
2. **Fuentes nuevas y mejores** (decisión de la persona, abajo):
   - **alfombras de 2 a 3 minutos**, de día, de noche y de viento;
   - **lluvia en tres intensidades** (llovizna, moderada, fuerte) que se funden entre sí según la lluvia medida o simulada, más la **lluvia sobre el cristal**, de cerca, porque se escucha desde dentro;
   - **gotas del canalón** cuando acaba de llover y la lluvia ya ha parado.
3. **Sonidos de los aparatos, solo con datos en directo** (honestidad, como D96): la bomba que arranca y para y el agua en la tierra, el motor de la ventana al abrir o cerrar, el clic del relé de la luz y el ventilador que acelera y frena. Sonarían muy bajos, y solo cuando llega el evento o el ACK de verdad.

**B. Efectos**
4. **Lluvia con volumen**:
   - **trazos en tres profundidades**, con longitud, grosor y opacidad distintos, estirados por la velocidad y el viento, y más finos en la distancia;
   - **salpicaduras** pequeñas en el zócalo, el camino y el tejado;
   - **goteo** desde el borde del canalón.
5. **Cristal mojado de verdad**:
   - gotas de un **atlas de normales** generado por un script (sin recursos de terceros), de tamaños distintos y repartidas sin cuadrícula;
   - con **brillo del sol, borde oscuro y una refracción falsa** (desplazar la luz, no lo de detrás), que no necesita un render a textura;
   - gotas que **resbalan, se juntan y dejan un surco limpio**;
   - **empañado con textura**, que se abre donde pasa una gota.
6. **Suelo mojado que se seca**: el zócalo, la arena y el camino se oscurecen y brillan algo mientras llueve, con charcos pequeños y ondas en el camino. Se secan poco a poco según la lluvia medida en las últimas horas (dato de AEMET o del cielo simulado), nunca a ojo.
7. **Nieve y niebla**:
   - copos que giran, de tamaños distintos, y que se acumulan en el tejado y el zócalo según la nieve que haya;
   - **niebla dentro de la escena**, en capas con ruido, en lugar del velo CSS.

### Reglas que no cambian

- **Acogedor, no un juego** (D96): nada de tormentas espectaculares ni relámpagos.
- **Presupuesto**: menos de 100 llamadas de dibujo y 60 fps en un móvil medio. Cada paso se mide con `pnpm perf` y `?stats` en el móvil. Calidad Baja, movimiento reducido y Sin 3D sin partículas; con movimiento reducido, las gotas quietas.
- **Honestidad**: la lluvia, la nieve, el suelo mojado y los sonidos de los aparatos solo aparecen cuando los datos lo dicen. La demo los saca de su cielo simulado, dicho así.
- **El sonido sigue apagado por defecto** y solo se descarga al activarlo. Hoy son ≈ 510 KB; con alfombras largas, ≈ 3–5 MB, en streaming.
- **Licencias**: cada fuente, con su licencia comprobada en su página y anotada en docs/02.

### Lo que tiene que decidir la persona

1. **De dónde salen los sonidos**:
   - (a) **Freesound CC0, los originales** (WAV), no las vistas previas: gratis y sin atribución, pero hace falta la cuenta de la persona para descargarlos, y la calidad depende de cada grabación;
   - (b) **bancos *royalty-free*** como los paquetes gratuitos de Sonniss (GDC), grabados a 96 kHz/24 bits: más calidad y coherencia, pero no son CC0, así que habría que comprobar que su licencia permite servirlos dentro de una web pública;
   - (c) **una librería de pago** (≈ 20–60 €);
   - (d) **grabarlos en el invernadero de verdad** cuando exista (fase 3): lo más auténtico, y más tarde.

   Recomendación: (a) y (b) ahora, y (d) cuando haya invernadero.
2. **Si se quieren los sonidos de los aparatos** (punto 3): dan vida, pero son lo más fácil de que resulte molesto.
3. **Referencias**: uno o dos vídeos o juegos con la lluvia o el ambiente que gusten, para apuntar al mismo sitio dentro del estilo de ilustración.

### Orden propuesto

Cada paso, en su rama, con capturas y un **vídeo corto** (los efectos se mueven: las capturas no bastan) antes del *merge*. Después, `pnpm release` y `pnpm demo:release`.

1. Motor de sonido nuevo con las mismas fuentes (punto 1). **Hecho en `feat/sound-1-engine` (D114), en `main` y publicado el 2026-11-05** (la persona pidió publicar todo lo pendiente): 48 kHz, bucles largos en mono con dos voces que no se repiten, sonoridad igualada, sala para lo de dentro, techo suave y un cristal que ya no ahoga lo de fuera. Comparación antes/después en renders sin conexión; el ajuste de oído (sobre todo el nivel de los pájaros) queda para cuando la persona lo escuche.
2. Fuentes nuevas (punto 2). **Hecho en `feat/sound-2-sources` (D123), en `main` y publicado el 2026-11-09**: la persona pidió que Claude las buscara por su cuenta (2026-11-09). Todas CC0, de Wikimedia Commons e Internet Archive, sin cuenta. Elegidas midiéndolas (espectrogramas, sonoridad y bandas), **sin oírlas**: el ajuste de oído sigue siendo de la persona, como en D114 y D121. Lluvia en tres intensidades y en el cristal (bajada solo la primera vez que llueve), pájaros de 96 s, un mirlo suelto y goteo del canalón sintetizado cuando el pluviómetro dice que sigue mojado.
3. Cristal mojado (punto 5): es lo que más se ve. **Hecho en `feat/fx-3-wet-glass` (D118)**, en `main` y publicado el 2026-11-08.
4. Lluvia con volumen (punto 4). **Hecho en `feat/fx-4-rain` (D119)**, en `main` y publicado el 2026-11-08.
5. Suelo mojado que se seca (punto 6). **Hecho en `feat/fx-5-wet-ground` (D120)**, en `main` y publicado el 2026-11-08.
6. Sonidos de los aparatos (punto 3), si se aprueban. **Hecho en `feat/sound-6-devices` (D121)**, sintetizados, en `main` y publicado el 2026-11-08; el ajuste de oído queda para cuando la persona los escuche.
7. Nieve y niebla (punto 7). **Hecho en `feat/fx-7-snow-fog` (D122)**, en `main` y publicado el 2026-11-08.

**Revisión de los pasos 3–7 (2026-11-08)**: la persona pidió que Claude los revisara por su cuenta y publicara. Revisados con capturas y con la demo en marcha sin forzar nada: el chubasco de llegada moja el suelo (hasta 0,39) y se seca solo cuando para; los seis sonidos de los aparatos (bomba, relé al apagar y al encender, ventilador al arrancar y al parar, ventana al abrir y al cerrar) se disparan una vez por cada cambio real de la telemetría y ninguno sin él. Arreglado en la revisión: la nieve del tejado, de noche, parecía nubes grises (bordes más firmes, velo uniforme y menos oscura). Límite conocido: a 1440× un riego automático dura menos que una lectura y la bomba no llega a sonar; a 60× sí. Pasado: lint, typecheck, unitarios, `e2e:full` (179), `e2e:demo` y `pnpm perf`. La persona dice que las pruebas en el móvil van bien.

## Siempre

- Registrar decisiones en [`11-decisiones.md`](11-decisiones.md).
- Capturas de cada avance en `referencias/progreso/` para ver la evolución.
