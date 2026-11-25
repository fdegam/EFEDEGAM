import * as THREE from "three";

/**
 * A chrome-iridescent bust that rises out of a drawer when it opens, floats
 * above it and gives small hops in the air. A thin iridescent halo wraps it.
 *
 * The bust is the owner's model (assets/models/bust.glb, one mesh, 61k
 * triangles, KHR_materials_iridescence). It follows its drawer: as the drawer
 * slides out the bust comes up and forward, and it sinks back into the drawer
 * when it closes. Time is real time; reduced motion keeps it still in the air.
 */
const RISE = 0.17; // m above the drawer's front when it floats (its centre)
const HOP = 0.035; // m of each small hop
const HOP_PERIOD = 0.62; // s between hops
const SPIN = 0.35; // rad/s, slow turn on its own axis
const SCALE = 1;

const HALO_VERTEX = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const HALO_FRAGMENT = /* glsl */ `
  uniform float uTime, uAmount;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));
    float rim = pow(1.0 - facing, 2.0);
    // Thin-film colour: the hue shifts with the viewing angle and slowly in time.
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (rim * 1.4 + uTime * 0.05 + vec3(0.0, 0.33, 0.67)));
    vec3 tint = mix(vec3(0.85, 0.9, 1.0), film, 0.75);
    gl_FragColor = vec4(tint * rim * uAmount, rim * uAmount);
  }`;

function softGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.35, "rgba(214,224,255,0.35)");
  grad.addColorStop(1, "rgba(214,224,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param scene  three.js scene
 * @param gltf   the loaded bust.glb
 * @returns { update(dt, t, drawer, reduced), group, get height }
 */
export function createBust(scene, gltf) {
  const source = gltf.scene.getObjectByProperty("type", "Mesh");
  const geometry = source.geometry;
  geometry.computeBoundingBox();
  // Stand the bust on its own centre so it turns about its middle.
  const centre = new THREE.Vector3();
  geometry.boundingBox.getCenter(centre);
  geometry.translate(-centre.x, -centre.y, -centre.z);
  const size = new THREE.Vector3();
  geometry.boundingBox.getSize(size);
  const radius = size.length() / 2;

  const group = new THREE.Group();
  group.name = "Bust";
  const body = new THREE.Mesh(geometry, source.material);
  body.name = "Bust_Chrome";
  body.castShadow = false;
  group.add(body);

  // The halo: the same shape a little larger, lit by the viewing angle only.
  const haloMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAmount: { value: 0 } },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
  const halo = new THREE.Mesh(geometry, haloMat);
  halo.scale.setScalar(1.09);
  halo.renderOrder = 4;
  halo.name = "Bust_Halo";
  group.add(halo);

  // A soft glow on the floor-facing side, so the bust lights the air around it.
  const glowMat = new THREE.SpriteMaterial({
    map: softGlowTexture(),
    color: new THREE.Color("#dbe6ff"),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0,
  });
  const glow = new THREE.Sprite(glowMat);
  glow.scale.setScalar(radius * 4.2);
  glow.renderOrder = 3;
  glow.name = "Bust_Glow";
  group.add(glow);

  group.scale.setScalar(SCALE);
  scene.add(group);
  group.visible = false;

  let k = 0; // 0 hidden in the drawer, 1 floating in the air
  let hopClock = 0;
  let spin = 0;
  let lastOffset = 0;
  const anchor = new THREE.Vector3();
  const target = new THREE.Vector3();


  return {
    group,
    get height() {
      return k;
    },
    /**
     * @param dt       seconds since the last frame
     * @param drawer   the bust's drawer ({ node, closedZ, offset, travel })
     * @param reduced  reduced motion: no hops, no spin
     * @returns true while the bust is moving (keep drawing)
     */
    update(dt, drawer, reduced = false) {
      if (!drawer) return false;
      // How far the drawer has come out: 0 closed, 1 fully open.
      const open = THREE.MathUtils.clamp(drawer.offset / (drawer.travel * 0.6), 0, 1);
      const want = open;
      const lerp = 1 - Math.exp(-dt * (want > k ? 5 : 7));
      k += (want - k) * lerp;
      if (k < 0.002) {
        group.visible = false;
        k = 0;
        return false;
      }
      group.visible = true;

      // The drawer's current front (its node already carries the slide):
      // the bust floats just above it, and comes forward with it.
      anchor.set(0, 0, 0);
      drawer.node.getWorldPosition(anchor);
      const baseY = anchor.y + 0.02 + RISE * k;

      // Hops: short bounces while it floats; still when it sinks back in.
      const hopping = !reduced && k > 0.6;
      if (hopping) hopClock += dt;
      const phase = (hopClock % HOP_PERIOD) / HOP_PERIOD;
      const bounce = hopping ? HOP * Math.pow(Math.abs(Math.sin(Math.PI * phase)), 0.9) : 0;

      target.set(anchor.x, baseY + bounce, anchor.z + 0.06);
      group.position.lerp(target, reduced ? 1 : 1 - Math.exp(-dt * 12));

      // Slight squash on each landing, a slow turn on its own axis.
      const land = hopping ? 1 - 0.035 * Math.exp(-phase * 14) : 1;
      if (!reduced) spin += dt * SPIN;
      group.rotation.set(0.12 * Math.sin(spin * 0.7), spin, 0.04 * Math.sin(spin * 0.5));
      group.scale.set(SCALE, SCALE * land, SCALE);

      haloMat.uniforms.uTime.value += dt;
      haloMat.uniforms.uAmount.value = 0.65 * k;
      glowMat.opacity = 0.32 * k;

      const moved = Math.abs(lastOffset - drawer.offset) > 1e-5 || k < 0.998 || hopping;
      lastOffset = drawer.offset;
      return moved || !reduced;
    },
  };
}
