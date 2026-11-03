import * as THREE from "three";
import { GLTFLoader } from "../../vendor/three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { MeshoptDecoder } from "../../vendor/three/addons/libs/meshopt_decoder.module.js";
import { RoomNavigation } from "./navigation.js";
import { projects } from "../projects.js";
import { specialDrawers } from "../drawers.js";

const $ = (selector) => document.querySelector(selector);
const viewport = $("#sceneViewport"),
  canvas = $("#roomCanvas"),
  status = $("#sceneStatus");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let renderer, scene, camera, room, navigation, config;
let frame = 0,
  lastTime = 0,
  journey = null,
  intro = null,
  returnPose = null;
let selected = null, // drawer the camera is focused on
  ready = false,
  failed = false;
const projectDialog = $("#projectDialog");
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  projected = new THREE.Vector3();
const hotspot = $("#projectHotspot");
const folderObjects = [];

/* ------------------------------------------------------------------ */
/* Drawers: 156 independent drawers drawn as one mesh per material.     */
/* Each vertex knows its drawer; a small float texture holds how far    */
/* every drawer is pulled out, so any drawer can move without breaking  */
/* the batch.                                                           */
/* ------------------------------------------------------------------ */
const drawers = []; // { id, node, index, closedZ, offset, target, motion, special }
const drawerById = new Map();
let offsetData,
  offsetTexture,
  mergedDrawers = [];
let projectDrawer = null;
const tags = [];

function drawerLabel(d) {
  const [c, f] = d.id.split("_");
  return `${c.replace("C", "Columna ")}, ${f.replace("F", "fila ")}`;
}
function setOffset(d, value) {
  d.offset = value;
  d.node.position.z = d.closedZ + value;
  offsetData[d.index] = value;
  offsetTexture.needsUpdate = true;
}
function animateDrawer(d, target, duration = 650, ease = easeOutCubic) {
  d.target = target;
  if (reduced.matches) {
    setOffset(d, target);
    d.motion = null;
  } else
    d.motion = {
      from: d.offset,
      to: target,
      start: performance.now(),
      duration,
      ease,
    };
  invalidate();
}
const isOpen = (d) => d.target > 0.001;
function toggleDrawer(d, open = !isOpen(d)) {
  animateDrawer(d, open ? config.drawerTravel * (d.special ? 1 : 0.82) : 0);
  return open;
}

/* ------------------------------------------------------------------ */
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
function announce(text) {
  status.textContent = text;
}
function invalidate() {
  if (!frame && ready && !document.hidden && !failed)
    frame = requestAnimationFrame(renderFrame);
}
function pose() {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
  };
}
function travelTo(target, duration = 900) {
  navigation.clearInput();
  if (reduced.matches) {
    camera.position.copy(target.position);
    camera.quaternion.copy(target.quaternion);
    journey = null;
  } else
    journey = { from: pose(), to: target, start: performance.now(), duration };
  invalidate();
}
function initialPose() {
  return {
    position: new THREE.Vector3(...config.camera.position),
    quaternion: new THREE.Quaternion(...config.camera.quaternion),
  };
}
/** Where the entrance stops: in front of the archive, the whole wall between ceiling and carpet. */
function arrivalPose() {
  return {
    position: new THREE.Vector3(0, 1.28, innerWidth <= 760 ? 4.4 : 3.9),
    quaternion: new THREE.Quaternion(),
  };
}

