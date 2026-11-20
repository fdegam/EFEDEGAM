/**
 * The room's sound, synthesised with Web Audio: no files, no downloads.
 *
 * - the fluorescent hum (100 Hz and harmonics of the 50 Hz mains, a faint
 *   hiss), always there, following how many tubes are on;
 * - tubes: starter clicks and buzz when they come on, fail or go out;
 * - the «Ctrl» key's mechanical click;
 * - drawers: ball-bearing runners while they move, a padded knock on closing;
 * - the construction: a soft, cold sweep following the wave;
 * - the ivy: leaves rustling, denser as it invades;
 * - the person of light: suspended particles, a faint airy shimmer that
 *   grows as you approach and when the pointer stirs it.
 *
 * Browsers only allow sound after a gesture: the context is created at once
 * (it may already run for returning visitors) and resumed on the first
 * pointer or key press. The visitor can mute it; the choice is remembered.
 */
const STORE = "efedegam-sound";

function readMuted() {
  try {
    return localStorage.getItem(STORE) === "off";
  } catch {
    return false;
  }
}
function writeMuted(muted) {
  try {
    localStorage.setItem(STORE, muted ? "off" : "on");
  } catch {
    /* private mode: the choice lasts for this visit only */
  }
}

export function createSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  let muted = readMuted();
  let ctx = null;
  let master, hum, hiss, slide, slideFilter, particles, particlesFilter;
  let noise = null;
  let lastPower = 1;
  let grainClock = 0;
  const listeners = new Set();

  function build() {
    if (ctx || !AudioContext) return;
    try {
      ctx = new AudioContext();
    } catch {
      ctx = null;
      return;
    }
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -18;
    out.ratio.value = 3;
    master.connect(out).connect(ctx.destination);

    // White noise, reused by every noisy voice.
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    // Hum: 100 Hz with weaker harmonics, slightly unsteady, plus hiss.
    hum = ctx.createGain();
    hum.gain.value = 0;
    hum.connect(master);
    [
      [100, 0.5, "sine"],
      [200, 0.22, "sine"],
      [300, 0.1, "sine"],
      [100, 0.05, "sawtooth"],
    ].forEach(([f, g, type]) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.value = g;
      if (type === "sawtooth") {
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 900;
        o.connect(lp).connect(gain);
      } else o.connect(gain);
      gain.connect(hum);
      o.start();
    });
    const wobble = ctx.createOscillator();
    wobble.frequency.value = 0.31;
    const wobbleDepth = ctx.createGain();
    wobbleDepth.gain.value = 0.006;
    wobble.connect(wobbleDepth).connect(hum.gain);
    wobble.start();
    hiss = ctx.createGain();
    hiss.gain.value = 0;
    const hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 5200;
    hissFilter.Q.value = 0.6;
    loop().connect(hissFilter).connect(hiss).connect(master);

    // Drawer runners: filtered noise whose level follows the speed.
    slide = ctx.createGain();
    slide.gain.value = 0;
    slideFilter = ctx.createBiquadFilter();
    slideFilter.type = "bandpass";
    slideFilter.frequency.value = 700;
    slideFilter.Q.value = 1.4;
    const rattle = ctx.createGain();
    rattle.gain.value = 0.6;
    const rattleLfo = ctx.createOscillator();
    rattleLfo.type = "square";
    rattleLfo.frequency.value = 23;
    const rattleDepth = ctx.createGain();
    rattleDepth.gain.value = 0.35;
    rattleLfo.connect(rattleDepth).connect(rattle.gain);
    rattleLfo.start();
    loop().connect(slideFilter).connect(rattle).connect(slide).connect(master);

    // Suspended particles: a high, airy bed (grains are added on top).
    particles = ctx.createGain();
    particles.gain.value = 0;
    particlesFilter = ctx.createBiquadFilter();
    particlesFilter.type = "bandpass";
    particlesFilter.frequency.value = 7000;
    particlesFilter.Q.value = 1.8;
    loop().connect(particlesFilter).connect(particles).connect(master);

    setPower(lastPower, true);
    listeners.forEach((fn) => fn());
  }
  function loop() {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.loopStart = Math.random();
    source.start(0, Math.random() * 1.5);
    return source;
  }
  const live = () => ctx && ctx.state === "running" && !muted;

  /** A short filtered noise burst. */
  function burst(when, { freq = 3000, q = 1, gain = 0.1, length = 0.012, type = "bandpass" }) {
    const source = ctx.createBufferSource();
    source.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.002);
    env.gain.exponentialRampToValueAtTime(1e-4, when + length);
    source.connect(filter).connect(env).connect(master);
    source.start(when, Math.random() * 1.5, length + 0.05);
  }
  /** A decaying tone (ballast ping, glints). */
  function tone(when, { freq, gain = 0.05, length = 0.06, type = "sine" }) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(gain, when + 0.003);
    env.gain.exponentialRampToValueAtTime(1e-4, when + length);
    o.connect(env).connect(master);
    o.start(when);
    o.stop(when + length + 0.05);
  }
  /** One tube's starter: a click, a short buzz and sometimes a ping. */
  function tubeClick(when, strength = 1) {
    burst(when, { freq: 2600, q: 0.8, gain: 0.09 * strength, length: 0.014 });
    tone(when, { freq: 100, type: "sawtooth", gain: 0.035 * strength, length: 0.09 });
    if (Math.random() < 0.4)
      tone(when + 0.004, { freq: 3200 + Math.random() * 1600, gain: 0.012 * strength, length: 0.05 });
  }

  function setPower(power, instant = false) {
    lastPower = power;
    if (!ctx) return;
    const t = ctx.currentTime;
    const level = 0.03 * Math.max(0, (power - 0.03) / 0.97);
    hum.gain.setTargetAtTime(level, t, instant ? 0.01 : 0.06);
    hiss.gain.setTargetAtTime(level * 0.5, t, instant ? 0.01 : 0.06);
  }

  function unlock() {
    if (!ctx) build();
    if (ctx && !muted && ctx.state !== "running") ctx.resume().catch(() => {});
  }
  for (const name of ["pointerdown", "keydown", "touchstart"])
    addEventListener(name, unlock, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else if (!muted) ctx.resume().catch(() => {});
  });
  // Returning visitors may be allowed to hear the construction at once.
  // Built at once only where the browser already allows sound (an earlier
  // visit with activity); otherwise on the first gesture, which avoids a warning.
  if (!muted && navigator.userActivation?.hasBeenActive) build();

  return {
    get muted() {
      return muted;
    },
    get running() {
      return !!ctx && ctx.state === "running";
    },
    get created() {
      return !!ctx;
    },
    onReady(fn) {
      listeners.add(fn);
    },
    setMuted(value) {
      muted = value;
      writeMuted(muted);
      if (!ctx && !muted) build();
      if (!ctx) return;
      master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.08);
      if (!muted) ctx.resume().catch(() => {});
    },
    /** Room light level 0.03–1 (lightsState().power). */
    setPower(power) {
      if (Math.abs(power - lastPower) > 1e-3) setPower(power);
    },
    /** The «Ctrl» key: down and up of a mechanical switch. */
    keyClick(down = true) {
      if (!live()) return;
      const t = ctx.currentTime;
      burst(t, { freq: down ? 2200 : 3400, q: 1.2, gain: down ? 0.12 : 0.07, length: 0.018 });
      burst(t, { freq: 180, q: 0.7, gain: down ? 0.08 : 0.04, length: 0.03, type: "lowpass" });
    },
    /** Tubes switching: `delays` in ms, one per tube that changes. */
    tubes(delays, on) {
      if (!live()) return;
      const t = ctx.currentTime;
      for (const d of delays) {
        const when = t + d / 1000;
        tubeClick(when, on ? 1 : 0.6);
        if (on && Math.random() < 0.5) tubeClick(when + 0.06 + Math.random() * 0.12, 0.6);
      }
    },
    /** A failing tube: a click at every dip of its flicker. */
    flicker({ steps, duration, panels }) {
      if (!live()) return;
      const t = ctx.currentTime;
      const step = duration / steps.length / 1000;
      steps.forEach((v, i) => {
        if (i > 0 && Math.abs(v - steps[i - 1]) > 0.4)
          tubeClick(t + i * step, 0.5 + 0.25 * panels.length);
      });
    },
    /** The construction: a cold sweep under the growing wave. */
    build(durationMs) {
      if (!live()) return;
      const t = ctx.currentTime;
      const d = durationMs / 1000;
      const source = ctx.createBufferSource();
      source.buffer = noise;
      source.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(260, t);
      filter.frequency.exponentialRampToValueAtTime(3800, t + d * 0.7);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, t);
      env.gain.linearRampToValueAtTime(0.05, t + d * 0.35);
      env.gain.linearRampToValueAtTime(0, t + d);
      source.connect(filter).connect(env).connect(master);
      source.start(t);
      source.stop(t + d + 0.1);
      // Glassy partials, like the light catching the edges.
      [1320, 1980, 2640].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(f * 0.5, t);
        o.frequency.exponentialRampToValueAtTime(f, t + d * 0.7);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.006 / (i + 1), t + d * 0.4);
        g.gain.linearRampToValueAtTime(0, t + d);
        o.connect(g).connect(master);
        o.start(t);
        o.stop(t + d + 0.1);
      });
    },
    /** Called every rendered frame with what is moving in the room. */
    update(dt, { drawerSpeed = 0, closing = false, ivyRate = 0, figureNear = 0, stir = 0 }) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const speed = Math.min(1, drawerSpeed / 0.9);
      slide.gain.setTargetAtTime(0.11 * speed, t, 0.03);
      slideFilter.frequency.setTargetAtTime(500 + 900 * speed, t, 0.05);
      const air = figureNear * (0.25 + 0.75 * Math.min(1, stir * 3));
      particles.gain.setTargetAtTime(0.012 * air, t, 0.2);
      if (!live()) return;
      if (closing) {
        burst(t, { freq: 160, q: 0.8, gain: 0.16, length: 0.09, type: "lowpass" });
        tone(t, { freq: 85, gain: 0.07, length: 0.12 });
      }
      // Grains: leaves and particles, at a rate per second.
      grainClock += dt;
      const leafRate = ivyRate * 90;
      const glintRate = figureNear * (2 + 14 * Math.min(1, stir * 3));
      const n = Math.min(12, Math.round((leafRate + glintRate) * dt + Math.random() - 0.5));
      for (let i = 0; i < n; i++) {
        const when = t + Math.random() * dt;
        if (Math.random() * (leafRate + glintRate) < leafRate)
          burst(when, {
            freq: 1800 + Math.random() * 4200,
            q: 2 + Math.random() * 3,
            gain: 0.02 + Math.random() * 0.04 * ivyRate,
            length: 0.012 + Math.random() * 0.03,
          });
        else
          tone(when, {
            freq: 5200 + Math.random() * 4800,
            gain: 0.0025 + Math.random() * 0.004,
            length: 0.03 + Math.random() * 0.09,
          });
      }
    },
  };
}
