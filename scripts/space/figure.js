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
const H = 1.8;
const SHOULDER = [0.19, 1.445];
const HIP = [0.088, 0.92];
const NAVEL = 1.08;

const rand = (() => {
  let s = 1492; // deterministic: the same figure on every visit
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

/* --- signed distance primitives (Inigo Quilez) ------------------------ */
const len = (x, y, z) => Math.hypot(x, y, z);
function ellipsoid(p, c, r) {
  const x = (p[0] - c[0]) / r[0],
    y = (p[1] - c[1]) / r[1],
    z = (p[2] - c[2]) / r[2];
  const k0 = len(x, y, z);
  const k1 = len(x / r[0], y / r[1], z / r[2]);
  return (k0 * (k0 - 1)) / Math.max(k1, 1e-6);
}
function cone(p, a, b, ra, rb) {
  const bx = b[0] - a[0],
    by = b[1] - a[1],
    bz = b[2] - a[2];
  const px = p[0] - a[0],
    py = p[1] - a[1],
    pz = p[2] - a[2];
  const h = Math.min(
    1,
    Math.max(0, (px * bx + py * by + pz * bz) / (bx * bx + by * by + bz * bz)),
  );
  return len(px - bx * h, py - by * h, pz - bz * h) - (ra + (rb - ra) * h);
}
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Body parts for one pose; `armUp` and `legOut` in radians. */
function body(armUp, legOut, { torso = true } = {}) {
  const parts = [];
  const E = (c, r) => parts.push({ kind: "e", c, r });
  const C = (a, b, ra, rb) => parts.push({ kind: "c", a, b, ra, rb });
  if (torso) {
    E([0, 1.688, 0.004], [0.077, 0.104, 0.091]); // head
    C([0, 1.52, 0], [0, 1.61, 0.005], 0.052, 0.047); // neck
    E([0, 1.335, 0], [0.165, 0.16, 0.103]); // chest
    E([0, 1.12, 0.004], [0.134, 0.13, 0.092]); // waist
    E([0, 0.955, 0], [0.163, 0.112, 0.104]); // pelvis
  }
  for (const s of [-1, 1]) {
    const [sx, sy] = SHOULDER;
    const d = [s * Math.cos(armUp), Math.sin(armUp), 0];
    const at = (l) => [s * sx + d[0] * l, sy + d[1] * l, 0];
    if (torso) E([s * sx, sy, 0], [0.065, 0.06, 0.06]); // shoulder
    C(at(0.02), at(0.31), 0.05, 0.04); // upper arm
    C(at(0.31), at(0.57), 0.038, 0.029); // forearm
    C(at(0.57), at(0.71), 0.03, 0.017); // hand
    const [hx, hy] = HIP;
    const g = [s * Math.sin(legOut), -Math.cos(legOut), 0];
    const lt = (l) => [s * hx + g[0] * l, hy + g[1] * l, 0];
    C(lt(0), lt(0.44), 0.078, 0.052); // thigh
    C(lt(0.44), lt(0.86), 0.05, 0.034); // shin
    const ankle = lt(0.86);
    E([ankle[0], ankle[1] - 0.03, 0.055], [0.042, 0.03, 0.115]); // foot
  }
  return parts;
}
function sdf(parts, p) {
  let d = Infinity;
  for (const q of parts) {
    const v =
      q.kind === "e" ? ellipsoid(p, q.c, q.r) : cone(p, q.a, q.b, q.ra, q.rb);
    d = d === Infinity ? v : smin(d, v, 0.045);
  }
  return d;
}
function surfacePoint(q) {
  if (q.kind === "e") {
    const u = rand() * 2 - 1,
      t = rand() * Math.PI * 2,
      r = Math.sqrt(1 - u * u);
    return [
      q.c[0] + q.r[0] * r * Math.cos(t),
      q.c[1] + q.r[1] * u,
      q.c[2] + q.r[2] * r * Math.sin(t),
    ];
  }
  const ax = [q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2]];
  const L = len(...ax);
  const n = ax.map((v) => v / L);
  const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [
    n[1] * ref[2] - n[2] * ref[1],
    n[2] * ref[0] - n[0] * ref[2],
    n[0] * ref[1] - n[1] * ref[0],
  ];
  const ul = len(...u);
  u.forEach((_, i) => (u[i] /= ul));
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  const h = rand(),
    a = rand() * Math.PI * 2,
    r = q.ra + (q.rb - q.ra) * h;
  return [0, 1, 2].map(
    (i) => q.a[i] + ax[i] * h + (u[i] * Math.cos(a) + v[i] * Math.sin(a)) * r,
  );
}
function area(q) {
  if (q.kind === "e") {
    const [a, b, c] = q.r;
    const p = 1.6;
    return (
      4 *
      Math.PI *
      Math.pow(
        (Math.pow(a * b, p) + Math.pow(a * c, p) + Math.pow(b * c, p)) / 3,
        1 / p,
      )
    );
  }
  return (
    Math.PI *
    (q.ra + q.rb) *
    len(q.b[0] - q.a[0], q.b[1] - q.a[1], q.b[2] - q.a[2])
  );
}
/** Samples `count` points on the skin of the union of `parts`. */
function sampleBody(parts, count, normals = []) {
  const weights = parts.map(area);
  const total = weights.reduce((a, b) => a + b, 0);
  const out = [];
  const e = 1e-3;
  let guard = count * 4;
  while (out.length < count * 3 && guard--) {
    let r = rand() * total,
      i = 0;
    while (r > weights[i]) r -= weights[i++];
    const p = surfacePoint(parts[Math.min(i, parts.length - 1)]);
    let n = [0, 1, 0];
    for (let k = 0; k < 3; k++) {
      const d = sdf(parts, p);
      const gx = sdf(parts, [p[0] + e, p[1], p[2]]) - d,
        gy = sdf(parts, [p[0], p[1] + e, p[2]]) - d,
        gz = sdf(parts, [p[0], p[1], p[2] + e]) - d;
      const gl = len(gx, gy, gz) || 1;
      n = [gx / gl, gy / gl, gz / gl];
      p[0] -= (d * gx) / gl;
      p[1] -= (d * gy) / gl;
      p[2] -= (d * gz) / gl;
    }
    if (Math.abs(sdf(parts, p)) < 0.004) {
      out.push(...p);
      normals.push(...n);
    }
  }
  return out;
}

/**
 * A standing person made of light: points over the skin and a little below
 * it (so the body reads as a volume), and a halo of faint, wide sparks just
 * outside the silhouette. Layers: 0 body, 1 halo.
 */
export function humanPoints() {
  const parts = body(-1.37, 0.035); // arms resting at the sides, feet apart
  const normals = [];
  const skin = sampleBody(parts, 22000, normals);
  const pts = [];
  const layers = [];
  for (let i = 0; i < skin.length; i += 3) {
    const depth = Math.pow(rand(), 2) * 0.04; // most on the skin, some inside
    for (let k = 0; k < 3; k++) pts.push(skin[i + k] - normals[i + k] * depth);
    layers.push(0);
  }
  const haloNormals = [];
  const halo = sampleBody(parts, 4000, haloNormals);
  for (let i = 0; i < halo.length; i += 3) {
    const out = 0.012 + rand() * 0.05;
    for (let k = 0; k < 3; k++)
      pts.push(halo[i + k] + haloNormals[i + k] * out);
    layers.push(1);
  }
  return { points: new Float32Array(pts), layers: new Float32Array(layers) };
}

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
    uRayO: { value: new THREE.Vector3(0, -100, 0) },
    uRayD: { value: new THREE.Vector3(0, 1, 0) },
    uHover: { value: 0 },
    uCam: { value: new THREE.Vector3() },
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
      uniform float uTime, uAngle, uAssemble, uOpacity, uHover, uScale;
      uniform vec3 uRayO, uRayD, uCam;
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
        // The pointer pushes the dust aside.
        vec3 toP = w - uRayO;
        vec3 off = w - (uRayO + uRayD * max(dot(toP, uRayD), 0.0));
        float d = length(off);
        float f = uHover * pow(clamp(1.0 - d / 0.3, 0.0, 1.0), 2.0);
        w += off / max(d, 1e-4) * f * 0.16;
        // Walking through: the points part around the camera.
        vec3 fc = w - uCam;
        float dc = length(fc);
        float g = pow(clamp(1.0 - dc / 0.95, 0.0, 1.0), 2.0);
        w += fc / max(dc, 1e-4) * g * 0.55;
        vec4 mv = viewMatrix * vec4(w, 1.0);
        gl_Position = projectionMatrix * mv;
        float layer = aLayer < 0.5 ? 0.75 : 0.07; // body sparks, faint halo
        // Dust only exists while it gathers: nothing floats before.
        vAlpha = uOpacity * clamp(uAssemble * 3.0, 0.0, 1.0) * layer * smoothstep(0.08, 0.4, dc) * (0.75 + 0.25 * sin(uTime * 2.0 + aSeed * 60.0));
        vGlow = f + g;
        vLayer = aLayer;
        float size = aLayer < 0.5 ? 0.0055 + aSeed * 0.0055 : 0.05 + aSeed * 0.07;
        gl_PointSize = clamp(size * uScale / -mv.z, 1.0, aLayer < 0.5 ? 8.0 : 64.0);
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
  let hover = 0,
    hoverGoal = 0,
    time = 0;
  return {
    object,
    shadow,
    bounds,
    setPointer(ray) {
      hoverGoal = ray ? 1 : 0;
      if (ray) {
        uniforms.uRayO.value.copy(ray.origin);
        uniforms.uRayD.value.copy(ray.direction);
      }
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
      },
    ) {
      time += dt;
      hover += (hoverGoal - hover) * Math.min(1, dt * 6);
      uniforms.uTime.value = reduced ? 0 : time;
      if (!reduced) uniforms.uAngle.value += dt * 0.22; // a full turn in ~29 s
      uniforms.uAssemble.value = assemble;
      uniforms.uLuminous.value = luminous;
      uniforms.uOpacity.value = opacity;
      shadow.rotation.y = uniforms.uAngle.value; // it turns with the figure
      shadow.material.opacity =
        opacity *
        Math.min(1, Math.max(0, assemble * 1.4 - 0.4)) *
        (1 - luminous * 0.8);
      uniforms.uHover.value = hover;
      uniforms.uCam.value.copy(camera.position);
      uniforms.uScale.value =
        viewportHeight /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      return !reduced || Math.abs(hover - hoverGoal) > 1e-3;
    },
  };
}
