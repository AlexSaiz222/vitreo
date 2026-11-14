# 12 · Ideas de IA para el futuro

> **Estado (2026-10-14, D99): sin funciones con LLM por ahora, ni en la nube ni en local.** La fase B de la hoja de ruta son **modelos propios**, entrenados en casa con los datos reales de este invernadero:
> - previsión de la humedad de la tierra y riego predictivo por planta (IA01);
> - fallos de sensores y fugas (IA03).
>
> Empieza tras meses de datos del hardware real; el plan está en `09-roadmap.md`, fase B. El resto de este documento sigue siendo un banco de ideas para más adelante (y posible cantera de trabajos del máster o del TFM). Lo que sí se hace desde ya es **preparar los datos** (ver el final del documento).
>
> Un asistente con LLM (IA09 e IA10, con humano en el bucle) quedó hecho y **aparcado** en la rama `feat/phase-b1-assistant`, sin fusionar (D98, sustituida por D99).

## Por qué tiene sentido aquí

Un invernadero con gemelo digital es un laboratorio ideal de IA aplicada a la domótica:

- Genera **series temporales** limpias y continuas (aire, luz, tierra, actuadores).
- Tiene **acciones con efecto medible** (riego → sube la humedad), lo que permite aprender control.
- Puede generar **imágenes** del mismo encuadre cada día (timelapse).
- Ya cuenta con un **simulador** y un **contrato de datos** bien definido.
- Es pequeño y de bajo riesgo: se puede experimentar sin poner en peligro una casa entera.

## Mapa de ideas

Leyenda. **Dificultad**: ● baja · ●● media · ●●● alta. **Dónde se ejecuta**: ESP32 (en el dispositivo), hub (en casa), nube.

| # | Idea | Área | Dificultad | Dónde | Datos necesarios | ¿TFM? |
|---|---|---|---|---|---|---|
| IA01 | Riego predictivo y previsión de la humedad (**fase B**) | Series temporales | ●● | Hub | Historial de humedad + riegos | ✓ |
| IA02 | Sensor virtual de humedad | Regresión | ●● | Hub | Macetas con y sin sensor | |
| IA03 | Detección de anomalías y fallos (**fase B**) | Series temporales | ●● | Hub / ESP32 | Historial + eventos etiquetados | ✓ |
| IA04 | Salud de la planta por imagen | Visión | ●●● | Hub / nube | Fotos etiquetadas | ✓ |
| IA05 | Medición de crecimiento por timelapse | Visión | ●● | Hub | Fotos diarias con encuadre fijo | ✓ |
| IA06 | Control óptimo del clima (MPC) | Control | ●●● | Hub | Historial + modelo del sistema | ✓ |
| IA07 | Aprendizaje por refuerzo con *sim-to-real* | Control / RL | ●●● | Hub | Simulador calibrado | ✓ |
| IA08 | Luz y riego según el precio de la electricidad | Optimización | ●● | Hub | Precio horario + consumo | |
| IA09 | Conversar con el invernadero (aparcada) | LLM | ●● | Hub + nube/local | API del hub | |
| IA10 | Agente con herramientas y guardarraíles (aparcada) | LLM / agentes | ●●● | Hub + nube/local | API + reglas de seguridad | ✓ |
| IA11 | Diario asistido y resumen semanal | LLM / multimodal | ● | Nube/local | Historial + fotos + notas | |
| IA12 | Recomendador de especies y ajustes | Recomendación | ●● | Hub / nube | Fichas de especie + clima local | |
| IA13 | TinyML en el propio ESP32 | Edge AI | ●●● | ESP32 | Modelo pequeño ya entrenado | ✓ |
| IA14 | Crecimiento procedural "fiel" en el 3D | Generativo | ●●● | App | Medidas de crecimiento (IA05) | ✓ |
| IA15 | Extender a la casa entera | Domótica | ●●● | Hub | Otros sensores de la casa | |

## Detalle por área

### 1. Series temporales y predicción

**IA01 · Riego predictivo** (fase B). La primera pieza es prever la humedad de cada maceta a 6, 12 y 24 h. En lugar de regar al cruzar un umbral, predecir cuándo se cruzará y regar la cantidad justa. Punto de partida sencillo: modelar la curva de secado de cada maceta (casi exponencial) en función de temperatura, humedad del aire y luz. Después, comparar con *gradient boosting*, redes recurrentes o modelos de fundación para series temporales (del estilo de Chronos o TimesFM). Métrica útil: agua usada y tiempo fuera del rango óptimo frente a la regla por umbral.

**IA02 · Sensor virtual (*soft sensor*).** Estimar la humedad de una maceta sin sensor a partir de las que sí lo tienen, del clima interior y del historial de riegos. Abarata el hardware y es un buen ejercicio de regresión con validación honesta.

