// 用"距离场"雕刻一只镇水兽（蚣蝮）：各部分像捏泥一样平滑融合，再用 Marching Cubes 转成网格，
// 简化后烘焙凹处阴影 / 青苔 / 鳞片区域，导出成 public/models/zhenshuishou.glb
//
// 用法：node scripts/build-zhenshuishou.mjs [网格分辨率=240] [目标三角形数=70000]
// 坐标：单位与场景一致（缩放前）；底座底面在 y = 0，兽头朝 +z
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { MeshBasicMaterial } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { noise3, fbm3 } from '../src/noise.js';
import fs from 'node:fs';
import path from 'node:path';

const RES = +(process.argv[2] || 240);
const TARGET_TRIS = +(process.argv[3] || 70000);
const OUT = path.resolve('public/models/zhenshuishou.glb');

// ================= 距离场基础 =================
const hyp = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * .25; }
const smax = (a, b, k) => -smin(-a, -b, k);
const unionAll = (fns, k) => (x, y, z) => { let d = 1e9; for (const f of fns) d = smin(d, f(x, y, z), k); return d; };

// 局部坐标里的形状 + 平移 / 旋转（绕 y 偏航、绕 x 俯仰、绕 z 翻滚）
function xf(fn, c, ry = 0, rx = 0, rz = 0) {
  const cy = Math.cos(-ry), sy = Math.sin(-ry), cx = Math.cos(-rx), sx = Math.sin(-rx), cz = Math.cos(-rz), sz = Math.sin(-rz);
  return (x, y, z) => {
    let px = x - c[0], py = y - c[1], pz = z - c[2], t;
    t = px * cy + pz * sy; pz = -px * sy + pz * cy; px = t;
    t = py * cx - pz * sx; pz = py * sx + pz * cx; py = t;
    t = px * cz - py * sz; py = px * sz + py * cz; px = t;
    return fn(px, py, pz);
  };
}
const E = r => (x, y, z) => {   // 椭球（近似距离）
  const px = x / r[0], py = y / r[1], pz = z / r[2];
  const k0 = hyp(px, py, pz), k1 = hyp(px / r[0], py / r[1], pz / r[2]);
  return k1 < 1e-9 ? -Math.min(...r) : k0 * (k0 - 1) / k1;
};
const ell = (c, r, ry, rx, rz) => xf(E(r), c, ry, rx, rz);
const sph = (c, r) => (x, y, z) => hyp(x - c[0], y - c[1], z - c[2]) - r;
const rbox = (c, h, r) => (x, y, z) => {
  const qx = Math.abs(x - c[0]) - h[0] + r, qy = Math.abs(y - c[1]) - h[1] + r, qz = Math.abs(z - c[2]) - h[2] + r;
  return hyp(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
};
// 两端半径不同的圆锥胶囊（Inigo Quilez 的 sdRoundCone）
function rcone(a, b, r1, r2) {
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
// 沿一串点的管子，半径从 r0 渐变到 r1
function tube(pts, r0, r1, k = .006) {
  const n = pts.length - 1, segs = [];
  for (let i = 0; i < n; i++) segs.push(rcone(pts[i], pts[i + 1], r0 + (r1 - r0) * i / n, r0 + (r1 - r0) * (i + 1) / n));
  return unionAll(segs, k);
}
// 平面螺旋（卷云 / 卷毛 / 卷尾）：中心 c，平面由 u、v 两个方向张成
function spiralPts(c, u, v, R, turns, a0 = 0, n = 14, shrink = .78) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = a0 + t * turns * Math.PI * 2, r = R * (1 - shrink * t);
    pts.push([c[0] + (Math.cos(a) * u[0] + Math.sin(a) * v[0]) * r, c[1] + (Math.cos(a) * u[1] + Math.sin(a) * v[1]) * r, c[2] + (Math.cos(a) * u[2] + Math.sin(a) * v[2]) * r]);
  }
  return pts;
}
const norm = v => { const l = hyp(...v); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
// 以 n 为法线的平面上的一组正交方向
function basis(n) { n = norm(n); const up = Math.abs(n[1]) > .9 ? [1, 0, 0] : [0, 1, 0]; const u = norm(cross(up, n)); return [u, cross(n, u)]; }
// 包围盒加速：离盒子很远时直接返回到盒子的距离（是真实距离的下界，足够判断"不在表面附近"）
function bounded(fn, mn, mx, pad = .06) {
  return (x, y, z) => {
    const dx = Math.max(mn[0] - x, x - mx[0], 0), dy = Math.max(mn[1] - y, y - mx[1], 0), dz = Math.max(mn[2] - z, z - mx[2], 0);
    const bd = hyp(dx, dy, dz);
    return bd > pad ? bd : fn(x, y, z);
  };
}
const mirror = f => (x, y, z) => f(Math.abs(x), y, z);   // 左右对称的部件只写右边（x > 0）

// ================= 底座：三层石台，四面浪花浮雕 =================
const Y0 = .41;   // 台面高度，兽趴在上面
function waveH(u, v) {   // 海水纹：几排扇形浪头，每个浪头里有两道同心的弧
  let h = 0;
  for (let r = 0; r < 3; r++) {
    const yb = .06 + r * .3, s = u * 7.5 + r * .5, f = s - Math.floor(s);
    const arc = Math.pow(Math.sin(f * Math.PI), .75) * .24;
    for (let j = 0; j < 3; j++) {
      const line = yb + arc * (1 - j * .32) + j * .05;
      h = Math.max(h, 1 - Math.abs(v - line) / .026);
    }
  }
  return clamp(h);
}
function panelRelief(x, y, z) {
  const hx = .305, hz = .445, ax = Math.abs(x), az = Math.abs(z);
  let u, m;
  if (hx - ax < hz - az) { u = z; m = sstep(.41, .395, Math.abs(z)); } else { u = x; m = sstep(.27, .255, Math.abs(x)); }
  const v0 = .09, v1 = .32;
  m *= sstep(v0 - .006, v0 + .006, y) * sstep(v1 + .006, v1 - .006, y);
  if (m <= 0) return 0;
  const v = (y - v0) / (v1 - v0);
  return m * (.007 - waveH(u, v) * .0085);   // 先整体凹进去一点，浪纹再凸回来
}
const block = rbox([0, .205, 0], [.305, .145, .445], .01);
const pedestal = bounded(unionAll([
  rbox([0, .035, 0], [.335, .035, .475], .012),                     // 底层
  (x, y, z) => { const d = block(x, y, z); return d < .03 ? d + panelRelief(x, y, z) : d; },   // 中段（浮雕）
  rbox([0, .343, 0], [.315, .011, .455], .006),                     // 线脚
  rbox([0, .378, 0], [.325, .032, .465], .012),                     // 台面
], .004), [-.34, 0, -.48], [.34, Y0, .48]);

// ================= 身体：趴伏，背部隆起 =================
const spine = [];
for (let i = 0; i < 11; i++) {   // 背脊上一列低矮的鳍片
  const z = .06 - i * .043, y = Y0 + .305 - 1.15 * (z + .06) ** 2;
  const s = 1 - i * .045;
  spine.push(ell([0, y, z], [.011 * s, .034 * s, .025 * s], 0, -.45));
}
// 肩部的卷云纹（浅浅地刻进去）
const shoulderSwirl = mirror((() => {
  const c = [.178, Y0 + .2, .1], [u, v] = basis([1, .15, .2]);
  return tube(spiralPts(c, u, v, .055, 1.6, 0, 18, .85), .009, .006);
})());
const body = bounded((x, y, z) => {
  let d = unionAll([
    ell([0, Y0 + .16, -.06], [.2, .15, .31], 0, .06),           // 躯干
    ell([0, Y0 + .19, .13], [.185, .16, .15]),                   // 胸
    ell([0, Y0 + .24, -.1], [.15, .08, .22]),                    // 背部隆起
    mirror(ell([.145, Y0 + .13, -.22], [.115, .125, .16])),      // 后腿根（臀）
  ], .05)(x, y, z);
  d = smin(d, unionAll(spine, .01)(x, y, z), .012);
  d = smax(d, -shoulderSwirl(x, y, z), .004);                   // 刻卷云纹
  return d;
}, [-.3, Y0 - .02, -.45], [.3, Y0 + .38, .3]);

// ================= 四肢、爪子 =================
function paw(px, pz, toes, long = 1) {
  const parts = [ell([px, Y0 + .045, pz], [.068, .045, .07 * long])];
  const offs = toes === 4 ? [-.045, -.015, .015, .045] : [-.03, 0, .03];
  for (const o of offs) {
    const a = [px + o, Y0 + .05, pz + .02], b = [px + o * 1.15, Y0 + .028, pz + .065 * long];
    parts.push(rcone(a, b, .022, .017));
    parts.push(rcone([b[0], b[1] + .006, b[2] - .004], [px + o * 1.2, Y0 + .006, pz + .085 * long], .011, .003));   // 爪尖
  }
  return unionAll(parts, .008);
}
const legs = bounded(mirror(unionAll([
  tube([[.115, Y0 + .15, .14], [.12, Y0 + .075, .24], [.105, Y0 + .05, .33]], .072, .05, .02),   // 前腿
  paw(.105, .37, 4),
  tube([[.18, Y0 + .12, -.2], [.215, Y0 + .05, -.1]], .07, .05, .02),                         // 折起的后腿
  paw(.215, -.07, 3, .9),
], .02)), [-.3, Y0 - .01, -.3], [.3, Y0 + .25, .48]);

// ================= 头：龙首 =================
const brow = mirror(tube([[.025, Y0 + .535, .335], [.09, Y0 + .548, .315], [.142, Y0 + .52, .27]], .027, .019));
const whisker = mirror(tube([[.085, Y0 + .405, .43], [.13, Y0 + .392, .4], [.152, Y0 + .345, .365], [.138, Y0 + .3, .345], [.113, Y0 + .305, .352], [.117, Y0 + .33, .36]], .015, .008, .004));
const beard = unionAll([-2, -1, 0, 1, 2].map(i => {
  const x = i * .022, w = (i % 2 ? .01 : -.01);
  return tube([[x, Y0 + .3, .37], [x * 1.2 + w, Y0 + .25, .385], [x * 1.1 - w, Y0 + .205, .372], [x * 1.3 + w, Y0 + .165, .39]], .017, .007, .005);
}), .006);
const fangs = mirror(unionAll([
  rcone([.048, Y0 + .392, .43], [.051, Y0 + .335, .447], .013, .003),
  rcone([.058, Y0 + .318, .42], [.059, Y0 + .372, .433], .012, .003),
], .002));
const eyesPos = [[.07, Y0 + .487, .353], [-.07, Y0 + .487, .353]];
const headBase = unionAll([
  ell([0, Y0 + .47, .21], [.15, .135, .13]),                   // 头颅
  ell([0, Y0 + .53, .26], [.11, .06, .08]),                    // 额头
  rbox([0, Y0 + .415, .35], [.098, .058, .085], .048),         // 上颌
  ell([0, Y0 + .445, .425], [.055, .042, .04]),                // 鼻头
  mirror(ell([.115, Y0 + .41, .3], [.055, .06, .06])),         // 腮帮
  ell([0, Y0 + .325, .33], [.09, .04, .1]),                    // 下颌
  ell([0, Y0 + .31, .36], [.06, .035, .06]),                   // 下巴
  mirror(ell([.07, Y0 + .485, .325], [.033, .03, .026])),      // 凸起的眼球
  mirror(ell([.155, Y0 + .53, .17], [.055, .022, .035], .5, 0, .6)),   // 耳朵
], .02);
const spoutY = Y0 + .365;
const head = bounded((x, y, z) => {
  let d = smin(headBase(x, y, z), brow(x, y, z), .012);
  // 往里刻：张开的嘴、吐水孔、鼻孔、瞳孔、嘴角的唇线
  d = smax(d, -ell([0, Y0 + .36, .395], [.07, .03, .07])(x, y, z), .008);
  d = smax(d, -Math.max(Math.hypot(x, y - spoutY) - .024, .3 - z), .004);
  d = smax(d, -mirror(sph([.024, Y0 + .435, .462], .014))(x, y, z), .004);
  d = smax(d, -mirror(sph([.07, Y0 + .487, .356], .012))(x, y, z), .003);
  d = smax(d, -mirror(rcone([.072, Y0 + .36, .38], [.105, Y0 + .378, .325], .009, .006))(x, y, z), .003);
  // 再加上：獠牙、龙须、胡须
  d = smin(d, fangs(x, y, z), .004);
  d = smin(d, whisker(x, y, z), .008);
  d = smin(d, beard(x, y, z), .01);
  return d;
}, [-.24, Y0 + .14, .05], [.24, Y0 + .62, .48]);

// ================= 鬃毛：头后和颈部一圈卷云状的卷毛 =================
const headC = [0, Y0 + .44, .2];
const curls = [];
for (const [ringZ, ringY, rx, ry, a0, a1, n] of [[.15, Y0 + .46, .175, .155, -2.3, 2.3, 9], [.07, Y0 + .4, .2, .17, -2.6, -1.0, 3], [.07, Y0 + .4, .2, .17, 1.0, 2.6, 3]]) {
  for (let i = 0; i < n; i++) {
    const th = a0 + (a1 - a0) * (n === 1 ? .5 : i / (n - 1));
    const c = [Math.sin(th) * rx, ringY + Math.cos(th) * ry, ringZ - Math.abs(Math.sin(th)) * .03];
    const [u, v] = basis([c[0] - headC[0], c[1] - headC[1], c[2] - headC[2] - .12]);
    curls.push(tube(spiralPts(c, u, v, .042, 1.3, th * 2, 14, .8), .016, .009, .005));
  }
}
const mane = bounded((x, y, z) => smin(ell([0, Y0 + .42, .13], [.2, .17, .12])(x, y, z), unionAll(curls, .008)(x, y, z), .015),
  [-.26, Y0 + .18, -.05], [.26, Y0 + .66, .3]);

// ================= 角：向后弯，角尖微微上翘 =================
const horns = bounded(mirror(tube([[.05, Y0 + .57, .22], [.075, Y0 + .64, .17], [.095, Y0 + .675, .08], [.1, Y0 + .665, 0], [.09, Y0 + .628, -.05], [.086, Y0 + .642, -.088]], .033, .011, .008)),
  [-.14, Y0 + .5, -.13], [.14, Y0 + .72, .25]);

// ================= 尾巴：在身体右侧盘成一个大卷，外缘有几簇火焰状的小卷 =================
const tailC = [.255, Y0 + .19, -.27];
const tailSpiral = spiralPts(tailC, [0, .55, -.83], [0, -.83, -.55].map(v => -v), .115, 1.25, 0, 18, .82).map(([x, y, z], i) => [x + i * .0015, y, z]);
const tailParts = [
  tube([[.05, Y0 + .2, -.42], [.15, Y0 + .27, -.45], tailSpiral[0]], .06, .055, .02),
  tube(tailSpiral, .055, .017, .01),
];
for (const [i, s] of [[3, 1], [6, .85], [9, .7]]) {   // 火焰卷
  const p = tailSpiral[i], dir = norm([0, p[1] - tailC[1], p[2] - tailC[2]]);
  const c = [p[0] + .01, p[1] + dir[1] * .05 * s, p[2] + dir[2] * .05 * s];
  tailParts.push(tube(spiralPts(c, [0, dir[1], dir[2]], [0, -dir[2], dir[1]], .03 * s, 1.1, 0, 10, .75), .014 * s, .006, .004));
}
const tail = bounded(unionAll(tailParts, .015), [0, Y0, -.5], [.36, Y0 + .38, -.08]);

// ================= 组合 =================
const groups = { pedestal, body, legs, head, mane, horns, tail };
function beastD(x, y, z) {
  let d = smin(body(x, y, z), legs(x, y, z), .03);
  d = smin(d, mane(x, y, z), .03);
  d = smin(d, head(x, y, z), .035);
  d = smin(d, horns(x, y, z), .015);
  d = smin(d, tail(x, y, z), .025);
  return Math.max(d, Y0 - .01 - y);   // 兽身不穿进台面
}
const sdf = (x, y, z) => smin(pedestal(x, y, z), beastD(x, y, z), .014);

// ================= 采样距离场 → Marching Cubes =================
const C = [0, .555, 0], H = .6, N = RES, cell = 2 * H / N;
const wx = i => C[0] + ((i - N / 2) / (N / 2)) * H;
const wy = i => C[1] + ((i - N / 2) / (N / 2)) * H;
const wz = i => C[2] + ((i - N / 2) / (N / 2)) * H;

console.time('field');
const mc = new MarchingCubes(N, new MeshBasicMaterial(), false, false, 1500000);
mc.isolation = 0;
const S = 4, NC = Math.floor(N / S) + 1, coarse = new Float32Array(NC ** 3);
for (let k = 0; k < NC; k++) for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++)
  coarse[i + j * NC + k * NC * NC] = sdf(wx(i * S), wy(j * S), wz(k * S));
