# Semana de prueba: informe (2026-10-22)

La semana de prueba (docs/09, cierre de la fase A, punto 2) corrió en el PC con todas las automatizaciones del hub diario encendidas: riego de las seis plantas, ventilación, luz y noches tranquilas de 22:00 a 08:00 (config rev 3). Empezó el 2026-10-14 a las 22:59:44.

## Lo principal

**Este portátil no es un servidor 24/7.** De ≈ 187 horas, se grabaron **11,3**. El resto se perdió en cinco apagones (abajo): uno por Windows Update y los demás por el PC apagado o sin nadie que volviera a arrancar Docker. Ni se repite en tiempo real ni se alarga:

- la prueba que corre de continuo pasa a la **Raspberry Pi**, en la fase 3;
- la semana se comprueba con una **semana acelerada** del mismo dispositivo simulado: siete días en segundos, con una semilla fija y como test (D104, más abajo).

## Lo que se grabó (11,3 h)

| Desde | Hasta | Horas |
|---|---|---|
| 14 oct 22:59 | 15 oct 04:13 | 5,2 |
| 16 oct 13:42 | 16 oct 17:59 | 4,3 |
| 18 oct 00:53 | 18 oct 01:13 | 0,3 |
| 18 oct 22:48 | 18 oct 23:17 | 0,5 |
| 18 oct 23:23 | 19 oct 00:20 | 0,9 |

- **Riegos**: 4, todos automáticos (ninguno a mano), todos al volver del primer apagón, el 16 entre las 13:42 y las 13:52: lechuga, fresa, tomate y albahaca, de uno en uno. Se habían secado mientras el simulador estaba parado (D100), y el riego los atendió en 10 minutos.
- **Por debajo del umbral**: entre 1,4 y 1,8 h cada planta, casi todo al volver de un apagón. El perejil y el cebollino bajaron el 18 a las 00:53, en plena noche tranquila, así que no tocaba regarlos, y el PC se apagó antes de las 08:00.
- **Ventilación**:
  - el ventilador, por humedad, el 15 a las 03:54;
  - y por calor el 16, de 14:31 a 17:10 (máxima de 28,1 °C).

  La ventana no llegó a abrir (31 °C).
- **Luz**: no hizo falta encenderla (noches, y una tarde de sol). Los cinco "luz apagada" repetidos son de antes de 012dc64 y no cuentan.
- **Avisos enviados**: ninguno.
- Cada vez que volvió, el dispositivo recibió y aplicó de nuevo la configuración: 17 veces, todas la rev 3.

## Incidencias: ≈ 176 h sin datos

| # | Desde | Hasta | Horas | Causa | Qué se hizo |
|---|---|---|---|---|---|
| 1 | 15 oct 04:13 | 16 oct 13:42 | 33,5 | Windows Update reinició el PC. Docker Desktop no arrancó, porque su arranque está apagado. La tarea de inicio de sesión lo esperó y Windows la cortó a los 15 minutos, sin dejar aviso | `fix/boot-docker`: la tarea arranca Docker Desktop, tiene un límite de tiempo y avisa con una notificación |
| 2 | 16 oct 17:59 | 18 oct 00:53 | 30,9 | PC apagado (Inicio › Apagar) | Nada que arreglar en el software |
| 3 | 18 oct 01:13 | 18 oct 22:48 | 21,6 | PC apagado | Ídem |
| 4 | 18 oct 23:17 | 18 oct 23:23 | 0,1 | PC apagado y vuelto a encender | Ídem |
| 5 | 19 oct 00:20 | 22 oct 18:07 | 89,8 | PC apagado. Al iniciar sesión el 19 a las 08:34, la tarea se abrió en una ventana de Windows Terminal; al cerrarse la ventana, la tarea terminó (`0xC000013A`) sin escribir nada, y nada volvió a comprobarlo en 3,4 días | `fix/repair-every-30-min`: sin ventana y cada 30 minutos, más la última comprobación en `pnpm status` |

