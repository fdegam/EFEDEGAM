"""Prepare the owner's security camera model for the camera wall.

    python tools/prepare_camera.py /path/to/camara_seguridad_hd.glb [repository]

(run with Blender's Python: `blender -b -P` or the `bpy` module from PyPI)

The owner's model (26 named parts, millimetre-scale, lens towards +Z, wall
plate behind at -Z) becomes assets/models/camera.glb with two nodes:
- `Base`: what stays on the wall (plate, screws, arm base, arm, ball cup,
  locking ring);
- `Head`: what turns to watch the visitor (housing, sunshield, lens, LED,
  cable, mounting plate, stem and ball), its origin at the ball joint.
Both are scaled to real size (SCALE) and simplified for a wall of ~40
cameras: small or curved parts are decimated, the tiny back-cover screws
are dropped. Then compress it:

    npx --yes gltfpack@0.24.0 -i assets/models/camera.glb -o assets/models/camera.glb -cc -noq -kn -km
"""
import sys
from pathlib import Path

import bpy

src = Path(sys.argv[-2] if len(sys.argv) > 2 else sys.argv[-1])
root = Path(sys.argv[-1]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1]
SCALE = 2.6  # the model's housing is 9.6 cm; a real one is about 25 cm

BASE = {"Placa de pared", "Tornillos pared", "Base del brazo", "Brazo", "Copa rótula", "Anillo de bloqueo"}
DROP = {"Tornillos tapa"}  # 896 triangles nobody can see from the room
DECIMATE = {  # ratio of triangles kept
    "Cable": 0.06,
    "Brazo": 0.12,
    "Visera": 0.22,
    "Rótula": 0.15,
    "Objetivo": 0.18,
    "Anillo moleteado": 0.12,
    "Cristal objetivo": 0.1,
    "Anillo interior": 0.3,
    "LED": 0.15,
    "Tornillos visera": 0.15,
    "Tornillos pletina": 0.15,
    "Tornillos pared": 0.12,
    "Prensaestopas": 0.25,
    "Base del brazo": 0.3,
    "Copa rótula": 0.3,
    "Anillo de bloqueo": 0.25,
    "Separadores visera": 0.3,
    "Vástago": 0.4,
    "Carcasa": 0.6,
    "Marco frontal": 0.5,
    "Tapa trasera": 0.5,
    "Juntas": 0.4,
    "Ventana": 0.5,
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(src))

meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
# The ball joint's centre (in the model's own space) is the head's pivot.
ball = next(o for o in meshes if o.name.startswith("Rótula"))
bpy.context.view_layer.update()
from mathutils import Vector  # noqa: E402

corners = [ball.matrix_world @ Vector(c) for c in ball.bound_box]
pivot = sum(corners, Vector()) / 8

def base_name(o):
    return o.name.split(".")[0]

for o in list(meshes):
    name = base_name(o)
    if name in DROP:
        bpy.data.objects.remove(o, do_unlink=True)
        meshes.remove(o)
        continue
    ratio = DECIMATE.get(name)
    if ratio:
        mod = o.modifiers.new("decimate", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        o.select_set(False)
    # Bake transforms so joining keeps every part where it was.
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
    o.parent = None

def join(parts, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj

base_parts = [o for o in meshes if base_name(o) in BASE]
head_parts = [o for o in meshes if base_name(o) not in BASE]
base = join(base_parts, "Base")
head = join(head_parts, "Head")
for obj, origin in ((base, Vector()), (head, pivot)):
    # Origin: the model's own for the base, the ball joint for the head.
    obj.data.transform(__import__("mathutils").Matrix.Translation(-origin))
    obj.location = origin * SCALE
    obj.data.transform(__import__("mathutils").Matrix.Scale(SCALE, 4))
    # Normals: rounded where the parts are round, crisp at the housing's
    # edges (the imported custom normals do not survive the decimation).
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    if obj.data.has_custom_normals:
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=0.61)
for o in list(bpy.context.scene.objects):
    if o not in (base, head):
        bpy.data.objects.remove(o, do_unlink=True)

tris = sum(len(p.vertices) - 2 for o in (base, head) for p in o.data.polygons)
print(f"pivot {tuple(round(v * SCALE, 4) for v in pivot)} triangles {tris}")
out = root / "assets/models/camera.glb"
bpy.ops.export_scene.gltf(
    filepath=str(out),
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_yup=True,
    export_texcoords=False,
    export_normals=True,
    export_materials="EXPORT",
)
print("wrote", out)
