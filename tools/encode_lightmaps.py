"""Clean and encode the baked lightmaps for the web.

    python3 tools/encode_lightmaps.py /path/to/bake_work_dir [repository]

Reads lightmap_<name>_linear.npy written by tools/bake_lightmaps.py (linear
light, already divided by the intensity factor stored in room.json), then:
- removes residual Cycles noise with a short blur that never mixes baked
  texels with empty atlas space (normalised box-blur);
- dilates islands into the empty space around them, so mipmaps stay clean;
- encodes to sRGB with light dithering, so wall gradients do not band;
- writes assets/models/lightmaps/<name>.webp.
Requires numpy and Pillow (with WebP support).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

work = Path(sys.argv[1])
root = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1]
out = root / 'assets/models/lightmaps'
out.mkdir(parents=True, exist_ok=True)
# Blur radius in texels: the room is soft light; the archive keeps the
# sharp shadows of handles and the gaps between fronts.
RADIUS = {'room': (2, 2), 'archive': (1, 1)}  # (texels, passes)


def box(a, r):
    """Box blur along both axes using cumulative sums (edges clamped)."""
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode='edge'), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


def encode(lin, path):
    enc = np.clip(lin, 0, 1)
    enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
    rng = np.random.default_rng(7)
    enc = enc * 255 + rng.uniform(-0.5, 0.5, enc.shape)
    img = Image.fromarray(np.clip(enc + 0.5, 0, 255).astype(np.uint8))
    img.save(path, 'WEBP', quality=90, method=6)
    print(path.name, path.stat().st_size, 'bytes')


env = work / 'env_linear.npy'
if env.exists():
    lin = np.load(env).astype(np.float32)
    # The panorama looks at the archive (+Y in Blender) at its centre column;
    # three.js expects that direction (-Z) at a quarter of the width.
    lin = np.roll(lin, -lin.shape[1] // 4, axis=1)
    encode(lin, out / 'env.webp')

def dilate(lin, mask, steps=6):
    """Fill empty texels next to islands (mipmaps must not pull in black)."""
    lin, mask = lin.copy(), mask.copy()
    for _ in range(steps):
        num = box(lin * mask, 1)
        den = box(mask, 1)
        grow = (mask[..., 0] == 0) & (den[..., 0] > 0)
        lin[grow] = (num / np.maximum(den, 1e-6))[grow]
        mask[grow] = 1
    return lin


for name, (r, passes) in RADIUS.items():
    lin = np.load(work / f'lightmap_{name}_linear.npy').astype(np.float32)
    mask = (lin.max(axis=2) > 1e-6).astype(np.float32)[..., None]
    if r:
        num, den = lin * mask, mask
        for _ in range(passes):
            num, den = box(num, r), box(den, r)
        lin = np.where(mask > 0, num / np.maximum(den, 1e-6), lin)
    encode(dilate(lin, mask), out / f'{name}.webp')
