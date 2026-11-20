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
- Moqueta: el relieve del pelo es el mapa normal del `.blend`, sacado del GLB a `textures/moqueta-normal.webp` con `tools/split_carpet_textures.py` (el GLB llevaba dentro 765 KB de PNG, incluido el color que la foto sustituye). El color es la foto de terciopelo verde del propietario (Google Drive › `Recursos`, la misma que usaba V20), preparada con `tools/encode_carpet.py`: recorte, eliminación de su propia iluminación, repetición sin costuras y repetida cada 0,9 m. El tinte frío de V20 y el brillo se calibraron fila a fila frente al render Cycles: `tint [0.76, 1, 1.65]`, `lightMapScale 0.128`, `specularIntensityScale 1.5`. La textura de 512 px del `.blend` era casi negra (su verde lo ponía el _sheen_ de Cycles); la luz horneada no depende de ese color, así que no hubo que volver a hornear.
- `Juntas_sombra` (`emissive 0.12`): las rendijas de 8 mm entre paneles de pared son más finas que un píxel de la textura de luz.

Diferencias conocidas: los tiradores, de unos 3 px en el atlas, quedan ligeramente más suaves que en Cycles.

## Experiencia

### Entrada (unos 4,6 s)

**00 · Construcción** (unos 3,8 s, `scripts/space/reveal.js`), inspirada en la referencia del propietario (bricelab.dev): carga técnica con retícula, porcentaje y barra en blanco frío; el número cuenta con suavidad y crece con la carga, de pequeño al 0 % a su tamaño completo al 100 % (la interfaz de la sala no aparece hasta que hay sala); la sala a oscuras dibujada solo en líneas; una onda de luz **blanca fría, tirando a azul** (`#bcd8ff`), nace en el cajón 023 y **recorre las aristas** de los objetos: un pulso estrecho corre por los cantos en el frente de la onda, por delante solo queda un plano apenas visible y por detrás aparecen las superficies (archivo, suelo con una retícula escaneada, paredes y techo); después los paneles se encienden por zonas, Z1→Z3, con parpadeo de fluorescente. Las líneas aparecen y se desvanecen con fundidos suaves y desaparecen al terminar, sin coste en reposo.

**Figura de luz** (`scripts/space/figure.js`): una persona de pie en el centro de la sala (z = 3,35 m), hecha de unos 22.000 puntos luminosos con un halo suave, según la imagen de referencia del propietario. Se ensambla desde el polvo con la sala aún a oscuras, gira sobre sí misma, se remueve como humo al pasar el cursor (los puntos siguen su movimiento, giran en remolinos y vuelven poco a poco, sin abrir huecos) y se dispersa cuando la cámara la atraviesa (la entrada la atraviesa al acelerar; también se puede cruzar caminando). Proyecta una sombra suave en el suelo, generada a partir de sus propios puntos, porque la sala no tiene luces en tiempo real. Está preparada para sustituirla por un escaneo del propietario: `createFigure(posición, { points, layers })`. El título «EFEDEGAM» aparece escrito sobre el archivo, detrás de la figura.

1. **Espacio**: plano general desde la cámara de referencia, con un avance casi imperceptible.
2. **Identidad**: aparece «EFEDEGAM · ARCHIVO PERSONAL» en verde tinta.
3. **Movimiento**: aceleración fuerte (curva t^3,2); el rótulo sale despedido hacia la cámara.
4. **Frenazo**: la cámara llega a máxima velocidad, se pasa unos 15 cm y retrocede con una oscilación amortiguada y un ligero cabeceo. La pared encaja el golpe: cada cajón recibe un pequeño impulso, en onda desde el centro, sale como mucho unos 6 mm y vuelve amortiguado, sin rebotes secos.
5. **Interacción**: tras atravesar la figura, la cámara queda a 2,95 m del archivo.

«Saltar entrada», Escape, Intro, un clic o un arrastre terminan la secuencia al instante. Con `prefers-reduced-motion` no hay entrada: se muestra directamente el encuadre de referencia. Para revisar sin entrada se puede añadir `?sinintro` a la dirección.

### Cajones

