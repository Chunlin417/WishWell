// 殿里的青铜猫像：端坐、目视前方、双眼半闭，尾巴从身后绕到身体右侧盘在脚边；颈上一道项圈，
// 胸前、肩头、后腿外侧是凸起的卷草纹（场景里这些纹路露着铜色，其余是铜绿）。
// 用距离场雕刻，导出 public/models/temple_cat.glb
//
// 用法：node scripts/build-cat.mjs [网格分辨率=300] [目标三角形数=44000]
// 坐标：底面 y = 0，猫面朝 +z，高约 1（场景里再整体缩放）
import {
  sstep, smin, smax, unionAll, xf, mirror, ell, rcone, tube, spiralPts, bounded, snap, gradient, buildMesh, bakeAO, writeGLB,
} from './sdf-lib.mjs';
import { fbm3 } from '../src/noise.js';

const RES = +(process.argv[2] || 300);
const TARGET = +(process.argv[3] || 44000);

// ================= 身体 =================
const torso = tube([[0, .2, -.1], [0, .4, -.03], [0, .58, .05]], [.2, .185, .155], .04);
const belly = ell([0, .17, -.06], [.2, .17, .22]);                        // 坐下时臀部和肚子堆在一起
const haunch = mirror(ell([.17, .19, -.05], [.13, .195, .215], 0, -.15));   // 后腿：两侧鼓起的大腿
const chest = ell([0, .47, .1], [.145, .2, .11], 0, .12);
const shoulder = mirror(ell([.11, .5, .07], [.075, .13, .095]));
const neck = rcone([0, .58, .05], [0, .76, .09], .135, .108);
const frontLeg = mirror(rcone([.08, .5, .12], [.075, .08, .19], .068, .05));
const frontPaw = mirror((x, y, z) => {
  let d = ell([.075, .04, .225], [.058, .042, .08])(x, y, z);
  for (const o of [-.02, 0, .02]) d = smax(d, -ell([.075 + o, .05, .3], [.0045, .05, .04])(x, y, z), .004);   // 脚趾缝
  return d;
});
const hindFoot = mirror(ell([.215, .04, .1], [.055, .042, .12]));
// 尾巴：从身后绕到 -x 一侧，贴着后腿盘到前爪旁边
const tail = tube([[0, .09, -.27], [-.17, .07, -.3], [-.31, .06, -.2], [-.37, .055, -.03], [-.34, .052, .14], [-.25, .05, .26], [-.14, .05, .32]],
  [.06, .058, .055, .052, .048, .042, .03], .02);

const body = bounded((x, y, z) => {
  let d = smin(torso(x, y, z), belly(x, y, z), .05);
  d = smin(d, haunch(x, y, z), .05);
  d = smin(d, chest(x, y, z), .05);
  d = smin(d, shoulder(x, y, z), .04);
  d = smin(d, neck(x, y, z), .05);
  d = smin(d, frontLeg(x, y, z), .025);
  d = smin(d, frontPaw(x, y, z), .015);
  d = smin(d, hindFoot(x, y, z), .03);
  return smin(d, tail(x, y, z), .025);
}, [-.46, -.02, -.4], [.4, .92, .4]);

// ================= 头（局部坐标：原点在头颅中心，吻部朝 +z） =================
const HC = [0, .85, .11], HRX = .06;
const ear = xf((x, y, z) => {
  const d = smax(rcone([0, 0, 0], [0, .12, 0], .052, .008)(x, y, z), Math.abs(z) - .016, .008);   // 压扁的圆锥
  return smax(d, -ell([0, .05, .02], [.03, .055, .014])(x, y, z), .006);                          // 耳窝朝前
}, [.078, .062, -.015], .3, -.1, -.33);
const headBase = unionAll([
  ell([0, 0, 0], [.12, .1, .112]),
  ell([0, .025, .05], [.085, .05, .06]),                  // 额头
  mirror(ell([.058, -.035, .035], [.062, .05, .07])),     // 两腮
  ell([0, -.038, .082], [.058, .042, .055]),              // 吻部
  mirror(ell([.024, -.045, .118], [.03, .024, .022])),    // 胡须垫
  ell([0, -.078, .06], [.04, .026, .04]),                 // 下巴
  ell([0, -.018, .138], [.02, .013, .012]),               // 鼻头
  mirror(ear),
], .02);
// 贴在脸上的线：上眼睑（鼓起）、半闭的眼缝、人中和嘴线（刻进去）
const face = (x, y) => snap(headBase, [x, y, .3], [0, 0, -1]);
const lid = mirror(tube([[.026, .004], [.042, .017], [.062, .022], [.08, .014]].map(p => face(...p)), [.007, .009, .009, .006], .004));
const eyeSlit = mirror(tube([[.028, -.005], [.045, .003], [.063, .007], [.079, .003]].map(p => face(...p)), [.0042, .0036], .003));
const mouth = mirror(tube([[0, -.03], [0, -.05], [.018, -.062], [.04, -.058]].map(p => face(...p)), [.0036, .0032], .003));
const headL = (x, y, z) => {
  let d = smin(headBase(x, y, z), lid(x, y, z), .006);
  d = smax(d, -eyeSlit(x, y, z), .002);
  return smax(d, -mouth(x, y, z), .002);
};
const head = bounded(xf(headL, HC, 0, HRX), [-.2, .68, -.08], [.2, 1.06, .3]);

