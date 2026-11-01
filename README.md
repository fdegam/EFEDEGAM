# EFEDEGAM · Archivo personal

Portfolio estático en español: una sala en perspectiva con archivadores, seis fichas de proyectos de ejemplo y objetos interactivos. Mantiene navegación por teclado, acceso táctil y una variante con movimiento reducido. Los textos, fichas y contacto siguen siendo provisionales.

## Desarrollo local

La biblioteca de inspiración del proyecto está en [REFERENCIAS.md](REFERENCIAS.md): mkdir.directory y Awwwards son las fuentes de confianza elegidas por el propietario.

No requiere instalar paquetes, compilar ni configurar claves. Desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abre el puerto 8000 en tu navegador local. Usa un servidor HTTP: los módulos JavaScript no se cargan directamente desde `file://`. Para detenerlo, pulsa Ctrl+C.

## Estructura

| Archivo                     | Responsabilidad                                               |
| --------------------------- | ------------------------------------------------------------- |
| `index.html`                | Estructura, navegación, sala y ficha de proyecto              |
| `styles.css`                | Estilos consolidados, estados y adaptación a pantallas        |
| `scripts/app.js`            | Archivadores, carpetas y coordinación de vistas               |
| `scripts/drawers.js`        | Construcción del HTML de los cajones y sus objetos            |
| `scripts/projects.js`       | Contenido editable de las seis fichas                         |
| `scripts/dom.js`            | Consultas DOM y preferencias de movimiento/puntero            |
| `scripts/plant.js`          | Rasterizado de la planta y ciclo de animación                 |
| `scripts/room.js`           | Presentación, salto y llegada al archivo                      |
| `scripts/lens.js`           | Lupa de escritorio y copia visual sin IDs duplicados          |
| `scripts/project-dialog.js` | Fichas, recorrido de proyectos y foco del teclado             |
| `assets/`                   | Imágenes activas y fuentes locales con sus licencias          |
| `tests/check_site.py`       | Pruebas funcionales de navegador                              |
| `.agents/skills/`           | Instrucciones de desarrollo revisadas; no se cargan en la web |

La cascada de `styles.css` conserva el orden de las reglas condicionales. Antes de mover una regla, comprueba sus estados y puntos de adaptación. Las versiones anteriores del diseño permanecen en el historial de Git; no se cargan hojas de estilos de experimentos antiguos.

## Comprobaciones

Las pruebas requieren Python, Playwright para Python y Chromium. Están disponibles en el entorno de desarrollo preparado; no son dependencias de la web. En otro equipo, prepara esas herramientas por separado, sin incorporarlas a los archivos públicos.

```sh
python3 tests/check_site.py
```

El programa inicia su propio servidor en un puerto local libre y lo cierra al terminar. Comprueba recursos, ausencia de peticiones externas, navegación e historial, las seis fichas, foco y Escape, objetos, móvil, presentación y lupa. Un navegador de escritorio con tamaño móvil no sustituye una prueba en un teléfono real.

## Privacidad y publicación

La web sirve las tipografías desde `assets/fonts/`: no necesita contactar con Google Fonts ni usar claves o servicios externos. Los archivos `SOURCES.json` y las licencias documentan su procedencia. Las skills tampoco necesitan ejecutarse ni instalar bibliotecas para que funcione la web.

No guardes datos personales, credenciales o secretos en el código, las imágenes, las capturas o el historial. `.gitignore` evita añadir algunos archivos habituales por accidente; no sustituye la revisión de seguridad. Revisa los cambios y posibles automatizaciones antes de publicar, y solicita autorización explícita al propietario. Publicar `main` puede activar GitHub Pages si así está configurado: un envío a GitHub también debe revisarse.

La web sigue siendo compatible con alojamiento estático como GitHub Pages. No hay despliegue automático añadido por esta reorganización.
