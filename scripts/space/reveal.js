import * as THREE from "three";

/**
 * The archive builds itself when the page opens: a luminous wave grows from
 * drawer 023 through the room. Ahead of it only the room's lines exist, at
 * the front a cold band glows, behind it the real surfaces appear. A grid
 * scans the floor as the wave crosses it; then the ceiling panels come on,
 * zone by zone, flickering like fluorescent tubes.
 *
 * Inspired by the owner's reference (bricelab.dev), rebuilt for this room.
 * All shared state lives in `U` (uniform objects passed to every shader).
 */
export const BUILD = 3800; // ms, before the existing entrance
const T = {
  wave: [300, 2600],
  zones: [2400, 2750, 3100], // Z1 (archive) → Z3 (entrance)
  flicker: 380,
  fade: [3250, 3800],
};
const GLOW = new THREE.Color("#ffa516"); // warm amber yellow (AgX desaturates brights)
const FULL = 1e4; // radius once built: no fragment is ever discarded

const U = {
  uRevealCenter: { value: new THREE.Vector3() },
  uRevealRadius: { value: FULL },
  uRevealBand: { value: 0.12 },
  uRevealNoise: { value: 0.22 },
  // Surfaces only get a faint warm hint: the light runs along the edges.
  uRevealGlow: { value: GLOW.clone().multiplyScalar(0.18) },
  uRevealPower: { value: 1 },
  uLineOpacity: { value: 0 },
  uLineLead: { value: 0.9 },
};
const zoneUniforms = [1, 2, 3].map(() => ({ value: 1 }));

/*
 * Light switch (the «Ctrl» key). Each of the 36 ceiling panels (6 × 6,
 * 1.13 × 1.2 m) gets its own delay and its own stutter every time the
 * switch is pressed, so the tubes never go out — or come back — together.
 * JS decides the delays and passes them to the shader, so the room's light
 * level, computed here, follows exactly the panels you see.
 */
const PANELS = 36;
const L = {
  uLightsTime: { value: 1e6 },
  uLightsOn: { value: 1 },
  uPanelDelay: { value: new Array(PANELS).fill(0) },
  uPanelVary: { value: new Array(PANELS).fill(0.5) },
};
const lights = { on: true, start: -1e6 };
const DARK = 0.03; // with every tube out, the architecture is barely there
const ON_STEPS = [0, 0.9, 0.08, 0.55, 0.15, 1, 0.7, 1];
const OFF_STEPS = [1, 0.25, 0.9, 0.05, 0.6, 0, 0.3, 0];
/** Brightness of panel `i` at `t` ms after the switch (mirrors the GLSL). */
function panelValue(i, t, on) {
  const local = t - L.uPanelDelay.value[i];
  const vary = L.uPanelVary.value[i];
  if (on) {
    if (local <= 0) return 0;
    const k = local / (300 + vary * 260);
    return k >= 1 ? 1 : ON_STEPS[Math.min(7, Math.floor(k * 8))];
  }
  if (local <= 0) return 1;
  const k = local / (110 + vary * 300);
  return k >= 1 ? 0 : OFF_STEPS[Math.min(7, Math.floor(k * 8))];
}
export function switchLights(on, now, instant = false) {
  lights.on = on;
  lights.start = instant ? now - 1e5 : now;
  for (let i = 0; i < PANELS; i++) {
    L.uPanelDelay.value[i] = Math.random() * (on ? 1000 : 1100);
    L.uPanelVary.value[i] = Math.random();
  }
  L.uLightsOn.value = on ? 1 : 0;
}
/** Advances the switch; returns true while tubes are still changing. */
export function updateLights(now) {
  const t = now - lights.start;
  L.uLightsTime.value = t;
  let sum = 0;
  for (let i = 0; i < PANELS; i++) sum += panelValue(i, t, lights.on);
  U.uRevealPower.value = DARK + (1 - DARK) * (sum / PANELS);
  return t < 1900;
}
export function lightsState() {
  return { on: lights.on, power: U.uRevealPower.value };
}
const PANEL_GLSL = /* glsl */ `
uniform float uLightsTime, uLightsOn;
uniform float uPanelDelay[${PANELS}];
uniform float uPanelVary[${PANELS}];
const float ON_STEPS[8] = float[8](${ON_STEPS.map((v) => v.toFixed(2)).join(", ")});
const float OFF_STEPS[8] = float[8](${OFF_STEPS.map((v) => v.toFixed(2)).join(", ")});
float panelLight(vec3 p) {
  int ix = int(clamp(floor((p.x + 3.39) / 1.13), 0.0, 5.0));
  int iz = int(clamp(floor((p.z - 0.009) / 1.2), 0.0, 5.0));
  int i = ix + 6 * iz;
  float local = uLightsTime - uPanelDelay[i];
  float vary = uPanelVary[i];
  if (uLightsOn > 0.5) {
    if (local <= 0.0) return 0.0;
    float k = local / (300.0 + vary * 260.0);
    return k >= 1.0 ? 1.0 : ON_STEPS[int(min(7.0, floor(k * 8.0)))];
  }
  if (local <= 0.0) return 1.0;
  float k = local / (110.0 + vary * 300.0);
  return k >= 1.0 ? 0.0 : OFF_STEPS[int(min(7.0, floor(k * 8.0)))];
}
`;

