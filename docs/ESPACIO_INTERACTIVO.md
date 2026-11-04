# Espacio interactivo del portfolio

## Estado y alcance

La sala 3D es la experiencia principal y completa del portfolio: `index.html` la carga directamente al entrar. `espacio.html` solo redirige a la raíz para conservar enlaces antiguos. Los controles mantienen DM Sans local y la paleta crema/oliva.

La sala procede de `Espacio_Portfolio.blend` (Blender 4.3): habitación de 6,8 × 7,7 m, techo reticular de 36 paneles luminosos, moqueta verde aterciopelada y una pared de **156 cajones (13 columnas × 12 filas)**, cada uno con frente de 18 mm y cuerpo completo. El encuadre de referencia es la cámara activa `CAM_01_Referencia` del archivo.

## Fidelidad visual: la luz es la de Cycles

La iluminación no se imita con focos genéricos de Three.js. Se calcula en Blender con Cycles y se «hornea» en texturas:

- `assets/models/lightmaps/room.webp` y `archive.webp`: luz difusa directa e indirecta (rebotes incluidos) de las 4 luces de área y los 36 paneles emisivos. Cada uno de los 156 frentes tiene su celda propia en el atlas del archivo.
- `assets/models/lightmaps/env.webp`: panorámica de 360° de la sala, renderizada con Cycles desde su centro. Se usa **solo** para brillos y para el terciopelo de la moqueta, que dependen del ángulo de visión. Su aportación difusa se elimina en el shader para no contar la luz dos veces.
- El navegador usa la misma transformación de color que el archivo (AgX) y no tiene luces en tiempo real.

Calibración frente al render de Cycles del encuadre de referencia (`assets/scene-preview/room.jpg`), guardada en `assets/models/room.json`:

- `exposure: 1.3`.
- Moqueta: el color es la foto de terciopelo verde del propietario (Google Drive › `Recursos`, la misma que usaba V20), preparada con `tools/encode_carpet.py`: recorte, eliminación de su propia iluminación, repetición sin costuras y repetida cada 0,9 m. El tinte frío de V20 y el brillo se calibraron fila a fila frente al render Cycles: `tint [0.76, 1, 1.65]`, `lightMapScale 0.128`, `specularIntensityScale 1.5`. La textura de 512 px del `.blend` era casi negra (su verde lo ponía el _sheen_ de Cycles); la luz horneada no depende de ese color, así que no hubo que volver a hornear.
- `Juntas_sombra` (`emissive 0.12`): las rendijas de 8 mm entre paneles de pared son más finas que un píxel de la textura de luz.

Diferencias conocidas: los tiradores, de unos 3 px en el atlas, quedan ligeramente más suaves que en Cycles.

## Experiencia

### Entrada (unos 4,6 s)

1. **Espacio**: plano general desde la cámara de referencia, con un avance casi imperceptible.
2. **Identidad**: aparece «EFEDEGAM · ARCHIVO PERSONAL» en verde tinta.
3. **Movimiento**: aceleración fuerte (curva t^3,2); el rótulo sale despedido hacia la cámara.
4. **Frenazo**: la cámara llega a máxima velocidad, se pasa unos 15 cm y retrocede con una oscilación amortiguada y un ligero cabeceo. La pared encaja el golpe: los cajones se desplazan 0,6–2 cm hacia fuera y vuelven a su sitio en onda desde el centro.
5. **Interacción**: la cámara queda a 3,9 m del archivo (4,4 m en móvil), con la pared completa entre techo y moqueta.

«Saltar entrada», Escape, Intro, un clic o un arrastre terminan la secuencia al instante. Con `prefers-reduced-motion` no hay entrada: se muestra directamente el encuadre de referencia. Para revisar sin entrada se puede añadir `?sinintro` a la dirección.

### Cajones

- **Todos los cajones se abren y se cierran** al pulsarlos. Se deslizan sobre su eje, sin atravesar el mueble.
- Seis cajones tienen nombre y etiqueta. Al pulsarlos, la cámara se acerca y aparece un panel. Su ubicación sigue la composición de V20 y se edita en `scripts/drawers.js`:

| Cajón (columna_fila) | Código | Nombre             | Estado                 |
| -------------------- | ------ | ------------------ | ---------------------- |
| C07_F06              | 023    | Proyectos          | Seis fichas de ejemplo |
| C11_F05              | 099    | El vacío           | Contenido pendiente    |
| C04_F09              |        | Planta pixelada    | Contenido pendiente    |
| C04_F02              |        | Película analógica | Contenido pendiente    |
| C11_F08              |        | Teléfono           | Contenido pendiente    |
| C10_F04              |        | Ticket             | Contenido pendiente    |

