import * as THREE from "three";

/**
 * A person made of light points, standing at the centre of the room: the
 * owner's reference is a sparse cloud of glowing points with a soft halo
 * around the body (no Vitruvian lines). 1.80 m tall, arm span equal to
 * height.
 *
 * It turns slowly, the points shy away from the pointer like dust, and they
 * part around the camera when it walks (or rushes) through the figure.
 *
 * Future: replace the procedural body with the owner's own scan. Any point
 * cloud works: pass `{ points: Float32Array(xyz…), layers?: Float32Array }`
 * to `createFigure` (metres, feet at y = 0, facing +z).
 */
import { humanPoints, NAVEL } from "./human-points.js";

// Per-point randomness for the shader (twinkle, size, dust); the body's
// shape itself comes from human-points.js.
const rand = (() => {
  let s = 1492;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

const LIGHT = new THREE.Color("#eef9f3");

/**
 * The room has no real-time lamps (its light is baked), so the figure's
 * shadow is drawn from its own points: projected onto the floor from the
 * ceiling, leaning a little towards the entrance, then blurred. A dark
 * contact patch under the feet and a soft, wider shade.
 */
function shadowTexture(points, layers) {
  const size = 256,
    extent = 1.8; // metres covered by the texture
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.filter = "blur(7px)";
  const px = (m) => (m / extent + 0.5) * size;
  for (let i = 0; i < points.length / 3; i++) {
    if (layers[i] > 0.5) continue;
    const x = points[i * 3],
      y = points[i * 3 + 1],
      z = points[i * 3 + 2];
    // Overhead light: near the floor the shade is dense; higher points cast
    // a lighter, slightly displaced shadow (towards +z, the entrance).
    const k = Math.max(0, 1 - y / 1.9);
    g.fillStyle = `rgba(0,0,0,${0.035 + 0.085 * k * k})`;
    g.fillRect(px(x) - 1.5, px(z + y * 0.12) - 1.5, 3, 3);
  }
  g.filter = "blur(10px)";
  const contact = g.createRadialGradient(
    size / 2,
    size / 2 + 6,
    2,
    size / 2,
    size / 2 + 6,
    size * 0.16,
  );
  contact.addColorStop(0, "rgba(0,0,0,0.72)");
  contact.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = contact;
  g.beginPath();
  g.ellipse(
    size / 2,
    size / 2 + 6,
    size * 0.16,
    size * 0.09,
    0,
    0,
    Math.PI * 2,
  );
  g.fill();
  const t = new THREE.CanvasTexture(c);
  return { texture: t, extent };
}

/**
 * Builds the figure at `position`. Returns { object, update(dt, state) }.
 * state: { assemble 0–1, luminous 0–1, opacity 0–1, ray: Ray|null, camera, reduced }.
 */
export function createFigure(position, source = humanPoints()) {
  const { points, layers } = source;
  const n = points.length / 3;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(points, 3));
  const seed = new Float32Array(n);
  for (let i = 0; i < n; i++) seed[i] = rand();
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute(
    "aLayer",
    new THREE.BufferAttribute(layers ?? new Float32Array(n), 1),
  );
  const uniforms = {
    uTime: { value: 0 },
    uAngle: { value: 0 },
    uAssemble: { value: 1 },
    uOpacity: { value: 1 },
    uLuminous: { value: 0 },
    uFlowPos: { value: new THREE.Vector3(0, -100, 0) },
    uFlow: { value: new THREE.Vector3() },
    uStir: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uPart: { value: 1 }, // 0: the points do not part around the camera
    uScale: { value: 600 },
    uLight: { value: LIGHT },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending, // light adds to the room: it glows
    vertexShader: /* glsl */ `
      attribute float aSeed, aLayer;
      uniform float uTime, uAngle, uAssemble, uOpacity, uStir, uScale, uLuminous;
      uniform vec3 uFlowPos, uFlow, uCam;
      uniform float uPart;
      varying float vAlpha, vGlow, vLayer;
      void main() {
        vec3 p = position;
        // Assemble from a drifting cloud of dust.
        // Independent hashes: a real cloud, not points strung along a curve.
        vec3 dir = normalize(fract(sin(vec3(aSeed * 127.1 + 3.1, aSeed * 311.7 + 7.3, aSeed * 74.7 + 1.9)) * 43758.5453) * 2.0 - 1.0 + 1e-4);
        vec3 dust = dir * (1.2 + aSeed * 2.4) + vec3(0.0, 1.0, 0.0);
        float k = clamp((uAssemble - aSeed * 0.55) / 0.45, 0.0, 1.0);
        k = k * k * (3.0 - 2.0 * k);
        p = mix(dust, p, k);
        float c = cos(uAngle), s = sin(uAngle);
        p.xz = mat2(c, -s, s, c) * p.xz;
        vec3 w = (modelMatrix * vec4(p, 1.0)).xyz;
        // A living surface: a breath of motion per point.
        w += 0.0035 * vec3(sin(uTime * 1.7 + aSeed * 40.0), sin(uTime * 1.3 + aSeed * 71.0), cos(uTime * 1.5 + aSeed * 13.0));
        // The pointer stirs the points like smoke: they are carried along
        // its motion, curl around it and drift, then settle back. Nothing
        // is pushed away radially, so no hole opens.
        vec3 rel = w - uFlowPos;
        float fall = exp(-dot(rel, rel) / (0.34 * 0.34));
        vec3 turb = vec3(
          sin(w.y * 7.0 + uTime * 1.3 + aSeed * 6.0),
          sin(w.z * 6.0 + uTime * 1.1 + aSeed * 4.0),
          sin(w.x * 7.0 + uTime * 1.7 + aSeed * 5.0));
        vec3 axis = normalize(uFlow + vec3(1e-4, 0.0, 0.0));
        vec3 swirl = cross(axis, rel);
        float f = fall * uStir;
        w += fall * uFlow * (0.16 + aSeed * 0.16)
          + f * (turb * 0.045 + swirl * 0.9);
        // Walking through: the points part around the camera.
        vec3 fc = w - uCam;
        float dc = length(fc);
        float g = pow(clamp(1.0 - dc / 0.95, 0.0, 1.0), 2.0) * uPart;
        w += fc / max(dc, 1e-4) * g * 0.55;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        // Body sparks and a faint halo; in the dark the halo grows strong.
        float layer = aLayer < 0.5 ? 0.75 * (1.0 + 0.6 * uLuminous) : mix(0.045, 0.26, uLuminous);
        // Dust only exists while it gathers: nothing floats before.
        vAlpha = uOpacity * clamp(uAssemble * 3.0, 0.0, 1.0) * layer * smoothstep(0.08, 0.4, dc) * (0.75 + 0.25 * sin(uTime * 2.0 + aSeed * 60.0));
        vGlow = f + g;
        vLayer = aLayer;
        float size = aLayer < 0.5 ? 0.0047 + aSeed * 0.0047 : (0.05 + aSeed * 0.07) * (1.0 + 0.55 * uLuminous);
        gl_PointSize = clamp(size * uScale / -mv.z, 1.0, aLayer < 0.5 ? 8.0 : 96.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      varying float vAlpha, vGlow, vLayer;
      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;
        // Sparks: a bright core with a soft edge. Halo: a wide gaussian haze.
        float a = vLayer < 0.5
          ? smoothstep(1.0, 0.2, r) * (0.55 + 0.45 * smoothstep(0.5, 0.0, r))
          : exp(-r * r * 3.5) * (1.0 - r);
        a *= vAlpha * (1.0 + vGlow * 1.5);
        if (a < 0.004) discard;
        gl_FragColor = vec4(uLight * a, a);
      }`,
  });
  const { texture: shade, extent } = shadowTexture(
    points,
    layers ?? new Float32Array(n),
  );
  const shadowMat = new THREE.MeshBasicMaterial({
    color: "#0e1a13",
    alphaMap: shade,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  // alphaMap reads the green channel; the canvas is black on transparent,
  // so use its alpha instead.
  shadowMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphamap_fragment>",
      "diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).a;",
    );
  };
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(extent, extent),
    shadowMat,
  );
  shadow.geometry.rotateX(-Math.PI / 2);
  shadow.position.copy(position).setY(0.004);
  shadow.renderOrder = 1;
  shadow.name = "Point_Figure_Shadow";
  // Lights out: the figure lights the carpet around its feet.
  const pc = document.createElement("canvas");
  pc.width = pc.height = 128;
  const pctx = pc.getContext("2d");
  const grad = pctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  pctx.fillStyle = grad;
  pctx.fillRect(0, 0, 128, 128);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(pc),
      color: LIGHT,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  pool.position.copy(position).setY(0.005);
  pool.name = "Point_Figure_Glow";
  pool.renderOrder = 1;
  const object = new THREE.Points(geo, material);
  object.name = "Point_Figure";
  object.position.copy(position);
  object.frustumCulled = false;
  object.renderOrder = 4;
  geo.computeBoundingSphere();
  const bounds = new THREE.Sphere(
    position.clone().add(new THREE.Vector3(0, NAVEL, 0)),
    1.35,
  );
  // Pointer as a stirring stick: where it crosses the figure's axis.
  let time = 0,
    pointerAt = null;
  const last = new THREE.Vector3(),
    velocity = new THREE.Vector3(),
    axis = position.clone();
  let hasLast = false;
  return {
    object,
    shadow,
    pool,
    bounds,
    /** How strongly the pointer is stirring the points (0–1+), for sound. */
    get stir() {
      return uniforms.uStir.value;
    },
    setPointer(ray) {
      if (!ray) {
        pointerAt = null;
        hasLast = false;
        return;
      }
      // Point of the ray nearest the figure's vertical axis.
      const o = ray.origin,
        d = ray.direction;
      const dxz = d.x * d.x + d.z * d.z;
      const t =
        dxz > 1e-6 ? ((axis.x - o.x) * d.x + (axis.z - o.z) * d.z) / dxz : 0;
      pointerAt = o.clone().addScaledVector(d, Math.max(0, t));
    },
    /** Advances the figure; returns true while it needs more frames. */
    update(
      dt,
      {
        camera,
        viewportHeight,
        assemble = 1,
        luminous = 0,
        opacity = 1,
        reduced = false,
        part = 1,
      },
    ) {
      time += dt;
      const flow = uniforms.uFlow.value;
      if (pointerAt && hasLast && dt > 0) {
        velocity
          .subVectors(pointerAt, last)
          .divideScalar(dt)
          .clampLength(0, 1.6);
      } else velocity.set(0, 0, 0);
      if (pointerAt) {
        uniforms.uFlowPos.value.lerp(pointerAt, 1 - Math.exp(-dt * 12));
        last.copy(pointerAt);
        hasLast = true;
      }
      // The smoke follows the stick, then lingers and slowly settles.
      flow.lerp(velocity, 1 - Math.exp(-dt * 2.6));
      uniforms.uStir.value = Math.max(
        uniforms.uStir.value * Math.exp(-dt * 1.3),
        Math.min(1, velocity.length() * 0.9),
      );
      uniforms.uTime.value = reduced ? 0 : time;
      if (!reduced) uniforms.uAngle.value += dt * 0.22; // a full turn in ~29 s
      uniforms.uAssemble.value = assemble;
      uniforms.uLuminous.value = luminous;
      pool.material.opacity = 0.22 * luminous * Math.min(1, assemble);
      pool.visible = pool.material.opacity > 0.002;
      uniforms.uOpacity.value = opacity;
      shadow.rotation.y = uniforms.uAngle.value; // it turns with the figure
      shadow.material.opacity =
        opacity *
        Math.min(1, Math.max(0, assemble * 1.4 - 0.4)) *
        (1 - luminous * 0.8);
      uniforms.uCam.value.copy(camera.position);
      // Seen up close («Sobre mí»), the bust stays whole.
      uniforms.uPart.value += ((part ?? 1) - uniforms.uPart.value) * Math.min(1, dt * 4);
      uniforms.uScale.value =
        viewportHeight /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      return !reduced || uniforms.uStir.value > 2e-3 || flow.length() > 1e-3;
    },
  };
}
