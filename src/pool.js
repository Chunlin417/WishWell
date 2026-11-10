// 场景：池底地形、围池石块、水底卵石与铜钱、草地与各种植物、落叶
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, noise3, fbm3 } from './noise.js';
import { patch, shared } from './patch.js';
import { FOX_Z } from './fox.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const toLin = v => Math.pow(clamp(v), 2.2);
const srgb = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

// ---------- 自然化参数：集中在这里调（全部用固定种子，每次加载结果一样） ----------
export const NATURE = {
  // 主石圈：扁石板 / 大 / 中石头的比例（其余是小石头）；相邻两块按各自的大小留间距（overlap < 1：互相挤着）
  ring: { slab: .14, big: .2, mid: .4, overlap: [.5, .7] },
  // 每块石头的苔藓量：[比例, 最少, 最多]——有的几乎光秃，有的顶上一大片
  moss: [[.3, .05, .28], [.45, .38, .68], [.25, .72, 1]],
  tuftKeep: .8,     // 矮草簇保留的比例：原来铺满整片，少两成，让出露土和落叶
  sparse: .6,       // 草地里"稀疏地"的面积倾向（越大露土越多），离水越近越稀
  gravel: 300,      // 岸上碎石：卡在石缝里、堆在石头脚下，露土处零星几颗
  silt: 340,        // 池底浅水区的细碎石子（不进池心）
  floatLeaves: 6,   // 水面上漂着的几片落叶（只在靠岸处）
  // 两只石狐底座四周：泥土、苔藓、碎石、小草的多少（左右不一样，避免机械对称）
  foxBase: { [-1]: { weeds: 30, ferns: 6, flowers: 5, stones: 8, dirt: 1, moss: 1 }, [1]: { weeds: 20, ferns: 3, flowers: 3, stones: 4, dirt: .8, moss: .75 } },
};

// 池子边界半径（不规则，像天然石潭）
export const Rb = th => 3.7 + .3 * Math.sin(3 * th + .8) + .18 * Math.sin(5 * th + 2.1) + .1 * Math.sin(8 * th + .3);
export const poolK = (x, z) => Math.hypot(x, z) / Rb(Math.atan2(z, x));

// 地形高度：水面在 y = 0。池边是一圈浅浅的石台，往里很快陡降，池心深约 2.8，看起来深不见底
// 岸上的小土包 / 浅洼（1～3 米尺度）：地面不再像一张平整的桌面；草色也跟着它走（土包上干、洼里绿）
const landBump = (x, z) => (fbm3(x * .8, 7, z * .8, 3) - .5) * .28 + (fbm3(x * 2.4, 13, z * 2.4, 2) - .5) * .07;
const landW = k => sstep(1.12, 1.5, k);   // 紧挨石圈的地方不起伏，石头才坐得稳

export function floorH(x, z) {
  const k = poolK(x, z);
  const s = Math.pow(sstep(.35, 1.1, k), .55);
  let y = lerp(-2.8, .3, s);
  y += (fbm3(x * .55, 0, z * .55, 4) - .5) * lerp(.25, .35, s);
  if (k > 1.1) y += (k - 1.1) * .5 + (fbm3(x * .3, 5, z * .3, 3) - .5) * .6 * clamp(k - 1.1);
  y += landBump(x, z) * landW(k);
  // 池心的深井：中间一口约 13 米深的竖井（半径约 1.7～2.3 米），井壁陡直；平时看起来深不见底。
  // 龙的身体有两股（游上来的一股和转身后游下去的一股，相隔 1.3 米），所以井要够宽
  y -= 10 * (1 - sstep(.5, .68, k));
  // 石圈以内保证在水下，不露出发白的浅滩；石圈以外不再削顶（之前会削出一块块平台）
  return Math.min(y, -.06 + sstep(.94, 1.06, k) * .45 + sstep(1.06, 1.3, k) * 10);
}

// 植被群落：3～5 米一片的"茂盛 / 稀疏"交替（低频平滑噪声，成片过渡，不是随机撒点）；离水越远越茂盛
const community = (x, z) => fbm3(x * .28 + 11, 3, z * .28 - 7, 3);
const lushness = k => sstep(1.2, 2.3, k);
// 草地覆盖：石圈外大多长草；稀疏地里草变薄、露出泥土和落叶，池边潮湿的一圈让给苔藓和蕨类
function grassMask(x, z, y) {
  if (y < .03) return 0;
  const k = poolK(x, z);
  let m = sstep(1.0, 1.07, k);
  m *= sstep(14, 12, Math.max(Math.abs(x), Math.abs(z)));   // 草地网格边缘淡出，不留硬边
  m *= lerp(.55, 1, sstep(.3, .58, fbm3(x * .45, 3, z * .45, 3)));
  m *= lerp(.45, 1, sstep(.2, .34, fbm3(x * .45 + 40, 1, z * .45, 3)));   // 零星几小块草比较稀的地方，边缘柔和
  // （按池边到画面边缘统计：草地覆盖比原来少约 17%，几乎露土的地方约占 9%，原来不到 1%）
  const lush = lushness(k), lo = .3 + .1 * NATURE.sparse - .06 * lush;
  const sparse = 1 - sstep(lo, lo + .12, community(x, z));   // 过渡带加宽：茂盛到稀疏是渐变的
  m *= 1 - sparse * lerp(.52, .38, lush);
  return m * lerp(.85, 1, lush);
}
// GLSL 噪声的 JS 版（和 shaders.js 里的 hash12 / vnoise 一样），草簇才能避开着色器画出来的露土和干草
const fr = v => v - Math.floor(v);
function hash12(x, y) {
  let a = fr(x * .1031), b = fr(y * .1031), c = a;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d; b += d; c += d;
  return fr((a + b) * c);
}
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), u = fr(x), v = fr(y);
  const ux = u * u * (3 - 2 * u), uy = v * v * (3 - 2 * v);
  return lerp(lerp(hash12(xi, yi), hash12(xi + 1, yi), ux), lerp(hash12(xi, yi + 1), hash12(xi + 1, yi + 1), ux), uy);
}
// 和 patch.js 里 LAWN 一段同样的公式：干燥度、露土
function lawnDry(x, z, dryAttr) {
  return sstep(.45, .9, clamp(dryAttr * .75 + (vnoise(x * .9 + 21, z * .9 + 21) - .5) * .7));
}
function lawnBare(x, z, dry, moss) {
  const b = vnoise(x * .55 + 40, z * .55 + 40) * .65 + vnoise(x * 2.1 + 9, z * 2.1 + 9) * .35 + dry * .18;
  return sstep(.66, .84, b) * (1 - moss);
}

// 苔藓：靠近石圈潮湿的一圈（宽窄被噪声打乱，不是一个规整的环），再加零星成片
const mossMask = (x, z) => Math.max(sstep(1.38, 1.04, poolK(x, z) + (fbm3(x * .9, 17, z * .9, 2) - .5) * .3),
  sstep(.62, .74, fbm3(x * .7, 11, z * .7, 3)) * .8);

// 每块石头单独"做旧"（在世界坐标里算：同一个形状摆在不同位置也各不相同）：
// 苔藓——顶面成片、背阴（朝 +z）的一面多一些、从地面往上爬一截；贴地一截沾泥发暗；侧面有雨水冲出的竖向暗纹；零星浅色地衣
function weatherRock(g, base, mossAmt, seed, k) {
  const p = g.attributes.position, n = g.attributes.normal, col = g.attributes.color, moss = g.attributes.aMoss;
  const amt = clamp(mossAmt + sstep(1.12, .96, k) * .15);   // 贴着水的石头更潮，苔多一点
  const tone = .9 + fr(seed * 7.13) * .18;                   // 每块石头整体略有深浅
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = n.getY(i), h = y - base;
    const top = sstep(.3, .85, ny);
    const onTop = top * sstep(.62 - amt * .3, .72 - amt * .25, fbm3(x * 1.7 + seed, y * 1.7, z * 1.7 - seed, 3) + sstep(-.2, .7, n.getZ(i)) * .08);
    const creep = (1 - sstep(.02, .1 + .22 * amt, h)) * sstep(.42, .58, fbm3(x * 3.3, y * 3.3 + seed, z * 3.3, 2));
    const m = clamp(Math.max(onTop * (.55 + .45 * amt), creep * amt * .9, moss.getX(i) * .5 * amt));
    moss.setX(i, m);
    const low = 1 - sstep(0, .22, h);
    const streak = sstep(.56, .72, fbm3(x * 6.5 + seed, y * .7, z * 6.5, 2)) * (1 - top);
    const lichen = sstep(.7, .8, noise3(x * 5.3 + seed, y * 5.3, z * 5.3)) * (1 - m) * sstep(.05, .3, h);
    const b = tone * (1 - .32 * low) * (1 - .16 * streak);
    col.setXYZ(i, col.getX(i) * b * (1 + lichen * .14), col.getY(i) * b * (1 + lichen * .16), col.getZ(i) * b * (1 + lichen * .04) * (1 - .05 * low));
  }
}