const band = S * cell * 1.8;
let exact = 0;
for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const ci = Math.min(NC - 1, Math.round(x / S)), cj = Math.min(NC - 1, Math.round(y / S)), ck = Math.min(NC - 1, Math.round(z / S));
  let d = coarse[ci + cj * NC + ck * NC * NC];
  if (Math.abs(d) < band) { d = sdf(wx(x), wy(y), wz(z)); exact++; }
  mc.field[x + y * N + z * N * N] = -d;   // MarchingCubes 约定：里面为正
}
console.timeEnd('field');
console.log('exact samples', exact);
console.time('mc');
mc.update();
console.timeEnd('mc');
const vcount = mc.count;
const rawPos = mc.geometry.attributes.position.array;
console.log('marching cubes triangles', vcount / 3);

// ================= 焊接顶点 → 修正朝向 → 简化 =================
const map = new Map(), pos = [], idx = new Uint32Array(vcount);
for (let i = 0; i < vcount; i++) {
  const x = C[0] + rawPos[i * 3] * H, y = C[1] + rawPos[i * 3 + 1] * H, z = C[2] + rawPos[i * 3 + 2] * H;
  const key = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
  let v = map.get(key);
  if (v === undefined) { v = pos.length / 3; map.set(key, v); pos.push(x, y, z); }
  idx[i] = v;
}
let P = new Float32Array(pos);
const grad = (x, y, z, e = .0012) => norm([sdf(x + e, y, z) - sdf(x - e, y, z), sdf(x, y + e, z) - sdf(x, y - e, z), sdf(x, y, z + e) - sdf(x, y, z - e)]);
{ // 用第一个三角形检查绕序：面法线要和距离场梯度（朝外）一致
  const a = idx[0] * 3, b = idx[1] * 3, c = idx[2] * 3;
  const fn = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]]);
  const g = grad((P[a] + P[b] + P[c]) / 3, (P[a + 1] + P[b + 1] + P[c + 1]) / 3, (P[a + 2] + P[b + 2] + P[c + 2]) / 3);
  if (fn[0] * g[0] + fn[1] * g[1] + fn[2] * g[2] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
}
await MeshoptSimplifier.ready;
const [sIdx, err] = MeshoptSimplifier.simplify(idx, P, 3, TARGET_TRIS * 3, .004, []);
const [remap, unique] = MeshoptSimplifier.compactMesh(sIdx);
const fPos = new Float32Array(unique * 3);
for (let i = 0; i < P.length / 3; i++) if (remap[i] !== 0xffffffff) fPos.set(P.subarray(i * 3, i * 3 + 3), remap[i] * 3);
const fIdx = sIdx;   // compactMesh 已经原地改写了索引
console.log('simplified triangles', fIdx.length / 3, 'vertices', unique, 'error', err.toFixed(5));

