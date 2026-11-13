"""Izzad smoke, built from the reference sculpture itself.

Input is the isolated smoke art ("Pearlescent Smoke Wreath Sculpture"), cut out of its white ground.
Rather than re-model it by eye, this inflates the artwork's own outline into a relief:

  1. the alpha is the outline; a Poisson solve inside it gives a height that is round in section
     (a strip comes out as a half-cylinder, a disc as a dome)
  2. the darker creases in the painting are cut in as grooves, so lobes separate in the geometry too
  3. front and back shells are stitched along the outline; every island becomes its own piece
  4. the art is projected straight back on as the base colour, so the pearl shading is the original
  5. the set is registered to where the smoke sits in the scene reference, then bent in depth:
     the lobes go behind the character, the low sweep comes round in front of the trailing leg

Units are character units relative to the centre of the posed character's bounding box, as in the
runtime. Blender axes: X right, Z up, -Y toward the camera.

Usage: blender -b --factory-startup --python build_smoke_from_art.py -- <cutout.png> <out.glb> <debug_dir|->
"""
import bpy, bmesh, sys, os, math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
art_path, out_glb, debug_dir = argv[:3]

CELL = 4            # pixels of art per grid cell
TRIS = 30000        # budget for the whole set
# Where the smoke sits in the scene reference (1600 x 892, character box centre at (807, 417), 603 px per unit):
# left tip, right tip, top, bottom of the smoke in that image.
SCENE_BOX = (220.0, 1340.0, 190.0, 730.0)
SCENE_CENTRE = (807.0, 417.0)
SCENE_PX = 603.0

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

img = bpy.data.images.load(art_path)
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px)
px = px.reshape(H, W, 4)[::-1]                       # top row first, like the picture

# ---------------------------------------------------------------- 1. outline and height
gh, gw = H // CELL, W // CELL
blk = px[:gh * CELL, :gw * CELL].reshape(gh, CELL, gw, CELL, 4).mean(axis=(1, 3))
alpha = np.pad(blk[:, :, 3], 3)
luma = np.pad(blk[:, :, :3] @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32), 3, constant_values=1.0)
inside = alpha > 0.5
gh, gw = inside.shape

# Poisson, del^2 h = -1 inside, h = 0 on the outline. Red-black successive over-relaxation.
h = np.zeros((gh, gw), dtype=np.float64)
yy, xx = np.mgrid[0:gh, 0:gw]
red = ((yy + xx) % 2 == 0) & inside
black = ((yy + xx) % 2 == 1) & inside
omega = 1.94
for _ in range(420):
    for colour in (red, black):
        nb = np.zeros_like(h)
        nb[1:-1, 1:-1] = h[:-2, 1:-1] + h[2:, 1:-1] + h[1:-1, :-2] + h[1:-1, 2:]
        h[colour] += omega * ((nb[colour] + 1.0) / 4.0 - h[colour])
depth = np.sqrt(np.maximum(0.0, 3.0 * h)) * CELL     # pixels; ~half the local width

# ---------------------------------------------------------------- 2. grooves from the painted creases
def box(a, r):
    out = np.zeros_like(a); n = 0
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out += np.roll(np.roll(a, dy, axis=0), dx, axis=1); n += 1
    return out / n


groove = np.clip((box(luma, 4) - box(luma, 1)) / 0.10, 0.0, 1.0)
depth *= 1.0 - 0.34 * groove * inside

# ---------------------------------------------------------------- 3. shells, one object per island
shell = inside.copy()                                # the outline ring: one cell out all round, at zero height
for dy in (-1, 0, 1):
    for dx in (-1, 0, 1):
        shell |= np.roll(np.roll(inside, dy, axis=0), dx, axis=1)
depth[~inside] = 0.0


def edge_point(gy, gx):
    """Where the outline really crosses near a ring cell, from how much of each cell the art covers.
    Without this the silhouette is a staircase of grid cells."""
    a = float(alpha[gy, gx])
    ny = nx = b = n = 0.0
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if (dy or dx) and inside[gy + dy, gx + dx]:
                ny += gy + dy; nx += gx + dx; b += float(alpha[gy + dy, gx + dx]); n += 1
    if not n:
        return float(gy), float(gx)
    ny /= n; nx /= n; b /= n
    t = min(0.95, max(0.0, (0.5 - a) / max(1e-6, b - a)))
    return gy + (ny - gy) * t, gx + (nx - gx) * t

label = np.zeros((gh, gw), dtype=np.int32)
islands = 0
for sy, sx in zip(*np.nonzero(shell)):
    if label[sy, sx]:
        continue
    islands += 1
    stack = [(sy, sx)]; label[sy, sx] = islands
    while stack:
        y, x = stack.pop()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < gh and 0 <= nx < gw and shell[ny, nx] and not label[ny, nx]:
                label[ny, nx] = islands; stack.append((ny, nx))

# art pixel -> scene units. The isolated art is framed tighter than the scene, so register by its bounding box.
ys, xs = np.nonzero(inside)
ax0, ax1 = (xs.min() - 3) * CELL, (xs.max() - 2) * CELL
ay0, ay1 = (ys.min() - 3) * CELL, (ys.max() - 2) * CELL
kx = (SCENE_BOX[1] - SCENE_BOX[0]) / (ax1 - ax0)
ky = (SCENE_BOX[3] - SCENE_BOX[2]) / (ay1 - ay0)