function makeRockGeo(seed, detail) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, v = new THREE.Vector3();
  // 几个随机切面：让石头有棱角，不像面团
  const R = rng(Math.floor(seed * 1000));
  const cuts = Array.from({ length: 7 }, () => ({   // 更多切面：石头有清楚的棱角和平整的面
    n: new THREE.Vector3(R() - .5, (R() - .3) * .8, R() - .5).normalize(), d: .55 + R() * .3 }));
  const rad = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm3(v.x * 1.1 + seed, v.y * 1.1, v.z * 1.1, 4);
    const n2 = fbm3(v.x * 3.5 + seed, v.y * 3.5 + seed, v.z * 3.5, 3);
    const n3 = noise3(v.x * 9 + seed, v.y * 9, v.z * 9);
    v.multiplyScalar(.68 + n * .8 + (n2 - .5) * .22 + (n3 - .5) * .03);
    for (const c of cuts) { const dd = v.dot(c.n); if (dd > c.d) v.addScaledVector(c.n, -(dd - c.d) * .95); }
    if (v.y < -.25) v.y = -.25 + (v.y + .25) * .25;   // 底部压平，像陷在土里
    p.setXYZ(i, v.x, v.y, v.z);
    rad[i] = v.length();
  }
  g.computeVertexNormals();
  // 顶点色只做明暗 / 冷暖微调（贴图负责细节），aMoss 标记苔藓区域
  const nrm = g.attributes.normal, col = new Float32Array(p.count * 3), moss = new Float32Array(p.count);
  const warm = -.02 - R() * .04;   // 负数：整体偏冷灰
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = fbm3(v.x * 2.5 + seed * 2, v.y * 2.5, v.z * 2.5, 3);
    const b = lerp(.8, 1.15, t) * lerp(.7, 1.0, sstep(.7, 1.1, rad[i]));   // 凹处更暗
    col[i * 3] = b * (1 + warm); col[i * 3 + 1] = b; col[i * 3 + 2] = b * (1 - warm);
    // 青苔长在石头顶上（朝上的面），大片、颜色鲜一些
    // 只在少数石头顶面的凹处有一小片薄苔
    moss[i] = sstep(.55, .92, nrm.getY(i)) * sstep(.54, .68, fbm3(v.x * 1.6 + seed, v.y * 1.6, v.z * 1.6 + seed, 3));
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMoss', new THREE.BufferAttribute(moss, 1));
  return g;
}

// 四季的思路：底色常青（草、苔、蕨四季都是绿的，秋天略暖、冬天略暗略冷），季节感交给点缀
// （春天花瓣、秋天红枫叶和发黄的玉簪、冬天积雪），任何季节打开都是生机勃勃的
const SEASON_GRASS = {
  spring: [.38, .6, .2], summer: [.32, .5, .2], autumn: [.34, .52, .17], winter: [.27, .43, .2],
};
// 地面植物（照片图集）的季节色：乘在照片颜色上（线性空间）。夏天略收一点黄绿、压一点饱和，秋天泛黄，冬天深一些
const SEASON_PLANT = {
  spring: [1.04, 1.06, .94], summer: [.66, .74, .56], autumn: [1.1, .97, .72], winter: [.6, .68, .58],
};
// 草坪：a 深一些的绿、b 浅一些的绿（两者按大小色块交错），moss 石头脚下的苔藓色
const SEASON_LAWN = {
  spring: { a: [.3, .46, .15], b: [.45, .6, .22], moss: [.26, .4, .12] },
  summer: { a: [.19, .3, .1], b: [.29, .39, .15], moss: [.19, .29, .1] },   // 夏天的绿：饱和度收一点，不像草皮地毯
  autumn: { a: [.25, .38, .11], b: [.38, .51, .17], moss: [.22, .37, .1] },
  winter: { a: [.2, .32, .13], b: [.31, .43, .19], moss: [.18, .31, .11] },
};
const SEASON_IRIS = {
  spring: [.34, .56, .2], summer: [.26, .5, .15], autumn: [.3, .5, .16], winter: [.25, .41, .18],
};
const SEASON_FLOWERS = {
  // 只有零星几簇白色小花
  spring: { n: 110, colors: [[.96, .96, .92]] },
  summer: { n: 90, colors: [[.96, .96, .92]] },
  autumn: { n: 70, colors: [[.96, .96, .92]] },
  winter: { n: 0, colors: [[1, 1, 1]] },
};
// 落叶：rows = 图集里用哪几行（0 暗红枫叶，1 橙黄枫叶，2 白色花瓣）、tint = 季节色、n = 数量、scale = 大小
const SEASON_GROUND = {
  spring: { n: 30, scale: .8, rows: [2], tint: [1, 1, 1] },
  summer: { n: 34, scale: .9, rows: [1, 0], tint: [.52, .46, .36] },   // 去年的枯叶：褪成褐色，大多卡在石头脚下
  autumn: { n: 60, scale: 1, rows: [0, 1, 1], tint: [1, 1, 1] },
  winter: { n: 30, scale: 1, rows: [0, 1], tint: [.42, .34, .28] },
};