// ================= 烘焙：法线、凹处遮蔽（AO）、青苔、鳞片区域 =================
const nrm = new Float32Array(unique * 3), col = new Float32Array(unique * 3), moss = new Float32Array(unique), scale = new Float32Array(unique);
for (let i = 0; i < unique; i++) {
  const x = fPos[i * 3], y = fPos[i * 3 + 1], z = fPos[i * 3 + 2];
  const n = grad(x, y, z);
  nrm.set(n, i * 3);
  let occ = 0, w = 1;
  for (let s = 1; s <= 6; s++) { const h = .009 * s; occ += (h - sdf(x + n[0] * h, y + n[1] * h, z + n[2] * h)) * w; w *= .72; }
  const ao = clamp(1 - occ * 7);
  const tone = .9 + (fbm3(x * 9, y * 9, z * 9, 3) - .5) * .22;    // 石头本身深浅不一
  const c = (.45 + .55 * ao) * tone;
  col[i * 3] = c; col[i * 3 + 1] = c; col[i * 3 + 2] = c * .98;
  // 青苔：长在凹处和朝上的面，底座下部更多
  const up = sstep(-.2, .7, n[1]), wet = sstep(.25, 0, y);
  moss[i] = clamp(sstep(.45, .85, (1 - ao) * 1.4 + fbm3(x * 6, y * 6 + 3, z * 6, 3) * .5 + wet * .35) * (.35 + .65 * up));
  // 鳞片：身体和尾巴有，头、腿、鬃毛、底座没有
  const dScale = Math.min(groups.body(x, y, z), groups.tail(x, y, z));
  const dOther = Math.min(groups.head(x, y, z), groups.legs(x, y, z), groups.mane(x, y, z), groups.pedestal(x, y, z), groups.horns(x, y, z));
  scale[i] = sstep(-.012, .012, dOther - dScale) * sstep(Y0 + .03, Y0 + .08, y);
}

