# 05 · Arquitectura técnica

## Visión general

```
┌──────────────┐   MQTT (wifi)   ┌──────────────────────────────┐   WebSocket / HTTP   ┌──────────────┐
│   ESP32      │ ──────────────▶ │  HUB (en casa)               │ ◀──────────────────▶ │  App (PWA)   │
│  sensores    │ ◀────────────── │  · Mosquitto (broker MQTT)   │                      │  móvil / PC  │
│  actuadores  │   órdenes       │  · hub service (Node + TS)   │                      │  React + R3F │
│  seguridad   │                 │    historial, reglas, API    │                      │              │
└──────────────┘                 └──────────────────────────────┘                      └──────────────┘
```

- **ESP32**: lee sensores, mueve actuadores y aplica los **límites de seguridad**. Funciona solo aunque el hub caiga.
- **Mosquitto**: broker MQTT local. Con un *listener* WebSocket para la app.
- **Hub service**: guarda el historial, es el dueño de `config`, ejecuta las automatizaciones de nivel superior y ofrece una pequeña API. Corre en Docker, en el mismo `docker-compose` que el broker: en el PC para empezar (solo mientras está encendido) y después en una Raspberry Pi 24/7 (D74).
- **App**: se suscribe en vivo por MQTT-over-WebSocket y consulta historial por HTTP.

## Stack

| Capa | Tecnología |
|---|---|
| Lenguaje | TypeScript (estricto) en todo lo que no es firmware |
| Monorepo | pnpm workspaces (+ Turborepo si crece) |
| App | Vite · React · React Three Fiber · drei · `@react-three/postprocessing` (con moderación) |
| Estado | Zustand (estado de la escena y del dispositivo) · TanStack Query (historial HTTP) |
| Estilos | CSS con variables (tokens) + CSS Modules, o Tailwind v4 sobre los mismos tokens |
| Animación UI | Motion (antes Framer Motion) |
| Audio | Howler.js o Web Audio directo |
| Día/noche | `suncalc` |
| MQTT cliente | `mqtt` (mqtt.js) |
| Validación | `zod` (esquemas compartidos entre app, hub y simulador) |
| PWA | `vite-plugin-pwa` |
| Hub | Node + TypeScript · Fastify · SQLite (`better-sqlite3` + Drizzle) |
| Broker | Mosquitto (Docker o instalación nativa) |
| Firmware | C++ con PlatformIO (framework Arduino) · alternativa: ESPHome |
| Tests | Vitest (unidad) · Playwright (e2e + capturas visuales) |
| Calidad | ESLint · Prettier · TypeScript `strict` · commits convencionales |

## Estructura del repositorio

```
vitreo/
├── CLAUDE.md
├── README.md
├── docs/                       esta documentación
├── referencias/                imágenes de inspiración
├── apps/
│   ├── web/                    la PWA
│   │   ├── public/models/      .glb optimizados
│   │   ├── public/audio/
│   │   └── src/
│   │       ├── scene/          componentes 3D (Greenhouse, Plant, Glass, Sky...)
│   │       ├── shaders/        viento, cristal, mezcla lightmaps
│   │       ├── ui/             componentes de interfaz
│   │       ├── features/       plants, actions, history, automations, journal
│   │       ├── data/           cliente MQTT, API, stores
│   │       └── styles/tokens.css
│   ├── hub/                    servicio local (historial, reglas, API)
│   └── simulator/              invernadero falso que publica datos MQTT
├── packages/
│   └── shared/                 tipos, esquemas zod, topics MQTT, constantes
├── firmware/                   proyecto PlatformIO del ESP32
├── assets/                     Blender, texturas, scripts del pipeline 3D
└── infra/                      docker-compose (mosquitto, hub), config
```

## Contrato MQTT

Definido en `packages/shared` y usado por firmware, hub, simulador y app. Prefijo: `vitreo/<deviceId>/`.

| Topic | Dirección | Retenido | Contenido |
|---|---|---|---|
| `…/status` | ESP32 → | sí | `{ "v": 1, "state": "online" \| "offline" }` (`offline` es el LWT) |
| `…/telemetry` | ESP32 → | sí | Instantánea completa cada 30 s y ante cambios |
| `…/event` | ESP32 → | no | Eventos: riego iniciado/terminado, límite de seguridad, error de sensor |
| `…/cmd` | → ESP32 | no | Órdenes |
| `…/ack` | ESP32 → | no | Confirmación de cada orden por `requestId` |
| `…/config` | → ESP32 | sí | Umbrales y horarios que el ESP32 guarda y aplica solo |
| `…/weather` | hub → | sí | El tiempo de fuera según AEMET (A10, D97), o el cielo simulado de la demo (D111); el dispositivo no lo lee |

Reglas generales:

- **Todos los mensajes son JSON y llevan `"v": 1`** (versión del esquema). Se sube solo ante cambios incompatibles.
- **Se lee con tolerancia lo que informa, y es estricto lo que manda** (D107, en parte sustituye a D18). Las versiones del firmware, el simulador, el hub y la app se irán separando (fase 3):
  - `status`, `telemetry`, `event`, `ack` y `weather` **se leen con tolerancia**: se validan todos los campos conocidos y se dejan fuera los que no se conocen. Una app o un hub más antiguos siguen mostrando y guardando lo que manda un dispositivo más nuevo. El hub guarda además el mensaje en bruto tal como llegó, con esos campos.
  - `cmd` y `config` **siguen siendo estrictos**: un campo desconocido invalida la orden o la configuración (y `config`, una versión desconocida, D89). El dispositivo nunca hace a medias algo que no entiende.
  - **Publicar es estricto en todos los canales**: `serializeMessage` rechaza un campo que el contrato no conoce, en vez de quitarlo en silencio. Lo tolerante es solo leer.
  - **Un tipo de evento que no se conoce** (D108), de un dispositivo más nuevo, tampoco se pierde. Si lo que comparten todos los eventos es válido (`v`, `ts`, un `type` con forma de nombre, y `source`, `zone` y `requestId` cuando los lleva), el hub lo guarda como un evento más, con su tipo, no con los mensajes inválidos. La app lo salta sin ruido en la escena y en los avisos, y los diarios lo muestran como una línea neutra: "Evento del invernadero: <tipo>" (en el de su maceta si nombra una; si no, en el del invernadero). Nunca se actúa por él. Un tipo conocido que no valida sigue siendo inválido.
  - Un campo nuevo que cambie el significado de uno que ya existe no cabe en esto: eso sube `v`.
- `deviceId`: minúsculas, dígitos, `_` y `-` (nunca `/`, `+` ni `#`). Identificadores de zona estables, como `basil_01`: no cambian al renombrar la planta en la app.
- Tiempos en segundos Unix UTC (enteros). Temperaturas en °C, humedad del aire en %.
- **Origen de cada acción** (`source`): `user`, `automation` o `agent` en las órdenes; se copia en el `ack` y en los eventos. `safety` solo lo pone el firmware.

**Telemetría** (ejemplo):

```json
{
  "v": 1,
  "ts": 1790780400,
  "air": { "temp": 22.4, "rh": 64.1 },
  "light": { "lux": 8200 },
  "soil": [
    { "id": "basil_01", "moisture": 0.42, "cal": 1 },
    { "id": "parsley_01", "moisture": null, "cal": 1 }
  ],
  "tank": { "level": 0.7 },
  "actuators": { "pump": false, "growLight": true, "fan": false, "vent": 0.0 },
  "fw": "0.3.1",
  "rssi": -58
}
```

- Humedad de tierra **normalizada 0–1** (la calibración seco/mojado vive en el firmware). `cal` (opcional) es la **versión de la calibración** usada, para que el historial siga siendo interpretable si se recalibra.
- **Sensor roto → `null`**, nunca un valor inventado ni el último conocido. El campo no se omite: la maceta sigue en la lista con `"moisture": null`.
- `outdoorHold` (A10, D97): la retención por el tiempo de fuera en vigor, `{ "cause": "rain", "until": 1790782200 }`, o `null`. Falta en dispositivos anteriores a A10.

**Órdenes** (ejemplos):