/* ------------------------------------------------------------------ */
/* Panel and selection                                                  */
/* ------------------------------------------------------------------ */
function updatePanel() {
  const d = selected;
  if (!d) return;
  const open = isOpen(d);
  const projectsKind = d.special?.kind === "projects";
  $("#drawerTitle").textContent = projectsKind
    ? "Un cajón, seis posibilidades."
    : d.special.name;
  $("#drawerCode").textContent = d.special.code
    ? `CAJÓN ${d.special.code}`
    : drawerLabel(d).toUpperCase();
  $("#drawerPanel > p").textContent = projectsKind
    ? open
      ? "Elige una carpeta para consultar su ficha."
      : "Abre el cajón para descubrir las carpetas del archivo."
    : open
      ? `«${d.special.name}» todavía no tiene su contenido en el archivo.`
      : "Abre el cajón para ver qué guarda.";
  $("#toggleDrawer").textContent = open ? "Cerrar cajón" : "Abrir cajón";
  $("#toggleDrawer").setAttribute("aria-expanded", String(open));
  $("#projectChoices").hidden = !(projectsKind && open);
  $(".folder-hint").hidden = !(projectsKind && open);
}
function setSelected(d) {
  selected = d;
  $("#drawerPanel").hidden = !d;
  $("#backToExplore").hidden = !d;
  document.body.classList.toggle("has-selection", Boolean(d));
  if (ready) $("#walkControls").hidden = Boolean(d);
  updatePanel();
  invalidate();
}
function focusDrawer(d) {
  if (!ready || projectDialog.open || intro) return;
  if (!selected) returnPose = pose();
  setSelected(d);
  const center = d.node.getWorldPosition(new THREE.Vector3());
  center.z -= d.offset;
  const position = center.clone();
  position.z = 1.25;
  // Slightly above the drawer, so its contents show once it is pulled out.
  position.y = THREE.MathUtils.clamp(position.y + 0.3, 0.6, 2.4);
  position.x = THREE.MathUtils.clamp(position.x, -2.6, 2.6);
  const lookTarget = center.clone();
  lookTarget.z += config.drawerTravel * 0.5;
  if (innerWidth <= 760) lookTarget.y -= 0.38;
  const target = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, lookTarget, camera.up),
  );
  travelTo({ position, quaternion: target });
  $("#toggleDrawer").focus({ preventScroll: true });
  announce(
    `Cajón «${d.special.name}» seleccionado. Puedes abrirlo con el botón Abrir cajón.`,
  );
}
const focusProjects = () => focusDrawer(projectDrawer);
function backToExplore({ restore = true } = {}) {
  if (!ready) return;
  setSelected(null);
  if (restore && returnPose) travelTo(returnPose);
  else journey = null;
  returnPose = null;
  canvas.focus({ preventScroll: true, focusVisible: false });
  announce(
    "Explorando la sala. Arrastra para mirar y usa las flechas para caminar.",
  );
}
function userInput() {
  journey = null;
  if (selected) {
    setSelected(null);
    returnPose = null;
  }
}
function resetCamera() {
  if (!ready) return;
  setSelected(null);
  returnPose = null;
  drawers.forEach((d) => isOpen(d) && toggleDrawer(d, false));
  travelTo(initialPose(), 1300);
  canvas.focus({ preventScroll: true, focusVisible: false });
  announce("Vista inicial de la sala.");
}
function setSelectedDrawer(open) {
  if (!ready || !selected) return;
  toggleDrawer(selected, open);
  updatePanel();
  const projectsKind = selected.special?.kind === "projects";
  announce(
    open
      ? projectsKind
        ? "Cajón abierto. Elige una de las seis carpetas."
        : `Cajón «${selected.special.name}» abierto. Su contenido está en preparación.`
      : "Cajón cerrado.",
  );
}

