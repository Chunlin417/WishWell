// 许愿：点左边的石狐，一阵风送来一张许愿签；写下愿望，字一笔一笔出现在签上；把签拖到水面上松手，它挂着铜钱落进池里，慢慢沉下去；
// 四周渐渐安静下来（光变暗、风停、萤火虫躲起来），池底深处先亮起一对眼睛，
// 青龙从正下方缓缓浮上来，张口衔走许愿签，转身潜回深处。
// 愿望文字不保存、不上传：画到许愿签上之后就只存在于这一次的画面里。
import * as THREE from 'three';
import { patch, shared } from './patch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);

// 时间轴（秒，从投入那一刻算起）
const T = {
  fall: 1.1,      // 从松手的地方落到水面
  float: 1.9,     // 在水面上漂一下，开始下沉
  sunk: 8,        // 沉到预定深度
  dread: 3,       // 四周开始安静、变暗（"屏住呼吸"）
  glowIn: 4,      // 深处的光开始变亮
  dragon: 5.4,    // 龙开始从最深处往上游（还在黑暗里），一路不停地游上来
  arrive: 10.4,   // 龙头游到许愿签正下方（没有停下来：速度只是慢下来）
  take: 10.6,     // 咬住许愿签（嘴只是轻轻一合）
  leave: 10.85,   // 咬住后马上转头：弓起身子，从旁边游回井底
  ripple: 18.8,   // 水面泛起一圈大涟漪（龙完全沉下去之后）
  end: 21.8,
};
const EXIT_V = 3.4, EXIT_TAU = 1.4;   // 离开时的最大速度（米/秒）和加速的快慢
const STOP_Y = -2.1;   // 龙头停住时头骨中心的深度（龙头放大了，吻端伸得更远，所以要比以前再低一点）
const PAPER_W = .24, PAPER_H = .7, STRING = .14, SINK_Y = -.9;

// ---------- 许愿签：红纸、金边，竖排写字（字是一个一个"写"上去的） ----------
const PW = 256, PH = 742;
function paperBackground() {
  const c = document.createElement('canvas'); c.width = PW; c.height = PH;
  const g = c.getContext('2d');
  g.fillStyle = '#9c1d18'; g.fillRect(0, 0, PW, PH);
  // 纸纹：细小的明暗纤维
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,210,190'},${Math.random() * .06})`;
    g.fillRect(Math.random() * PW, Math.random() * PH, 1 + Math.random() * 2, 4 + Math.random() * 14);
  }
  g.strokeStyle = '#d9b25a'; g.lineWidth = 5; g.strokeRect(12, 12, PW - 24, PH - 24);
  g.lineWidth = 1.5; g.strokeRect(22, 22, PW - 44, PH - 44);
  // 顶上的小孔（挂绳的地方）
  g.fillStyle = '#3a0907'; g.beginPath(); g.arc(PW / 2, 46, 9, 0, 7); g.fill();
  return c;
}
// 把签面重画一遍：背景 + 前 prog 个字（prog 带小数：正在写的那个字从淡到浓、从略大到正常，像墨落在纸上）
function drawPaper(g, bg, chars, prog) {
  g.clearRect(0, 0, PW, PH); g.drawImage(bg, 0, 0);
  if (!chars.length) return;
  const perCol = chars.length <= 10 ? 10 : 12, cols = Math.max(1, Math.ceil(chars.length / perCol));
  const size = Math.min(58, Math.floor((PH - 130) / perCol), Math.floor((PW - 60) / cols));
  g.fillStyle = '#f3dc9c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${size}px "STKaiti","KaiTi","Kaiti SC","楷体",serif`;
  const colW = (PW - 60) / cols, top = 84 + size / 2;
  for (let i = 0; i < chars.length && i < prog; i++) {
    const col = Math.floor(i / perCol), row = i % perCol, k = Math.min(1, prog - i);
    const x = PW - 30 - colW * (col + .5), y = top + row * size * 1.04;
    g.save(); g.globalAlpha = k; g.translate(x, y); g.scale(1 + .15 * (1 - k), 1 + .15 * (1 - k)); g.fillText(chars[i], 0, 0); g.restore();
  }
}

function coinGeometry() {
  const s = new THREE.Shape(); s.absarc(0, 0, .05, 0, Math.PI * 2, false);
  const a = .015, hole = new THREE.Path();
  hole.moveTo(-a, -a); hole.lineTo(-a, a); hole.lineTo(a, a); hole.lineTo(a, -a); hole.lineTo(-a, -a);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: .006, bevelEnabled: true, bevelThickness: .003, bevelSize: .003, bevelSegments: 2, curveSegments: 32 });
  g.translate(0, 0, -.003);
  return g;
}

// 柔和的圆形光点（PointsMaterial 默认是方块）
function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// ---------- 龙：一条长长的身躯，沿路径游动（每一节都走过龙头走过的位置），背上一排鳍 ----------
// HS：龙头放大倍数（主视角离水面 11 米，龙头要够大），BS：身体粗细的额外倍数（现在直接由 BODY_R 控制）
const RINGS = 150, SEGS = 14, LEN = 11, HS = 2.2, BS = 1;
const VPR = SEGS + 1;          // 每一圈的顶点数：多一个和第一个重合的点，贴图在接缝处才能连续
const U_REP = 2, V_TILE = 1.1; // 鳞片贴图：绕身体一圈重复 2 次，沿身体每 1.1 米重复一次（鳞片跟着身体走，不会在身上滑动）
const HEAD_TILE = .32;         // 龙头细鳞：每 0.32（头的局部单位）重复一次
const BODY_R = .3;    // 身体的半径（米）：从脖子到接近尾巴一直是这个粗细，直径约 0.6 米，是龙头宽度的一半不到
const NECK_R = .46;   // 紧挨着龙头的地方：半径和龙头后面那块脖子差不多粗，然后在约 2 米内顺滑地收成身体的粗细，接口才不会"脑袋插在一根管子上"
const NECK_DROP = .26;   // 龙头那块脖子的中心比龙头原点低约 0.28 米：身体的中心线要对在脖子的中心上，而不是龙头原点上
function bodyRadius(s) {   // s：0 = 头的中心（埋在头骨里），1 = 尾尖
  const base = lerp(BODY_R, NECK_R, 1 - smooth(s / .18));
  const t = clamp((s - .78) / .22);   // 只有最后 22%（约 2.4 米）才逐渐变细，收成尾尖
  return lerp(base, .02, Math.pow(t, 1.7));
}