const plain = (x, y, z) => smin(body(x, y, z), head(x, y, z), .05);   // 没有纹饰的猫

// ================= 卷草纹：凸起的细条，贴在表面上 =================
const onFront = (x, y) => snap(plain, [x, y, .6], [0, 0, -1], 1);
const onSide = (y, z) => snap(plain, [.6, y, z], [-1, 0, 0], 1);
const half = [];   // 只做 +x 这半边，再镜像
// 胸前：项圈下面一对向外卷的大卷草，下面再接一对小的
half.push(tube(spiralPts([.062, .5, 0], [1, 0, 0], [0, 1, 0], .058, 1.5, Math.PI * .75, 22, .8).map(([x, y]) => onFront(x, y)), [.012, .008], .004));
half.push(tube(spiralPts([.05, .365, 0], [-1, 0, 0], [0, 1, 0], .036, 1.3, Math.PI * .6, 16, .78).map(([x, y]) => onFront(x, y)), [.01, .0075], .004));
half.push(tube([[.012, .57], [.02, .5], [.012, .43], [.02, .36]].map(p => onFront(...p)), [.009, .007], .004));   // 中间一道茎
// 肩头的小卷草、后腿外侧的大卷草，中间一道藤蔓沿着身侧连上去
half.push(tube(spiralPts([0, .52, .055], [0, 0, 1], [0, 1, 0], .05, 1.4, 0, 18, .8).map(([, y, z]) => onSide(y, z)), [.011, .0075], .004));
half.push(tube(spiralPts([0, .215, -.06], [0, 0, -1], [0, 1, 0], .118, 1.7, Math.PI * .5, 30, .84).map(([, y, z]) => onSide(y, z)), [.013, .0085], .004));
half.push(tube([[.335, -.04], [.39, -.005], [.44, .015], [.485, .03]].map(p => onSide(...p)), [.011, .008], .004));
half.push(tube([[.3, -.2], [.36, -.17], [.41, -.125], [.45, -.085]].map(p => onSide(...p)), [.01, .007], .004));    // 后背上的一片叶
// 项圈：绕脖子一圈，前低后高
const collarPts = [];
for (let i = 0; i <= 28; i++) {
  const a = i / 28 * Math.PI * 2, y = .655 - .04 * Math.cos(a);
  collarPts.push(snap(plain, [Math.sin(a) * .45, y, .075 + Math.cos(a) * .45], [-Math.sin(a), 0, -Math.cos(a)], 1));
}
const relief = bounded(unionAll([mirror(unionAll(half, .004)), tube(collarPts, [.014, .014], .004)], .004), [-.4, .06, -.36], [.4, .74, .32], .03);

// ================= 组合 =================
const sdf = (x, y, z) => Math.max(smin(plain(x, y, z), relief(x, y, z), .005), -y);   // 底面削平

const { pos, idx, count } = await buildMesh(sdf, { center: [0, .5, 0], half: .6, res: RES, targetTris: TARGET, error: .0012 });

// ================= 烘焙：法线、凹处的暗部、纹饰的位置 =================
const nrm = new Float32Array(count * 3), col = new Float32Array(count * 3), rel = new Float32Array(count);
for (let i = 0; i < count; i++) {
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  const n = gradient(sdf, x, y, z, .0008);
  nrm.set(n, i * 3);
  const ao = bakeAO(sdf, x, y, z, n, .008, 7), tone = 1 + (fbm3(x * 9, y * 9, z * 9, 3) - .5) * .14;
  col.fill((.4 + .6 * ao) * tone, i * 3, i * 3 + 3);
  rel[i] = sstep(.007, .001, relief(x, y, z));
}
writeGLB('public/models/temple_cat.glb', { POSITION: [pos, 'VEC3'], NORMAL: [nrm, 'VEC3'], COLOR_0: [col, 'VEC3'], _RELIEF: [rel, 'SCALAR'] },
  idx, { height: 1.02 }, { name: 'bronze', pbrMetallicRoughness: { baseColorFactor: [.3, .34, .26, 1], metallicFactor: .8, roughnessFactor: .6 } });
