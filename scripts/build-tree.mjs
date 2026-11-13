// 把 Tripo 生成的古树（无贴图、50 万三角面）精简成网页能用的版本，并算出：
//   - 树干中心、高度、碰撞半径
//   - 挂木牌的位置（树枝下面、悬挂空间够的点）
//   - 树叶卡片的锚点（枝条表面的点）
//   - 精简之前先把树形改成矮而宽的伞状：分枝以上的部分压矮、沿半径方向往外拉，向上长的枝条变成近水平伸展
// 用法：node scripts/build-tree.mjs <输入.glb> [输出.glb=public/models/ancient_tree.glb] [目标三角形数=55000] [缩放=6.6]
// 输出的 .glb 保持原始坐标；同名 .json 里的位置也是原始坐标（运行时乘缩放即可）
import fs from 'node:fs';
import path from 'node:path';
import { MeshoptSimplifier } from 'meshoptimizer';

const [, , IN, OUT = 'public/models/ancient_tree.glb', T = '55000', SC = '6.6'] = process.argv;
const TARGET = +T, S = +SC;
if (!IN) { console.error('usage: node scripts/build-tree.mjs in.glb [out.glb] [tris] [scale]'); process.exit(1); }

const buf = fs.readFileSync(IN);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const binStart = 20 + jsonLen + 8;
const prim = json.meshes[0].primitives[0];
function acc(i, T, n) {
  const a = json.accessors[i], v = json.bufferViews[a.bufferView], base = binStart + (v.byteOffset || 0) + (a.byteOffset || 0);
  const stride = v.byteStride || n * T.BYTES_PER_ELEMENT, out = new T(a.count * n), dv = new DataView(buf.buffer, buf.byteOffset);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const o = base + k * stride + c * T.BYTES_PER_ELEMENT;
    out[k * n + c] = T === Float32Array ? dv.getFloat32(o, true) : T === Uint32Array ? dv.getUint32(o, true) : dv.getUint16(o, true);
  }
  return out;
}
const pos = acc(prim.attributes.POSITION, Float32Array, 3), nrm = acc(prim.attributes.NORMAL, Float32Array, 3);
const ia = json.accessors[prim.indices], idx0 = acc(prim.indices, ia.componentType === 5125 ? Uint32Array : Uint16Array, 1);
const nv = pos.length / 3;
console.log('input: triangles', idx0.length / 3, 'vertices', nv);

// ---------- 改树形：分枝高度 Y0 以上，高度压到 SQUASH 倍，离树干的距离随高度放大到最多 1 + SPREAD 倍 ----------
// 树干、树根不动；枝条越高被拉得越开——原来向上的枝变成向外平伸，树冠成伞状
const Y0 = .36, SQUASH = .62, SPREAD = .95;
{
  let ax = 0, az = 0, an = 0, top = 0;
  for (let i = 0; i < nv; i++) { const y = pos[i * 3 + 1]; top = Math.max(top, y); if (y > .11 && y < .2) { ax += pos[i * 3]; az += pos[i * 3 + 2]; an++; } }
  ax /= an; az /= an;
  for (let i = 0; i < nv; i++) {
    const y = pos[i * 3 + 1]; if (y <= Y0) continue;
    const t = (y - Y0) / (top - Y0), k = 1 + SPREAD * Math.pow(t, .8);
    pos[i * 3] = ax + (pos[i * 3] - ax) * k; pos[i * 3 + 2] = az + (pos[i * 3 + 2] - az) * k;
    pos[i * 3 + 1] = Y0 + (y - Y0) * SQUASH;
  }
}

// ---------- 去掉脚下那块薄圆盘：三个顶点都贴着地面、法线几乎竖直的三角形 ----------
const keep = [];
for (let t = 0; t < idx0.length; t += 3) {
  const a = idx0[t], b = idx0[t + 1], c = idx0[t + 2];
  const low = pos[a * 3 + 1] < .012 && pos[b * 3 + 1] < .012 && pos[c * 3 + 1] < .012;
  const flat = Math.abs(nrm[a * 3 + 1]) > .9 && Math.abs(nrm[b * 3 + 1]) > .9 && Math.abs(nrm[c * 3 + 1]) > .9;
  if (!(low && flat)) keep.push(a, b, c);
}
console.log('removed disc triangles', (idx0.length - keep.length) / 3);
const idx = Uint32Array.from(keep);