```json
{ "v": 1, "requestId": "a1b2", "source": "user", "action": "water", "zone": "basil_01", "seconds": 5 }
{ "v": 1, "requestId": "b2c3", "source": "user", "action": "waterStop", "zone": "basil_01" }
{ "v": 1, "requestId": "c3d4", "source": "automation", "action": "growLight", "on": true }
{ "v": 1, "requestId": "e5f6", "source": "user", "action": "vent", "open": 0.6 }
{ "v": 1, "requestId": "g7h8", "source": "agent", "action": "fan", "on": true, "minutes": 10 }
{ "v": 1, "requestId": "i9j0", "source": "user", "action": "fan", "on": false }
{ "v": 1, "requestId": "hub-hold-1", "source": "automation", "action": "outdoorHold", "on": true, "minutes": 30, "reason": { "kind": "weather", "cause": "rain", "value": 1.2, "limit": 0.1 } }
{ "v": 1, "requestId": "hub-hold-2", "source": "automation", "action": "outdoorHold", "on": false }
```

- `water.seconds`: entero de 1 a 15. Es una ayuda para la UI; el límite real lo aplica el firmware.
- `waterStop` (D84): para la bomba ya; con `zone`, solo si es esa zona la que se riega. Siempre se acepta (`ok`), aunque no hubiera riego: parar es la dirección segura y repetirlo no hace nada. El riego termina con un `watering.finished` con la duración real y `stopRequestId`. **El firmware debe implementarlo** (fase 5), como el simulador.
- Encender el ventilador exige `minutes` (1–120): toda orden temporal lleva duración.
- `outdoorHold` (A10, D97), solo del hub: **retención por el tiempo de fuera**. Mientras dura, la ventana se queda cerrada y la ventilación del dispositivo usa solo el ventilador. Al recibirla, el dispositivo cierra la ventana si está abierta y lo dice en `automation.switched` (con el `reason` de la orden: `kind: "weather"`, `cause` `rain`/`snow`/`wind`, `value`, `limit`); sus reglas dejan de abrirla. **La protección por calor sigue mandando** (la abre; al pasar el calor, la retención la vuelve a cerrar) y **una apertura a mano gana** hasta que la retención termina. Lleva `minutes` (1–60) y el hub la renueva mientras dure el tiempo; con `on: false`, o si nadie la renueva, termina sola y las reglas del dispositivo vuelven a mandar (si aún hace calor, abren la ventana). No sobrevive a un reinicio. Se acepta (`ok`) aunque el calor tenga la ventana abierta. **El firmware debe implementarla** (fase 5), como el simulador.

**Confirmaciones** (`ack`):

```json
{ "v": 1, "requestId": "a1b2", "ts": 1790780401, "source": "user", "result": "ok" }
{ "v": 1, "requestId": "a1b2", "ts": 1790780401, "source": "user", "result": "rejected", "reason": "tank_empty" }
```

Motivos de rechazo: `tank_empty`, `safety_limit`, `invalid`, `busy`. Si un límite de seguridad lo impide, el `ack` dice **cuál** (`limit`, los mismos valores que `safety.triggered`) y, si es temporal, **cuándo** se puede volver a intentar (`retryAt`, Unix s), para que la interfaz lo diga (D85):

```json
{ "v": 1, "requestId": "k1l2", "ts": 1790780401, "source": "user", "result": "rejected", "reason": "safety_limit", "limit": "pump_max_per_hour", "retryAt": 1790781200 }
```
 Una orden inválida que aún permite leer su `requestId` recibe un `ack` con `invalid`, para que quien la envió no espere en silencio.

**Idempotencia**: el dispositivo recuerda los últimos `requestId` (64) y, si recibe uno repetido, reenvía el mismo `ack` **sin repetir la acción**. Por eso la app puede reenviar una orden sin confirmar con el mismo `requestId`: un `ack` perdido nunca riega dos veces.

**Órdenes desde la app** (`apps/web/src/data/commands.ts`): un reenvío automático a los 2,5 s con el mismo `requestId`, aviso tranquilo de "sin confirmación" a los 5 s y reintento manual. Sin conexión, la orden **falla al momento en lugar de encolarse**: un riego que llega una hora tarde es peor que uno que no llega.

**Eventos** (`type`):

| `type` | Campos | Notas |
|---|---|---|
| `watering.started` | `source`, `zone`, `seconds` (previstos), `requestId?`, `reason?` | `reason` cuando lo empezó una automatización: por qué (abajo) |
| `watering.finished` | `source`, `zone`, `seconds` (reales), `requestId?`, `stopRequestId?` | La duración real puede ser menor si saltó un límite o se detuvo (`stopRequestId`: la orden `waterStop`) |
| `safety.triggered` | `source: "safety"`, `limit`, `zone?`, `value?` | `limit`: `pump_max_per_command`, `pump_max_per_hour`, `tank_empty`, `tank_unknown` (nivel desconocido), `sensor_failure` (falla un sensor necesario), `over_temperature`, `frost` (D90), `connection_lost`. `value`: la lectura que lo disparó (°C en calor y helada) |
| `safety.cleared` | `source: "safety"`, `limit`, `value?` | Un límite que mantiene un estado (calor, helada) lo libera (D90); los avisos de A7 lo usan para "resuelto" |
| `sensor.error` | `sensor` (`air`, `light`, `soil`, `tank`), `zone?`, `detail?` | Sin `source`: no es una acción. `zone` obligatoria si es de tierra |
| `automation.switched` | `source: "automation"`, `target` (`growLight`, `fan`, `vent`), `value` (encendido/apagado, o apertura 0–1), `reason` | Una regla de `config` movió algo (A6) |
| `config.applied` | `rev` | El dispositivo aplica esa revisión de `config` (A6, D89). Sin `source`: no es una acción |
| `config.rejected` | `reason` (`unsupported_version`, `invalid`), `rev?`, `version?`, `keeps?` | La rechazó y sigue con la que tenía (`keeps`); nunca adivina |

**Por qué actuó una automatización** (`reason`, A6): `soil` (`moisture` < `threshold`; con `evening: true`, un riego de tarde con la tierra aún por encima, D106), `temperature` y `humidity` (`value` frente a `limit`, al encender o al parar), `light` (`mode`, la ventana `from`–`to` de ese día y, si cuenta la luz natural, `lux` frente a `belowLux`). Los números van redondeados hacia abajo, para que "33 % < 35 %" sea siempre cierto tal como se lee.

Todos llevan además `v` y `ts`.

**Configuración** (`config`, **versión 2**, D89; ejemplo):

```json
{
  "v": 2,
  "rev": 3,
  "ts": 1790780400,
  "tz": "CET-1CEST,M3.5.0,M10.5.0/3",
  "location": { "lat": 40.42, "lng": -3.7 },
  "watering": [
    {
      "zone": "basil_01", "enabled": true, "threshold": 0.35, "seconds": 5, "maxPerDay": 2,
      "cooldownMinutes": 60, "quiet": { "from": "22:00", "to": "08:00" }
    }
  ],
  "light": { "enabled": true, "mode": "sun", "sunriseOffset": 0, "sunsetOffset": 120, "belowLux": 3000 },
  "ventilation": { "enabled": true, "fanAbove": 28, "windowAbove": 31, "hysteresis": 2, "maxRh": 85 }
}
```

- **Versión propia**: `config` lleva `v: 2` (los demás mensajes siguen en 1). Un dispositivo que recibe una versión que no conoce la rechaza con `config.rejected` (`unsupported_version`) y **sigue con la anterior**; nunca adivina. El hub, al arrancar, sustituye una `config` v1 guardada por una revisión v2 (en v1 todo estaba apagado, así que no se pierde nada).
- `rev` sube con cada cambio. `tz` es una cadena TZ POSIX (la que toma el ESP32): los horarios son hora local.
- `location`: la ubicación **redondeada a 2 decimales**, para que el dispositivo calcule el amanecer y el anochecer él solo, también con el PC apagado. Viaja solo por el broker de casa (refinamiento de D79 en D89: lo que no debe salir es el repositorio). La pone el hub al publicar, desde Ajustes › Ubicación; al cambiarla, publica una revisión nueva.
- **El firmware necesita la hora por NTP** para todo lo horario (luz, noches sin riego, máximo diario): sin hora válida, no aplica esas reglas.
- **Riego por maceta**: por debajo de `threshold`, como mucho `maxPerDay` veces por día local, con `cooldownMinutes` de pausa tras regar (la tierra aún absorbe y el sensor va por detrás) y nunca dentro de `quiet` (puede cruzar la medianoche). Una maceta cada vez.
- **Riego de tarde** (D106), para que ninguna maceta pase la noche por debajo del umbral esperando al final de `quiet`. En la **media hora antes de `quiet`** (21:30–22:00 con `quiet` desde las 22:00), riega la maceta que esté **por encima de `threshold` pero a menos de 5 puntos** y que, secando al ritmo de las últimas horas, **cruzaría antes de que acabe `quiet`**:
  - **el ritmo**: la media de las lecturas de cada media hora, de las dos últimas horas (al menos una), para que el ruido del sensor no cuente como secarse. Se olvida al regar. Sin una hora de lecturas desde el último riego o el arranque, no riega de tarde: no adivina;
  - **la cuenta**: el ritmo como si fuera constante hasta el final de `quiet`. De noche se seca más despacio (sin sol, aire más frío), así que, en la duda, riega;
  - **los mismos límites de siempre**: `maxPerDay`, `cooldownMinutes`, una maceta cada vez y los de seguridad. Las macetas por debajo del umbral van primero;
  - el `reason` es `soil` con `evening: true`, y la app lo dice así: "Riego de tarde · 43 %, cerca del 40 %".
  - En la semana acelerada, la albahaca pasa de 9 h por debajo del umbral de noche a ninguna, y ninguna planta pasa la noche por debajo. Lo comprueba `week.test.ts`, contra la misma semana sin esta regla.
