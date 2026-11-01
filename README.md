# EFEDEGAM · Archivo personal

La sala 3D **es el portfolio**. Se carga directamente al entrar en la web, desde `index.html`, sin portada ni menú de acceso. Usa el espacio aportado en Blender y su cámara de referencia.

El cajón «Proyectos 023» permite acercarse, abrirlo y consultar seis fichas de ejemplo. Los demás cajones forman parte del espacio, pero todavía no tienen interacciones. Los trabajos y textos siguen siendo provisionales.

## Desarrollo local

No se necesitan claves, paquetes ni compilación para ejecutar la web. Desde la raíz:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Abre la raíz del servidor en el navegador. Los módulos JavaScript requieren HTTP; no abras `index.html` mediante `file://`. Ctrl+C detiene el servidor.

## Uso

- Arrastra para mirar alrededor. Con el lienzo enfocado, usa WASD o flechas para caminar. También hay controles en pantalla, desplazamiento al pulsar el suelo y avance/retroceso con rueda o pinza táctil.
- Pulsa el cajón, su marcador o «Ir a proyectos» para acercarte; después abre el cajón y elige una carpeta física o una ficha de la lista.
- «Volver a explorar» recupera la posición anterior. «Vista inicial» devuelve la cámara a su encuadre y cierra el cajón. Escape cierra primero la ficha y después permite volver a explorar.

Si el dispositivo no puede mostrar WebGL, las mismas fichas se pueden consultar en la propia página, sobre la imagen estática de la sala. También están disponibles sin JavaScript. No existe una segunda versión del portfolio detrás de un menú.

## Estructura

| Archivo                             | Responsabilidad                                             |
| ----------------------------------- | ----------------------------------------------------------- |
| `index.html`                        | Entrada única: sala, controles, fichas y alternativa nativa |
| `styles/space.css`                  | Presentación y adaptación a pantallas                       |
| `styles/noscript.css`               | Acceso a las fichas sin JavaScript                          |
| `scripts/space/app.js`              | Renderizado, cajón, cámara y fichas                         |
| `scripts/space/navigation.js`       | Movimiento, gestos y límites de la sala                     |
| `scripts/projects.js`               | Fuente editable de las fichas de ejemplo                    |
| `assets/models/`                    | Modelo GLB y configuración de cámara                        |
| `assets/scene-preview/`             | Imagen de respaldo y procedencia                            |
| `assets/fonts/`                     | Fuentes locales y licencias                                 |
| `vendor/three/`                     | Three.js local, licencia e integridad                       |
| `tools/export_room.py`              | Exportación del modelo desde Blender                        |
| `tools/update_project_fallback.mjs` | Sincronización del contenido nativo con los proyectos       |
| `tests/`                            | Comprobaciones de la entrada, acceso sin 3D e interacciones |

`espacio.html` solo redirige a la raíz para mantener los enlaces anteriores. La portada, la sala CSS, los antiguos menús y sus recursos se han retirado; permanecen en el historial de Git.

Después de editar `scripts/projects.js`, actualiza las fichas nativas con Node.js:

```sh
node tools/update_project_fallback.mjs
```

La biblioteca de inspiración está en [REFERENCIAS.md](REFERENCIAS.md). Las instrucciones de desarrollo y privacidad están en [AGENTS.md](AGENTS.md); las skills de `.agents/skills/` no se cargan en la web.

## Comprobaciones

Requieren Python, Playwright para Python y Chromium, disponibles en el entorno preparado. Son herramientas de desarrollo, no dependencias de los visitantes:

```sh
python3 tests/check_site.py
python3 tests/check_space.py
```

Cada programa inicia y cierra un servidor local. El primero comprueba la entrada directa a la sala, las fichas sin JavaScript, móvil y la redirección antigua. El segundo verifica cámara, movimiento, límites, selección real del modelo, fichas, tacto y recuperación ante fallos de WebGL. La prueba 3D usa renderizado por software; no demuestra rendimiento en teléfonos físicos.

## Modelo, privacidad y publicación

Consulta [ESPACIO_INTERACTIVO.md](docs/ESPACIO_INTERACTIVO.md) para los controles, la exportación y las limitaciones. El `.blend` original permanece fuera del repositorio. Three.js 0.180.0 y las fuentes se sirven localmente, sin CDN, rastreo ni claves. La iluminación del navegador todavía es una aproximación al render de Blender.

No guardes datos personales ni secretos en archivos, imágenes, capturas o historial. `.gitignore` ayuda a prevenir errores; no sustituye la revisión. Antes de subir o publicar, revisa los archivos y solicita autorización explícita del propietario. Un envío a `main` puede activar GitHub Pages si está configurado.