def to_scene(gx, gy):
    """Grid coordinates -> (x right, z up) in character units, and the art's own (u, v)."""
    ax = (gx - 3) * CELL + CELL / 2; ay = (gy - 3) * CELL + CELL / 2
    sx = SCENE_BOX[0] + (ax - ax0) * kx; sy = SCENE_BOX[2] + (ay - ay0) * ky
    return (sx - SCENE_CENTRE[0]) / SCENE_PX, (SCENE_CENTRE[1] - sy) / SCENE_PX, ax / W, 1.0 - ay / H


def smooth(a, b, v):
    t = min(1.0, max(0.0, (v - a) / (b - a)))
    return t * t * (3 - 2 * t)


def behind(x, z):
    """Depth of the slab: lobes behind the character; the low sweep comes round in front on the side of
    the trailing leg only, so the leading shoe stays clear of it, as in the reference."""
    front = (1.0 - smooth(-0.43, -0.13, z)) * smooth(-0.22, 0.12, x)
    return 0.25 - 0.5 * front


mat = bpy.data.materials.new("Smoke"); mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
tex = mat.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.4

unit = (kx + ky) / 2 / SCENE_PX                      # art pixels -> scene units, for thickness
pieces = []
sizes = sorted(((int((label == i).sum()), i) for i in range(1, islands + 1)), reverse=True)
for rank, (cells, i) in enumerate(sizes):
    if cells < 30:
        continue                                     # specks
    bm = bmesh.new(); uv_layer = bm.loops.layers.uv.new("UVMap")
    front, back, uvs = {}, {}, {}
    mine = label == i
    for gy, gx in zip(*np.nonzero(mine)):
        py, pxl = (gy, gx) if inside[gy, gx] else edge_point(gy, gx)
        x, z, u, v = to_scene(pxl, py)
        d = depth[gy, gx] * unit
        y0 = behind(x, z)
        front[(gy, gx)] = bm.verts.new((x, y0 - d, z))
        back[(gy, gx)] = front[(gy, gx)] if d <= 0 else bm.verts.new((x, y0 + d * 0.6, z))
        uvs[(gy, gx)] = (u, v)
    for gy, gx in zip(*np.nonzero(mine[:-1, :-1] & mine[1:, :-1] & mine[:-1, 1:] & mine[1:, 1:])):
        quad = [(gy, gx), (gy + 1, gx), (gy + 1, gx + 1), (gy, gx + 1)]
        if max(depth[q] for q in quad) <= 0:
            continue
        for side, order in ((front, quad), (back, quad[::-1])):
            vs = [side[q] for q in order]
            if len(set(vs)) < 3:
                continue
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            f.smooth = True
            for loop, q in zip(f.loops, order):
                loop[uv_layer].uv = uvs[q]
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    if len(bm.faces) < 12:
        bm.free(); continue
    # a couple of relaxing passes take the stair-steps off the outline without moving the form
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    name = "Wreath" if rank == 0 else f"Wisp{rank}"
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me); scene.collection.objects.link(ob)
    pieces.append(ob)

total = sum(len(o.data.polygons) * 2 for o in pieces)
ratio = min(1.0, TRIS / total)
for ob in pieces:
    me = ob.data
    if ratio < 1:
        dec = ob.modifiers.new("dec", "DECIMATE"); dec.ratio = max(ratio, 0.12)
        bpy.context.view_layer.update()
        me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        ob.modifiers.clear(); ob.data = me2; bpy.data.meshes.remove(me); me = me2; me.name = ob.name
    for p in me.polygons:
        p.use_smooth = True
    c = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)   # own origin, so it can sway in place
    for v in me.vertices:
        v.co -= c
    ob.location = c
print("SMOKE", [(o.name, len(o.data.polygons), [round(v, 2) for v in o.location]) for o in pieces])

if debug_dir != "-":
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 1280; scene.render.resolution_y = 714
    scene.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.2, 0.26, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    tmp = []
    l = bpy.data.lights.new("k", "AREA"); l.energy = 160; l.size = 3
    lo = bpy.data.objects.new("k", l); scene.collection.objects.link(lo); lo.location = (-1.6, -3.2, 2.2); tmp.append(lo)
    lo.rotation_euler = (Vector((0, 0, 0)) - lo.location).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("c"); cd.type = "ORTHO"; cd.ortho_scale = 1600 / SCENE_PX
    cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam; tmp.append(cam)
    for nm, loc, rot in (("front", ((800 - 807) / SCENE_PX, -6, (417 - 446) / SCENE_PX), (math.radians(90), 0, 0)),
                         ("side", (6, 0, (417 - 446) / SCENE_PX), (math.radians(90), 0, math.radians(90)))):
        cam.location = loc; cam.rotation_euler = rot
        scene.render.filepath = os.path.join(debug_dir, f"smoke_art_{nm}.png"); bpy.ops.render.render(write_still=True)
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_yup=True, export_apply=True,
                          export_animations=False, export_cameras=False, export_lights=False,
                          export_image_format="WEBP", export_image_quality=88)
print("SMOKE_DONE")