// 草的图集（public/textures/grass_atlas.webp，由 scripts/pack_grass_atlas.py 生成，数值是它打印出来的）
// uv：在图集里的范围 [u0, v0, u1, v1]；aspect：宽 / 高；mean：平均色（线性）
export const GRASS_CARDS = {
  short: { uv: [0.0469, 0.5000, 0.4531, 0.7681], aspect: 1.515, mean: [0.1380, 0.1998, 0.0457] },
  medium: { uv: [0.5469, 0.5000, 0.9531, 0.8853], aspect: 1.054, mean: [0.1871, 0.2333, 0.0769] },
  tall: { uv: [0.0527, 0.0000, 0.4468, 0.4668], aspect: 0.844, mean: [0.2089, 0.2075, 0.0852] },
  sedge: { uv: [0.5469, 0.0000, 0.9531, 0.4287], aspect: 0.948, mean: [0.1455, 0.2047, 0.0682] },
};
// 地面植物的图集（public/textures/groundplants_atlas.webp，由 scripts/pack_new_assets.py 生成，数值是它打印出来的）
// 4 行 × 4 个形态：三叶草 / 蕨 / 蜂斗菜 / 白花；每个元素：uv [u0, v0, u1, v1]、宽高比、平均色（线性）
const GROUND_PLANTS = [
  [{ uv: [0.0063, 0.7729, 0.2407, 0.9609], aspect: 1.247, mean: [0.1789, 0.2947, 0.0483] }, { uv: [0.2485, 0.7822, 0.4883, 0.9209], aspect: 1.729, mean: [0.2191, 0.3293, 0.0466] }, { uv: [0.5029, 0.7739, 0.7314, 0.9634], aspect: 1.206, mean: [0.1895, 0.3100, 0.0481] }, { uv: [0.7466, 0.7749, 0.9927, 0.9502], aspect: 1.404, mean: [0.1955, 0.3048, 0.0360] }],
  [{ uv: [0.0142, 0.5195, 0.2407, 0.7339], aspect: 1.057, mean: [0.2307, 0.3449, 0.0366] }, { uv: [0.2534, 0.5327, 0.4976, 0.6851], aspect: 1.603, mean: [0.2281, 0.3446, 0.0390] }, { uv: [0.5068, 0.5190, 0.7349, 0.7378], aspect: 1.042, mean: [0.2603, 0.3707, 0.0306] }, { uv: [0.7388, 0.5054, 0.9951, 0.7119], aspect: 1.241, mean: [0.2321, 0.3557, 0.0400] }],
  [{ uv: [0.0088, 0.2700, 0.2432, 0.4741], aspect: 1.148, mean: [0.1948, 0.3195, 0.0571] }, { uv: [0.2441, 0.2832, 0.4917, 0.4355], aspect: 1.625, mean: [0.2253, 0.3494, 0.1056] }, { uv: [0.4990, 0.2720, 0.7344, 0.4790], aspect: 1.137, mean: [0.2371, 0.3689, 0.0861] }, { uv: [0.7422, 0.2798, 0.9883, 0.4585], aspect: 1.377, mean: [0.2322, 0.3693, 0.0986] }],
  [{ uv: [0.0186, 0.0234, 0.2314, 0.2378], aspect: 0.993, mean: [0.2923, 0.3781, 0.1292] }, { uv: [0.2495, 0.0391, 0.4927, 0.2021], aspect: 1.491, mean: [0.2829, 0.3607, 0.1216] }, { uv: [0.5146, 0.0215, 0.7305, 0.2349], aspect: 1.011, mean: [0.2914, 0.3791, 0.1151] }, { uv: [0.7510, 0.0356, 0.9863, 0.2192], aspect: 1.282, mean: [0.2848, 0.3689, 0.0992] }],
];
// 夜景地被图集（broadleaf_groundplants_atlas.webp）：4 行 × 4 个形态——玉簪 / 虎耳草 / 蜂斗菜幼株 / 酢浆草与常春藤
const BROADLEAF_PLANTS = [
  [{ uv: [0.0044, 0.7754, 0.2495, 0.9521], aspect: 1.387, mean: [0.1201, 0.2186, 0.1622] }, { uv: [0.2607, 0.7637, 0.4966, 0.9541], aspect: 1.238, mean: [0.2141, 0.2773, 0.1181] }, { uv: [0.5000, 0.7700, 0.7417, 0.9531], aspect: 1.320, mean: [0.2021, 0.3496, 0.0509] }, { uv: [0.7505, 0.7759, 0.9946, 0.9473], aspect: 1.425, mean: [0.1664, 0.2662, 0.1130] }],
  [{ uv: [0.0083, 0.5415, 0.2476, 0.7188], aspect: 1.350, mean: [0.1650, 0.2345, 0.1321] }, { uv: [0.2520, 0.5342, 0.4980, 0.7217], aspect: 1.312, mean: [0.1017, 0.1883, 0.0647] }, { uv: [0.5063, 0.5415, 0.7432, 0.7202], aspect: 1.325, mean: [0.1261, 0.2273, 0.0663] }, { uv: [0.7539, 0.5405, 0.9946, 0.7212], aspect: 1.332, mean: [0.1027, 0.1877, 0.0802] }],
  [{ uv: [0.0103, 0.2910, 0.2466, 0.4883], aspect: 1.198, mean: [0.1608, 0.2952, 0.0647] }, { uv: [0.2559, 0.2925, 0.4907, 0.4712], aspect: 1.314, mean: [0.1712, 0.3161, 0.0516] }, { uv: [0.5054, 0.2930, 0.7456, 0.4692], aspect: 1.363, mean: [0.1422, 0.2680, 0.0624] }, { uv: [0.7520, 0.2959, 0.9917, 0.4731], aspect: 1.353, mean: [0.1796, 0.3118, 0.0695] }],
  [{ uv: [0.0068, 0.0562, 0.2476, 0.2388], aspect: 1.318, mean: [0.1484, 0.2688, 0.0605] }, { uv: [0.2529, 0.0508, 0.4854, 0.2397], aspect: 1.230, mean: [0.1421, 0.2014, 0.0736] }, { uv: [0.5049, 0.0513, 0.7397, 0.2275], aspect: 1.332, mean: [0.1336, 0.2601, 0.0730] }, { uv: [0.7549, 0.0513, 0.9888, 0.2266], aspect: 1.334, mean: [0.1585, 0.3226, 0.0166] }],
];
// 月光下的小白花图集（whiteflowers_moonglow_atlas.webp）：16 个形态，花瓣是纯白的
const MOONFLOWERS = [
  [{ uv: [0.0674, 0.7734, 0.1816, 0.9404], aspect: 0.684, mean: [0.3545, 0.3821, 0.2854] }, { uv: [0.2930, 0.7705, 0.4297, 0.9551], aspect: 0.741, mean: [0.3977, 0.4156, 0.3350] }, { uv: [0.5371, 0.7705, 0.7129, 0.9707], aspect: 0.878, mean: [0.4008, 0.4187, 0.3324] }, { uv: [0.7695, 0.7725, 0.9580, 0.9482], aspect: 1.072, mean: [0.4227, 0.4367, 0.3731] }],
  [{ uv: [0.0654, 0.5254, 0.2139, 0.7129], aspect: 0.792, mean: [0.4027, 0.4231, 0.3362] }, { uv: [0.2998, 0.5264, 0.4639, 0.6973], aspect: 0.960, mean: [0.3969, 0.4192, 0.3197] }, { uv: [0.5420, 0.5254, 0.7148, 0.7236], aspect: 0.872, mean: [0.4152, 0.4333, 0.3504] }, { uv: [0.8223, 0.5254, 0.9375, 0.7100], aspect: 0.624, mean: [0.3527, 0.3806, 0.2726] }],
  [{ uv: [0.0508, 0.2744, 0.2129, 0.4756], aspect: 0.806, mean: [0.4287, 0.4473, 0.3707] }, { uv: [0.3105, 0.2754, 0.4336, 0.4355], aspect: 0.768, mean: [0.3561, 0.3807, 0.2848] }, { uv: [0.5713, 0.2744, 0.7031, 0.4648], aspect: 0.692, mean: [0.3803, 0.4014, 0.3119] }, { uv: [0.7891, 0.2754, 0.9502, 0.4736], aspect: 0.813, mean: [0.4163, 0.4347, 0.3499] }],
  [{ uv: [0.0566, 0.0342, 0.1846, 0.2090], aspect: 0.732, mean: [0.3978, 0.4191, 0.3406] }, { uv: [0.2861, 0.0342, 0.4600, 0.2275], aspect: 0.899, mean: [0.4025, 0.4231, 0.3439] }, { uv: [0.5635, 0.0342, 0.6816, 0.2246], aspect: 0.621, mean: [0.3463, 0.3742, 0.2733] }, { uv: [0.7930, 0.0361, 0.9609, 0.2080], aspect: 0.977, mean: [0.3986, 0.4159, 0.3434] }],
];
// 落叶花瓣图集（leaves_atlas.webp）：3 行 × 5 片——暗红枫叶 / 橙黄枫叶 / 白色花瓣
const LEAF_CARDS = [
  [{ uv: [0.0054, 0.6924, 0.2065, 0.9229], aspect: 0.873, mean: [0.3109, 0.0119, 0.0187] }, { uv: [0.2144, 0.7002, 0.3931, 0.8853], aspect: 0.966, mean: [0.3317, 0.0220, 0.0248] }, { uv: [0.3921, 0.6782, 0.5957, 0.8975], aspect: 0.929, mean: [0.3218, 0.0113, 0.0144] }, { uv: [0.6084, 0.7046, 0.8018, 0.8804], aspect: 1.100, mean: [0.3114, 0.0189, 0.0234] }, { uv: [0.8115, 0.6782, 0.9922, 0.8979], aspect: 0.822, mean: [0.2358, 0.0055, 0.0089] }],
  [{ uv: [0.0054, 0.3955, 0.2051, 0.6206], aspect: 0.887, mean: [0.6367, 0.0798, 0.0156] }, { uv: [0.2056, 0.3931, 0.3955, 0.5796], aspect: 1.018, mean: [0.5856, 0.0919, 0.0213] }, { uv: [0.3931, 0.3745, 0.5933, 0.6167], aspect: 0.827, mean: [0.7316, 0.1822, 0.0133] }, { uv: [0.6084, 0.3882, 0.7969, 0.5903], aspect: 0.932, mean: [0.6639, 0.2134, 0.0113] }, { uv: [0.8066, 0.3721, 0.9922, 0.5908], aspect: 0.848, mean: [0.6748, 0.2806, 0.0055] }],
  [{ uv: [0.0083, 0.0796, 0.1973, 0.3042], aspect: 0.841, mean: [0.6258, 0.5910, 0.5935] }, { uv: [0.2153, 0.0806, 0.3901, 0.3042], aspect: 0.782, mean: [0.6475, 0.6157, 0.6265] }, { uv: [0.4023, 0.0796, 0.5913, 0.3140], aspect: 0.806, mean: [0.6262, 0.5922, 0.5944] }, { uv: [0.6079, 0.0962, 0.8057, 0.2905], aspect: 1.018, mean: [0.6361, 0.6011, 0.5986] }, { uv: [0.8330, 0.0859, 0.9888, 0.3115], aspect: 0.690, mean: [0.6254, 0.5877, 0.5934] }],
];
// 交叉面片草丛：几张贴着草丛照片的竖直面片绕中心交叉（从哪个方向看都有草），上半部微微向后弯
// 法线一律朝上：和地面的光照一致，草丛不会因为面片朝向不同而一张亮一张暗
function makeCard(card, h, planes = 3, seed = 1) {
  const R = rng(seed), [u0, v0, u1, v1] = card.uv, w = h * card.aspect, parts = [];
  for (let k = 0; k < planes; k++) {
    const g = new THREE.PlaneGeometry(w, h, 1, 3);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, uv = g.attributes.uv, nr = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      uv.setXY(i, lerp(u0, u1, uv.getX(i)), lerp(v0, v1, uv.getY(i)));
      const t = p.getY(i) / h;
      p.setZ(i, t * t * h * .12);
      nr.setXYZ(i, 0, 1, 0);
    }
    g.rotateY(k / planes * Math.PI + (R() - .5) * .35);
    parts.push(g);
  }
  return mergeGeometries(parts);
}
const TUFT_H = .11, MED_H = .34, TALL_H = .5, SEDGE_H = .7;
// 季节色 → 乘在贴图上的倍数（线性空间）：一半是"把贴图的平均色拉到这个季节色"，一半保留照片本身的颜色
const cardTint = (cur, card, keep = .5) => {
  const a = srgb(...cur), m = card.mean;
  return new THREE.Color(lerp(a.r / m[0], 1, keep), lerp(a.g / m[1], 1, keep), lerp(a.b / m[2], 1, keep));
};