- **Ventilación en dos pasos, con histéresis**: ventilador desde `fanAbove` (o desde `maxRh`), ventana también desde `windowAbove`; cada uno para `hysteresis` °C por debajo de donde arrancó (la humedad, 5 % por debajo). Se decide por cruces: si la persona apaga el ventilador, queda apagado hasta que el aire baje y vuelva a cruzar. **Por humedad, solo con el aire a 10 °C o más** (D105): arranca si además hace al menos 10 °C, y para por debajo de 9 °C (`reason` de temperatura, `limit` 9). Ventilar por humedad una noche fría solo acerca el invernadero a la helada. Sin lectura de temperatura, no ventila por humedad.
- **Luz**: `schedule` (`on`–`off`, hora local) o `sun` (del amanecer al anochecer, cada extremo movido `sunriseOffset`/`sunsetOffset` minutos), y solo con poca luz natural si hay `belowLux`. También por cruces. Para que **nunca parpadee** (D105; la semana acelerada la vio encenderse y apagarse cada 10 s, hasta 780 veces al día):
  - **Su propia luz no cuenta como luz del día.** El sensor ve también la lámpara. Al encenderla, el dispositivo mide cuánto añade (los lux de la última lectura con la lámpara apagada frente a la primera con ella encendida). Mientras está encendida, compara con `belowLux` los lux menos esa diferencia, y eso es lo que lleva el `reason` (`lux`). No hace falta ningún ajuste.
  - **Margen**: se apaga solo con la luz natural por encima de 1,5 × `belowLux`.
  - **Tope duro**: dos cambios automáticos de la luz se separan al menos **15 minutos**, aunque la medida de la lámpara falle. La única excepción es apagarla al salir de su ventana, que no es parpadear.
  - Con eso, unos 4 cambios al día (encender a la hora, apagar con el día, encender al atardecer y apagar a la hora). Lo comprueba `week.test.ts` (como mucho 6 al día).
- El algoritmo del sol y la lectura de la cadena TZ están en `packages/shared/src/time/` (probados contra el almanaque, ±2 min); el firmware los portará tal cual. La lógica de las reglas, en `packages/sim-core/src/automation.ts` (D104). **El firmware de la fase 3 porta las mismas reglas**, incluidas las de D105 (la luz descontando su lámpara, los 15 minutos entre cambios y la humedad solo por encima de 10 °C) y el riego de tarde de D106, y se compara contra la semana acelerada.
- Los **límites de seguridad no están en `config`**: son constantes del firmware y no se pueden relajar por MQTT.
- **El hub es el dueño de `config`** (D73): guarda cada revisión, sube `rev` y la publica retenida como usuario `hub`. La app la cambia a través de la API del hub (`web` no puede publicar `config`, D23). El dispositivo responde con `config.applied` y, hasta entonces, la app muestra el cambio como pendiente.

**Tiempo exterior** (`…/weather`, A10, D97): lo publica solo el hub (usuario `hub`; la ACL de Mosquitto se lo permite a él y a nadie más), retenido, cada vez que pregunta a AEMET y al menos cada 10 min aunque AEMET no conteste. `v: 1`, `ts` (cuándo lo publicó el hub), `source: "aemet"` (en la demo, `"simulated"`: un cielo simulado que nunca se atribuye a AEMET, D111), y:

- `observation`: la última hora de la estación más cercana (`station { id, name }`, `at` en UTC, `temp`, `rh`, `windSpeed` y `windGust` en m/s, `windDir`, `precip` en mm de la última hora, `visibility` en km), o `null`;
- `forecast`: la hora actual de la previsión horaria del municipio (`municipality`, `issuedAt`, `hour`, `sky` con el código de AEMET, `skyText`, `temp`, `precip`, `snow`, viento en m/s), o `null`;
- `tonight`: la mínima prevista hasta las 10:00 y su hora, o `null`.

Nunca se inventa: lo que AEMET no da va como `null`, y si AEMET falla el hub vuelve a publicar lo que tenía con sus propias horas, así se ve la edad. Sin clave, el hub publica un mensaje vacío retenido (lo borra). Cómo se lee "ahora" (lluvia del pluviómetro o, si no midió nada, de la previsión; nieve solo prevista y nunca por encima de 3 °C medidos; viento fuerte desde 30 km/h o rachas de 50; nada si el hub lleva 40 min callado o los datos tienen más de 3 h) está en `weatherNow` (`packages/shared/src/mqtt/weather.ts`), la misma función para el hub, la escena y el sonido.

**Retención por el tiempo** (A10): la orden `outdoorHold` y su estado en `telemetry.outdoorHold` (arriba). El motivo es el mismo `automationReason` de los eventos, con el tipo nuevo `weather`.

La fuente de verdad son los esquemas zod de `packages/shared/src/mqtt/`.

## Seguridad del hardware (en firmware, no negociable)

- Tiempo **máximo de bomba** por orden (p. ej. 15 s) y por hora (p. ej. 60 s).
- Sin agua en depósito → la bomba no arranca.
- Temperatura por encima de un límite (35 °C; se libera por debajo de 32 °C) → ventilación forzada y luz apagada.
- **Protección contra heladas** (D90): por debajo de **5 °C** la ventana se cierra y el ventilador se para, por encima de cualquier automatización u orden (una orden de abrir o de ventilar se rechaza con `limit: "frost"`; cerrar siempre se permite). Se libera por encima de 7 °C. En Madrid hiela en invierno. La app lo dice en el menú Aire: "Ventana cerrada por frío · 4,2 °C".
- Toda orden temporal lleva duración; si se pierde la conexión, el actuador vuelve a su estado seguro.
- *Watchdog* y reinicio limpio. Estado seguro al arrancar: todo apagado.

## Automatizaciones: dónde viven

| Tipo | Quién la define | Quién la ejecuta | Ejemplo |
|---|---|---|---|
| Seguridad | Constantes del firmware (nunca en `config`, D22) | Firmware (y el simulador, que hace de firmware) | Límite de bomba, depósito vacío, corte por temperatura |
| Reglas básicas | El hub, en `…/config` (retenido) | Firmware (y el simulador) | Riego por umbral, horario de luz, ventilación |
| Reglas de nivel superior | El hub (A10: las del tiempo, Ajustes › Tiempo exterior) | El hub, con órdenes `cmd` de `source: "automation"`; el dispositivo, con la retención que el hub le pide | Ventana cerrada mientras llueve; avisar de heladas |

Así el invernadero sigue cuidándose aunque el PC esté apagado: el dispositivo aplica la última `config` que recibió (retenida) y sus límites de seguridad. Lo que se pierde sin hub es el historial, las reglas de nivel superior y los avisos *push*, y la app lo dice (D73). Las acciones de las reglas básicas salen en los eventos con `source: "automation"`.

## El hub: historial, API y copias (A4, D87)

