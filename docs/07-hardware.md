# 07 · Hardware

Todo pensado para un **invernadero pequeño de casa**, componentes asequibles y fáciles de encontrar. El tamaño final y las plantas se decidirán más adelante ([`08-plantas.md`](08-plantas.md)); por eso hay tres niveles.

> **Precios orientativos** (euros, 2026). Varían mucho entre AliExpress (más barato, 2–4 semanas), Amazon (rápido, más caro) y tiendas maker. Comprobar antes de comprar.

## Componentes y su función

| Función | Componente recomendado | Notas |
|---|---|---|
| Cerebro | **ESP32** (DevKit clásico o ESP32-S3) | Wifi integrado, barato, enorme comunidad |
| Temperatura y humedad del aire | **SHT31** (o SHT45) | Mucho más fiable que DHT22 |
| Humedad de tierra | **Sensor capacitivo** (uno por maceta o zona) | Nunca los resistivos (se corroen) |
| Luz | **BH1750** (o VEML7700) | I²C, mide lux |
| Nivel del depósito | Interruptor de flotador | Simple y fiable |
| Riego | Minibomba 5 V o **bomba peristáltica 12 V** | La peristáltica dosifica con precisión y no gotea |
| Luz de cultivo | Tira o barra LED de espectro completo | 5 V (USB) o 12 V |
| Ventilación | Ventilador 12 V de 60–80 mm | Mejor silencioso |
| Ventana | Microservo MG90S | Abre una trampilla |
| Conmutación | Módulo **MOSFET de nivel lógico** (tipo D4184/AOD4184) | Evitar IRF520: no conmuta bien con 3,3 V |
| Alimentación | Fuente 12 V + reductor a 5 V | Una sola fuente para todo |

## Tres presupuestos (solo electrónica)

### A · Esencial — ≈ 45–80 €

Para aprender y tener el gemelo funcionando con lo básico.

| Pieza | Cant. | Precio aprox. |
|---|---|---|
| ESP32 DevKit | 1 | 6–10 € |
| SHT31 | 1 | 3–8 € |
| Sensor de tierra capacitivo | 2 | 4–8 € |
| BH1750 | 1 | 2–4 € |
| Minibomba sumergible 5 V + tubo de silicona | 1 | 4–8 € |
| Módulo MOSFET de nivel lógico | 2 | 3–6 € |
| Tira LED de cultivo 5 V (USB) | 1 | 8–15 € |
| Fuente 5 V 3 A | 1 | 6–10 € |
| Protoboard, cables Dupont, diodos | — | 8–10 € |

Monitoriza aire, luz y 2 macetas; riega 1 zona; controla la luz.

### B · Recomendado — ≈ 100–200 €

El punto dulce: todas las funciones de la visión, bien hecho.

| Pieza | Cant. | Precio aprox. |
|---|---|---|
| ESP32-S3 DevKit | 1 | 8–12 € |
| SHT45 o SHT31 con carcasa | 1 | 6–15 € |
| Sensor de tierra capacitivo (de calidad) | 4 | 12–35 € |
| BH1750 o VEML7700 | 1 | 3–8 € |
| Interruptor de flotador | 1 | 2–5 € |
| Bomba peristáltica 12 V | 2 | 16–30 € |
| Módulo MOSFET 4 canales, nivel lógico | 1 | 4–8 € |
| Barra LED de cultivo 12 V espectro completo | 1 | 15–30 € |
| Ventilador 12 V 60–80 mm | 1 | 4–15 € |
| Microservo MG90S | 1 | 3–5 € |
| Fuente 12 V 3 A + reductor a 5 V | 1 | 12–18 € |
| Caja estanca, bornas, placa perforada, cables | — | 12–20 € |

Monitoriza aire, luz, 4 macetas y depósito; riega 2 zonas; luz, ventilador y ventana.

#### Con 6 macetas (D63)

La propuesta de plantas pasa a 6 macetas con sensor propio. Sobre B cambia:

| Pieza | Cant. | Precio aprox. | Notas |
|---|---|---|---|
| Sensor de tierra capacitivo (de calidad) | 6 (+2) | 18–50 € | Uno por maceta |
| Bomba peristáltica 12 V | 6 (+4) | 48–90 € | Una por maceta: riego individual y preciso, sin válvulas |
| Módulo MOSFET 4 canales, nivel lógico | 2 (+1) | 8–16 € | 6 bombas + luz + ventilador = 8 canales |

Total orientativo: **≈ 150–290 €**. Alternativa más barata: 1 bomba y 6 microválvulas 12 V normalmente cerradas (mismo número de canales MOSFET, más tubos y uniones). Regla en firmware: **una bomba cada vez** (la fuente de 3 A no da para varias) y los límites de seguridad de siempre **por bomba** (tiempo máximo, depósito vacío, estado seguro al arrancar o perder conexión).

