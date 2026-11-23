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
  let lastPower = 0; // silent until the room opens (app.js sets it)
  let chargeVoice = null;
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
    ctx.addEventListener?.("statechange", playIntro);
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
    if (ctx && !muted && ctx.state !== "running")
      ctx.resume().then(playIntro, () => {});
    else playIntro();
  }
  // On a phone a finger only counts as a gesture when it lifts.
  for (const name of ["pointerdown", "pointerup", "keydown", "touchend", "click"])
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

  /* The entrance sound (see intro()). */
  let pendingIntro = null,
    introState = null;
  function playIntro() {
    const run = pendingIntro;
    if (!run || !ctx || muted || ctx.state !== "running") return;
    pendingIntro = null;
    const t = ctx.currentTime;
    const elapsed = (performance.now() - run.startMs) / 1000;
    const T0 = t - elapsed; // the burst, in the audio clock (may be past)
    const [w0, w1] = run.wave.map((v) => T0 + v / 1000);
    introState = { elapsed: Math.round(elapsed * 1000) / 1000, played: [] };
    if (elapsed > 4.5) return; // the room is long built: only the hum
    const ease = (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
    const future = (at) => at >= t - 0.02;

    // A bus with its own small hall, so it all sounds like the room.
    const bus = ctx.createGain();
    const hall = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    hall.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    bus.connect(master);
    bus.connect(hall).connect(wet).connect(master);
    const end = w1 + 3;

    // 1 · The burst: a soft deep thump and a bright crackle of particles.
    // A late start (up to 0.35 s) still gets it, at once: it is the cue.
    if (elapsed < 0.35) {
      const B = Math.max(T0, t);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(70, B);
      o.frequency.exponentialRampToValueAtTime(34, B + 0.9);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, B);
      g.gain.linearRampToValueAtTime(0.2, B + 0.02);
      g.gain.exponentialRampToValueAtTime(1e-4, B + 1.2);
      o.connect(g).connect(bus);
      o.start(B);
      o.stop(B + 1.3);
      for (let k = 0; k < 40; k++) {
        const at = B + Math.pow(Math.random(), 2) * 0.6;
        const n = ctx.createBufferSource();
        n.buffer = noise;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2500 + Math.random() * 6000;
        f.Q.value = 3;
        const e = ctx.createGain();
        const l = 0.01 + Math.random() * 0.04;
        e.gain.setValueAtTime(0, at);
        e.gain.linearRampToValueAtTime(0.03 + Math.random() * 0.05, at + 0.002);
        e.gain.exponentialRampToValueAtTime(1e-4, at + l);
        n.connect(f).connect(e).connect(bus);
        n.start(at, Math.random() * 1.5, l + 0.05);
      }
      introState.played.push("burst");
    }

    // 2 · The wave: a cold airy sweep and a rising chord, cut to what is left.
    const from = Math.max(t, w0);
    if (from < w1 - 0.05) {
      const u0 = (from - w0) / (w1 - w0);
      const span = w1 - from;
      const part = (a, b) =>
        Float32Array.from({ length: 48 }, (_, i) => a * Math.pow(b / a, ease(u0 + ((1 - u0) * i) / 47)));
      const level = (u, peak) => (u < 0.5 ? (peak * u) / 0.5 : peak - (peak - peak * 0.43) * ((u - 0.5) / 0.5));
      const air = ctx.createBufferSource();
      air.buffer = noise;
      air.loop = true;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 2.2;
      band.frequency.setValueCurveAtTime(part(160, 5200), from, span);
      const ag = ctx.createGain();
      ag.gain.setValueAtTime(level(u0, 0.07), from);
      if (u0 < 0.5) ag.gain.linearRampToValueAtTime(0.07, w0 + (w1 - w0) * 0.5);
      ag.gain.linearRampToValueAtTime(0.03, w1);
      ag.gain.linearRampToValueAtTime(0, w1 + 0.9);
      air.connect(band).connect(ag).connect(bus);
      air.start(from, Math.random());
      air.stop(end);
      [523.25, 783.99, 1046.5, 1567.98].forEach((f, i) => {
        const o = ctx.createOscillator();
        o.type = i % 2 ? "triangle" : "sine";
        o.detune.value = (i - 1.5) * 6;
        o.frequency.setValueCurveAtTime(part(f * 0.5, f), from, span);
        const g = ctx.createGain();
        const peak = 0.012 / (1 + i * 0.6);
        g.gain.setValueAtTime(Math.min(peak, (peak * u0) / 0.55), from);
        g.gain.linearRampToValueAtTime(peak, Math.max(from, w0 + (w1 - w0) * 0.55));
        g.gain.linearRampToValueAtTime(0, w1 + 1.2);
        o.connect(g).connect(bus);
        o.start(from);
        o.stop(end);
      });
      // Glints along the edges, panned across the room.
      for (let k = 0; k < 70; k++) {
        let u;
        do u = Math.random();
        while (Math.random() > 6 * u * (1 - u) * 0.66);
        const at = w0 + u * (w1 - w0);
        if (!future(at)) continue;
        const o = ctx.createOscillator();
        o.frequency.value = 2400 + ease(u) * 5600 + Math.random() * 1400;
        const g = ctx.createGain();
        const l = 0.04 + Math.random() * 0.12;
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.006 + Math.random() * 0.01, at + 0.004);
        g.gain.exponentialRampToValueAtTime(1e-4, at + l);
        const pan = ctx.createStereoPanner();
        pan.pan.value = (Math.random() * 2 - 1) * (0.3 + 0.6 * u);
        o.connect(g).connect(pan).connect(bus);
        o.start(at);
        o.stop(at + l + 0.05);
      }
      introState.played.push("wave");
    }

    // 3 · The tubes coming on, zone by zone (twelve per zone).
    let tubesLeft = 0;
    for (const z of run.zones)
      for (let k = 0; k < 12; k++) {
        const at = T0 + (z + Math.random() * run.flicker) / 1000;
        if (!future(at)) continue;
        tubeClick(at, 1);
        if (Math.random() < 0.5) tubeClick(at + 0.06 + Math.random() * 0.12, 0.6);
        tubesLeft++;
      }
    if (tubesLeft) introState.played.push("tubes");
  }

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
    /** Called from a gesture handler: creates or resumes the context. */
    unlock,
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
    /**
     * The sphere being held: a soft, rising charge (0–1) under its beat;
     * 0 silences it (released, or the burst took over).
     */
    charge(k) {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (!chargeVoice) {
        if (k <= 0) return;
        const o1 = ctx.createOscillator();
        const o2 = ctx.createOscillator();
        o2.type = "triangle";
        const gain = ctx.createGain();
        gain.gain.value = 0;
        o1.connect(gain);
        o2.connect(gain);
        gain.connect(master);
        o1.start();
        o2.start();
        chargeVoice = { o1, o2, gain };
      }
      const { o1, o2, gain } = chargeVoice;
      o1.frequency.setTargetAtTime(70 + 190 * k * k, t, 0.05);
      o2.frequency.setTargetAtTime(140 + 520 * k * k, t, 0.05);
      gain.gain.setTargetAtTime(muted ? 0 : 0.05 * Math.pow(k, 1.4), t, k > 0 ? 0.08 : 0.03);
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
      if (!ctx || muted) return;
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
    /**
     * The entrance's sound, anchored to the moment the sphere bursts and
     * the construction starts (`startMs`, in performance.now() time). If
     * the audio already runs, it all plays from the start; if it only
     * starts later (on a phone a finger counts as a gesture when it lifts)
     * it joins where the animation is: what is past is skipped and the
     * sweep is cut to end with the wave. Never out of step.
     */
    intro(startMs, { wave, zones, flicker }) {
      pendingIntro = { startMs, wave, zones, flicker };
      this.charge(0);
      playIntro();
    },
    /** Kept for the debug path: the entrance sound starting now. */
    build(timing) {
      pendingIntro = { startMs: performance.now(), ...timing };
      playIntro();
    },
    /** For tests: how the entrance sound was scheduled (or not yet). */
    get introState() {
      return introState;
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