**Dónde corre.** En Docker, servicio `hub` de `infra/docker-compose.yml` (`pnpm infra:up` arranca lo que ya está construido; reconstruirlo es `pnpm release`, D92; `pnpm hub:logs`). Publicado solo en `127.0.0.1:8787` (D74); el móvil llega por `https://vitreo.<tailnet>.ts.net/api/…`, que nginx pasa al hub (mismo origen; en desarrollo lo hace el *proxy* de Vite). Si el hub está parado, nginx sigue sirviendo la app y responde `/api` con un 502 en unos 2 s.

**Dónde están los datos.**

| Qué | Dónde | Por qué |
|---|---|---|
| Base de datos viva (SQLite, WAL) | Volumen de Docker `vitreo_hub-data` (`/var/lib/vitreo/hub.sqlite`) | Una carpeta de Windows montada es lenta y su bloqueo de ficheros no es fiable para SQLite |
| Copias nocturnas (7) | `data/hub/backups/hub-AAAA-MM-DD.sqlite` | Visibles y copiables desde Windows |
| Archivo mensual del bruto (> 30 días) | `data/hub/archive/telemetry-<device>-AAAA-MM.ndjson.gz` | Una línea JSON por mensaje: `{"receivedAt": <ms del hub>, "message": <el mensaje tal como llegó>}` (D77, D102) |
| Archivo mensual de los inválidos (> 1 día) | `data/hub/archive/rejected-AAAA-MM.ndjson.gz` | Una línea por mensaje rechazado: `receivedAt`, `topic`, `error` y `payload` tal cual (D102) |

`data/` está en `.gitignore`. La base de datos se abre con **bloqueo exclusivo** mientras el hub corre: otro proceso que intente abrirla recibe "database is locked".

**Por dentro: lo portátil y lo de Node.** La lógica del hub también correrá en la demo pública, en un Web Worker sobre sql.js (D66, D103; paso 2 del plan de la demo, docs/09). Por eso está separada en dos partes, sin duplicar nada:

- **Portátil** (cualquier SQLite síncrono a través de Drizzle, `HubDatabase` de `db/types.ts`): las rutas de la API como funciones sin servidor (`routes.ts`: `hubRoutes(context)` devuelve método, ruta y manejador, y cada manejador responde un valor JSON o un `ApiReply`), el almacén (`db/store.ts`), el historial (`history.ts`), la entrada de mensajes (`ingest.ts`, `handleMessage`), los avisos (`alerts.ts`), la configuración (`configOwner.ts`), el tiempo exterior y sus reglas (`weather/`) y el diario sin sus ficheros (`journalCore.ts`).
- **Solo Node**: `server.ts` sirve esas rutas con Fastify (mismas rutas, mismo orden, el analizador de JPEG de las fotos), `db/open.ts` abre la base de datos con better-sqlite3, `mqtt.ts` es la conexión al broker, `journal.ts` guarda las fotos en ficheros y su copia, `archive.ts` el archivo mensual y `backup.ts`, `push.ts`, `config.ts` e `index.ts` lo demás.
- **ESLint lo vigila**: un módulo portátil no puede importar Node, better-sqlite3, mqtt.js, Fastify ni web-push, ni un módulo de Node (sus tipos, sí).
- **La demo usa ese código** (D109): `portable.ts` lo monta sobre sql.js (como `index.ts` sobre better-sqlite3) y responde como `server.ts`; los avisos *push* son `PushCore` (`pushCore.ts`), que registra sin enviar, y el diario guarda las fotos en memoria. El tiempo de fuera es el `WeatherService` de siempre sin clave y con `source: "simulated"`: el worker le da el cielo de la demo con `feedWeather` cada minuto, y el `WeatherRuleEngine` de siempre decide la retención (D111). `contract.test.ts` exige que las dos rutas den las mismas respuestas, byte a byte.

**Tres modos, que nunca comparten nada** (`HUB_MODE`):

| Modo | Cómo | Base de datos | Invernadero | Puerto |
|---|---|---|---|---|
| `service` | Docker | volumen `hub-data` | `HUB_DEVICE_ID` (`sim`; luego el ESP32) | 8787 |
| `dev` | `pnpm --filter @vitreo/hub dev` | `data/hub-dev/hub-dev.sqlite` | `dev` | 8797 |
| `test` | lo arranca Playwright | en memoria | `e2e` | 8790 |

Cada modo tiene su propia sesión MQTT (`vitreo-hub-<modo>-<device>`), así que el hub de desarrollo no puede abrir la base de datos del de Docker ni publicar la `config` del invernadero real.

**Sin perder datos en reinicios cortos.** El hub se conecta como `hub` con **sesión persistente** (MQTT 5, `clean start` desactivado, caducidad de 7 días, id fijo) y se suscribe a `vitreo/<device>/#` con QoS 1; el dispositivo publica con QoS 1. Mientras solo el hub está parado, Mosquitto le guarda los mensajes (`max_queued_messages 20000`: varios días) y se los entrega en orden al volver. Mosquitto guarda sesiones y colas en disco (`persistence true`, `autosave_interval 60` y al parar), así que la cola sobrevive también a un reinicio del broker. Comprobado el 2026-10-08: hub parado 100 s con un reinicio del broker en medio, y ningún hueco (máximo 31 s entre lecturas, cada 30 s). Los mensajes repetidos (QoS 1, retenidos) no se duplican: índices únicos. **Quedan huecos solo con el PC entero apagado** (broker incluido): el historial los marca como huecos (más de 3 min sin lecturas en bruto, más de 2 h en el horario), nunca los rellena.

**Qué guarda.** Telemetría en bruto (cada mensaje con su `ts`, la hora de llegada y el JSON tal cual), tierra por maceta con `cal`, `event`, `cmd` (con `source`), `ack`, los cambios de `status` y cada revisión de `config`. Un mensaje inválido se aparta (tabla `rejected`) y no tumba el hub; cada noche los de más de un día pasan al archivo mensual (D102). La tabla tiene un tope de 20 000 solo contra una avalancha entre dos noches, y el hub avisa en su registro si llega a recortar. Cada minuto rehace los **resúmenes por hora** de las horas que han recibido datos (media, mínimo y máximo; en los actuadores, la fracción encendida). Una vez al día: el bruto de más de 30 días pasa al archivo mensual y sale de la base de datos (los resúmenes se quedan), y se hace la copia.

**Dueño de `config`** (D73, D89). Al conectar espera 1,5 s por si hay una `config` retenida más nueva (se adopta, nunca se pisa); si no, publica la suya, retenida. La primera vez crea una con **todas las automatizaciones apagadas** y la propuesta de cada especie (docs/08: umbral, segundos, riegos al día; 1 h de pausa; de noche no), luz 07:00–21:00 con poca luz natural, ventilador desde 28 °C y ventana desde 31 °C con 2 °C de margen. La app solo envía las reglas (`PUT /config`); el hub añade versión, revisión, hora, zona y ubicación. Guarda cada revisión y anota cuál confirmó el dispositivo (`config.applied`) y cuál rechazó (`config.rejected`): `GET /config` devuelve `appliedRev` y `rejected`. Las reglas de nivel superior (las del hub, D73) quedan para cuando haga falta alguna: ninguna de las de A6 lo necesita.

**API** (`/api/v1`, esquemas en `packages/shared/src/api/`). Un hub, un invernadero: no hay rutas por dispositivo.

| Ruta | Para |
|---|---|
| `GET /health` | Si responde, de qué invernadero es, si tiene el broker y el último dato guardado |
| `GET /plants`, `PATCH /plants/:zone` | Nombre (o `null` = el de la especie), fecha de siembra y desde cuándo está en su maceta (`since`, A12) |
| `GET /settings`, `PUT /settings/location` | Ubicación (redondeada a 2 decimales, D79) y zona horaria |
| `GET /config`, `PUT /config` | La `config` actual con lo que confirmó o rechazó el dispositivo; nuevas reglas → nueva revisión (A6) |
| `GET /telemetry?from&to` | Historial: en bruto hasta 2 días, por horas más allá; huecos marcados |
| `GET /telemetry.csv?from&to` | Exportación en bruto, una columna por maceta; celda vacía = sin lectura |
| `GET /events?from&to` | Eventos tal como llegaron |

Solo es accesible desde este PC y la tailnet, igual que el broker. Las escrituras son `PUT`/`PATCH`, que otra web no puede mandar sin una comprobación CORS previa, que se rechaza.

**Copias y restauración.** Cada día, a las 03:00 (`HUB_TZ`) o a la primera ocasión después (el PC suele estar apagado de noche), `VACUUM INTO` hace una copia coherente y compacta; se comprueba (`quick_check`) y se conservan 7. Para **restaurar** (probado el 2026-10-08):