### C · Completo — ≈ 300–500 € (B + extras)

El nivel B más extras para experimentar. Los extras son independientes: se pueden añadir de uno en uno. La Raspberry Pi sola ya supone un tercio del coste.

| Pieza extra | Precio aprox. |
|---|---|
| Sensor de CO₂ SCD41 | 30–50 € |
| Cámara para timelapse (XIAO ESP32S3 Sense o ESP32-CAM) | 10–25 € |
| Panel LED de cultivo de calidad | 40–80 € |
| Minihumidificador ultrasónico | 8–15 € |
| Enchufe inteligente certificado (para manta térmica u otros aparatos a 230 V) | 12–25 € |
| Manta térmica de germinación | 15–25 € |
| Sonda de temperatura DS18B20 (tierra o agua) | 2–4 € |
| Raspberry Pi 5 (4 GB) + fuente + tarjeta, para el hub 24/7 | 80–110 € |
| Sensor de consumo INA219 | 3–5 € |

### Estructura del invernadero (aparte)

| Opción | Precio aprox. | Encaje con la estética |
|---|---|---|
| Caja propagadora con tapa transparente | 15–30 € | Baja, pero perfecta para empezar |
| Mini invernadero de cristal de sobremesa | 40–100 € | Alta, muy parecida a las referencias |
| Vitrina de cristal adaptada (el conocido "IKEA greenhouse cabinet") | 100–250 € | Muy alta, espacio para 8–15 plantas |

**Recomendación**: empezar con **B + mini invernadero de cristal** si el presupuesto lo permite; si no, **A + caja propagadora**, y todo el código servirá igual después.

## Asignación de pines (ESP32 DevKit clásico, orientativa)

| Señal | GPIO | Notas |
|---|---|---|
| I²C SDA / SCL (SHT31, BH1750, SCD41) | 21 / 22 | Bus compartido |
| Tierra 1–6 (analógico) | 32, 33, 34, 35, 36, 39 | **Solo pines ADC1**: ADC2 no funciona con wifi activo. Con 6 macetas se usan los 6 que hay (36 y 39 son solo entrada, válidos para analógico) |
| Bomba 1–6 | 25, 26, 16, 17, 18, 19 | Vía MOSFET (con 4 macetas, solo 25 y 26) |
| Luz de cultivo | 27 | Vía MOSFET (PWM para regular) |
| Ventilador | 14 | Vía MOSFET |
| Servo ventana | 13 | Alimentar el servo desde 5 V, no desde el ESP32 |
| Flotador depósito | 4 | Con *pull-up* interno |

En ESP32-S3 los números cambian; la asignación vive en `firmware/include/pins.h`.

## Esquema de alimentación

```
Red 230 V ──▶ Fuente 12 V 3 A ──┬──▶ Bombas, ventilador, LED (a través de MOSFET)
                                └──▶ Reductor 12→5 V ──┬──▶ ESP32 (pin 5V/VIN)
                                                       └──▶ Servo
Todas las masas (GND) unidas.
```

## Seguridad

- **Agua abajo, electrónica arriba** (o fuera del invernadero), en caja cerrada.
- **Nada de cablear 230 V a mano.** Cualquier aparato de red (manta térmica, humidificador grande) se controla con un **enchufe inteligente certificado**.
- **Diodo** en paralelo con cada motor o bomba si el módulo MOSFET no lo incluye.
- **Fusible** a la salida de la fuente de 12 V.
- Sellar el borde electrónico de los sensores capacitivos (esmalte de uñas transparente o resina) y no enterrarlos más allá de la línea marcada.
- Los sensores capacitivos baratos a veces salen defectuosos: comprar a vendedores con buenas valoraciones o de marca (p. ej. DFRobot SEN0193) y **probar cada uno** antes de montarlo.
- Límites de riego y temperatura en el firmware (ver [`05-arquitectura.md`](05-arquitectura.md)).

## Firmware

- PlatformIO + framework Arduino, en `firmware/`.
- Librerías: `PubSubClient` o `AsyncMqttClient`, `ArduinoJson`, `Adafruit_SHT31`, `BH1750`, `ESP32Servo`.
- Wifi y credenciales MQTT por archivo de configuración no versionado (o portal de configuración con WiFiManager).
- Calibración de cada sensor de tierra (valor en seco / en agua) guardada en memoria no volátil.
- Actualizaciones por wifi (OTA) desde la fase 3.
- Alternativa: **ESPHome** (configuración en YAML, muy robusto). Válido si se prefiere rapidez; el contrato MQTT debe mantenerse igual.

## Herramientas que conviene tener

Soldador básico con estaño, multímetro, pelacables, tubo termorretráctil, bridas, pistola de silicona caliente. Presupuesto aproximado si no tienes nada: 30–50 €.
