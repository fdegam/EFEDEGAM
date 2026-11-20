"""Take the carpet's textures out of room.glb, so the model downloads lighter.

    python3 tools/split_carpet_textures.py [repository]

gltfpack keeps the .blend's carpet maps inside the GLB as PNG (765 KB):
- the colour map is never shown: the owner's photo replaces it
  (tools/encode_carpet.py, assets/models/textures/moqueta.webp);
- the normal map (pile relief) is written as WebP next to the photo,
  assets/models/textures/moqueta-normal.webp (~95 KB), and loaded in
  parallel with the model (scripts/space/app.js, room.json › carpet.normal).

The GLB is rewritten without its images: the bytes of buffer 0 that held
them are removed and every offset and buffer-view index is shifted. Run it
once after each export; it does nothing if the GLB has no images left.
Requires Pillow.
"""
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1]
glb_path = root / 'assets/models/room.glb'
config_path = root / 'assets/models/room.json'
NORMAL_FILE = 'textures/moqueta-normal.webp'

data = glb_path.read_bytes()
magic, version, _ = struct.unpack('<4sII', data[:12])
assert magic == b'glTF' and version == 2
json_len, json_type = struct.unpack('<I4s', data[12:20])
assert json_type == b'JSON'
gltf = json.loads(data[20:20 + json_len])
bin_len, bin_type = struct.unpack('<I4s', data[20 + json_len:28 + json_len])
assert bin_type == b'BIN\x00'
binary = data[28 + json_len:28 + json_len + bin_len]

images = gltf.get('images', [])
if not images:
    print('room.glb has no images: nothing to do')
    sys.exit(0)

config = json.loads(config_path.read_text())
carpet_name = config['carpet']['material']
material = next(m for m in gltf['materials'] if m['name'] == carpet_name)
normal = material.pop('normalTexture')
material.get('pbrMetallicRoughness', {}).pop('baseColorTexture', None)
for m in gltf['materials']:
    text = json.dumps(m)
    assert '"index"' not in text, f'{m["name"]} still uses a texture'


def view_bytes(index):
    view = gltf['bufferViews'][index]
    start = view.get('byteOffset', 0)
    return binary[start:start + view['byteLength']]


# The normal map, as WebP (quality 88: the pile relief has no hard edges).
source = gltf['textures'][normal['index']]['source']
picture = Image.open(io.BytesIO(view_bytes(images[source]['bufferView']))).convert('RGB')
picture.save(root / 'assets/models' / NORMAL_FILE, 'WEBP', quality=88, method=6)

# Drop the image views; they must sit together at the start of buffer 0.
dropped = sorted(image['bufferView'] for image in images)
views = gltf['bufferViews']
assert all(views[i]['buffer'] == 0 for i in dropped)
cut = max(views[i].get('byteOffset', 0) + views[i]['byteLength'] for i in dropped)
cut = (cut + 3) // 4 * 4
for i, view in enumerate(views):
    if i in dropped:
        continue
    ext = view.get('extensions', {}).get('EXT_meshopt_compression')
    for holder in (view, ext):
        if holder and holder['buffer'] == 0:
            assert holder.get('byteOffset', 0) >= cut, 'images are not at the start'
            holder['byteOffset'] = holder.get('byteOffset', 0) - cut
remap = {}
kept = []
for i, view in enumerate(views):
    if i not in dropped:
        remap[i] = len(kept)
        kept.append(view)
gltf['bufferViews'] = kept
for accessor in gltf['accessors']:
    if 'bufferView' in accessor:
        accessor['bufferView'] = remap[accessor['bufferView']]
    sparse = accessor.get('sparse')
    if sparse:
        for part in (sparse['indices'], sparse['values']):
            part['bufferView'] = remap[part['bufferView']]
for key in ('images', 'textures', 'samplers'):
    gltf.pop(key, None)
binary = binary[cut:]
gltf['buffers'][0]['byteLength'] = len(binary)

out_json = json.dumps(gltf, separators=(',', ':')).encode()
out_json += b' ' * (-len(out_json) % 4)
binary += b'\x00' * (-len(binary) % 4)
total = 12 + 8 + len(out_json) + 8 + len(binary)
glb_path.write_bytes(
    struct.pack('<4sII', b'glTF', 2, total)
    + struct.pack('<I4s', len(out_json), b'JSON') + out_json
    + struct.pack('<I4s', len(binary), b'BIN\x00') + binary
)

config['carpet']['normal'] = {'file': NORMAL_FILE, 'scale': normal.get('scale', 1)}
config_path.write_text(json.dumps(config, indent=2) + '\n')
print(f'room.glb {len(data)} -> {total} bytes; {NORMAL_FILE} written')
