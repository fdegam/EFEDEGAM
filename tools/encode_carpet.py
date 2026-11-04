"""Prepare the owner's green velvet carpet photo as a tileable web texture.

    python3 tools/encode_carpet.py /path/to/carpet_photo.jpg [repository]

Source: Google Drive › Recursos › 19abf1b75b40ef7a21814979339c5d01.jpg, the
same photo V20 used (assets/moqueta-verde-terciopelo-v13.jpg in 470a582).
Steps:
- square crop from the centre;
- removes the photo's own lighting (very low frequencies), keeping the
  pile marks and fibre grain, so the repetition does not show as a pattern;
- makes it tile without seams (cross-fading an overlap band on each axis);
- writes assets/models/textures/moqueta.webp (sRGB, no metadata) and a 3×3
  preview next to the source for checking seams.
Requires numpy and Pillow.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src = Path(sys.argv[1])
root = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1]
SIZE, OVERLAP, FLATTEN = 1024, 96, 48  # output px, cross-fade band, blur radius (px): pile marks go, fibre grain stays


def box(a, r):
    for axis in (0, 1):
        pad = [(0, 0)] * a.ndim
        pad[axis] = (r + 1, r)
        c = np.cumsum(np.pad(a, pad, mode='reflect'), axis=axis)
        hi = np.take(c, np.arange(2 * r + 1, c.shape[axis]), axis=axis)
        lo = np.take(c, np.arange(0, c.shape[axis] - 2 * r - 1), axis=axis)
        a = (hi - lo) / (2 * r + 1)
    return a


im = Image.open(src).convert('RGB')
w, h = im.size
side = min(w, h)
crop = im.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
a = np.asarray(crop, dtype=np.float32) / 255.0
lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)

# Flatten the photo's lighting in linear light, keeping its mean colour.
low = lin
for _ in range(3):
    low = box(low, FLATTEN // 3)
lin = lin / np.maximum(low, 1e-4) * lin.reshape(-1, 3).mean(0)

# Tile: the last OVERLAP px of each axis fade into the first ones.
n = side - OVERLAP
t = np.linspace(0, 1, OVERLAP, dtype=np.float32)
x = lin[:, :n].copy()
x[:, :OVERLAP] = lin[:, n:] * (1 - t)[None, :, None] + lin[:, :OVERLAP] * t[None, :, None]
y = x[:n].copy()
y[:OVERLAP] = x[n:] * (1 - t)[:, None, None] + x[:OVERLAP] * t[:, None, None]

enc = np.clip(y, 0, 1)
enc = np.where(enc <= 0.0031308, enc * 12.92, 1.055 * np.power(enc, 1 / 2.4) - 0.055)
tile = Image.fromarray((enc * 255 + 0.5).astype(np.uint8)).resize((SIZE, SIZE), Image.LANCZOS)
out = root / 'assets/models/textures'
out.mkdir(parents=True, exist_ok=True)
path = out / 'moqueta.webp'
tile.save(path, 'WEBP', quality=82, method=6)  # Pillow writes no EXIF unless asked
print(path.name, path.stat().st_size, 'bytes', 'mean sRGB', np.asarray(tile).reshape(-1, 3).mean(0).round(1))

preview = Image.new('RGB', (SIZE * 3 // 2, SIZE * 3 // 2))
small = tile.resize((SIZE // 2, SIZE // 2))
for i in range(3):
    for j in range(3):
        preview.paste(small, (i * SIZE // 2, j * SIZE // 2))
preview.save(src.with_name('moqueta_mosaico_3x3.png'))