```
pnpm hub:backup                           # una copia ahora (la de hoy, reemplazada), con sus fotos
pnpm hub:restore                          # lista las copias de data/hub/backups/
pnpm hub:restore hub-2026-10-08.sqlite    # para el hub, restaura y lo arranca
```

`pnpm hub:backup` (D101) pide la copia al hub desde dentro de su contenedor (`POST /api/v1/backup`, que solo atiende a esa dirección: ni el móvil, a través de nginx, ni el PC, por el puerto publicado, pueden pedirla) y dice cuántas fotos copió y si están todas. `pnpm status` comprueba la última copia: que sea de hoy o de ayer y que estén en `data/hub/backups/photos/` todas las fotos a las que apunta; si falta alguna, lo dice ("a restore would not bring them back"). Probado el 2026-10-14 con un hub aparte: copia, foto borrada del volumen, otra copia (la foto sigue en la copia), restauración ("1 photo(s) brought back") y la foto de vuelta, igual byte a byte.

El script para el contenedor, comprueba la copia, la copia junto a la base de datos viva, guarda la actual en `data/hub/backups/replaced-<hora>.sqlite` y solo entonces la cambia (renombrado atómico); si algo falla, la base de datos de antes sigue en su sitio. Con el hub en marcha se niega ("database is locked"). Lo que llegó después de la copia se pierde (salvo lo que el broker aún tuviera en cola). Para el hub de desarrollo: `pnpm --filter @vitreo/hub restore <copia>` con él parado.

**Con el hub caído** la app sigue en vivo por el broker y lo dice en cada sitio que lo necesita (docs/03). Lo que espera: renombrar plantas, cambiar la ubicación, el historial (A5), cambiar automatizaciones (A6) y los avisos *push* (A7).

## Historial y rebobinar (A5, D88)

**API.** `GET /api/v1/history?from&to&step&zones` devuelve el historial **por cubetas y en columnas** (`ts`, `n` y una columna por medida; `soil` por maceta). `n` es cuántas lecturas tiene cada cubeta: **0 es un hueco** y entonces todas sus columnas son `null`; nada se interpola. Los números son medias; bomba, luz y ventilador, la fracción del tiempo encendidos. Con cubetas de menos de una hora sale de las lecturas en bruto (30 días); desde una hora, de los resúmenes por hora (para siempre), ponderados por lecturas. Como mucho 2000 cubetas por petición. `health` dice también `firstTelemetry`: hasta dónde llega el historial.

**Compatibilidad.** Las respuestas del hub se leen con `z.object`, que ignora campos desconocidos: un hub más nuevo nunca rompe una app más antigua en el móvil. Lo que se envía al hub sigue siendo estricto.

**Rebobinar sin mezclar datos.** El store en vivo sigue recibiendo el broker sin tocarlo; el pasado vive aparte (`data/replay.ts`). La ventana (24 h en cubetas de 5 min, 7 días de 30 min, 30 días de 2 h) se carga **por tramos, del más reciente al más antiguo**, y se rellena en su sitio.
- **Cada fotograma**, la escena lee lo que debe mostrar con `data/sceneReading.ts` (humedad de cada maceta, depósito, ventana, ventilador): del directo o del pasado bajo el cursor. **No hay ningún render de React por fotograma**: la barra de rebobinar es un `<input type="range">` no controlado que escribe su etiqueta directamente en el DOM.
- Los interruptores (luz de cultivo, hueco) se publican en cuanto cambian; los textos del HUD siguen al cursor unas seis veces por segundo.
- Comprobado: 60 fps barriendo una semana fotograma a fotograma (`pnpm perf`, caso "rewind scrubbing").

**Pruebas.** El hub de los e2e (`HUB_MODE=test`) tiene dos rutas solo para él: `POST /api/v1/test/messages` (siembra historial) y `POST /api/v1/test/reset`. En Docker y en desarrollo no existen.

## Publicar: `pnpm release` (D92)

Lo que el móvil ve sale de dos sitios: el **hub de Docker** (su API) y **`apps/web/dist/`** (la PWA que sirve nginx). **`pnpm release` es la única forma de cambiarlos**:

1. se niega si no estás en `main`, si hay cambios sin *commit* o si `main` no está subido (`git fetch` y comparación con `origin/main`): lo que llega al móvil es lo que está en GitHub;
2. reconstruye el hub y el simulador diario y espera a que respondan (si no, para sin tocar la PWA); se niega si hay un simulador arrancado a mano en el puerto 8788;
3. construye la PWA en `apps/web/dist/`;
4. recarga la configuración de nginx (`infra/web/nginx.conf`, comprobada antes con `nginx -t`), para que un cambio en ella también se publique (A8);
5. comprueba que nginx responde.

Nada más escribe en `apps/web/dist/`: `vite build` va a `apps/web/build/`, `pnpm pwa:check` a `dist-check/`, y `pnpm infra:up` no construye imágenes (`--no-build`). Lo comprueba `scripts/publishing.test.mjs` (dentro de `pnpm test`): las comprobaciones de la publicación, que ningún script escribe en `dist/` ni reconstruye el hub o el simulador, y que todos los servicios se reinician solos y publican sus puertos solo en `127.0.0.1`.

## Avisos y notificaciones *push* (A7, D91)

**Una sola fuente de reglas.** Los avisos que la app enseña y las notificaciones salen de la misma función, `deriveAlerts` (`packages/shared/src/alerts/`), con los mismos umbrales (depósito bajo < 20 %, vacío ≤ 5 %, sed por debajo del umbral de la especie) y los límites de seguridad que el dispositivo mantiene (helada, calor; D90). La app los muestra al momento; el hub solo añade **cuánto deben durar** antes de avisar (`PUSH_RULES`) y la política de envío.

| Tipo (Ajustes) | Avisa | Cuándo | Crítico |
|---|---|---|---|
| Depósito | bajo / vacío | al momento | vacío sí |
| Límites de seguridad | helada, calor (con "resuelto" por `safety.cleared`); límites puntuales (bomba por hora, sensor necesario, conexión perdida) | al momento | sí |
| Previsión de helada (A10) | AEMET prevé ≤ 2 °C esta noche: un límite que aún no ha saltado | entre 19:00 y 23:00 | no |
| Sin datos | ninguna lectura | 15 min desde la última (no 10) | no |
| Plantas con sed | por debajo del umbral y sin regar | 3 h | no |

Los sensores rotos y los avisos de automatizaciones se quedan en la app (D91).

**Incidentes** (tabla `incidents` del hub): uno por situación mientras dura (`tank_low`, `thirsty:basil_01`, `no_data`…). **Una notificación por incidente**, como mucho **un recordatorio cada 4 h** ("Sigue igual…") y un **"Resuelto: …"** que la sustituye **sin sonido** (misma `tag`, `renotify: false`). **Horas de silencio 23:00–08:00** (hora local, `HUB_TZ`): los críticos suenan igual; el resto espera a la mañana y se envía si sigue pasando. Tras arrancar, el hub espera 2 min antes de juzgar "sin datos" (el broker aún le entrega lo encolado, D87). El hub mira cada 30 s: una notificación llega en un minuto como mucho.

**Web push.** Claves VAPID **solo en `.env`** (`pnpm hub:vapid` las genera una vez; `HUB_VAPID_PUBLIC_KEY`, `HUB_VAPID_PRIVATE_KEY`, `HUB_VAPID_SUBJECT`). Las suscripciones (una por navegador que activa los avisos, con los tipos que quiere) se guardan en la base de datos del hub. El *service worker* es propio (`apps/web/src/sw/sw.ts`, `injectManifest`): la caché de la app como antes, más `push` (muestra la notificación) y `notificationclick` (abre o enfoca la app en `?open=plant:<id>`, `?open=tank` o `?open=air`). API: `GET /push/key`, `PUT`/`DELETE /push/subscription`, `POST /push/subscription/prefs`, `POST /push/test` ("Probar aviso", solo a ese dispositivo), `GET /alerts` (últimos incidentes).

**Límite honesto**: el hub corre en el PC. **Con el PC apagado o dormido no se envía nada**; Ajustes › Avisos lo dice, y al abrir la app los avisos siguen ahí. Con la Raspberry Pi 24/7 este límite desaparece.

