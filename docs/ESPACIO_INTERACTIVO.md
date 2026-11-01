# Espacio interactivo del portfolio

## Estado y alcance

La sala 3D es la experiencia principal y completa del portfolio: `index.html` la carga directamente al entrar. Se han retirado la portada, la antigua sala CSS y sus menús. `espacio.html` solo redirige a la raíz para conservar enlaces antiguos. Los controles mantienen DM Sans local y la paleta crema/oliva.

El encuadre inicial procede de la cámara activa de referencia del archivo Blender: frontal, centrado, con archivadores al fondo, techo luminoso y moqueta verde. Sus metadatos de posición, orientación, campo de visión y relación de aspecto están exportados en `assets/models/room.json`.

Solo el cajón `CAJON_C07_F06`, señalado como «Proyectos 023», es interactivo. Los demás cajones se renderizan, pero no se abren ni contienen navegación. El cajón interactivo ofrece las seis fichas de ejemplo que ya existen en `scripts/projects.js`, pendientes de trabajos reales.

## Arranque y uso

Desde la raíz del repositorio:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abre la raíz del servidor: la sala aparece directamente, sin pasar por un menú. Los módulos requieren HTTP; no abras el archivo con `file://`. Ctrl+C detiene el servidor.

- Arrastra sobre la sala para orientar la mirada. No se activa captura del ratón ni pantalla completa automáticamente.
- Enfoca el lienzo mediante clic o Tab y usa WASD o las flechas para caminar. La cruceta visible permite avanzar, retroceder y desplazarse lateralmente. Una pulsación en el suelo lleva a ese punto dentro de los límites de navegación. La rueda o la pinza táctil permiten avanzar y retroceder.
- Pulsa el marcador «Proyectos 023», el propio cajón seleccionado en 3D o «Ir a proyectos» para acercarte. El arrastre se distingue de la pulsación.
- Pulsa «Abrir cajón». Las seis carpetas físicas y la lista HTML abren las mismas fichas; la lista permite acceder por teclado. «Siguiente carpeta» recorre los proyectos.
- Cierra la ficha con su botón o Escape. «Volver a explorar», el cierre del panel o Escape sin ficha abierta recuperan la posición anterior al acercamiento. «Vista inicial» vuelve al encuadre de referencia y cierra el cajón. Las fichas y todos los controles pertenecen a esta misma sala; no hay otro portfolio al que volver.

El desplazamiento se limita a un rectángulo de suelo libre delante de los archivadores; no es un sistema general de colisiones. La preferencia `prefers-reduced-motion` elimina los vuelos de cámara y la animación de apertura. Si WebGL no arranca o se interrumpe, aparece la imagen estática y las seis fichas nativas dentro de la misma página, junto a «Reintentar». Sin JavaScript, esas mismas fichas se pueden leer y desplegar. El contenido se sincroniza desde `scripts/projects.js` mediante `node tools/update_project_fallback.mjs`.

## Recursos y exportación reproducible

`assets/models/room.glb` ocupa 973.172 bytes. La exportación web elimina animaciones y drivers del origen, propiedades personalizadas, rutas de origen, cámaras y luces del GLB. La cámara de referencia se guarda por separado en JSON. La apertura del único cajón y las carpetas se controlan en el navegador; no se reproducen las animaciones originales de Blender.

El `.blend` permanece fuera del repositorio; `.gitignore` excluye los archivos Blender y sus copias habituales. Con Blender 4.3.2 y una copia privada del archivo fuente, ejecuta desde la raíz del repositorio, sustituyendo ambas rutas por las de tu equipo:

```sh
blender --background --factory-startup --disable-autoexec /ruta/privada/sala.blend \
  --python tools/export_room.py -- /ruta/al/repositorio/EFEDEGAM
```

`tools/export_room.py` escribe `assets/models/room.glb` y `assets/models/room.json`, sin guardar ni modificar el `.blend` de entrada. Requiere la cámara activa de referencia y los nombres de cajones esperados. No genera la imagen alternativa.

La imagen `assets/scene-preview/room.jpg` se renderizó por separado en Blender 4.3.2, con Cycles CPU, 64 muestras y 1280 × 720. Su procedencia y SHA-256 están en `assets/scene-preview/SOURCE.json`. Es una imagen de respaldo, no una captura del renderizador interactivo.

Three.js 0.180.0 está incluido en `vendor/three/` con licencia MIT, procedencia e integridad en `SOURCE.json`. Se preparó con scripts de instalación desactivados; la auditoría no indicó avisos conocidos en ese momento. Eso no garantiza seguridad. La ejecución de la web no requiere instalar paquetes, CDN, claves ni servicios de rastreo.

## Validación y límites

Las pruebas requieren Python, Playwright para Python y Chromium, igual que las comprobaciones del portfolio descritas en [README.md](../README.md). Inician y cierran su propio servidor local:

```sh
python3 tests/check_site.py
python3 tests/check_space.py
```

La suite 3D comprueba el encuadre exportado, recursos locales, agrupación de cajones repetidos, movimiento y límites, arrastre sin selección accidental, apertura y seis fichas, controles táctiles, alternativa sin WebGL, finalización de transiciones y cese del renderizado en reposo. Usa WebGL por software; no demuestra rendimiento en teléfonos reales. Las comprobaciones automatizadas tampoco sustituyen una revisión visual y de uso en dispositivos físicos.

La iluminación y los materiales del navegador son una aproximación al aspecto de Blender. La imagen de respaldo usa otro renderizador y puede diferir. Quedan fuera de esta entrega la interacción con todos los cajones, las animaciones originales y la sustitución de las fichas de ejemplo. Ampliar la interacción al resto de cajones es trabajo futuro; la sala 3D ya es la entrada principal.

## Referencia y privacidad

La referencia de interacción elegida por el propietario fue https://3dhouse.schumacher.com/. Se consultó el 1 de noviembre de 2026: se observaron instrucciones de arrastre, zoom y selección, pero la escena permaneció cargando y no se verificaron todas sus interacciones. Esta referencia específica no sustituye las bibliotecas de confianza de [REFERENCIAS.md](../REFERENCIAS.md), ni autoriza copiar código o recursos.

Antes de compartir, revisa los archivos exportados y sus metadatos para detectar datos personales o secretos; las exclusiones de Git no sustituyen esa revisión. La preparación local no autoriza enviar a GitHub ni publicar. Cualquier publicación necesita autorización explícita del propietario.
