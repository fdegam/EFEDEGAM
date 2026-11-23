/**
 * The entrance: a small sphere of light made of thousands of tiny points
 * moving like atomic particles — a dense nucleus, electrons on great
 * circles in fourteen planes, a fine cloud filling the volume — slowly
 * turning in 3D. Held down, it beats faster and harder; after 3 s it bursts
 * and its points fly out, while the construction wave (reveal.js) is born
 * where it stood: drawer 023.
 *
 * Plain 2D canvas, no dependencies. Time is real time, not frames.
 */
const HOLD = 3; // seconds to open
const BURST = 0.9; // seconds the burst lasts on screen

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const gauss = () => {
  let u = 0;
  for (let i = 0; i < 6; i++) u += rnd();
  return (u - 3) / 1.4;
};
const unit = () => {
  let x, y, z, d;
  do {
    x = rnd() * 2 - 1;
    y = rnd() * 2 - 1;
    z = rnd() * 2 - 1;
    d = x * x + y * y + z * z;
  } while (d > 1 || d < 1e-4);
  d = Math.sqrt(d);
  return [x / d, y / d, z / d];
};
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

function particles() {
  const P = [];
  for (let i = 0; i < 1100; i++) {
    const [x, y, z] = unit();
    const r = Math.pow(rnd(), 1.8) * 0.32;
    P.push({ kind: 0, x: x * r, y: y * r, z: z * r, ph: rnd() * 6.28, sp: 0.5 + rnd(), b: 0.7 + rnd() * 0.3 });
  }
  const planes = Array.from({ length: 14 }, () => {
    const n = unit();
    const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = cross(n, a);
    const ul = Math.hypot(...u);
    const U = u.map((v) => v / ul);
    return { U, V: cross(n, U), r: 0.55 + rnd() * 0.4, sp: (0.6 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1) };
  });
  for (let i = 0; i < 1700; i++) {
    const pl = planes[i % planes.length];
    P.push({ kind: 1, pl, r: pl.r + gauss() * 0.035, ph: rnd() * 6.28, sp: pl.sp * (0.9 + rnd() * 0.2), b: 0.35 + rnd() * 0.5 });
  }
  for (let i = 0; i < 900; i++) {
    const [x, y, z] = unit();
    const r = Math.cbrt(rnd());
    P.push({ kind: 2, x: x * r, y: y * r, z: z * r, ph: rnd() * 6.28, sp: 0.3 + rnd(), b: 0.12 + rnd() * 0.25 });
  }
  for (const p of P) {
    p.dir = Math.atan2(gauss(), gauss());
    p.v = 0.6 + rnd() * 1.4;
  }
  return P;
}

/**
 * @param canvas  a full-screen canvas over the loader
 * @param onOpen  called once, the moment the sphere bursts
 * @param onHold  called with the hold share (0–1) every frame, for sound
 */