// ---------- 龙头：+z 朝前（吻端），+y 朝上，+x 朝右；原点在头骨中心 ----------
function blob(sx, sy, sz, x, y, z) { const g = new THREE.SphereGeometry(1, 20, 14); g.scale(sx, sy, sz); g.translate(x, y, z); return g; }
function taperTube(pts, r0, r1, seg = 16) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, seg, 1, 7, false);
  // TubeGeometry 是等粗的：按沿管的位置把每一圈缩放到 r0 → r1
  const p = g.attributes.position, n = 8, c = new THREE.Vector3();   // 每圈 7 段 + 1 个重复点
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c);
    const r = lerp(r0, r1, i / seg);
    for (let j = 0; j < n; j++) {
      const k = i * n + j;
      p.setXYZ(k, c.x + (p.getX(k) - c.x) * r, c.y + (p.getY(k) - c.y) * r, c.z + (p.getZ(k) - c.z) * r);
    }
  }
  g.computeVertexNormals();
  return g;
}
function cone(r, h, x, y, z, rx, ry) { const g = new THREE.ConeGeometry(r, h, 8); g.translate(0, h / 2, 0); g.rotateX(rx); g.rotateY(ry); g.translate(x, y, z); return g; }
function makeHeadGeometry() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const parts = [
    blob(.21, .17, .3, 0, .02, 0),          // 头骨
    blob(.14, .1, .3, 0, -.01, .3),         // 长吻
    blob(.1, .075, .09, 0, .015, .56),      // 鼻头
    blob(.075, .045, .11, .11, .11, .12),   // 眉骨
    blob(.075, .045, .11, -.11, .11, .12),
  ];
  for (const sd of [1, -1]) {
    // 鹿角一样的龙角：向后上方弯，中间分一个叉
    parts.push(taperTube([V(.08 * sd, .13, -.06), V(.14 * sd, .3, -.28), V(.13 * sd, .42, -.6)], .034, .006));
    parts.push(taperTube([V(.13 * sd, .26, -.24), V(.2 * sd, .34, -.26), V(.26 * sd, .38, -.33)], .018, .004, 8));
    // 腮边的鬃刺，向后外侧张开
    parts.push(cone(.035, .24, .16 * sd, -.02, -.12, -1.9, .5 * sd));
    parts.push(cone(.028, .2, .14 * sd, -.08, -.04, -1.8, .7 * sd));
  }
  parts.push(cone(.03, .2, 0, .15, -.2, -1.2, 0), cone(.026, .18, 0, .12, -.34, -1.35, 0));   // 头顶的鬃
  // 上排牙：沿长吻下沿两侧一排朝下的尖牙，最前面一对獠牙更长
  for (const sd of [1, -1]) {
    for (const z of [.18, .26, .34, .42]) parts.push(cone(.012, .05, sd * (.1 - z * .07), -.085, z, Math.PI, 0));
    parts.push(cone(.017, .09, sd * .055, -.075, .5, Math.PI, 0));
  }
  return mergeGeometries(parts.map(q => { q.deleteAttribute('uv'); return q; }));
}
// 给龙头这种没有 UV 的形状按面的朝向做方块投影 UV（每个三角形取法线最大的轴，投到对应的平面上）
function boxUV(geo, tile) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, uv = new Float32Array(p.count * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    n.subVectors(c, b).cross(b.clone().sub(a));
    const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      const [u0, v0] = ax >= ay && ax >= az ? [v.z, v.y] : ay >= az ? [v.x, v.z] : [v.x, v.y];
      uv[(i + k) * 2] = u0 / tile; uv[(i + k) * 2 + 1] = v0 / tile;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// ---------- 龙爪：右侧的一条腿（左侧用镜像的矩阵）----------
// 局部坐标：+x 朝身体外侧，+y 朝背，+z 朝龙头；原点在肩（髋）关节。游动时腿向后收着贴近身体，爪趾向后、向下蜷着
function makeLegGeometry() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const S = V(0, 0, 0), E = V(.2, -.2, -.06), W = V(.25, -.3, -.4), H = V(.27, -.33, -.5);
  const skin = [
    blob(.12, .1, .19, -.04, -.01, -.02),                          // 肩：鼓起的一块肌肉，把腿和身体接起来
    taperTube([S, V(.11, -.11, -.01), E], .12, .075, 10),          // 上臂
    blob(.08, .075, .085, E.x, E.y, E.z),                          // 肘
    taperTube([E, V(.25, -.27, -.22), W], .075, .05, 10),          // 前臂
    taperTube([W, H], .05, .046, 4),                               // 掌
    cone(.03, .17, E.x, E.y + .01, E.z, -1.25, .25), cone(.024, .13, E.x - .02, E.y + .02, E.z, -1.3, -.2),   // 肘后两撮向后飘的鬣毛
  ];
  const nails = [];
  // 四根向后张开的趾 + 一根朝前的拇趾；每根趾的末端接一枚弯钩状的爪
  const toe = (dir, len, r) => {
    const d = dir.normalize(), b = H.clone().addScaledVector(d, .02), m = b.clone().addScaledVector(d, len);
    skin.push(taperTube([b, b.clone().addScaledVector(d, len * .5).add(V(0, -.012, 0)), m], r, r * .7, 6));
    nails.push(taperTube([m, m.clone().addScaledVector(d, .035).add(V(0, -.02, 0)), m.clone().addScaledVector(d, .045).add(V(0, -.07, 0))], r * .72, .003, 8));
  };
  for (let k = 0; k < 4; k++) { const f = (k / 3 - .5) * 1.15; toe(V(.3 + Math.sin(f) * .9, -.35, -Math.cos(f)), .1, .026); }
  toe(V(-.35, -.45, .55), .06, .022);
  return { skin: boxUV(mergeGeometries(skin.map(g => g.index ? g.toNonIndexed() : g).map(g => { g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; })), .45),
           nails: boxUV(mergeGeometries(nails.map(g => { g = g.toNonIndexed(); g.deleteAttribute('uv'); g.deleteAttribute('normal'); return g; })), .2) };
}

// 下颚（单独一块，绕下颚根部转动来张嘴）：局部原点就是转轴
const JAW_PIVOT = [0, -.06, -.02];
function makeJawGeometry() {
  const parts = [blob(.12, .055, .27, 0, -.04, .26)];
  for (const sd of [1, -1]) {
    for (const z of [.22, .3, .38]) parts.push(cone(.011, .045, sd * (.085 - z * .06), -.005, z, 0, 0));
    parts.push(cone(.014, .07, sd * .05, -.01, .46, 0, 0));
  }
  return mergeGeometries(parts.map(q => { q.deleteAttribute('uv'); return q; }));
}
// 龙须：从鼻头两侧往后飘，沿着须一道一道波动（每帧重算）
const WR = 22, WS = 5, WLEN = 1.1;