Después de cada apagón, el simulador siguió donde estaba: la tierra seca lo que tocaba y ningún riego mientras tanto (D100).

## La semana acelerada (D104)

`acceleratedWeek()` en `packages/sim-core/src/week.ts` simula siete días en ≈ 5 s, con el mismo dispositivo, los mismos límites de seguridad y la misma automatización que el simulador diario:

- del lunes 19 al lunes 26 de octubre de 2026 en Madrid, que cruza el cambio a la hora de invierno del día 25;
- semilla 2026;
- las reglas de la semana de prueba (rev 3);
- fuera, siete días **plausibles, no observados**, de finales de octubre en Madrid (`MADRID_LATE_OCTOBER`): máximas de 13 a 19 °C, mínimas de 6 a 11 °C, un frente nuboso el día 4 y una mañana fría y despejada después.

`week.test.ts` comprueba las reglas en cada riego y guarda la semana como *snapshot*; `pnpm sim:week` imprime estos números.

| Planta | Umbral | Bajo el umbral | Mínimo | Riegos automáticos | Por día (lun → dom) |
|---|---|---|---|---|---|
| Albahaca | 40 % | 1,5 h | 39 % | 2 (10 s) | 0 0 1 0 0 1 0 |
| Perejil | 40 % | 0 h | 39 % | 1 (5 s) | 0 0 0 0 1 0 0 |
| Lechuga | 45 % | 0 h | 44 % | 3 (18 s) | 1 0 0 1 0 0 1 |
| Fresa | 35 % | 2,6 h | 34 % | 2 (10 s) | 0 1 0 0 0 1 0 |
| Cebollino | 40 % | 0 h | 39 % | 1 (4 s) | 0 0 0 0 1 0 0 |
| Tomate cherry | 40 % | 0 h | 39 % | 2 (16 s) | 0 1 0 0 0 1 0 |

Aire de 4,9 a 24,3 °C, con humedad de hasta el 98,8 %. Depósito del 80 % al 55 %. Ventilador 95 h, ventana 0 h y luz 27,8 h. Una protección contra la helada. Lo que se cumple:

- ningún riego en noches tranquilas;
- ninguno por encima del máximo diario ni dentro de la espera de 60 minutos;
- uno cada vez, con los segundos de su regla;
- el cambio de hora sin efectos.

Las plantas que bajan de noche esperan a las 08:00: por eso la fresa pasa 2,6 h por debajo, como está pensado.

### Lo que revela

1. **La luz de cultivo parpadea**: se enciende y apaga entre 280 y 780 veces al día. La regla mira los lux del sensor, y el sensor ve también la luz de cultivo (4000 lux):
   - encendida, lee la luz del día más 4000, pasa de 3000 × 1,5 y se apaga;
   - apagada, vuelve a quedar por debajo de 3000 y se enciende.

   Ocurre cada 10 s mientras la luz del día está entre ≈ 500 y 3000 lux: amaneceres, atardeceres y días nublados. En las 11 h reales apenas se vio, porque fueron sobre todo de noche. **No es solo del simulador**: el sensor del invernadero de verdad también verá la lámpara, y un relé así se gasta.

   **Propuesta**, para decidir:
   - al encender, el dispositivo mide cuánta luz añade la lámpara (los lux justo antes y justo después);
   - mientras está encendida, compara con la regla los lux menos esa diferencia.

   No necesita ajustes nuevos y vale igual en el firmware.
2. **Por humedad, el ventilador va toda la noche cuando hace frío**: de ≈ 22:00–01:30 a ≈ 10:30–11:40 cada día (el aire frío pasa de `maxRh` 85 %). En el modelo el ventilador enfría 2 °C siempre. La noche del 23 al 24 el aire bajó a 5 °C, y la protección contra la helada lo paró de 02:23 a 07:11.

   Parte es del modelo, porque el enfriamiento del ventilador debería depender de la diferencia con fuera. Parte es de la regla: ventilar por humedad una noche fría enfría más el invernadero.

   **Propuesta**, para decidir: el ventilador por humedad solo por encima de una temperatura (por ejemplo, 10 °C), y en el modelo un enfriamiento proporcional a dentro − fuera.