export function createOrb(canvas, { onOpen, onHold } = {}) {
  const g = canvas.getContext("2d");
  const P = particles();
  let cx = 0,
    cy = 0,
    w = 0,
    h = 0;
  let holding = false,
    held = 0, // seconds held (decays when released)
    pressAt = 0,
    heldAtPress = 0,
    burstAt = -1, // < 0 until it bursts, then seconds since
    clock = 0,
    turn = 0,
    phase = 0,
    last = 0,
    frame = 0,
    running = false;

  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function draw() {
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, w, h);
    const burst = burstAt >= 0 ? burstAt : 0;
    const k = Math.min(1, held / HOLD);
    const amp = 0.03 + 0.22 * k * k;
    const pulse = 1 + amp * Math.sin(phase);
    const R = 34 * pulse * (1 - 0.18 * k);
    g.globalCompositeOperation = "lighter";
    if (burst < 0.25) {
      const hr = R * (2.6 + 1.2 * k) * (burst ? 1 + burst * 8 : 1);
      const ha = (0.18 + 0.35 * k) * (burst ? 1 - burst * 4 : 1);
      const halo = g.createRadialGradient(cx, cy, 0, cx, cy, hr);
      halo.addColorStop(0, `rgba(188,216,255,${ha})`);
      halo.addColorStop(0.35, `rgba(188,216,255,${ha * 0.35})`);
      halo.addColorStop(1, "rgba(188,216,255,0)");
      g.fillStyle = halo;
      g.beginPath();
      g.arc(cx, cy, hr, 0, 6.283);
      g.fill();
    }
    const cr = Math.cos(turn),
      sr = Math.sin(turn),
      cx2 = Math.cos(0.4),
      sx2 = Math.sin(0.4);
    for (const p of P) {
      let x, y, z;
      if (p.kind === 1) {
        const a = p.ph + clock * p.sp * 1.6,
          ca = Math.cos(a) * p.r,
          sa = Math.sin(a) * p.r;
        x = p.pl.U[0] * ca + p.pl.V[0] * sa;
        y = p.pl.U[1] * ca + p.pl.V[1] * sa;
        z = p.pl.U[2] * ca + p.pl.V[2] * sa;
      } else {
        const j = p.kind ? 0.05 : 0.03;
        x = p.x + Math.sin(clock * 2.1 * p.sp + p.ph) * j;
        y = p.y + Math.cos(clock * 1.7 * p.sp + p.ph * 1.3) * j;
        z = p.z + Math.sin(clock * 1.3 * p.sp + p.ph * 0.7) * j;
      }
      [x, z] = [x * cr + z * sr, -x * sr + z * cr];
      [y, z] = [y * cx2 - z * sx2, y * sx2 + z * cx2];
      let px = cx + x * R * 1.25,
        py = cy + y * R * 1.25;
      let a = p.b * (0.65 + 0.35 * (z + 1) / 2) * (0.8 + 0.6 * k);
      let size = p.kind === 0 ? 1.1 : 0.9;
      if (burst) {
        const d = burst * burst * 900 * p.v + burst * 260 * p.v;
        const dx = x || Math.cos(p.dir),
          dy = y || Math.sin(p.dir);
        const len = Math.hypot(dx, dy) || 1;
        px += (dx / len) * d;
        py += (dy / len) * d;
        a *= Math.max(0, 1 - burst * 1.6);
        size *= 1 + burst * 2;
      }
      if (a <= 0.01) continue;
      g.fillStyle = `rgba(214,232,255,${Math.min(1, a)})`;
      g.fillRect(px - size / 2, py - size / 2, size, size);
    }
    if (burst) {
      // A flash where the sphere was; no ring: the wave is the room's own.
      const flash = Math.exp(-burst * 9);
      const fr = g.createRadialGradient(cx, cy, 0, cx, cy, 420);
      fr.addColorStop(0, `rgba(230,240,255,${flash})`);
      fr.addColorStop(1, "rgba(188,216,255,0)");
      g.fillStyle = fr;
      g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = "source-over";
  }

  function tick(now) {
    frame = 0;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); // smooth on a slow frame
    last = now;
    if (burstAt < 0) {
      // While held, the clock decides (not the frames): exactly 3 s.
      held = holding ? heldAtPress + (now - pressAt) / 1000 : Math.max(0, held - dt * 1.5);
      if (held >= HOLD) {
        burstAt = 1e-4; // seconds since the burst, in real time
        onOpen?.();
      }
    } else burstAt += dt;
    const k = Math.min(1, held / HOLD);
    onHold?.(burstAt >= 0 ? 0 : k);
    // Faster and deeper beats, faster particles, as the hold goes on.
    phase += dt * 6.283 * (0.8 + 4.5 * k * k);
    clock += dt * (1 + 4 * k);
    turn += dt * 0.35;
    draw();
    if (burstAt > BURST) {
      stop();
      canvas.hidden = true;
      return;
    }
    if (running) frame = requestAnimationFrame(tick);
  }
  function stop() {
    running = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }
  addEventListener("resize", () => running && resize());

  return {
    /** Shows the sphere centred on (x, y), in CSS pixels. */
    show(x, y) {
      cx = x;
      cy = y;
      resize();
      canvas.hidden = false;
      if (!running) {
        running = true;
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    },
    moveTo(x, y) {
      cx = x;
      cy = y;
    },
    hold(down) {
      if (burstAt >= 0 || down === holding) return;
      holding = down;
      if (down) {
        pressAt = performance.now();
        heldAtPress = held;
      }
    },
    get holding() {
      return holding;
    },
    get held() {
      return held;
    },
    get opened() {
      return burstAt >= 0;
    },
  };
}