// ---------- 精简 ----------
await MeshoptSimplifier.ready;
const [sIdx, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, nrm, 3, [.5, .5, .5], null, TARGET * 3, .05, []);
const [remap, unique] = MeshoptSimplifier.compactMesh(sIdx);
const P = new Float32Array(unique * 3), N = new Float32Array(unique * 3);
for (let i = 0; i < nv; i++) { const r = remap[i]; if (r === 0xffffffff) continue; P.set(pos.subarray(i * 3, i * 3 + 3), r * 3); N.set(nrm.subarray(i * 3, i * 3 + 3), r * 3); }
// 树形改过了：按精简后的三角形重新算法线（按面积加权）
N.fill(0);
for (let t = 0; t < sIdx.length; t += 3) {
  const a = sIdx[t] * 3, b = sIdx[t + 1] * 3, c = sIdx[t + 2] * 3;
  const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
}
for (let i = 0; i < unique; i++) { const l = Math.hypot(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]) || 1; N[i * 3] /= l; N[i * 3 + 1] /= l; N[i * 3 + 2] /= l; }
console.log('output: triangles', sIdx.length / 3, 'vertices', unique, 'error', err.toFixed(5));

// ---------- 写 GLB ----------
const min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9];
for (let i = 0; i < unique; i++) for (let c = 0; c < 3; c++) { min[c] = Math.min(min[c], P[i * 3 + c]); max[c] = Math.max(max[c], P[i * 3 + c]); }
const pad4 = n => (n + 3) & ~3;
const bufs = [Buffer.from(P.buffer), Buffer.from(N.buffer), Buffer.from(new Uint32Array(sIdx).buffer)];
let off = 0; const views = bufs.map(b => { const v = { buffer: 0, byteOffset: off, byteLength: b.length }; off += pad4(b.length); return v; });
const gj = {
  asset: { version: '2.0', generator: 'wish build-tree.mjs' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: 'ancient_tree' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: 'bark', pbrMetallicRoughness: { baseColorFactor: [.35, .28, .22, 1], metallicFactor: 0, roughnessFactor: 1 } }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: unique, type: 'VEC3', min, max },
    { bufferView: 1, componentType: 5126, count: unique, type: 'VEC3' },
    { bufferView: 2, componentType: 5125, count: sIdx.length, type: 'SCALAR' },
  ],
  bufferViews: views.map((v, i) => ({ ...v, target: i < 2 ? 34962 : 34963 })), buffers: [{ byteLength: off }],
};
const jb = Buffer.from(JSON.stringify(gj)); const jpad = Buffer.alloc(pad4(jb.length) - jb.length, 0x20);
const bin = Buffer.alloc(off); bufs.forEach((b, i) => b.copy(bin, views[i].byteOffset));
const total = 12 + 8 + jb.length + jpad.length + 8 + bin.length;
const out = Buffer.alloc(total); let o = 0;
out.writeUInt32LE(0x46546c67, o); out.writeUInt32LE(2, o + 4); out.writeUInt32LE(total, o + 8); o += 12;
out.writeUInt32LE(jb.length + jpad.length, o); out.writeUInt32LE(0x4e4f534a, o + 4); o += 8; jb.copy(out, o); jpad.copy(out, o + jb.length); o += jb.length + jpad.length;
out.writeUInt32LE(bin.length, o); out.writeUInt32LE(0x004e4942, o + 4); o += 8; bin.copy(out, o);
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, out);
console.log('wrote', OUT, (total / 1e6).toFixed(2) + 'MB');

