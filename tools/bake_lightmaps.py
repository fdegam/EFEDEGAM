"""Bake Cycles lighting into lightmaps and export the web room.

Run with Blender 4.3+ (or the `bpy` module) against a PRIVATE copy of the
source file. The .blend is never saved or modified:

    blender --background --factory-startup --disable-autoexec /private/Espacio_Portfolio.blend \
      --python tools/bake_lightmaps.py -- /path/to/EFEDEGAM [samples] [work_dir]

What it does, in order:
1. Gives every visible mesh its own data and a second UV map, "Lightmap".
2. Bakes Cycles diffuse lighting (direct + indirect, without surface colour)
   into two float atlases: the room shell and the archive wall.
3. Joins static architecture by atlas; each of the 156 drawers stays a
   separate node so the browser can open it.
4. Writes assets/models/room.glb, the two lightmaps (8-bit sRGB WebP plus
   an intensity factor) and assets/models/room.json.

Material colours and the carpet texture stay in the GLB. The lightmap only
carries light, so textures keep their full resolution.
"""
import bmesh
import bpy
import json
import time
import math
import sys
from pathlib import Path

import mathutils
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
root = Path(args[0]).resolve()
samples = int(args[1]) if len(args) > 1 else 512
work = Path(args[2]).resolve() if len(args) > 2 else root / 'tools/.bake'
work.mkdir(parents=True, exist_ok=True)
models = root / 'assets/models'
lightmap_dir = models / 'lightmaps'
lightmap_dir.mkdir(parents=True, exist_ok=True)

scene = bpy.context.scene
scene.frame_set(1)
camera = scene.camera
assert camera and camera.name == 'CAM_01_Referencia', 'Active reference camera expected.'

# --- Sanitize: no drivers, scripts or custom properties travel to the web.
for obj in bpy.data.objects:
    obj.animation_data_clear()
    for key in list(obj.keys()):
        del obj[key]

meshes = [o for o in scene.objects if o.type == 'MESH' and not o.hide_render]
drawers = sorted((o for o in scene.objects if o.type == 'EMPTY' and o.name.startswith('CAJON_')), key=lambda o: o.name)
assert len(drawers) == 156, f'Expected 156 drawers, found {len(drawers)}'


def group_of(obj):
    name = obj.name
    if name.startswith('PANEL_LUZ'):
        return 'lights'  # emissive panels: no bake needed
    if name.startswith(('GEOMETRIA_', 'Estante', 'Montante', 'Marco', 'Trasera', 'Zocalo')):
        return 'archive'
    return 'room'


groups = {'room': [], 'archive': [], 'lights': []}
for obj in meshes:
    groups[group_of(obj)].append(obj)
print('GROUPS', {k: len(v) for k, v in groups.items()})

# --- Unique mesh data (drawer fronts share one mesh in the source).
bpy.ops.object.select_all(action='DESELECT')
for obj in groups['room'] + groups['archive']:
    if obj.data.users > 1:
        obj.data = obj.data.copy()

# --- Visibility from where a visitor can stand (Blender: room at -Y).
HIDDEN_SCALE = 0.12
VIEWPOINTS = [mathutils.Vector((x, y, z)) for x in (-2.9, -1.45, 0, 1.45, 2.9)
              for y in (-0.75, -2.0, -3.5, -5.0, -6.9) for z in (0.45, 1.0, 1.7, 2.4)]
depsgraph = bpy.context.evaluated_depsgraph_get()


def is_visible(center, normal):
    origin = center + normal * 0.002
    for view in VIEWPOINTS:
        ray = view - origin
        dist = ray.length
        if dist < 1e-4 or normal.dot(ray) <= 0:
            continue
        hit, *_ = scene.ray_cast(depsgraph, origin, ray / dist, distance=dist - 1e-3)
        if not hit:
            return True
    return False


# --- Lightmap UVs.
ATLAS = {'room': 2048, 'archive': 2048}
FRONT_BAND = (0.2, 1.0)   # archive atlas: drawer fronts on top, structure below


