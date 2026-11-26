import * as THREE from "three";
import { GLTFLoader } from "../../vendor/three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "../../vendor/three/addons/utils/BufferGeometryUtils.js";
import { MeshoptDecoder } from "../../vendor/three/addons/libs/meshopt_decoder.module.js";
import { RoomNavigation } from "./navigation.js";
import { projects } from "../projects.js";
import { specialDrawers } from "../drawers.js";
import { about } from "../about.js";
import { buildFolders } from "./folders.js";
import {
  BUILD,
  BUILD_ZONES,
  applyReveal,
  flickerPanels,
  createReveal,
  patchCeiling,
  revealState,
  switchLights,
  updateLights,
  lightsState,
  sharedUniforms,
} from "./reveal.js";
import { createIvy, PLANTIMANIA_URL } from "./ivy.js";
import { createFigure } from "./figure.js";
import { addDrawerLabels } from "./labels.js";
import { createCeilingGlow } from "./glow.js";
import { createSound } from "./sound.js";
import { createOrb } from "./orb.js";
import { createCameraWall } from "./cameras.js";
import { createBust } from "./bust.js";

const $ = (selector) => document.querySelector(selector);

/*
 * Loading starts as soon as the module runs: the room's configuration is
 * requested at once (index.html preloads it and the heavy files), and the
 * person of light is computed in a worker while the room downloads.
 */
const configRequest = fetch("assets/models/room.json");
const sound = createSound();
const figurePoints = new Promise((resolve) => {
  try {
    const worker = new Worker(new URL("./points-worker.js", import.meta.url), {
      type: "module",
    });
    const done = (data) => {
      worker.terminate();
      resolve(data);
    };
    worker.onmessage = ({ data }) => done(data);
    worker.onerror = () => done(null); // computed on the main thread instead
  } catch {
    resolve(null);
  }
});
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
let folders = null; // kraft folders of drawer 023 (scripts/space/folders.js)
let figure = null; // a person made of light points, at the centre (scripts/space/figure.js)
let aboutOpen = false; // «Sobre mí»: zoomed to the bust of the person of light
let cameraWall = null;
let bustObject = null; // the iridescent bust that rises out of drawer C11_F05 (scripts/space/bust.js)
const BUST_DRAWER = "C11_F05"; // «El vacío» // security cameras on the entrance wall (scripts/space/cameras.js)
let ivy = null; // PLANTIMANÍA (scripts/space/ivy.js)
let ivyLeft = false; // tests: reached the green, stayed here (?sinsalida)
let labelCount = 0; // stickers and name cards on the named drawers
let wallTitle = null; // EFEDEGAM written across the archive, behind the figure
let reveal = null; // the archive building itself (scripts/space/reveal.js)
const FIGURE_AT = new THREE.Vector3(0, 0, 3.35); // centre of the room

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
/*
 * Drawers run on ball-bearing slides: a hand pulls them along a smooth
 * path (`lead`, zero speed and acceleration at both ends) and the drawer,
 * with its mass, follows it through a damped spring. It starts gently,
 * glides, and settles at its stop with a few millimetres of give.
 */
// Opening settles with a few millimetres of give; closing is critically
// damped, like a soft-close slide, so it never knocks on the frame.
const SLIDE = {
  open: 0.62,
  close: 0.6,
  omega: 17,
  zetaOpen: 0.72,
  zetaClose: 1,
};
const smootherstep = (t) => t * t * t * (t * (6 * t - 15) + 10);
function animateDrawer(d, target) {
  d.target = target;
  if (reduced.matches) {
    setOffset(d, target);
    Object.assign(d, {
      lead: target,
      v: 0,
      acc: 0,
      motion: null,
      active: false,
    });
  } else {
    const share = Math.min(1, Math.abs(target - d.lead) / config.drawerTravel);
    const base = target > d.lead ? SLIDE.open : SLIDE.close;
    d.motion = {
      from: d.lead,
      to: target,
      start: performance.now(),
      duration: base * (0.55 + 0.45 * share) * 1000,
    };
    d.active = true;
  }
  invalidate();
}
/** Advances one drawer; returns true while it still moves. */
function stepDrawer(d, time, dt) {
  if (d.motion) {
    const t = Math.min(1, (time - d.motion.start) / d.motion.duration);
    d.lead = THREE.MathUtils.lerp(d.motion.from, d.motion.to, smootherstep(t));
    if (t === 1) d.motion = null;
  }
  const { omega } = SLIDE;
  const zeta = d.target > 0.001 ? SLIDE.zetaOpen : SLIDE.zetaClose;
  const max = config.drawerTravel + 0.004;
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  let x = d.offset,
    v = d.v,
    a = 0;
  for (let i = 0; i < steps; i++) {
    a = omega * omega * (d.lead - x) - 2 * zeta * omega * v;
    v += a * h;
    x += v * h;
    // The frame and the slide stops: soft bumpers, not walls.
    if (x < 0) {
      if (v < -0.05) d.knock = Math.max(d.knock ?? 0, -v);
      [x, v] = [0, v < 0 ? -v * 0.2 : v];
    }
    if (x > max) [x, v] = [max, v > 0 ? -v * 0.2 : v];
  }
  d.v = v;
  d.acc = a;
  if (!d.motion && Math.abs(x - d.lead) < 2e-4 && Math.abs(v) < 2e-3) {
    x = d.lead;
    d.v = d.acc = 0;
    d.active = false;
  }
  // Closing: the front meets the frame (bumper above, or settling at 0).
  if (d.target === 0 && x === 0 && d.offset > 0 && !d.knock) d.knock = Math.abs(v) + 0.1;
  if (x !== d.offset) setOffset(d, x);
  return d.active;
}
const isOpen = (d) => d.target > 0.001;
function toggleDrawer(d, open = !isOpen(d)) {
  animateDrawer(d, open ? config.drawerTravel * (d.special ? 1 : 0.82) : 0);
  return open;
}

