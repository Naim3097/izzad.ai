"""Izzad avatar build.

Takes the rigged character generated on Higgsfield plus its extra animation clips and
produces one game-ready GLB:

  1. merge the clips onto the main skeleton, one NLA track each, pinned so they do not slide
  2. turn the right hand palm-forward and curl its fingers into a grip
  3. model the spray can, fuse it into the skinned mesh, add a nozzle locator bone
  4. grade the head: matte bone, black eye sockets, as in the reference art
  5. author the hero pose from the reference (the mid-air stride) as the "Hover" clip
  6. export GLB (skin + clips + WebP textures)

Usage:
  blender -b --factory-startup --python build_avatar.py -- <main.glb> <clips.json> <pose.json> <out.glb> <debug_dir|->

clips.json maps clip names to GLBs rigged from the same mesh, e.g. {"Wave": "...", "Dance": "..."}.
pose.json holds the hero pose as world-axis rotations applied in order: {"rot": [["Hips", "Z", -10], ...]}.
"""
import bpy, bmesh, sys, os, json, math
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
main_glb, clips_json, pose_json, out_glb, debug_dir = argv[:5]
clips = json.load(open(clips_json))
pose = json.load(open(pose_json))
LOOPS = {"Dance"}

# grip tuning (metres, character is 1.2 m tall)
CAN_R = 0.047
CAN_BODY = 0.150
KNUCKLE_T = 0.55      # where the fingers start, as a fraction of hand length
FINGER_HALF = 0.014   # half thickness of a finger

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
log = {}


def import_glb(path):
    before_o = set(bpy.data.objects); before_a = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before_o]
    acts = [a for a in bpy.data.actions if a not in before_a]
    for o in list(objs):
        if o.type == "MESH" and o.name.startswith("Icosphere"):   # the importer's bone-shape helper
            objs.remove(o); bpy.data.objects.remove(o, do_unlink=True)
    return objs, acts


def fcurves_of(act):
    out = []
    for layer in act.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out.extend(cb.fcurves)
    return out


def use_action(arm, act):
    arm.animation_data.action = act
    if act is not None and hasattr(arm.animation_data, "action_slot") and act.slots:
        arm.animation_data.action_slot = act.slots[0]


def rest_pose(arm):
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


# ---------------------------------------------------------------- 1. merge clips
objs, acts = import_glb(main_glb)
arm = next(o for o in objs if o.type == "ARMATURE")
body = next(o for o in objs if o.type == "MESH")
arm.name = "IzzadRig"; body.name = "IzzadBody"
actions = {}
arm.animation_data_create()
for tr in list(arm.animation_data.nla_tracks):      # the importer stashes its own clip in a track
    arm.animation_data.nla_tracks.remove(tr)
arm.animation_data.action = None
for a_ in acts:
    bpy.data.actions.remove(a_)

for name, path in clips.items():
    o2, a2 = import_glb(path)
    a2[0].name = name; a2[0].use_fake_user = True
    actions[name] = a2[0]
    for o in o2:
        bpy.data.objects.remove(o, do_unlink=True)
bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)

# pin root motion: every clip starts (or, for loops, centres) over the rest position of the hips
hips_pb = arm.pose.bones["Hips"]
hips_rest = arm.data.bones["Hips"].matrix_local.to_3x3()          # bone -> armature
arm_inv = arm.matrix_world.inverted().to_3x3()                    # world -> armature
anchor = (arm.matrix_world @ arm.data.bones["Hips"].head_local).copy(); anchor.z = 0
log["root_shift"] = {}
for name, act in actions.items():
    use_action(arm, act)
    f0, f1 = act.frame_range
    pts = []
    for f in range(int(math.ceil(f0)), int(math.floor(f1)) + 1, 2):
        scene.frame_set(f); bpy.context.view_layer.update()
        pts.append((arm.matrix_world @ hips_pb.matrix).translation.copy())
    ref = Vector((sum(p.x for p in pts) / len(pts), sum(p.y for p in pts) / len(pts), 0)) if name in LOOPS else Vector((pts[0].x, pts[0].y, 0))
    d_world = Vector((anchor.x - ref.x, anchor.y - ref.y, 0))
    d_bone = hips_rest.inverted() @ (arm_inv @ d_world)
    for fc in fcurves_of(act):
        if fc.data_path == 'pose.bones["Hips"].location':
            dv = d_bone[fc.array_index]
            for kp in fc.keyframe_points:
                kp.co.y += dv; kp.handle_left.y += dv; kp.handle_right.y += dv
            fc.update()
    log["root_shift"][name] = [round(v, 4) for v in d_world]