**Pruebas.** El hub de los e2e (`HUB_MODE=test`) **nunca envía**: guarda lo que enviaría (`GET /test/pushes`) y evalúa a una hora dada (`POST /test/evaluate`); `POST /test/incidents` le apunta un aviso pasado de una planta (A8: la sed tarda horas en contar). El navegador de los e2e usa una suscripción falsa. Nada de las pruebas toca la suscripción del móvil. `pnpm pwa:check` construye en `dist-check/`, nunca en el `dist/` que sirve nginx.

## Diario de planta (A8, D93)

Notas y fotos por planta, en "Diario" de su hoja, mezcladas con lo que el hub ya sabe de esa planta: riegos (tuyos y automáticos, con su motivo), avisos (abierto y resuelto), cambios de su riego automático (activado, desactivado, umbral) y, como línea neutra, los eventos de un tipo que el hub no conoce (D108). Más reciente arriba, por días, de 30 en 30.

**API** (bajo `/api/v1`):

| Método y ruta | Qué hace |
|---|---|
| `GET /journal/:zone` | `{ entries, events }`: notas y fotos sin borrar, y la historia de los últimos 90 días |
| `POST /journal/notes` | `{ id, zone, text, tags, createdAt }`; el `id` (UUID) lo pone el móvil: enviar dos veces guarda una. `text` puede ir vacío si hay etiquetas (D102) |
| `PUT /journal/:id/photo?zone&createdAt&width&height&caption&tags` | el cuerpo es el JPEG (`image/jpeg`, ≤ 1,5 MB); 400 si no es JPEG, 413 si es grande; `tags` separadas por comas |
| `POST /plants/:zone/chapter` · `GET /plants/:zone/chapters` | una planta nueva en la maceta (`{ name, sownAt }`): la de antes pasa a capítulo; y la lista de capítulos (D102) |
| `GET /journal/:id/photo` | la foto (inmutable: se guarda en caché) |
| `DELETE /journal/:id` · `POST /journal/:id/restore` | borrar (suave) y "Deshacer" |
| `GET /storage` | lo que ocupa el hub: base de datos, fotos, copias y fotos de los últimos 30 días |

**Privacidad de las fotos.** Ninguna ubicación sale del móvil: el navegador endereza la foto, la reduce a 1600 px de lado largo y la recodifica en JPEG de ~300 KB (calidad de 0,82 hacia abajo hasta caber). Recodificar en un `canvas` deja solo los píxeles; después se quitan los segmentos de metadatos que añade el propio navegador (APP1–APP15 y comentarios: Chrome mete un perfil sRGB) con la misma función de `packages/shared/src/photo` y, si quedara alguno, la foto no se envía. El hub la pasa otra vez por esa función antes de guardarla. Lo comprueban los tests del hub y el e2e de A8 (una foto con GPS en el EXIF: lo que sale del navegador y lo que guarda el hub no lo llevan).

**Dónde se guardan.** Las filas, en la base de datos (`journal_entries`); las fotos, como `<id>.jpg` junto a ella, en el volumen de Docker (`/var/lib/vitreo/photos`). Cada noche, con la copia de la base de datos, se copian a `data/hub/backups/photos/` (entera o nada: primero a un `.partial`), y `pnpm hub:restore` devuelve al volumen las que falten. Una foto sale de esa carpeta solo cuando ya no apunta a ella ninguna base de datos, ni la viva ni ninguna de las 7 copias (D101): una foto perdida del volumen, o el volumen entero, nunca se pierde también de las copias. Borrar marca la fila; a los 7 días se borran la fila y el archivo del volumen, y la copia la guarda mientras alguna copia de la base de datos la nombre.

**Etiquetas, el diario del invernadero y los capítulos (A12, D102).** Cada entrada lleva `tags` (columna JSON en `journal_entries`): de una planta `watered`, `sown`, `transplanted`, `pruned`, `harvested`, `pest`, `yellow_leaf`; del invernadero `refilled`, `maintenance`, `sensor_changed`, `fault`, `leak`. Una etiqueta desconocida (de un hub más nuevo) se ignora al leer. El diario del invernadero es el de la zona `greenhouse` (`GET /journal/greenhouse`). Una planta nueva en una maceta guarda la de antes en `plant_chapters` (nombre, siembra, desde y hasta, para siempre) y pone `since` en `plants`; la historia de la maceta dice dónde cambió (evento `chapter`). La maceta (`basil_01`) no cambia: los datos de la fase B se separan por capítulo con esas fechas.

**Cuánto ocupa.** Una foto, 250–320 KB; una nota, menos de 1 KB. Con una foto al día, unos **9 MB al mes** (con una foto por planta a la semana, unos 8 MB), más otro tanto en la copia de `data/hub/backups/photos/`: entre 15 y 20 MB al mes en total. Ajustes › Acerca de lo muestra ("Almacenamiento" y "Fotos, último mes").

**Sin hub.** Cada diario abierto se guarda en el móvil (IndexedDB) y se muestra con "es el diario guardado en este móvil" si el hub no responde. Lo nuevo se escribe primero en el móvil (IndexedDB; si el navegador no lo permite, en memoria hasta cerrar) y se envía después; mientras, "Se guardará cuando el hub responda". Se reintenta cuando el hub vuelve y cada 30 s; un 5xx o un fallo de red es "esperar", un 4xx es "el hub no la ha aceptado" (se queda, con "Descartar"). Borrar necesita el hub (el botón se desactiva). Las fotos ya vistas las guarda el *service worker* (las últimas 300).

## Tiempo exterior: AEMET (A10, D97)

**Clave.** `AEMET_API_KEY` en `.env` (gratuita en opendata.aemet.es; solo ahí, nunca en el repositorio). Después, `pnpm infra:up` (el contenedor del hub la recoge). `AEMET_MUNICIPIO` (por defecto `28079`, Madrid) y `AEMET_ESTACION` (vacío: el hub elige la estación más cercana a la ubicación de Ajustes, una vez, y la vuelve a elegir si la ubicación se mueve más de 2 km). Los hubs de los e2e nunca llaman a AEMET, aunque haya clave en `.env`.

**Comprobado contra AEMET real** (2026-10-13): las dos peticiones, ISO-8859-15 (acentos y eñes bien), la estación más cercana y la previsión horaria, con el mismo código que los tests. La primera hora de la previsión puede venir sin temperatura ni viento: quedan en `null`.

**Qué estación.** La más cercana **que publica observaciones horarias en abierto**. Algunas estaciones del inventario de AEMET no dan datos en `observacion/convencional` (respuesta "no hay datos", comprobado el 2026-10-13 y el 2026-10-14) o solo tienen valores climatológicos diarios, con unos cuatro días de retraso, que no sirven para "ahora"; el hub las salta.

**AEMET va 1–2 h por detrás.** La observación más reciente suele ser de hace una o dos horas. Por eso la regla de la ventana también arranca con la **previsión de la hora actual**: lluvia o nieve (desde A10, si el pluviómetro no midió nada) y viento fuerte (desde el 2026-10-14, aunque la estación no lo viera). El motivo dice de dónde sale (`from`: `station` o `forecast`; "viento fuerte previsto", "según la previsión de AEMET"). Una falsa alarma solo significa ventilador en vez de ventana. La cabecera enseña la edad de la lectura de fuera a partir de una hora: "12° fuera · hace 1 h".

**Consultas.** Cada 10 min, la observación de la estación (`observacion/convencional/datos/estacion/<idema>`); cada hora, la previsión horaria del municipio (`prediccion/especifica/municipio/horaria/<id>`): unas 16 peticiones por hora (AEMET permite 50 por minuto). Cada dato pide dos (dónde está y el dato); la clave va en una cabecera, nunca en la dirección, y AEMET responde en ISO-8859-15. Cada petición se rinde a los 15 s; tras un fallo, se reintenta a los 5 min (15 si AEMET pide esperar). Sobrevive a un reinicio: lo último guardado vuelve de la base de datos.

**Historial.** Tabla `weather_observations` (una fila por hora, con la fila de AEMET tal cual, junto a la telemetría; para siempre) y `weather_forecasts` (cada previsión emitida, por horas). `GET /api/v1/weather/history?from&to` las devuelve (con el nombre de la estación), filtradas en la base de datos; `GET /api/v1/weather.csv?from&to` igual en CSV (`time_utc,ts,station,temp_c,rh,wind_ms,gust_ms,precip_mm,source`, unidades SI, vacío = AEMET no lo dio, `AEMET` en cada fila). Las usa la hoja del invernadero (A11).

