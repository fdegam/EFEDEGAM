import * as THREE from "three";

/**
 * Kraft hanging folders for drawer 023, after the owner's reference photo
 * (Drive › Referencias: an open drawer packed with manila folders, staggered
 * tabs and white labels). The six project folders carry their title and a
 * small mark of their colour; the rest fill the drawer.
 *
 * Drawn as instances (6 draw calls for 32 folders) while each folder still
 * leans, sways and lifts on its own.
 *
 * Interior of a drawer, in its local space (from the Blender model):
 * x ±0.245, y −0.093 (floor) to ~0.10 (rim), z −0.029 (front) to −0.474.
 */
// Leaning back moves each top ~5 cm towards the back: start further forward.
const INNER = { floor: -0.092, front: -0.04, back: -0.405 };
const COUNT = 32;
const PROJECT_SLOTS = [3, 8, 13, 18, 23, 28]; // where the six projects sit
const W = 0.405; // leaf width
const H = 0.168; // back leaf height: tabs reach the rim, as in the photo
const TAB = { width: 0.1, height: 0.024 };
const TAB_X = [-0.12, 0, 0.12]; // staggered tabs
const LABEL = { w: 320, h: 72, cols: 4 };
const LIFT = 0.028; // a hovered project folder rises 2.8 cm

const rand = (() => {
  let s = 230923; // deterministic: the drawer looks the same on every visit
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
})();

function kraftTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#c29f6d";
  g.fillRect(0, 0, 512, 256);
  const img = g.getImageData(0, 0, 512, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rand() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n * 0.9;
    img.data[i + 2] += n * 0.7;
  }
  g.putImageData(img, 0, 0);
  g.globalAlpha = 0.06; // long paper fibres
  for (let i = 0; i < 260; i++) {
    g.strokeStyle = rand() < 0.5 ? "#7a5a33" : "#f1dcb5";
    g.lineWidth = 0.6 + rand();
    const x = rand() * 512,
      y = rand() * 256;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 40, y + (rand() - 0.5) * 6);
    g.stroke();
  }
  // Light lost deep in the drawer: darker towards the bottom of each folder.
  g.globalAlpha = 1;
  const shade = g.createLinearGradient(0, 0, 0, 256);
  shade.addColorStop(0, "rgba(0,0,0,0)");
  shade.addColorStop(0.55, "rgba(30,18,6,0.18)");
  shade.addColorStop(1, "rgba(30,18,6,0.62)");
  g.fillStyle = shade;
  g.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** All labels in one canvas; each folder reads its own cell. */
function labelAtlas(labels) {
  const rows = Math.ceil(labels.length / LABEL.cols);
  const c = document.createElement("canvas");
  c.width = LABEL.w * LABEL.cols;
  c.height = LABEL.h * rows;
  const g = c.getContext("2d");
  labels.forEach(({ text, color }, i) => {
    const ox = (i % LABEL.cols) * LABEL.w,
      oy = Math.floor(i / LABEL.cols) * LABEL.h;
    g.fillStyle = "#f3f0e6";
    g.fillRect(ox, oy, LABEL.w, LABEL.h);
    g.strokeStyle = "rgba(60,50,30,0.25)";
    g.lineWidth = 3;
    g.strokeRect(ox + 1.5, oy + 1.5, LABEL.w - 3, LABEL.h - 3);
    let x = 16;
    if (color) {
      g.fillStyle = color;
      g.fillRect(ox + 12, oy + 18, 14, 36);
      x = 36;
    }
    g.fillStyle = "#2a2a24";
    g.font = `500 ${text.length > 16 ? 25 : 30}px "DM Mono", monospace`;
    g.textBaseline = "middle";
    g.fillText(text.toUpperCase(), ox + x, oy + 38, LABEL.w - x - 10);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { texture: t, rows };
}

/** Back leaf outline with its tab (x centred, y from 0). */
function leafWithTab(tabCentre) {
  const s = new THREE.Shape();
  const hw = W / 2,
    a = tabCentre - TAB.width / 2,
    b = tabCentre + TAB.width / 2;
  s.moveTo(-hw, 0);
  s.lineTo(hw, 0);
  s.lineTo(hw, H);
  s.lineTo(b + 0.006, H);
  s.lineTo(b, H + TAB.height);
  s.lineTo(a, H + TAB.height);
  s.lineTo(a - 0.006, H);
  s.lineTo(-hw, H);
  s.closePath();
  const geo = new THREE.ShapeGeometry(s);
  const uv = geo.attributes.uv; // the kraft texture maps once per folder
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) + hw) / W, uv.getY(i) / (H + TAB.height));
  return geo;
}

