// Build the second-batch night-scene GLBs: a mossy rock collection and broadleaf plants.
import fs from 'node:fs';
import path from 'node:path';
import { IcosahedronGeometry } from 'three';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'textures-src');
const TAU = Math.PI * 2;
const f32 = a => new Float32Array(a);
const u32 = a => new Uint32Array(a);

function bounds(a) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], a[i + k]); max[k] = Math.max(max[k], a[i + k]);
  }
  return { min, max };
}

function writeMultiGlb(file, meshes, materials, imagePaths = []) {
  const chunks = [], bufferViews = [], accessors = [];
  let offset = 0;
  const addChunk = (buf, target) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    const pad = (4 - b.length % 4) % 4;
    const view = { buffer: 0, byteOffset: offset, byteLength: b.length };
    if (target) view.target = target;
    bufferViews.push(view); chunks.push(b, Buffer.alloc(pad)); offset += b.length + pad;
    return bufferViews.length - 1;
  };
  const addAccessor = (arr, type, componentType, target, extra = {}) => {
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const bufferView = addChunk(arr, target);
    accessors.push({ bufferView, componentType, count: arr.length / components, type, ...extra });
    return accessors.length - 1;
  };
  const gltfMeshes = meshes.map(m => {
    const b = bounds(m.position);
    const attributes = {
      POSITION: addAccessor(m.position, 'VEC3', 5126, 34962, b),
      NORMAL: addAccessor(m.normal, 'VEC3', 5126, 34962),
      TEXCOORD_0: addAccessor(m.uv, 'VEC2', 5126, 34962),
    };
    if (m.color) attributes.COLOR_0 = addAccessor(m.color, 'VEC3', 5126, 34962);
    return { name: m.name, primitives: [{ attributes, indices: addAccessor(m.index, 'SCALAR', 5125, 34963), material: m.material }], extras: m.extras };
  });
  const images = imagePaths.map(p => ({ name: path.basename(p), mimeType: 'image/png', bufferView: addChunk(fs.readFileSync(p)) }));
  const nodes = meshes.map((m, i) => ({ name: m.name, mesh: i, translation: m.translation || [0, 0, 0], extras: m.extras }));
  const json = {
    asset: { version: '2.0', generator: 'wish night asset builder' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes,
    meshes: gltfMeshes, materials, accessors, bufferViews, buffers: [{ byteLength: offset }],
  };
  if (images.length) {
    json.images = images;
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
    json.textures = images.map((_, i) => ({ sampler: 0, source: i }));
  }
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const bin = Buffer.concat(chunks), header = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([header, jh, js, bh, bin]));
  console.log(`wrote ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1048576).toFixed(1)} MB)`);
}

function rockMesh(name, dims, material, seed, translation) {
  const g = new IcosahedronGeometry(0.5, 3);
  const p = g.attributes.position.array, uv = g.attributes.uv?.array || new Float32Array(p.length / 3 * 2);
  for (let i = 0; i < p.length; i += 3) {
    let x = p[i] * 2, y = p[i + 1] * 2, z = p[i + 2] * 2;
    const wobble = 1 + 0.07 * Math.sin(x * 5.1 + seed) * Math.sin(z * 4.3 - seed) + 0.035 * Math.sin(y * 7.7 + seed * 2);
    x *= dims[0] * 0.5 * wobble; z *= dims[2] * 0.5 * wobble;
    y *= dims[1] * 0.5 * (1 + 0.05 * Math.sin(x * 8 + z * 5 + seed));
    y = Math.max(y, -dims[1] * 0.45); // stable, subtly flattened base
    p[i] = x; p[i + 1] = y + dims[1] * 0.45; p[i + 2] = z;
  }
  g.computeVertexNormals();
  const color = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const top = Math.max(0, Math.min(1, (p[i + 1] / dims[1] - 0.48) * 2.4));
    const lichen = Math.max(0, Math.sin(p[i] * 13 + p[i + 2] * 9 + seed) * 0.18);
    color[i] = 0.62 - top * 0.18 + lichen; color[i + 1] = 0.64 + top * 0.25 + lichen * 0.8; color[i + 2] = 0.60 - top * 0.25;
  }
  const index = g.index ? new Uint32Array(g.index.array) : Uint32Array.from({ length: p.length / 3 }, (_, i) => i);
  return { name, position: new Float32Array(p), normal: new Float32Array(g.attributes.normal.array), uv: new Float32Array(uv), color, index, material, translation, extras: { dimensions_m: dims, triangles: index.length / 3, local_origin: 'bottom_center' } };
}

