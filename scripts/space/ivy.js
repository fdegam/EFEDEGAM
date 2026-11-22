import * as THREE from "three";

/**
 * PLANTIMANÍA: a pixel ivy that escapes from its drawer.
 *
 * Stage 1 (drawer opened): it spills out of the drawer and climbs, at random,
 * over the neighbouring drawers. Stage 2 (drawer pressed again): it takes the
 * whole room — walls, ceiling, floor — then grows over the camera itself
 * until the screen is entirely green, the green of the Plantimanía site
 * (#47622f with paper grain), which it then opens.
 *
 * Leaves are 16 × 16 pixel-art sprites (nearest filtering), one instanced
 * draw call. Growth runs on the GPU: each leaf has a birth time on a single
 * timeline (stage 1: 0–4 s, stage 2: 4–13 s) and the shader grows it in.
 */
export const PLANTIMANIA_URL = "https://fdegam.github.io/Plantimania-a/";
export const PLANTIMANIA_GREEN = "#47622f";
const CELL = 0.07; // metres between leaves on the room's surfaces
const STAGE1 = { end: 4, radius: 1.35 };
const STAGE2 = { start: 4.2, end: 11.5 };
const OVERLAY = { start: 9.6, end: 12.8, green: 13.2, leave: 13.8 };