def edit_uv(objs, fn):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.select_all(action='SELECT')
    fn()
    bpy.ops.object.mode_set(mode='OBJECT')


def each_face(objs, fn):
    for obj in objs:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        layer = bm.loops.layers.uv['Lightmap']
        mw = obj.matrix_world
        nm = mw.to_3x3().inverted().transposed()
        for face in bm.faces:
            fn(obj, face, layer, mw, (nm @ face.normal).normalized())
        bm.to_mesh(obj.data)
        bm.free()


def shrink(face, layer, factor=HIDDEN_SCALE):
    uvs = [loop[layer].uv.copy() for loop in face.loops]
    c = sum(uvs, mathutils.Vector((0, 0))) / len(uvs)
    for loop, uv in zip(face.loops, uvs):
        loop[layer].uv = c + (uv - c) * factor


def packed_by_visibility(name, objs, v_range=(0.0, 1.0)):
    """Smart-project, shrink faces no visitor sees, pack, fit to a band."""
    margin = 4 / ATLAS[name]
    edit_uv(objs, lambda: bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=False))
    t0, count = time.time(), [0, 0]

    def visit(obj, face, layer, mw, normal):
        count[1] += 1
        # Thin faces (panel edges, shelf fronts) stay: they cost few texels
        # and, if shrunk below one texel, they would never be baked.
        if face.calc_area() > 0.05 and not is_visible(mw @ face.calc_center_median(), normal):
            count[0] += 1
            shrink(face, layer)
    each_face(objs, visit)
    edit_uv(objs, lambda: bpy.ops.uv.pack_islands(rotate=True, margin=margin))
    lo, hi = v_range
    if (lo, hi) != (0.0, 1.0):
        def fit(obj, face, layer, mw, normal):
            for loop in face.loops:
                loop[layer].uv.y = lo + loop[layer].uv.y * (hi - lo)
        each_face(objs, fit)
    print('UV', name, f'{count[0]}/{count[1]} faces hidden', f'{time.time() - t0:.1f}s', flush=True)


for obj in groups['room'] + groups['archive']:
    uv = obj.data.uv_layers
    uv[0].active_render = True
    uv.active = uv.get('Lightmap') or uv.new(name='Lightmap')

packed_by_visibility('room', groups['room'])

# Drawer fronts: an exact elevation projection of the wall. Each of the 156
# fronts gets its own undistorted cell, in the same place as in the room.
fronts = [o for o in groups['archive'] if o.name.startswith('GEOMETRIA_')]
structure = [o for o in groups['archive'] if not o.name.startswith('GEOMETRIA_')]
xs, zs = [], []
for obj in fronts:
    for v in obj.data.vertices:
        w = obj.matrix_world @ v.co
        xs.append(w.x)
        zs.append(w.z)
x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
lo, hi = FRONT_BAND
inset = 2 / ATLAS['archive']


def elevation(p):
    return mathutils.Vector((inset + (p.x - x0) / (x1 - x0) * (1 - 2 * inset),
                             lo + inset + (p.z - z0) / (z1 - z0) * (hi - lo - 2 * inset)))


def project_front(obj, face, layer, mw, normal):
    local_y = face.calc_center_median().y
    material = obj.material_slots[face.material_index].material.name
    # Outer skin of the front and the handle recess face the room. The
    # drawer box behind them (Interior_cajon) must not overlap that cell.
    if normal.y < -0.7 and material != 'Interior_cajon' and (local_y < 0 or material == 'Hueco_tirador'):
        for loop in face.loops:
            loop[layer].uv = elevation(mw @ loop.vert.co)
    else:  # edges and backs read the light of the face they belong to
        centre = mw @ face.calc_center_median()
        origin = obj.matrix_world.translation
        p = centre.lerp(mathutils.Vector((origin.x, centre.y, centre.z)), 0.25)
        for loop in face.loops:
            loop[layer].uv = elevation(p)


