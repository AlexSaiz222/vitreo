# Vitreo

> *Del latín* vitreus, *"de cristal". Ver la decisión en [`docs/11-decisiones.md`](docs/11-decisiones.md#nombre).*

Un invernadero pequeño de casa y su **gemelo digital**: una pieza 3D en estilo ilustración, minimalista, blanca y tranquila, que se puede mirar, girar y tocar desde el móvil o el ordenador. Lo que pasa en el invernadero real se ve en el digital, y lo que haces en el digital (regar, encender la luz, ventilar) pasa en el real.

**[▶ Probar la demo](https://vitreo-demo.vercel.app)** · **[📖 Leer el cuaderno "Cómo se hizo"](https://vitreo-demo.vercel.app/cuaderno)**

> Este repositorio es una copia de `main` en un solo commit; el historial completo se mantiene privado.
>
> Código publicado para consulta. Todos los derechos reservados.

---

## Cómo usar esta carpeta

Esta carpeta es el **contexto del proyecto**. Sirve para ti y para Claude:

- **Tú** la lees para recordar qué se decidió y por qué.
- **Claude** la lee para no tener que explicarle todo de nuevo en cada conversación (ver [`docs/10-trabajar-con-claude.md`](docs/10-trabajar-con-claude.md)).
- **`CLAUDE.md`** es el resumen compacto que Claude Code carga automáticamente cuando trabaja en el repositorio.

Cuando se tome una decisión nueva, se apunta en [`docs/11-decisiones.md`](docs/11-decisiones.md) y se actualiza el documento afectado.

## Índice

| # | Documento | De qué trata |
|---|---|---|
| 01 | [Visión](docs/01-vision.md) | Qué es, para qué, principios y límites |
| 02 | [Dirección artística](docs/02-direccion-artistica.md) | Estética 3D, paleta, luz, día/noche, sonido |
| 03 | [Diseño de interfaz](docs/03-diseno-ui.md) | Sistema de diseño, pantallas, interacción, usabilidad |
| 04 | [Pipeline 3D con Blender](docs/04-pipeline-3d-blender.md) | Cómo modela Claude en Blender y cómo llegan los modelos a la web |
| 05 | [Arquitectura técnica](docs/05-arquitectura.md) | Stack, repositorio, flujo de datos, contrato MQTT |
| 06 | [Gemelo digital](docs/06-gemelo-digital.md) | Cómo los datos reales se traducen a lo visual, automatizaciones |
| 07 | [Hardware](docs/07-hardware.md) | Sensores, actuadores, 3 presupuestos, conexiones, seguridad |
| 08 | [Plantas](docs/08-plantas.md) | Qué cultivar y cómo encaja con el tamaño y los sensores |
| 09 | [Hoja de ruta](docs/09-roadmap.md) | Fases, entregables y criterios de "hecho" |
| 10 | [Trabajar con Claude](docs/10-trabajar-con-claude.md) | Proyectos, Claude Code, Blender, prompts útiles |
| 11 | [Decisiones](docs/11-decisiones.md) | Registro de decisiones y preguntas abiertas |
| 12 | [Ideas de IA](docs/12-ideas-ia.md) | Banco de ideas de IA para el futuro (no se desarrolla por ahora) |

`referencias/` (imágenes de inspiración y capturas de progreso) no se incluye en esta copia pública.

## Resumen en cinco líneas

1. **Estética primero**: blanco, aire, el invernadero como obra flotando; la interfaz casi desaparece.
2. **3D híbrido**: modelos en Blender con luz horneada → glTF → web con React Three Fiber, donde el código añade vida y datos.
3. **App única**: web instalable (PWA) para móvil y PC, en TypeScript + React.
4. **Local primero**: ESP32 → MQTT (Mosquitto) → pequeño *hub* en casa → app. La nube, más adelante.
5. **El invernadero nunca depende de la app para sobrevivir**: la seguridad del riego y la temperatura vive en el firmware.

## Idioma

- Documentación: **español**.
- Código, nombres de archivos de código, variables y commits: **inglés**.