- **Todos los cajones se abren y se cierran** al pulsarlos. Se deslizan sobre su eje, sin atravesar el mueble.
- Movimiento de guías de rodamientos (`stepDrawer` en `scripts/space/app.js`): una trayectoria sin tirones (velocidad y aceleración nulas en los extremos) que el cajón sigue con su inercia mediante un muelle amortiguado. Al abrir arranca suave, desliza a menos de 1 m/s y se asienta con unos 2 mm de juego (≈0,9 s). Al cerrar, la amortiguación es crítica, como un cierre suave: llega al marco a ~6 cm/s, sin golpe.
- Cajón 023: 32 carpetas colgantes de cartón kraft (`scripts/space/folders.js`), según la foto de referencia de Drive › `Referencias`. Están muy juntas e inclinadas unos 17° hacia el fondo, con pestañas escalonadas, etiquetas blancas que asoman y algunos folios. Las seis de proyectos llevan su título y una marca de su color; al pasar el ratón por encima, la carpeta se levanta 2,8 cm. Las carpetas se balancean por inercia cuando el cajón arranca o frena. No sobresalen del cajón para no atravesar el estante superior al cerrarlo.
- Seis cajones tienen nombre. Como en la referencia del propietario, cada uno lleva en el frente una **pegatina de color** con lo que archiva y una **tarjeta en un portaetiquetas metálico** con su número y posición (`scripts/space/labels.js`; colores en `scripts/drawers.js`). Se abren con el cajón. Los accesos HTML para teclado y lectores de pantalla siguen ahí, invisibles hasta recibir el foco. Al pulsarlos, la cámara se acerca y aparece un panel. Su ubicación sigue la composición de V20 y se edita en `scripts/drawers.js`:

| Cajón (columna_fila) | Código | Nombre             | Estado                            |
| -------------------- | ------ | ------------------ | --------------------------------- |
| C07_F06              | 023    | Proyectos          | Seis fichas de ejemplo            |
| C11_F05              | 099    | El vacío           | Contenido pendiente               |
| C04_F09              |        | Plantimanía        | Hiedra pixelada → web Plantimanía |
| C04_F02              |        | Película analógica | Contenido pendiente               |
| C11_F08              |        | Teléfono           | Contenido pendiente               |
| C10_F04              |        | Ticket             | Contenido pendiente               |

Las columnas van de C01 a C13, de izquierda a derecha; las filas, de F01 a F12, de arriba abajo. No se ha inventado el contenido de los cinco cajones pendientes. La planta, el teléfono, la película y el ticket no existen como objetos 3D en el `.blend`; solo están en la versión 2D V20 (historial de Git).

### PLANTIMANÍA