/* ------------------------------------------------------------------ */
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
/** Where the entrance stops: through the figure, in front of the archive. */
function arrivalPose() {
  return {
    position: new THREE.Vector3(0, 1.28, 2.95), // just past the figure
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
  const plantKind = d.special?.kind === "plant";
  $("#drawerPanel > p").textContent = projectsKind
    ? open
      ? "Elige una carpeta para consultar su ficha."
      : "Abre el cajón para descubrir las carpetas del archivo."
    : plantKind
      ? open
        ? "La hiedra se escapa. Vuelve a pulsar el cajón para dejarla crecer."
        : "Abre el cajón: algo crece dentro."
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
  updatePanel();
  invalidate();
}
function focusDrawer(d) {
  if (!ready || projectDialog.open || intro) return;
  if (aboutOpen) closeAbout({ restore: false });
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
    "Explorando la sala. Arrastra para mirar; camina con el teclado o tocando el suelo.",
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
  if (!ready || (ivy && ivy.stage >= 2)) return;
  if (ivy?.stage === 1) ivy.retreat(performance.now());
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
  // The bust's drawer: the camera eases a little backwards as it opens, so
  // the bust has room to rise out of it.
  if (open && selected.id === BUST_DRAWER) {
    // Read the camera once the approach has arrived (it takes ~0.9 s).
    setTimeout(() => {
      if (!selected || selected.id !== BUST_DRAWER || !isOpen(selected)) return;
      const back = new THREE.Vector3();
      camera.getWorldDirection(back);
      const position = camera.position.clone().addScaledVector(back, -0.32);
      travelTo({ position, quaternion: camera.quaternion.clone() }, 1100);
    }, 1000);
  }
  const projectsKind = selected.special?.kind === "projects";
  if (selected.special?.kind === "plant" && ivy) {
    if (open) ivy.grow(performance.now(), reduced.matches);
    else ivy.retreat(performance.now());
    invalidate();
    announce(
      open
        ? "Plantimanía: una hiedra pixelada sale del cajón y trepa por los cajones vecinos. Vuelve a pulsar el cajón para dejarla crecer."
        : "Cajón cerrado. La hiedra vuelve a su sitio.",
    );
    return;
  }
  announce(
    open
      ? projectsKind
        ? "Cajón abierto. Elige una de las seis carpetas."
        : `Cajón «${selected.special.name}» abierto. Su contenido está en preparación.`
      : "Cajón cerrado.",
  );
}

/** PLANTIMANÍA, second press: the ivy takes the room, then the camera. */
function invadeRoom() {
  if (!ivy || ivy.stage !== 1) return;
  ivy.invade(performance.now(), reduced.matches);
  setSelected(null);
  returnPose = null;
  navigation.setEnabled(false);
  // Step back to the middle of the room to watch it spread.
  const position = new THREE.Vector3(0, 1.45, 4.6);
  const target = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(
      position,
      new THREE.Vector3(0, 1.55, 0),
      camera.up,
    ),
  );
  travelTo({ position, quaternion: target }, 3200);
  announce(
    "La hiedra invade la sala y lo cubre todo de verde. Después se abre Plantimanía.",
  );
}
function leaveForPlantimania() {
  if (new URLSearchParams(location.search).has("sinsalida")) {
    ivyLeft = true; // tests: stay on the green
    return;
  }
  location.assign(PLANTIMANIA_URL);
}

