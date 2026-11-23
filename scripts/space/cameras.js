import * as THREE from "three";
import { applyReveal } from "./reveal.js";

/**
 * The wall facing the archive (the entrance wall) is covered with security
 * cameras, the owner's model (assets/models/camera.glb, prepared by
 * tools/prepare_camera.py): a fixed `Base` (wall plate and curved arm) and
 * a `Head` (housing, sunshield, lens, LED, cable) turning on its ball joint.
 *
 * They watch the visitor: the point under the cursor, or — with no cursor,
 * on a phone, or when the mouse rests — the visitor themself, and where a
 * finger touches. Each head turns on a damped spring and sees the target a
 * moment later than its neighbours, so they react one after another.
 *
 * Everything is instanced: one draw call per material (14), ~5,500
 * triangles per camera. Lit by the room's panorama, they follow the light
 * of the room (the Ctrl key) and the construction wave (applyReveal).
 */
const WALL_Z = 7.192; // inner face of the entrance wall
const PLATE = 0.198; // the model's wall plate lies this far behind its origin
const COLS = 8,
  ROWS = 5;
const X0 = -2.73,
  X1 = 2.73; // centres of the outer columns
const Y0 = 0.52,
  Y1 = 2.2; // heights of the lowest and highest rows
const YAW = THREE.MathUtils.degToRad(70);
const PITCH_UP = THREE.MathUtils.degToRad(30),
  PITCH_DOWN = THREE.MathUtils.degToRad(48);
const MOUSE_HOLD = 4; // seconds a resting cursor is still watched
const TOUCH_HOLD = 2.5; // seconds a touched point is watched

let seed = 23;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function wallMaterial(source, key) {
  const m = source.clone();
  m.onBeforeCompile = (shader) => applyReveal(shader);
  m.customProgramCacheKey = () => `efedegam-camera-${key}`;
  if (m.name === "led") {
    // A small red recording light, also seen in the dark.
    m.emissive = new THREE.Color("#ff2a1a");
    m.emissiveIntensity = 2.2;
    m.toneMapped = false;
  }
  return m;
}

/** Soft contact shadow on the wall behind each camera (no real-time lights). */
function shadowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.5, "rgba(0,0,0,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Instanced meshes, one per material of a node (GLTFLoader makes a child per primitive). */
function instanced(node, count, key) {
  const parts = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const mesh = new THREE.InstancedMesh(o.geometry, wallMaterial(o.material, `${key}-${o.material.name}`), count);
    mesh.name = `Camera_${key}_${o.material.name}`;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    if (o.material.transparent) mesh.renderOrder = 2;
    parts.push(mesh);
  });
  return parts;
}

/**
 * @param scene  three.js scene
 * @param gltf   the loaded camera.glb
 */