const NOISE = /* glsl */ `
varying vec3 vRevealPos;
uniform vec3 uRevealCenter;
uniform float uRevealRadius, uRevealBand, uRevealNoise;
float revealHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float revealNoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(revealHash(i), revealHash(i + vec3(1, 0, 0)), f.x),
                 mix(revealHash(i + vec3(0, 1, 0)), revealHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(revealHash(i + vec3(0, 0, 1)), revealHash(i + vec3(1, 0, 1)), f.x),
                 mix(revealHash(i + vec3(0, 1, 1)), revealHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float revealDistance() {
  return distance(vRevealPos, uRevealCenter)
    + (revealNoise(vRevealPos * 2.6) - 0.5) * uRevealNoise;
}
`;
const VERTEX_DECL = "varying vec3 vRevealPos;";
const VERTEX_POS = `
  #ifdef USE_INSTANCING
    vRevealPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vRevealPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif`;

/**
 * Adds the wave to a lit material's shader (call inside onBeforeCompile).
 * `zone` (1–3) marks a ceiling panel: its emission follows that zone's
 * flicker; every other surface follows the global light level.
 */
export function applyReveal(shader, zone = 0) {
  Object.assign(shader.uniforms, U, L);
  shader.uniforms.uRevealZone = zone ? zoneUniforms[zone - 1] : U.uRevealPower;
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
    .replace(
      "#include <project_vertex>",
      `#include <project_vertex>\n${VERTEX_POS}`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      `#include <common>\n${NOISE}\n${zone ? PANEL_GLSL : ""}\nuniform vec3 uRevealGlow;\nuniform float uRevealPower, uRevealZone;`,
    )
    .replace(
      "#include <clipping_planes_fragment>",
      `#include <clipping_planes_fragment>
      float revealD = revealDistance();
      if (revealD > uRevealRadius) discard;
      float revealBand = 1.0 - smoothstep(0.0, uRevealBand, uRevealRadius - revealD);`,
    )
    .replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      totalEmissiveRadiance = totalEmissiveRadiance * uRevealZone${zone ? " * panelLight(vRevealPos)" : ""} + uRevealGlow * revealBand;`,
    )
    .replace(
      "#include <lights_fragment_maps>",
      `#include <lights_fragment_maps>
      irradiance *= uRevealPower;
      #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
        iblIrradiance *= uRevealPower;
        radiance *= uRevealPower;
      #endif`,
    );
}
/** Ceiling panels are not patched elsewhere: give them the wave and a zone. */
export function patchCeiling(material) {
  const zone = Number(/LUZ_ZONA_(\d)/.exec(material.name)?.[1] ?? 0);
  material.onBeforeCompile = (shader) => applyReveal(shader, zone);
  material.customProgramCacheKey = () => `efedegam-ceiling-${zone}`;
}

function linesMaterial() {
  const m = new THREE.LineBasicMaterial({
    color: GLOW,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false, // keep the pulse a saturated warm yellow
  });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECL}`)
      .replace(
        "#include <project_vertex>",
        `#include <project_vertex>\n${VERTEX_POS}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>\n${NOISE}\nuniform float uLineOpacity, uLineLead;`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float rd = revealDistance();
        float ahead = rd - uRevealRadius;
        // The light runs along the edges: a narrow pulse at the wave front,
        // a barely visible blueprint ahead of it, a dim trace left behind.
        float pulse = exp(-pow((ahead - 0.08) / 0.22, 2.0));
        float blueprint = ahead > 0.0 ? 0.05 * (1.0 - smoothstep(0.0, 6.0, ahead)) + 0.02 : 0.0;
        float trace = ahead <= 0.0 ? 0.06 * (1.0 - smoothstep(0.0, 1.2, -ahead)) + 0.02 : 0.0;
        diffuseColor.rgb *= 1.0 + 2.2 * pulse;
        diffuseColor.a *= uLineOpacity * (blueprint + trace + pulse);
        #include <opaque_fragment>`,
      );
  };
  m.customProgramCacheKey = () => "efedegam-reveal-lines";
  return m;
}