**API**: `GET /weather` (estado: `no-key`, `starting`, `failing` con el motivo, `ok`; el mensaje que publica; las reglas y lo que hace ahora la de la ventana) y `PUT /weather/rules` (`closeWindow`, `frostWarning`). Pruebas: `POST /test/weather` (el tiempo como si viniera de AEMET, a una hora dada) y `POST /test/weather/evaluate`.

**Reglas del hub** (las primeras de nivel superior, que D89 dejó fuera), cada una se apaga en Ajustes › Tiempo exterior:

1. **Ventana cerrada con lluvia, nieve o viento fuerte**: con datos en directo, el hub pide al dispositivo una **retención** (`outdoorHold`, 30 min, renovada cada 10 mientras dure el tiempo) en vez de cerrar la ventana él: así no pelea con la ventilación del propio invernadero. El dispositivo la cierra (el menú Aire dice "Cerrada: llueve fuera, 1,2 mm en la última hora", o "Cerrada mientras llueva fuera: ventila solo el ventilador") y ventila solo con el ventilador. **Gana la protección por calor** ("Llueve fuera, pero el calor dentro la mantiene abierta"; al pasar, se vuelve a cerrar) y **gana quien la abre a mano** hasta que pase. Cuando deja de llover o de soplar (o se apaga la regla, o deja de saberse el tiempo), el hub la libera y el invernadero vuelve a sus reglas. Nunca actúa sobre un dispositivo que no ve (datos de más de 2 min): una retención sin renovar termina sola.
2. **Avisar de heladas**: entre las 19:00 y las 23:00 (antes de las horas de silencio), si la mínima prevista hasta las 10:00 es de 2 °C o menos, una notificación "Helada prevista: 1 °C a las 6:00", de su propio tipo **"Previsión de helada"** (no crítica, con su interruptor en Avisos; "Límites de seguridad" es para límites que han saltado), una sola por noche; queda en Ajustes › Avisos y se archiva sola al día siguiente. Las suscripciones de antes de A10 la reciben activada (migración del hub y de cada navegador).

**Atribución** (nota legal de AEMET): "Fuente: AEMET" y la hora de la última actualización en Ajustes › Tiempo exterior, donde se ven los datos; nada sugiere que AEMET respalde la app.

**Sin clave o sin hub**: la escena no muestra tiempo (neutra), la cabecera no enseña la temperatura de fuera y Ajustes › Tiempo exterior dice por qué.

**Permisos del broker.** Mosquitto copia la ACL al arrancar: `pnpm release` compara la del contenedor con `infra/mosquitto/acl` y, si cambió, reinicia el broker (unos segundos; el móvil y el invernadero se reconectan solos).

## La app: organización interna

- **Una sola fuente de verdad** del estado del dispositivo (store de Zustand), alimentada por MQTT.
- La escena 3D **lee** del store; nunca habla directamente con MQTT.
- Las acciones de la UI pasan por un servicio `commands` que publica, espera el ACK y gestiona tiempo de espera y reintento.
- Modo **simulado** conmutable (variable de entorno o ajuste): la app se conecta al simulador. Imprescindible para desarrollar la estética sin hardware.
- Modo **rebobinar**: el store puede alimentarse desde el historial del hub en lugar de en vivo.

## Rendimiento 3D

- `dpr` limitado a `[1, 2]` y ajuste dinámico con `PerformanceMonitor` de drei.
- Luz horneada; como mucho una luz dinámica + sombra de contacto.
- Instancias (`InstancedMesh`) para grava, hojas repetidas y partículas.
- Texturas KTX2, geometría comprimida (meshopt).
- Post-procesado mínimo (quizá un *tone mapping* suave y viñeta leve); nada de bloom caro en móvil.
- Pausar el render cuando la pestaña no está visible.
- Nivel de calidad "bajo": sin partículas ni cristal con fresnel; y "sin 3D": vista de lista.

## Red local y seguridad

- Mosquitto con **usuario y contraseña** incluso en local, y tres usuarios con ACL (`infra/mosquitto/acl`):
  - `device` (ESP32 y simulador): publica `status`, `telemetry`, `event` y `ack`; lee `cmd` y `config`.
  - `hub`: lee todo; publica `cmd` y `config`.
  - `web`: lee todo; solo publica `cmd`. Su contraseña viaja en el paquete de la app, así que los cambios de `config` pasan por la API del hub.
  - Pendiente (fase 3): limitar cada dispositivo a su propio prefijo (`pattern … vitreo/%u/…`).
- El fichero de contraseñas se genera al arrancar el contenedor a partir de `.env`; `pnpm broker:check` comprueba autenticación y ACL.
- **Todos los puertos de los contenedores se publican en `127.0.0.1`** (D74): nada es accesible desde la red de casa; al móvil se llega solo por Tailscale. **Nunca se usa Tailscale Funnel.** Excepción prevista para la fase 3: el ESP32 no está en la tailnet y necesita el MQTT normal (1883) por la red de casa; se decidirá entonces (abrir solo ese puerto a la LAN o llevar el broker a la Pi).
- Secretos en `.env` (nunca en el repositorio); `.env.example` documentado.
- Direcciones fijas: reserva de IP en el router o `mDNS` (`vitreo.local`).

## Después de reiniciar el PC (D94)

Todo vuelve solo: la tarea de inicio de sesión arranca Docker Desktop, y sus cuatro servicios (`mosquitto`, `web`, `hub` y el **simulador diario**, `simulator`) llevan `restart: unless-stopped`; Tailscale corre como servicio de Windows y su `serve` se guarda (`--bg`). El simulador diario es un contenedor más (dispositivo `sim`, API de control en `127.0.0.1:8788`), no un proceso lanzado a mano; `pnpm release` lo reconstruye junto al hub. Los e2e siguen usando el suyo (8789).

**El simulador diario no olvida (D100).** Guarda su invernadero en el volumen `vitreo_sim-data` (`SIMULATOR_STATE_FILE`) cada minuto y al parar: la tierra de cada maceta, el depósito, el aire, la cuenta de riegos automáticos del día y la última hora de la bomba. Tras `pnpm release` o un reinicio del PC sigue donde estaba, con la tierra secada lo que tocaba mientras estuvo parado (hasta 14 días) y sin regar en ese tiempo; su registro dice "carrying on from … (N min away)". No guarda escenarios ni sensores rotos. Para empezar de cero: `docker compose --env-file .env -f infra/docker-compose.yml rm -sf simulator`, `docker volume rm vitreo_sim-data` y `pnpm infra:up`. Los simuladores de los e2e nunca guardan nada.

**Ajustes del PC que hay que activar a mano** (una vez): que no se suspenda mientras está enchufado, que la sesión vuelva sola tras una actualización del sistema y que Tailscale funcione sin sesión iniciada. Con el PC suspendido o sin sesión no hay hub, ni simulador, ni datos, ni avisos.

**Docker Desktop no arranca solo, a propósito** (decidido el 2026-10-16): su ajuste *Start Docker Desktop when you sign in* está **apagado** y así se queda. Lo arranca la **tarea de inicio de sesión** (abajo): una sola pieza que arranca Docker, repara y avisa si algo falla, en vez de dos que se pisan. Que nadie lo espere encendido ni lo encienda para "arreglar" un arranque.

Docker Desktop necesita una sesión de Windows: tras un reinicio la tarea corre al iniciar sesión, y tras uno de Windows Update la sesión entra y se bloquea sola (los ajustes de arriba). Sin sesión no hay datos, y **apagar el PC** (Inicio › Apagar) lo para todo hasta el siguiente inicio de sesión: en la semana de prueba, 31 h y 22 h sin datos los días 16 a 18 de octubre.

**Puertos muertos tras arrancar Docker Desktop.** Probado reiniciando Docker Desktop (y WSL) tres veces: los contenedores vuelven solos y sanos, pero su *proxy* de puertos deja a veces algún puerto publicado aceptando conexiones sin responder ("empty reply"); cada vez uno distinto (la app, el broker, el simulador). Reiniciar ese contenedor lo arregla. Por eso existe la **tarea de inicio de sesión** `Vitreo after sign-in` (`pnpm boot:install`, una vez; `pnpm boot:remove` la quita): un minuto después de entrar en Windows, y luego **cada 30 minutos** mientras la sesión siga abierta, ejecuta `pnpm status --repair`, que espera a Docker, prueba cada puerto con una respuesta real (HTTP; un `CONNECT` de MQTT en 1883; un *upgrade* de WebSocket en 9002), reinicia solo los contenedores cuyo puerto no responde y apunta lo que hizo en `data/status.log`. Corre como tu usuario, sin permisos de administrador, y usa los scripts de la copia del repositorio (la de `main`). Corre **sin ventana** (`conhost --headless`).

