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

// 草地覆盖：石圈外几乎都长草，夹杂少量稀疏处
function grassMask(x, z, y) {
  if (y < .03) return 0;
  let m = sstep(1.0, 1.07, poolK(x, z));
  m *= sstep(14, 12, Math.max(Math.abs(x), Math.abs(z)));   // 草地网格边缘淡出，不留硬边
  m *= lerp(.55, 1, sstep(.3, .58, fbm3(x * .45, 3, z * .45, 3)));
  return m * lerp(.45, 1, sstep(.2, .34, fbm3(x * .45 + 40, 1, z * .45, 3)));   // 零星几小块草比较稀的地方，边缘柔和
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
  return sstep(.66, .78, b) * (1 - moss);
}

// 苔藓：靠近石圈一圈，再加零星成片
const mossMask = (x, z) => Math.max(sstep(1.32, 1.05, poolK(x, z)), sstep(.62, .74, fbm3(x * .7, 11, z * .7, 3)) * .8);

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
  spring: [.38, .6, .2], summer: [.3, .54, .16], autumn: [.34, .52, .17], winter: [.27, .43, .2],
};
const SEASON_FERN = {
  spring: [.32, .56, .17], summer: [.24, .48, .14], autumn: [.27, .47, .14], winter: [.22, .39, .16],
};
// 草坪：a 深一些的绿、b 浅一些的绿（两者按大小色块交错），moss 石头脚下的苔藓色
const SEASON_LAWN = {
  spring: { a: [.3, .46, .15], b: [.45, .6, .22], moss: [.26, .4, .12] },
  summer: { a: [.22, .38, .1], b: [.35, .52, .16], moss: [.2, .34, .1] },
  autumn: { a: [.25, .38, .11], b: [.38, .51, .17], moss: [.22, .37, .1] },
  winter: { a: [.2, .32, .13], b: [.31, .43, .19], moss: [.18, .31, .11] },
};
const SEASON_IRIS = {
  spring: [.34, .56, .2], summer: [.26, .5, .15], autumn: [.3, .5, .16], winter: [.25, .41, .18],
};
const SEASON_HOSTA = {   // 秋天发黄是点缀；冬天保留成深绿，石头脚下不会突然空出一块（null = 地上部分枯掉，现在不用）
  spring: [.38, .6, .24], summer: [.22, .44, .16], autumn: [.56, .54, .2], winter: [.2, .35, .15],
};
const SEASON_FLOWERS = {
  // 只有零星几簇白色小花
  spring: { n: 110, colors: [[.96, .96, .92]] },
  summer: { n: 90, colors: [[.96, .96, .92]] },
  autumn: { n: 70, colors: [[.96, .96, .92]] },
  winter: { n: 0, colors: [[1, 1, 1]] },
};
const SEASON_WEED = {   // 石脚下的阔叶小草：鲜绿
  spring: [.42, .68, .22], summer: [.33, .6, .17], autumn: [.36, .58, .18], winter: [.26, .44, .18],
};
const SEASON_RED = {   // 红叶小植物
  spring: [.42, .2, .14], summer: [.38, .17, .12], autumn: [.55, .16, .08], winter: [.3, .17, .11],
};
const SEASON_GROUND = {
  spring: { n: 30, scale: .4, colors: [[.95, .78, .82], [.92, .7, .76], [.98, .88, .88]] },
  summer: { n: 10, scale: 1, colors: [[.45, .38, .2], [.3, .42, .15]] },
  autumn: { n: 40, scale: .85, colors: [[.6, .18, .07], [.68, .3, .1], [.5, .2, .1], [.42, .26, .13]] },   // 只在石头边上零星几片
  winter: { n: 30, scale: 1, colors: [[.36, .26, .16], [.3, .22, .14], [.42, .32, .2]] },
};

