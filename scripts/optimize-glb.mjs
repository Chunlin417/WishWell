// 把 AI 生成的高面数 GLB（如 Tripo 导出的）精简成适合手机网页的版本：
//   - 三角形数减到目标值（保留 UV 接缝和法线）
//   - 贴图缩小并转成 JPEG（用 Python Pillow，项目里压缩贴图已经在用）
// 用法：node scripts/optimize-glb.mjs <输入.glb> <输出.glb> [目标三角形数=60000] [贴图尺寸=1024]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , IN, OUT, T = '60000', TS = '1024'] = process.argv;
const TARGET = +T, TEX = +TS;
if (!IN || !OUT) { console.error('usage: node scripts/optimize-glb.mjs in.glb out.glb [tris] [texSize]'); process.exit(1); }

// ---------- 读 GLB ----------
const buf = fs.readFileSync(IN);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const view = i => { const v = json.bufferViews[i]; return buf.subarray(binStart + (v.byteOffset || 0), binStart + (v.byteOffset || 0) + v.byteLength); };
const COMP = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function accessor(i) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], T = COMP[a.componentType], n = SIZE[a.type];
  const raw = view(a.bufferView), stride = v.byteStride || n * T.BYTES_PER_ELEMENT, out = new T(a.count * n);
  const src = Buffer.from(raw.subarray(a.byteOffset || 0));
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = k * stride + c * T.BYTES_PER_ELEMENT;
    out[k * n + c] = T === Float32Array ? src.readFloatLE(o) : T === Uint32Array ? src.readUInt32LE(o) : T === Uint16Array ? src.readUInt16LE(o) : src.readUInt8(o);
  }
  return out;
}
if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1) throw new Error('只支持单个网格、单个 primitive 的模型');
const prim = json.meshes[0].primitives[0];
const pos = accessor(prim.attributes.POSITION), nrm = accessor(prim.attributes.NORMAL), uv = accessor(prim.attributes.TEXCOORD_0);
const idx = Uint32Array.from(accessor(prim.indices));
const nv = pos.length / 3;
console.log('input: triangles', idx.length / 3, 'vertices', nv);

// ---------- 精简 ----------
await MeshoptSimplifier.ready;
const attrs = new Float32Array(nv * 5);
for (let i = 0; i < nv; i++) { attrs.set(nrm.subarray(i * 3, i * 3 + 3), i * 5); attrs.set(uv.subarray(i * 2, i * 2 + 2), i * 5 + 3); }
const [sIdx, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attrs, 5, [.4, .4, .4, 1.5, 1.5], null, TARGET * 3, .01, []);
const [remap, unique] = MeshoptSimplifier.compactMesh(sIdx);   // 原地改写 sIdx
const P = new Float32Array(unique * 3), N = new Float32Array(unique * 3), UV = new Float32Array(unique * 2);
for (let i = 0; i < nv; i++) {
  const r = remap[i]; if (r === 0xffffffff) continue;
  P.set(pos.subarray(i * 3, i * 3 + 3), r * 3); N.set(nrm.subarray(i * 3, i * 3 + 3), r * 3); UV.set(uv.subarray(i * 2, i * 2 + 2), r * 2);
}
console.log('output: triangles', sIdx.length / 3, 'vertices', unique, 'error', err.toFixed(5));

// ---------- 贴图：缩小 + JPEG ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glbtex-'));
const images = json.images.map((im, i) => {
  const src = path.join(tmp, `in${i}`), dst = path.join(tmp, `out${i}.jpg`);
  fs.writeFileSync(src, view(im.bufferView));
  const q = /normal/i.test(im.name || '') ? 92 : 85;   // 法线贴图对压缩瑕疵更敏感
  execFileSync('python', ['-c',
    'import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert("RGB");s=int(sys.argv[3]);' +
    'im=im.resize((s,s),Image.LANCZOS) if im.width>s else im;im.save(sys.argv[2],"JPEG",quality=int(sys.argv[4]),optimize=True)',
    src, dst, String(TEX), String(q)]);
  const data = fs.readFileSync(dst);
  console.log('texture', im.name, (view(im.bufferView).length / 1024).toFixed(0), 'KB ->', (data.length / 1024).toFixed(0), 'KB');
  return { name: im.name, data };
});
fs.rmSync(tmp, { recursive: true, force: true });

// ---------- 写 GLB ----------
const chunks = [], views = [], accessors = [];
let off = 0;
const pushView = (b, target) => {
  const pad = (4 - b.length % 4) % 4;
  views.push({ buffer: 0, byteOffset: off, byteLength: b.length, ...(target ? { target } : {}) });
  chunks.push(b, Buffer.alloc(pad)); off += b.length + pad;
  return views.length - 1;
};
const pushAcc = (arr, type, comp, count, target, extra = {}) => {
  const v = pushView(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), target);
  accessors.push({ bufferView: v, componentType: comp, count, type, ...extra });
  return accessors.length - 1;
};
const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
const A = {
  POSITION: pushAcc(P, 'VEC3', 5126, unique, 34962, { min: mn, max: mx }),
  NORMAL: pushAcc(N, 'VEC3', 5126, unique, 34962),
  TEXCOORD_0: pushAcc(UV, 'VEC2', 5126, unique, 34962),
};
const I = pushAcc(sIdx, 'SCALAR', 5125, sIdx.length, 34963);
const imgs = images.map(im => ({ name: im.name.replace(/\.\w+$/, '.jpg'), mimeType: 'image/jpeg', bufferView: pushView(im.data) }));
const out = {
  asset: { version: '2.0', generator: 'wish-pool optimize-glb (source: ' + (json.asset.generator || '?') + ')' },
  scene: 0, scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: json.nodes[0].name }],
  meshes: [{ primitives: [{ attributes: A, indices: I, material: 0 }] }],
  materials: json.materials.map(m => { const { extensions, ...rest } = m; return rest; }),
  textures: json.textures, samplers: json.samplers, images: imgs,
  accessors, bufferViews: views, buffers: [{ byteLength: off }],
};
let js = Buffer.from(JSON.stringify(out));
js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
const bin = Buffer.concat(chunks);
const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([head, jh, js, bh, bin]));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(2), 'MB');
