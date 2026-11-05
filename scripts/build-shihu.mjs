// 守愿石狐：端坐在卷云纹石台上，双眼闭合，红绳项圈挂小铃铛，身上刻着灵纹（夜里会发光）
// 用距离场雕刻，导出 public/models/shihu.glb
//
// 用法：node scripts/build-shihu.mjs [网格分辨率=320] [目标三角形数=75000]
// 坐标：底座底面 y = 0，狐狸面朝 +z、目视前方，尾巴盘在 +x 一侧（场景里右边那只镜像）
import {
  clamp, sstep, smin, smax, unionAll, xf, xfPoint, mirror, ell, sph, rbox, torus, rcone, tube,
  spiralPts, bounded, snap, gradient, buildMesh, bakeAO, writeGLB, norm,
} from './sdf-lib.mjs';
import { fbm3 } from '../src/noise.js';

const RES = +(process.argv[2] || 320);
const TARGET = +(process.argv[3] || 75000);

// ================= 台座：方形石台，四面卷云纹浮雕 =================
const Y = .407;   // 台面高度
const HX = .26, HZ = .23;
// 卷云纹：一排左右交替旋向的阿基米德螺旋，中间用波浪线连起来
function spiralLine(px, py, dir) {
  const r = Math.hypot(px, py);
  if (r > .046) return 0;
  const b = .0145 / (2 * Math.PI), th = Math.atan2(py, px) * dir;
  const k = Math.round((r / b - th) / (2 * Math.PI)), dd = Math.abs(r - b * (th + 2 * Math.PI * k));
  return clamp(1 - dd / .0034) * sstep(.046, .036, r);
}
function cloudH(u, v) {
  let h = 0;
  const pitch = .13;
  const k = Math.round(u / pitch);
  for (let j = k - 1; j <= k + 1; j++) {
    const cu = j * pitch, cv = .2 + (j % 2 ? .025 : -.025);
    h = Math.max(h, spiralLine(u - cu, v - cv, j % 2 ? 1 : -1));
  }
  const wave = .2 + .052 * Math.sin(u / pitch * Math.PI + Math.PI / 2);
  h = Math.max(h, clamp(1 - Math.abs(v - wave) / .0034) * .9);
  return h;
}
function panelRelief(x, y, z) {
  const ax = Math.abs(x), az = Math.abs(z);
  let u, m;
  if (HX - ax < HZ - az) { u = z; m = sstep(HZ - .03, HZ - .045, az); } else { u = x; m = sstep(HX - .03, HX - .045, ax); }
  m *= sstep(.085, .095, y) * sstep(.315, .305, y);
  if (m <= 0) return 0;
  return m * (.006 - cloudH(u, y) * .0075);
}
const block = rbox([0, .2, 0], [HX, .15, HZ], .012);
const pedestal = bounded(unionAll([
  rbox([0, .032, 0], [HX + .035, .032, HZ + .035], .012),
  (x, y, z) => { const d = block(x, y, z); return d < .03 ? d + panelRelief(x, y, z) : d; },
  rbox([0, .356, 0], [HX + .012, .01, HZ + .012], .005),
  rbox([0, .385, 0], [HX + .028, .022, HZ + .028], .01),
], .004), [-.32, 0, -.29], [.32, Y + .01, .29]);

// ================= 狐狸身体 =================
const torso = tube([[0, Y + .1, -.075], [0, Y + .22, -.02], [0, Y + .335, .035]], [.098, .086, .07], .02);
const haunch = mirror(ell([.07, Y + .1, -.06], [.077, .102, .118]));
const chest = ell([0, Y + .3, .072], [.064, .095, .058], 0, .2);
// 胸前蓬松的毛：几簇向下的尖簇
const ruff = unionAll([-1.5, -.5, .5, 1.5].map(i => rcone([i * .022, Y + .375, .09], [i * .028, Y + .25, .128], .032, .006)), .012);
const frontLeg = mirror(rcone([.038, Y + .27, .085], [.041, Y + .028, .112], .031, .02));
const frontPaw = mirror((x, y, z) => {
  let d = ell([.042, Y + .02, .132], [.028, .02, .043])(x, y, z);
  for (const o of [-.009, .009]) d = smax(d, -ell([.042 + o, Y + .03, .165], [.0028, .03, .028])(x, y, z), .002);   // 脚趾缝
  return d;
});
const hindFoot = mirror(ell([.092, Y + .028, .035], [.034, .028, .088]));
const neck = rcone([0, Y + .33, .04], [0, Y + .455, .06], .062, .05);

// 尾巴：从身后绕到 +x 一侧，盘在前方，尾尖微微上翘
const tailPts = [[0, Y + .075, -.15], [.085, Y + .065, -.195], [.17, Y + .062, -.12], [.205, Y + .062, 0], [.178, Y + .058, .11], [.115, Y + .062, .17], [.05, Y + .1, .185]];
const tailFn = tube(tailPts, [.05, .062, .072, .074, .066, .05, .022], .02);