/* ------------------------------------------------------------------ */
/* Picking                                                              */
/* ------------------------------------------------------------------ */
/** Distance along `ray` to the person of light (a 26 cm cylinder), or null. */
function figureHit(ray) {
  const { origin: o, direction: d } = ray;
  const ox = o.x - FIGURE_AT.x,
    oz = o.z - FIGURE_AT.z;
  const a = d.x * d.x + d.z * d.z;
  if (a < 1e-8) return null;
  const b = 2 * (ox * d.x + oz * d.z),
    c = ox * ox + oz * oz - 0.26 * 0.26;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  if (t < 0.3) return null; // not when walking through it
  const y = o.y + d.y * t;
  return y > 0.05 && y < 1.86 ? t : null;
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
  // The person of light opens «Sobre mí» (its points leave gaps: a cylinder).
  const tFigure = figure?.object.parent ? figureHit(raycaster.ray) : null;
  if (tFigure !== null && (!hit || tFigure < hit.distance)) return { kind: "figure" };
  if (!hit) return null;
  // A sticker or name card belongs to its drawer.
  for (let o = hit.object; o; o = o.parent)
    if (o.name.startsWith("Label_")) {
      const d = drawerById.get(o.name.slice(6));
      if (d) return { kind: "drawer", drawer: d };
    }
  const folder = folders?.projectAt(hit);
  if (folder !== null && folder !== undefined)
    return folder >= 0 && isOpen(projectDrawer) && selected === projectDrawer
      ? { kind: "folder", index: folder }
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
  if (ivy && ivy.stage >= 2) return; // the ivy has the room now
  const hit = pick(clientX, clientY);
  // The cameras turn to the touched point for a moment.
  cameraWall?.setPointer(raycaster.ray, "touch");
  if (aboutOpen) return closeAbout(); // a tap beside the text goes back
  if (hit?.kind === "figure") return openAbout();
  if (hit?.kind === "folder") openProject(hit.index);
  else if (hit?.kind === "drawer") {
    const d = hit.drawer;
    if (d.special) {
      if (selected === d && d.special.kind === "plant" && ivy?.stage === 1)
        invadeRoom();
      else if (selected === d) setSelectedDrawer(!isOpen(d));
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
  figure?.setPointer(raycaster.ray);
  cameraWall?.setPointer(raycaster.ray, "mouse");
  folders?.setHovered(hit?.kind === "folder" ? hit.index : -1);
  invalidate();
  canvas.classList.toggle(
    "is-over-project",
    !aboutOpen &&
      (hit?.kind === "folder" || hit?.kind === "drawer" || hit?.kind === "figure"),
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
  const hide = Boolean(selected) || Boolean(intro) || aboutOpen;
  placeTag(hotspot, projectDrawer, hide);
  if (figure) {
    projected.set(FIGURE_AT.x, 1.6, FIGURE_AT.z).project(camera);
    aboutHotspot.hidden = hide || projected.z > 1 || Math.abs(projected.x) > 0.93 || Math.abs(projected.y) > 0.83;
    aboutHotspot.style.transform = `translate(${(projected.x * 0.5 + 0.5) * innerWidth}px,${(-projected.y * 0.5 + 0.5) * innerHeight}px) translate(-50%,-50%)`;
  }
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
  drawers.forEach((d) => (d.jolted = false));
  room.updateMatrixWorld(true);
  const centre = projectDrawer.node.getWorldPosition(new THREE.Vector3());
  centre.z += 0.05; // the wave is born at the front of drawer 023
  reveal = createReveal(scene, revealMeshes(), centre);
  // The entrance sound (burst, wave, tubes by zone) is anchored to this
  // instant: if the audio only starts later, it joins where the room is.
  if (!reduced.matches) sound.intro(intro.start, BUILD_ZONES);
  document.body.classList.add("is-intro");
  $("#introTitle").hidden = false;
  $("#skipIntro").hidden = false;
  announce("EFEDEGAM. Entrando en el archivo. Pulsa Saltar para empezar.");
  invalidate();
}
function finishIntro() {
  if (!intro) return;
  const to = intro.to;
  intro = null;
  reveal?.finish();
  reveal = null;
  setWallTitle(0);
  camera.position.copy(to.position);
  camera.quaternion.copy(to.quaternion);
  drawers.forEach((d) => {
    if (isOpen(d)) return;
    setOffset(d, 0);
    Object.assign(d, { lead: 0, v: 0, acc: 0, active: false });
  });
  document.body.classList.remove(
    "is-intro",
    "intro-show-title",
    "intro-rushing",
  );
  $("#introTitle").hidden = true;
  $("#skipIntro").hidden = true;
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
  const total = intro.frozen ?? time - intro.start;
  const { from, creep, to } = intro;
  const { hold, rush, brake } = INTRO;
  // 00 · Construction: the archive builds itself from drawer 023.
  if (total < BUILD) {
    reveal?.update(total);
    camera.position.copy(from.position);
    camera.quaternion.copy(from.quaternion);
    // The figure gathers while the room is still dark, then the lights come on.
    intro.assemble = Math.min(1, Math.max(0, (total - 1200) / 1300));
    setWallTitle(0);
    return;
  }
  if (reveal && !reveal.finished) {
    reveal.finish();
    document.body.classList.add("intro-show-title");
  }
  intro.assemble = 1;
  const t = total - BUILD;
  // 02 · Identity: EFEDEGAM appears on the archive, behind the figure; the
  // rush carries the camera through the figure towards it.
  setWallTitle(
    t < hold + rush
      ? Math.min(1, Math.max(0, (t - 500) / 900)) *
          (1 - Math.min(1, Math.max(0, (t - hold) / (rush * 0.75))))
      : 0,
  );
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
    // The wall takes the impact: a ripple of small, damped impulses. Each
    // drawer slides out a centimetre or so and taps softly back on its frame.
    for (const d of drawers) {
      if (isOpen(d) || d.jolted || s < d.ripple * 0.32) continue;
      d.jolted = true;
      d.v += d.jolt * 17;
      d.active = true;
    }
  } else return finishIntro();
}

const figureFrustum = new THREE.Frustum();
const figureMatrix = new THREE.Matrix4();
/** Room meshes the construction draws in lines (closed drawers included). */
function revealMeshes() {
  const list = [];
  room.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const owner = `${o.name} ${o.parent?.name ?? ""}`;
    if (
      /Room_Architecture|Archive_Structure|Ceiling_Lights|Archive_Drawers/.test(
        owner,
      ) ||
      /LUZ_ZONA/.test(o.material.name)
    )
      list.push(o);
  });
  return list;
}
/** EFEDEGAM across the archive wall, as a sign painted on air. */
function createWallTitle() {
  const c = document.createElement("canvas");
  c.width = 2048;
  c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#24382c";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";
  g.font = '700 300px "DM Sans", sans-serif';
  g.letterSpacing = "-12px";
  g.fillText("EFEDEGAM", 1024, 330);
  g.letterSpacing = "26px";
  g.font = '500 44px "DM Mono", monospace';
  g.fillText("ARCHIVO PERSONAL", 1024, 450);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 1.2),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.name = "Wall_Title";
  mesh.position.set(0, 1.42, 0.07); // just in front of the drawer fronts
  mesh.renderOrder = 3;
  mesh.visible = false;
  return mesh;
}
function setWallTitle(opacity) {
  if (!wallTitle) return;
  wallTitle.material.opacity = opacity;
  wallTitle.visible = opacity > 0.002;
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
  let drawerMoving = false,
    drawerSpeed = 0,
    closing = false;
  for (const d of drawers) {
    if (d.active && stepDrawer(d, time, dt)) drawerMoving = true;
    if (d.active) drawerSpeed = Math.max(drawerSpeed, Math.abs(d.v));
    if (d.knock) {
      closing = !intro; // the entrance's jolts stay silent
      d.knock = 0;
    }
  }
  if (ivy && ivy.update(time)) drawerMoving = true;
  // The light switch: tubes going out (or coming on) one by one.
  if ((!reveal || reveal.finished) && lightsChanging)
    lightsChanging = updateLights(time);
  if (lightsChanging) drawerMoving = true;
  if (figure) {
    const state = revealState();
    const animating = figure.update(dt, {
      camera,
      viewportHeight: renderer.domElement.height,
      assemble: intro?.assemble ?? 1,
      // In the dark (construction, or the Ctrl key) the figure glows.
      luminous:
        reveal && !reveal.finished
          ? 1 - (state.power - 0.1) / 0.9
          : Math.min(1, Math.max(0, (1 - state.power) / 0.97)),
      reduced: reduced.matches,
      part: aboutOpen ? 0 : 1,
    });
    // It turns forever, but only costs frames while it is on screen.
    figureFrustum.setFromProjectionMatrix(
      figureMatrix.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse,
      ),
    );
    if (animating && figureFrustum.intersectsSphere(figure.bounds))
      drawerMoving = true;
  }
  // The bust rises out of its drawer, floats and hops while it is open.
  const bustDrawer = bustObject && drawerById.get(BUST_DRAWER);
  if (bustObject && bustDrawer) {
    if (
      bustObject.update(
        dt,
        {
          node: bustDrawer.node,
          closedZ: bustDrawer.closedZ,
          offset: bustDrawer.offset,
          travel: config.drawerTravel,
        },
        reduced.matches,
      )
    )
      drawerMoving = true;
  }
  // The camera wall watches the cursor, or the visitor.
  if (cameraWall?.update(dt, { camera, reduced: reduced.matches }))
    drawerMoving = true;
  if (folders) {
    folders.group.visible = projectDrawer.offset > 0.01;
    if (folders.group.visible && folders.update(dt, projectDrawer.acc))
      drawerMoving = true;
  }
  // The hum follows the room's light, once there is a room.
  if (!awaitingEnter) sound.setPower(revealState().power);
  sound.update(dt, {
    drawerSpeed: intro ? 0 : drawerSpeed,
    closing,
    ivyRate: !ivy || !ivy.stage ? 0 : ivy.stage === 1 ? 0.35 : 1,
    figureNear: figure
      ? Math.max(0, 1 - (camera.position.distanceTo(FIGURE_AT) - 0.6) / 5)
      : 0,
    stir: figure?.stir ?? 0,
    servo: cameraWall?.state.speed ?? 0,
  });
  room.updateMatrixWorld(true);
  camera.updateMatrixWorld();
  updateHotspots();
  renderer.render(scene, camera);
  ivy?.render(renderer, camera); // the pixelated ivy, as a mosaic on top
  if (aboutOpen) placeAboutLine();
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
/** Built while the room downloads; attached to drawer 023 once it exists. */
async function prepareFolders() {
  // Labels are drawn with the page's own typeface.
  await document.fonts?.load('500 30px "DM Mono"').catch(() => {});
  const built = buildFolders(projects);
  built.group.visible = false;
  return built;
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
  document.body.classList.remove("is-loading");
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
  $("#drawerPanel").hidden = true;
  $("#backToExplore").hidden = true;
  $("#loadingState").hidden = true;
  $("#sceneError").hidden = false;
  $("#focusProjects").disabled = true;
  $("#resetCamera").disabled = true;
  $("#errorMessage").textContent = message;
  announce(message);
}

