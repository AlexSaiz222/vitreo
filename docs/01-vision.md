# 01 · Visión

## La idea en una frase

Un invernadero real, pequeño y doméstico, con un **gemelo digital en 3D** que parece una ilustración viva: lo miras para saber cómo están tus plantas, y lo tocas para cuidarlas.

## Qué debe sentir quien lo usa

- **Calma.** Abrir la app tiene que ser como asomarse a una ventana con plantas. Nada de dashboards industriales, ni alarmas rojas, ni gráficos por todas partes.
- **Cariño.** Las plantas se perciben como seres que cuidas, no como sensores numerados.
- **Claridad.** En menos de dos segundos sabes si todo va bien. En dos toques, riegas.
- **Asombro discreto.** Pequeños detalles que se descubren con el tiempo: la luz cambia con la hora real, los cristales se empañan, suena el agua al regar.

## Qué es (alcance)

- Una **escena 3D** del invernadero, vista isométrica tipo diorama, con cámara libre pero suave.
- **Estado en vivo**: temperatura, humedad del aire, luz, humedad de la tierra por maceta, nivel del depósito, estado de actuadores y conexión.
- **Control**: regar (por zona), luz de cultivo, ventilación, abrir/cerrar ventana.
- **Automatizaciones** sencillas: riego por umbral, horario de luz, ventilación por temperatura/humedad.
- **Memoria**: historial, poder "rebobinar" el invernadero a un momento pasado, diario de cada planta, timelapse.
- **Atmósfera**: modo día/noche sincronizado con la hora real y sonido ambiente opcional.
- **Plataforma**: web instalable (PWA) que funciona en móvil y ordenador.

## Qué NO es (por ahora)

- No es un producto comercial ni multiusuario. Es un **proyecto personal**, pero construido con mimo de producto.
- No es un simulador botánico realista. El 3D **representa** el estado, no lo calcula.
- No es accesible desde fuera de casa en la primera versión (queda preparado para después).
- No es un videojuego: la interacción es contemplativa y útil, sin puntuaciones ni gamificación agresiva.

## Principios rectores

1. **Menos, pero mejor.** Cada elemento en pantalla tiene que ganarse su sitio. Si dudas, quítalo.
2. **El 3D es la interfaz principal.** Los datos se leen primero en la escena (tierra más oscura, hoja caída, cristal empañado) y después, si quieres, en números.
3. **Blanco como lienzo.** El fondo es papel; el invernadero, la obra.
4. **Lento y suave.** Transiciones pausadas, sin saltos. Nada parpadea.
5. **Honesto.** Si el invernadero real está desconectado, el digital lo muestra con elegancia (se "adormece"), nunca inventa datos.
6. **Seguro por diseño.** El riego tiene límites en el propio hardware. Un fallo de red nunca puede inundar ni cocer las plantas.
7. **Hecho para durar.** Código limpio, documentado y modular, para poder crecer sin rehacerlo.

## Criterio de éxito personal

- Abrir la app se convierte en un pequeño ritual agradable.
- Las plantas están mejor cuidadas que sin ella.
- Te apetece enseñárselo a alguien.