function addLeaf(dst, { length, width, yaw, pitch = 0, height = 0, color = [0.7, 0.9, 0.7], lobes = 0, curl = 0.12, material = 0, rows = 8, cols = 6 }) {
  const base = dst.p.length / 3;
  for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) {
    const t = r / rows, s = c / cols * 2 - 1;
    const outline = Math.pow(Math.sin(Math.PI * Math.min(0.999, t)), 0.62) * (0.78 + 0.22 * t);
    const serration = lobes ? 1 - lobes * 0.10 * Math.cos(t * Math.PI * 8) : 1;
    const x0 = s * width * 0.5 * outline * serration;
    const z0 = t * length;
    const y0 = height + Math.sin(t * Math.PI) * length * curl + Math.abs(s) ** 1.6 * -width * 0.08 + Math.sin(t * Math.PI * 2) * length * 0.025;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
    const yy = y0 * cp - z0 * sp, zz = y0 * sp + z0 * cp;
    dst.p.push(x0 * cy + zz * sy, yy, -x0 * sy + zz * cy);
    dst.uv.push(c / cols, t);
    const vein = 0.88 + 0.12 * (1 - Math.abs(s)); dst.c.push(color[0] * vein, color[1] * vein, color[2] * vein);
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const a = base + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
    dst.i.push(a, d, b, b, d, e);
  }
  dst.material = material;
}

function finalizePlant(name, dst, material, translation, species) {
  const normal = new Float32Array(dst.p.length), p = dst.p, idx = dst.i;
  for (let q = 0; q < idx.length; q += 3) {
    const a = idx[q] * 3, b = idx[q + 1] * 3, c = idx[q + 2] * 3;
    const ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]], ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    for (const v of [a, b, c]) { normal[v] += n[0]; normal[v + 1] += n[1]; normal[v + 2] += n[2]; }
  }
  for (let i = 0; i < normal.length; i += 3) { const l = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1; normal[i] /= l; normal[i + 1] /= l; normal[i + 2] /= l; }
  return { name, position: f32(p), normal, uv: f32(dst.uv), color: f32(dst.c), index: u32(idx), material, translation, extras: { species, triangles: idx.length / 3, local_origin: 'bottom_center' } };
}

function rosette(name, species, count, length, width, material, seed, translation, opts = {}) {
  const d = { p: [], uv: [], c: [], i: [] };
  for (let j = 0; j < count; j++) {
    const varied = 0.86 + 0.14 * Math.sin(seed * 2.3 + j * 4.1);
    addLeaf(d, { length: length * varied, width: width * (0.92 + 0.08 * Math.cos(j * 2.7)), yaw: j / count * TAU + seed, pitch: -0.78 + 0.12 * Math.sin(j * 2 + seed), height: 0.015 + 0.015 * (j % 2), color: opts.color, lobes: opts.lobes || 0, curl: opts.curl ?? 0.16, material });
  }
  return finalizePlant(name, d, material, translation, species);
}

function fern(name, seed, translation) {
  const d = { p: [], uv: [], c: [], i: [] };
  for (let f = 0; f < 6; f++) {
    const yaw = f / 6 * TAU + seed, len = 0.48 * (0.86 + 0.12 * Math.sin(f * 3.7));
    for (let k = 1; k <= 8; k++) {
      const t = k / 9, leaflet = 0.095 * Math.sin(Math.PI * t) + 0.035;
      for (const side of [-1, 1]) addLeaf(d, { length: leaflet, width: 0.035, yaw: yaw + side * (1.15 + 0.18 * t), pitch: -0.30, height: t * len * 0.85, color: [0.55, 0.82, 0.52], curl: 0.09, rows: 3, cols: 2 });
    }
  }
  return finalizePlant(name, d, 2, translation, 'fern');
}