/**
 * Technical loader: one percentage and a hairline bar. The number counts
 * smoothly towards the real progress and grows with it (styles/space.css).
 */
let targetProgress = 0,
  shownProgress = 0,
  progressFrame = 0,
  progressTime = 0;
function setProgress(share) {
  // Servers may announce the compressed size while counting decompressed
  // bytes: never show more than 100 %.
  targetProgress = Math.max(targetProgress, Math.min(1, Math.max(0, share)));
  if (!progressFrame) progressFrame = requestAnimationFrame(tickProgress);
}
function tickProgress(time) {
  const dt = Math.min(0.1, (time - (progressTime || time)) / 1000);
  progressTime = time;
  // Eases in (about a quarter of a second behind), never overshoots.
  shownProgress += (targetProgress - shownProgress) * (1 - Math.exp(-dt * 9));
  if (targetProgress - shownProgress < 0.002) shownProgress = targetProgress;
  const value = Math.round(shownProgress * 100);
  $("#loadingText").textContent = `${String(value).padStart(2, "0")} %`;
  $("#loadingText").style.setProperty("--p", shownProgress.toFixed(4));
  $("#loadingBar").style.transform = `scaleX(${shownProgress})`;
  progressFrame =
    shownProgress < targetProgress ? requestAnimationFrame(tickProgress) : 0;
  if (!progressFrame) progressTime = 0;
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
    applyReveal(shader);
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
      if (tune.tint) m.color.setRGB(...tune.tint);
    }
    patchReflections(m);
    cache.set(key, m);
  }
  return cache.get(key);
}
/**
 * The owner's velvet photo (Drive › Recursos, also V20's carpet) replaces the
 * near-black procedural texture of the .blend. It is sized in metres: the
 * scale comes from the floor's own UVs, so it does not depend on the export.
 */