**IA03 · Anomalías y diagnóstico** (fase B). Detectar sin reglas escritas a mano:
- Sensor bloqueado (valor constante), con deriva o desconectado.
- "Se ha regado pero la humedad no sube" → bomba atascada, tubo suelto o depósito vacío.
- "La humedad baja demasiado rápido" → fuga o maceta con drenaje excesivo.
- Comportamiento térmico anómalo (ventilador roto).

Técnicas: residuos respecto a un modelo de predicción, *isolation forest*, autoencoders. Encaja con el tono de la app: un aviso amable del tipo "creo que la bomba 2 no está regando".

### 2. Visión por computador

**IA04 · Salud de la planta.** Clasificar a partir de fotos si hay hojas amarillas, manchas, plagas, falta o exceso de agua. Existen datasets públicos de hojas enfermas (p. ej. PlantVillage), pero están hechos en laboratorio: el reto interesante es el **cambio de dominio** a fotos reales del invernadero, con *fine-tuning* y pocos ejemplos propios. Alternativa rápida: un modelo multimodal generalista como primer diagnóstico, y comparar con un modelo propio pequeño.

**IA05 · Crecimiento por timelapse.** Con la cámara siempre en la misma posición, segmentar cada planta (modelos de segmentación generalistas como SAM o una U-Net propia) y medir área foliar, altura y color día a día. Da curvas de crecimiento reales, detecta floración o fruta madura (fresas) y alimenta al gemelo digital.

### 3. Control inteligente

**IA06 · Control predictivo (MPC).** Aprender un modelo del invernadero (cómo responden temperatura y humedad a ventilador, ventana y luz) y optimizar las acciones de las próximas horas con restricciones: mantener el rango ideal, gastar poca energía y hacer poco ruido. Es la opción "seria" de control y muy defendible académicamente.

**IA07 · Aprendizaje por refuerzo *sim-to-real*.** Entrenar un agente en `apps/simulator`, calibrado con datos reales, y transferirlo al invernadero. Comparar con la regla por umbral y con MPC. Lo más interesante es investigar cómo cerrar la brecha entre simulador y realidad (*domain randomization*, ajuste fino con datos reales). Siempre por encima de los límites de seguridad del firmware, que la IA nunca puede saltarse.

**IA08 · Optimización energética.** En España el precio de la electricidad con tarifa regulada varía por horas y se puede consultar por API pública (Red Eléctrica). Planificar las horas de luz de cultivo y la ventilación para cumplir las horas de luz que necesita cada planta al menor coste. Es un problema clásico de programación con restricciones y extrapolable a toda la casa.

### 4. Lenguaje y agentes

**IA09 · Conversar con el invernadero.** Preguntas como "¿cómo ha ido la semana?" o "¿por qué la albahaca estaba mustia el martes?", respondidas con los datos reales del hub (*retrieval* sobre historial, eventos y diario). Encaja con la estética: un campo de texto discreto, respuestas cortas y cálidas.

**IA10 · Agente con herramientas.** Un LLM que puede **actuar**: regar, ajustar umbrales o programar luz, a través de la API del hub expuesta como herramientas (por ejemplo, como servidor MCP, para que Claude u otro asistente pueda usar Vitreo). Temas de investigación:
- Guardarraíles: qué acciones requieren confirmación humana, límites por hora, registro auditable.
- Defensa en profundidad: aunque el agente se equivoque o reciba instrucciones maliciosas, el firmware sigue aplicando sus límites.
- Evaluación: batería de escenarios del simulador para medir si el agente decide bien.

**IA11 · Diario asistido y resumen semanal.** A partir de fotos, notas y datos, generar una entrada de diario o un resumen tranquilo ("esta semana la menta ha crecido un 12 %"). Fácil de hacer y muy visible en la app.

**Voz** (opcional): transcripción local (modelos tipo Whisper) para hablarle desde la cocina.

### 5. Recomendación y personalización

**IA12 · Recomendador.** Sugerir especies según la ubicación, la luz medida y la época del año; ajustar automáticamente los umbrales de cada planta a partir de cómo responde de verdad (aprendizaje de parámetros por maceta), en lugar de usar valores genéricos.

### 6. IA en el dispositivo (*edge*)

**IA13 · TinyML en el ESP32.** Ejecutar un modelo pequeño directamente en el ESP32-S3 (con LiteRT para microcontroladores, antes TensorFlow Lite Micro, o ESP-DL de Espressif): detección de anomalías local, clasificación de sonido de la bomba (¿está bombeando agua o en vacío?) o un modelo de riego que sigue funcionando sin hub. Interesante por las restricciones de memoria, energía y cuantización.

### 7. Generativo y gemelo digital

**IA14 · Crecimiento procedural fiel.** Hoy las etapas de crecimiento del 3D son fijas (shape keys). La idea es generar la geometría de la planta de forma procedural (sistemas L o reglas de crecimiento) **ajustada a las medidas reales** de IA05, para que el gemelo se parezca de verdad a *tu* albahaca. Conecta visión, modelado procedural y la estética del proyecto.