use_action(arm, None)
rest_pose(arm)
scene.frame_set(0); bpy.context.view_layer.update()

# ---------------------------------------------------------------- 2. the grip
me = body.data
n_v = len(me.vertices)
mw = np.array(body.matrix_world)
mw_inv = np.array(body.matrix_world.inverted())
local = np.empty(n_v * 3); me.vertices.foreach_get("co", local); local = local.reshape(-1, 3)
co = local @ mw[:3, :3].T + mw[:3, 3]


def weights_of(*groups):
    ids = {body.vertex_groups[g].index for g in groups if g in body.vertex_groups}
    w = np.zeros(len(body.data.vertices))
    for v in body.data.vertices:
        for g in v.groups:
            if g.group in ids:
                w[v.index] += g.weight
    return w


w_hand = weights_of("RightHand")
w_fore = weights_of("RightForeArm")
W = np.array(arm.matrix_world @ arm.data.bones["RightHand"].head_local)
E = np.array(arm.matrix_world @ arm.data.bones["RightForeArm"].head_local)
a = (W - E) / np.linalg.norm(W - E)                      # along the fingers
lower_arm = (w_hand + w_fore) > 0.9

hand_core = w_hand > 0.5
hc = co[hand_core]
_, _, vt = np.linalg.svd(hc - hc.mean(axis=0), full_matrices=False)
n0 = vt[2] - a * (vt[2] @ a); n0 /= np.linalg.norm(n0)   # palm plane normal, squared to the fingers
t = (co - W) @ a
L = float(t[hand_core].max())                            # wrist -> fingertips

# turn the palm to the front; the rolled glove cuff hides the twist
front = np.array([0.0, -1.0, 0.0])
front -= a * (front @ a); front /= np.linalg.norm(front)
ang = math.atan2(np.cross(n0, front) @ a, n0 @ front)
if abs(ang) > math.pi / 2:                               # either face of this mitten can be the palm
    ang -= math.copysign(math.pi, ang)
cuff = lower_arm & (t > 0.0) & (t < 0.035)
pivot = co[cuff].mean(axis=0) if cuff.sum() > 20 else W


def rot_about(points, origin, axis, angles):
    """Rodrigues rotation of points about (origin, axis) by per-point angles."""
    p = points - origin
    c = np.cos(angles)[:, None]; s = np.sin(angles)[:, None]
    return origin + p * c + np.cross(axis, p) * s + axis * (p @ axis)[:, None] * (1 - c)


blend = np.clip(t / 0.035, 0, 1); blend = blend * blend * (3 - 2 * blend)
sel = lower_arm & (t > 0.0)
co[sel] = rot_about(co[sel], pivot, a, ang * blend[sel])
n = rot_about(n0[None, :], np.zeros(3), a, np.array([ang]))[0]
if n @ np.array([0.0, -1.0, 0.0]) < 0:
    n = -n
wdir = np.cross(n, a); wdir /= np.linalg.norm(wdir)      # knuckle line = can axis
if wdir[2] < 0:
    wdir = -wdir                                         # can top points up

# curl the fingers round a cylinder of the can's radius
t = (co - W) @ a
hand_mid = co[w_hand > 0.5].mean(axis=0)
t0 = KNUCKLE_T * L
rho = CAN_R + FINGER_HALF
K = W + a * t0
K = K + n * ((hand_mid - K) @ n) + wdir * ((hand_mid - K) @ wdir)
C = K + n * rho                                          # can centre
fingers = (w_hand > 0.3) & (t > t0)
p = co[fingers] - K
d = p @ a; h = p @ n; side = p @ wdir
phi = d / rho
co[fingers] = (C - n[None, :] * ((rho - h) * np.cos(phi))[:, None]
               + a[None, :] * ((rho - h) * np.sin(phi))[:, None] + wdir[None, :] * side[:, None])
log["grip"] = {"twist_deg": round(math.degrees(ang), 1), "wrap_deg": round(math.degrees((L - t0) / rho), 1)}