/** The photo and the pile's relief (kept out of the GLB to make it lighter). */
function loadCarpet() {
  const info = config.carpet;
  if (!info) return null;
  const loader = new THREE.TextureLoader();
  return Promise.all([
    loader.loadAsync(`assets/models/${info.file}`),
    info.normal ? loader.loadAsync(`assets/models/${info.normal.file}`) : null,
  ]);
}
function applyCarpet(maps) {
  const info = config.carpet;
  if (!info || !maps) return;
  const [texture, normalMap] = maps;
  let floor = null;
  room.traverse((o) => {
    if (o.isMesh && o.material.name === info.material) floor = o;
  });
  if (!floor) return;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const { position, normal, uv } = floor.geometry.attributes;
  let x0 = Infinity,
    x1 = -Infinity,
    u0 = Infinity,
    u1 = -Infinity;
  for (let i = 0; i < position.count; i++) {
    if (normal.getY(i) < 0.9) continue; // the walkable top face
    x0 = Math.min(x0, position.getX(i));
    x1 = Math.max(x1, position.getX(i));
    u0 = Math.min(u0, uv.getX(i));
    u1 = Math.max(u1, uv.getX(i));
  }
  const uvPerMetre = Math.abs(u1 - u0) / Math.max(1e-6, x1 - x0);
  texture.repeat.setScalar(1 / (uvPerMetre * info.repeatMetres));
  const m = floor.material;
  m.map = texture; // its colour is tinted by materialTuning (room.json)
  if (normalMap) {
    // As GLTFLoader would set it: glTF orientation, linear data, and the
    // sign it already gave normalScale.y for meshes without tangents.
    normalMap.flipY = false;
    normalMap.wrapS = normalMap.wrapT = THREE.RepeatWrapping;
    normalMap.anisotropy = texture.anisotropy;
    m.normalMap = normalMap;
    const scale = info.normal.scale ?? 1;
    m.normalScale.set(scale, Math.sign(m.normalScale.y || 1) * scale);
  }
  m.needsUpdate = true;
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
    m.lightMapIntensity =
      lightmap.intensity *
      (config.materialTuning?.[material.name]?.lightMapScale ?? 1);
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
    const response = await configRequest;
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
    // Every download runs at the same time; the folders are drawn meanwhile.
    const folderBuild = prepareFolders();
    const [gltf, lightmaps, environment, carpet, cameraModel, bustModel] = await Promise.all([
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync("assets/models/room.glb", (event) => {
          if (event.total)
            setProgress(Math.min(1, event.loaded / event.total) * 0.9);
        }),
      loadLightmaps(),
      loadEnvironment(),
      loadCarpet(),
      // The security cameras of the entrance wall (scripts/space/cameras.js).
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync("assets/models/camera.glb")
        .catch(() => null),
      // The bust that rises out of drawer C11_F05 (scripts/space/bust.js).
      new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync("assets/models/bust.glb")
        .catch(() => null),
    ]);
    if (environment) {
      scene.environment = environment.texture;
      scene.environmentIntensity = environment.intensity;
    }
    room = gltf.scene;
    scene.add(room);
    const cache = new Map();
    const ceilingLights = [];
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
      else if (/LUZ_ZONA/.test(object.material.name)) {
        // Brighter than the white walls, so the panels read as the source.
        object.material.emissiveIntensity = config.panelEmission ?? 1;
        patchCeiling(object.material);
        ceilingLights.push(object);
      }
    });
    createCeilingGlow(scene, ceilingLights);
    applyCarpet(carpet);
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
        lead: 0,
        v: 0,
        acc: 0,
        active: false,
        motion: null,
        special: specials.get(d.node.name) ?? null,
        ripple: Math.hypot(c - 7, (f - 6.5) * 1.6) / 9,
        jolt: 0.006 + 0.014 * Math.abs(Math.sin(index * 12.9898) * 0.5 + 0.5),
      });
      drawerById.set(d.id, d);
    });
    projectDrawer = drawerById.get(config.projectDrawer.slice(6));
    if (!projectDrawer) throw new Error("Project drawer unavailable");
    batchDrawers(lightmaps.archive);
    folders = await folderBuild;
    projectDrawer.node.add(folders.group);
    addTags();
    labelCount = addDrawerLabels(drawers);
    const plantDrawer = drawers.find((d) => d.special?.kind === "plant");
    if (plantDrawer)
      ivy = createIvy(scene, plantDrawer, sharedUniforms, {
        onGreen: leaveForPlantimania,
      });
    if (cameraModel) cameraWall = createCameraWall(scene, cameraModel);
    if (bustModel && drawerById.get(BUST_DRAWER)) bustObject = createBust(scene, bustModel);
    figure = createFigure(FIGURE_AT, (await figurePoints) ?? undefined);
    scene.add(figure.object, figure.shadow, figure.pool);
    wallTitle = createWallTitle();
    scene.add(wallTitle);
    navigation = new RoomNavigation(camera, canvas, config.walkBounds, {
      onChange: invalidate,
      onInput: () => (intro ? finishIntro() : userInput()),
      onTap: tap,
      onHover: hover,
    });
    resize();
    // Compile before dismissing the loading state, so the first interaction
    // is not spent waiting for materials to initialize.
    setProgress(0.96);
    await renderer.compileAsync(scene, camera);
    setProgress(1);
    // Let the number reach 100 % (and its full size) before the room shows.
    await new Promise((resolve) => {
      const since = performance.now();
      (function wait() {
        if (shownProgress >= 1 || performance.now() - since > 600) resolve();
        else requestAnimationFrame(wait);
      })();
    });
    if (new URLSearchParams(location.search).has("debug"))
      window.__efedegam = {
        THREE,
        scene,
        renderer,
        camera,
        drawers,
        /** Freeze the PLANTIMANÍA ivy at `seconds` (debug only). */
        ivyAt: (seconds) => ivy?.at(seconds),
        /** Open or close a drawer by id, e.g. `drawer("C11_F05", true)` (debug only). */
        drawer(id, open = true) {
          const d = drawerById.get(id);
          if (!d || !ready || intro) return false;
          focusDrawer(d);
          setSelectedDrawer(open);
          return true;
        },
        /** Make a tube fail now, e.g. `flicker([0])` (debug only). */
        flicker: (panels) => flickerTube(panels),
        /** Draw one complete frame now (debug only). */
        frame: () => renderFrame(performance.now()),
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
    $("#scenePoster").hidden = true;
    $("#resetCamera").disabled = false;
    $("#focusProjects").disabled = false;
    const params = new URLSearchParams(location.search);
    const skip = reduced.matches || params.has("sinintro");
    if (skip) {
      openRoom();
      // Without motion, the visitor sees the validated reference framing.
      announce(
        "Sala lista. Pulsa un cajón para abrirlo, o selecciona Proyectos.",
      );
    } else if (params.has("debug")) {
      // Reviews and frozen frames start the construction at once.
      openRoom();
      startIntro();
    } else awaitEnter();
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

/** The loader steps aside: the room (or its construction) shows. */
function openRoom() {
  awaitingEnter = false;
  document.body.classList.remove("is-loading", "awaiting-enter");
  $("#loadingState").hidden = true;
  $("#enterRoom").hidden = true;
}
/**
 * «Mantener pulsado para abrir»: at 100 % the loader shows a sphere of
 * light (scripts/space/orb.js) exactly where drawer 023 will appear. Held
 * for 3 s — mouse, finger, Space or Enter — it beats ever harder, bursts,
 * and the construction wave is born there. The first press also unlocks
 * the sound (browsers only allow it after a gesture).
 */
let awaitingEnter = false,
  orb = null;
/** Drawer 023's front on screen, as the entrance's first frame shows it. */
function orbPoint() {
  const view = camera.clone();
  const pose = initialPose();
  view.position.copy(pose.position);
  view.quaternion.copy(pose.quaternion);
  view.updateMatrixWorld();
  room.updateMatrixWorld(true);
  const p = projectDrawer.node.getWorldPosition(new THREE.Vector3());
  p.z += 0.05;
  p.project(view);
  const box = canvas.getBoundingClientRect();
  return [box.left + ((p.x + 1) / 2) * box.width, box.top + ((1 - p.y) / 2) * box.height];
}
function placeOrb() {
  if (!orb || !awaitingEnter) return;
  const [x, y] = orbPoint();
  orb.moveTo(x, y);
  const button = $("#enterRoom");
  const box = $("#loadingState").getBoundingClientRect();
  button.style.left = `${x - box.left}px`;
  button.style.top = `${y - box.top}px`;
}
function awaitEnter() {
  awaitingEnter = true;
  document.body.classList.add("awaiting-enter");
  const button = $("#enterRoom");
  const loader = $("#loadingState");
  button.hidden = false;
  orb = createOrb($("#enterOrb"), {
    onHold: (k) => sound.charge(k),
    onOpen: () => {
      cleanup();
      announce("Abriendo el archivo.");
      openRoom();
      startIntro();
      invalidate();
    },
  });
  const [x, y] = orbPoint();
  orb.show(x, y);
  placeOrb();
  // No automatic focus (it would underline the label): Space and Enter work
  // anywhere, and Tab reaches the button.
  announce("Sala preparada. Mantén pulsado tres segundos para abrir.");
  const press = (event) => {
    if (event.type === "keydown") {
      if (event.repeat || !(event.code === "Space" || event.key === "Enter")) return;
      event.preventDefault();
    } else if (event.button > 0) return;
    sound.unlock();
    orb.hold(true);
    button.classList.add("is-holding");
  };
  const release = (event) => {
    if (event.type === "keyup" && !(event.code === "Space" || event.key === "Enter")) return;
    orb.hold(false);
    button.classList.remove("is-holding");
  };
  // A press anywhere on the loader counts, so it does not need precision.
  const listeners = [
    [loader, "pointerdown", press],
    [window, "keydown", press],
    [window, "pointerup", release],
    [window, "pointercancel", release],
    [window, "keyup", release],
    [window, "blur", release],
    [window, "resize", placeOrb],
    [loader, "contextmenu", (e) => e.preventDefault()],
  ];
  listeners.forEach(([t, n, f]) => t.addEventListener(n, f, true));
  function cleanup() {
    listeners.forEach(([t, n, f]) => t.removeEventListener(n, f, true));
    button.classList.remove("is-holding");
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

/* ------------------------------------------------------------------ */
/* «Sobre mí»: the person of light, up close.                          */
/* ------------------------------------------------------------------ */
const aboutPanel = $("#aboutPanel"),
  aboutLine = $("#aboutLine"),
  aboutHotspot = $("#aboutHotspot");
let aboutTimer = 0;
(function fillAbout() {
  $(".about-title-text").textContent = about.title;
  const box = $("#aboutText");
  about.paragraphs.forEach((text, i) => {
    const p = document.createElement("p");
    p.textContent = text;
    p.style.transitionDelay = `${0.75 + i * 0.12}s`;
    box.append(p);
  });
  if (about.provisional) {
    const note = document.createElement("p");
    note.className = "about-note";
    note.textContent = "Texto provisional";
    note.style.transitionDelay = `${0.75 + about.paragraphs.length * 0.12}s`;
    box.append(note);
  }
})();
const bust = () => new THREE.Vector3(FIGURE_AT.x, 1.56, FIGURE_AT.z);
function openAbout() {
  if (!ready || intro || failed || aboutOpen || (ivy && ivy.stage >= 2)) return;
  if (selected) setSelected(null);
  if (!returnPose) returnPose = pose();
  aboutOpen = true;
  navigation.setEnabled(false);
  // Seen from where the visitor stands, at shoulder height; the view is
  // shifted so the bust sits on the left and the text has the right.
  const centre = bust();
  const dir = camera.position.clone().sub(centre);
  dir.y = 0;
  if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
  dir.normalize();
  const phone = innerWidth <= 760 || innerHeight > innerWidth;
  // Close enough for shoulders and head only, whatever the screen: from
  // the real field of view (taller on phones, see resize()).
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const distance = phone ? 0.36 / Math.tan(hHalf) : 0.4 / Math.tan(vHalf);
  const position = centre.clone().addScaledVector(dir, distance);
  position.y = 1.6;
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const look = centre.clone();
  if (phone) look.y -= Math.tan(vHalf) * distance * 0.42; // bust in the upper part
  else look.addScaledVector(right, 0.34);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(position, look, camera.up),
  );
  travelTo({ position, quaternion }, 1300);
  document.body.classList.add("about-open");
  aboutPanel.hidden = false;
  aboutLine.removeAttribute("hidden"); // an SVG element: no .hidden property
  clearTimeout(aboutTimer);
  // The line draws itself once the camera has arrived, then the text.
  aboutTimer = setTimeout(() => {
    placeAboutLine();
    aboutLine.classList.add("is-open");
    aboutPanel.classList.add("is-open");
  }, reduced.matches ? 0 : 1150);
  sound.about?.(true);
  $("#closeAbout").focus({ preventScroll: true });
  announce(`${about.title}. ${about.paragraphs.join(" ")}`);
  invalidate();
}
function closeAbout({ restore = true } = {}) {
  if (!aboutOpen) return;
  aboutOpen = false;
  aboutPanel.classList.remove("is-open");
  aboutLine.classList.remove("is-open");
  document.body.classList.remove("about-open");
  clearTimeout(aboutTimer);
  aboutTimer = setTimeout(() => {
    aboutPanel.hidden = true;
    aboutLine.setAttribute("hidden", "");
  }, reduced.matches ? 0 : 450);
  navigation.setEnabled(true);
  if (restore && returnPose) travelTo(returnPose, 1100);
  returnPose = null;
  sound.about?.(false);
  canvas.focus({ preventScroll: true, focusVisible: false });
  announce("De vuelta en la sala.");
  invalidate();
}
/** The thin line: a point on the bust, a diagonal, then along to the title. */
function placeAboutLine() {
  const w = innerWidth,
    h = innerHeight;
  aboutLine.setAttribute("viewBox", `0 0 ${w} ${h}`);
  // A point on the shoulder facing the text (on the axis side, so it does
  // not dance as the bust turns).
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
  const p = bust().add(new THREE.Vector3(0, -0.06, 0)).addScaledVector(right, 0.12).project(camera);
  const ax = (p.x * 0.5 + 0.5) * w,
    ay = (-p.y * 0.5 + 0.5) * h;
  const title = $(".about-title-text").getBoundingClientRect();
  const phone = w <= 760 || h > w;
  const ex = title.left - (phone ? 0 : 14),
    ey = phone ? title.top - 12 : title.top + title.height * 0.55;
  const elbowX = phone ? ex + 28 : ex - 46,
    elbowY = ey;
  const pts = [[ax, ay], [elbowX, elbowY], [ex, ey]];
  const len = Math.hypot(elbowX - ax, elbowY - ay) + Math.hypot(ex - elbowX, ey - elbowY);
  const line = aboutLine.querySelector("polyline");
  line.setAttribute("points", pts.map((q) => q.map((v) => v.toFixed(1)).join(",")).join(" "));
  line.style.setProperty("--len", len.toFixed(1));
  aboutLine.querySelector("rect").setAttribute("transform", `translate(${ax.toFixed(1)},${ay.toFixed(1)})`);
}
$("#closeAbout").addEventListener("click", () => closeAbout());
aboutHotspot.addEventListener("click", openAbout);
addEventListener("resize", () => aboutOpen && placeAboutLine());
$("#toggleDrawer").addEventListener("click", () =>
  setSelectedDrawer(!isOpen(selected)),
);
$("#retryScene").addEventListener("click", () => location.reload());
addEventListener("keydown", (event) => {
  if (intro && ["Escape", "Enter", " "].includes(event.key)) {
    event.preventDefault();
    finishIntro();
  } else if (event.key === "Escape" && aboutOpen) {
    event.preventDefault();
    closeAbout();
  } else if (event.key === "Escape" && !projectDialog.open && selected) {
    event.preventDefault();
    backToExplore();
  }
});
/* «Ctrl»: the light switch, a real key. Mouse, touch, its own keyboard focus
   and the physical Ctrl key (pressed alone) all give the same keystroke. */
const lightSwitch = $("#lightSwitch");
let lightsChanging = false,
  keyDownAt = 0,
  ctrlArmed = false;
function pressKey(down) {
  sound.keyClick(down);
  if (down) {
    keyDownAt = performance.now();
    lightSwitch.classList.add("is-down");
    return;
  }
  // A tap still shows the key travelling all the way down.
  const held = performance.now() - keyDownAt;
  setTimeout(
    () => lightSwitch.classList.remove("is-down"),
    Math.max(0, 70 - held),
  );
}
function toggleLights() {
  if (!ready || intro || failed) return;
  const on = !lightsState().on;
  sound.tubes(switchLights(on, performance.now(), reduced.matches), on);
  lightsChanging = true;
  lightSwitch.setAttribute("aria-pressed", String(!on));
  document.body.classList.toggle("lights-off", !on);
  const label = on ? "Apagar las luces" : "Encender las luces";
  lightSwitch.setAttribute("aria-label", label);
  lightSwitch.title = `${label} (Ctrl)`;
  announce(
    on
      ? "Luces encendidas."
      : "Luces apagadas. La figura de luz brilla en la oscuridad.",
  );
  invalidate();
}
lightSwitch.addEventListener("pointerdown", () => pressKey(true));
for (const name of ["pointerup", "pointerleave", "pointercancel"])
  lightSwitch.addEventListener(name, () => {
    if (lightSwitch.classList.contains("is-down")) pressKey(false);
  });
lightSwitch.addEventListener("keydown", (event) => {
  if ((event.code === "Space" || event.code === "Enter") && !event.repeat)
    pressKey(true);
});
lightSwitch.addEventListener("keyup", (event) => {
  if (event.code === "Space" || event.code === "Enter") pressKey(false);
});
lightSwitch.addEventListener("click", toggleLights);

/*
 * Every 10 s a random tube fails for a moment (and the room dips with it).
 * Only with the lights on, in a visible tab, outside the entrance and the
 * ivy's invasion, and never with reduced motion.
 */
const FLICKER_EVERY = 10000;
const flickerOff = new URLSearchParams(location.search).has("sinparpadeo");
function flickerTube(panels = null) {
  if (!ready || failed || !lightsState().on) return null;
  const event = flickerPanels(performance.now(), panels);
  lightsChanging = true;
  sound.flicker(event);
  invalidate();
  return event.panels;
}
setInterval(() => {
  if (
    flickerOff ||
    reduced.matches ||
    document.hidden ||
    intro ||
    lightsChanging ||
    (ivy && ivy.stage >= 2)
  )
    return;
  flickerTube();
}, FLICKER_EVERY);

/* Sound: a second key; «M» toggles it too. */
const soundSwitch = $("#soundSwitch");
function showSound() {
  const muted = sound.muted;
  soundSwitch.setAttribute("aria-pressed", String(muted));
  const label = muted ? "Activar el sonido" : "Silenciar el sonido";
  soundSwitch.setAttribute("aria-label", label);
  soundSwitch.title = `${label} (M)`;
}
function toggleSound() {
  sound.setMuted(!sound.muted);
  showSound();
  announce(sound.muted ? "Sonido silenciado." : "Sonido activado.");
}
function pressSoundKey(down) {
  if (down) {
    soundSwitch.classList.add("is-down");
    soundSwitch.dataset.downAt = String(performance.now());
    sound.keyClick(true);
    return;
  }
  const held = performance.now() - Number(soundSwitch.dataset.downAt || 0);
  setTimeout(
    () => soundSwitch.classList.remove("is-down"),
    Math.max(0, 70 - held),
  );
  sound.keyClick(false);
}
showSound();
soundSwitch.addEventListener("pointerdown", () => pressSoundKey(true));
for (const name of ["pointerup", "pointerleave", "pointercancel"])
  soundSwitch.addEventListener(name, () => {
    if (soundSwitch.classList.contains("is-down")) pressSoundKey(false);
  });
soundSwitch.addEventListener("click", toggleSound);
addEventListener("keydown", (event) => {
  if (
    event.code !== "KeyM" ||
    event.repeat ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.target.closest?.("input, textarea, [contenteditable]")
  )
    return;
  pressSoundKey(true);
  toggleSound();
  pressSoundKey(false);
});
addEventListener("keydown", (event) => {
  if (event.key === "Control") {
    if (!event.repeat) {
      ctrlArmed = true;
      pressKey(true);
    }
  } else ctrlArmed = false; // Ctrl+C and friends are not a light switch
});
addEventListener("keyup", (event) => {
  if (event.key !== "Control") return;
  pressKey(false);
  if (ctrlArmed) toggleLights();
  ctrlArmed = false;
});
addEventListener("blur", () => {
  ctrlArmed = false;
  lightSwitch.classList.remove("is-down");
});
addEventListener("resize", resize);
canvas.addEventListener("pointerleave", () => {
  figure?.setPointer(null);
  invalidate();
});
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
      if (!d.active) return;
      setOffset(d, d.target);
      Object.assign(d, {
        lead: d.target,
        v: 0,
        acc: 0,
        motion: null,
        active: false,
      });
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
    reveal: revealState(),
    lights: lightsState(),
    awaitingEnter,
    entrance: orb ? { holding: orb.holding, held: orb.held, opened: orb.opened } : null,
    sound: {
      intro: sound.introState,
      muted: sound.muted,
      created: sound.created,
      running: sound.running,
    },
    ivy: ivy ? { stage: ivy.stage, leaves: ivy.leaves, left: ivyLeft } : null,
    labels: labelCount,
    building: Boolean(reveal && !reveal.finished),
    cameras: cameraWall?.state ?? null,
    bust: bustObject ? { height: bustObject.height } : null,
    about: aboutOpen,
    figure: figure
      ? {
          points: figure.object.geometry.attributes.position.count,
          inScene: Boolean(figure.object.parent),
        }
      : null,
    wallTitle: wallTitle
      ? { visible: wallTitle.visible, opacity: wallTitle.material.opacity }
      : null,
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