**La tarea arranca Docker.** El 2026-10-15 Windows Update reinició el PC a las 04:13 y Docker Desktop no volvió al iniciar sesión (su ajuste de arranque está apagado): 33 h sin datos en la semana de prueba, y la tarea, esperando a Docker, la cortó Windows a los 15 minutos sin dejar el aviso en el log. Desde entonces `pnpm status --repair`: abre Docker Desktop él mismo si no responde (es la única manera en que arranca); no espera más de un minuto a ninguna orden de Docker; deja de reiniciar contenedores a los 10 minutos para que el informe llegue antes del corte; y si algo sigue caído lo dice con una **notificación de Windows** ("…: el invernadero no se está registrando"), no solo en `data/status.log`. Lo que no puede arreglar: entre el reinicio y el inicio de sesión no hay datos (Docker Desktop necesita la sesión; en la fase 3 lo resuelve la Raspberry Pi).

**Cada 30 minutos, y sin ventana** (desde el 2026-10-22). El 2026-10-19 a las 08:35 la tarea corrió al iniciar sesión y terminó con `0xC000013A` sin escribir nada: con `powershell -WindowStyle Hidden`, Windows la abría igualmente en una ventana de Windows Terminal, y cerrar esa ventana corta lo que corre dentro. Docker no arrancó y nada volvió a comprobarlo hasta el día 22: 3,7 días sin datos. Desde entonces:

- La tarea corre en una consola sin ventana (`conhost.exe --headless`), así que no hay nada que cerrar.
- Se repite cada 30 minutos con la sesión abierta, también bloqueada (un segundo disparador, por horas desde que se instala: una repetición colgada del inicio de sesión no empezaría hasta el siguiente). Si Docker Desktop se cierra, o una pasada se corta, se pierde media hora como mucho. Una pasada que sigue en marcha cuando toca la siguiente hace que esa se salte.
- Una pasada que lo encuentra todo en marcha y no arregla nada no escribe en `data/status.log`. Solo deja `data/status-last.json`: cuándo empezó, cuándo terminó y qué encontró. `pnpm status` lo enseña ("the repair task checked N min ago"), y marca un fallo si la última comprobación tiene más de 45 minutos o si empezó y no terminó.
- El mismo problema se vuelve a notificar a las 3 horas, o en cuanto cambia.
- Mientras `pnpm release` reconstruye los contenedores (`data/release.lock`), la tarea no toca nada.
- **Para parar los servicios a propósito** durante más de media hora (`pnpm infra:down`, cerrar Docker Desktop): primero `pnpm boot:remove`, y al terminar `pnpm boot:install`. Si no, la tarea vuelve a arrancar Docker Desktop y avisa de que el invernadero no se registra.
- Tras cambiar `scripts/boot-task.ps1` hay que volver a ejecutar `pnpm boot:install` (desde `main`).

**Comprobar** (un par de minutos después de iniciar sesión):

```sh
pnpm status            # lo que está en marcha y qué hacer con lo que no
pnpm status --repair   # lo mismo, reiniciando los contenedores con el puerto muerto
```

Una línea por pieza: Docker, los cuatro servicios (sanos y con respuesta real en cada puerto), el hub con datos de hace menos de 2 minutos y la dirección del móvil por Tailscale. Cada fallo dice qué hacer. La última línea dice cuándo comprobó la tarea por última vez; `data/status.log`, qué arregló o qué encontró caído. Después, en el móvil, abrir la app: "En directo".

## Acceso desde el móvil: Tailscale (HTTPS)

Instalar la PWA en el móvil exige HTTPS, y una página HTTPS solo puede hablar con el broker por `wss://`. Se resuelve con **Tailscale Serve** (D48), que publica dos servicios de la máquina `vitreo` **solo dentro de la tailnet** (nunca en internet, sin `funnel`), con certificados válidos de `*.ts.net`:

| Dirección | Publica | Qué es |
|---|---|---|
| `https://vitreo.<tailnet>.ts.net` | `http://127.0.0.1:8080` | La PWA ya compilada (`apps/web/dist`), servida por un nginx del `docker-compose` (servicio `web`); desde A4, también la API del hub en `/api` |
| `wss://vitreo.<tailnet>.ts.net:8443` | `http://127.0.0.1:9002` | El WebSocket de Mosquitto |

- La app decide la URL del broker en tiempo de ejecución: servida por HTTPS usa `wss://` en el **mismo host, puerto 8443** (`VITE_MQTT_URL_SECURE` lo cambia); por HTTP usa `VITE_MQTT_URL`. Así no depende de "estar en casa".
- El **ESP32 no cambia**: sigue con MQTT normal (1883) en la red local.
- Servir una carpeta directamente con `tailscale serve` exige permisos de administrador en Windows; por eso la web la sirve nginx en `127.0.0.1:8080`, solo accesible desde el propio PC.

Puesta en marcha (una vez; `--bg` la mantiene tras reiniciar):

```sh
pnpm release                                    # en main, limpio y subido: hub, simulador y PWA en apps/web/dist (D92)
pnpm infra:up                                   # mosquitto + web (nginx) + hub + simulador ya construidos
tailscale serve --bg --https=443 http://127.0.0.1:8080
tailscale serve --bg --https=8443 http://127.0.0.1:9002
tailscale serve status                          # comprobar; `tailscale serve reset` lo quita todo
```

### Dirección estable: la máquina `vitreo` (D75)

La dirección de la app es el nombre de la máquina en Tailscale, y una PWA instalada, sus datos del navegador y sus permisos de notificación van ligados a esa dirección. Por eso la máquina que sirve Vitreo se llama siempre **`vitreo`**, sea el PC o, más adelante, la Raspberry Pi.

Renombrar el PC (una vez, en la consola de administración):

1. <https://login.tailscale.com/admin/machines> → la fila del PC → menú **⋯** → **Edit machine name…**
2. Desmarcar **Auto-generate from OS hostname**, escribir `vitreo` y guardar.
3. **Rehacer `tailscale serve`**: su configuración va ligada al nombre (`tailscale serve status` sigue mostrando el antiguo y la dirección nueva no responde). `tailscale serve reset` y los dos `tailscale serve --bg …` de abajo. El certificado del nombre nuevo se pide solo en la primera visita (unos segundos).
4. Comprobar: `tailscale status` muestra `vitreo`, `tailscale serve status` muestra `vitreo.<tailnet>.ts.net` y la dirección abre la app. La antigua deja de funcionar.
5. En el móvil: desinstalar la PWA antigua e instalarla desde la dirección nueva (se pierden el tema elegido y la bienvenida vista, que viven en el navegador).

Los nombres de las máquinas con HTTPS aparecen en los registros públicos de certificados: un nombre neutro como `vitreo` no revela nada.

Al pasar a la Raspberry Pi: renombrar antes el PC (p. ej. `pc`), dar a la Pi el nombre `vitreo`, copiar `infra/`, `.env` y `data/hub/` (la base de datos, con las suscripciones *push*, el historial y la `config`), arrancar el `docker-compose` y repetir los dos `tailscale serve` de abajo en la Pi. La PWA instalada sigue funcionando.

Para actualizar la app instalada basta con `pnpm release`: el service worker detecta la nueva versión y se actualiza solo. Los datos en vivo vienen del simulador diario (un servicio de Docker, D94) o, más adelante, del ESP32.

## Preparado para salir de casa (fase posterior)

Opciones, de más sencilla a más compleja:

1. **Tailscale** (VPN personal): el móvil entra en tu red de casa desde fuera. **En uso desde la fase 1** para la PWA en el móvil (ver arriba).
2. Broker MQTT en la nube (HiveMQ Cloud, EMQX Cloud) con puente desde el Mosquitto local.
3. Hub desplegado en la nube con autenticación completa.

Por eso la app nunca asume "estoy en local": la URL del broker y de la API son configurables.