function buildRocks() {
  const images = ['rock_mossy_a_diff.png','rock_mossy_a_nor_gl.png','rock_mossy_a_rough.png','rock_mossy_b_diff.png','rock_mossy_b_nor_gl.png','rock_mossy_b_rough.png','rock_lichen_diff.png','rock_lichen_nor_gl.png','rock_lichen_rough.png'].map(x => path.join(OUT, x));
  const mat = (name, base, normal, rough) => ({ name, pbrMetallicRoughness: { baseColorTexture: { index: base }, metallicFactor: 0, roughnessFactor: 1, metallicRoughnessTexture: { index: rough } }, normalTexture: { index: normal, scale: 0.72 }, doubleSided: false });
  const mats = [mat('mossy_stone_a',0,1,2), mat('mossy_stone_b',3,4,5), mat('lichen_stone',6,7,8)];
  const specs = [[1.4,.58,1.05],[1.3,.64,.95],[1.15,.52,.9],[.88,.42,.72],[.82,.36,.65],[.74,.34,.61],[.66,.30,.54],[.48,.23,.39],[.40,.19,.34],[.33,.16,.28]];
  const meshes = specs.map((s, i) => rockMesh(`rock_${String(i + 1).padStart(2,'0')}`, s, i % 3, i + 1.7, [((i % 5) - 2) * 1.65, 0, (Math.floor(i / 5) - .5) * 1.55]));
  writeMultiGlb(path.join(OUT, 'rocks_mossy.glb'), meshes, mats, images);
}

function buildPlants() {
  const normalPath = path.join(OUT, 'leaf_veins_nor_gl.png');
  const hasNormal = fs.existsSync(normalPath);
  const makeMat = (name, base, roughness) => ({ name, pbrMetallicRoughness: { baseColorFactor: [...base, 1], metallicFactor: 0, roughnessFactor: roughness }, ...(hasNormal ? { normalTexture: { index: 0, scale: 0.55 } } : {}), doubleSided: true, alphaMode: 'OPAQUE' });
  const mats = [makeMat('hosta_leaf',[.30,.50,.24],.48), makeMat('butterbur_leaf',[.35,.52,.28],.56), makeMat('fern_leaf',[.25,.44,.20],.58), makeMat('saxifrage_leaf',[.38,.53,.30],.52)];
  const meshes = [
    rosette('hosta_01','hosta',9,.48,.23,0,.2,[-1.5,0,-.7],{color:[.62,.87,.56],curl:.16}),
    rosette('hosta_02','hosta',8,.45,.21,0,1.1,[-.5,0,-.7],{color:[.54,.78,.49],curl:.20}),
    rosette('butterbur_01','butterbur',7,.52,.31,1,.55,[.55,0,-.7],{color:[.63,.82,.54],lobes:.34,curl:.13}),
    rosette('butterbur_02','butterbur',8,.46,.28,1,1.5,[1.55,0,-.7],{color:[.57,.76,.48],lobes:.30,curl:.17}),
    fern('fern_01',.25,[-1.15,0,.65]), fern('fern_02',1.15,[-.15,0,.65]),
    rosette('saxifrage_01','saxifrage',11,.41,.15,3,.85,[.85,0,.65],{color:[.65,.79,.55],lobes:.15,curl:.10}),
    rosette('wild_ginger_01','wild_ginger',8,.42,.23,3,1.8,[1.65,0,.65],{color:[.50,.70,.43],lobes:.18,curl:.15}),
  ];
  writeMultiGlb(path.join(OUT, 'broadleaf_plants.glb'), meshes, mats, hasNormal ? [normalPath] : []);
}

buildRocks();
buildPlants();