Otras: generación de variaciones de plantas 3D a partir de texto o imagen (la calidad aún exige retoque en Blender), o de paisajes sonoros ambientales.

### 8. Más allá del invernadero

**IA15 · La casa entera.** El mismo patrón (sensores → MQTT → hub → gemelo 3D → IA) se aplica a la casa: confort térmico predictivo, consumo energético, presencia, calidad del aire. Integración natural con Home Assistant, que ya habla MQTT. El invernadero sirve como banco de pruebas pequeño antes de tocar sistemas más delicados.

## Principios para cuando se desarrolle

1. **La IA propone, la seguridad dispone.** Ningún modelo ni agente puede saltarse los límites del firmware.
2. **Local primero.** Datos y modelos en casa siempre que sea posible; la nube, opcional y explícita.
3. **Explicable y en tono Vitreo.** Cada decisión automática se explica en una frase humana ("he regado antes porque mañana hará calor").
4. **Siempre comparado con la línea base.** Toda idea se mide contra la regla simple por umbral. Si no mejora, no entra.
5. **Humano en el bucle** para acciones nuevas o inusuales.
6. **Privacidad de las imágenes.** La cámara solo enfoca las plantas.

## Lo que sí conviene preparar desde ya

Sin desarrollar nada de IA, estas decisiones hacen que en el futuro haya datos útiles. Ninguna complica el proyecto actual:

Estado comprobado el 2026-10-14 (lo que falta, con detalle, en `09-roadmap.md`, fase B):

- [x] **Guardar la telemetría en bruto** (sin promediar) con su marca de tiempo, además de los agregados. Hecho en A4 (D77): 30 días en la base de datos y después en el archivo mensual comprimido, para siempre. Desde A12 (D102), cada línea del archivo lleva también la hora de llegada al hub, y los mensajes inválidos se archivan.
- [x] **Registrar cada acción con su origen**: `user`, `automation`, `safety` o `agent`, y su resultado (ACK, duración real). Hecho en A4 y A6, con el motivo de cada acción automática.
- [x] **Identificadores estables** de planta, zona y sensor que no cambien al renombrar en la app. Las macetas lo tienen (`basil_01`) y, desde A12 (D102), cada maceta guarda qué planta tuvo y desde cuándo (capítulos). Falta su montaje (volumen, sustrato, profundidad del sensor), que se apunta en la fase 3.
- [ ] **Versionar las calibraciones** de los sensores (si cambias la calibración, que el historial siga siendo interpretable). La tierra lleva `cal`; faltan el depósito, la lectura en bruto de cada sensor y el caudal de las bombas (fases 3 y 5).
- [x] **Etiquetas en el diario**: plaga, hoja amarilla, cosecha, trasplante, poda y también **regada a mano**. Son las etiquetas futuras de los modelos. Hecho en A12 (D102).
- [x] **Notas del invernadero** (mantenimiento, fallos de verdad): las etiquetas para evaluar IA03. Hecho en A12 (D102): su diario, con depósito rellenado, mantenimiento, sensor cambiado, fallo y fuga.
- [ ] **Cámara con encuadre fijo** y fotos a la misma hora, si llega el presupuesto C.
- [x] Guardar también el **tiempo exterior** (API pública) junto a la telemetría. Hecho en A10 (AEMET: observaciones y cada previsión tal como se emitió).
- [x] **Exportación** a CSV desde el hub (A4). Parquet, si hace falta, al empezar la fase B.
- [x] Hacer que el **simulador** se pueda calibrar con datos reales: parámetros en un JSON (`SIMULATOR_PARAMS`), no en el código.
- [x] Diseñar la API del hub pensando en que algún día será un **conjunto de herramientas** para un agente: acciones pequeñas, validadas y con límites. El asistente aparcado lo usó así.
- [ ] **Por qué arrancó el dispositivo** y cuánto lleva encendido, para no confundir un reinicio con un fallo (fase 3).
- [ ] **Una segunda copia** de los datos fuera del PC, antes de que empiecen los datos reales.

## Posibles temas de TFM

- *Riego predictivo frente a riego por umbral en un invernadero doméstico: eficiencia hídrica y estrés hídrico* (IA01).
- *Transferencia simulador-realidad de políticas de control climático aprendidas por refuerzo en un gemelo digital de bajo coste* (IA07).
- *Agentes LLM con herramientas para domótica: guardarraíles y evaluación en un gemelo digital* (IA10).
- *Gemelo digital morfológicamente fiel: del timelapse a la geometría procedural de la planta* (IA05 + IA14).
- *Detección de fallos en sistemas de riego mediante modelos de series temporales en el borde* (IA03 + IA13).
