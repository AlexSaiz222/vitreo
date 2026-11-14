# 10 · Trabajar con Claude

Cómo aprovechar Claude en cada parte del proyecto sin repetir contexto.

## 1. Un Proyecto en Claude

Crea un **Proyecto** llamado "Vitreo" y sube como conocimiento:

- Todos los archivos de `docs/`, el `README.md` y el `CLAUDE.md`.
- Las imágenes de `referencias/`.

En las instrucciones del proyecto, algo así:

> Eres mi compañero en Vitreo, un invernadero doméstico con gemelo digital 3D. Lee la documentación del proyecto antes de responder. Documentación en español, código en inglés. La estética (blanco, minimalista, ilustración cozy) y la usabilidad son prioritarias. Si una propuesta contradice una decisión registrada en 11-decisiones.md, dímelo.

Usa conversaciones separadas por tema (Blender, firmware, UI…) dentro del mismo proyecto. Cuando se tome una decisión, pide a Claude que actualice el `.md` correspondiente y vuelve a subirlo.

## 2. Claude Code para el repositorio

- Las reglas que Claude Code debe seguir están en `CLAUDE.md` (raíz del repo, se carga solo en cada sesión); no se repiten aquí. Las que no pueden fallar se comprueban con código: ESLint (la escena no importa MQTT), commitlint (commits convencionales) y el hook Stop de `.claude/settings.json` (`pnpm typecheck`).
- Notas personales de la rama o la fase en curso: `CLAUDE.local.md` (ignorado por git).
- Cuando Claude cometa un error repetible, corregir la regla de `CLAUDE.md` (o convertirla en una comprobación), no solo el código.
- Trabaja por tareas pequeñas y verificables ("implementa el store de telemetría con tests", "añade el shader de viento al follaje"). Una rama por funcionalidad.

## 3. Blender

La persona **no aprende Blender** (D54): **Claude modela** directamente en Blender y la persona dirige la estética.

- **Cómo modela Claude**: con la conexión desde la app de Claude (Blender MCP), que le permite crear, modificar y ver la escena, o con scripts `bpy` reproducibles guardados en `assets/blender/scripts/`. Lo repetitivo (perfilería, cristales, macetas) siempre por script.
- **Cómo dirige la persona**: referencias de `referencias/` (ref-03 sobre todo), capturas con comentarios ("las hojas más grandes", "el borde más redondeado") y aprobación de cada pieza en Blender y luego en la app.
- **Ciclo**: referencia → Claude modela → render o captura → comentarios → exportar → `pnpm models` → captura en la app comparando con lo anterior → aprobar. Detalle en [`04-pipeline-3d-blender.md`](04-pipeline-3d-blender.md).
- **Crítica de render**: pedir a Claude que compare el render o la captura con las referencias según `02-direccion-artistica.md` y proponga cambios concretos.

## 4. Diseño e interfaz

- Pide **mockups** de pantallas para opinar antes de programarlas.
- Ciclo de pulido: captura de la app → "critícala según 03-diseno-ui.md: jerarquía, espaciado, contraste, coherencia de tokens" → ajustes.
- Revisión de accesibilidad con la checklist del documento.

## 5. Electrónica y firmware

- Listas de compra ajustadas al presupuesto y a una tienda concreta.
- Esquemas de conexión explicados paso a paso (y revisados con el multímetro antes de enchufar).
- Firmware por módulos: primero un sensor, luego MQTT, luego actuadores, luego seguridad.
- Depuración: pega el log del monitor serie completo.

## 6. Plantas

- Fichas de especie para `packages/shared/src/species/`.
- Diagnóstico con foto: "Mira esta albahaca y estos datos de humedad de la última semana, ¿qué le pasa?".

## Prompts útiles

- *"Lee `docs/05-arquitectura.md` y crea el esqueleto del monorepo de la fase 0. No añadas nada que no esté en el documento; si falta algo, pregúntame."*
- *"Implementa `apps/simulator` según `06-gemelo-digital.md`, con los escenarios forzables."*
- *"Esta es una captura de la fase 1. Compárala con `referencias/ref-02` y dime las 5 cosas que más la alejan del estilo buscado, ordenadas por impacto."*
- *"Actualiza `11-decisiones.md` con lo que hemos decidido en esta conversación."*
- *"Escríbeme una guía paso a paso para hornear la oclusión ambiental de la maceta en Blender, asumiendo que no sé nada."*

## Buenas prácticas

- Una decisión, un sitio: `11-decisiones.md`.
- Si Claude propone algo que choca con la estética o la seguridad, gana el documento (o se actualiza conscientemente).
- Revisar siempre el código de firmware que toca agua y electricidad antes de flashearlo.