Las columnas van de C01 a C13, de izquierda a derecha; las filas, de F01 a F12, de arriba abajo. No se ha inventado el contenido de los cinco cajones pendientes. La planta, el teléfono, la película y el ticket no existen como objetos 3D en el `.blend`; solo están en la versión 2D V20 (historial de Git).

### Navegación

Arrastra para mirar. WASD o las flechas para caminar, con la cruceta en pantalla. La rueda o la pinza avanzan y retroceden. Una pulsación en el suelo lleva a ese punto. El desplazamiento se limita a un rectángulo de suelo libre delante de los archivadores. «Vista inicial» vuelve al encuadre de referencia y cierra todos los cajones. Escape cierra la ficha y después devuelve a la exploración.

Si WebGL no arranca o se interrumpe, aparecen la imagen estática y las seis fichas nativas en la misma página. Sin JavaScript, las fichas se pueden leer y desplegar.

## Rendimiento

- GLB de 2,3 MB (geometría comprimida con meshopt, sin cuantizar) y texturas de luz de unos 0,4 MB en total.
- 13 llamadas de dibujo y unos 32.000 triángulos. Los 156 cajones se dibujan en una malla por material. Cada vértice sabe a qué cajón pertenece y una pequeña textura guarda cuánto sobresale cada uno, de modo que se mueven por separado sin perder el agrupamiento.
- Render bajo demanda: sin movimiento no se dibuja. Resolución de píxel limitada a 1,7.

## Regenerar el modelo y la luz

El `.blend` permanece fuera del repositorio. Desde la raíz, con Blender 4.3 o posterior (también vale el módulo `bpy` 5.2.3 de PyPI), sustituye las rutas por las de tu equipo:

```sh
blender --background --factory-startup --disable-autoexec /ruta/privada/Espacio_Portfolio.blend \
  --python tools/bake_lightmaps.py -- /ruta/al/repositorio/EFEDEGAM 96 /ruta/temporal
python3 tools/encode_lightmaps.py /ruta/temporal
python3 tools/encode_carpet.py /ruta/a/la/foto_de_moqueta.jpg
npx --yes gltfpack@0.24.0 -i assets/models/room.glb -o assets/models/room.glb -cc -noq -kn -km -kv
```

1. `bake_lightmaps.py` crea las UV de luz y hornea con Cycles (96 muestras: unos 45 min con 4 núcleos de CPU). Después renderiza la panorámica y escribe `room.glb` y `room.json` sin guardar el `.blend`. Las caras que nadie puede ver se encogen en el atlas. Los frentes se proyectan en alzado, una celda por cajón.
2. `encode_lightmaps.py` (Python con numpy y Pillow) elimina el ruido residual sin mezclar texturas vacías y rellena los márgenes. Después escribe los WebP en sRGB con un ligero tramado.
3. `gltfpack` comprime la geometría. `-kv` es imprescindible: conserva las UV de luz, que ningún material del GLB referencia.

`assets/scene-preview/room.jpg` es un render Cycles independiente del encuadre de referencia (Blender 4.3.2, 64 muestras, 1280 × 720). Sirve como imagen de respaldo y como referencia para la calibración.

Three.js 0.180.0 está incluido en `vendor/three/` con licencia MIT, procedencia e integridad en `SOURCE.json`. Incluye el descompresor meshopt de ese mismo paquete. No hay CDN, rastreo ni claves.

## Validación y límites

```sh
python3 tests/check_site.py
python3 tests/check_space.py
```

La suite 3D comprueba: encuadre exportado, recursos locales, agrupación de cajones, movimiento y límites, arrastre sin selección accidental, entrada completa (empieza lejos y termina frente al archivo), salto de la entrada, apertura independiente de cajones, los seis cajones con nombre, fichas, tacto, alternativa sin WebGL y cese del renderizado en reposo. Usa WebGL por software: no demuestra el rendimiento en teléfonos ni sustituye una revisión en dispositivos reales.

## Referencia y privacidad

La referencia de interacción elegida por el propietario fue https://3dhouse.schumacher.com/ (consultada el 1 de noviembre de 2026). No autoriza a copiar código ni recursos.

Antes de compartir, revisa los archivos exportados y sus metadatos para detectar datos personales o secretos. El GLB se exporta sin `extras`, scripts ni rutas de origen. Cualquier publicación requiere autorización explícita del propietario.
