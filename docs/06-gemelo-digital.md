# 06 · Gemelo digital

Cómo el invernadero real y el digital se reflejan el uno en el otro. La idea central: **traducir datos a lenguaje visual**, para que la escena se lea sin mirar números.

## Del dato a la escena

| Dato real | Qué se ve en el 3D | Detalle |
|---|---|---|
| Humedad de tierra (por maceta) | Color de la tierra seco ↔ húmedo | Interpolación continua entre `#8A6E55` y `#4A3629` |
| Humedad de tierra muy baja | La planta se mustia | Shape key `wilt` de 0 a 1 por debajo del umbral |
| Humedad del aire alta | Cristal empañado | Shader de condensación, más intenso en la parte baja |
| Temperatura alta | Aire que "tiembla" levemente sobre el techo | Muy sutil, opcional |
| Temperatura baja | Tono ligeramente más frío, escarcha en esquinas si < 5 °C | |
| Luz ambiente (lux) | Intensidad de los haces de luz y las motas de polvo | Se combina con la hora del día |
| Luz de cultivo encendida | Barra de luz iluminada, halo cálido en el cristal | Muy visible de noche |
| Ventilador encendido | Aspas girando, hojas cercanas se mueven más | |
| Ventana abierta (servo) | Ventana abierta en el ángulo real | Shape key `open` |
| Bomba regando | Gotas cayendo en la maceta, la tierra se oscurece | Sincronizado con el evento real |
| Nivel del depósito | Agua visible en el depósito | Altura proporcional |
| Crecimiento | Etapas de la planta | Manual (desde el diario) o por días desde la siembra |
| Desconexión | Escena desaturada y luz neutra ("dormido") | Con texto "desde las 14:10" |
| Hora real | Día, atardecer, noche | `suncalc` + ubicación |
| (Opcional) Tiempo exterior | Lluvia sobre el cristal, nubes | API pública del tiempo |

### Diseño avanzado: cada objeto, su dato