const bodyNoCarve = bounded((x, y, z) => {
  let d = smin(torso(x, y, z), haunch(x, y, z), .04);
  d = smin(d, chest(x, y, z), .04);
  d = smin(d, ruff(x, y, z), .015);
  d = smin(d, neck(x, y, z), .03);
  d = smin(d, frontLeg(x, y, z), .02);
  d = smin(d, frontPaw(x, y, z), .012);
  d = smin(d, hindFoot(x, y, z), .025);
  d = smin(d, tailFn(x, y, z), .025);
  return d;
}, [-.3, Y - .02, -.3], [.3, Y + .6, .3]);

// ================= 头（局部坐标：原点在头颅中心，吻部朝 +z） =================
const HC = [0, Y + .525, .078], HRY = 0, HRX = .04, HS = 1.32;   // 头朝正前方（不转向镜头）；HS：头整体放大
const ear = xf((x, y, z) => {
  let d = Math.max(rcone([0, 0, 0], [0, .118, 0], .026, .003)(x, y, z), Math.abs(z) - .011);
  d = smax(d, -ell([0, .048, .012], [.014, .05, .009])(x, y, z), .003);   // 耳窝
  return d;
}, [.03, .033, -.012], .35, -.12, -.27);
const headBaseL = unionAll([
  ell([0, 0, 0], [.056, .05, .064]),
  ell([0, .018, .02], [.046, .035, .05]),
  rcone([0, -.008, .035], [0, -.024, .135], .029, .009),
  ell([0, -.006, .072], [.026, .02, .05]),
  sph([0, -.022, .139], .0095),
  ell([0, -.03, .05], [.035, .018, .062]),
  mirror(rcone([.038, -.018, .0], [.074, -.045, -.012], .026, .006)),   // 腮边的毛
  mirror(ear),
], .012);
// 刻线（局部坐标）：贴在脸上的闭眼弧线、眉弓、嘴线
const sideSnap = (x, y, z) => snap(headBaseL, [x, y, .25], [0, 0, -1]);
const eyeArc = [[.019, .015], [.027, .01], [.036, .009], [.045, .013]].map(([x, y]) => sideSnap(x, y));
const browArc = [[.02, .03], [.031, .029], [.042, .03], [.049, .024]].map(([x, y]) => { const p = sideSnap(x, y); return [p[0], p[1], p[2] - .002]; });
const mouthArc = [[.13, -.027], [.1, -.033], [.07, -.036], [.045, -.031]].map(([z, y]) => snap(headBaseL, [.2, y, z], [-1, 0, 0]));
const eyeGroove = mirror(tube(eyeArc, [.0042, .0034], .003));
const mouthGroove = mirror(tube(mouthArc, [.0034, .0034], .003));
const brow = mirror(tube(browArc, [.0055, .0045], .003));
const headL = (x, y, z) => {
  let d = smin(headBaseL(x, y, z), brow(x, y, z), .004);
  d = smax(d, -eyeGroove(x, y, z), .0015);
  d = smax(d, -mouthGroove(x, y, z), .0015);
  d = smax(d, -mirror(sph([.0065, -.02, .146], .0035))(x, y, z), .002);   // 鼻孔
  return d;
};
const head = bounded(xf((x, y, z) => headL(x / HS, y / HS, z / HS) * HS, HC, HRY, HRX), [-.2, Y + .38, -.12], [.2, Y + .76, .28]);

// ================= 灵纹（刻进去，夜里发光）=================
const fromX = (y, z, side = 1) => snap(bodyNoCarve, [.35 * side, y, z], [-side, 0, 0]);
const fromTop = (x, z) => snap(bodyNoCarve, [x, Y + .4, z], [0, -1, 0]);
const carveTubes = [];
// 臀部外侧的大卷云，带一道火焰纹沿身体往上
for (const side of [1, -1]) {
  const c = fromX(Y + .1, -.065, side);
  const sp = spiralPts([c[0], c[1], c[2]], [0, 0, 1], [0, side, 0].map(v => v), .046, 1.55, Math.PI, 18, .82)
    .map(([x, y, z]) => fromX(y, z, side));
  carveTubes.push(tube(sp, [.0055, .0042], .003));
  const flame = [[Y + .14, -.02], [Y + .19, .005], [Y + .245, .03], [Y + .29, .05], [Y + .325, .062]].map(([y, z]) => fromX(y, z, side));
  carveTubes.push(tube(flame, [.0052, .0036], .003));
  const flame2 = [[Y + .12, -.115], [Y + .17, -.1], [Y + .22, -.07], [Y + .255, -.04]].map(([y, z]) => fromX(y, z, side));
  carveTubes.push(tube(flame2, [.0048, .0034], .003));
  // 肩部的小卷云
  const c2 = fromX(Y + .25, .075, side);
  carveTubes.push(tube(spiralPts(c2, [0, 0, 1], [0, 1, 0], .026, 1.3, 0, 14, .78).map(([x, y, z]) => fromX(y, z, side)), [.0045, .0035], .003));
}
// 尾巴顶上的灵纹
for (const i of [2, 4]) {
  const p = tailPts[i];
  const line = [-.05, -.025, 0, .025, .05].map(t => fromTop(p[0] + t * .4, p[2] + t));
  carveTubes.push(tube(line, [.0048, .0035], .003));
}
const carvings = unionAll(carveTubes, .002);