const rand = (() => {
  let s = 20260118;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

/* --- leaves --------------------------------------------------------- */
// Soft, photographic ivy leaves (gradients, veins, no outline). The
// pixelation happens on screen: the ivy is drawn at a very low resolution
// and enlarged without smoothing, like the owner's reference (a heavily
// pixelated plant photograph).
const TILES = 6;
const LEAF = 64;
// Common ivy (Hedera helix): deep glossy greens, pale thin veins. Some
// leaves younger (lighter), some old and dark, a few bronzed by the light.
const GREENS = [
  ["#14301a", "#2a5626", "#4f8a3a", "#b7cf98"],
  ["#10281a", "#21482a", "#3d7434", "#a9c48d"],
  ["#1b3a17", "#356a2a", "#69a347", "#cfe0b0"],
  ["#0f2416", "#1d4022", "#33652d", "#98b682"],
  ["#22381a", "#47652a", "#7b9a43", "#d4dfa6"],
  ["#132e1e", "#27533a", "#48855a", "#b9d3b4"],
];
function leafAtlas() {
  const c = document.createElement("canvas");
  c.width = LEAF * TILES;
  c.height = LEAF;
  const g = c.getContext("2d");
  GREENS.forEach(([dark, mid, light, vein], t) => {
    g.save();
    g.translate(t * LEAF + LEAF / 2, LEAF / 2 + 3);
    g.rotate((t - 2.5) * 0.06);
    // An ivy leaf: a pointed top lobe, two pointed side lobes and two
    // small basal lobes around the stem, with a heart-shaped base.
    const lobe = 1 + (t % 3) * 0.06;
    g.beginPath();
    g.moveTo(0, 14);
    g.quadraticCurveTo(-6, 22, -14, 20);
    g.quadraticCurveTo(-22, 18, -20, 12);
    g.quadraticCurveTo(-29 * lobe, 8, -29 * lobe, -2);
    g.quadraticCurveTo(-22, -6, -12, -9);
    g.quadraticCurveTo(-8, -20, 0, -29 * lobe);
    g.quadraticCurveTo(8, -20, 12, -9);
    g.quadraticCurveTo(22, -6, 29 * lobe, -2);
    g.quadraticCurveTo(29 * lobe, 8, 20, 12);
    g.quadraticCurveTo(22, 18, 14, 20);
    g.quadraticCurveTo(6, 22, 0, 14);
    g.closePath();
    const grad = g.createRadialGradient(-6, -8, 2, 0, 2, 30);
    grad.addColorStop(0, light);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, dark);
    g.fillStyle = grad;
    g.fill();
    // Darker rim, as the leaf's edge curls away from the light.
    g.strokeStyle = dark;
    g.globalAlpha = 0.7;
    g.lineWidth = 2.2;
    g.stroke();
    g.clip();
    // Mottled surface.
    for (let k = 0; k < 70; k++) {
      g.globalAlpha = 0.08 + Math.random() * 0.1;
      g.fillStyle = Math.random() < 0.5 ? dark : light;
      g.beginPath();
      g.arc((Math.random() - 0.5) * 56, (Math.random() - 0.5) * 52, 1 + Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
    // Pale palmate veins from the base.
    g.strokeStyle = vein;
    g.globalAlpha = 0.6;
    g.lineWidth = 1.1;
    for (const [x, y] of [
      [0, -26],
      [-25, -2],
      [25, -2],
      [-17, 15],
      [17, 15],
    ]) {
      g.beginPath();
      g.moveTo(0, 12);
      g.quadraticCurveTo(x * 0.4, (y + 12) * 0.5, x, y);
      g.stroke();
    }
    // Glossy sheen of the waxy surface.
    const sheen = g.createLinearGradient(-20, -24, 6, 0);
    sheen.addColorStop(0, "rgba(255,255,255,0.28)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    g.globalAlpha = 1;
    g.fillStyle = sheen;
    g.fillRect(-30, -30, 40, 34);
    g.restore();
    // The stem.
    g.save();
    g.translate(t * LEAF + LEAF / 2, LEAF / 2 + 3);
    g.strokeStyle = "#4a3a22";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 14);
    g.lineTo(1, 28);
    g.stroke();
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, canvas: c };
}

/* --- where ivy can grow: a grid over the room's surfaces --------------- */
// Inner faces of the room (three.js space: archive wall at z≈0, entrance at z=7.2).
const SURFACES = [
  {
    name: "archive",
    o: [-3.36, 0.05, 0.017],
    u: [6.72, 0, 0],
    v: [0, 2.6, 0],
    n: [0, 0, 1],
  },
  {
    name: "left",
    o: [-3.378, 0.02, 0.05],
    u: [0, 0, 7.12],
    v: [0, 2.64, 0],
    n: [1, 0, 0],
  },
  {
    name: "right",
    o: [3.378, 0.02, 0.05],
    u: [0, 0, 7.12],
    v: [0, 2.64, 0],
    n: [-1, 0, 0],
  },
  {
    name: "entrance",
    o: [-3.36, 0.02, 7.192],
    u: [6.72, 0, 0],
    v: [0, 2.64, 0],
    n: [0, 0, -1],
  },
  {
    name: "ceiling",
    o: [-3.36, 2.665, 0.05],
    u: [6.72, 0, 0],
    v: [0, 0, 7.12],
    n: [0, -1, 0],
  },
  {
    name: "floor",
    o: [-3.36, 0.007, 0.05],
    u: [6.72, 0, 0],
    v: [0, 0, 7.12],
    n: [0, 1, 0],
  },
];
function roomCells() {
  const cells = [];
  SURFACES.forEach((s, si) => {
    const lu = Math.hypot(...s.u),
      lv = Math.hypot(...s.v);
    const nu = Math.round(lu / CELL),
      nv = Math.round(lv / CELL);
    for (let i = 0; i < nu; i++)
      for (let j = 0; j < nv; j++) {
        const a = (i + 0.5 + (rand() - 0.5) * 0.7) / nu,
          b = (j + 0.5 + (rand() - 0.5) * 0.7) / nv;
        cells.push({
          p: [0, 1, 2].map((k) => s.o[k] + s.u[k] * a + s.v[k] * b),
          n: s.n,
          surface: si,
        });
      }
  });
  return cells;
}
/** Random-weight shortest paths from the seeds: an organic, fingered front. */
function growthDistances(cells, seeds) {
  const key = (p) => p.map((v) => Math.floor(v / (CELL * 1.6))).join(",");
  const grid = new Map();
  cells.forEach((c, i) => {
    const k = key(c.p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  });
  const dist = new Float32Array(cells.length).fill(Infinity);
  // Binary heap of [distance, index].
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1,
          r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (const [i, d] of seeds) {
    dist[i] = d;
    push(d, i);
  }
  const reach = CELL * 1.6;
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    const p = cells[i].p;
    const [gx, gy, gz] = p.map((v) => Math.floor(v / reach));
    for (let x = gx - 1; x <= gx + 1; x++)
      for (let y = gy - 1; y <= gy + 1; y++)
        for (let z = gz - 1; z <= gz + 1; z++) {
          const list = grid.get(`${x},${y},${z}`);
          if (!list) continue;
          for (const j of list) {
            const q = cells[j].p;
            const len = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
            if (len === 0 || len > reach) continue;
            // Heavy-tailed random cost: vines race ahead in fingers.
            const w = len * (0.8 + Math.pow(rand(), 3) * 3.2);
            if (d + w < dist[j]) {
              dist[j] = d + w;
              push(d + w, j);
            }
          }
        }
  }
  return dist;
}

/* --- shader ----------------------------------------------------------- */
function ivyMaterial(atlas, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: atlas }, ...uniforms },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aCenter, aNormal;
      attribute float aBirth, aAngle, aSize, aTile, aLift;
      uniform float uTime, uRetreat;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        float t = clamp((uTime - aBirth) / 0.35, 0.0, 1.0);
        // A leaf unfurls: grows past its size, then settles.
        float grow = t * t * (3.0 - 2.0 * t) * (1.0 + 0.18 * sin(t * 3.1416));
        grow *= 1.0 - uRetreat;
        vec3 n = normalize(aNormal);
        vec3 ref = abs(n.y) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 tx = normalize(cross(ref, n));
        vec3 ty = cross(n, tx);
        float c = cos(aAngle), s = sin(aAngle);
        vec3 ax = tx * c + ty * s, ay = -tx * s + ty * c;
        vec3 w = aCenter + n * aLift + (ax * position.x + ay * position.y) * aSize * grow;
        vUv = vec2((position.x + 0.5 + aTile) / ${TILES.toFixed(1)}, position.y + 0.5);
        // Each leaf tilts a little out of the wall and catches the ceiling
        // light differently; some sit in the shade of others.
        float tilt = fract(sin(aAngle * 91.7 + aBirth * 13.1) * 43758.5);
        vShade = (0.72 + 0.28 * dot(n, normalize(vec3(0.2, 1.0, 0.4)))) * (0.7 + 0.45 * tilt);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      uniform float uRevealPower;
      varying vec2 vUv;
      varying float vShade;
      void main() {
        vec4 c = texture2D(uAtlas, vUv);
        if (c.a < 0.5) discard;
        // Follows the room's light (the Ctrl key), never fully black.
        gl_FragColor = vec4(c.rgb * vShade * (0.28 + 0.72 * uRevealPower), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/* --- the green that takes over the camera ----------------------------- */
function overlayLayer(atlasCanvas) {
  const W = 112,
    H = 63,
    S = 12; // canvas pixels per leaf; CSS enlarges the canvas without smoothing
  const el = document.createElement("canvas");
  el.className = "ivy-overlay";
  el.width = W * 1;
  el.height = H * 1;
  el.setAttribute("aria-hidden", "true");
  const g = el.getContext("2d");
  g.imageSmoothingEnabled = false;
  // Leaves at random points, born from the edges inwards (random fingers).
  const n = Math.ceil((W * H) / ((S * S) / 3));
  const leaves = [];
  for (let i = 0; i < n; i++) {
    const x = rand() * W,
      y = rand() * H;
    const edge = Math.min(x, W - x, y * (W / H), (H - y) * (W / H)) / (W / 2);
    leaves.push({
      x,
      y,
      tile: Math.floor(rand() * TILES),
      at: Math.pow(edge, 0.8) * (0.75 + rand() * 0.5),
      done: false,
    });
  }
  leaves.sort((a, b) => a.at - b.at);
  let drawn = 0;
  return {
    el,
    /** k: 0 → nothing, 1 → covered. */
    draw(k) {
      while (drawn < leaves.length && leaves[drawn].at <= k * 1.25) {
        const l = leaves[drawn++];
        g.drawImage(
          atlasCanvas,
          l.tile * LEAF,
          0,
          LEAF,
          LEAF,
          l.x - S / 2,
          l.y - S / 2,
          S,
          S,
        );
      }
    },
    reset() {
      g.clearRect(0, 0, W, H);
      drawn = 0;
    },
  };
}

/**
 * @param scene     three.js scene
 * @param drawer    the PLANTIMANÍA drawer ({ node }) — the ivy comes out of it
 * @param uniforms  shared uniforms providing uRevealPower (room light)
 */
export function createIvy(scene, drawer, uniforms, { onGreen } = {}) {
  const { tex, canvas: atlasCanvas } = leafAtlas();
  const U = {
    uTime: { value: 0 },
    uRetreat: { value: 0 },
    uRevealPower: uniforms.uRevealPower,
  };
  // The ivy has its own scene, drawn at a fraction of the screen's
  // resolution into `target` and enlarged without smoothing: a mosaic.
  const ivyScene = new THREE.Scene();
  const target = new THREE.WebGLRenderTarget(1, 1, {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: true,
  });
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({
      map: target.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const clear = new THREE.Color();
  let mesh = null,
    count = 0,
    stage = 0, // 0 asleep, 1 drawer, 2 room, 3 green
    t0 = 0,
    from = 0,
    to = 0,
    retreatAt = 0,
    overlay = null,
    veil = null;

  function build() {
    if (mesh) return;
    drawer.node.updateMatrixWorld(true);
    const mouth = drawer.node.getWorldPosition(new THREE.Vector3());
    const cells = roomCells();
    // Seeds: the archive wall around the drawer's opening.
    const seeds = [];
    cells.forEach((c, i) => {
      if (c.surface !== 0) return;
      const dx = Math.abs(c.p[0] - mouth.x),
        dy = Math.abs(c.p[1] - mouth.y);
      if (dx < 0.27 && dy < 0.12 && (dx > 0.2 || dy > 0.07))
        seeds.push([i, rand() * 0.08]);
    });
    const dist = growthDistances(cells, seeds);
    // Leaves spilling out of the open drawer (world positions, drawer open).
    const spill = [];
    const travel = 0.34;
    for (let i = 0; i < 260; i++) {
      const onLip = rand() < 0.45;
      const lx = (rand() - 0.5) * 0.48;
      const p = onLip
        ? [mouth.x + lx, mouth.y + 0.1 - rand() * 0.32, mouth.z + travel + 0.02]
        : [
            mouth.x + lx,
            mouth.y - 0.06 + rand() * 0.16,
            mouth.z + travel - rand() * 0.4,
          ];
      spill.push({ p, n: onLip ? [0, 0, 1] : [0, 1, 0], birth: rand() * 1.1 });
    }
    // Birth times on one timeline.
    const items = spill.slice();
    let maxD = 0;
    for (let i = 0; i < cells.length; i++)
      if (isFinite(dist[i])) maxD = Math.max(maxD, dist[i]);
    cells.forEach((c, i) => {
      const d = dist[i];
      if (!isFinite(d)) return;
      let birth;
      if (c.surface === 0 && d < STAGE1.radius) {
        // Stage 1 climbs as vines: only some cells now, the rest fill in later.
        birth =
          rand() > 0.42
            ? STAGE2.start + rand() * 1.6
            : 0.8 + (d / STAGE1.radius) * (STAGE1.end - 1.2);
      } else {
        // Stage 2 accelerates as it goes, like a plague.
        const k = Math.min(
          1,
          Math.max(0, (d - STAGE1.radius * 0.6) / (maxD - STAGE1.radius * 0.6)),
        );
        birth = STAGE2.start + Math.pow(k, 0.72) * (STAGE2.end - STAGE2.start);
      }
      // The invasion grows bigger leaves, so the walls end up covered.
      const big = birth >= STAGE2.start;
      items.push({
        p: c.p,
        n: c.n,
        birth: birth + rand() * 0.25,
        size: big ? 0.1 + rand() * 0.06 : undefined,
      });
      // Denser growth: a second, later leaf in most cells.
      if (rand() < 0.65)
        items.push({
          p: c.p.map(
            (v, k) => v + (c.n[k] === 0 ? (rand() - 0.5) * CELL * 0.8 : 0),
          ),
          n: c.n,
          birth: birth + 0.2 + rand() * 0.6,
        });
    });
    count = items.length;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute("position", quad.getAttribute("position"));
    const A = (size) => new Float32Array(count * size);
    const center = A(3),
      normal = A(3),
      birth = A(1),
      angle = A(1),
      size = A(1),
      tile = A(1),
      lift = A(1);
    items.forEach((it, i) => {
      center.set(it.p, i * 3);
      normal.set(it.n, i * 3);
      birth[i] = it.birth;
      angle[i] = rand() * Math.PI * 2;
      size[i] = it.size ?? 0.06 + rand() * 0.035;
      tile[i] = Math.floor(rand() * TILES);
      lift[i] = 0.003 + rand() * 0.012;
    });
    const I = (arr, n) => new THREE.InstancedBufferAttribute(arr, n);
    geo.setAttribute("aCenter", I(center, 3));
    geo.setAttribute("aNormal", I(normal, 3));
    geo.setAttribute("aBirth", I(birth, 1));
    geo.setAttribute("aAngle", I(angle, 1));
    geo.setAttribute("aSize", I(size, 1));
    geo.setAttribute("aTile", I(tile, 1));
    geo.setAttribute("aLift", I(lift, 1));
    geo.instanceCount = count;
    mesh = new THREE.Mesh(geo, ivyMaterial(tex, U));
    mesh.name = "Plantimania_Ivy";
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    ivyScene.add(mesh);
    overlay = overlayLayer(atlasCanvas);
    veil = document.createElement("div");
    veil.className = "ivy-veil";
    veil.setAttribute("aria-hidden", "true");
    document.body.append(overlay.el, veil);
  }
  function play(fromT, toT, now) {
    from = fromT;
    to = toT;
    t0 = now;
  }
  return {
    get stage() {
      return stage;
    },
    /**
     * Draws the ivy as a coarse mosaic over the frame already rendered.
     * Blocks are ~1/120 of the shorter screen side (≈8 px on a laptop).
     */
    render(renderer, camera) {
      if (!mesh || !mesh.visible || stage === 0) return;
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      const block = Math.max(4, Math.round(Math.min(size.x, size.y) / 120));
      const w = Math.max(1, Math.ceil(size.x / block)),
        h = Math.max(1, Math.ceil(size.y / block));
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      const previous = renderer.getRenderTarget();
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      const auto = renderer.autoClear;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(ivyScene, camera);
      renderer.setRenderTarget(previous);
      renderer.setClearColor(clear, alpha);
      renderer.autoClear = false;
      renderer.render(quadScene, quadCamera);
      renderer.autoClear = auto;
    },
    get leaves() {
      return count;
    },
    /** Stage 1: the drawer was opened. */
    grow(now, instant = false) {
      build();
      U.uRetreat.value = 0;
      retreatAt = 0;
      stage = 1;
      play(0, STAGE1.end, instant ? now - 1e5 : now);
      mesh.visible = true;
    },
    /** Stage 2: the drawer was pressed again. */
    invade(now, instant = false) {
      if (stage !== 1) return;
      stage = 2;
      play(U.uTime.value, OVERLAY.leave, instant ? now - 1e5 : now);
      document.body.classList.add("ivy-invasion");
    },
    /** Back into the drawer (closing it during stage 1). */
    retreat(now) {
      if (!mesh || stage === 0) return;
      retreatAt = now;
    },
    /** Advances; returns true while something still moves. */
    update(now) {
      if (!mesh || stage === 0) return false;
      if (retreatAt) {
        const k = Math.min(1, (now - retreatAt) / 900);
        U.uRetreat.value = k;
        if (k >= 1) {
          stage = 0;
          retreatAt = 0;
          mesh.visible = false;
          U.uTime.value = 0;
          return false;
        }
        return true;
      }
      const speed = stage === 2 ? 1 : 1;
      const t = Math.min(to, from + ((now - t0) / 1000) * speed);
      U.uTime.value = t;
      if (stage >= 2) {
        const k = Math.min(
          1,
          Math.max(0, (t - OVERLAY.start) / (OVERLAY.end - OVERLAY.start)),
        );
        overlay.draw(k);
        overlay.el.style.opacity = k > 0 ? "1" : "0";
        const v = Math.min(
          1,
          Math.max(0, (t - OVERLAY.end) / (OVERLAY.green - OVERLAY.end)),
        );
        veil.style.opacity = String(v);
        if (t >= OVERLAY.green && stage === 2) stage = 3;
        if (t >= OVERLAY.leave) {
          onGreen?.();
          return false;
        }
        return true;
      }
      return t < to;
    },
    /** Debug: freeze the ivy timeline at `seconds`. */
    at(seconds) {
      build();
      mesh.visible = true;
      stage = seconds >= STAGE2.start ? 2 : 1;
      from = to = seconds;
      t0 = 0;
      U.uTime.value = seconds;
      if (stage === 2) {
        document.body.classList.add("ivy-invasion");
        overlay.reset();
        const k = Math.min(
          1,
          Math.max(
            0,
            (seconds - OVERLAY.start) / (OVERLAY.end - OVERLAY.start),
          ),
        );
        overlay.draw(k);
        overlay.el.style.opacity = k > 0 ? "1" : "0";
        veil.style.opacity = String(
          Math.min(
            1,
            Math.max(
              0,
              (seconds - OVERLAY.end) / (OVERLAY.green - OVERLAY.end),
            ),
          ),
        );
      }
    },
  };
}