Para la versión avanzada del diorama ([`02-direccion-artistica.md`](02-direccion-artistica.md#ideas-de-diseño-avanzado)), cada objeto nuevo existe porque representa un dato o un actuador real. **No se implementa todavía** (D53).

| Objeto | Dato o actuador | Cómo se ve | Contrato MQTT |
|---|---|---|---|
| Depósito exterior (`tank`) | Nivel del depósito | Altura del agua visible en el depósito (shape key `level` o escala de `tank_water`); con el depósito vacío, el tono `--warm` y un texto | `telemetry.tank.level` (0–1), `safety.triggered` con `tank_empty` |
| Manguera (`tank_hose`) | Bomba / riego | Unas gotas o un leve pulso a lo largo de la manguera mientras riega | `telemetry.actuators.pump`, eventos `watering.started` / `watering.finished` |
| Barra bajo el caballete (`grow_light`) | Luz de cultivo | Barra iluminada y halo cálido en el cristal | `telemetry.actuators.growLight`, orden `growLight` |
| Ventilador del hastial (`fan`) | Ventilador | Aspas girando mientras está encendido | `telemetry.actuators.fan`, orden `fan` |
| Ventana de tejado (`vent_window`) | Ventana (servo) | Abierta en el ángulo real (shape key `open`, 0–1) | `telemetry.actuators.vent`, orden `vent` |
| Caja de sensores (`sensor_box`) | Estado del dispositivo | Pequeño piloto: normal, dormido (desconexión) o sensor roto | `status`, `sensor.error`, `rssi` |
| Puerta con tirador (`door`) | — | Decorativa | — |
| Vegetación y piedras (`decor_*`) | — | Decorativas, **opcionales y dosificadas** | — |

**Regla de honestidad**: si un dato es antiguo (> 2 min sin telemetría), la escena lo indica. Nunca se inventan valores.

## Del gesto al invernadero

| Gesto en la app | Qué pasa en el real | Feedback |
|---|---|---|
| "Regar" en una planta | Bomba/válvula de esa zona X segundos | Gotas en la escena, "Regando · 4 s", ACK |
| Interruptor de luz | Tira LED de cultivo on/off | Halo en la escena |
| "Aire" | Ventilador N minutos y/o ventana abierta | Aspas, ventana |
| Ajustar umbral de riego | Se envía nueva `config` al ESP32 | "Guardado" + deshacer |
| Horario de luz | Se envía `config` | Vista previa en la línea de tiempo |

## Automatizaciones

Escritas y mostradas en **lenguaje natural**, activables con un interruptor:

- Regar *[planta]* cuando la tierra baje del *[35 %]*, durante *[5 s]*, como mucho *[2]* veces al día.
- Encender la luz de *[7:00]* a *[21:00]* si la luz natural es menor de *[X lux]*.
- Ventilar si la temperatura supera *[28 °C]* o la humedad del aire supera *[85 %]*.
- Avisarme si el depósito baja del *[20 %]*.
- Avisarme si no hay datos durante *[10 min]*.

Plantillas por especie (ver [`08-plantas.md`](08-plantas.md)) rellenan los valores por defecto.

## Avisos, en tono amable

Ejemplos de redacción:

- "La albahaca tiene sed. ¿La riego?" (con botón)
- "Queda poca agua en el depósito."
- "Hace calor dentro: he abierto la ventana."
- "No sé nada del invernadero desde las 14:10."

Notificaciones del sistema (push) solo para lo importante; configurable.

## Funciones extra (ideas para después)

- **Rebobinar**: deslizar una línea de tiempo y ver el invernadero como estaba ese día y hora.
- **Timelapse real**: cámara (ESP32-CAM) haciendo fotos diarias; se muestran junto al 3D.
- **Diario de planta**: notas, fotos, fecha de siembra, cosechas. Da contexto a los datos.
- **Etapas de crecimiento** ligadas al diario, que cambian el modelo 3D.
- **Resumen semanal** tranquilo: "Esta semana regaste 6 veces; la menta ha crecido".
- **Modo ventana**: pantalla completa sin interfaz, para una tablet en la pared o como salvapantallas.
- **Calibración guiada** de sensores de tierra desde la app (seco en aire / en vaso de agua).
- **Estado de salud del sistema**: señal wifi, versión de firmware, último reinicio.
- **Exportar datos** a CSV.
- **Cosechas**: registrar lo recogido y verlo acumulado.
- **Visita guiada**: la cámara recorre sola el invernadero planta por planta (modo contemplación).

## Simulador

Antes de tener hardware, `apps/simulator` publica telemetría realista por MQTT:

- Ciclo día/noche de temperatura, humedad y luz.
- Tierra que se seca poco a poco y sube al regar.
- Responde a órdenes con ACK y eventos, respetando los mismos límites de seguridad.
- Escenarios forzables: "ola de calor", "depósito vacío", "desconexión", "sensor roto".

Esto permite diseñar todos los estados visuales en la fase 1.

Implementación (`apps/simulator`):

- Un modelo puro y determinista (`src/model/greenhouse.ts`) con los **mismos límites de seguridad** que el firmware (`src/model/safety.ts`): 15 s por riego, 60 s por hora móvil, sin bomba con el depósito vacío o de nivel desconocido, ventilación forzada y luz apagada por encima de 35 °C (se libera por debajo de 32 °C), bomba parada si se pierde la conexión.
- Clima según la posición real del sol (`suncalc`, Madrid por defecto); tierra que se seca de forma casi exponencial (≈ 0,1 al día) y sube 0,03 por segundo de riego.
- Parámetros físicos en datos (`src/model/params.ts`), reemplazables con un JSON (`SIMULATOR_PARAMS`); `SIMULATOR_TIME_SCALE` acelera los procesos lentos.
- Escenarios forzables con una API local solo para desarrollo en `http://127.0.0.1:8788`:

```sh
curl -X POST localhost:8788/scenario -d '{"scenario":"heatwave","active":true}'
curl -X POST localhost:8788/scenario -d '{"scenario":"humid","active":true}'      # bochorno: condensación (A9)
curl -X POST localhost:8788/scenario -d '{"scenario":"tank_empty","active":true}'
curl -X POST localhost:8788/scenario -d '{"scenario":"disconnect","active":true}'   # LWT real
curl -X POST localhost:8788/scenario -d '{"scenario":"sensor_failure","active":true,"sensor":"soil","zone":"basil_01"}'
curl -X POST localhost:8788/soil -d '{"zone":"basil_01","moisture":0.1}'
curl -X POST localhost:8788/air -d '{"temp":36}'                                    # el aire, ya: calor o helada (A10)
curl localhost:8788/state
```