// 枫叶：五个尖尖的裂片，边缘有小锯齿，底部一小段叶柄；平放在地上，略微卷翘
function makeMaple() {
  const s = new THREE.Shape(), N = 90;
  for (let i = 0; i <= N; i++) {
    const th = i / N * Math.PI * 2 - Math.PI / 2;   // 从正下方开始绕一圈
    const lobe = Math.pow(.5 + .5 * Math.cos(5 * (th - Math.PI / 2)), 3);
    const teeth = Math.pow(.5 + .5 * Math.cos(25 * th), 6) * .12;
    const notch = 1 - .55 * Math.exp(-(((th + Math.PI / 2) / .35) ** 2));   // 叶柄处的凹口
    const r = (.035 + .075 * lobe + .012 * teeth) * notch;
    const x = Math.cos(th) * r, y = Math.sin(th) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const blade = new THREE.ShapeGeometry(s, 1);
  const stem = new THREE.PlaneGeometry(.006, .045); stem.translate(0, -.04, 0);
  const g = mergeGeometries([blade, stem]);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, (x * x + z * z) * 1.4); }
  g.computeVertexNormals();
  return g;
}
// 草的图集（public/textures/grass_atlas.webp，由 scripts/pack_grass_atlas.py 生成，数值是它打印出来的）
// uv：在图集里的范围 [u0, v0, u1, v1]；aspect：宽 / 高；mean：平均色（线性）
export const GRASS_CARDS = {
  short: { uv: [0.0469, 0.5000, 0.4531, 0.7681], aspect: 1.515, mean: [0.1380, 0.1998, 0.0457] },
  medium: { uv: [0.5469, 0.5000, 0.9531, 0.8853], aspect: 1.054, mean: [0.1871, 0.2333, 0.0769] },
  tall: { uv: [0.0527, 0.0000, 0.4468, 0.4668], aspect: 0.844, mean: [0.2089, 0.2075, 0.0852] },
  sedge: { uv: [0.5469, 0.0000, 0.9531, 0.4287], aspect: 0.948, mean: [0.1455, 0.2047, 0.0682] },
};
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

// 春天的花瓣：小小的椭圆
function makePetal() {
  const s = new THREE.Shape();
  s.moveTo(0, -.1); s.quadraticCurveTo(.075, -.02, 0, .12); s.quadraticCurveTo(-.075, -.02, 0, -.1);
  const g = new THREE.ShapeGeometry(s, 8); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, p.getX(i) ** 2 * 1.5);
  g.computeVertexNormals();
  return g;
}

// 阔叶小草：7 片椭圆小叶从中心斜向上张开，叶片沿中脉微微对折
function makeWeed() {
  const leaves = [];
  for (let k = 0; k < 7; k++) {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(.055, .03, .06, .12, 0, .17); s.bezierCurveTo(-.06, .12, -.055, .03, 0, 0);
    const g = new THREE.ShapeGeometry(s, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), d = p.getY(i);
      p.setXYZ(i, x, d * .75 - d * d * 1.6 + Math.abs(x) * .45, d);   // 斜向上拱起，叶缘略翘
    }
    g.computeVertexNormals();
    const tilt = Math.random() * .35;
    g.rotateX(-tilt);
    g.rotateY(k / 7 * Math.PI * 2 + Math.random() * .5);
    g.scale(1, 1, .8 + Math.random() * .45);
    leaves.push(g);
  }
  return mergeGeometries(leaves);
}

// 玉簪：9 片宽大的心形叶，从中心向外拱起再下垂
function makeHosta() {
  const leaves = [];
  for (let k = 0; k < 9; k++) {
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.bezierCurveTo(.13, .06, .14, .24, 0, .34); s.bezierCurveTo(-.14, .24, -.13, .06, 0, 0);
    const g = new THREE.ShapeGeometry(s, 10);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), d = p.getY(i);           // d：沿叶片的距离
      p.setXYZ(i, x, d * 1.1 - d * d * 2.6 - x * x * 1.5 + .04, d);   // 先向上拱，再下垂；叶面中间略凹
    }
    g.computeVertexNormals();
    g.rotateX(-.15 + Math.random() * .2);
    g.rotateY(k / 9 * Math.PI * 2 + Math.random() * .3);
    g.scale(1, 1, .85 + Math.random() * .3);
    leaves.push(g);
  }
  return mergeGeometries(leaves);
}