// ---------- 分析：树干、挂牌点、树叶锚点 ----------
const H = max[1];
// 树干中心：离地 0.11～0.2 的顶点的平均位置
let cx = 0, cz = 0, cn = 0;
for (let i = 0; i < unique; i++) { const y = P[i * 3 + 1]; if (y > .11 && y < .2) { cx += P[i * 3]; cz += P[i * 3 + 2]; cn++; } }
cx /= cn; cz /= cn;
// 树干半径：同一高度范围里顶点离中心距离的第 60 百分位
const rs = []; for (let i = 0; i < unique; i++) { const y = P[i * 3 + 1]; if (y > .11 && y < .2) rs.push(Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz)); }
rs.sort((a, b) => a - b); const trunkR = rs[Math.floor(rs.length * .6)];
console.log('height', H.toFixed(3), 'trunk center', cx.toFixed(3), cz.toFixed(3), 'trunk radius', trunkR.toFixed(3));

// 空间哈希：查"这个点下面是不是空的"
const CELL = .03, hash = new Map(), key = (x, z) => (Math.floor(x / CELL) * 73856093) ^ (Math.floor(z / CELL) * 19349663);
for (let i = 0; i < unique; i++) { const k = key(P[i * 3], P[i * 3 + 2]); (hash.get(k) || hash.set(k, []).get(k)).push(P[i * 3 + 1]); }
const clear = (x, y, z, depth) => {
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (const yy of hash.get(key(x + dx * CELL, z + dz * CELL)) || []) if (yy < y - .008 && yy > y - depth) return false;
  return true;
};
let seed = 12345; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const cand = [];
for (let i = 0; i < unique; i++) {
  const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], ny = N[i * 3 + 1], r = Math.hypot(x - cx, z - cz);
  if (ny < -.3 && r * S > 1.7 && y * S > 2.1 && y * S < 3.9 && clear(x, y, z, .9 / S)) cand.push([x, y, z, r]);
}
// 先贪心取点（最小间距 0.3 米），再按离已选的点最远的顺序排：前面十来个挂点就已经分散在各根枝上，不会挤在一起
const picked = [], minD = .3 / S;
for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
for (const c of cand) { if (picked.every(s => Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]) > minD)) picked.push(c); if (picked.length >= 160) break; }
const slots = [];
if (picked.length) {
  const d = picked.map(() => Infinity); let cur = 0;
  for (let k = 0; k < picked.length; k++) {
    const c = picked[cur]; slots.push([+c[0].toFixed(4), +c[1].toFixed(4), +c[2].toFixed(4)]); d[cur] = -1;
    let best = -1, bd = -1;
    for (let i = 0; i < picked.length; i++) { if (d[i] < 0) continue; d[i] = Math.min(d[i], Math.hypot(picked[i][0] - c[0], (picked[i][1] - c[1]) * 2, picked[i][2] - c[2])); if (d[i] > bd) { bd = d[i]; best = i; } }
    if (best < 0) break; cur = best;
  }
}
console.log('hang candidates', cand.length, 'slots', slots.length);
// 树叶锚点：枝条的上面和侧面（分枝高度以上、离树干一段距离），随机取 2200 个
const leafPts = [];
const surf = []; for (let i = 0; i < unique; i++) { const y = P[i * 3 + 1], r = Math.hypot(P[i * 3] - cx, P[i * 3 + 2] - cz); if (y > Y0 + .05 && r > trunkR * 1.6 && N[i * 3 + 1] > -.3) surf.push(i); }
for (let k = 0; k < 2200 && surf.length; k++) { const i = surf[Math.floor(rnd() * surf.length)]; leafPts.push([+P[i * 3].toFixed(4), +P[i * 3 + 1].toFixed(4), +P[i * 3 + 2].toFixed(4), +N[i * 3].toFixed(2), +N[i * 3 + 1].toFixed(2), +N[i * 3 + 2].toFixed(2)]); }
fs.writeFileSync(OUT.replace(/\.glb$/, '.json'), JSON.stringify({ height: H, trunk: [cx, cz], trunkR, min, max, slots, leaves: leafPts }));
console.log('leaf anchors', leafPts.length);