// ================= 写 GLB =================
function writeGLB(file, attrs, indices, extras) {
  const chunks = [], views = [], accessors = [];
  let off = 0;
  const add = (arr, type, comp, count, target, extra = {}) => {
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength), pad = (4 - b.length % 4) % 4;
    views.push({ buffer: 0, byteOffset: off, byteLength: b.length, target });
    chunks.push(b, Buffer.alloc(pad)); off += b.length + pad;
    accessors.push({ bufferView: views.length - 1, componentType: comp, count, type, ...extra });
    return accessors.length - 1;
  };
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < attrs.POSITION.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], attrs.POSITION[i + k]); mx[k] = Math.max(mx[k], attrs.POSITION[i + k]); }
  const n = attrs.POSITION.length / 3, A = {};
  A.POSITION = add(attrs.POSITION, 'VEC3', 5126, n, 34962, { min: mn, max: mx });
  A.NORMAL = add(attrs.NORMAL, 'VEC3', 5126, n, 34962);
  A.COLOR_0 = add(attrs.COLOR_0, 'VEC3', 5126, n, 34962);
  A._MOSS = add(attrs._MOSS, 'SCALAR', 5126, n, 34962);
  A._SCALE = add(attrs._SCALE, 'SCALAR', 5126, n, 34962);
  const I = add(indices, 'SCALAR', 5125, indices.length, 34963);
  const json = {
    asset: { version: '2.0', generator: 'wish-pool sdf sculpt' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'zhenshuishou', extras }],
    meshes: [{ primitives: [{ attributes: A, indices: I, material: 0 }] }],
    materials: [{ name: 'stone', pbrMetallicRoughness: { baseColorFactor: [.62, .61, .58, 1], metallicFactor: 0, roughnessFactor: .92 } }],
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
}
writeGLB(OUT, { POSITION: fPos, NORMAL: nrm, COLOR_0: col, _MOSS: moss, _SCALE: scale }, fIdx, {
  eyes: eyesPos.map(p => [p[0], p[1], p[2] + .004]),
  spout: [0, spoutY, .47],
  height: Y0 + .68,
});
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