// ================= 项圈、绳结、铃铛 =================
const COLLAR_C = [0, Y + .43, .058], COLLAR_RX = .42;
const collar = xf(torus(.066, .0095, .0013, 20), COLLAR_C, 0, COLLAR_RX);
const knotP = xfPoint([0, 0, .062], COLLAR_C, 0, COLLAR_RX);
const knot = unionAll([sph(knotP, .013), mirror(ell([knotP[0] + .015, knotP[1] - .003, knotP[2] - .003], [.013, .008, .006], .4))], .005);
const bellC = [knotP[0], knotP[1] - .03, knotP[2] + .014];
const bell = (x, y, z) => {
  let d = smin(sph(bellC, .022)(x, y, z), sph([bellC[0], bellC[1] + .023, bellC[2]], .006)(x, y, z), .004);
  d = smax(d, -rbox([bellC[0], bellC[1] - .014, bellC[2] + .02], [.0028, .009, .022], .001)(x, y, z), .002);   // 铃铛下面的开口
  d = smax(d, -Math.max(Math.abs(y - bellC[1] - .002) - .0012, sph(bellC, .03)(x, y, z)), .001);   // 腰线（只在铃铛上）
  return d;
};
const accessories = (x, y, z) => smin(smin(collar(x, y, z), knot(x, y, z), .004), bell(x, y, z), .002);

// ================= 组合 =================
const foxNoAcc = (x, y, z) => {
  let d = smin(bodyNoCarve(x, y, z), head(x, y, z), .03);
  d = smax(d, -carvings(x, y, z), .002);
  return Math.max(d, Y - .005 - y);
};
const fox = (x, y, z) => smin(foxNoAcc(x, y, z), accessories(x, y, z), .003);
const sdf = (x, y, z) => smin(pedestal(x, y, z), fox(x, y, z), .012);

const mesh = await buildMesh(sdf, { center: [0, .58, 0], half: .6, res: RES, targetTris: TARGET, error: .0012 });
const { pos, idx, count } = mesh;

// ================= 烘焙 =================
const nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), moss = new Float32Array(count), glow = new Float32Array(count);
for (let i = 0; i < count; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  const n = gradient(sdf, x, y, z, .0008);
  nrm.set(n, i * 3);
  const ao = bakeAO(sdf, x, y, z, n, .007, 8);
  const tone = 1 + (fbm3(x * 11, y * 11, z * 11, 3) - .5) * .16;
  const onPed = pedestal(x, y, z) < fox(x, y, z);
  let c = [1, 1, 1].map(v => v * (.42 + .58 * ao) * tone * (onPed ? .8 : 1));
  const dc = Math.min(collar(x, y, z), knot(x, y, z)), db = bell(x, y, z);
  if (!onPed && db < .004 && db <= dc) c = [.78, .58, .24].map(v => v * (.55 + .45 * ao));        // 铜铃
  else if (!onPed && dc < .004) c = [.62, .06, .045].map(v => v * (.5 + .5 * ao));                 // 红绳
  col.set(c, i * 3);
  // 青苔：台座上多（凹处、朝上、靠下），狐狸身上只有脚边一点
  const up = sstep(-.2, .7, n[1]), noise = fbm3(x * 7, y * 7 + 3, z * 7, 3);
  moss[i] = onPed
    ? clamp(sstep(.42, .8, (1 - ao) * 1.3 + noise * .55 + sstep(.2, 0, y) * .3) * (.4 + .6 * up))
    : clamp(sstep(Y + .06, Y, y) * sstep(.45, .7, noise) * .7);
  // 灵纹发光：刻线附近
  glow[i] = onPed ? 0 : Math.max(sstep(.009, .003, carvings(x, y, z)), db < .004 ? .55 : 0);
}
writeGLB('public/models/shihu.glb', {
  POSITION: [pos, 'VEC3'], NORMAL: [nrm, 'VEC3'], COLOR_0: [col, 'VEC3'], _MOSS: [moss, 'SCALAR'], _GLOW: [glow, 'SCALAR'],
}, idx, { height: Y + .73 }, { name: 'stone', pbrMetallicRoughness: { baseColorFactor: [.9, .87, .8, 1], metallicFactor: 0, roughnessFactor: .92 } });
