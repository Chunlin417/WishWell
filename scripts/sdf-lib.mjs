// 距离场雕刻工具：基础形状、平滑融合、网格化（Marching Cubes + 简化）、烘焙、写 GLB
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { MeshBasicMaterial } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

// ---------- 数学 ----------
export const hyp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
export const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
export const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; }
export const smax = (a, b, k) => -smin(-a, -b, k);
export const unionAll = (fns, k) => (x, y, z) => { let d = 1e9; for (const f of fns) d = smin(d, f(x, y, z), k); return d; };
export const norm = v => { const l = hyp(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function basis(n) { n = norm(n); const up = Math.abs(n[1]) > .9 ? [1, 0, 0] : [0, 1, 0]; const u = norm(cross(up, n)); return [u, cross(n, u)]; }

// ---------- 摆放：world = 平移(c) · Ry(ry) · Rx(rx) · Rz(rz) · local ----------
export function xf(fn, c, ry = 0, rx = 0, rz = 0) {
  const cy = Math.cos(-ry), sy = Math.sin(-ry), cx = Math.cos(-rx), sx = Math.sin(-rx), cz = Math.cos(-rz), sz = Math.sin(-rz);
  return (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2], t;
    t = px * cy + pz * sy; pz = -px * sy + pz * cy; px = t;
    t = py * cx - pz * sx; pz = py * sx + pz * cx; py = t;
    t = px * cz - py * sz; py = px * sz + py * cz; px = t;
    return fn(px, py, pz);
  };
}
// 把局部坐标的点变到世界坐标（和 xf 用同一套旋转）
export function xfPoint(p, c, ry = 0, rx = 0, rz = 0) {
  let [x, y, z] = p, t;
  t = x * Math.cos(rz) - y * Math.sin(rz); y = x * Math.sin(rz) + y * Math.cos(rz); x = t;
  t = y * Math.cos(rx) - z * Math.sin(rx); z = y * Math.sin(rx) + z * Math.cos(rx); y = t;
  t = x * Math.cos(ry) + z * Math.sin(ry); z = -x * Math.sin(ry) + z * Math.cos(ry); x = t;
  return [x + c[0], y + c[1], z + c[2]];
}
export const mirror = f => (x, y, z) => f(Math.abs(x), y, z);   // 左右对称的部件只写右边（x > 0）

// ---------- 基础形状 ----------
export const ell = (c, r, ry, rx, rz) => xf((x, y, z) => {
  const px = x / r[0], py = y / r[1], pz = z / r[2];
  const k0 = hyp(px, py, pz), k1 = hyp(px / r[0], py / r[1], pz / r[2]);
  return k1 < 1e-9 ? -Math.min(...r) : k0 * (k0 - 1) / k1;
}, c, ry, rx, rz);
export const sph = (c, r) => (x, y, z) => hyp(x - c[0], y - c[1], z - c[2]) - r;
export const rbox = (c, h, r) => (x, y, z) => {
  const qx = Math.abs(x - c[0]) - h[0] + r, qy = Math.abs(y - c[1]) - h[1] + r, qz = Math.abs(z - c[2]) - h[2] + r;
  return hyp(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
export const torus = (R, r, bump = 0, nb = 0) => (x, y, z) => {
  const a = Math.atan2(z, x), q = Math.hypot(x, z) - R;
  return Math.hypot(q, y) - r - bump * Math.sin(a * nb + Math.atan2(y, q) * 2);   // bump：绳子的扭纹
};
// 两端半径不同的圆锥胶囊（Inigo Quilez 的 sdRoundCone）
export function rcone(a, b, r1, r2) {
  const bx = b[0] - a[0], by = b[1] - a[1], bz = b[2] - a[2];
  const l2 = bx * bx + by * by + bz * bz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  return (x, y, z) => {
    const px = x - a[0], py = y - a[1], pz = z - a[2];
    const yy = px * bx + py * by + pz * bz, zz = yy - l2;
    const qx = px * l2 - bx * yy, qy = py * l2 - by * yy, qz = pz * l2 - bz * yy;
    const x2 = qx * qx + qy * qy + qz * qz, y2 = yy * yy * l2, z2 = zz * zz * l2;
    const k = Math.sign(rr) * rr * rr * x2;
    if (Math.sign(zz) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
    if (Math.sign(yy) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
    return (Math.sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
  };
}
// 沿一串点的管子：radii 可以是 [起, 止]，也可以每个点一个半径
export function tube(pts, radii, k = .006) {
  const n = pts.length - 1, R = radii.length === pts.length ? radii : pts.map((_, i) => radii[0] + (radii[1] - radii[0]) * i / n);
  const segs = [];
  for (let i = 0; i < n; i++) segs.push(rcone(pts[i], pts[i + 1], R[i], R[i + 1]));
  return unionAll(segs, k);
}
// 平面螺旋：中心 c，平面由 u、v 张成
export function spiralPts(c, u, v, R, turns, a0 = 0, n = 16, shrink = .8) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + t * turns * Math.PI * 2, r = R * (1 - shrink * t);
    pts.push([0, 1, 2].map(k => c[k] + (Math.cos(a) * u[k] + Math.sin(a) * v[k]) * r));
  }
  return pts;
}
// 包围盒加速：离盒子远时直接返回到盒子的距离
export function bounded(fn, mn, mx, pad = .06) {
  return (x, y, z) => {
    const dx = Math.max(mn[0] - x, x - mx[0], 0), dy = Math.max(mn[1] - y, y - mx[1], 0), dz = Math.max(mn[2] - z, z - mx[2], 0);
    const bd = hyp(dx, dy, dz);
    return bd > pad ? bd : fn(x, y, z);
  };
}
// 沿方向 dir 从 p 出发找到表面上的点（用于把刻线贴在曲面上）
export function snap(fn, p, dir, maxT = .4) {
  const d = norm(dir);
  let t = 0;
  for (let i = 0; i < 200 && t < maxT; i++) {
    const q = [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t], s = fn(...q);
    if (s < .0003) return q;
    t += Math.max(s * .8, .0004);
  }
  return [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
}
export const gradient = (fn, x, y, z, e = .001) => norm([fn(x + e, y, z) - fn(x - e, y, z), fn(x, y + e, z) - fn(x, y - e, z), fn(x, y, z + e) - fn(x, y, z - e)]);

// ---------- 网格化 ----------
export async function buildMesh(sdf, { center, half, res, targetTris, error = .0015 }) {
  const N = res, cell = 2 * half / N;
  const w = (i, k) => center[k] + ((i - N / 2) / (N / 2)) * half;
  console.time('field');
  const mc = new MarchingCubes(N, new MeshBasicMaterial(), false, false, 2500000);
  mc.isolation = 0;
  const S = 4, NC = Math.floor(N / S) + 1, coarse = new Float32Array(NC ** 3);
  for (let k = 0; k < NC; k++) for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++)
    coarse[i + j * NC + k * NC * NC] = sdf(w(i * S, 0), w(j * S, 1), w(k * S, 2));
  const band = S * cell * 1.8;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let d = coarse[Math.min(NC - 1, Math.round(x / S)) + Math.min(NC - 1, Math.round(y / S)) * NC + Math.min(NC - 1, Math.round(z / S)) * NC * NC];
    if (Math.abs(d) < band) d = sdf(w(x, 0), w(y, 1), w(z, 2));
    mc.field[x + y * N + z * N * N] = -d;   // MarchingCubes 约定：里面为正
  }
  console.timeEnd('field');
  mc.update();
  const vcount = mc.count, raw = mc.geometry.attributes.position.array;
  console.log('marching cubes triangles', vcount / 3);
  // 焊接顶点
  const map = new Map(), pos = [], idx = new Uint32Array(vcount);
  for (let i = 0; i < vcount; i++) {
    const x = center[0] + raw[i * 3] * half, y = center[1] + raw[i * 3 + 1] * half, z = center[2] + raw[i * 3 + 2] * half;
    const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
    let v = map.get(key);
    if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
    idx[i] = v;
  }
  const P = new Float32Array(pos);
  { // 绕序：面法线要和距离场梯度（朝外）一致
    const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
    const fn = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
    const g = gradient(sdf, (P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
    if (fn[0] * g[0] + fn[1] * g[1] + fn[2] * g[2] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  await MeshoptSimplifier.ready;
  const [sIdx, err] = MeshoptSimplifier.simplify(idx, P, 3, targetTris * 3, error, []);
  const [remap, unique] = MeshoptSimplifier.compactMesh(sIdx);   // 原地改写 sIdx
  const fPos = new Float32Array(unique * 3);
  for (let i = 0; i < P.length / 3; i++) if (remap[i] !== 0xffffffff) fPos.set(P.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  console.log('simplified triangles', sIdx.length / 3, 'vertices', unique, 'error', err.toFixed(5));
  return { pos: fPos, idx: sIdx, count: unique };
}

// 凹处遮蔽（AO）：沿法线往外走几步，看离表面有多近
export function bakeAO(sdf, x, y, z, n, step = .009, gain = 7) {
  let occ = 0, w = 1;
  for (let s = 1; s <= 6; s++) { const h = step * s; occ += (h - sdf(x + n[0] * h, y + n[1] * h, z + n[2] * h)) * w; w *= .72; }
  return clamp(1 - occ * gain);
}

// ---------- 写 GLB ----------
// attrs：{ 名字: [Float32Array, 'VEC3' | 'SCALAR'] }，POSITION 必须有
export function writeGLB(file, attrs, indices, extras, material) {
  const chunks = [], views = [], accessors = [];
  let off = 0;
  const add = (arr, type, comp, count, target, extra = {}) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - b.length % 4) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    chunks.push(b, Buffer.alloc(pad)); off += b.length + pad;
    accessors.push({ bufferView: views.length - 1, componentType: comp, count, type, ...extra });
    return accessors.length - 1;
  };
  const posArr = attrs.POSITION[0], n = posArr.length / 3;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < posArr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], posArr[i + k]); mx[k] = Math.max(mx[k], posArr[i + k]); }
  const A = {};
  for (const [name, [arr, type]] of Object.entries(attrs)) A[name] = add(arr, type, 5126, n, 34962, name === 'POSITION' ? { min: mn, max: mx } : {});
  const I = add(indices, 'SCALAR', 5125, indices.length, 34963);
  const json = {
    asset: { version: '2.0', generator: 'wish-pool sdf sculpt' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: path.basename(file, '.glb'), extras }],
    meshes: [{ primitives: [{ attributes: A, indices: I, material: 0 }] }],
    materials: [material],
    accessors, bufferViews: views, buffers: [{ byteLength: off }],
  };
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - js.length % 4) % 4, 0x20)]);
  const bin = Buffer.concat(chunks);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546C67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4E4F534A, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004E4942, 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([head, jh, js, bh, bin]));
  console.log('wrote', file, (fs.statSync(file).size / 1024).toFixed(0), 'KB');
}
