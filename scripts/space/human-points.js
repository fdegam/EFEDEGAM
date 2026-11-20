/**
 * The point cloud of the person of light (scripts/space/figure.js), with
 * no dependencies, so it can be computed in a Web Worker while the room
 * downloads (scripts/space/points-worker.js), or on the main thread as a
 * fallback. Deterministic: the same figure on every visit.
 */
const H = 1.8;
const SHOULDER = [0.19, 1.445];
const HIP = [0.088, 0.92];
export const NAVEL = 1.08;

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