/* ------------------------------------------------------------------ */
/* Picking                                                              */
/* ------------------------------------------------------------------ */
function pick(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  pointer.set(
    ((clientX - bounds.left) / bounds.width) * 2 - 1,
    (-(clientY - bounds.top) / bounds.height) * 2 + 1,
  );
  camera.updateMatrixWorld();
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(room, true).find((hit) => {
    for (let object = hit.object; object; object = object.parent)
      if (!object.visible) return false;
    return true;
  });
  if (!hit) return null;
  for (let object = hit.object; object; object = object.parent)
    if (Number.isInteger(object.userData.projectIndex))
      return isOpen(projectDrawer) && selected === projectDrawer
        ? { kind: "folder", index: object.userData.projectIndex }
        : { kind: "drawer", drawer: projectDrawer };
  const ids = hit.object.geometry?.attributes?.drawerId;
  if (ids && hit.face) {
    const d = drawers[Math.round(ids.getX(hit.face.a))];
    return { kind: "drawer", drawer: d };
  }
  if (hit.point.y < 0.1) return { kind: "floor", point: hit.point };
  return null;
}
function tap(clientX, clientY) {
  if (intro) return finishIntro();
  const hit = pick(clientX, clientY);
  if (hit?.kind === "folder") openProject(hit.index);
  else if (hit?.kind === "drawer") {
    const d = hit.drawer;
    if (d.special) {
      if (selected === d) setSelectedDrawer(!isOpen(d));
      else focusDrawer(d);
    } else {
      const open = toggleDrawer(d);
      announce(
        `${drawerLabel(d)}: cajón ${open ? "abierto. Está vacío" : "cerrado"}.`,
      );
    }
  } else if (hit?.kind === "floor") {
    const position = hit.point.clone();
    position.y = camera.position.y;
    position.x = THREE.MathUtils.clamp(
      position.x,
      config.walkBounds.minX,
      config.walkBounds.maxX,
    );
    position.z = THREE.MathUtils.clamp(
      position.z,
      config.walkBounds.minZ,
      config.walkBounds.maxZ,
    );
    setSelected(null);
    returnPose = null;
    travelTo({ position, quaternion: camera.quaternion.clone() });
    announce("Desplazándote al punto seleccionado de la sala.");
  }
}
function hover(x, y) {
  if (intro) return;
  const hit = pick(x, y);
  canvas.classList.toggle(
    "is-over-project",
    hit?.kind === "folder" || hit?.kind === "drawer",
  );
}
function placeTag(element, d, hidden) {
  d.node.getWorldPosition(projected);
  projected.y += 0.01;
  projected.z += 0.06;
  projected.project(camera);
  element.hidden =
    hidden ||
    projected.z < -1 ||
    projected.z > 1 ||
    Math.abs(projected.x) > 0.93 ||
    Math.abs(projected.y) > 0.83;
  element.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px,${(-projected.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
}
function updateHotspots() {
  const hide = Boolean(selected) || Boolean(intro);
  placeTag(hotspot, projectDrawer, hide);
  for (const { element, drawer } of tags) placeTag(element, drawer, hide);
}

/* ------------------------------------------------------------------ */
/* Entrance: space, identity, acceleration, brake, interaction.         */
/* ------------------------------------------------------------------ */
const INTRO = { hold: 2300, rush: 1250, brake: 1100 };
function startIntro() {
  const from = initialPose();
  const creep = from.position.clone().add(new THREE.Vector3(0, 0.03, -0.32));
  intro = { start: performance.now(), from, creep, to: arrivalPose() };
  document.body.classList.add("is-intro");
  $("#introTitle").hidden = false;
  $("#skipIntro").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("intro-show-title"));
  announce("EFEDEGAM. Entrando en el archivo. Pulsa Saltar para empezar.");
  invalidate();
}
function finishIntro() {
  if (!intro) return;
  const to = intro.to;
  intro = null;
  camera.position.copy(to.position);
  camera.quaternion.copy(to.quaternion);
  drawers.forEach((d) => !isOpen(d) && d.offset && setOffset(d, 0));
  document.body.classList.remove(
    "is-intro",
    "intro-show-title",
    "intro-rushing",
  );
  $("#introTitle").hidden = true;
  $("#skipIntro").hidden = true;
  $("#walkControls").hidden = Boolean(selected);
  canvas.focus({ preventScroll: true, focusVisible: false });
  announce(
    "Frente al archivo. Pulsa un cajón para abrirlo, o los cajones señalados para descubrir sus contenidos.",
  );
  invalidate();
}
const smooth = (t) => t * t * (3 - 2 * t);
const shake = new THREE.Euler();
const shakeQ = new THREE.Quaternion();
function updateIntro(time) {
  const t = intro.frozen ?? time - intro.start;
  const { from, creep, to } = intro;
  const { hold, rush, brake } = INTRO;
  if (t < hold) {
    // 01 · The space: a slow, almost imperceptible advance.
    const k = smooth(t / hold);
    camera.position.lerpVectors(from.position, creep, k);
    camera.quaternion.copy(from.quaternion);
  } else if (t < hold + rush) {
    // 03 · Movement: accelerate hard, maximum speed just before the wall.
    if (!document.body.classList.contains("intro-rushing"))
      document.body.classList.add("intro-rushing");
    const k = (t - hold) / rush;
    const e = Math.pow(k, 3.2);
    camera.position.lerpVectors(creep, to.position, e);
    camera.quaternion.slerpQuaternions(from.quaternion, to.quaternion, e);
  } else if (t < hold + rush + brake) {
    // 04 · Brake: arrive at full speed, overshoot, damped recoil and shake.
    const s = (t - hold - rush) / 1000;
    const distance = creep.distanceTo(to.position);
    const v0 = (3.2 * distance) / (rush / 1000);
    const w = 19,
      k = 8.5;
    const recoil = (v0 / w) * Math.exp(-k * s) * Math.sin(w * s);
    const dir = to.position.clone().sub(creep).normalize();
    camera.position.copy(to.position).addScaledVector(dir, recoil * 0.55);
    const jolt = Math.exp(-k * 0.8 * s);
    shake.set(
      -0.028 * jolt * Math.sin(w * 1.25 * s),
      0.004 * jolt * Math.sin(w * 1.9 * s + 1.3),
      0.006 * jolt * Math.sin(w * 1.6 * s),
    );
    camera.quaternion.copy(to.quaternion).multiply(shakeQ.setFromEuler(shake));
    // The wall takes the impact: drawers jolt out and fall back, as a ripple.
    for (const d of drawers) {
      if (isOpen(d)) continue;
      const delay = d.ripple * 0.32;
      const u = s - delay;
      const v =
        u > 0
          ? d.jolt * Math.exp(-7 * u) * Math.abs(Math.sin(17 * u + d.phase))
          : 0;
      if (Math.abs(v - d.offset) > 1e-5) setOffset(d, v);
    }
  } else return finishIntro();
}

/* ------------------------------------------------------------------ */
function renderFrame(time) {
  frame = 0;
  if (!ready || failed || document.hidden) return;
  const dt = Math.min((time - (lastTime || time)) / 1000, 0.1);
  lastTime = time;
  let moving = false;
  if (intro) {
    updateIntro(time);
    moving = true;
  } else moving = navigation.update(dt);
  if (journey) {
    const t = Math.min(1, (time - journey.start) / journey.duration),
      ease = 1 - Math.pow(1 - t, 3);
    camera.position.lerpVectors(
      journey.from.position,
      journey.to.position,
      ease,
    );
    camera.quaternion.slerpQuaternions(
      journey.from.quaternion,
      journey.to.quaternion,
      ease,
    );
    if (t === 1) journey = null;
  }
  let drawerMoving = false;
  for (const d of drawers) {
    if (!d.motion) continue;
    const t = Math.min(1, (time - d.motion.start) / d.motion.duration);
    setOffset(
      d,
      THREE.MathUtils.lerp(d.motion.from, d.motion.to, d.motion.ease(t)),
    );
    if (t === 1) d.motion = null;
    else drawerMoving = true;
  }
  folderObjects.forEach((card) => (card.visible = projectDrawer.offset > 0.05));
  room.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  updateHotspots();
  renderer.render(scene, camera);
  if (moving || journey || drawerMoving || intro) invalidate();
}
function resize() {
  if (!renderer || !camera) return;
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Preserve the authored desktop camera; on portrait, widen the view enough
  // to retain both walls instead of stretching the model or walking outside it.
  const fitAspect = Math.max(camera.aspect, 0.78);
  camera.fov = THREE.MathUtils.radToDeg(
    2 *
      Math.atan(
        (Math.tan(THREE.MathUtils.degToRad(config.camera.fov) / 2) *
          config.camera.referenceAspect) /
          Math.min(config.camera.referenceAspect, fitAspect),
      ),
  );
  camera.updateProjectionMatrix();
  invalidate();
}
function addFolders() {
  const paper = new THREE.Color("#c9bca2");
  const lit = (color) =>
    new THREE.MeshLambertMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
    });
  projects.forEach((project, i) => {
    const height = 0.13 + i * 0.008;
    const folder = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, height, 0.004),
      lit(new THREE.Color(project.color).lerp(paper, 0.65)),
    );
    board.position.y = height / 2;
    const tab = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.022, 0.004),
      lit(new THREE.Color(project.color)),
    );
    tab.position.set(-0.13 + (i % 3) * 0.13, height + 0.011, 0);
    folder.add(board, tab);
    folder.position.set(0, -0.095, -0.07 - i * 0.045);
    folder.rotation.x = -0.12;
    folder.visible = false;
    folder.userData.projectIndex = i;
    projectDrawer.node.add(folder);
    folderObjects.push(folder);
  });
}
function addTags() {
  for (const d of drawers) {
    if (!d.special || d.special.kind === "projects") continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "drawer-tag";
    button.hidden = true;
    button.setAttribute("aria-label", `Acercarse al cajón «${d.special.name}»`);
    button.innerHTML = d.special.code
      ? `<span class="tag-code">${d.special.code}</span>`
      : "";
    button.append(document.createTextNode(d.special.name.toUpperCase()));
    button.addEventListener("click", () => focusDrawer(d));
    viewport.append(button);
    tags.push({ element: button, drawer: d });
  }
}
function showError(message) {
  failed = true;
  ready = false;
  intro = null;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  navigation?.dispose();
  document.body.classList.remove(
    "is-intro",
    "intro-show-title",
    "intro-rushing",
  );
  $("#introTitle").hidden = true;
  $("#skipIntro").hidden = true;
  viewport.classList.remove("is-ready");
  viewport.setAttribute("aria-busy", "false");
  canvas.hidden = true;
  $("#scenePoster").hidden = false;
  hotspot.hidden = true;
  tags.forEach(({ element }) => (element.hidden = true));
  $("#walkControls").hidden = true;
  $("#drawerPanel").hidden = true;
  $("#backToExplore").hidden = true;
  $("#loadingState").hidden = true;
  $("#sceneError").hidden = false;
  $("#focusProjects").disabled = true;
  $("#resetCamera").disabled = true;
  $("#errorMessage").textContent = message;
  announce(message);
}

