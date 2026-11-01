"""Run in Blender with --factory-startup --disable-autoexec.

blender --background --factory-startup --disable-autoexec /private/model.blend \
  --python tools/export_room.py -- /path/to/repository

Does not save or modify the input .blend. Writes a sanitized web export and
camera metadata. The original source must stay outside the public checkout.
"""
import bpy
import json
import math
from mathutils import Vector
from pathlib import Path
import sys

root = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
scene = bpy.context.scene
scene.frame_set(1)
camera = scene.camera
assert camera and camera.type == 'CAMERA', 'The reference camera is required.'
rotation = __import__('mathutils').Quaternion((1, 0, 0), -math.pi / 2)
position = rotation @ camera.matrix_world.translation
quaternion = rotation @ camera.matrix_world.to_quaternion()
aspect = scene.render.resolution_x / scene.render.resolution_y
fov = math.degrees(2 * math.atan(math.tan(camera.data.angle_x / 2) / aspect))
config = {
    'camera': {'position': list(position), 'quaternion': [quaternion.x, quaternion.y, quaternion.z, quaternion.w], 'fov': fov, 'referenceAspect': aspect},
    'walkBounds': {'minX': -3.05, 'maxX': 3.05, 'minZ': 1.0, 'maxZ': 6.9},
    'projectDrawer': 'CAJON_C07_F06',
    'drawerTravel': 0.34,
    'source': 'Owner-provided room; exported without scripts, custom properties, source paths, cameras or lights.',
}
(root / 'assets/models/room.json').write_text(json.dumps(config, indent=2) + '\n')
# Drivers are not web animation clips. Keep the closed frame and drive only
# the selected drawer at runtime; never ship driver expressions or user data.
for obj in bpy.data.objects:
    obj.animation_data_clear()
    for key in list(obj.keys()):
        del obj[key]
# Collapse static architecture into a few material groups. Each moving
# drawer retains its parent and separate mesh so it can open independently.
bpy.ops.object.select_all(action='DESELECT')
static = [obj for obj in scene.objects if obj.type == 'MESH' and not (obj.parent and obj.parent.name.startswith('CAJON_')) and not obj.hide_render]
for obj in static:
    obj.select_set(True)
if static:
    bpy.context.view_layer.objects.active = static[0]
    bpy.ops.object.join()
    static[0].name = 'Room_Architecture'
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.type == 'MESH' and not obj.hide_render or obj.type == 'EMPTY' and obj.name.startswith('CAJON_'):
        obj.select_set(True)
path = root / 'assets/models/room.glb'
bpy.ops.export_scene.gltf(
    filepath=str(path), export_format='GLB', use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_extras=False, export_yup=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT',
)
print('WEB_EXPORT', path.name, path.stat().st_size, 'bytes')