function floorGrid(bounds) {
  const size = new THREE.Vector3();
  bounds.getSize(size);
  const geo = new THREE.PlaneGeometry(size.x, size.z);
  geo.rotateX(-Math.PI / 2);
  geo.translate(
    (bounds.min.x + bounds.max.x) / 2,
    0.003,
    (bounds.min.z + bounds.max.z) / 2,
  );
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...U, uTime: { value: 0 }, uColor: { value: GLOW } },
    vertexShader: `${VERTEX_DECL}
      void main() {
        vec3 transformed = position;
        ${VERTEX_POS}
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `${NOISE}
      uniform float uLineOpacity, uTime;
      uniform vec3 uColor;
      void main() {
        vec2 p = vRevealPos.xz / 0.5;               // 50 cm cells
        vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
        float line = 1.0 - min(min(g.x, g.y), 1.0);
        vec2 c = abs(fract(p) - 0.5);                // small squares at the crossings
        float dotMark = step(max(c.x, c.y), 0.045);
        float rd = revealDistance();
        float ahead = rd - uRevealRadius;
        float scan = pow(0.5 + 0.5 * sin((rd * 1.4 - uTime * 2.2) * 6.2831), 9.0);
        // Visible up to 2.4 m ahead of the wave, gone 1.2 m behind it.
        float zone = (1.0 - smoothstep(0.0, 2.4, ahead)) * (1.0 - smoothstep(0.0, 1.2, -ahead));
        float a = uLineOpacity * zone * (line * (0.35 + 0.9 * scan) + dotMark * 0.55);
        gl_FragColor = vec4(uColor * a, a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 2;
  return mesh;
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
// A fluorescent tube coming on: two stutters, then steady.
const FLICKER = [0, 0.9, 0.08, 0.55, 0.15, 1, 0.7, 1];
function tube(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const i = Math.floor(t * FLICKER.length);
  return FLICKER[Math.min(i, FLICKER.length - 1)];
}

/**
 * Builds the overlay objects (lines, floor grid) for `meshes`, centred on
 * `center`. Returns { update(ms), finish() } for the entrance timeline.
 */
export function createReveal(scene, meshes, center, { onFinish } = {}) {
  U.uRevealCenter.value.copy(center);
  const group = new THREE.Group();
  group.name = "Reveal_Overlay";
  const lineMat = linesMaterial();
  const bounds = new THREE.Box3();
  for (const mesh of meshes) {
    mesh.updateMatrixWorld(true);
    const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
    const lines = new THREE.LineSegments(edges, lineMat);
    lines.matrixAutoUpdate = false;
    lines.matrix.copy(mesh.matrixWorld);
    lines.renderOrder = 3;
    group.add(lines);
    bounds.expandByObject(mesh);
  }
  const grid = floorGrid(bounds);
  group.add(grid);
  scene.add(group);
  let finished = false;
  const background = scene.background;
  const dark = new THREE.Color("#090b0a");

  function update(ms) {
    if (finished) return;
    scene.background = dark;
    const [w0, w1] = T.wave;
    const k = ease(clamp01((ms - w0) / (w1 - w0)));
    // Radius: from inside the drawer to beyond the entrance wall.
    U.uRevealRadius.value = ms < w0 ? -1 : 0.05 + k * 11;
    U.uLineOpacity.value =
      clamp01(ms / 500) *
      (1 - clamp01((ms - T.fade[0]) / (T.fade[1] - T.fade[0])));
    const zones = T.zones.map((z, i) => {
      const v = tube((ms - z) / T.flicker);
      zoneUniforms[i].value = v;
      return v;
    });
    // While the wave runs the built room is barely lit; then it follows the panels.
    U.uRevealPower.value =
      0.1 + 0.9 * (zones[0] * 0.45 + zones[1] * 0.33 + zones[2] * 0.22);
    grid.material.uniforms.uTime.value = ms / 1000;
  }
  function finish() {
    if (finished) return;
    finished = true;
    U.uRevealRadius.value = FULL;
    U.uRevealPower.value = 1;
    U.uLineOpacity.value = 0;
    zoneUniforms.forEach((z) => (z.value = 1));
    scene.background = background;
    scene.remove(group);
    group.traverse((o) => o.geometry?.dispose());
    lineMat.dispose();
    grid.material.dispose();
    onFinish?.();
  }
  return {
    update,
    finish,
    get finished() {
      return finished;
    },
  };
}
/** Present state, read by tests: is any part of the room still hidden? */
export function revealState() {
  return {
    radius: U.uRevealRadius.value,
    power: U.uRevealPower.value,
    lines: U.uLineOpacity.value,
  };
}