El cajón C04_F09 (`scripts/space/ivy.js`). Al abrirlo, sale de su interior una **hiedra pixelada** que trepa al azar por los cajones vecinos (unos 4 s). Si se vuelve a pulsar el cajón, la hiedra **invade toda la sala** (paredes, techo y suelo; la cámara retrocede al centro), después crece **sobre la cámara** desde los bordes de la pantalla hasta cubrirla, y la pantalla queda en el verde de Plantimanía (#47622f con grano) antes de abrir https://fdegam.github.io/Plantimania-a/. Cerrar el cajón antes de la invasión, o «Vista inicial», la devuelve dentro.

El aspecto es el de la referencia del propietario: una planta **muy pixelada**, como una fotografía ampliada a bloques. Las hojas (suaves, con degradados) se dibujan en una capa aparte a 1/70 de la resolución y se amplían sin suavizado, en bloques de unos 15 px. Unas 50.000 hojas en una sola llamada de dibujo, que crecen en el GPU según su instante de nacimiento; el recorrido es aleatorio, con ramas, sobre una retícula de 7 cm por las superficies de la sala. Siguen la luz de la tecla Ctrl. Con movimiento reducido, cada fase aparece de golpe. En las pruebas, `?sinsalida` evita abrir la otra web.

### Luces: la tecla «Ctrl»

En la esquina superior izquierda hay una tecla de teclado beige con «Ctrl», como una tecla real: al pulsarla se hunde sobre su faldón y vuelve con un pequeño rebote de muelle. Apaga las luces y, al volver a pulsarla, las enciende. También funciona la tecla Ctrl del teclado pulsada sola (no cuando se combina, como en Ctrl+C).

Los 36 paneles del techo se apagan de forma descoordinada: cada uno recibe un retraso y un parpadeo propios, distintos en cada pulsación (`switchLights` / `updateLights` en `scripts/space/reveal.js`). La luz horneada de la sala sigue a los tubos que quedan encendidos hasta quedar en penumbra (3 %). A oscuras, la figura de puntos brilla con un halo fuerte e ilumina la moqueta a sus pies; la cabecera también se oscurece. Con movimiento reducido el cambio es instantáneo.

### Luz de los paneles

Los paneles emiten algo más que las paredes (`panelEmission` 1,3 en `room.json`) y cada uno tiene un **halo** (`scripts/space/glow.js`): un resplandor suave pegado a los bordes del panel que se derrama sobre la perfilería, como en la foto de referencia del propietario (sin destellos redondos). Es una capa aditiva instanciada (36 paneles, una llamada de dibujo), sin postproceso, y siguen exactamente el estado de cada tubo: construcción por zonas, tecla Ctrl y parpadeos. Los blancos (lacado de los archivadores y paredes paneladas) tienen un 12 % más de luz y la perfilería un 8 % (`materialTuning`).

**Parpadeo**: cada 10 s un tubo al azar (a veces dos) falla un instante, durante unos 0,9 s, y la luz de la sala baja ligeramente con él. Solo con las luces encendidas, la pestaña visible y fuera de la entrada y de la invasión de la hiedra; nunca con movimiento reducido. `?sinparpadeo` lo desactiva para revisar.

### Sonido

Todo el sonido se sintetiza en el navegador con Web Audio (`scripts/space/sound.js`): no hay archivos de audio ni descargas.

- **Fluorescentes**: zumbido constante de 100 Hz con armónicos (red de 50 Hz) y un siseo suave; baja con los tubos que se apagan.
- **Tubos**: chasquidos de cebador y zumbido al encenderse por zonas en la construcción, al pulsar Ctrl (con el clic de la tecla) y en cada parpadeo.
- **Cajones**: rodadura de guías de bolas que sigue a la velocidad del cajón y un golpe amortiguado al cerrar.
- **Construcción**: un barrido frío que acompaña a la onda de luz.
- **Hiedra**: crujido de hojas, más denso cuando invade la sala.
- **Figura de luz**: partículas suspendidas, un brillo aéreo que crece al acercarse y al removerla con el cursor.

Los navegadores no permiten sonar antes de un gesto del visitante: el sonido empieza con el primer clic, toque o tecla (la construcción solo suena si el navegador ya lo permite, por ejemplo en visitas repetidas). Junto a «Ctrl» hay una segunda tecla con un altavoz para silenciarlo (también la tecla M); la elección se recuerda en el navegador.

### Navegación

Arrastra para mirar. En el ordenador, WASD o las flechas del teclado para caminar; en el móvil, pellizca para avanzar o retroceder. No hay flechas en pantalla. La rueda o la pinza avanzan y retroceden. Una pulsación en el suelo lleva a ese punto. El desplazamiento se limita a un rectángulo de suelo libre delante de los archivadores. «Vista inicial» vuelve al encuadre de referencia y cierra todos los cajones. Escape cierra la ficha y después devuelve a la exploración.

Si WebGL no arranca o se interrumpe, aparecen la imagen estática y las seis fichas nativas en la misma página. Sin JavaScript, las fichas se pueden leer y desplegar.

## Rendimiento

- Unos 0,9 MB de descarga con la compresión del servidor: GLB de 1,6 MB (185 KB comprimido; geometría con meshopt, sin cuantizar y sin imágenes), texturas de luz de unos 0,2 MB, moqueta de 0,37 MB (foto y relieve) y Three.js.
- Carga en paralelo: `index.html` anuncia al navegador todos los módulos y recursos (`modulepreload` / `preload`), de modo que se descargan a la vez en lugar de uno tras otro. Mientras llegan, la figura de puntos se calcula en un _worker_ (`scripts/space/points-worker.js`, con `human-points.js`; si el navegador no puede, se calcula como antes) y las carpetas del cajón 023 se dibujan. La imagen de respaldo se pide con prioridad baja.
- 13 llamadas de dibujo (18 con el cajón 023 abierto: las 32 carpetas son instancias) y unos 32.000 triángulos. Los 156 cajones se dibujan en una malla por material. Cada vértice sabe a qué cajón pertenece y una pequeña textura guarda cuánto sobresale cada uno, de modo que se mueven por separado sin perder el agrupamiento.
- Render bajo demanda: sin movimiento no se dibuja. Resolución de píxel limitada a 1,7.

## Regenerar el modelo y la luz

El `.blend` permanece fuera del repositorio. Desde la raíz, con Blender 4.3 o posterior (también vale el módulo `bpy` 5.2.3 de PyPI), sustituye las rutas por las de tu equipo:

```sh
blender --background --factory-startup --disable-autoexec /ruta/privada/Espacio_Portfolio.blend \
  --python tools/bake_lightmaps.py -- /ruta/al/repositorio/EFEDEGAM 96 /ruta/temporal
python3 tools/encode_lightmaps.py /ruta/temporal
python3 tools/encode_carpet.py /ruta/a/la/foto_de_moqueta.jpg
npx --yes gltfpack@0.24.0 -i assets/models/room.glb -o assets/models/room.glb -cc -noq -kn -km -kv
python3 tools/split_carpet_textures.py
```

1. `bake_lightmaps.py` crea las UV de luz y hornea con Cycles (96 muestras: unos 45 min con 4 núcleos de CPU). Después renderiza la panorámica y escribe `room.glb` y `room.json` sin guardar el `.blend`. Las caras que nadie puede ver se encogen en el atlas. Los frentes se proyectan en alzado, una celda por cajón.
2. `encode_lightmaps.py` (Python con numpy y Pillow) elimina el ruido residual sin mezclar texturas vacías y rellena los márgenes. Después escribe los WebP en sRGB con un ligero tramado.
3. `gltfpack` comprime la geometría. `-kv` es imprescindible: conserva las UV de luz, que ningún material del GLB referencia.
4. `split_carpet_textures.py` saca del GLB las texturas de la moqueta: el relieve pasa a WebP y su intensidad a `room.json` › `carpet.normal`.

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