each_face(fronts, project_front)
packed_by_visibility('archive', structure, (0.0, FRONT_BAND[0] - 0.005))

# --- Bake.
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = samples
scene.cycles.use_adaptive_sampling = False
scene.render.threads_mode = 'FIXED'
scene.render.threads = max(1, __import__('os').cpu_count() or 1)
# Bake margin must stay below half the island gap, or islands overwrite
# their neighbours; encode_lightmaps.py dilates the rest without touching texels.
MARGIN = {'room': 1, 'archive': 1}


def bake_proxy(objs, name):
    """Cycles walks the whole image once per object, so bake one joined copy."""
    copies = []
    for obj in objs:
        dup = obj.copy()
        dup.data = obj.data.copy()
        scene.collection.objects.link(dup)
        copies.append(dup)
    bpy.ops.object.select_all(action='DESELECT')
    for dup in copies:
        dup.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    proxy = copies[0]
    proxy.data.uv_layers.active = proxy.data.uv_layers['Lightmap']
    for obj in objs:  # the copy replaces them while baking
        obj.hide_render = True
    proxy.select_set(True)
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, use_clear=True, margin=MARGIN[name])
    for obj in objs:
        obj.hide_render = False
    mesh = proxy.data
    bpy.data.objects.remove(proxy)
    bpy.data.meshes.remove(mesh)


intensity = {}
for name in ('room', 'archive'):
    objs = groups[name]
    size = ATLAS[name]
    image = bpy.data.images.new(f'LM_{name}', size, size, float_buffer=True, alpha=False)
    image.colorspace_settings.name = 'Non-Color'
    touched = []
    for mat in {s.material for o in objs for s in o.material_slots if s.material}:
        node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image = image
        mat.node_tree.nodes.active = node
        touched.append((mat, node))
    print('BAKE', name, size, samples, flush=True)
    t0 = time.time()
    bake_proxy(objs, name)
    print('BAKED', name, f'{time.time() - t0:.1f}s', flush=True)
    exr = work / f'lightmap_{name}.exr'
    image.filepath_raw = str(exr)
    image.file_format = 'OPEN_EXR'
    image.save()
    px = np.array(image.pixels[:], dtype=np.float32).reshape(size, size, 4)[..., :3]
    lit = px[px.max(axis=2) > 1e-5]
    scale = float(np.percentile(lit, 99.7)) if lit.size else 1.0
    np.save(work / f'lightmap_{name}_linear.npy', (px / scale)[::-1].astype(np.float16))
    # Three.js indirect diffuse = lightMap * intensity * albedo / PI.
    intensity[name] = scale * math.pi
    for mat, node in touched:
        mat.node_tree.nodes.remove(node)

