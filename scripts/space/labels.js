import * as THREE from "three";
import { applyReveal } from "./reveal.js";

/**
 * Labels on the fronts of the named drawers, after the owner's reference
 * (a filing drawer with a coloured sticker saying what it holds, and a
 * name card in a metal holder). They are part of the drawer: they open
 * with it and are revealed by the construction wave like the rest.
 *
 * Drawer front, local space: 0.513 × 0.214 m, outer face at z = 0.009,
 * handle recess centred (x ±0.059, y −0.011…0.021).
 */
const FACE_Z = 0.0095;
const STICKER = { w: 0.13, h: 0.058, x: -0.168, y: 0.004 };
const HOLDER = { w: 0.118, h: 0.062, x: 0.168, y: 0.004 };

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")];
}
function texture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/** Luminance, to choose dark or light text on the sticker. */
function isDark(hex) {
  const c = new THREE.Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.35;
}
function fitText(g, text, font, size, maxWidth) {
  let s = size;
  g.font = font.replace("{s}", s);
  while (g.measureText(text).width > maxWidth && s > 10) {
    s -= 2;
    g.font = font.replace("{s}", s);
  }
}

function stickerTexture(name, color) {
  const [c, g] = canvas(520, 232);
  // Paper sticker with slightly rounded corners and a soft printed edge.
  g.fillStyle = color;
  g.beginPath();
  g.roundRect(6, 6, 508, 220, 14);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,0.18)";
  g.lineWidth = 3;
  g.stroke();
  const ink = isDark(color) ? "#f2efe6" : "#1d1d1a";
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const words = name.split(" ");
  const lines =
    words.length > 1 && name.length > 11
      ? [words[0], words.slice(1).join(" ")]
      : [name];
  lines.forEach((line, i) => {
    fitText(g, line, '600 {s}px "DM Sans", sans-serif', 84, 460);
    const y = lines.length === 1 ? 118 : 78 + i * 84;
    g.fillText(line, 260, y);
  });
  return texture(c);
}

function holderTexture(code, place) {
  const [c, g] = canvas(472, 248);
  // Brushed metal frame.
  const metal = g.createLinearGradient(0, 0, 0, 248);
  metal.addColorStop(0, "#e9eae6");
  metal.addColorStop(0.45, "#a9aca6");
  metal.addColorStop(0.55, "#c9cbc6");
  metal.addColorStop(1, "#8d908a");
  g.fillStyle = metal;
  g.beginPath();
  g.roundRect(0, 0, 472, 248, 18);
  g.fill();
  g.strokeStyle = "rgba(40,40,36,0.45)";
  g.lineWidth = 4;
  g.stroke();
  // The card behind the window, with a lip of shadow under the frame.
  g.fillStyle = "#fbfaf5";
  g.fillRect(30, 30, 412, 188);
  g.fillStyle = "rgba(0,0,0,0.14)";
  g.fillRect(30, 30, 412, 10);
  g.fillStyle = "#121210";
  g.textAlign = "center";
  g.textBaseline = "middle";
  if (code) {
    fitText(g, `Nº ${code}`, '500 {s}px "DM Mono", monospace', 76, 380);
    g.fillText(`Nº ${code}`, 236, 104);
    g.font = '500 40px "DM Mono", monospace';
    g.fillText(place, 236, 174);
  } else {
    g.font = '500 34px "DM Mono", monospace';
    g.fillText("ARCHIVO", 236, 92);
    g.font = '500 54px "DM Mono", monospace';
    g.fillText(place, 236, 150);
  }
  // Two rivets.
  for (const x of [16, 456]) {
    g.fillStyle = "#7d807a";
    g.beginPath();
    g.arc(x, 124, 6, 0, Math.PI * 2);
    g.fill();
  }
  return texture(c);
}

function material(map, { roughness, metalness = 0 }) {
  const m = new THREE.MeshStandardMaterial({ map, roughness, metalness });
  m.onBeforeCompile = (shader) => applyReveal(shader);
  m.customProgramCacheKey = () => "efedegam-drawer-label";
  return m;
}

/** Adds sticker + name card to each named drawer; returns the count. */
export function addDrawerLabels(drawers) {
  const sticker = new THREE.PlaneGeometry(STICKER.w, STICKER.h);
  const holder = new THREE.PlaneGeometry(HOLDER.w, HOLDER.h);
  let count = 0;
  for (const d of drawers) {
    if (!d.special) continue;
    const { name, code, sticker: color = "#e0562d" } = d.special;
    const place = d.id.replace("_", " · ");
    const group = new THREE.Group();
    group.name = `Label_${d.id}`;
    const s = new THREE.Mesh(
      sticker,
      material(stickerTexture(name.toUpperCase(), color), { roughness: 0.75 }),
    );
    s.position.set(STICKER.x, STICKER.y, FACE_Z);
    s.rotation.z = (((d.index * 37) % 7) - 3) * 0.004; // stuck on by hand
    const h = new THREE.Mesh(
      holder,
      material(holderTexture(code, place), {
        roughness: 0.45,
        metalness: 0.15,
      }),
    );
    h.position.set(HOLDER.x, HOLDER.y, FACE_Z + 0.0006);
    group.add(s, h);
    d.node.add(group);
    count++;
  }
  return count;
}
