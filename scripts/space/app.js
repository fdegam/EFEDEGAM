import * as THREE from "three";
import { GLTFLoader } from "../../vendor/three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "../../vendor/three/addons/environments/RoomEnvironment.js";
import { RoomNavigation } from "./navigation.js";
import { projects } from "../projects.js";

const $ = (selector) => document.querySelector(selector);
const viewport = $("#sceneViewport"),
  canvas = $("#roomCanvas"),
  status = $("#sceneStatus");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let renderer, scene, camera, room, navigation, config, drawer;
let frame = 0,
  lastTime = 0,
  journey = null,
  drawerMotion = null,
  returnPose = null;
let selected = false,
  isOpen = false,
  ready = false,
  failed = false;
let drawerClosedZ = 0;
const projectDialog = $("#projectDialog");
const raycaster = new THREE.Raycaster(),
  pointer = new THREE.Vector2(),
  projected = new THREE.Vector3();
const hotspot = $("#projectHotspot");
let focusCenter = new THREE.Vector3();
const folderObjects = [];

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
function travelTo(target) {
  navigation.clearInput();
  if (reduced.matches) {
    camera.position.copy(target.position);
    camera.quaternion.copy(target.quaternion);
    journey = null;
  } else
    journey = {
      from: pose(),
      to: target,
      start: performance.now(),
      duration: 900,
    };
  invalidate();
}
function setSelected(value) {
  selected = value;
  $("#drawerPanel").hidden = !value;
  $("#backToExplore").hidden = !value;
  document.body.classList.toggle("has-selection", value);
  if (ready) $("#walkControls").hidden = value;
  invalidate();
}
function focusProjects() {
  if (!ready || projectDialog.open) return;
  if (!selected) returnPose = pose();
  setSelected(true);
  drawer.getWorldPosition(focusCenter);
  const position = focusCenter.clone();
  position.z = 1.25;
  position.y = THREE.MathUtils.clamp(position.y, 0.4, 2.2);
  const lookTarget = focusCenter.clone();
  if (innerWidth <= 760) lookTarget.y -= 0.38;
  const target = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, lookTarget, camera.up),
  );
  travelTo({ position, quaternion: target });
  $("#toggleDrawer").focus({ preventScroll: true });
  announce(
    "Cajón de proyectos seleccionado. Puedes abrirlo con el botón Abrir cajón.",
  );
}
function backToExplore({ restore = true } = {}) {
  if (!ready) return;
  setSelected(false);
  if (restore && returnPose) travelTo(returnPose);
  else journey = null;
  returnPose = null;
  canvas.focus({ preventScroll: true });
  announce(
    "Explorando la sala. Arrastra para mirar y usa las flechas para caminar.",
  );
}
function userInput() {
  journey = null;
  if (selected) {
    setSelected(false);
    returnPose = null;
  }
}
function initialPose() {
  return {
    position: new THREE.Vector3(...config.camera.position),
    quaternion: new THREE.Quaternion(...config.camera.quaternion),
  };
}
function resetCamera() {
  if (!ready) return;
  setSelected(false);
  returnPose = null;
  setDrawer(false);
  travelTo(initialPose());
  canvas.focus({ preventScroll: true });
  announce("Vista inicial de la sala.");
}
function setDrawer(open) {
  if (!ready) return;
  isOpen = open;
  const target = drawerClosedZ + (open ? config.drawerTravel : 0);
  if (reduced.matches) {
    drawer.position.z = target;
    drawerMotion = null;
  } else
    drawerMotion = {
      from: drawer.position.z,
      to: target,
      start: performance.now(),
      duration: 650,
    };
  $("#toggleDrawer").textContent = open ? "Cerrar cajón" : "Abrir cajón";
  $("#toggleDrawer").setAttribute("aria-expanded", String(open));
  $("#projectChoices").hidden = !open;
  $("#drawerPanel > p").textContent = open
    ? "Elige una carpeta para consultar su ficha."
    : "Abre el cajón para descubrir las carpetas del archivo.";
  announce(
    open ? "Cajón abierto. Elige una de las seis carpetas." : "Cajón cerrado.",
  );
  invalidate();
}
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
  let object = hit.object;
  while (object) {
    if (Number.isInteger(object.userData.projectIndex) && isOpen && selected)
      return { kind: "folder", index: object.userData.projectIndex };
    if (object === drawer) return { kind: "project" };
    object = object.parent;
  }
  if (hit.object.isMesh && hit.point.y < 0.1)
    return { kind: "floor", point: hit.point };
  return null;
}
function tap(clientX, clientY) {
  const hit = pick(clientX, clientY);
  if (hit?.kind === "folder") openProject(hit.index);
  else if (hit?.kind === "project") focusProjects();
  else if (hit?.kind === "floor") {
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
    setSelected(false);
    returnPose = null;
    travelTo({ position, quaternion: camera.quaternion.clone() });
    announce("Desplazándote al punto seleccionado de la sala.");
  }
}
function hover(x, y) {
  canvas.classList.toggle(
    "is-over-project",
    ["project", "folder"].includes(pick(x, y)?.kind),
  );
}
function updateHotspot() {
  drawer.getWorldPosition(projected);
  projected.y += 0.01;
  projected.z += 0.06;
  projected.project(camera);
  hotspot.hidden =
    selected ||
    projected.z < -1 ||
    projected.z > 1 ||
    Math.abs(projected.x) > 0.93 ||
    Math.abs(projected.y) > 0.83;
  hotspot.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px,${(-projected.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
}
function renderFrame(time) {
  frame = 0;
  if (!ready || failed || document.hidden) return;
  const dt = Math.min((time - (lastTime || time)) / 1000, 0.1);
  lastTime = time;
  const moving = navigation.update(dt);
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
  if (drawerMotion) {
    const t = Math.min(1, (time - drawerMotion.start) / drawerMotion.duration),
      ease = 1 - Math.pow(1 - t, 3);
    drawer.position.z = THREE.MathUtils.lerp(
      drawerMotion.from,
      drawerMotion.to,
      ease,
    );
    renderer.shadowMap.needsUpdate = true;
    if (t === 1) drawerMotion = null;
  }
  folderObjects.forEach(
    (card) => (card.visible = drawer.position.z > drawerClosedZ + 0.05),
  );
  room.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  updateHotspot();
  renderer.render(scene, camera);
  if (moving || journey || drawerMotion) invalidate();
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
  projects.forEach((project, i) => {
    const height = 0.23 + i * 0.027;
    const folder = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, height, 0.004),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(project.color).lerp(paper, 0.65),
        roughness: 0.95,
      }),
    );
    board.position.y = height / 2;
    board.castShadow = true;
    board.receiveShadow = true;
    const tab = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.03, 0.004),
      new THREE.MeshStandardMaterial({ color: project.color, roughness: 0.9 }),
    );
    tab.position.set(-0.12 + (i % 3) * 0.12, height + 0.015, 0);
    tab.castShadow = true;
    folder.add(board, tab);
    folder.position.set(0, -0.03, -0.1 - i * 0.028);
    folder.rotation.x = -0.08;
    folder.visible = false;
    folder.userData.projectIndex = i;
    drawer.add(folder);
    folderObjects.push(folder);
  });
}
function showError(message) {
  failed = true;
  ready = false;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  navigation?.dispose();
  viewport.classList.remove("is-ready");
  viewport.setAttribute("aria-busy", "false");
  canvas.hidden = true;
  $("#scenePoster").hidden = false;
  hotspot.hidden = true;
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    scene = new THREE.Scene();
    scene.background = new THREE.Color("#e8e9e3");
    const pmrem = new THREE.PMREMGenerator(renderer);
    const environment = new RoomEnvironment();
    scene.environment = pmrem.fromScene(environment, 0.04).texture;
    scene.environmentIntensity = 0.45;
    environment.dispose();
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight("#ffffff", "#a4ad8a", 1.2));
    const key = new THREE.DirectionalLight("#fffef7", 2.5);
    key.position.set(-2.2, 2.45, 4);
    key.target.position.set(0, 1, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -4.2,
      right: 4.2,
      top: 4,
      bottom: -4,
      near: 0.1,
      far: 14,
    });
    key.shadow.bias = -0.0002;
    key.shadow.normalBias = 0.008;
    scene.add(key, key.target);
    const fill = new THREE.DirectionalLight("#f6f9f3", 0.7);
    fill.position.set(3, 2, 3);
    scene.add(fill);
    camera = new THREE.PerspectiveCamera(
      config.camera.fov,
      innerWidth / innerHeight,
      0.025,
      50,
    );
    camera.position.fromArray(config.camera.position);
    camera.quaternion.fromArray(config.camera.quaternion);
    const gltf = await new GLTFLoader().loadAsync(
      "assets/models/room.glb",
      (event) => {
        if (event.total)
          $("#loadingText").textContent =
            `Preparando la sala… ${Math.round((event.loaded / event.total) * 100)} %`;
      },
    );
    room = gltf.scene;
    scene.add(room);
    drawer = room.getObjectByName(config.projectDrawer);
    if (!drawer) throw new Error("Project drawer unavailable");
    room.updateMatrixWorld(true);
    const batches = new Map();
    room.traverse((object) => {
      if (!object.isMesh) return;
      let parent = object.parent,
        owner = null;
      while (parent) {
        if (parent.name.startsWith("CAJON_")) {
          owner = parent;
          break;
        }
        parent = parent.parent;
      }
      object.receiveShadow = true;
      object.castShadow = Boolean(owner);
      // Repeated closed drawers share one draw call per material. The
      // interactive drawer stays separate so it can move and be raycast.
      if (owner && owner !== drawer) {
        const key = object.geometry.uuid + "_" + object.material.uuid;
        if (!batches.has(key))
          batches.set(key, { sample: object, matrices: [] });
        batches.get(key).matrices.push(object.matrixWorld.clone());
        object.visible = false;
      }
    });
    for (const { sample, matrices } of batches.values()) {
      const instances = new THREE.InstancedMesh(
        sample.geometry,
        sample.material,
        matrices.length,
      );
      instances.name = "Closed_Drawers";
      instances.castShadow = true;
      instances.receiveShadow = true;
      matrices.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
      instances.computeBoundingSphere();
      room.add(instances);
    }
    drawerClosedZ = drawer.position.z;
    addFolders();
    navigation = new RoomNavigation(camera, canvas, config.walkBounds, {
      onChange: invalidate,
      onInput: userInput,
      onTap: tap,
      onHover: hover,
    });
    resize();
    // Compile before dismissing the loading state, so the first interaction
    // is not spent waiting for materials and shadows to initialize.
    await renderer.compileAsync(scene, camera);
    ready = true;
    failed = false;
    renderer.shadowMap.needsUpdate = true;
    renderFrame(performance.now());
    viewport.classList.add("is-ready");
    viewport.setAttribute("aria-busy", "false");
    $("#loadingState").hidden = true;
    $("#scenePoster").hidden = true;
    $("#resetCamera").disabled = false;
    $("#focusProjects").disabled = false;
    $("#walkControls").hidden = false;
    announce(
      "Sala lista. Arrastra para mirar, usa las flechas para caminar o selecciona Proyectos.",
    );
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
// Native dialog keeps project information available without any 3D pointer use.
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
$("#focusProjects").addEventListener("click", focusProjects);
$("#resetCamera").addEventListener("click", resetCamera);
$("#backToExplore").addEventListener("click", () => backToExplore());
$("#closeDrawerPanel").addEventListener("click", () => backToExplore());
$("#toggleDrawer").addEventListener("click", () => setDrawer(!isOpen));
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
  if (event.key === "Escape" && !projectDialog.open && selected) {
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
  if (reduced.matches && journey) {
    camera.position.copy(journey.to.position);
    camera.quaternion.copy(journey.to.quaternion);
    journey = null;
  }
  if (reduced.matches && drawerMotion) {
    drawer.position.z = drawerMotion.to;
    drawerMotion = null;
    renderer.shadowMap.needsUpdate = true;
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
  let drawerTarget = null;
  if (drawer && camera) {
    camera.updateMatrixWorld();
    const point = drawer
      .localToWorld(new THREE.Vector3(0.2, 0, 0.02))
      .project(camera);
    drawerTarget = {
      x: (point.x * 0.5 + 0.5) * innerWidth,
      y: (-point.y * 0.5 + 0.5) * innerHeight,
    };
  }
  return {
    drawerTarget,
    ready,
    selected,
    isOpen,
    camera: camera
      ? {
          position: camera.position.toArray(),
          quaternion: camera.quaternion.toArray(),
        }
      : null,
    drawerZ: drawer?.position.z,
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
