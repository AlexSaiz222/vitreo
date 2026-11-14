# 08 · Plantas

Pendiente de decidir junto con el tamaño. Este documento recoge criterios y candidatas para elegir con cabeza.

## Criterios

1. **Un solo "clima" por invernadero.** Dentro hay la misma temperatura y humedad para todas. Mezclar plantas de ambiente húmedo con plantas mediterráneas de secano hace que alguna sufra.
2. **Que se note el cambio.** Plantas que crecen o reaccionan en días, no en meses: el gemelo digital es más interesante.
3. **Tamaño compatible.** Nada que supere el techo del invernadero en pocas semanas.
4. **Útiles o bonitas.** Mejor si se comen o si son un placer mirarlas.
5. **Lecturas claras.** Macetas individuales con sensor propio, o zonas de 2–3 macetas que comparten sensor y riego.

## Candidatas

### Clima "huerto húmedo" (recomendado para empezar)

| Planta | Por qué | Tamaño | Ciclo |
|---|---|---|---|
| Albahaca | Crece rápido, agradecida, se nota enseguida cuando tiene sed | Media | Semanas |
| Perejil | Constante, aguanta cortes | Pequeña | Semanas |
| Cebollino | Muy compacto, rebrota tras cortar | Pequeña | Semanas |
| Menta | Vigorosa y aromática (siempre en maceta propia) | Media | Semanas |
| Lechuga baby | Hojas bonitas, cosecha continua | Pequeña | 4–6 semanas |
| Microgreens (rábano, guisante, girasol) | Cambios visibles cada día | Bandeja | 7–14 días |
| Fresa compacta | Flores y frutos: el "premio" visual | Media | Meses |
| Guindilla compacta | Muy decorativa, necesita más luz y calor | Media | Meses |

### Clima "mediterráneo seco"

Romero, tomillo, orégano, lavanda enana. Poco riego, mucha luz, poca humedad: el invernadero tendría que ventilar mucho. Menos interesante para el gemelo (casi no hay que regar).

### Clima "tropical / terrario"

Fittonia, helechos pequeños, musgo, peperomia, pilea. Humedad alta constante, poca luz directa. Precioso y muy "cozy", casi sin cosecha. Buena opción si el invernadero es una vitrina en interior con poca luz natural.

## Propuesta (D63): 6 macetas — ya en el modelo y en la app (v16)

Clima húmedo con **6 macetas**, cada una con su sensor:

| Zona / id | Planta | Umbral de riego orientativo |
|---|---|---|
| `basil_01` | Albahaca | Regar por debajo de ~40 % |
| `parsley_01` | Perejil | ~40 % |
| `lettuce_01` | Lechuga baby | ~45 % |
| `strawberry_01` | Fresa compacta | ~35 % |
| `chives_01` | Cebollino | ~40 % |
| `tomato_01` | Tomate cherry **enano** (p. ej. 'Micro Tom') | ~40 % |
| (sin sensor) | Bandeja de microgreens (opcional) | Riego manual, registro en diario |

Notas sobre las dos nuevas:

- **Cebollino**: encaja sin problemas en el clima húmedo; compacto y rebrota tras cortar.
- **Tomate cherry**: tiene que ser una **variedad enana** (≈ 20–30 cm): el caballete provisional está a 56 cm (P02) y una mata normal pasa del metro. Pide **más luz y calor** que la lechuga (la luz de cultivo trabajará más) y algo menos de humedad: con el clima húmedo hay riesgo de hongos, así que conviene ventilar. Es autopolinizante; el ventilador ayuda a polinizar. Mejor en una maceta algo mayor (15–17 cm) que las demás (13 cm).
- **Disposición**: 3 × 2 macetas en la planta de 86 × 52 cm (tres a lo largo, dos a lo ancho).

Los porcentajes dependen de la calibración de cada sensor y del sustrato: se ajustan con la experiencia de las primeras semanas.

## Plantillas por especie (para la app)

Cada especie tendrá una ficha en `packages/shared/src/species/` con: nombre común, nombre científico, umbral de riego, rango de temperatura y humedad cómodos, horas de luz, etapas de crecimiento y el modelo 3D asociado. Así, al añadir una planta, la app propone la automatización adecuada.

## Preguntas para decidir

- ¿Dónde estará físicamente? (junto a una ventana con sol, interior sin luz natural…)
- ¿Prefieres cosechar o contemplar?
- ¿Cuántas macetas caben en el tamaño que elijas?