/* ------------------------------------------------------------------ */
/* Scene set-up                                                         */
/* ------------------------------------------------------------------ */
/** The lighting is Cycles' own, baked in Blender: no real-time lamps. */
async function loadLightmaps() {
  const loader = new THREE.TextureLoader();
  const entries = await Promise.all(
    Object.entries(config.lightmaps).map(async ([key, info]) => {
      const texture = await loader.loadAsync(`assets/models/${info.file}`);
      texture.flipY = false;
      texture.channel = 1;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(
        4,
        renderer.capabilities.getMaxAnisotropy(),
      );
      return [key, { texture, intensity: info.intensity }];
    }),
  );
  return Object.fromEntries(entries);
}
/**
 * Gloss and the carpet's velvet sheen come from a Cycles panorama of the
 * room. Its diffuse share is removed in the shader: diffuse light is
 * already in the lightmaps and must not be counted twice.
 */
const reflectionsOnly = THREE.ShaderChunk.lights_physical_pars_fragment.replace(
  "reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;",
  "",
);
function patchReflections(material, extra) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_physical_pars_fragment>",
      reflectionsOnly,
    );
    extra?.(shader);
  };
  material.customProgramCacheKey = () =>
    extra ? "efedegam-drawers" : "efedegam-room";
}
async function loadEnvironment() {
  const info = config.environment;
  if (!info) return null;
  const texture = await new THREE.TextureLoader().loadAsync(
    `assets/models/${info.file}`,
  );
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(texture).texture;
  pmrem.dispose();
  texture.dispose();
  return { texture: env, intensity: info.intensity };
}
function withLightmap(material, lightmap, cache) {
  const key = material.uuid;
  if (!cache.has(key)) {
    const m = material.clone();
    m.lightMap = lightmap.texture;
    m.lightMapIntensity = lightmap.intensity;
    // Calibration against the Cycles reference render (see room.json).
    const tune = config.materialTuning?.[material.name];
    if (tune) {
      if (m.sheenColor) m.sheenColor.multiplyScalar(tune.sheenColorScale ?? 1);
      if (m.specularIntensity !== undefined)
        m.specularIntensity *= tune.specularIntensityScale ?? 1;
      m.lightMapIntensity *= tune.lightMapScale ?? 1;
      // Faces the lightmap cannot resolve (8 mm shadow gaps) get a floor.
      if (tune.emissive) m.emissive.setRGB(...tune.emissive);
    }
    patchReflections(m);
    cache.set(key, m);
  }
  return cache.get(key);
}
function batchDrawers(lightmap) {
  const byMaterial = new Map();
  room.updateMatrixWorld(true);
  const inverseRoom = room.matrixWorld.clone().invert();
  drawers.forEach((d) => {
    d.node.traverse((mesh) => {
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(inverseRoom.clone().multiply(mesh.matrixWorld));
      g.setAttribute(
        "drawerId",
        new THREE.Float32BufferAttribute(
          new Float32Array(g.attributes.position.count).fill(d.index),
          1,
        ),
      );
      for (const name of Object.keys(g.attributes))
        if (!["position", "normal", "uv", "uv1", "drawerId"].includes(name))
          g.deleteAttribute(name);
      const key = mesh.material.uuid;
      if (!byMaterial.has(key))
        byMaterial.set(key, { material: mesh.material, geometries: [] });
      byMaterial.get(key).geometries.push(g);
      mesh.visible = false;
    });
  });
  offsetData = new Float32Array(drawers.length);
  offsetTexture = new THREE.DataTexture(
    offsetData,
    drawers.length,
    1,
    THREE.RedFormat,
    THREE.FloatType,
  );
  offsetTexture.needsUpdate = true;
  for (const { material, geometries } of byMaterial.values()) {
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    const m = material.clone();
    m.lightMap = lightmap.texture;
    m.lightMapIntensity = lightmap.intensity;
    patchReflections(m, (shader) => {
      shader.uniforms.drawerOffsets = { value: offsetTexture };
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute float drawerId;\nuniform highp sampler2D drawerOffsets;",
        )
        .replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\ntransformed.z += texelFetch(drawerOffsets, ivec2(int(drawerId + 0.5), 0), 0).r;",
        );
    });
    const mesh = new THREE.Mesh(geometry, m);
    mesh.name = "Archive_Drawers";
    // Bounds include the pulled-out position, so culling never clips a drawer.
    geometry.computeBoundingBox();
    geometry.boundingBox.max.z += config.drawerTravel;
    geometry.computeBoundingSphere();
    geometry.boundingSphere.radius += config.drawerTravel;
    room.add(mesh);
    mergedDrawers.push(mesh);
  }
}
async function start() {
  viewport.setAttribute("aria-busy", "true");
  try {
    const response = await fetch("assets/models/room.json");
    if (!response.ok) throw new Error("Room configuration unavailable");
    config = await response.json();
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Same view transform as the Blender file (AgX).
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = config.exposure ?? 1;
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#c9cec8");
    camera = new THREE.PerspectiveCamera(
      config.camera.fov,
      innerWidth / innerHeight,
      0.025,
      50,
    );
    camera.position.fromArray(config.camera.position);
    camera.quaternion.fromArray(config.camera.quaternion);
    const [gltf, lightmaps] = await Promise.all([
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync("assets/models/room.glb", (event) => {
          if (event.total)
            $("#loadingText").textContent =
              `Preparando la sala… ${Math.round((event.loaded / event.total) * 100)} %`;
        }),
      loadLightmaps(),
    ]);
    const environment = await loadEnvironment();
    if (environment) {
      scene.environment = environment.texture;
      scene.environmentIntensity = environment.intensity;
    }
    room = gltf.scene;
    scene.add(room);
    const cache = new Map();
    room.traverse((object) => {
      if (!object.isMesh) return;
      // Meshes may be unnamed after compression; their nodes keep the name.
      const owner = `${object.name} ${object.parent?.name ?? ""}`;
      if (owner.includes("Room_Architecture"))
        object.material = withLightmap(object.material, lightmaps.room, cache);
      else if (owner.includes("Archive_Structure"))
        object.material = withLightmap(
          object.material,
          lightmaps.archive,
          cache,
        );
    });
    const specials = new Map(specialDrawers.map((s) => [`CAJON_${s.id}`, s]));
    room.traverse((object) => {
      if (!object.name.startsWith("CAJON_")) return;
      drawers.push({ node: object, id: object.name.slice(6) });
    });
    drawers.sort((a, b) => a.id.localeCompare(b.id));
    if (drawers.length !== config.grid.columns * config.grid.rows)
      throw new Error("Unexpected drawer count");
    drawers.forEach((d, index) => {
      const [c, f] = d.id.split("_").map((part) => Number(part.slice(1)));
      Object.assign(d, {
        index,
        closedZ: d.node.position.z,
        offset: 0,
        target: 0,
        motion: null,
        special: specials.get(d.node.name) ?? null,
        ripple: Math.hypot(c - 7, (f - 6.5) * 1.6) / 9,
        jolt: 0.006 + 0.014 * Math.abs(Math.sin(index * 12.9898) * 0.5 + 0.5),
        phase: (index * 2.39996) % Math.PI,
      });
      drawerById.set(d.id, d);
    });
    projectDrawer = drawerById.get(config.projectDrawer.slice(6));
    if (!projectDrawer) throw new Error("Project drawer unavailable");
    batchDrawers(lightmaps.archive);
    addFolders();
    addTags();
    navigation = new RoomNavigation(camera, canvas, config.walkBounds, {
      onChange: invalidate,
      onInput: () => (intro ? finishIntro() : userInput()),
      onTap: tap,
      onHover: hover,
    });
    resize();
    // Compile before dismissing the loading state, so the first interaction
    // is not spent waiting for materials to initialize.
    await renderer.compileAsync(scene, camera);
    if (new URLSearchParams(location.search).has("debug"))
      window.__efedegam = {
        THREE,
        scene,
        renderer,
        camera,
        drawers,
        /** Freeze the entrance at `ms` (debug only), e.g. to inspect a frame. */
        introAt(ms) {
          if (!intro) return false;
          intro.start = performance.now() - ms;
          intro.frozen = ms;
          return true;
        },
      };
    ready = true;
    failed = false;
    renderFrame(performance.now());
    viewport.classList.add("is-ready");
    viewport.setAttribute("aria-busy", "false");
    $("#loadingState").hidden = true;
    $("#scenePoster").hidden = true;
    $("#resetCamera").disabled = false;
    $("#focusProjects").disabled = false;
    const skip =
      reduced.matches || new URLSearchParams(location.search).has("sinintro");
    if (skip) {
      // Without motion, the visitor sees the validated reference framing.
      $("#walkControls").hidden = false;
      announce(
        "Sala lista. Pulsa un cajón para abrirlo, o selecciona Proyectos.",
      );
    } else startIntro();
    invalidate();
  } catch (error) {
    console.warn(
      "Room could not initialize:",
      error instanceof Error ? error.message : "unknown error",
    );
    showError(
      "No se ha podido mostrar la sala 3D en este dispositivo. Las carpetas siguen disponibles aquí; también puedes reintentarlo.",
    );
  }
}