// 蕨：7 片拱形羽叶，每片两侧排着逐渐变小的小叶
function makeFern() {
  const fronds = [];
  for (let f = 0; f < 7; f++) {
    const pos = [], L = .55, n = 18;
    const P = t => [0, Math.sin(t * Math.PI * .75) * .22, t * L];
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
      const a = P(t0), b = P(t1), len = .11 * Math.sin(Math.PI * (tm * .85 + .08));
      for (const side of [-1, 1]) {
        const tip = [side * len, P(tm)[1] - len * .2, P(tm)[2] + len * .35];
        pos.push(...a, ...b, ...tip);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => i % 3 === 1 ? 1 : 0), 3));
    g.rotateX(-.25 - Math.random() * .2);   // 羽叶向上翘
    g.rotateY(f / 7 * Math.PI * 2 + Math.random() * .4);
    g.scale(1, 1, .8 + Math.random() * .4);
    fronds.push(g);
  }
  return mergeGeometries(fronds);
}

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
    { tex: { mode: 'ground', sets: [tex.pebbles], ground: tex.ground, scale: [.75, .4] } }));
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- 围池石块 ----------
  const rockMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: .55 }),
    { tex: { mode: 'rock', sets: [tex.rock, tex.moss], scale: [.6, .7], gray: .9, bright: .95, soft: .45, tint: [.95, .98, 1.02], crack: .55 } });   // 冷灰色花岗岩，带裂纹
  const geos = Array.from({ length: 6 }, (_, i) => makeRockGeo(i * 13.7 + 1.3, 4));
  const rocks = [];
  const place = (x, z, s, sx, sy, sz, sink) => {
    if (poolK(x, z) > 1.08 && Math.abs(z - FOX_Z) < 1.1 && Math.abs(x) > 4.4) return;   // 给两侧的石狐让位
    const m = new THREE.Mesh(geos[Math.floor(R() * geos.length)], rockMat);
    m.scale.set(s * sx, s * sy, s * sz);
    m.rotation.set(rand(-.15, .15), rand(0, Math.PI * 2), rand(-.15, .15));
    m.position.set(x, floorH(x, z) + s * sy * sink, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    rocks.push({ x, z, r: s * Math.max(sx, sz) });
  };
  // 主石圈：大小拉开（约三成是大石头）
  const N = 26;
  for (let i = 0; i < N; i++) {
    const th = i / N * Math.PI * 2 + rand(-.05, .05), r = Rb(th) * rand(.97, 1.07);
    const s = R() < .3 ? rand(.75, 1) : rand(.42, .72);
    place(Math.cos(th) * r, Math.sin(th) * r, s, rand(1.1, 1.5), rand(.55, .85), rand(.85, 1.15), rand(.05, .25));
  }
  // 外圈零星大石
  for (let i = 0; i < 14; i++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.12, 1.3);
    place(Math.cos(th) * r, Math.sin(th) * r, rand(.35, .6), rand(1, 1.4), rand(.5, .8), rand(.9, 1.2), rand(0, .2));
  }
  // 缝隙填充：贴着石圈一圈中小石块，堵住大石之间的空隙
  for (let i = 0; i < 40; i++) {
    const th = i / 40 * Math.PI * 2 + rand(-.08, .08), r = Rb(th) * rand(.98, 1.05);
    place(Math.cos(th) * r, Math.sin(th) * r, rand(.18, .36), rand(1, 1.5), rand(.5, .8), rand(.8, 1.2), .15);
  }
  // 零散碎石
  for (let i = 0; i < 24; i++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 1.3);
    place(Math.cos(th) * r, Math.sin(th) * r, rand(.08, .2), rand(1, 1.5), rand(.5, .8), rand(.8, 1.2), .2);
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
    const s = rand(.08, .15) * (1 + Math.pow(R(), 4) * 1.2);
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

  // 两侧石狐的位置附近不种高的植物
  const nearFox = (x, z) => poolK(x, z) > 1.08 && Math.abs(z - FOX_Z) < 1 && Math.abs(x) > 4.4;

  // ---------- 草丛：一簇簇高一点的草（交叉面片），石头附近密，远处零星；偶尔夹一丛带草穗的高草 ----------
  const cardMat = (h, sway, underwater = false) => patch(new THREE.MeshStandardMaterial({ map: tex.grass, alphaTest: .5, side: THREE.DoubleSide, roughness: .8 }),
    { grass: true, grassH: h, sway, upNormal: true, card: true, underwater });
  const clusters = Math.round(grassCount / 22);   // grassCount 原来是草叶数，一丛约 22 片
  const grass = new THREE.InstancedMesh(makeCard(GRASS_CARDS.medium, MED_H, 3, 11), cardMat(MED_H, 1), clusters * 2);
  const grassTall = new THREE.InstancedMesh(makeCard(GRASS_CARDS.tall, TALL_H, 2, 12), cardMat(TALL_H, 1.3), clusters);
  const grassVar = [], tallVar = [];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  for (let cl = 0, tries = 0; cl < clusters && tries < 40000; tries++) {
    const th = rand(0, Math.PI * 2), k = 1 + Math.pow(R(), 2.4) * 1.7, r = Rb(th) * k;   // 越靠近石圈越密
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    if (floorH(cx, cz) < .06) continue;
    if (fbm3(cx * .6, 7, cz * .6, 3) < .4 + R() * .1) continue;
    if (nearFox(cx, cz)) continue;
    if (rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .75)) continue;
    const far = k > 1.45;
    if (far && R() < .75) continue;                      // 远处的草丛少一些、矮一些
    cl++;
    const tall = rand(.7, 1.15) * (k < 1.3 ? 1.1 : far ? .75 : 1);
    const m = 1 + (R() < .55 ? 1 : 0);
    for (let j = 0; j < m; j++) {
      const x = cx + gauss() * .08, z = cz + gauss() * .08, y = floorH(x, z);
      if (y < .06) continue;
      dummy.position.set(x, y - .02, z);
      dummy.rotation.set(rand(-.12, .12), rand(0, 6.28), rand(-.12, .12));
      const s = tall * rand(.8, 1.15);
      dummy.scale.set(s * rand(.85, 1.15), s, s * rand(.85, 1.15));
      dummy.updateMatrix(); grass.setMatrixAt(grassVar.length, dummy.matrix);
      grassVar.push(rand(.88, 1.12) * (far ? 1.05 : 1));
    }
    if (R() < .22) {   // 带草穗的高草，从草丛里冒出来
      const x = cx + gauss() * .05, z = cz + gauss() * .05, y = floorH(x, z);
      dummy.position.set(x, y - .02, z);
      dummy.rotation.set(rand(-.08, .08), rand(0, 6.28), rand(-.08, .08));
      dummy.scale.setScalar(rand(.8, 1.15) * (far ? .8 : 1));
      dummy.updateMatrix(); grassTall.setMatrixAt(tallVar.length, dummy.matrix);
      tallVar.push(rand(.9, 1.1));
    }
  }
  grass.count = grassVar.length; grassTall.count = tallVar.length;
  for (const g of [grass, grassTall]) { g.receiveShadow = g.castShadow = true; scene.add(g); above.push(g); }

  // ---------- 矮草簇：铺满整片草地，跟着着色器画的草坪走（露土处不长，土包上稀而黄，远处稀一些） ----------
  const tufts = new THREE.InstancedMesh(makeCard(GRASS_CARDS.short, TUFT_H, 2, 13), cardMat(TUFT_H, .35), tuftCount);
  const tuftVar = [];   // [深浅绿的比例, 干燥度, 苔藓程度, 亮度]
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
    cover *= 1 - lawnBare(cx, cz, dry, moss) * .95;
    if (R() > cover * cover * (1 - dry * .35)) continue;
    if (nearFox(cx, cz) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .8)) continue;
    // 每处 1～3 簇挤在一起，不是均匀撒点
    const m = 1 + Math.floor(R() * 3);
    const ln = vnoise(cx * .35, cz * .35) * .55 + vnoise(cx * 1.6, cz * 1.6) * .3 + vnoise(cx * 5, cz * 5) * .15;
    for (let j = 0; j < m && n < tuftCount; j++) {
      const x = cx + gauss() * .09, z = cz + gauss() * .09, y = floorH(x, z);
      if (y < .04) continue;
      dummy.position.set(x, y - .01, z);
      dummy.rotation.set(rand(-.15, .15), rand(0, 6.28), rand(-.15, .15));
      const s = rand(.75, 1.25) * (1 - dry * .3) * lerp(.8, 1.1, cover);
      dummy.scale.set(s * rand(.85, 1.2), s, s * rand(.85, 1.2));
      dummy.updateMatrix(); tufts.setMatrixAt(n, dummy.matrix);
      tuftVar.push([clamp(sstep(.25, .75, ln) + rand(-.2, .2)), dry, moss, rand(.85, 1.12)]);
      n++; tufts.count = n;
    }
  }
  tufts.receiveShadow = true;
  scene.add(tufts); above.push(tufts);

  // ---------- 蕨类：长在石头外侧 ----------
  const fernGeo = makeFern();
  const FN = 56, fernVar = [];
  const ferns = new THREE.InstancedMesh(fernGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .8 }),
    { grass: true, upNormal: true, underwater: false }), FN);
  for (let i = 0, tries = 0; i < FN && tries < 5000; tries++) {
    const o = rocks[Math.floor(R() * Math.min(rocks.length, 40))];   // 只挨着大石头
    const out = Math.atan2(o.z, o.x) + rand(-.9, .9);                 // 朝池外一侧
    const x = o.x + Math.cos(out) * o.r * rand(.8, 1.2), z = o.z + Math.sin(out) * o.r * rand(.8, 1.2);
    const y = floorH(x, z);
    if (y < .06 || poolK(x, z) < 1.03 || nearFox(x, z)) continue;
    dummy.position.set(x, y - .02, z);
    dummy.rotation.set(rand(-.1, .1), rand(0, 6.28), rand(-.1, .1));
    dummy.scale.setScalar(rand(.5, .85));
    dummy.updateMatrix(); ferns.setMatrixAt(i, dummy.matrix);
    fernVar.push(rand(.8, 1.15));
    i++; ferns.count = i;
  }
  ferns.receiveShadow = true; ferns.castShadow = true;
  scene.add(ferns); above.push(ferns);

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

  // ---------- 玉簪（绿）和红叶小植物：宽叶的矮丛，散在石圈外侧 ----------
  const hostaGeo = makeHosta();
  const HN = 16, hostaVar = [];
  const hostas = new THREE.InstancedMesh(hostaGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .5 }),
    { grass: true, grassH: .5, underwater: false }), HN);
  for (let i = 0, tries = 0; i < HN && tries < 3000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.1, 1.4), x = Math.cos(th) * r, z = Math.sin(th) * r, y = floorH(x, z);
    if (y < .06 || nearFox(x, z)) continue;
    if (rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .9)) continue;
    dummy.position.set(x, y - .01, z);
    dummy.rotation.set(0, rand(0, 6.28), 0);
    dummy.scale.setScalar(rand(.85, 1.35));
    dummy.updateMatrix(); hostas.setMatrixAt(i, dummy.matrix);
    hostaVar.push(rand(.85, 1.12));
    i++; hostas.count = i;
  }
  hostas.receiveShadow = true; hostas.castShadow = true;
  scene.add(hostas); above.push(hostas);
  const hostaN = hostas.count;

  // ---------- 石脚下的阔叶小草：一丛丛低矮的椭圆叶片，塞满石头之间和石头脚下 ----------
  const weedGeo = makeWeed();
  const WN = 420, weedVar = [];
  const weeds = new THREE.InstancedMesh(weedGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .6 }),
    { grass: true, grassH: .14, underwater: false }), WN);
  const ringRocks = rocks.filter(o => poolK(o.x, o.z) < 1.35);
  for (let i = 0, tries = 0; i < WN && tries < 12000; tries++) {
    const o = ringRocks[Math.floor(R() * ringRocks.length)];
    const a = Math.atan2(o.z, o.x) + gauss() * 1.6, d = o.r * rand(.6, 1.15);   // 多数长在石头朝外的一侧
    const x = o.x + Math.cos(a) * d, z = o.z + Math.sin(a) * d, y = floorH(x, z);
    if (y < .03 || poolK(x, z) < 1.0 || nearFox(x, z)) continue;
    if (rocks.some(q => Math.hypot(q.x - x, q.z - z) < q.r * .5)) continue;
    dummy.position.set(x, y - .01, z);
    dummy.rotation.set(rand(-.15, .15), rand(0, 6.28), rand(-.15, .15));
    dummy.scale.setScalar(rand(.9, 1.6));
    dummy.updateMatrix(); weeds.setMatrixAt(i, dummy.matrix);
    weedVar.push([rand(.85, 1.15), rand(-.05, .05)]);
    i++; weeds.count = i;
  }
  weeds.receiveShadow = true; weeds.castShadow = true;
  scene.add(weeds); above.push(weeds);

  const RN = 12, redVar = [];
  const reds = new THREE.InstancedMesh(hostaGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .55 }),
    { grass: true, grassH: .5, underwater: false }), RN);
  for (let i = 0, tries = 0; i < RN && tries < 4000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.04, 1.22), x = Math.cos(th) * r, z = Math.sin(th) * r, y = floorH(x, z);
    if (y < .06 || nearFox(x, z) || rocks.some(o => Math.hypot(o.x - x, o.z - z) < o.r * .8)) continue;
    dummy.position.set(x, y - .01, z);
    dummy.rotation.set(0, rand(0, 6.28), 0);
    dummy.scale.set(rand(.28, .42), rand(.25, .4), rand(.28, .42));
    dummy.updateMatrix(); reds.setMatrixAt(i, dummy.matrix);
    redVar.push(rand(.8, 1.15));
    i++; reds.count = i;
  }
  reds.receiveShadow = true;
  scene.add(reds); above.push(reds);
  const redN = reds.count;

  // ---------- 草地里的小石子 ----------
  const SPN = 18;
  const smallStones = new THREE.InstancedMesh(pg, patch(new THREE.MeshStandardMaterial({ roughness: 1, envMapIntensity: .5 }),
    { underwater: false, tex: { mode: 'single', sets: [tex.rock], scale: [2.5, 2.5], gray: .7, bright: 2.4 } }), SPN);
  for (let i = 0, tries = 0; i < SPN && tries < 3000; tries++) {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.15, 2.6), x = Math.cos(th) * r, z = Math.sin(th) * r, y = floorH(x, z);
    if (y < .06 || nearFox(x, z)) continue;
    const s = rand(.06, .16);
    dummy.position.set(x, y + s * .1, z);
    dummy.scale.set(s * rand(1, 1.5), s * rand(.45, .7), s * rand(.8, 1.2));
    dummy.rotation.set(rand(-.2, .2), rand(0, 6.28), rand(-.2, .2));
    dummy.updateMatrix(); smallStones.setMatrixAt(i, dummy.matrix);
    smallStones.setColorAt(i, c.setHSL(rand(.07, .11), rand(.01, .05), rand(.75, .95), THREE.SRGBColorSpace));
    i++; smallStones.count = i;
  }
  smallStones.receiveShadow = true; smallStones.castShadow = true;
  scene.add(smallStones); above.push(smallStones);

  // ---------- 小野花：一小簇一小簇地开在草地里，以白色为主 ----------
  const fl = new THREE.Shape();
  for (let p = 0; p < 5; p++) {
    const a = p / 5 * Math.PI * 2, b = a + Math.PI / 5;
    const fn = p === 0 ? 'moveTo' : 'lineTo';
    fl[fn](Math.cos(a) * .04, Math.sin(a) * .04);
    fl.quadraticCurveTo(Math.cos(b) * .05, Math.sin(b) * .05, Math.cos(a + Math.PI * 2 / 5) * .04 * .35, Math.sin(a + Math.PI * 2 / 5) * .04 * .35);
  }
  const flowerGeo = new THREE.ShapeGeometry(fl, 4); flowerGeo.rotateX(-Math.PI / 2);
  const FLN = 120, flowerPos = [];
  const flowers = new THREE.InstancedMesh(flowerGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .6 }),
    { underwater: false }), FLN);
  for (let tries = 0; flowerPos.length < FLN && tries < 30000; tries++) {
    let cx = rand(-10, 10), cz = rand(-10, 10);
    if (R() < .5) {   // 一半开在石头脚下的草丛里
      const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.08, 1.35);
      cx = Math.cos(th) * r; cz = Math.sin(th) * r;
    }
    const y = floorH(cx, cz);
    if (grassMask(cx, cz, y) < .5 || nearFox(cx, cz) || rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .8)) continue;
    const m = 3 + Math.floor(R() * 6);
    for (let j = 0; j < m && flowerPos.length < FLN; j++) {
      const x = cx + gauss() * .18, z = cz + gauss() * .18;
      flowerPos.push([x, floorH(x, z) + rand(.06, .14), z, rand(0, 6.28), rand(.7, 1.1), R()]);
    }
  }
  flowers.frustumCulled = false;
  scene.add(flowers); above.push(flowers);

  // 萤火虫出没的位置：草丛边
  const flySpots = Array.from({ length: 30 }, () => {
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(1.05, 1.6), x = Math.cos(th) * r, z = Math.sin(th) * r;
    return new THREE.Vector3(x, Math.max(floorH(x, z), 0) + rand(.3, .9), z);
  });

  // ---------- 地上的落叶：枫叶（春天换成花瓣），大多堆在石头脚下 ----------
  const mapleGeo = makeMaple(), petalGeo = makePetal();
  const GN = 460, groundLeafPos = [];
  const leafMat = patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .8 }), { underwater: false });
  const groundLeaves = new THREE.InstancedMesh(mapleGeo, leafMat, GN);
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
  groundLeaves.receiveShadow = true;
  scene.add(groundLeaves); above.push(groundLeaves);

  function setSeason(season) {
    const gt = cardTint(SEASON_GRASS[season], GRASS_CARDS.medium), gtt = cardTint(SEASON_GRASS[season], GRASS_CARDS.tall);
    for (let i = 0; i < grass.count; i++) grass.setColorAt(i, c.copy(gt).multiplyScalar(grassVar[i]));
    for (let i = 0; i < grassTall.count; i++) grassTall.setColorAt(i, c.copy(gtt).multiplyScalar(tallVar[i]));
    for (const g of [grass, grassTall]) if (g.instanceColor) g.instanceColor.needsUpdate = true;
    const f = SEASON_FERN[season];
    for (let i = 0; i < ferns.count; i++) ferns.setColorAt(i, srgb(...f.map(v => v * fernVar[i])));
    ferns.instanceColor.needsUpdate = true;
    // 草坪的颜色
    const lw = SEASON_LAWN[season];
    shared.uLawnA.value.copy(srgb(...lw.a)); shared.uLawnB.value.copy(srgb(...lw.b)); shared.uLawnMoss.value.copy(srgb(...lw.moss));
    // 矮草簇：和草坪同一套颜色（在线性空间里按同样的方式混合），草尖略亮
    const la = shared.uLawnA.value, lb = shared.uLawnB.value, lm = shared.uLawnMoss.value;
    const gray = (lb.r + lb.g + lb.b) / 3, straw = new THREE.Color(gray * 1.3, gray * 1.12, gray * .66);
    const sm = GRASS_CARDS.short.mean, shortInv = new THREE.Color(.88 / sm[0], .9 / sm[1], .95 / sm[2]);
    for (let i = 0; i < tufts.count; i++) {
      const [t, dry, moss, b] = tuftVar[i];
      c.copy(la).lerp(lb, t).lerp(straw, dry * .3).lerp(lm, moss * .7).multiplyScalar(b);
      tufts.setColorAt(i, c.multiply(shortInv));   // 矮草要和底下的草坪融成一片：平均色直接拉到草坪色
    }
    if (tufts.instanceColor) tufts.instanceColor.needsUpdate = true;
    const wd = SEASON_WEED[season];
    for (let i = 0; i < weeds.count; i++) { const [b, h] = weedVar[i]; weeds.setColorAt(i, srgb(wd[0] * b + h, wd[1] * b, wd[2] * b)); }
    weeds.instanceColor.needsUpdate = true;
    const ir = SEASON_IRIS[season];
    const it = cardTint(ir, GRASS_CARDS.sedge);
    for (let i = 0; i < iris.count; i++) iris.setColorAt(i, c.copy(it).multiplyScalar(irisVar[i]));
    iris.instanceColor.needsUpdate = true;
    // 玉簪冬天地上部分枯掉；红叶植物冬天变暗褐色
    const ho = SEASON_HOSTA[season];
    hostas.count = ho ? hostaN : 0;
    if (ho) { for (let i = 0; i < hostaN; i++) hostas.setColorAt(i, srgb(...ho.map(v => v * hostaVar[i]))); hostas.instanceColor.needsUpdate = true; }
    const rd = SEASON_RED[season];
    for (let i = 0; i < redN; i++) reds.setColorAt(i, srgb(...rd.map(v => v * redVar[i])));
    reds.instanceColor.needsUpdate = true;
    const FS = SEASON_FLOWERS[season];
    flowers.count = Math.min(FS.n, flowerPos.length);
    for (let i = 0; i < flowers.count; i++) {
      const [x, y, z, rot, s, v] = flowerPos[i];
      dummy.position.set(x, y, z); dummy.rotation.set(rand(-.2, .2), rot, rand(-.2, .2));
      dummy.scale.setScalar(s); dummy.updateMatrix(); flowers.setMatrixAt(i, dummy.matrix);
      flowers.setColorAt(i, srgb(...FS.colors[Math.floor(v * FS.colors.length)]));
    }
    flowers.instanceMatrix.needsUpdate = true;
    if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
    // 地上的落叶：秋天最多
    const G = SEASON_GROUND[season];
    groundLeaves.geometry = season === 'spring' ? petalGeo : mapleGeo;
    groundLeaves.count = Math.min(G.n, groundLeafPos.length);
    for (let i = 0; i < groundLeaves.count; i++) {
      const [x, y, z, rot, s, v] = groundLeafPos[i];
      dummy.position.set(x, y, z); dummy.rotation.set(rand(-.15, .15), rot, rand(-.15, .15));
      dummy.scale.setScalar(s * G.scale); dummy.updateMatrix(); groundLeaves.setMatrixAt(i, dummy.matrix);
      groundLeaves.setColorAt(i, srgb(...G.colors[Math.floor(v * G.colors.length)]));
    }
    groundLeaves.instanceMatrix.needsUpdate = true;
    if (groundLeaves.instanceColor) groundLeaves.instanceColor.needsUpdate = true;
  }

  return { under, above, flySpots, setSeason };
}