local = (co - mw[:3, 3]) @ mw_inv[:3, :3].T
me.vertices.foreach_set("co", local.reshape(-1)); me.update()

# ---------------------------------------------------------------- 4. grade the head (before the can adds UV-less faces)
# The generated skull is glossy off-white with shiny grey sockets; the reference is matte clay with black voids.
w_head = weights_of("Head", "head_end", "headfront", "neck")
base = next(i for i in bpy.data.images if i.name == "Image_0")
orm = next(i for i in bpy.data.images if i.name == "Image_1")
TW, TH = base.size
loops_v = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get("vertex_index", loops_v)
uv = np.empty(len(me.loops) * 2); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
ls = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_start", ls)
lt = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get("loop_total", lt)
tri = ls[lt == 3]
face_w = (w_head[loops_v[tri]] + w_head[loops_v[tri + 1]] + w_head[loops_v[tri + 2]]) / 3
tri = tri[face_w >= 0.5]
mask = np.zeros((TH, TW), dtype=bool)
P = np.stack([uv[tri], uv[tri + 1], uv[tri + 2]], axis=1) * np.array([TW, TH])     # (n, 3, 2) in pixels
for A_, B_, C_ in P:
    x0 = max(0, int(math.floor(min(A_[0], B_[0], C_[0])))); x1 = min(TW - 1, int(math.ceil(max(A_[0], B_[0], C_[0]))))
    y0 = max(0, int(math.floor(min(A_[1], B_[1], C_[1])))); y1 = min(TH - 1, int(math.ceil(max(A_[1], B_[1], C_[1]))))
    if x1 < x0 or y1 < y0:
        continue
    xs, ys = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    den = (B_[1] - C_[1]) * (A_[0] - C_[0]) + (C_[0] - B_[0]) * (A_[1] - C_[1])
    if abs(den) < 1e-9:
        continue
    l1 = ((B_[1] - C_[1]) * (xs - C_[0]) + (C_[0] - B_[0]) * (ys - C_[1])) / den
    l2 = ((C_[1] - A_[1]) * (xs - C_[0]) + (A_[0] - C_[0]) * (ys - C_[1])) / den
    mask[y0:y1 + 1, x0:x1 + 1] |= (l1 >= -0.02) & (l2 >= -0.02) & (l1 + l2 <= 1.02)
for _ in range(3):                                       # bleed past the island edges so seams do not show
    m2 = mask.copy()
    m2[1:, :] |= mask[:-1, :]; m2[:-1, :] |= mask[1:, :]; m2[:, 1:] |= mask[:, :-1]; m2[:, :-1] |= mask[:, 1:]
    mask = m2

px = np.empty(TW * TH * 4, dtype=np.float32); base.pixels.foreach_get(px); px = px.reshape(TH, TW, 4)
rgb = px[:, :, :3]
luma = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
sat = rgb.max(axis=2) - rgb.min(axis=2)
bone = mask & (sat < 0.14) & (luma > 0.45)
void = mask & (sat < 0.30) & (luma < 0.34)
rgb[bone] *= np.array([0.86, 0.85, 0.83], dtype=np.float32)
rgb[void] *= 0.22
base.pixels.foreach_set(px.reshape(-1)); base.update(); base.pack()

OW, OH = orm.size
opx = np.empty(OW * OH * 4, dtype=np.float32); orm.pixels.foreach_get(opx); opx = opx.reshape(OH, OW, 4)
sy, sx = TH // OH, TW // OW
matte = (bone | void)[::sy, ::sx]
opx[:, :, 1][matte] = np.maximum(opx[:, :, 1][matte], 0.82)   # glTF: G = roughness
opx[:, :, 2][matte] = 0.0                                     # B = metallic
orm.pixels.foreach_set(opx.reshape(-1)); orm.update(); orm.pack()
log["head_grade"] = {"mask_px": int(mask.sum()), "bone_px": int(bone.sum()), "void_px": int(void.sum())}