export function createCameraWall(scene, gltf) {
  const baseNode = gltf.scene.getObjectByName("Base");
  const headNode = gltf.scene.getObjectByName("Head");
  const pivot = headNode.position.clone();
  headNode.position.set(0, 0, 0);
  const count = COLS * ROWS;
  const group = new THREE.Group();
  group.name = "Camera_Wall";
  const bases = instanced(baseNode, count, "base");
  const heads = instanced(headNode, count, "head");
  group.add(...bases, ...heads);

  // Mounts: a dense regular grid, as in the owner's photograph.
  const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const cams = [];
  const m = new THREE.Matrix4();
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const origin = new THREE.Vector3(
        X0 + ((X1 - X0) * c) / (COLS - 1),
        Y0 + ((Y1 - Y0) * r) / (ROWS - 1),
        WALL_Z - PLATE,
      );
      const mount = new THREE.Matrix4().compose(origin, facing, new THREE.Vector3(1, 1, 1));
      const joint = pivot.clone().applyMatrix4(mount);
      cams.push({
        mount,
        joint,
        yaw: (rnd() - 0.5) * 0.6,
        pitch: (rnd() - 0.5) * 0.3,
        vy: 0,
        vp: 0,
        seen: joint.clone().add(new THREE.Vector3(0, -0.4, -2)),
        lag: 0.08 + rnd() * 0.32, // seconds: each camera reacts a little later
        jitter: new THREE.Vector3((rnd() - 0.5) * 0.25, (rnd() - 0.5) * 0.18, 0),
      });
    }
  cams.forEach((cam, i) => bases.forEach((b) => b.setMatrixAt(i, cam.mount)));

  // Contact shadows on the wall.
  const shadowGeo = new THREE.PlaneGeometry(0.5, 0.42);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTexture(),
    transparent: true,
    depthWrite: false,
    color: 0xffffff,
  });
  shadowMat.onBeforeCompile = (shader) => applyReveal(shader);
  shadowMat.customProgramCacheKey = () => "efedegam-camera-shadow";
  const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, count);
  shadows.name = "Camera_Shadows";
  cams.forEach((cam, i) => {
    const p = cam.mount.elements;
    m.compose(
      new THREE.Vector3(p[12], p[13] - 0.04, WALL_Z - 0.003),
      facing,
      new THREE.Vector3(1, 1, 1),
    );
    shadows.setMatrixAt(i, m);
  });
  group.add(shadows);
  scene.add(group);

  // Where to look.
  const target = new THREE.Vector3(0, 1.4, 4);
  const pointer = { ray: new THREE.Ray(), at: -1e9, hold: MOUSE_HOLD };
  const frustum = new THREE.Frustum();
  const wallBox = new THREE.Box3(
    new THREE.Vector3(-3.4, 0.2, WALL_Z - 0.6),
    new THREE.Vector3(3.4, 2.6, WALL_Z),
  );
  const tmp = new THREE.Vector3(),
    local = new THREE.Vector3(),
    inv = new THREE.Matrix4(),
    qYaw = new THREE.Quaternion(),
    qPitch = new THREE.Quaternion(),
    qHead = new THREE.Quaternion(),
    one = new THREE.Vector3(1, 1, 1),
    Y = new THREE.Vector3(0, 1, 0),
    X = new THREE.Vector3(1, 0, 0),
    headM = new THREE.Matrix4();
  let clock = 0,
    visible = false,
    speed = 0;

  function aim(camera) {
    const age = clock - pointer.at;
    if (age < pointer.hold) {
      // The point under the cursor: 1.4 m in front of the wall when the
      // visitor faces it; otherwise a little ahead of them, where they point.
      const { origin, direction } = pointer.ray;
      const t = direction.z > 0.05 ? (WALL_Z - 1.4 - origin.z) / direction.z : -1;
      if (t > 0 && t < 12) target.copy(direction).multiplyScalar(t).add(origin);
      else target.copy(direction).multiplyScalar(1.6).add(origin);
    } else target.copy(camera.position); // the visitor themself
    target.x = THREE.MathUtils.clamp(target.x, -3.2, 3.2);
    target.y = THREE.MathUtils.clamp(target.y, 0.1, 2.6);
    target.z = THREE.MathUtils.clamp(target.z, 0.3, WALL_Z - 0.6);
  }

  function place(cam, i) {
    qYaw.setFromAxisAngle(Y, cam.yaw);
    qPitch.setFromAxisAngle(X, -cam.pitch);
    qHead.copy(qYaw).multiply(qPitch);
    headM.compose(pivot, qHead, one).premultiply(cam.mount);
    heads.forEach((h) => h.setMatrixAt(i, headM));
  }
  cams.forEach(place);

  return {
    group,
    count,
    /** The cursor's (or a touch's) ray from the visitor's camera. */
    setPointer(ray, kind = "mouse") {
      pointer.ray.copy(ray);
      pointer.at = clock;
      pointer.hold = kind === "touch" ? TOUCH_HOLD : MOUSE_HOLD;
    },
    /** Returns true while the heads are still turning (keep drawing). */
    update(dt, { camera, reduced = false }) {
      clock += dt;
      frustum.setFromProjectionMatrix(
        headM.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
      );
      visible = frustum.intersectsBox(wallBox);
      if (!visible) {
        speed = 0;
        return false;
      }
      aim(camera);
      let moving = clock - pointer.at < pointer.hold + 0.1;
      let sum = 0;
      const omega = 9,
        zeta = 0.72;
      cams.forEach((cam, i) => {
        // Each camera sees the target a little later than the others.
        const k = reduced ? 1 : 1 - Math.exp(-dt / cam.lag);
        cam.seen.lerp(tmp.copy(target).add(cam.jitter), k);
        inv.copy(cam.mount).invert();
        local.copy(cam.seen).applyMatrix4(inv).sub(pivot);
        const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -YAW, YAW);
        const pitch = THREE.MathUtils.clamp(
          Math.atan2(local.y, Math.hypot(local.x, local.z)),
          -PITCH_DOWN,
          PITCH_UP,
        );
        if (reduced) {
          cam.yaw = yaw;
          cam.pitch = pitch;
          cam.vy = cam.vp = 0;
        } else {
          const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
          const h = dt / steps;
          for (let s = 0; s < steps; s++) {
            cam.vy += (omega * omega * (yaw - cam.yaw) - 2 * zeta * omega * cam.vy) * h;
            cam.vp += (omega * omega * (pitch - cam.pitch) - 2 * zeta * omega * cam.vp) * h;
            cam.yaw += cam.vy * h;
            cam.pitch += cam.vp * h;
          }
        }
        sum += Math.abs(cam.vy) + Math.abs(cam.vp);
        if (
          Math.abs(cam.vy) + Math.abs(cam.vp) > 0.004 ||
          Math.abs(yaw - cam.yaw) + Math.abs(pitch - cam.pitch) > 0.002
        )
          moving = true;
        place(cam, i);
      });
      speed = sum / cams.length;
      heads.forEach((h) => (h.instanceMatrix.needsUpdate = true));
      return moving;
    },
    /** For tests and the servo sound. */
    get state() {
      const n = cams.length;
      return {
        count: n,
        visible,
        speed,
        yaw: cams.reduce((a, c) => a + c.yaw, 0) / n,
        pitch: cams.reduce((a, c) => a + c.pitch, 0) / n,
      };
    },
  };
}