## Después de los arreglos (D105, aprobados el 2026-10-22)

Se aprobaron las dos propuestas, con un tope duro para la luz. Por eso los números de la tabla de arriba son de **antes**.

- **Luz**:
  - descuenta su propia lámpara, medida al encenderla;
  - tiene el margen de 1,5 ×;
  - entre dos cambios automáticos pasan al menos 15 minutos.

  Pasa de **2778 cambios a 28: 4 al día, todos los días** (07:00 encender, ≈ 10:35 apagar con el día, al atardecer encender, 21:00 apagar). Horas de luz: 34, antes 27,8.
- **Ventilador por humedad**: solo con el aire a 10 °C o más (para por debajo de 9 °C). Además, en el modelo el ventilador quita un 40 % de lo que el invernadero está por encima de fuera, en vez de 2 °C fijos. Horas de ventilador: 84,3, antes 95.

  La noche más fría:

  | Noche | Antes | Después |
  |---|---|---|
  | 18→19 | 7,9 °C | 9,9 °C |
  | 19→20 | 8,9 °C | 10,9 °C |
  | 20→21 | 8,9 °C | 10,9 °C |
  | 21→22 | 7,9 °C | 9,9 °C |
  | 22→23 | 4,9 °C | 6,9 °C |
  | 23→24 | 4,9 °C | **5,9 °C** |
  | 24→25 | 6,9 °C | 8,9 °C |

  Antes saltó la protección contra la helada una vez (la noche del 23 al 24). Después, ninguna.
- **Lo demás**:
  - mismas reglas de riego, sin riegos en noches tranquilas;
  - 12 riegos automáticos;
  - depósito del 80 % al 53 %.

  Con solo estos dos arreglos, la albahaca pasaba 9 h por debajo del umbral (antes 1,5 h): la noche del 20 cruzaba a las 22:13, justo después de empezar la noche tranquila, y esperaba a las 08:00. Por eso se añadió el riego de tarde (abajo).

## El riego de tarde (D106, aprobado el 2026-10-22)

En la media hora antes de las noches tranquilas (21:30–22:00), se riega la planta que esté a menos de 5 puntos por encima de su umbral y que, al ritmo al que seca, cruzaría antes de las 08:00. Mismos límites de siempre.

Horas por debajo del umbral **durante las noches tranquilas**, la misma semana sin y con la regla:

| Planta | Sin | Con | Riegos de tarde |
|---|---|---|---|
| Albahaca | **9 h** | **0 h** | 2 |
| Perejil | 0 h | 0 h | 1 |
| Lechuga | 0,4 h | 0 h | 1 |
| Fresa | 1,6 h | 0 h | 2 |
| Cebollino | 0 h | 0 h | 0 |
| Tomate cherry | 0 h | 0 h | 0 |

- Ninguna planta pasa ya tiempo por debajo del umbral en toda la semana, tampoco de día.
- Los 6 riegos de tarde, todos a las 21:30, con la tierra como mucho un punto por encima de su umbral: "Riego de tarde · 41 %, cerca del 40 %".
- Sobre todo adelantan riegos que habrían sido a las 08:00: 13 riegos automáticos en la semana (antes 12), y el depósito acaba en el 51 % (antes 53 %).

`week.test.ts` exige ahora:
- como mucho 6 cambios de luz al día;
- ningún ventilador por humedad con el aire frío;
- de noche, menos tiempo por debajo del umbral para cada planta que pasaba alguno, y ninguno para las demás, frente a la misma semana sin el riego de tarde.

Su *snapshot* cambió a propósito con estos números.
