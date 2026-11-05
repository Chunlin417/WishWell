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
export function floorH(x, z) {
  const k = poolK(x, z);
  const s = Math.pow(sstep(.35, 1.1, k), .55);
  let y = lerp(-2.8, .3, s);
  y += (fbm3(x * .55, 0, z * .55, 4) - .5) * lerp(.25, .35, s);
  if (k > 1.1) y += (k - 1.1) * .5 + (fbm3(x * .3, 5, z * .3, 3) - .5) * .6 * clamp(k - 1.1);
  // 石圈以内保证在水下，不露出发白的浅滩
  return Math.min(y, -.06 + sstep(.94, 1.06, k) * .45);
}

// 草地覆盖：石圈外几乎都长草，夹杂少量稀疏处
function grassMask(x, z, y) {
  if (y < .03) return 0;
  let m = sstep(1.0, 1.07, poolK(x, z));
  m *= sstep(14, 12, Math.max(Math.abs(x), Math.abs(z)));   // 草地网格边缘淡出，不留硬边
  m *= lerp(.55, 1, sstep(.3, .58, fbm3(x * .45, 3, z * .45, 3)));
  return m * lerp(.12, 1, sstep(.3, .42, fbm3(x * .32 + 40, 1, z * .32, 3)));   // 零星几块裸土
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

const SEASON_GRASS = {
  spring: [.38, .6, .2], summer: [.3, .54, .16], autumn: [.38, .52, .18], winter: [.46, .44, .3],
};
const SEASON_FERN = {
  spring: [.32, .56, .17], summer: [.24, .48, .14], autumn: [.3, .46, .15], winter: [.34, .32, .18],
};
// 草坪：a 深一些的绿、b 浅一些的绿（两者按大小色块交错），moss 石头脚下的苔藓色
const SEASON_LAWN = {
  spring: { a: [.3, .46, .15], b: [.45, .6, .22], moss: [.26, .4, .12] },
  summer: { a: [.22, .38, .1], b: [.35, .52, .16], moss: [.2, .34, .1] },
  autumn: { a: [.3, .38, .13], b: [.46, .5, .2], moss: [.28, .44, .13] },
  winter: { a: [.36, .34, .2], b: [.48, .44, .28], moss: [.26, .3, .15] },
};
const SEASON_IRIS = {
  spring: [.34, .56, .2], summer: [.26, .5, .15], autumn: [.36, .5, .18], winter: [.44, .4, .26],
};
const SEASON_HOSTA = {   // null = 冬天地上部分枯掉
  spring: [.38, .6, .24], summer: [.22, .44, .16], autumn: [.62, .55, .22], winter: null,
};
const SEASON_FLOWERS = {
  // 只有零星几簇白色小花
  spring: { n: 110, colors: [[.96, .96, .92]] },
  summer: { n: 90, colors: [[.96, .96, .92]] },
  autumn: { n: 70, colors: [[.96, .96, .92]] },
  winter: { n: 0, colors: [[1, 1, 1]] },
};
const SEASON_WEED = {   // 石脚下的阔叶小草：鲜绿
  spring: [.42, .68, .22], summer: [.33, .6, .17], autumn: [.4, .6, .19], winter: [.34, .38, .2],
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

export function buildPool(scene, { grassCount = 3000, tex }) {
  const R = rng(20261105);
  const rand = (a, b) => a + R() * (b - a);
  const under = [], above = [];
  const dummy = new THREE.Object3D(), c = new THREE.Color();

  // ---------- 地形 ----------
  const SIZE = 32, SEG = 280;
  const gGeo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  gGeo.rotateX(-Math.PI / 2);
  const gp = gGeo.attributes.position, gc = new Float32Array(gp.count * 3), gl = new Float32Array(gp.count * 2);
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), y = floorH(x, z);
    gp.setY(i, y);
    const k = poolK(x, z), n = fbm3(x * 1.3, 2, z * 1.3, 3), n2 = noise3(x * 6, 1, z * 6);
    // 顶点色是乘在贴图上的明暗 / 色调
    let c;
    if (y < -.02) {
      c = [1, 1, 1].map(v => v * lerp(.85, 1.1, n));
      c = mixA(c, [.62, .64, .6], sstep(-.4, -1.2, y) * .6);    // 深处有沉积物，偏暗
    } else if (y < .12) {
      c = [.7, .66, .6];                                         // 湿岸
    } else {
      // 大块的深浅变化：苔藓绿地、湿润的深色土、干一些的浅色土交错，不再大片平铺
      const big = fbm3(x * .35, 9, z * .35, 3), wetP = fbm3(x * .6, 4, z * .6, 3);
      c = mixA([.9, .84, .78], [.62, .85, .45], sstep(.38, .6, n * .6 + big * .6));   // 苔绿
      c = mixA(c, [.62, .58, .55], sstep(.55, .7, wetP) * .7);                        // 湿土偏暗
      c = mixA(c, [.58, .78, .42], sstep(1.15, 1.0, k) * .6);                         // 石头脚下更绿
      c = c.map(v => v * lerp(.82, 1.08, n2));
      // 草坪的颜色由着色器画，这里只留轻微的明暗起伏
      c = mixA(c, [1, 1, 1].map(v => v * lerp(.9, 1.06, n2)), grassMask(x, z, y));
    }
    gc[i * 3] = c[0]; gc[i * 3 + 1] = c[1]; gc[i * 3 + 2] = c[2];
    gl[i * 2] = grassMask(x, z, y); gl[i * 2 + 1] = mossMask(x, z);
  }
  gGeo.setAttribute('color', new THREE.BufferAttribute(gc, 3));
  gGeo.setAttribute('aLawn', new THREE.BufferAttribute(gl, 2));
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: .6 }),
    { tex: { mode: 'ground', sets: [tex.pebbles, tex.ground], scale: [.75, .4] } }));
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
    if (k < .5 || (k < .72 && R() < .7)) continue;    // 池心太深看不见，石子集中在靠岸的浅水区
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

  // ---------- 草丛：一簇簇高一点的草，石头附近密，远处零星 ----------
  const bladeH = .4, bg = new THREE.PlaneGeometry(.055, bladeH, 1, 4);   // 细软的草叶
  bg.translate(0, bladeH / 2, 0);
  { const p = bg.attributes.position, nr = bg.attributes.normal;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / bladeH; p.setX(i, p.getX(i) * (1 - t * .85)); p.setZ(i, t * t * .16); nr.setXYZ(i, 0, 1, 0); } }
  const grass = new THREE.InstancedMesh(bg, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .75 }), { grass: true, underwater: false }), grassCount);
  const grassVar = [];
  const gauss = () => (R() + R() + R() - 1.5) / 1.5;
  for (let n = 0, tries = 0; n < grassCount && tries < 40000; tries++) {
    const th = rand(0, Math.PI * 2), k = 1 + Math.pow(R(), 2.4) * 1.7, r = Rb(th) * k;   // 越靠近石圈越密
    const cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    if (floorH(cx, cz) < .06) continue;
    if (fbm3(cx * .6, 7, cz * .6, 3) < .4 + R() * .1) continue;
    if (nearFox(cx, cz)) continue;
    if (rocks.some(o => Math.hypot(o.x - cx, o.z - cz) < o.r * .75)) continue;
    const m = 14 + Math.floor(R() * 24), spread = rand(.08, .18), tall = rand(.6, 1.1) * (k < 1.3 ? 1.1 : 1);
    for (let j = 0; j < m && n < grassCount; j++) {
      const x = cx + gauss() * spread, z = cz + gauss() * spread, y = floorH(x, z);
      if (y < .06) continue;
      const lean = Math.hypot(x - cx, z - cz) / spread;
      dummy.position.set(x, y - .02, z);
      dummy.rotation.set(rand(-.35, .35) * (1 + lean), rand(0, 6.28), rand(-.35, .35) * (1 + lean));
      dummy.scale.set(rand(.8, 1.2), tall * rand(.6, 1.2) * (1.2 - lean * .4), 1);
      dummy.updateMatrix(); grass.setMatrixAt(n, dummy.matrix);
      grassVar.push([rand(.75, 1.15), rand(-.06, .06)]);
      n++; grass.count = n;
    }
  }
  grass.receiveShadow = true;
  scene.add(grass); above.push(grass);

  // ---------- 蕨类：长在石头外侧 ----------
  const fernGeo = makeFern();
  const FN = 56, fernVar = [];
  const ferns = new THREE.InstancedMesh(fernGeo, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .8 }),
    { grass: true, underwater: false }), FN);
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

  // ---------- 菖蒲：长在石缝和水边，细长的剑形叶，打破石圈的圆形轮廓 ----------
  const irisH = .85, ig = new THREE.PlaneGeometry(.045, irisH, 1, 6);
  ig.translate(0, irisH / 2, 0);
  { const p = ig.attributes.position, nr = ig.attributes.normal;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / irisH; p.setX(i, p.getX(i) * (1 - t * .9)); p.setZ(i, t * t * .16); nr.setXYZ(i, 0, 1, 0); } }
  const IN = 220, irisVar = [];
  const iris = new THREE.InstancedMesh(ig, patch(new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: .6 }),
    { grass: true, grassH: irisH }), IN);
  for (let n = 0, cl = 0, tries = 0; cl < 5 && tries < 2000; tries++) {   // 水边只零星几丛
    const th = rand(0, Math.PI * 2), r = Rb(th) * rand(.94, 1.02), cx = Math.cos(th) * r, cz = Math.sin(th) * r;
    cl++;
    const m = 6 + Math.floor(R() * 5), tall = rand(.45, .7);
    for (let j = 0; j < m && n < IN; j++) {
      const x = cx + gauss() * .06, z = cz + gauss() * .06;
      dummy.position.set(x, Math.max(floorH(x, z), -.25) - .02, z);
      dummy.rotation.set(rand(-.32, .32), rand(0, 6.28), rand(-.32, .32));
      dummy.scale.set(1, tall * rand(.65, 1.15), 1);
      dummy.updateMatrix(); iris.setMatrixAt(n, dummy.matrix);
      irisVar.push(rand(.85, 1.12));
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
  const SPN = 45;
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
    const g = SEASON_GRASS[season];
    for (let i = 0; i < grass.count; i++) {
      const [b, h] = grassVar[i];
      grass.setColorAt(i, srgb(g[0] * b + h, g[1] * b, g[2] * b - h * .5));
    }
    grass.instanceColor.needsUpdate = true;
    const f = SEASON_FERN[season];
    for (let i = 0; i < ferns.count; i++) ferns.setColorAt(i, srgb(...f.map(v => v * fernVar[i])));
    ferns.instanceColor.needsUpdate = true;
    // 草坪的颜色
    const lw = SEASON_LAWN[season];
    shared.uLawnA.value.copy(srgb(...lw.a)); shared.uLawnB.value.copy(srgb(...lw.b)); shared.uLawnMoss.value.copy(srgb(...lw.moss));
    const wd = SEASON_WEED[season];
    for (let i = 0; i < weeds.count; i++) { const [b, h] = weedVar[i]; weeds.setColorAt(i, srgb(wd[0] * b + h, wd[1] * b, wd[2] * b)); }
    weeds.instanceColor.needsUpdate = true;
    const ir = SEASON_IRIS[season];
    for (let i = 0; i < iris.count; i++) iris.setColorAt(i, srgb(...ir.map(v => v * irisVar[i])));
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