# ---------------------------------------------------------------- 3. spray can
def mat(name, color, metallic=0.0, rough=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = rough
    return m


def srgb(hexstr):
    v = [int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in v)


m_paint = mat("CanPaint", srgb("#F2860F"), 0.0, 0.34)
m_steel = mat("CanSteel", srgb("#C9CED1"), 1.0, 0.3)
m_cap = mat("CanCap", srgb("#E4E0DA"), 0.0, 0.45)
m_ink = mat("CanInk", srgb("#141210"), 0.0, 0.6)

bm = bmesh.new()
SEG = 40
r = CAN_R; H = CAN_BODY


def lathe(profile, mat_index, cap_start=False, cap_end=False):
    rings = []
    for rad, z in profile:
        rings.append([bm.verts.new((rad * math.cos(2 * math.pi * i / SEG), rad * math.sin(2 * math.pi * i / SEG), z)) for i in range(SEG)])
    for j in range(len(rings) - 1):
        for i in range(SEG):
            f = bm.faces.new((rings[j][i], rings[j][(i + 1) % SEG], rings[j + 1][(i + 1) % SEG], rings[j + 1][i]))
            f.material_index = mat_index; f.smooth = True
    if cap_start:
        f = bm.faces.new(list(reversed(rings[0]))); f.material_index = mat_index
    if cap_end:
        f = bm.faces.new(rings[-1]); f.material_index = mat_index


# z = 0 is the base of the can, +z the nozzle
lathe([(r * 0.90, 0.000), (r * 0.985, 0.004), (r * 1.02, 0.009), (r * 0.985, 0.014)], 1, cap_start=True)                      # base rim
lathe([(r * 0.985, 0.014), (r, 0.020), (r, H - 0.006), (r * 0.985, H)], 0)                                                     # painted body
lathe([(r * 0.985, H), (r * 1.02, H + 0.004), (r * 0.97, H + 0.009), (r * 0.80, H + 0.022), (r * 0.56, H + 0.031),
       (r * 0.46, H + 0.033), (r * 0.46, H + 0.039), (r * 0.40, H + 0.041)], 1, cap_end=True)                                  # shoulder + valve cup
lathe([(r * 0.30, H + 0.040), (r * 0.30, H + 0.058), (r * 0.25, H + 0.062)], 2, cap_end=True)                                  # actuator cap

# the black plus, wrapped on the body, facing +x
PLUS_R = r + 0.0007; zc = H * 0.50; arm_len = 0.030; arm_w = 0.0105


def patch(ang0, ang1, z0, z1, steps=8):
    for i in range(steps):
        a0 = ang0 + (ang1 - ang0) * i / steps; a1 = ang0 + (ang1 - ang0) * (i + 1) / steps
        vs = [bm.verts.new((PLUS_R * math.cos(q), PLUS_R * math.sin(q), z)) for q, z in ((a0, z0), (a1, z0), (a1, z1), (a0, z1))]
        f = bm.faces.new(vs); f.material_index = 3; f.smooth = True


patch(-arm_len / r, arm_len / r, zc - arm_w, zc + arm_w, 10)
patch(-arm_w / r, arm_w / r, zc + arm_w, zc + arm_len, 3)
patch(-arm_w / r, arm_w / r, zc - arm_len, zc - arm_w, 3)
hole = [bm.verts.new((r * 0.305, 0.005 * math.cos(q), H + 0.050 + 0.005 * math.sin(q))) for q in [2 * math.pi * i / 12 for i in range(12)]]
f = bm.faces.new(hole); f.material_index = 3
bm.normal_update()

can_me = bpy.data.meshes.new("SprayCan"); bm.to_mesh(can_me); bm.free()
for m in (m_paint, m_steel, m_cap, m_ink):
    can_me.materials.append(m)
can = bpy.data.objects.new("SprayCan", can_me); scene.collection.objects.link(can)

# can +z along the knuckle line, can +x (plus + nozzle) along the fingers = spray direction
zc_axis = Vector(wdir); xc_axis = Vector(a) - zc_axis * (Vector(a) @ zc_axis); xc_axis.normalize()
yc_axis = zc_axis.cross(xc_axis)
rot = Matrix((xc_axis, yc_axis, zc_axis)).transposed()
origin = Vector(C) - zc_axis * (H * 0.42)                # gripped a little below the middle, as in the reference
can.matrix_world = Matrix.Translation(origin) @ rot.to_4x4()
bpy.context.view_layer.update()
nozzle_world = can.matrix_world @ Vector((r * 0.31, 0, H + 0.050))
spray_dir = (can.matrix_world.to_3x3() @ Vector((1, 0, 0))).normalized()

# fuse it into the skinned body (bone-parented objects export in the wrong place under this rig's 0.01 scale)
n_before = len(body.data.vertices)
bpy.ops.object.select_all(action="DESELECT")
can.select_set(True); body.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.vertex_groups["RightHand"].add(list(range(n_before, len(body.data.vertices))), 1.0, "REPLACE")

# locator bone: head on the spray hole, +Y along the spray direction
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
ainv = arm.matrix_world.inverted()
eb = arm.data.edit_bones.new("Nozzle")
eb.head = ainv @ nozzle_world
eb.tail = ainv @ (nozzle_world + spray_dir * 0.04)
eb.parent = arm.data.edit_bones["RightHand"]
eb.use_deform = False
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()

# ---------------------------------------------------------------- 5. the hero pose
AX = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
rest_pose(arm)
for name, axis, deg in pose["rot"]:
    pb = arm.pose.bones[name]
    M = arm.matrix_world @ pb.matrix
    loc = M.translation.copy()
    R = Matrix.Rotation(math.radians(deg), 4, AX[axis])
    pb.matrix = arm.matrix_world.inverted() @ (Matrix.Translation(loc) @ R @ Matrix.Translation(-loc) @ M)
    bpy.context.view_layer.update()

hover = bpy.data.actions.new("Hover"); hover.use_fake_user = True
arm.animation_data.action = hover
for frame in (0, 48):
    for pb in arm.pose.bones:
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    hips_pb.keyframe_insert("location", frame=frame)
actions["Hover"] = hover
log["hover_slots"] = len(hover.slots)

# posed bounds, so the scene can be laid out round the pose
deps = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(deps); pm = ev.to_mesh()
pco = np.empty(len(pm.vertices) * 3); pm.vertices.foreach_get("co", pco); pco = pco.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]
ev.to_mesh_clear()
log["hover_bounds"] = {"min": pco.min(axis=0).round(3).tolist(), "max": pco.max(axis=0).round(3).tolist()}