/* ------------------------------------------------------------------ */
/* Native dialog keeps project information available without 3D.       */
/* ------------------------------------------------------------------ */
let currentProject = 0;
function openProject(index) {
  currentProject = index;
  const project = projects[index];
  $("#projectTitle").textContent = project.title;
  $("#projectCategory").textContent = project.category;
  $("#projectDescription").textContent = project.description;
  $("#projectWord").textContent = project.word;
  $("#projectArt").style.setProperty("--project-color", project.color);
  if (!projectDialog.open) {
    navigation?.setEnabled(false);
    projectDialog.showModal();
  }
}
projects.forEach((project, index) => {
  const button = document.createElement("button");
  button.type = "button";
  const swatch = document.createElement("span");
  swatch.className = "folder-swatch";
  swatch.setAttribute("aria-hidden", "true");
  swatch.style.setProperty("--folder-color", project.color);
  button.append(swatch, document.createTextNode(project.title));
  button.addEventListener("click", () => openProject(index));
  $("#projectChoices").append(button);
});
$("#closeProjectDialog").addEventListener("click", () => projectDialog.close());
$("#nextProject").addEventListener("click", () =>
  openProject((currentProject + 1) % projects.length),
);
projectDialog.addEventListener("close", () => {
  navigation?.setEnabled(true);
  invalidate();
});
projectDialog.addEventListener("click", (event) => {
  if (event.target === projectDialog) {
    const r = projectDialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      projectDialog.close();
  }
});
hotspot.addEventListener("click", focusProjects);
$("#focusProjects").addEventListener("click", () => {
  finishIntro();
  focusProjects();
});
$("#resetCamera").addEventListener("click", () => {
  finishIntro();
  resetCamera();
});
$("#skipIntro").addEventListener("click", finishIntro);
$("#backToExplore").addEventListener("click", () => backToExplore());
$("#closeDrawerPanel").addEventListener("click", () => backToExplore());
$("#toggleDrawer").addEventListener("click", () =>
  setSelectedDrawer(!isOpen(selected)),
);
$("#retryScene").addEventListener("click", () => location.reload());
for (const button of document.querySelectorAll("[data-move]")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    navigation?.setDirection(button.dataset.move, true);
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(name, () =>
      navigation?.setDirection(button.dataset.move, false),
    );
  button.addEventListener("keydown", (event) => {
    if (event.code === "Space" || event.code === "Enter") {
      event.preventDefault();
      navigation?.setDirection(button.dataset.move, true);
    }
  });
  button.addEventListener("keyup", (event) => {
    if (event.code === "Space" || event.code === "Enter")
      navigation?.setDirection(button.dataset.move, false);
  });
  button.addEventListener("blur", () =>
    navigation?.setDirection(button.dataset.move, false),
  );
}
addEventListener("keydown", (event) => {
  if (intro && ["Escape", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    finishIntro();
  } else if (event.key === "Escape" && !projectDialog.open && selected) {
    event.preventDefault();
    backToExplore();
  }
});
addEventListener("resize", resize);
addEventListener("blur", () => {
  lastTime = 0;
});
document.addEventListener("visibilitychange", () => {
  lastTime = 0;
  if (!document.hidden) invalidate();
});
reduced.addEventListener("change", () => {
  if (reduced.matches) {
    finishIntro();
    if (journey) {
      camera.position.copy(journey.to.position);
      camera.quaternion.copy(journey.to.quaternion);
      journey = null;
    }
    drawers.forEach((d) => {
      if (d.motion) {
        setOffset(d, d.motion.to);
        d.motion = null;
      }
    });
  }
  invalidate();
});
canvas.addEventListener("webglcontextlost", (event) => {
  event.preventDefault();
  showError(
    "Se ha interrumpido la vista 3D. Puedes reintentarlo o consultar las carpetas aquí mismo.",
  );
});
start();

/** Read-only state for local integration tests; contains no credentials. */
export function getRoomState() {
  const screen = (d) => {
    if (!d || !camera) return null;
    camera.updateMatrixWorld();
    const point = d.node
      .localToWorld(new THREE.Vector3(0.2, 0, 0.02))
      .project(camera);
    return {
      x: (point.x * 0.5 + 0.5) * innerWidth,
      y: (-point.y * 0.5 + 0.5) * innerHeight,
    };
  };
  return {
    drawerTarget: screen(projectDrawer),
    drawerScreen: (id) => screen(drawerById.get(id)),
    ready,
    intro: Boolean(intro),
    selected: selected?.id ?? null,
    isOpen: projectDrawer ? isOpen(projectDrawer) : false,
    openDrawers: drawers.filter(isOpen).map((d) => d.id),
    drawerCount: drawers.length,
    camera: camera
      ? {
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
        }
      : null,
    drawerZ: projectDrawer?.node.position.z,
    bounds: config?.walkBounds,
    framePending: Boolean(frame),
    render: renderer
      ? {
          calls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        }
      : null,
  };
}