# --- Reflections: a Cycles panorama of the room, seen from its centre.
# The browser uses it only for gloss and the carpet's velvet sheen (both
# depend on the viewing angle, so they cannot live in a lightmap).
pano = bpy.data.cameras.new('ENV_PANO')
pano.type = 'PANO'
pano.panorama_type = 'EQUIRECTANGULAR'
pano_obj = bpy.data.objects.new('ENV_PANO', pano)
scene.collection.objects.link(pano_obj)
pano_obj.location = (0.0, -3.4, 1.25)
pano_obj.rotation_euler = (math.pi / 2, 0.0, 0.0)  # faces the archive (+Y)
reference_camera = scene.camera
scene.camera = pano_obj
scene.render.resolution_x, scene.render.resolution_y = 1024, 512
scene.render.resolution_percentage = 100
scene.cycles.samples = max(64, samples // 2)
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = 'OPEN_EXR'
scene.render.image_settings.color_depth = '32'
scene.render.filepath = str(work / 'env.exr')
t0 = time.time()
bpy.ops.render.render(write_still=True)
print('ENV', f'{time.time() - t0:.1f}s', flush=True)
env = bpy.data.images.load(str(work / 'env.exr'))
w, h = env.size
px = np.array(env.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
env_scale = float(np.percentile(px, 99.8))
np.save(work / 'env_linear.npy', (px / env_scale)[::-1].astype(np.float16))
scene.camera = reference_camera
bpy.data.objects.remove(pano_obj)

# --- Join static parts per atlas; drawers keep their own nodes.
def join(objs, new_name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    objs[0].name = new_name
    objs[0].data.name = new_name
    return objs[0]

join(groups['room'], 'Room_Architecture')
join([o for o in groups['archive'] if not o.name.startswith('GEOMETRIA_')], 'Archive_Structure')
join(groups['lights'], 'Ceiling_Lights')

bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if (obj.type == 'MESH' and not obj.hide_render) or (obj.type == 'EMPTY' and obj.name.startswith('CAJON_')):
        obj.select_set(True)
glb = models / 'room.glb'
bpy.ops.export_scene.gltf(
    filepath=str(glb), export_format='GLB', use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False,
    export_extras=False, export_yup=True, export_texcoords=True,
    export_normals=True, export_materials='EXPORT', export_image_format='AUTO',
)

# --- Cameras (Blender Z-up -> glTF Y-up) and metadata.
to_y_up = mathutils.Quaternion((1, 0, 0), -math.pi / 2)
aspect = scene.render.resolution_x / scene.render.resolution_y


def cam(obj):
    q = to_y_up @ obj.matrix_world.to_quaternion()
    fov = math.degrees(2 * math.atan(math.tan(obj.data.angle_x / 2) / aspect))
    return {'position': list(to_y_up @ obj.matrix_world.translation), 'quaternion': [q.x, q.y, q.z, q.w], 'fov': fov}


cameras = {o.name: cam(o) for o in scene.objects if o.type == 'CAMERA'}
config = {
    'camera': {**cameras['CAM_01_Referencia'], 'referenceAspect': aspect},
    'cameras': cameras,
    'walkBounds': {'minX': -3.05, 'maxX': 3.05, 'minZ': 1.0, 'maxZ': 6.9},
    'grid': {'columns': 13, 'rows': 12},
    'projectDrawer': 'CAJON_C07_F06',
    'drawerTravel': 0.34,
    'lightmaps': {
        'room': {'file': 'lightmaps/room.webp', 'intensity': intensity['room'], 'meshes': ['Room_Architecture']},
        'archive': {'file': 'lightmaps/archive.webp', 'intensity': intensity['archive'], 'meshes': ['Archive_Structure', 'GEOMETRIA_*']},
    },
    'environment': {'file': 'lightmaps/env.webp', 'intensity': env_scale, 'use': 'specular and sheen only'},
    # Calibrated in the browser against the Cycles render of CAM_01_Referencia,
    # with the owner's velvet photo as carpet colour (tools/encode_carpet.py).
    # The tint reproduces V20's cooler, desaturated treatment of that photo.
    'exposure': 1.3,
    'carpet': {'material': 'Moqueta_verde_aterciopelada', 'file': 'textures/moqueta.webp', 'repeatMetres': 0.9,
               'source': 'Owner photo (Drive › Recursos), same as V20 carpet; tools/encode_carpet.py'},
    'materialTuning': {'Moqueta_verde_aterciopelada': {'sheenColorScale': 1, 'specularIntensityScale': 1.5, 'lightMapScale': 0.128, 'tint': [0.76, 1, 1.65]},
                       # 8 mm shadow gaps between wall panels: finer than a lightmap texel.
                       'Juntas_sombra': {'emissive': [0.12, 0.12, 0.12]}},
    'bake': {'renderer': f'Blender {bpy.app.version_string}, Cycles CPU', 'samples': samples, 'pass': 'Diffuse direct + indirect, no colour', 'toneMapping': 'AgX'},
    'source': 'Owner-provided room; exported without scripts, custom properties, source paths, cameras or lights.',
}
(models / 'room.json').write_text(json.dumps(config, indent=2) + '\n')
print('DONE', glb.stat().st_size, intensity, flush=True)