export function buildPool(scene, { grassCount = 3000, tuftCount = 12000, tex }) {
  const R = rng(20261105);
  const rand = (a, b) => a + R() * (b - a);
  const under = [], above = [];
  const dummy = new THREE.Object3D(), c = new THREE.Color();

  // ---------- 地形 ----------
  const SIZE = 32, SEG = 280;
  const gGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gc = new Float32Array(gp.count * 3), gl = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), y = floorH(x, z);
    gp.setY(i, y);
    const k = poolK(x, z), n = fbm3(x * 1.3, 2, z * 1.3, 3), n2 = noise3(x * 6, 1, z * 6);
    // 顶点色是乘在贴图上的明暗 / 色调
    let c;
    if (y < -.02) {
      c = [1, 1, 1].map(v => v * lerp(.85, 1.1, n));
      c = mixA(c, [.62, .64, .6], sstep(-.4, -1.2, y) * .6);    // 深处有沉积物，偏暗
      c = mixA(c, [.7, .74, .58], sstep(.52, .68, fbm3(x * 1.4, 9, z * 1.4, 3)) * .5);   // 一块块偏黄绿的细泥沉积，浅水区看得见
    } else {
      // 岸上的颜色全交给着色器里的贴图层；顶点色只留一点点明暗起伏
      c = [1, 1, 1].map(v => v * lerp(.9, 1.06, n2));
    }
    gc[i * 3] = c[0]; gc[i * 3 + 1] = c[1]; gc[i * 3 + 2] = c[2];
    // 第三个分量：干燥度——土包顶上草发黄变稀，洼地里更绿更密
    gl[i * 3] = grassMask(x, z, y); gl[i * 3 + 1] = mossMask(x, z);
    gl[i * 3 + 2] = sstep(-.06, .12, landBump(x, z)) * landW(k);
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gGeo.setAttribute('aLawn', new THREE.BufferAttribute(gl, 3));
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: .6 }),
    { tex: { mode: 'ground', sets: [tex.riverbed], ground: tex.ground, scale: [.36, .4], bright: 1.3, tint: [1.1, 1, .84] } }));
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- 围池石块 ----------
  // 三种石色：冷灰花岗岩（多数）、偏暖的黄褐色石头、深色的石头；混在一起才不像一批复制出来的
  // 三套岩石贴图（自带颜色，不再整体去色）：大片苔藓的灰花岗岩 / 裂隙里细苔的深色花岗岩 / 浅色地衣花岗岩；
  // 程序生成的苔藓（aMoss）仍然叠在上面，所以每块石头的苔多少不同
  const rockMats = [[tex.rocks[0], .26, .86, [1, 1, 1]], [tex.rocks[1], .3, 1.3, [1, 1, .99]], [tex.rocks[2], .3, .54, [1.02, 1, .96]]].map(([set, gray, bright, tint]) =>
    patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: .55 }),
      { tex: { mode: 'rock', sets: [set, tex.moss], scale: [.6, .7], gray, bright, soft: .3, contrast: 1.25, tint, crack: .3, wet: tex.wetRock } }));   // 带裂纹
  const RV = rng(4711);   // 石头的颜色、倾斜用单独的随机数：不打乱后面草、花的摆放
  const geos = Array.from({ length: 6 }, (_, i) => makeRockGeo(i * 13.7 + 1.3, 4));
  const rocks = [], rockParts = [[], [], []];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  // 每块石头的苔藓量按 NATURE.moss 的分布抽
  const mossAmount = () => { let u = RV(); for (const [p, a, b] of NATURE.moss) { if (u < p) return a + RV() * (b - a); u -= p; } return .5; };
  // 落地：取石头底下几个点的地面高度，用中心和最低点之间的值——斜坡上的石头不会一边悬空，看起来是陷进土里的
  const baseAt = (x, z, r) => {
    const c = floorH(x, z); let lo = c;
    for (let a = 0; a < 4; a++) lo = Math.min(lo, floorH(x + Math.cos(a * 1.571 + .4) * r, z + Math.sin(a * 1.571 + .4) * r));
    return lerp(c, lo, .5);
  };
  // opt.yaw：朝向（默认随机）；opt.tilt：倾斜幅度；opt.center：只按中心点落地（水里的石头，不往深处沉）
  const place = (x, z, s, sx, sy, sz, sink, opt = {}) => {
    if (poolK(x, z) > 1.08 && Math.abs(z - FOX_Z) < 1.1 && Math.abs(x) > 4.4) return;   // 给两侧的石狐让位
    const v = RV();
    const geo = geos[Math.floor(R() * geos.length)], mi = v < .36 ? 0 : v < .74 ? 1 : 2;
    dummy.scale.set(s * sx, s * sy, s * sz);
    const tilt = opt.tilt ?? (RV() < .3 ? .4 : .15);   // 约三成的石头歪得明显一些
    dummy.rotation.set(rand(-1, 1) * tilt, opt.yaw ?? rand(0, Math.PI * 2), rand(-1, 1) * tilt);
    const base = opt.center ? floorH(x, z) : baseAt(x, z, s * Math.max(sx, sz) * .55);
    dummy.position.set(x, base + s * sy * sink, z);
    dummy.updateMatrix();
    const g = geo.clone().applyMatrix4(dummy.matrix);
    weatherRock(g, base, mossAmount(), RV() * 100, poolK(x, z));
    rockParts[mi].push(g);   // 先收集起来，最后按材质合并成三个模型（一百多块石头只画三次）
    rocks.push({ x, z, r: s * Math.max(sx, sz) });
  };

  // 主石圈：沿着池边一块挨一块地"走"一圈，相邻两块的间距按它们的大小来定——几块大石头之间夹着成串的中小石头、
  // 偶尔一块扁平的石板；大小、朝向、高低、进出都不一样（不再是等间距、差不多大的一圈）
  const ring = [];
  {
    const NR = NATURE.ring, list = [];
    const pick = () => {
      const u = R();
      if (u < NR.slab) return { kind: 'slab', s: rand(.6, .85), sx: rand(1.4, 1.8), sy: rand(.34, .46), sz: rand(1, 1.3), sink: rand(.04, .16) };
      if (u < NR.slab + NR.big) return { kind: 'big', s: rand(.82, 1.12), sx: rand(1.1, 1.45), sy: rand(.62, .9), sz: rand(.85, 1.15), sink: rand(0, .16) };
      if (u < NR.slab + NR.big + NR.mid) return { kind: 'mid', s: rand(.48, .72), sx: rand(1.1, 1.5), sy: rand(.55, .85), sz: rand(.85, 1.15), sink: rand(.04, .22) };
      return { kind: 'small', s: rand(.26, .42), sx: rand(1, 1.5), sy: rand(.5, .8), sz: rand(.8, 1.2), sink: rand(.06, .24) };
    };
    const ext = o => o.s * o.sx * .85;   // 平面上的大致半宽
    let prev = pick(), th = 0;
    prev.th = 0; list.push(prev);
    for (;;) {
      const o = pick(), t = th + (ext(prev) + ext(o)) * rand(...NR.overlap) / Rb(th);
      if (t + (ext(o) + ext(list[0])) * .73 / Rb(t) > Math.PI * 2) {
        // 最后一段：整圈按比例微微拉开，首尾刚好接上
        const sc = Math.PI * 2 / (th + (ext(prev) + ext(list[0])) * .73 / Rb(th));
        list.forEach(q => q.th *= sc);
        break;
      }
      o.th = th = t; list.push(o); prev = o;
    }
    const th0 = rand(0, Math.PI * 2);
    const wob = a => (fbm3(Math.cos(a) * 1.3, 5, Math.sin(a) * 1.3, 2) - .5) * .07;   // 池岸线本身也有缓慢的进出
    const KR = { slab: [.97, 1.04], big: [.99, 1.07], mid: [.96, 1.07], small: [.93, 1.1] };
    for (const o of list) {
      const a = o.th + th0, r = Rb(a) * (rand(...KR[o.kind]) + wob(a));
      // 多数石头的长边大致顺着池岸（自然冲刷、堆积的样子），少数随意
      const yaw = R() < .65 ? -(a + Math.PI / 2) + rand(-.45, .45) : rand(0, Math.PI * 2);
      const tilt = o.kind === 'small' ? rand(.15, .45) : o.kind === 'slab' ? rand(.05, .2) : rand(.04, .25);
      place(Math.cos(a) * r, Math.sin(a) * r, o.s, o.sx, o.sy, o.sz, o.sink, { yaw, tilt });
      ring.push({ a, ext: ext(o) });
    }
  }
  // 石缝：相邻两块石头之间的外侧（偶尔是水线处）卡着一两块小石头，大石头之间多一些
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    let d = B.a - A.a; if (d < 0) d += Math.PI * 2;
    const n = (R() < .75 ? 1 : 0) + (A.ext + B.ext > 1.2 && R() < .55 ? 1 : 0);
    for (let j = 0; j < n; j++) {
      const am = A.a + d * rand(.3, .7), out = R() < .75;
      const r = Rb(am) * (out ? rand(1.04, 1.13) : rand(.93, .99));
      place(Math.cos(am) * r, Math.sin(am) * r, rand(.14, .3), rand(1, 1.5), rand(.5, .8), rand(.8, 1.2), rand(.08, .22), { tilt: .35 });
    }
  }
  // 外圈零星大石，有的身边带一两块小石头（成组出现，不是孤零零一块）
  for (let i = 0; i < 11; i++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.12, 1.32), x = Math.cos(th) * r, z = Math.sin(th) * r, s = rand(.32, .62);
    place(x, z, s, rand(1, 1.4), rand(.5, .8), rand(.9, 1.2), rand(-.02, .18));
    for (let j = R() < .6 ? 1 + Math.floor(R() * 2) : 0; j > 0; j--) {
      const a = rand(0, Math.PI * 2), dd = s * rand(1.1, 1.6);
      place(x + Math.cos(a) * dd, z + Math.sin(a) * dd, rand(.1, .22), rand(1, 1.5), rand(.5, .8), rand(.8, 1.2), .16);
    }
  }
  // 零散碎石
  for (let i = 0; i < 16; i++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 1.4);
    place(Math.cos(th) * r, Math.sin(th) * r, rand(.08, .2), rand(1, 1.5), rand(.5, .8), rand(.8, 1.2), .2);
  }

  // 水里几块半露出水面的石头：水线正好横穿过它们
  for (let i = 0; i < 7; i++) {
    const th = RV() * Math.PI * 2, r = Rb(th) * (.86 + RV() * .08);
    place(Math.cos(th) * r, Math.sin(th) * r, .28 + RV() * .26, 1.1 + RV() * .4, .55 + RV() * .25, .9 + RV() * .3, -.05 + RV() * .15, { center: true });
  }

  // 同一种材质的石头合并成一个模型：原来每块石头单独画，每帧四遍（阴影、倒影、折射、画面）加起来几百次绘制
  rockParts.forEach((parts, i) => {
    if (!parts.length) return;
    const m = new THREE.Mesh(mergeGeometries(parts), rockMats[i]);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    parts.forEach(g => g.dispose());
  });

  // 石头脚下：一圈压暗的接触阴影，草被压没、露出泥土；石头才是"陷在土里"，不是摆在草皮上
  {
    const col = gGeo.attributes.color, lawn = gGeo.attributes.aLawn;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), z = gp.getZ(i);
      if (poolK(x, z) > 1.7) continue;
      let ao = 1, bare = 0;
      for (const o of rocks) {
        const d = Math.hypot(o.x - x, o.z - z) / o.r;
        if (d > 1.6) continue;
        ao *= 1 - .42 * sstep(1.6, .85, d);
        bare = Math.max(bare, sstep(1.4, .95, d));
      }
      if (ao === 1 && bare === 0) continue;
      col.setXYZ(i, col.getX(i) * ao, col.getY(i) * ao, col.getZ(i) * ao);
      lawn.setX(i, lawn.getX(i) * (1 - bare * .85));
    }
    col.needsUpdate = lawn.needsUpdate = true;
  }

  // ---------- 水底卵石 ----------
  let pg = new THREE.IcosahedronGeometry(1, 2);
  pg.deleteAttribute('normal'); pg.deleteAttribute('uv'); pg = mergeVertices(pg);
  { const p = pg.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); v.multiplyScalar(.85 + fbm3(v.x * 1.5, v.y * 1.5, v.z * 1.5, 2) * .3); p.setXYZ(i, v.x, v.y, v.z); }
    pg.computeVertexNormals(); }
  // 水底已经有卵石贴图，这里只放少量立体的大一点的石子，增加层次
  const PN = 420;   // 浅水区铺一层圆卵石，像设计图那样清楚可见
  const pebbles = new THREE.InstancedMesh(pg, patch(new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: .5 }),
    { tex: { mode: 'single', sets: [tex.rock], scale: [2.5, 2.5], gray: .9, bright: 2.2, tint: [.94, .97, 1.04] } }), PN);
  for (let i = 0; i < PN;) {
    const x = rand(-4.4, 4.4), z = rand(-4.4, 4.4);
    const k = poolK(x, z);
    if (k > .95) continue;
    const y = floorH(x, z);
    if (k < .66 || (k < .76 && R() < .6)) continue;    // 只铺在靠岸的浅水区，更深处看不清
    const s = rand(.11, .2) * (1 + Math.pow(R(), 4) * 1.2);
    if (y + s * .5 > -.04) continue;                    // 整颗都要浸在水下，不露出水面
    dummy.position.set(x, y + s * .1, z);
    dummy.scale.set(s * rand(1.1, 1.7), s * rand(.3, .5), s * rand(.9, 1.4));   // 扁一些的卵石
    dummy.rotation.set(rand(-.2, .2), rand(0, 6.28), rand(-.2, .2));
    dummy.updateMatrix(); pebbles.setMatrixAt(i, dummy.matrix);
    pebbles.setColorAt(i, c.setHSL(rand(.1, .14), rand(.0, .05), rand(.5, .8), THREE.SRGBColorSpace));
    i++;
  }
  pebbles.receiveShadow = true;
  scene.add(pebbles); under.push(pebbles);

  // 池底浅水区的细碎石子和砂砾：靠岸多、往里渐少，池心的井口完全空着（给龙和许愿特效留位置）
  const silt = new THREE.InstancedMesh(pg, pebbles.material, NATURE.silt);
  for (let i = 0, tries = 0; i < NATURE.silt && tries < 30000; tries++) {
    const x = rand(-4.4, 4.4), z = rand(-4.4, 4.4), k = poolK(x, z);
    if (k > .95 || k < .6 || R() > sstep(.6, .82, k)) continue;
    const y = floorH(x, z), s = rand(.025, .06) * (R() < .1 ? 1.6 : 1);
    if (y + s > -.05) continue;
    dummy.position.set(x, y + s * .1, z);
    dummy.scale.set(s * rand(1, 1.6), s * rand(.4, .7), s * rand(.8, 1.3));
    dummy.rotation.set(rand(-.3, .3), rand(0, 6.28), rand(-.3, .3));
    dummy.updateMatrix(); silt.setMatrixAt(i, dummy.matrix);
    silt.setColorAt(i, c.setHSL(rand(.07, .14), rand(.03, .1), rand(.32, .68), THREE.SRGBColorSpace));
    i++; silt.count = i;
  }
  silt.receiveShadow = true;
  scene.add(silt); under.push(silt);

  // ---------- 铜钱 ----------
  const shape = new THREE.Shape(); shape.absarc(0, 0, .13, 0, Math.PI * 2, false);
  const a = .04, hole = new THREE.Path();
  hole.moveTo(-a, -a); hole.lineTo(-a, a); hole.lineTo(a, a); hole.lineTo(a, -a); hole.lineTo(-a, -a);
  shape.holes.push(hole);
  const coinGeo = new THREE.ExtrudeGeometry(shape, { depth: .014, bevelEnabled: true, bevelThickness: .006, bevelSize: .008, bevelSegments: 2, curveSegments: 40 });
  coinGeo.translate(0, 0, -.007); coinGeo.rotateX(-Math.PI / 2);
  const coinMat = patch(new THREE.MeshStandardMaterial({ color: srgb(.78, .6, .3), metalness: .85, roughness: .35 }));
  for (let i = 0; i < 11;) {
    const x = rand(-3.5, 3.5), z = rand(-3.5, 3.5);
    // 铜钱散落在半深处：隐约可见，越往池心越模糊
    const ck = poolK(x, z);
    if (ck > .82 || ck < .45 || floorH(x, z) > -.2) continue;
    const m = new THREE.Mesh(coinGeo, coinMat);
    m.position.set(x, floorH(x, z) + .025, z);
    m.rotation.set(rand(-.2, .2), rand(0, 6.28), rand(-.2, .2));
    m.receiveShadow = true;
    scene.add(m); under.push(m);
    i++;
  }

  // 两侧石狐的底座附近不种高的植物（石狐离池边的距离随屏幕宽度变，x 约在 4.6～5.8 之间；底座四周的植物由 dressFoxes 单独摆）
  const nearFox = (x, z) => poolK(x, z) > 1.08 && Math.abs(z - FOX_Z) < 1 && Math.abs(x) > 4.2 && Math.abs(x) < 6.6;

  // ---------- 草丛：一簇簇高一点的草（交叉面片），石头附近密，远处零星；偶尔夹一丛带草穗的高草 ----------
  const cardMat = (h, sway, underwater = false) => patch(new THREE.MeshStandardMaterial({ map: tex.grass, alphaTest: .5, side: THREE.DoubleSide, roughness: .8 }),
    { grass: true, grassH: h, sway, upNormal: true, card: true, underwater });
  const clusters = Math.round(grassCount / 22);   // grassCount 原来是草叶数，一丛约 22 片
  const grass = new THREE.InstancedMesh(makeCard(GRASS_CARDS.medium, MED_H, 3, 11), cardMat(MED_H, 1), clusters * 2);
  const grassTall = new THREE.InstancedMesh(makeCard(GRASS_CARDS.tall, TALL_H, 2, 12), cardMat(TALL_H, 1.3), clusters);
  const grassVar = [], tallVar = [];
  for (let cl = 0, tries = 0; cl < clusters && tries < 40000; tries++) {
    const th = rand(0, Math.PI * 2), k = 1 + Math.pow(R(), 2.4) * 1.7, r = Rb(th) * k;   // 越靠近石圈越密
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    if (floorH(cx, cz) < .06) continue;
    if (fbm3(cx * .6, 7, cz * .6, 3) < .4 + R() * .1) continue;
    if (nearFox(cx, cz)) continue;
    if (rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .75)) continue;
    // 成片生长：落在"稀疏地"里的草丛大多不要（群落和地面草坪用同一个噪声，草丛和露土对得上）
    if (R() > lerp(.2, 1, sstep(.4, .55, community(cx, cz)))) continue;
    const far = k > 1.45;
    if (far && R() < .75) continue;                      // 远处的草丛少一些、矮一些
    cl++;
    const tall = rand(.7, 1.15) * (k < 1.3 ? 1.1 : far ? .75 : 1);
    const olive = sstep(.45, .7, fbm3(cx * .5, 23, cz * .5, 2)) * .5 + rand(0, .12);   // 有的一片偏黄绿、有的偏蓝绿
    const m = 1 + (R() < .55 ? 1 : 0) + (R() < .2 ? 1 : 0);
    for (let j = 0; j < m; j++) {
      const x = cx + gauss() * .1, z = cz + gauss() * .1, y = floorH(x, z);
      if (y < .06) continue;
      dummy.position.set(x, y - .02, z);
      dummy.rotation.set(rand(-.12, .12), rand(0, 6.28), rand(-.12, .12));
      const s = tall * rand(.7, 1.2);
      dummy.scale.set(s * rand(.85, 1.15), s, s * rand(.85, 1.15));
      dummy.updateMatrix(); grass.setMatrixAt(grassVar.length, dummy.matrix);
      grassVar.push([rand(.86, 1.1) * (far ? 1.04 : 1), olive]);
    }
    if (R() < .22) {   // 带草穗的高草，从草丛里冒出来
      const x = cx + gauss() * .05, z = cz + gauss() * .05, y = floorH(x, z);
      dummy.position.set(x, y - .02, z);
      dummy.rotation.set(rand(-.08, .08), rand(0, 6.28), rand(-.08, .08));
      dummy.scale.setScalar(rand(.8, 1.15) * (far ? .8 : 1));
      dummy.updateMatrix(); grassTall.setMatrixAt(tallVar.length, dummy.matrix);
      tallVar.push([rand(.9, 1.1), olive]);
    }
  }
  grass.count = grassVar.length; grassTall.count = tallVar.length;
  for (const g of [grass, grassTall]) { g.receiveShadow = g.castShadow = true; scene.add(g); above.push(g); }

  // ---------- 矮草簇：铺满整片草地，跟着着色器画的草坪走（露土处不长，土包上稀而黄，远处稀一些） ----------
  // 草簇少的时候（为了流畅）每簇稍微宽一点，草地看起来一样密
  const TUFT_W = Math.min(1.15, Math.pow(60000 / tuftCount, .25));
  tuftCount = Math.round(tuftCount * NATURE.tuftKeep);   // 宽度仍按原来的数量算：少的那部分是真的少了（露土），不是摊薄
  const tufts = new THREE.InstancedMesh(makeCard(GRASS_CARDS.short, TUFT_H, 2, 13), cardMat(TUFT_H, .35), tuftCount);
  const tuftVar = [];   // [深浅绿的比例, 干燥度, 苔藓程度, 亮度, 偏黄绿]
  for (let n = 0, tries = 0; n < tuftCount && tries < tuftCount * 6; tries++) {
    const cx = rand(-12.5, 12.5), cz = rand(-12.5, 12.5);
    // 镜头里看得清的近处密，画面边缘以外稀（先做这个便宜的判断，省得每个点都算地形）
    const distW = lerp(1, .2, sstep(7, 12, Math.max(Math.abs(cx), Math.abs(cz))));
    if (R() > distW) continue;
    const cy = floorH(cx, cz);
    const ck = poolK(cx, cz);
    let cover = grassMask(cx, cz, cy);
    if (cover < .05) continue;
    const moss = mossMask(cx, cz);
    const dry = lawnDry(cx, cz, sstep(-.06, .12, landBump(cx, cz)) * landW(ck));
    cover *= 1 - lawnBare(cx, cz, dry, moss) * .75;
    if (R() > cover * cover * (1 - dry * .35)) continue;
    if ((nearFox(cx, cz) && R() < .55) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .8)) continue;   // 石狐脚下也长矮草（稀一些），不再是一块平平的草皮
    // 每处 1～3 簇挤在一起，不是均匀撒点
    const m = 1 + Math.floor(R() * 3);
    const ln = vnoise(cx * .35, cz * .35) * .55 + vnoise(cx * 1.6, cz * 1.6) * .3 + vnoise(cx * 5, cz * 5) * .15;
    const olive = sstep(.45, .7, fbm3(cx * .5, 23, cz * .5, 2)) * .45;
    const lush = lushness(ck);
    for (let j = 0; j < m && n < tuftCount; j++) {
      const x = cx + gauss() * .09, z = cz + gauss() * .09, y = floorH(x, z);
      if (y < .04) continue;
      dummy.position.set(x, y - .01, z);
      dummy.rotation.set(rand(-.15, .15), rand(0, 6.28), rand(-.15, .15));
      const s = rand(.7, 1.3) * (1 - dry * .3) * lerp(.75, 1.12, cover) * lerp(.9, 1.06, lush);   // 茂盛处高一些，稀疏处矮
      dummy.scale.set(s * rand(.85, 1.2) * TUFT_W, s, s * rand(.85, 1.2) * TUFT_W);
      dummy.updateMatrix(); tufts.setMatrixAt(n, dummy.matrix);
      tuftVar.push([clamp(sstep(.25, .75, ln) + rand(-.2, .2)), dry, moss, rand(.85, 1.12), olive + rand(0, .1)]);
      n++; tufts.count = n;
    }
  }
  tufts.receiveShadow = true;
  scene.add(tufts); above.push(tufts);

  // ---------- 地面植物（照片图集 groundplants_atlas）：三叶草 / 蕨 / 蜂斗菜 / 白花，每种 4 个形态 ----------
  // 单位大小的交叉面片（高 1，宽由着色器按图集里的宽高比放大）：3 张绕中心每隔 60° 交叉，上半部微微向后弯，法线朝上；
  // 每个实例自带它在图集里的 uv 范围（aCell），一种植物只用一个 InstancedMesh
  const plantCardGeo = (() => {
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 3); g.translate(0, .5, 0);
      const p = g.attributes.position, nr = g.attributes.normal;
      for (let i = 0; i < p.count; i++) { const t = p.getY(i); p.setZ(i, t * t * .1); nr.setXYZ(i, 0, 1, 0); }
      g.rotateY(k / 3 * Math.PI + .2);
      parts.push(g);
    }
    return mergeGeometries(parts);
  })();
  const plantMat = patch(new THREE.MeshStandardMaterial({ map: tex.plants, alphaTest: .5, side: THREE.DoubleSide, roughness: .8 }),
    { cell: true, grass: true, grassH: 1, sway: .45, upNormal: true, card: true, underwater: false });
  // row：图集里的行（0 三叶草，1 蕨，2 蜂斗菜，3 白花）；put 放一株：h 是株高（米）、v 是第几个形态
  // opts：mat 换材质（夜景的地被、小白花用自己的图集）、cells 换 uv 表（默认 GROUND_PLANTS[row]）、shadow 是否投影
  const plantSet = (row, N, opts = {}) => {
    const cells = opts.cells || GROUND_PLANTS[row], geo = plantCardGeo.clone(), cell = new Float32Array(N * 4), bright = [];
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4));
    const m = new THREE.InstancedMesh(geo, opts.mat || plantMat, N);
    m.count = 0; m.frustumCulled = false; m.receiveShadow = true; m.castShadow = opts.shadow ?? true;
    let base = new THREE.Color(1, 1, 1);
    m.put = (x, y, z, h, v = Math.floor(R() * cells.length), b = rand(.88, 1.1)) => {
      const i = m.count; if (i >= N) return false;
      dummy.position.set(x, y - .015, z); dummy.rotation.set(rand(-.08, .08), rand(0, 6.28), rand(-.08, .08)); dummy.scale.setScalar(h);
      dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
      const [u0, v0, u1, v1] = cells[v % cells.length].uv; cell.set([u0, v0, u1 - u0, v1 - v0], i * 4);
      bright[i] = b; m.setColorAt(i, c.copy(base).multiplyScalar(b)); m.count = i + 1;
      return true;
    };
    m.reset = () => { m.count = 0; };
    m.tint = col => { base = col.clone(); for (let i = 0; i < m.count; i++) m.setColorAt(i, c.copy(base).multiplyScalar(bright[i])); if (m.instanceColor) m.instanceColor.needsUpdate = true; };
    m.done = () => { m.instanceMatrix.needsUpdate = true; geo.attributes.aCell.needsUpdate = true; scene.add(m); above.push(m); return m; };
    return m;
  };
  const ringRocks = rocks.filter(o => poolK(o.x, o.z) < 1.35);

  // ---------- 夜景：石圈外的阔叶地被和月光下的小白花 ----------
  // 夜景参考图里岸上没有草坪，是一层密密的阔叶地被（玉簪、虎耳草、蜂斗菜幼株、酢浆草 / 常春藤）加零星发亮的小白花。
  // 白天不要这些（白天的画面已经调好了）：材质带 nightOnly，着色器里按"夜的程度"把它们从无到有"长"出来（太阳落到 -5° 以下才开始），
  // 所以日落到夜晚、夜晚到日出是渐变的，没有突然出现；不投影（投影用的是另一套着色器，缩不掉）
  const nightMatFor = (map, extra = {}) => patch(new THREE.MeshStandardMaterial({ map, alphaTest: .5, side: THREE.DoubleSide, roughness: .55 }),
    { cell: true, grass: true, grassH: 1, sway: .25, upNormal: true, card: true, underwater: false, nightOnly: true, ...extra });
  const broadMat = nightMatFor(tex.broadleaf), moonMat = nightMatFor(tex.moonflowers, { moonGlow: true });
  const cover = [0, 1, 2, 3].map(row => plantSet(row, [170, 190, 70, 170][row], { cells: BROADLEAF_PLANTS[row], mat: broadMat, shadow: false }));
  const heights = [[.22, .36], [.16, .28], [.26, .4], [.14, .24]];   // 每行植物的株高范围（米）：玉簪大一些，小叶地被矮一些
  for (let tries = 0; tries < 30000 && cover.some(m => m.count < m.instanceMatrix.count * .9); tries++) {
    const th = rand(0, Math.PI * 2), k = 1.05 + Math.pow(R(), 1.7) * 1.35, r = Rb(th) * k, cx = Math.cos(th) * r, cz = Math.sin(th) * r, cy = floorH(cx, cz);   // 越靠近石圈越密
    if (cy < .05 || nearFox(cx, cz) || R() > lerp(1, .45, sstep(1.3, 2.4, k))) continue;
    if (rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .85)) continue;
    const row = Math.floor(R() * 4), m = 1 + Math.floor(R() * 3);
    for (let j = 0; j < m; j++) {   // 一处 1～3 株，同一种挤在一起
      const x = cx + gauss() * .22, z = cz + gauss() * .22, y = floorH(x, z);
      if (y > .04 && !rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .75)) cover[row].put(x, y, z, rand(...heights[row]));
    }
  }
  cover.forEach(m => m.done());
  const moonFlowers = plantSet(0, 150, { cells: MOONFLOWERS.flat(), mat: moonMat, shadow: false });
  for (let tries = 0; tries < 30000 && moonFlowers.count < 140; tries++) {
    const th = rand(0, Math.PI * 2), k = 1.04 + Math.pow(R(), 1.5) * 1.1, r = Rb(th) * k, cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    if (floorH(cx, cz) < .05 || nearFox(cx, cz) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .85)) continue;
    for (let j = 1 + Math.floor(R() * 3); j > 0; j--) { const x = cx + gauss() * .2, z = cz + gauss() * .2; moonFlowers.put(x, floorH(x, z), z, rand(.14, .26)); }
  }
  moonFlowers.done();

  // ---------- 蕨类：池边潮湿处成丛生长 ----------
  // 一处 1～3 株挤在一起，大小不一；背阴的一侧（朝 +z）多一些
  const ferns = plantSet(1, 110);
  const bigRocks = rocks.filter(o => o.r > .5 && poolK(o.x, o.z) < 1.35);
  for (let tries = 0; ferns.count < 110 && tries < 10000; tries++) {
    const o = bigRocks[Math.floor(R() * bigRocks.length)];          // 只挨着大石头
    if (o.z < 0 && R() < .35) continue;
    const out = Math.atan2(o.z, o.x) + rand(-.9, .9);                 // 朝池外一侧
    const cx = o.x + Math.cos(out) * o.r * rand(.8, 1.2), cz = o.z + Math.sin(out) * o.r * rand(.8, 1.2);
    const m = 1 + Math.floor(R() * R() * 3), big = rand(.75, 1.15);
    for (let j = 0; j < m; j++) {
      const x = cx + gauss() * .16, z = cz + gauss() * .16, y = floorH(x, z);
      if (y < .06 || poolK(x, z) < 1.03 || nearFox(x, z)) continue;
      ferns.put(x, y, z, rand(.4, .66) * big);
    }
  }
  ferns.done();

  // ---------- 菖蒲：长在石缝和水边（交叉面片），剑形叶打破石圈的圆形轮廓 ----------
  const IN = 16, irisVar = [];
  const iris = new THREE.InstancedMesh(makeCard(GRASS_CARDS.sedge, SEDGE_H, 3, 14), cardMat(SEDGE_H, .6, true), IN);
  for (let n = 0, cl = 0, tries = 0; cl < 5 && tries < 2000; tries++) {   // 水边只零星几丛
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(.94, 1.02), cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    cl++;
    const m = 1 + Math.floor(R() * 2), tall = rand(.75, 1.05);
    for (let j = 0; j < m && n < IN; j++) {
      const x = cx + gauss() * .05, z = cz + gauss() * .05;
      dummy.position.set(x, Math.max(floorH(x, z), -.25) - .02, z);
      dummy.rotation.set(rand(-.08, .08), rand(0, 6.28), rand(-.08, .08));
      dummy.scale.setScalar(tall * rand(.85, 1.1));
      dummy.updateMatrix(); iris.setMatrixAt(n, dummy.matrix);
      irisVar.push(rand(.9, 1.1));
      n++; iris.count = n;
    }
  }
  iris.receiveShadow = true; iris.castShadow = true;
  scene.add(iris);

  // ---------- 蜂斗菜：宽叶的矮丛，散在石圈外侧（打破石圈的轮廓，参考图右侧那种大叶子） ----------
  const butter = plantSet(2, 64);
  for (let tries = 0, groups = 0; groups < 18 && tries < 5000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.12, 1.55), cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    if (floorH(cx, cz) < .06 || nearFox(cx, cz) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .9)) continue;
    if (cx < 0 && R() < .4) continue;   // 右边（参考图那一侧）多一些
    groups++;
    // 一丛：一株大的居中、旁边挤着 1～3 株小一点的——大圆叶成片，不是零星的单株
    butter.put(cx, floorH(cx, cz), cz, rand(.42, .68));
    for (let j = 1 + Math.floor(R() * 3); j > 0; j--) {
      const x = cx + gauss() * .36, z = cz + gauss() * .36, y = floorH(x, z);
      if (y > .06 && !rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .9)) butter.put(x, y, z, rand(.26, .44));
    }
  }
  butter.done();

  // ---------- 石脚下的三叶草：一丛丛低矮的圆叶，塞满石头之间和石头脚下 ----------
  const weeds = plantSet(0, 760);
  for (let tries = 0; weeds.count < 520 && tries < 20000; tries++) {
    const o = ringRocks[Math.floor(R() * ringRocks.length)];
    const a = Math.atan2(o.z, o.x) + gauss() * 1.6, d = o.r * rand(.6, 1.15);   // 多数长在石头朝外的一侧
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d, y = floorH(x, z);
    if (y < .03 || poolK(x, z) < 1.0 || nearFox(x, z)) continue;
    if (rocks.some(q => Math.hypot(q.x - x, q.z - z) < q.r * .5)) continue;
    weeds.put(x, y, z, rand(.17, .3));
  }
  // 三叶草毯：岸边茂盛的几处（和草地的"茂盛 / 稀疏"同一个群落噪声）一片一片地铺开，每片 5～9 株挤在 40 厘米内
  for (let tries = 0, mats = 0; mats < 30 && tries < 8000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 1.7), cx = Math.cos(th) * r, cz = Math.sin(th) * r, cy = floorH(cx, cz);
    if (cy < .05 || nearFox(cx, cz) || community(cx, cz) < .5 || grassMask(cx, cz, cy) < .4) continue;
    if (rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .8)) continue;
    mats++;
    for (let j = 5 + Math.floor(R() * 5); j > 0; j--) {
      const x = cx + gauss() * .26, z = cz + gauss() * .26, y = floorH(x, z);
      if (y > .04 && !rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .6)) weeds.put(x, y, z, rand(.16, .28));
    }
  }
  weeds.done();

  // ---------- 碎石和卵石：大多卡在石缝里、堆在石头脚下（成小堆），露土的稀疏地里零星几颗 ----------
  // 太小的碎石不投影（影子小于一个阴影像素，白白多画）
  const GVN = NATURE.gravel;
  const stoneMat = patch(new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: .8 }),
    { underwater: false, tex: { mode: 'single', sets: [tex.rock], scale: [2.5, 2.5], gray: .75, bright: 2.3, soft: .45, tint: [1.04, 1, .93] } });   // soft：和大石头一样压缩明暗（否则暗色的石材贴图让碎石发黑）
  const smallStones = new THREE.InstancedMesh(pg, stoneMat, GVN);
  for (let i = 0, tries = 0; i < GVN && tries < 30000; tries++) {
    let x, z, s;
    if (R() < .72) {
      const o = ringRocks[Math.floor(R() * ringRocks.length)];
      const a = Math.atan2(o.z, o.x) + gauss() * 1.3, d = o.r * rand(.8, 1.2);
      x = o.x + Math.cos(a) * d; z = o.z + Math.sin(a) * d;
      s = rand(.035, .1) * (R() < .15 ? 1.7 : 1);
    } else {
      const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.1, 2.6);
      x = Math.cos(th) * r; z = Math.sin(th) * r;
      if (grassMask(x, z, floorH(x, z)) > .45) continue;   // 只在露土的地方
      s = rand(.03, .09);
    }
    const y = floorH(x, z);
    if (y < .02 || nearFox(x, z) || rocks.some(q => Math.hypot(q.x - x, q.z - z) < q.r * .6)) continue;
    dummy.position.set(x, y + s * .05, z);
    dummy.scale.set(s * rand(1, 1.6), s * rand(.4, .7), s * rand(.8, 1.3));
    dummy.rotation.set(rand(-.3, .3), rand(0, 6.28), rand(-.3, .3));
    dummy.updateMatrix(); smallStones.setMatrixAt(i, dummy.matrix);
    smallStones.setColorAt(i, c.setHSL(rand(.07, .12), rand(.02, .07), rand(.68, .92), THREE.SRGBColorSpace));
    i++; smallStones.count = i;
  }
  smallStones.receiveShadow = true;
  scene.add(smallStones); above.push(smallStones);

  // ---------- 野花：一小簇一小簇地开在草地里，以白色为主（照片图集里的白花） ----------
  const flowers = plantSet(3, 90);
  for (let tries = 0; flowers.count < 90 && tries < 30000; tries++) {
    let cx = rand(-10, 10), cz = rand(-10, 10);
    if (R() < .5) {   // 一半开在石头脚下的草丛里
      const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 1.35);
      cx = Math.cos(th) * r; cz = Math.sin(th) * r;
    }
    const y = floorH(cx, cz);
    if (grassMask(cx, cz, y) < .5 || nearFox(cx, cz) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .8)) continue;
    const m = 1 + Math.floor(R() * 3);
    for (let j = 0; j < m; j++) { const x = cx + gauss() * .2, z = cz + gauss() * .2; flowers.put(x, floorH(x, z), z, rand(.16, .28)); }
  }
  flowers.done();

  // 萤火虫出没的位置：草丛边
  const flySpots = Array.from({ length: 30 }, () => {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.05, 1.6), x = Math.cos(th) * r, z = Math.sin(th) * r;
    return new THREE.Vector3(x, Math.max(floorH(x, z), 0) + rand(.3, .9), z);
  });

  // ---------- 地上的落叶（照片图集 leaves_atlas：枫叶、花瓣），大多堆在石头脚下 ----------
  // 平放在地面上的单位方片（略微卷翘），每个实例自带图集 uv（aCell）；哪一片、什么颜色随季节换（setSeason）
  const leafGeo = () => {
    const g = new THREE.PlaneGeometry(1, 1, 3, 3); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, (p.getX(i) ** 2 + p.getZ(i) ** 2) * .5);
    g.computeVertexNormals();
    g.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(4 * 512), 4));
    return g;
  };
  const GN = 460, groundLeafPos = [];
  const leafMat = patch(new THREE.MeshStandardMaterial({ map: tex.leaves, alphaTest: .5, side: THREE.DoubleSide, roughness: .8 }),
    { cell: 'flat', underwater: false });
  const groundLeaves = new THREE.InstancedMesh(leafGeo(), leafMat, GN);
  for (let tries = 0; groundLeafPos.length < GN && tries < 20000; tries++) {
    let x, z;
    if (R() < .92) {   // 几乎都卡在石头脚下
      const o = rocks[Math.floor(R() * Math.min(rocks.length, 40))];
      const a = Math.atan2(o.z, o.x) + gauss() * 1.2, d = o.r * (.8 + Math.abs(gauss()) * .6);
      x = o.x + Math.cos(a) * d; z = o.z + Math.sin(a) * d;
    } else {           // 零星散落在草地上
      const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 2.2);
      x = Math.cos(th) * r; z = Math.sin(th) * r;
    }
    const y = floorH(x, z);
    if (y < .04 || rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .7)) continue;
    groundLeafPos.push([x, y + .012, z, rand(0, 6.28), rand(.8, 1.25), R()]);
  }
  groundLeaves.frustumCulled = false; groundLeaves.receiveShadow = true;
  scene.add(groundLeaves); above.push(groundLeaves);

  // ---------- 水面上漂着的几片落叶：只在靠岸的浅水上、彼此离得远，池心保持干净 ----------
  const floatPos = [];
  for (let tries = 0; floatPos.length < NATURE.floatLeaves && tries < 2000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(.72, .88), x = Math.cos(th) * r, z = Math.sin(th) * r;
    if (floatPos.some(q => Math.hypot(q[0] - x, q[2] - z) < 1.5)) continue;
    floatPos.push([x, .006, z, rand(0, 6.28), rand(.8, 1.05), R()]);
  }
  const floatLeaves = new THREE.InstancedMesh(leafGeo(), leafMat, Math.max(1, floatPos.length));
  floatLeaves.count = 0; floatLeaves.frustumCulled = false;
  scene.add(floatLeaves); above.push(floatLeaves);

  // ---------- 石狐底座四周：泥土、苔藓、碎石、低矮的小草（左右两只的多少不一样，不对称） ----------
  // 石狐的位置随屏幕宽度变化（fox.js 的 layout）：这里先按固定种子生成"相对底座"的位置，摆放时（dressFoxes）再落到地面上。
  // 只长在底座脚下，都很矮，不会挡住石狐的脸和身形
  const RF = rng(9157);
  const edgePt = () => {   // 底座（正方形）边上的一点：[u, v, 外法线 x, 外法线 z]，u / v 以底座半宽为单位
    const e = RF() * 4, t = (e % 1) * 2 - 1, k = Math.floor(e);
    return k === 0 ? [t, -1, 0, -1] : k === 1 ? [1, t, 1, 0] : k === 2 ? [-t, 1, 0, 1] : [-1, -t, -1, 0];
  };
  const foxDress = {};
  for (const side of [-1, 1]) {
    const cfg = NATURE.foxBase[side], spots = Array.from({ length: 3 }, edgePt);   // 几个"生长点"，植物成簇长在附近
    const mk = (n, o0, o1) => Array.from({ length: n }, () => {
      const [u, v, nx, nz] = RF() < .75 ? spots[Math.floor(RF() * spots.length)] : edgePt(), j = (RF() - .5) * .55;
      return { u: u + (nx === 0 ? j : 0), v: v + (nz === 0 ? j : 0), nx, nz, out: o0 + RF() * (o1 - o0), rot: RF() * 6.28, s: RF() };
    });
    foxDress[side] = { weeds: mk(cfg.weeds, -.02, .3), ferns: mk(cfg.ferns, .06, .3), flowers: mk(cfg.flowers, .02, .28), stones: mk(cfg.stones, -.03, .16) };
  }
  const nFox = key => NATURE.foxBase[-1][key] + NATURE.foxBase[1][key];
  const foxWeeds = plantSet(0, nFox('weeds')), foxFerns = plantSet(1, nFox('ferns')), foxFlowers = plantSet(3, nFox('flowers'));
  const foxStones = new THREE.InstancedMesh(pg, stoneMat, nFox('stones'));
  for (let i = 0; i < foxStones.count; i++) foxStones.setColorAt(i, c.setHSL(.09 + RF() * .03, .03 + RF() * .05, .62 + RF() * .25, THREE.SRGBColorSpace));
  foxWeeds.done(); foxFerns.done(); foxFlowers.done();   // 位置随布局变化（plantSet 的实例不做视锥裁剪）
  foxStones.count = 0; foxStones.frustumCulled = false; foxStones.receiveShadow = true;
  scene.add(foxStones); above.push(foxStones);
  // list：[{ x, z, angle（底座朝向）, foot（底座半宽）, side, visible }]
  function dressFoxes(list) {
    const fb = shared.uFoxBase.value, ff = shared.uFoxFoot.value, fa = shared.uFoxAmt.value;
    fa.set(0, 0, 0, 0);
    let is = 0;
    foxWeeds.reset(); foxFerns.reset(); foxFlowers.reset();
    for (const f of list) {
      if (!f.visible) continue;
      const cfg = NATURE.foxBase[f.side], D = foxDress[f.side], ca = Math.cos(f.angle), sa = Math.sin(f.angle);
      if (f.side < 0) { fb.x = f.x; fb.y = f.z; ff.x = f.foot; fa.x = cfg.dirt; fa.z = cfg.moss; }
      else { fb.z = f.x; fb.w = f.z; ff.y = f.foot; fa.y = cfg.dirt; fa.w = cfg.moss; }
      const at = o => {
        const lx = o.u * f.foot + o.nx * o.out, lz = o.v * f.foot + o.nz * o.out;
        const x = f.x + lx * ca + lz * sa, z = f.z - lx * sa + lz * ca;
        return dummy.position.set(x, floorH(x, z), z);
      };
      // 矮小的三叶草和小蕨：长在底座脚下，不超过底座的一半高，不挡住石狐
      for (const o of D.weeds) { const p = at(o); foxWeeds.put(p.x, p.y, p.z, .14 + o.s * .12, Math.floor(o.rot * .63) % 4, .85 + o.s * .25); }
      for (const o of D.ferns) { const p = at(o); foxFerns.put(p.x, p.y, p.z, .26 + o.s * .16, Math.floor(o.rot * .63) % 4, .85 + o.s * .25); }
      for (const o of D.flowers) { const p = at(o); foxFlowers.put(p.x, p.y, p.z, .12 + o.s * .08, Math.floor(o.rot * .63) % 4, .9 + o.s * .15); }
      for (const o of D.stones) {
        const s = .05 + o.s * .1;
        at(o).y += s * .05; dummy.rotation.set(0, o.rot, .2 * (o.s - .5)); dummy.scale.set(s * 1.4, s * .6, s);
        dummy.updateMatrix(); foxStones.setMatrixAt(is++, dummy.matrix);
      }
    }
    foxStones.count = is; foxStones.instanceMatrix.needsUpdate = true;
    for (const m of [foxWeeds, foxFerns, foxFlowers]) { m.instanceMatrix.needsUpdate = true; m.geometry.attributes.aCell.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }

  function setSeason(season) {
    const gt = cardTint(SEASON_GRASS[season], GRASS_CARDS.medium), gtt = cardTint(SEASON_GRASS[season], GRASS_CARDS.tall);
    // 偏黄绿的那几片：往橄榄色 / 枯黄色拉一点（乘在贴图上，线性空间）
    const OLIVE = new THREE.Color(1.12, .96, .72), tmpC = new THREE.Color();
    const tintVar = (base, [b, o]) => c.copy(base).multiplyScalar(b).lerp(tmpC.copy(base).multiply(OLIVE).multiplyScalar(b), o);
    for (let i = 0; i < grass.count; i++) grass.setColorAt(i, tintVar(gt, grassVar[i]));
    for (let i = 0; i < grassTall.count; i++) grassTall.setColorAt(i, tintVar(gtt, tallVar[i]));
    for (const g of [grass, grassTall]) if (g.instanceColor) g.instanceColor.needsUpdate = true;
    // 草坪的颜色
    const lw = SEASON_LAWN[season];
    shared.uLawnA.value.copy(srgb(...lw.a)); shared.uLawnB.value.copy(srgb(...lw.b)); shared.uLawnMoss.value.copy(srgb(...lw.moss));
    // 矮草簇：和草坪同一套颜色（在线性空间里按同样的方式混合），草尖略亮
    const la = shared.uLawnA.value, lb = shared.uLawnB.value, lm = shared.uLawnMoss.value;
    const gray = (lb.r + lb.g + lb.b) / 3, straw = new THREE.Color(gray * 1.3, gray * 1.12, gray * .66);
    const sm = GRASS_CARDS.short.mean, shortInv = new THREE.Color(.88 / sm[0], .9 / sm[1], .95 / sm[2]);
    const oliveC = new THREE.Color(gray * 1.15, gray * 1.08, gray * .62).lerp(lb, .45);
    for (let i = 0; i < tufts.count; i++) {
      const [t, dry, moss, b, o] = tuftVar[i];
      c.copy(la).lerp(lb, t).lerp(oliveC, o).lerp(straw, dry * .3).lerp(lm, moss * .7).multiplyScalar(b);
      tufts.setColorAt(i, c.multiply(shortInv));   // 矮草要和底下的草坪融成一片：平均色直接拉到草坪色
    }
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    // 地面植物：照片本身的颜色乘一个季节色（夏天收一点黄、压一点饱和，和草坪站在一起；冬天深一些）
    const pt = new THREE.Color(...SEASON_PLANT[season]);
    for (const m of [ferns, butter, weeds, foxWeeds, foxFerns]) m.tint(pt);
    foxFlowers.tint(new THREE.Color(1, 1, 1));
    for (const m of [...cover, moonFlowers]) m.tint(new THREE.Color(1, 1, 1));
    const ir = SEASON_IRIS[season];
    const it = cardTint(ir, GRASS_CARDS.sedge);
    for (let i = 0; i < iris.count; i++) iris.setColorAt(i, c.copy(it).multiplyScalar(irisVar[i]));
    iris.instanceColor.needsUpdate = true;
    const FS = SEASON_FLOWERS[season];
    flowers.count = Math.min(FS.n, flowers.instanceMatrix.count);   // 冬天没有花；其余季节按数量取前面几簇
    flowers.tint(new THREE.Color(1, 1, 1));
    // 地上的落叶：秋天最多；每片从图集里挑一片（rows：图集的行；春天是白色花瓣）并乘上季节色
    const G = SEASON_GROUND[season], tintG = new THREE.Color(...G.tint);
    const setLeaves = (mesh, list, n, rows = G.rows, tint = tintG, size = 1) => {
      mesh.count = Math.min(n, list.length);
      const cell = mesh.geometry.attributes.aCell.array;
      for (let i = 0; i < mesh.count; i++) {
        const [x, y, z, rot, s, v] = list[i];
        const row = rows[Math.floor(v * rows.length)], el = LEAF_CARDS[row][Math.floor(fr(v * 97.3) * 5)];
        const [u0, v0, u1, v1] = el.uv; cell.set([u0, v0, u1 - u0, v1 - v0], i * 4);
        dummy.position.set(x, y, z); dummy.rotation.set(rand(-.15, .15), rot, rand(-.15, .15));
        dummy.scale.setScalar(.2 * s * G.scale * size); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, c.copy(tint).multiplyScalar(.85 + fr(v * 31.7) * .3));
      }
      mesh.instanceMatrix.needsUpdate = true; mesh.geometry.attributes.aCell.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    setLeaves(groundLeaves, groundLeafPos, G.n);
    // 水面上漂着的几片：新落的鲜亮枫叶和花瓣（不是地上那种褪色的枯叶），比地上的大一些，一眼看得见
    setLeaves(floatLeaves, floatPos, 99, season === 'spring' ? [2] : [0, 1, 1, 2], new THREE.Color(1, 1, 1), 1.9);
  }

  return { under, above, flySpots, setSeason, dressFoxes, reflSkip: [tufts] };   // reflSkip：水面倒影里不画（贴地的矮草在倒影里看不见，却要多画几万个）
}