# ---------------------------------------------------------------- debug render of the pose
if debug_dir != "-":
    c = Vector(((pco.min(axis=0) + pco.max(axis=0)) / 2).tolist())
    scene.render.engine = "BLENDER_EEVEE"; scene.render.resolution_x = 760; scene.render.resolution_y = 860
    scene.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.02, 0.2, 0.26, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    tmp = []
    for nm, loc, en, size in (("key", (-1.6, -2.4, 2.0), 170, 1.6), ("fill", (2.0, -1.4, 0.2), 12, 2.0), ("rim", (1.2, 1.8, 1.2), 60, 1.5)):
        l = bpy.data.lights.new(nm, "AREA"); l.energy = en; l.size = size
        o = bpy.data.objects.new(nm, l); scene.collection.objects.link(o); tmp.append(o)
        o.location = c + Vector(loc); o.rotation_euler = (c - o.location).to_track_quat("-Z", "Y").to_euler()
    cd = bpy.data.cameras.new("c"); cd.lens = 80
    cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam; tmp.append(cam)
    cam.location = c + Vector((-0.06, -1, 0.16)).normalized() * 3.3
    cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = os.path.join(debug_dir, "hero.png"); bpy.ops.render.render(write_still=True)
    for o in tmp:
        bpy.data.objects.remove(o, do_unlink=True)

# ---------------------------------------------------------------- NLA tracks, one per clip
use_action(arm, None)
for name, act in actions.items():
    tr = arm.animation_data.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, int(math.ceil(act.frame_range[0])), act)
    st.name = name
    if hasattr(st, "action_slot") and act.slots:
        st.action_slot = act.slots[0]

# ---------------------------------------------------------------- 6. export
rest_pose(arm)
scene.frame_set(0)
for img in bpy.data.images:                               # web-sized: base colour stays 2K, normal and ORM halve
    if img.size[0] >= 2048 and img.name != "Image_0":
        img.scale(1024, 1024)
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=out_glb, export_format="GLB", export_yup=True, export_apply=False,
                          export_animations=True, export_animation_mode="NLA_TRACKS", export_anim_slide_to_zero=True,
                          export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                          export_skins=True, export_def_bones=False, export_reset_pose_bones=True,
                          export_image_format="WEBP", export_image_quality=86,
                          export_cameras=False, export_lights=False, export_extras=False)

json.dump(log, open(os.path.join(os.path.dirname(out_glb), "build_log.json"), "w"), indent=1)
print("BUILD_DONE", json.dumps(log))
