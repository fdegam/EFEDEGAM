import * as THREE from "three";
import {
  PANEL_GLSL,
  lightUniforms,
  sharedUniforms,
  zoneLight,
} from "./reveal.js";

/**
 * The ceiling panels read as lights, not just bright surfaces: each one
 * gets a soft halo hugging its edges, light bleeding onto the ceiling grid
 * around it, as in the owner's photo of an office ceiling (no round glare).
 * Additive and instanced (one draw call), it follows exactly the
 * panel's own state: construction zones, the «Ctrl» key and the random
 * failing tube (panelLight, scripts/space/reveal.js).
 */
const SPILL = 0.3; // m of halo beyond the panel's edge
const TINT = new THREE.Color("#fff6ea");

const COMMON = /* glsl */ `
${PANEL_GLSL}
uniform vec3 uRevealCenter;
uniform float uRevealRadius, uZone1, uZone2, uZone3;
float panelOn(vec3 c) {
  int iz = int(clamp(floor((c.z - 0.009) / 1.2), 0.0, 5.0));
  float zone = iz < 2 ? uZone1 : (iz < 4 ? uZone2 : uZone3);
  // Hidden until the construction wave has reached the panel.
  float reached = 1.0 - smoothstep(-0.3, 0.3, distance(c, uRevealCenter) - uRevealRadius);
  return zone * panelLight(c) * reached;
}
`;

function uniforms() {
  return {
    ...lightUniforms,
    uRevealCenter: sharedUniforms.uRevealCenter,
    uRevealRadius: sharedUniforms.uRevealRadius,
    uZone1: zoneLight[0],
    uZone2: zoneLight[1],
    uZone3: zoneLight[2],
    uTint: { value: TINT },
  };
}

/** Panel rectangles (world space) from the ceiling light meshes. */
function findPanels(meshes) {
  const boxes = new Map();
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld);
      const ix = Math.min(5, Math.max(0, Math.floor((v.x + 3.39) / 1.13)));
      const iz = Math.min(5, Math.max(0, Math.floor((v.z - 0.009) / 1.2)));
      const i = ix + 6 * iz;
      if (!boxes.has(i)) boxes.set(i, new THREE.Box3());
      boxes.get(i).expandByPoint(v);
    }
  }
  return [...boxes.values()];
}

function spillLayer(panels) {
  const geo = new THREE.InstancedBufferGeometry();
  geo.copy(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2)); // faces down
  const centre = new Float32Array(panels.length * 3);
  const half = new Float32Array(panels.length * 2);
  panels.forEach((b, i) => {
    const c = b.getCenter(new THREE.Vector3());
    centre.set([c.x, b.min.y - 0.003, c.z], i * 3);
    half.set([(b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2], i * 2);
  });
  geo.setAttribute("aCentre", new THREE.InstancedBufferAttribute(centre, 3));
  geo.setAttribute("aHalf", new THREE.InstancedBufferAttribute(half, 2));
  geo.instanceCount = panels.length;
  const material = new THREE.ShaderMaterial({
    uniforms: uniforms(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCentre;
      attribute vec2 aHalf;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying vec3 vCentre;
      void main() {
        vec2 size = 2.0 * (aHalf + ${SPILL.toFixed(2)});
        vLocal = position.xz * size;
        vHalf = aHalf;
        vCentre = aCentre;
        vec3 p = aCentre + vec3(vLocal.x, 0.0, vLocal.y);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${COMMON}
      uniform vec3 uTint;
      varying vec2 vLocal;
      varying vec2 vHalf;
      varying vec3 vCentre;
      void main() {
        vec2 q = abs(vLocal) - vHalf;
        float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); // < 0 inside
        float inside = 1.0 - smoothstep(-0.05, 0.0, d);
        float out1 = exp(-max(d, 0.0) / 0.035);
        float out2 = exp(-max(d, 0.0) / 0.11);
        float a = inside * 0.05 + (1.0 - inside) * (0.55 * out1 + 0.14 * out2);
        a *= 1.0 - smoothstep(${(SPILL * 0.7).toFixed(3)}, ${SPILL.toFixed(3)}, d);
        gl_FragColor = vec4(uTint * a * panelOn(vCentre), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.name = "Ceiling_Halo";
  return mesh;
}

/** Adds the halos for the given ceiling light meshes; returns their group. */
export function createCeilingGlow(scene, meshes) {
  const panels = findPanels(meshes);
  const group = new THREE.Group();
  group.name = "Ceiling_Glow";
  if (panels.length) group.add(spillLayer(panels));
  scene.add(group);
  return { group, panels: panels.length };
}