export function buildFolders(projects) {
  const kraft = kraftTexture();
  const paper = (color, map) =>
    new THREE.MeshStandardMaterial({
      color,
      map,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });

  // Folder layout: deterministic, packed front to back.
  const step = (INNER.front - INNER.back) / (COUNT - 1);
  const folders = [];
  for (let i = 0; i < COUNT; i++) {
    const projectIndex = PROJECT_SLOTS.indexOf(i);
    folders.push({
      projectIndex,
      tab: i % 3,
      x: (rand() - 0.5) * 0.012,
      y: INNER.floor + (rand() - 0.5) * 0.006,
      z: INNER.front - i * step,
      tilt: -0.26 - rand() * 0.08, // leaning back ~17°, as in the photo
      yaw: (rand() - 0.5) * 0.03,
      roll: (rand() - 0.5) * 0.02,
      sheet:
        projectIndex >= 0 || rand() < 0.35 ? -0.006 + rand() * 0.014 : null,
      swayGain: 0.75 + 0.5 * rand(),
      lift: 0,
      liftV: 0,
    });
  }
  const { texture: atlas, rows } = labelAtlas(
    folders.map((f, i) => {
      const project = projects[f.projectIndex];
      return project
        ? { text: project.title, color: project.color }
        : { text: `EXP. ${String(2300 + i + 1).padStart(4, "0")}` };
    }),
  );

  const group = new THREE.Group();
  group.name = "Drawer_023_Folders";
  const parts = [];
  const add = (geometry, material, members, local) => {
    const mesh = new THREE.InstancedMesh(geometry, material, members.length);
    mesh.frustumCulled = false; // a handful of folders inside one drawer
    mesh.userData.folderOf = members; // instance → folder index (picking)
    group.add(mesh);
    parts.push({ mesh, members, local });
    return mesh;
  };
  const all = folders.map((_, i) => i);
  const kraftBack = paper("#ffffff", kraft);
  TAB_X.forEach((tx, k) =>
    add(
      leafWithTab(tx),
      kraftBack,
      all.filter((i) => folders[i].tab === k),
      () => new THREE.Matrix4(),
    ),
  );
  const front = new THREE.PlaneGeometry(W, H - 0.022);
  front.translate(0, (H - 0.022) / 2, 0);
  front.applyMatrix4(
    new THREE.Matrix4()
      .makeTranslation(0, 0, 0.0045)
      .multiply(new THREE.Matrix4().makeRotationX(0.06)), // a slight V
  );
  add(
    front,
    paper(new THREE.Color(1.04, 1.02, 1), kraft),
    all,
    () => new THREE.Matrix4(),
  );
  const sheet = new THREE.PlaneGeometry(W - 0.03, H);
  sheet.translate(0, H / 2, 0);
  add(
    sheet,
    paper("#ecebe4"),
    all.filter((i) => folders[i].sheet !== null),
    (f) => new THREE.Matrix4().makeTranslation(0, f.sheet, 0.002),
  );
  // Labels: one plane per tab, each instance reading its own atlas cell.
  const labelGeo = new THREE.PlaneGeometry(TAB.width - 0.006, 0.021);
  const cells = new Float32Array(COUNT * 2);
  folders.forEach((_, i) => {
    cells[i * 2] = (i % LABEL.cols) / LABEL.cols;
    cells[i * 2 + 1] = 1 - (Math.floor(i / LABEL.cols) + 1) / rows;
  });
  labelGeo.setAttribute(
    "labelCell",
    new THREE.InstancedBufferAttribute(cells, 2),
  );
  const labelMat = new THREE.MeshStandardMaterial({
    map: atlas,
    roughness: 0.8,
  });
  labelMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec2 labelCell;",
      )
      .replace(
        "#include <uv_vertex>",
        `#include <uv_vertex>\nvMapUv = vMapUv * vec2(${(1 / LABEL.cols).toFixed(6)}, ${(1 / rows).toFixed(6)}) + labelCell;`,
      );
  };
  labelMat.customProgramCacheKey = () => "efedegam-folder-labels";
  add(labelGeo, labelMat, all, (f) =>
    new THREE.Matrix4().makeTranslation(
      TAB_X[f.tab],
      H + TAB.height * 0.78, // the white slip stands proud of the tab
      0.0006,
    ),
  );

  const m = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    p = new THREE.Vector3(),
    one = new THREE.Vector3(1, 1, 1);
  const locals = parts.map(({ members, local }) =>
    members.map((i) => local(folders[i])),
  );
  let sway = 0,
    swayV = 0,
    hovered = -1;
  function place() {
    const frame = folders.map((f) => {
      e.set(f.tilt + sway * f.swayGain, f.yaw, f.roll);
      p.set(f.x, f.y + f.lift, f.z);
      return new THREE.Matrix4().compose(p, q.setFromEuler(e), one);
    });
    parts.forEach(({ mesh, members }, k) => {
      members.forEach((i, j) =>
        mesh.setMatrixAt(j, m.multiplyMatrices(frame[i], locals[k][j])),
      );
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
  place();

  return {
    group,
    /** Index of the project under a raycast hit, or -1 for a filler folder. */
    projectAt(hit) {
      const members = hit.object.userData.folderOf;
      if (!members || hit.instanceId === undefined) return null;
      return folders[members[hit.instanceId]].projectIndex;
    },
    setHovered(index) {
      hovered = index ?? -1;
    },
    /** Returns true while anything is still moving. */
    update(dt, drawerAcceleration) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let s = 0; s < steps; s++) {
        // Inertia: a pendulum (ω≈14 rad/s, ζ≈0.5) on each folder's bottom
        // edge, driven by the drawer's acceleration.
        const a = -196 * sway - 14 * swayV - drawerAcceleration * 1.2;
        swayV += a * h;
        sway += swayV * h;
        for (const f of folders) {
          const goal =
            f.projectIndex >= 0 && f.projectIndex === hovered ? LIFT : 0;
          f.liftV += (420 * (goal - f.lift) - 34 * f.liftV) * h;
          f.lift += f.liftV * h;
        }
      }
      sway = THREE.MathUtils.clamp(sway, -0.09, 0.09);
      let moving = Math.abs(sway) > 3e-4 || Math.abs(swayV) > 4e-3;
      if (!moving) sway = swayV = 0;
      for (const f of folders) {
        const goal =
          f.projectIndex >= 0 && f.projectIndex === hovered ? LIFT : 0;
        if (Math.abs(f.lift - goal) > 2e-4 || Math.abs(f.liftV) > 2e-3)
          moving = true;
        else [f.lift, f.liftV] = [goal, 0];
      }
      place();
      return moving;
    },
  };
}
