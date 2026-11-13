// Build the phone copy of the avatar: the same rig, pose and textures, with fewer triangles.
// On a phone the character is drawn about 400 pixels tall, and the full model has more triangles than
// that has pixels. It is drawn three times a frame (shadow, behind the glass, screen), so what is saved
// here is saved every frame.
//
//   npm i --no-save @gltf-transform/core@4 @gltf-transform/extensions@4 @gltf-transform/functions@4 meshoptimizer
//   node pipeline/avatar/build_lite.mjs src/front/assets/avatar.glb src/front/assets/avatar-lite.glb
//
// Options (after the two paths): --error 0.002   --base 2048
//
// The model's texture is an atlas of several hundred small islands packed edge to edge, so a vertex on
// the edge of an island cannot move: the triangle it belongs to would reach into the island next door
// and pick up its colour (white skull on blue denim). Every such vertex is locked, and only the
// surface inside each island is simplified.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization } from '@gltf-transform/extensions';
import { meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [input, output, ...rest] = process.argv.slice(2);
if (!input || !output) {
  console.error('usage: node build_lite.mjs <avatar.glb> <avatar-lite.glb> [--error 0.002] [--base 2048]');
  process.exit(1);
}
const option = (name, fallback) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? Number(rest[i + 1]) : fallback;
};
const ERROR = option('error', 0.002); // furthest a surface may move, as a fraction of the model's size
const BASE = option('base', 2048); // longest edge allowed for a texture, in pixels

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO()
  .registerExtensions([EXTMeshoptCompression, EXTTextureWebP, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

const doc = await io.read(input);
await doc.transform(weld());

const floats = (accessor, size) => {
  const out = new Float32Array(accessor.getCount() * size);
  const el = [];
  for (let i = 0; i < accessor.getCount(); i++) out.set(accessor.getElement(i, el), i * size);
  return out;
};

let before = 0;
let after = 0;
let locked = 0;
let total = 0;
for (const mesh of doc.getRoot().listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const indices = prim.getIndices();
    const position = prim.getAttribute('POSITION');
    if (!indices || !position) continue;
    const count = position.getCount();
    const P = floats(position, 3);
    const uv = prim.getAttribute('TEXCOORD_0');
    const U = uv ? floats(uv, 2) : null;

    // Lock every vertex that sits on the edge of a texture island: one that shares its place with
    // another vertex carrying different texture coordinates.
    const lock = new Uint8Array(count);
    if (U) {
      const at = new Map();
      for (let i = 0; i < count; i++) {
        const key = `${P[i * 3]},${P[i * 3 + 1]},${P[i * 3 + 2]}`;
        const group = at.get(key);
        if (!group) at.set(key, [i]);
        else group.push(i);
      }
      for (const group of at.values()) {
        if (group.length < 2) continue;
        const [a] = group;
        if (group.some((i) => U[i * 2] !== U[a * 2] || U[i * 2 + 1] !== U[a * 2 + 1])) for (const i of group) lock[i] = 1;
      }
    }

    const I = new Uint32Array(indices.getArray());
    const [kept] = MeshoptSimplifier.simplifyWithAttributes(I, P, 3, U ?? new Float32Array(count), U ? 2 : 1, U ? [0.5, 0.5] : [0], lock, 0, ERROR, []);
    before += I.length / 3;
    after += kept.length / 3;
    total += count;
    locked += lock.reduce((n, v) => n + v, 0);
    prim.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(indices.getBuffer()).setArray(new Uint32Array(kept)));
  }
}

// Textures only shrink if asked to. Done with Pillow, since sharp does not run on every machine.
const work = mkdtempSync(join(tmpdir(), 'izzad-lite-'));
for (const texture of doc.getRoot().listTextures()) {
  const size = texture.getSize();
  if (!size || Math.max(...size) <= BASE) continue;
  const src = join(work, 'in.webp');
  const out = join(work, 'out.webp');
  writeFileSync(src, texture.getImage());
  execFileSync('python', [
    '-c',
    'import sys\nfrom PIL import Image\nim = Image.open(sys.argv[1])\nim.thumbnail((int(sys.argv[3]),) * 2, Image.LANCZOS)\nim.save(sys.argv[2], "WEBP", quality=90, method=6)',
    src,
    out,
    String(BASE),
  ]);
  texture.setImage(readFileSync(out)).setMimeType('image/webp');
  console.log(`texture ${texture.getName() || '(unnamed)'}: ${size.join('x')} -> ${texture.getSize().join('x')}`);
}
rmSync(work, { recursive: true, force: true });

// meshopt reorders each primitive and drops the vertices nothing points at any more
await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, doc);
console.log(`triangles ${before} -> ${after}; ${locked} of ${total} vertices sit on an island edge and were kept`);