export function createWish({ scene, ripples, floorH, sound = {}, tex = null }) {
  const group = new THREE.Group(); group.visible = false;
  scene.add(group);

  // 许愿签 + 红绳 + 铜钱（原点在绳结处，纸在上、铜钱垂在下面）
  // 许愿签不用水的真实吸收（红色在水里一下子就看不见了），改成按深度自己染成暗青色，一路沉下去都看得到
  const paperMat = patch(new THREE.MeshStandardMaterial({ roughness: .85, emissive: 0xffffff, emissiveIntensity: 0 }), { underwater: false });
  const backMat = patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.55, .1, .08, THREE.SRGBColorSpace), roughness: .85 }), { underwater: false });
  const paperCanvas = document.createElement('canvas'); paperCanvas.width = PW; paperCanvas.height = PH;
  const paperCtx = paperCanvas.getContext('2d');
  const paperTex = new THREE.CanvasTexture(paperCanvas); paperTex.colorSpace = THREE.SRGBColorSpace; paperTex.anisotropy = 4;
  paperMat.map = paperTex; paperMat.emissiveMap = paperTex;
  let paperBg = null, chars = [], writeProg = 0;
  const redrawPaper = () => { drawPaper(paperCtx, paperBg, chars, writeProg); paperTex.needsUpdate = true; };
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W, PAPER_H), paperMat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(PAPER_W, PAPER_H), backMat);
  back.rotation.y = Math.PI;
  paper.position.y = back.position.y = PAPER_H / 2;
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, STRING, 6), patch(new THREE.MeshStandardMaterial({ color: 0x8a1410, roughness: .7 }), {}));
  cord.position.y = -STRING / 2;
  const coin = new THREE.Mesh(coinGeometry(), patch(new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(.78, .6, .3, THREE.SRGBColorSpace), metalness: .85, roughness: .35, emissive: 0x000000 }), {}));
  coin.position.y = -STRING - .05;
  group.add(paper, back, cord, coin);

  // 龙
  // 截面一圈的角度从腹部正中开始（th = π），接缝藏在肚子底下
  const ringAngle = j => j / SEGS * Math.PI * 2 + Math.PI;
  const pos = new Float32Array((RINGS * VPR + 2) * 3), uvs = new Float32Array((RINGS * VPR + 2) * 2);
  for (let i = 0; i < RINGS; i++) for (let j = 0; j <= SEGS; j++) {
    const k = (i * VPR + j) * 2;
    uvs[k] = j / SEGS * U_REP; uvs[k + 1] = -(i / (RINGS - 1)) * LEN / V_TILE;   // 贴图上方朝龙头：鳞尖朝向尾巴
  }
  const backIdx = [], bellyIdx = [];   // 背上和两侧是大鳞，腹部是横纹甲
  for (let i = 0; i < RINGS - 1; i++) for (let j = 0; j < SEGS; j++) {
    const a = i * VPR + j, b = a + 1, c2 = a + VPR, d = b + VPR;
    (Math.cos(ringAngle(j + .5)) < -.4 ? bellyIdx : backIdx).push(a, c2, b, b, c2, d);
  }
  const cap0 = RINGS * VPR, cap1 = cap0 + 1;   // 吻端、尾尖的封口
  for (let j = 0; j < SEGS; j++) { backIdx.push(cap0, j, j + 1); backIdx.push(cap1, (RINGS - 1) * VPR + j + 1, (RINGS - 1) * VPR + j); }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  dGeo.setIndex([...backIdx, ...bellyIdx]);
  dGeo.addGroup(0, backIdx.length, 0); dGeo.addGroup(backIdx.length, bellyIdx.length, 1);
  // 墨青色的身体（接近黑色），只在轮廓边缘泛出一点青光（rim）
  // 龙鳞：背上大鳞、腹部横纹甲、龙头细鳞三套贴图（没有贴图时退回纯色）；龙须是纯色的
  const scaleMat = set => patch(new THREE.MeshStandardMaterial({
    map: set?.diff ?? null, normalMap: set?.nor ?? null, roughnessMap: set?.rough ?? null,
    normalScale: new THREE.Vector2(2.2, 2.2), roughness: set ? .62 : .38, metalness: set ? .3 : .18, emissive: 0x000000, emissiveIntensity: 0,
  }), { lamp: true, underwater: false, deepFade: .32 });
  const dBackMat = scaleMat(tex?.back), bellyMat = scaleMat(tex?.belly), headMat = scaleMat(tex?.head);
  const plainMat = patch(new THREE.MeshStandardMaterial({ roughness: .45, metalness: .18, emissive: 0x000000, emissiveIntensity: 0 }), { lamp: true, underwater: false, deepFade: .32 });
  const dMats = [dBackMat, bellyMat, headMat, plainMat];
  const dragon = new THREE.Mesh(dGeo, [dBackMat, bellyMat]);
  dragon.frustumCulled = false; dragon.visible = false;
  scene.add(dragon);

  // 四只龙爪：前爪在身长 20% 处，后爪在 58% 处（后腿略大）；左右交替划水（对角的两只同步），转身游走时向后收紧贴着身体
  // 腿用背上的鳞片贴图；爪尖是暗骨白色的角质。都挂在 dragon 下面：龙隐藏时一起隐藏（dragon 的矩阵是单位矩阵，所以腿的矩阵就是世界坐标）
  const clawMat = patch(new THREE.MeshStandardMaterial({ color: 0x3e3a2f, roughness: .55, metalness: 0, emissive: 0x000000, emissiveIntensity: 0 }), { lamp: true, underwater: false, deepFade: .32 });
  const legGeo = makeLegGeometry();
  legGeo.skin.computeVertexNormals(); legGeo.nails.computeVertexNormals();
  const legs = [[.2, 1, 0, 1.3], [.2, -1, Math.PI, 1.3], [.58, 1, Math.PI, 1.42], [.58, -1, 0, 1.42]].map(([sAt, sd, ph, k]) => {
    const g = new THREE.Group(); g.matrixAutoUpdate = false;
    const skin = new THREE.Mesh(legGeo.skin, dBackMat), nails = new THREE.Mesh(legGeo.nails, clawMat);
    skin.frustumCulled = nails.frustumCulled = false;
    g.add(skin, nails); dragon.add(g);
    return { ring: Math.round(sAt * (RINGS - 1)), sd, ph, k, g };
  });
  let legTuck = 0;
  const legX = new THREE.Vector3(), legP = new THREE.Vector3(), legS = new THREE.Vector3(), legR = new THREE.Matrix4();
  function legAt(L, r, time) {
    // 镜像的一侧：x 轴取反，矩阵的行列式为负，three.js 会自动翻转三角形的正反面
    legX.copy(N).multiplyScalar(L.sd);
    legP.copy(P).addScaledVector(legX, r * .78).addScaledVector(B, -r * .42);   // 肩在身体侧面偏下（腹部一侧）
    const swing = Math.sin(time * 2.6 + L.ph) * .2 * (1 - legTuck) + .35 * legTuck;   // 划水的摆动；游走时整条腿向后收
    L.g.matrix.makeBasis(legX, B, Tn).multiply(legR.makeRotationX(swing)).scale(legS.setScalar(L.k)).setPosition(legP);
    L.g.matrixWorldNeedsUpdate = true;
  }

  // 龙头（跟着身体最前面那一节走，朝向沿着游动方向；停下来时抬头看着许愿签）
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(boxUV(makeHeadGeometry(), HEAD_TILE), headMat);
  const eyeMat = patch(new THREE.MeshStandardMaterial({ color: 0x9a6a1c, roughness: .25, metalness: 0, emissive: 0xffc24a, emissiveIntensity: 0 }), { lamp: true, underwater: false, deepFade: .32 });   // 不受水的吸收：深处也看得见一对眼睛
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const eyeGeo = new THREE.SphereGeometry(.032, 14, 10), pupilGeo = new THREE.SphereGeometry(1, 10, 8);
  // 金色的眼睛 + 竖着的细缝瞳孔；每只眼睛一个小组，睁眼时把它沿竖直方向从扁到圆放开
  const eyes = [1, -1].map(sd => {
    const g = new THREE.Group(); g.position.set(.13 * sd, .075, .17);
    const out = new THREE.Vector3(.62 * sd, .3, .72).normalize();
    const pupil = new THREE.Mesh(pupilGeo, pupilMat);
    pupil.scale.set(.006, .026, .006); pupil.position.copy(out).multiplyScalar(.03);
    g.add(new THREE.Mesh(eyeGeo, eyeMat), pupil);
    return g;
  });
  const jaw = new THREE.Mesh(boxUV(makeJawGeometry(), HEAD_TILE), headMat);
  jaw.position.set(...JAW_PIVOT); jaw.frustumCulled = false;
  const wPos = new Float32Array(2 * WR * WS * 3), wIdx = [];
  for (let w = 0; w < 2; w++) for (let i = 0; i < WR - 1; i++) for (let j = 0; j < WS; j++) {
    const o = w * WR * WS, a = o + i * WS + j, b = o + i * WS + (j + 1) % WS;
    wIdx.push(a, a + WS, b, b, a + WS, b + WS);
  }
  const wGeo = new THREE.BufferGeometry(); wGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3)); wGeo.setIndex(wIdx);
  const whiskers = new THREE.Mesh(wGeo, plainMat); whiskers.frustumCulled = false;
  headMesh.frustumCulled = false;
  head.add(headMesh, jaw, ...eyes, whiskers); head.visible = false;

  // 雕刻的龙头模型（Tripo 生成，scripts/build_dragon_head.py 处理成左右对称、减面、带张嘴形变）：
  // 加载好之后替换掉上面用几何体拼的头和下颚，眼睛挪到模型的眼窝里，程序龙须改成从模型的须根长出来
  let sculpt = null;
  new GLTFLoader().load(`${import.meta.env.BASE_URL}models/dragon_head.glb`, gltf => {
    let src = null; gltf.scene.traverse(o => { if (o.isMesh) src = o; });
    if (!src) return;
    const geo = src.geometry;
    geo.computeVertexNormals();
    sculpt = new THREE.Mesh(boxUV(geo, HEAD_TILE), headMat);
    sculpt.frustumCulled = false;
    headMesh.visible = jaw.visible = false;   // 龙须保留：模型上的长须已经去掉，换成这两根会飘的
    eyes.forEach((e, i) => { e.position.set((i ? -1 : 1) * .088, .095, .19); e.userData.size = .6; });
    head.add(sculpt);
  }, undefined, () => { /* 加载失败就继续用几何体拼的头 */ });
  scene.add(head);
  const wc = new THREE.Vector3(), wt = new THREE.Vector3(), wn = new THREE.Vector3(), wb = new THREE.Vector3(), wq = new THREE.Vector3();
  function whiskerAt(sd, u, time, out) {
    // 雕刻的龙头：从鼻头两侧的须根出发，先贴着脸往后，过了脸颊向外张开，一直拖到脖子后面；越往后摆得越大
    if (sculpt) return out.set(
      sd * (.125 + .13 * smooth(u * 1.6) + .07 * u + .06 * Math.sin(u * 5 - time * 2.1) * u),
      -.03 - .1 * u + .07 * Math.sin(u * 4 - time * 1.7 + sd) * u,
      .46 - 1.5 * u);
    // 头的局部坐标：从鼻头两侧出发，向后、向外、向下飘，越往后摆得越大
    return out.set(sd * (.1 + .32 * u + .05 * Math.sin(u * 5 - time * 2.4) * u), -.02 - .22 * u + .06 * Math.sin(u * 4 - time * 1.9 + sd) * u, .52 - WLEN * u);
  }
  function updateWhiskers(time) {
    for (let w = 0; w < 2; w++) {
      const sd = w ? -1 : 1;
      for (let i = 0; i < WR; i++) {
        const u = i / (WR - 1);
        whiskerAt(sd, u, time, wc); whiskerAt(sd, u + .02, time, wq);
        wt.subVectors(wq, wc).normalize();
        wn.crossVectors(wt, up).normalize(); wb.crossVectors(wn, wt);
        const r = lerp(sculpt ? .011 : .014, .003, u);
        for (let j = 0; j < WS; j++) {
          const th = j / WS * Math.PI * 2, k = ((w * WR + i) * WS + j) * 3;
          const cx = Math.cos(th) * r, cy = Math.sin(th) * r;
          wPos[k] = wc.x + wn.x * cx + wb.x * cy; wPos[k + 1] = wc.y + wn.y * cx + wb.y * cy; wPos[k + 2] = wc.z + wn.z * cx + wb.z * cy;
        }
      }
    }
    wGeo.attributes.position.needsUpdate = true; wGeo.computeVertexNormals();
  }

  // 龙走后留下的几粒微光
  const motes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3)),
    new THREE.PointsMaterial({ size: .05, map: softDot(), color: 0x9ff3e4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  motes.visible = false; motes.frustumCulled = false;
  scene.add(motes);

  let pt = 0, called = false;   // pt：签落下之后的时间（下沉一直在走）；t：龙的时间线，点右边的石狐之前停在压迫感开始之前
  let phase0 = 0, t = -1, land = new THREE.Vector3(), path = null, pathLen = 1, glow = 0, dread = 0, took = false, rippled = false, phase = 0;
  const fired = new Set();   // 已经触发过的声音
  const once = (k, f) => { if (!fired.has(k)) { fired.add(k); f?.(); } };
  const mouth = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), Tn = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();

  let takeD = 0, lurkD = 0;
  const crest = new THREE.Vector3();   // 弓顶的位置（龙翻过来的时候水面在这里被搅动）
  const toCam = new THREE.Vector3(0, 0, 1), awayRef = new THREE.Vector3();
  function buildPath() {
    // 从许愿签正下方的深处笔直地浮上来（正对着镜头，身体垂向黑暗里），停在签下面抬头看着它；
    // 然后向一侧转身，潜回深处。全程不浮出水面
    const p = new THREE.Vector3(land.x, SINK_Y, land.z);
    toCam.set(land.x, 0, land.z).normalize();
    if (toCam.lengthSq() < .01) toCam.set(0, 0, 1);
    const side = new THREE.Vector3(-toCam.z, 0, toCam.x);
    const at = (c, sd, y) => p.clone().addScaledVector(toCam, c).addScaledVector(side, sd).setY(y);
    // 离开的轨迹：不再是"垂直上去、急转半圈、垂直下去"的 U 形（转弯半径比身体还细，顶上会拧成一个折角），
    // 而是：头先缓缓向一侧弓出去，再绕着井的中轴一圈一圈盘旋着往下游，最后才竖直沉下去。
    // 全程用柱坐标（相对池心 O：半径 r，角度 φ，高度 y）写控制点，Catmull-Rom 过一遍就是一条圆滑的曲线
    const O = new THREE.Vector3(0, 0, 0);
    const cyl = (r, deg, y) => O.clone().addScaledVector(toCam, r * Math.cos(deg * Math.PI / 180)).addScaledVector(side, r * Math.sin(deg * Math.PI / 180)).setY(y);
    const RH = 1.3;   // 盘旋的半径（身体直径 0.6 米，龙头宽 1.3 米，离开中轴上那一股身体要有 1 米的间距）
    const pts = [
      at(-.5, 0, -12),
      at(-.55, -.5, -9.2),            // 从井底游上来的时候是一道缓缓的 S 形，不是一根笔直的棍子
      at(-.5, .55, -6.6),
      at(-.47, -.35, -4.2),           // 游上来的起点参考位置（用来算起始距离）
      at(-.45, 0, STOP_Y),            // 停在这里：头骨中心在许愿签正下方略靠后，吻端朝上、刚好到签底下
      cyl(.40, 20, STOP_Y + .5),      // 头慢慢向一侧弓出去（半径一点点放大，弯得很缓）
      cyl(.68, 48, STOP_Y + .8),      // 弓顶（最高点）：只比停住的位置高 0.8 米，之后马上往下扎
      cyl(1.05, 92, STOP_Y + .3),
      cyl(RH, 138, -2.9),             // 往下盘旋：每一段都斜着往下 50～60 度，身体是一条斜线，不是平躺在水面下面
      cyl(RH, 188, -4.7),
      cyl(RH, 233, -6.8),
      cyl(RH, 272, -9.0),
      cyl(RH, 300, -11.2),            // 最后几米拉直，竖直沉下去（路径之外沿切线延长，必须是竖直的）
      cyl(RH, 304, -13.4),
    ];
    crest.copy(pts[6]);
    // 池子是个碗：越往边上池底越浅。中间几个点要留在池底上面，只有起点、终点可以在池底以下（像从深不见底的地方浮上来）
    pts.forEach((q, i) => {
      const r = Math.hypot(q.x, q.z); if (r > 1.8) { q.x *= 1.8 / r; q.z *= 1.8 / r; }
      if (i === 3) q.y = Math.max(q.y, floorH(q.x, q.z) + .12);
    });
    path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    pathLen = path.getLength();
    // 停下来的位置（第 3 个控制点）在路径上的弧长
    const arcOf = target => {
      let best = 1e9, at = 0; const q = new THREE.Vector3();
      for (let i = 0; i <= 400; i++) { path.getPointAt(i / 400, q); const dd = q.distanceToSquared(target); if (dd < best) { best = dd; at = i / 400 * pathLen; } }
      return at;
    };
    takeD = arcOf(pts[4]); lurkD = arcOf(pts[3]);
  }

  // 头走到路径上的 d（米）处时，s 处那一节在路径上的位置；路径两端之外沿切线延长
  function along(d) {
    const u = d / pathLen;
    if (u <= 0) { path.getPointAt(0, P); path.getTangentAt(0, Tn); P.addScaledVector(Tn, d); return; }
    if (u >= 1) { path.getPointAt(1, P); path.getTangentAt(1, Tn); P.addScaledVector(Tn, d - pathLen); return; }
    path.getPointAt(u, P); path.getTangentAt(u, Tn);
  }

  // 截面的参考"上方"：平着游时是世界的上方；竖着游时（cross(up, Tn) 退化）渐渐换成"背离镜头"的方向，
  // 这样龙竖着浮上来时背朝后、脸朝着镜头
  function frameRef(tn, out) {
    awayRef.copy(toCam).negate();
    return out.copy(up).lerp(awayRef, smooth((Math.abs(tn.y) - .55) / .35)).normalize();
  }
  const ref = new THREE.Vector3();
  let waveAmp = 1;
  function updateDragon(head, time) {
    for (let i = 0; i < RINGS; i++) {
      const s = i / (RINGS - 1);
      along(head - s * LEN);
      // 左右摆动：一道从头传到尾的波（尾巴摆得更大）
      N.crossVectors(frameRef(Tn, ref), Tn).normalize();
      const wave = Math.sin(s * 15 - time * 3.2) * (.05 + .2 * s * s) * waveAmp;
      P.addScaledVector(N, wave);
      B.crossVectors(Tn, N).normalize();
      P.addScaledVector(B, Math.sin(s * 11 - time * 2.5 + 1.3) * (.04 + .16 * s) * waveAmp - NECK_DROP * (1 - smooth(s / .2)));   // 上下方向也有一道波：身体各节离水面的深度不一样，不会整条平躺着
      const r = bodyRadius(s) * BS;
      for (const L of legs) if (L.ring === i) legAt(L, r, time);
      for (let j = 0; j <= SEGS; j++) {
        const th = ringAngle(j), cy = Math.cos(th), sx = Math.sin(th);
        // 背上的鳍：朝上的一侧一排锯齿（头和尾巴上没有）
        const fin = Math.pow(Math.max(cy, 0), 10) * (.5 + .5 * Math.sin(s * 160)) * .9 * smooth((s - .12) / .1) * (1 - smooth((s - .8) / .15));
        const rr = r * (1 + fin), k = (i * VPR + j) * 3;
        // 截面略扁（腹部平一点）
        const vy = cy * rr * (cy < 0 ? .8 : 1), vx = sx * rr;
        pos[k] = P.x + N.x * vx + B.x * vy; pos[k + 1] = P.y + N.y * vx + B.y * vy; pos[k + 2] = P.z + N.z * vx + B.z * vy;
      }
      if (i === 0) { along(head + .02); pos.set([P.x, P.y, P.z], cap0 * 3); }
      if (i === RINGS - 1) pos.set([P.x, P.y, P.z], cap1 * 3);
    }
    dGeo.attributes.position.needsUpdate = true;
    dGeo.computeVertexNormals();
    // 接缝两侧的顶点各算各的法线，会出现一条明暗线：把每圈首尾两个点的法线取平均
    const nr = dGeo.attributes.normal.array;
    for (let i = 0; i < RINGS; i++) {
      const a = i * VPR * 3, b = (i * VPR + SEGS) * 3;
      for (let c = 0; c < 3; c++) { const m = (nr[a + c] + nr[b + c]) / 2; nr[a + c] = nr[b + c] = m; }
    }
  }

  const hFs = new THREE.Vector3();   // 头的朝向（带惯性：转向时慢半拍跟上路径，不是一下子对准）
  let hFinit = false, dtNow = 1 / 60;
  const hF = new THREE.Vector3(), hN = new THREE.Vector3(), hB = new THREE.Vector3(), hP = new THREE.Vector3(), toPaper = new THREE.Vector3();
  function updateHead(d, time, look, paperPos) {
    along(d);
    hF.copy(Tn);
    N.crossVectors(frameRef(Tn, ref), Tn).normalize();
    hP.copy(P).addScaledVector(N, Math.sin(-time * 3.2) * .05);   // 和身体第一节一样的左右摆
    hP.addScaledVector(B.crossVectors(Tn, N).normalize(), Math.sin(-time * 2.5 + 1.3) * .04 * waveAmp);   // 上下的波也一样
    if (look > 0) { toPaper.subVectors(paperPos, hP).normalize(); hF.lerp(toPaper, look * .75).normalize(); }   // 停下来时抬头看着许愿签
    if (!hFinit) { hFs.copy(hF); hFinit = true; } else hFs.lerp(hF, 1 - Math.exp(-dtNow * 7)).normalize();
    hN.crossVectors(frameRef(hFs, ref), hFs).normalize(); hB.crossVectors(hFs, hN);
    head.matrix.makeBasis(hN, hB, hFs).scale(new THREE.Vector3(HS, HS, HS)).setPosition(hP);
    head.matrixAutoUpdate = false; head.matrixWorldNeedsUpdate = true;
    updateWhiskers(time);
  }

  // ---------- 许愿签落水之前：飘来 → 等着写字 → 写字 → 可以拖动 → 拖到水面上松手 ----------
  // mode：idle（没有签）| summon（随风飘来）| await（悬在空中，等输入）| writing（字一个个写上去）
  //       ready（写好了，可以拖）| drag（正被拖着）| back（松手的地方不在水面上，飘回原处）| away（不写了，被风吹走）| ritual（落水之后）
  let mode = 'idle', mt = 0, cam = null, pendingText = null, focus = 0;   // focus：0～1，背景虚化的程度
  let throwTo = null, throwOpts = null, readyT = 0, throwNow = false;   // 写完之后自己落进水里：落点、朝向、等待时间
  const hoverPos = new THREE.Vector3(), fromPos = new THREE.Vector3(), dragTarget = new THREE.Vector3(), lastPos = new THREE.Vector3();
  const cR = new THREE.Vector3(), cU = new THREE.Vector3(), cF = new THREE.Vector3(), tmpV = new THREE.Vector3();
  const dropPt = new THREE.Vector3(), throwFrom = new THREE.Vector3();
  const SUMMON_T = 2.6, WRITE_DT = .22;
  const camBasis = () => { cR.set(1, 0, 0).applyQuaternion(cam.quaternion); cU.set(0, 1, 0).applyQuaternion(cam.quaternion); cF.set(0, 0, -1).applyQuaternion(cam.quaternion); };
  // 让签正对着镜头（plane 的正面朝 +z），再叠一点飘动的倾斜
  function faceCamera(rx = 0, rz = 0) {
    group.lookAt(cam.position);
    if (rx) group.rotateX(rx);
    if (rz) group.rotateZ(rz);
  }
  // 落水之前，签在第 1 层：主画面（会被虚化）里没有它，虚化之后再单独画在最上面，所以它一直是清楚的
  const setOverlay = on => group.traverse(o => o.layers.set(on ? 1 : 0));
  function preUpdate(dt) {
    mt += dt;
    // 背景虚化：签停稳之后四周先虚化，等着写字；写好之后虚化退去，好看清池子把签拖过去
    const want = (mode === 'await' || mode === 'writing') ? 1 : 0;
    focus += (want - focus) * (1 - Math.exp(-dt * (want ? 3 : 4)));
    camBasis();
    const bob = tmpV.copy(hoverPos).addScaledVector(cU, Math.sin(mt * 1.3) * .04).addScaledVector(cR, Math.sin(mt * .9) * .03);
    if (mode === 'summon') {
      // 从左边随风飘进来：一条弧线，越来越慢；一路翻飞，快到时才转正对着镜头
      const u = clamp(mt / SUMMON_T), e = easeOut(u);
      const ctrl = tmpV.copy(fromPos).lerp(hoverPos, .5).addScaledVector(cU, .9);
      const a = fromPos.clone().lerp(ctrl, e), b2 = ctrl.clone().lerp(hoverPos, e);
      group.position.copy(a.lerp(b2, e))
        .addScaledVector(cU, Math.sin(mt * 6.5) * .1 * (1 - e)).addScaledVector(cR, Math.sin(mt * 3.7) * .12 * (1 - e));
      faceCamera(Math.sin(mt * 5.3) * 1.1 * (1 - e), Math.sin(mt * 4.1 + 1) * .9 * (1 - e));   // 翻飞随着靠近慢慢停下，到位时正好静止
      if (u >= 1) { mode = pendingText ? 'writing' : 'await'; if (pendingText) { chars = pendingText; pendingText = null; writeProg = 0; } }
    } else if (mode === 'await' || mode === 'writing' || mode === 'ready') {
      group.position.copy(hoverPos); faceCamera();   // 停在画面中间，一动不动
      if (mode === 'ready' && throwTo && (readyT += dt) > .8) throwNow = true;   // 字写完，停一下（看清写了什么），然后落进水里
      if (mode === 'writing') {
        writeProg = Math.min(chars.length, writeProg + dt / WRITE_DT); redrawPaper();
        if (writeProg >= chars.length) { mode = 'ready'; readyT = 0; }
      }
    } else if (mode === 'drag') {
      lastPos.copy(group.position);
      group.position.lerp(dragTarget, 1 - Math.exp(-dt * 14));
      const vx = group.position.clone().sub(lastPos).dot(cR) / Math.max(dt, 1e-3);
      faceCamera(0, clamp(-vx * .12, -.5, .5));   // 拖得快时签往反方向斜一点，像被风带着
    } else if (mode === 'back') {
      group.position.lerp(hoverPos, 1 - Math.exp(-dt * 5)); faceCamera();
      if (group.position.distanceTo(hoverPos) < .02) mode = 'ready';
    } else if (mode === 'away') {
      // 不写了：一阵风把签吹走（向右上方翻飞着飘出画面）
      const u = clamp(mt / 1.6);
      group.position.copy(fromPos).addScaledVector(cR, 5 * u * u).addScaledVector(cU, 1.6 * u);
      faceCamera(mt * 4, mt * 3);
      if (u >= 1) { mode = 'idle'; group.visible = false; setOverlay(false); }
    }
  }

  return {
    get busy() { return mode !== 'idle'; },
    get focus() { return focus; },
    get overlay() { return mode !== 'idle' && mode !== 'ritual'; },
    // 签停稳、四周虚化好了：这时才出现输入框
    get inputReady() { return mode === 'await' && focus > .85; },
    // 签已经在水里了、龙还没被唤来：点右边的石狐就唤龙
    get canCall() { return mode === 'ritual' && !called && pt >= T.float; },
    callDragon() { if (this.canCall) { called = true; return true; } return false; },
    get mode() { return mode; },
    // 点了石狐：一阵风送来一张空白的许愿签，悬停在画面里（screenX, screenY：悬停位置，-1～1 的屏幕坐标）
    summon(camera, screenX = 0, screenY = .06) {
      if (mode !== 'idle') return false;
      cam = camera; camBasis();
      const ray = new THREE.Raycaster(); ray.setFromCamera({ x: screenX, y: screenY }, cam);
      hoverPos.copy(ray.ray.origin).addScaledVector(ray.ray.direction, 3);   // 离镜头 3 米：签在画面里够大，字看得清
      fromPos.copy(hoverPos).addScaledVector(cR, -4.6).addScaledVector(cU, 1.1).addScaledVector(cF, .8);
      paperBg = paperBackground(); chars = []; writeProg = 0; pendingText = null; redrawPaper();
      paperMat.color.setRGB(1, 1, 1); backMat.color.setRGB(.55, .1, .08); paperMat.emissiveIntensity = .35;   // 落水前：逆光时纸是暗的，让纸面和金字带一点亮度，看得清写了什么（落水后由深度染色接管）
      group.visible = true; group.scale.setScalar(1); group.position.copy(fromPos);
      setOverlay(true); focus = 0;
      mode = 'summon'; mt = 0;
      return true;
    },
    // 写好了：字一个一个写到签上（签还在飞来的路上就先记下，到了再写）
    // where：落点（池心靠镜头一侧，龙来的地方）；opts.facing：签面朝向
    write(text, where = null, opts = {}) {
      throwTo = where; throwOpts = opts;
      const cs = [...text.trim()].slice(0, 30);
      if (!cs.length) return;
      if (mode === 'summon') pendingText = cs;
      else if (mode === 'await') { chars = cs; writeProg = 0; mode = 'writing'; }
    },
    dismiss() { if (mode === 'summon' || mode === 'await') { fromPos.copy(group.position); mode = 'away'; mt = 0; } },
    // 点到的是不是许愿签
    hitPaper(raycaster) {   // 签悬在空中时在第 1 层，射线也要看第 1 层
      if (!group.visible) return false;
      raycaster.layers.enable(1); const hit = raycaster.intersectObjects([paper, back], false).length > 0; raycaster.layers.disable(1);
      return hit;
    },
    get draggable() { return mode === 'ready'; },
    get waiting() { return mode === 'await'; },
    dragStart() { if (mode === 'ready' || mode === 'back') { mode = 'drag'; dragTarget.copy(group.position); return true; } return false; },
    // 拖动：签沿着鼠标 / 手指的视线，保持在离镜头和悬停时差不多远的地方
    dragTo(ray) {
      if (mode !== 'drag') return;
      const dist = hoverPos.distanceTo(cam.position);
      dragTarget.copy(ray.origin).addScaledVector(ray.direction, dist);
    },
    // 松手：落点在水面上（池子里）→ 投进池中，开始仪式；否则飘回原处
    release(waterPoint, where, opts = {}) {
      if (mode !== 'drag') return false;
      if (!waterPoint) { mode = 'back'; return false; }
      this.start(chars.join(''), where, { ...opts, from: group.position.clone(), drop: waterPoint, keepPaper: true });
      return true;
    },
    get glow() { return glow; },
    get dread() { return dread; },   // 0～1：四周安静、变暗的程度（main.js 用它压暗光线、停风、调低饱和度、放大轰鸣）
    // where：落点（水面上的 x, z）；opts.facing：许愿签正面朝向（朝着镜头）
    start(text, where, opts = {}) {
      if (opts.facing !== undefined) phase0 = opts.facing;
      if (!opts.keepPaper) { paperBg = paperBackground(); chars = [...text.trim()].slice(0, 30); writeProg = chars.length; redrawPaper(); }
      land.set(where.x, 0, where.z);
      // 签从哪里落下、落在水面哪里（直接调用 start 时：从落点正上方 1.3 米落下）
      dropPt.set(opts.drop?.x ?? land.x, 0, opts.drop?.z ?? land.z);
      throwFrom.copy(opts.from ?? dropPt.clone().setY(1.3));
      mode = 'ritual'; setOverlay(false); focus = 0;
      // 贴图本身已经是墨青色：只略微提亮（水会吃掉一大半光）；没贴图的部分用纯墨青色
      for (const m of [dBackMat, bellyMat, headMat]) m.map ? m.color.setRGB(3.6, 3.9, 3.7) : m.color.set(0x173f38);   // 贴图很暗（平均亮度只有 0.01～0.025），乘上去才看得出鳞片
      bellyMat.roughness = 1.8; bellyMat.metalness = 0;   // 腹部做成哑光：它朝上、被阳光照到，粗糙度贴图偏低时会泛出一层丝绸一样的白色反光
      if (bellyMat.map) bellyMat.color.setRGB(.95, 1.3, 1.5);   // 腹部贴图本身比背鳞亮一倍多（平均亮度 0.025 对 0.013），而且偏黄褐：压暗并偏向墨青，和背部协调
      plainMat.color.set(0x173f38);
      buildPath();
      t = 0; pt = 0; called = !!opts.callNow; took = false; rippled = false; fired.clear(); hFinit = false; phase = phase0 + (Math.random() - .5) * .5;
      group.visible = true; group.scale.setScalar(1);
      dragon.visible = false; head.visible = false; motes.visible = false;
    },
    update(dt, env = {}) {
      if (mode !== 'idle' && mode !== 'ritual') {
        preUpdate(dt);
        if (throwNow) { throwNow = false; this.start(chars.join(''), throwTo, { ...throwOpts, from: group.position.clone(), drop: { x: throwTo.x, z: throwTo.z }, keepPaper: true }); }
        return;
      }
      if (t < 0) return;
      const day = env.day ?? 1;
      pt += dt; dtNow = dt;
      t += dt; if (!called) t = Math.min(t, T.dread - .01);   // 还没唤龙：时间停在压迫感开始之前（四周不暗、龙不来）
      const sway = Math.sin(pt * 1.3 + phase), sway2 = Math.sin(pt * .8 + phase * 2);

      // ---- 许愿签 ----
      if (pt < T.fall) {                     // 从空中落下，翻转着
        // 从松手的地方落向水面：水平方向先快后慢，高度越落越快；一路翻飞
        const u = pt / T.fall;
        group.position.set(lerp(throwFrom.x, dropPt.x, easeOut(u)), lerp(throwFrom.y, 0, u * u), lerp(throwFrom.z, dropPt.z, easeOut(u)));
        group.rotation.set(lerp(-1.2, -.3, u) + Math.sin(u * 9) * .25, phase, Math.sin(u * 7) * .3);
      } else if (pt < T.float) {             // 落水：溅起涟漪，在水面附近晃一下
        if (!group.userData.splashed) {
          group.userData.splashed = true;
          sound.splash?.();
          ripples.add(dropPt.x, dropPt.z, .2, .45);
          for (let i = 0; i < 4; i++) ripples.add(dropPt.x + (Math.random() - .5) * .3, dropPt.z + (Math.random() - .5) * .3, .06, .15);
        }
        const u = (pt - T.fall) / (T.float - T.fall);
        group.position.set(dropPt.x, lerp(0, -.18, u), dropPt.z);
        group.rotation.set(lerp(-.3, -.9, Math.sin(u * Math.PI)), phase + u * .3, .2 * sway);
      } else if (!took || t < T.take + .35) { // 摇摆着下沉：铜钱在下面拽着，纸在上面飘
        const u = easeOut((pt - T.float) / (T.sunk - T.float));
        const depth = lerp(-.18, SINK_Y, u);
        // 一边下沉，一边慢慢被井的中间"吸"过去（落在池边也一样会漂到龙要来的地方）
        const k = smooth((pt - T.float) / (T.sunk - T.float - 1));
        group.position.set(lerp(dropPt.x, land.x, k) + sway * .07 * u, depth, lerp(dropPt.z, land.z, k) + sway2 * .05 * u);
        group.rotation.set(.18 * sway2, phase + .3 + pt * .05, .22 * sway);
      }

      // 入水后：越深越暗、越偏青；字迹微微发光
      const dep = clamp(-group.position.y / 1.4);
      const tint = [lerp(1, .32, dep), lerp(1, .55, dep), lerp(1, .6, dep)];
      paperMat.color.setRGB(...tint); backMat.color.setRGB(.55 * tint[0], .1 * tint[1], .08 * tint[2]);
      paperMat.emissiveIntensity = smooth(dep * 2) * .12;

      // ---- 压迫感：许愿签沉下去之后，四周慢慢安静、变暗；龙走后慢慢恢复 ----
      dread = smooth((t - T.dread) / 3) * (1 - smooth((t - T.leave - 6) / 4));
      // ---- 深处的光：等待时慢慢变亮，龙走后慢慢暗下去（比之前弱：不要让人觉得亲切） ----
      glow = smooth((t - T.glowIn) / 4) * (1 - smooth((t - T.ripple) / 4.5)) * .6;
      coin.material.emissive.setRGB(.25, .2, .1).multiplyScalar(smooth((t - T.glowIn) / 3) * (1 - smooth((t - T.take) / .4)) * .6);

      // ---- 龙 ----
      if (t >= T.dragon) {
        dragon.visible = head.visible = true;
        // 头走过的路程：从最深处一路游上来，停在许愿签下方 → 转身后越游越快
        let d;
        const d0 = lurkD - 3, vA = .3 * (takeD - d0) / (T.arrive - T.dragon);   // 到许愿签下面时还剩一点速度（0.3 米/秒左右），接着自然地转进离开的动作，没有"刹停"
        if (t < T.arrive) { const u = (t - T.dragon) / (T.arrive - T.dragon); d = lerp(d0, takeD, .7 * (1 - (1 - u) * (1 - u)) + .3 * u); }   // 一路游上来，越接近许愿签越慢，没有停顿
        else if (t < T.leave) d = takeD + vA * (t - T.arrive);
        else { const x = t - T.leave; d = takeD + vA * (T.leave - T.arrive + x) + EXIT_V * (x + EXIT_TAU * (Math.exp(-x / EXIT_TAU) - 1)); }   // 速度从 0 慢慢加到 EXIT_V：先是缓缓弓身，然后越游越快
        waveAmp = lerp(1, 2.1, smooth((t - T.leave) / 2.5));
        legTuck = smooth((t - T.leave) / 1.2);   // 转身游走时身体扭得更厉害
        updateDragon(d, t);
        const look = smooth((t - T.arrive + .9) / .9) * (1 - smooth((t - T.leave) / .7));
        updateHead(d, t, look, group.position);
        if (d - LEN > pathLen - 3.5) dragon.visible = head.visible = false;
        if (hP.y < -10.8) head.visible = false;   // 龙头沉到井底最深的黑暗里就不画了（再往下会插进井底的地面）   // 尾巴进了最后几米（已经在井底的黑暗里）就不用再画了
        // 轮廓上的青光：主视角隔着水面反光也认得出轮廓；夜里水面暗，光要弱得多
        // 眼睛：潜伏时在黑暗里慢慢睁开（先是一条缝），转身后慢慢暗下去
        const open = smooth((t - T.dragon - 1.2) / 1.4);
        for (const e of eyes) { const k = e.userData.size ?? 1; e.scale.set(k, k * lerp(.08, 1, open), k); }
        // 眼睛只在潜伏、还在最深的黑暗里的时候有一点微光（否则一点都看不到它）；浮上来之后就只是一对被照亮的眼睛，不发光
        eyeMat.emissiveIntensity = smooth((t - T.dragon - .8) / .9) * (1 - smooth((t - T.dragon - 3.4) / 1.6)) * lerp(.5, 1., day) * (sculpt ? .6 : 1);
        // 张嘴：基础姿势是合上的；龙头往前探的同一瞬间张开，衔住后猛地合上
        const gape = smooth((t - T.take + .3) / .22) * (1 - smooth((t - T.take - .02) / .16));   // 嘴一直是合着的，只在咬之前一瞬间张开，咬住后立刻合上
        jaw.rotation.x = gape * .6;
        if (sculpt) sculpt.morphTargetInfluences[0] = gape;
        // 光照：一盏从斜上方照下来的方向光，整条龙受光一样；越往深处越暗全靠 deepFade，所以它是从黑暗里浮出来、又沉回黑暗里的
        const lampK = smooth((t - T.dragon) / 1.5) * (1 - smooth((t - T.end + 3) / 2));
        shared.uLampDir.value.set(toCam.x * .5, 1, toCam.z * .5).normalize();
        shared.uLampCol.value.setRGB(.95, 1.05, 1.05).multiplyScalar(lampK);
        // 转身时：头翻过弓顶的时候水面被搅动一下，身体拖过的时候再搅一下
        if (t >= T.leave + 1.6) once('crest', () => { ripples.add(crest.x, crest.z, .6, .3); sound.leave?.(); });
        if (t >= T.leave + 4.2) once('crest2', () => ripples.add(crest.x * .7, crest.z * .7, .8, .16));
        if (t >= T.arrive) once('thump', sound.thump);
        if (t >= T.take + .2) once('bite', sound.bite);
      }
      if (!took && t >= T.take) {            // 龙经过：许愿签被带走
        took = true;
        const mp = motes.geometry.attributes.position;
        for (let i = 0; i < 3; i++) mp.setXYZ(i, group.position.x + (Math.random() - .5) * .25, group.position.y + Math.random() * .3, group.position.z + (Math.random() - .5) * .25);
        mp.needsUpdate = true;   // 微光粒子不再显示：它们会停在龙头前面，看起来像龙头在发光
      }
      if (took) {   // 许愿签缩进龙的嘴里
        const u = clamp((t - T.take) / .35);
        group.scale.setScalar(1 - u);
        group.position.lerp(mouth.set(0, -.1, sculpt ? .4 : .5).applyMatrix4(head.matrix), u * .6);
      }
      if (took && t > T.take + .4) group.visible = false;

      // 微光：缓慢上浮、闪烁、熄灭
      if (motes.visible) {
        const u = (t - T.take) / 6;
        motes.material.opacity = smooth(u * 6) * (1 - smooth(u)) * (.7 + .3 * Math.sin(t * 5));
        const mp = motes.geometry.attributes.position;
        for (let i = 0; i < 3; i++) mp.setY(i, mp.getY(i) + dt * .05);
        mp.needsUpdate = true;
        if (u > 1) motes.visible = false;
      }

      // 水面一圈很大、很慢的涟漪
      if (!rippled && t >= T.ripple) { rippled = true; ripples.add(land.x * .5, land.z * .5, .9, .22); }

      if (t >= T.end) { t = -1; mode = 'idle'; dread = 0; shared.uLampCol.value.setRGB(0, 0, 0); group.visible = false; dragon.visible = false; head.visible = false; motes.visible = false; glow = 0; group.userData.splashed = false; }
    },
  };
}
