// 许愿：写在许愿签上的愿望，挂着铜钱投进池里，慢慢沉下去；
// 四周渐渐安静下来（光变暗、风停、萤火虫躲起来），池底深处先亮起一对眼睛，
// 青龙从正下方缓缓浮上来，张口衔走许愿签，转身潜回深处。
// 愿望文字不保存、不上传：画到许愿签上之后就只存在于这一次的画面里。
import * as THREE from 'three';
import { patch } from './patch.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);

// 时间轴（秒，从投入那一刻算起）
const T = {
  fall: .85,      // 从空中落到水面
  float: 1.7,     // 在水面上漂一下，开始下沉
  sunk: 8,        // 沉到预定深度
  dread: 3,       // 四周开始安静、变暗（"屏住呼吸"）
  glowIn: 4,      // 深处的光开始变亮
  dragon: 5.6,    // 龙开始从最深处往上游（还看不见）
  lurk: 7.8,      // 停在池底附近：只看得到一对眼睛睁开
  rise: 9.8,      // 缓缓浮上来
  arrive: 12.4,   // 龙头停在许愿签正下方，抬头看着它
  take: 13.2,     // 张口衔走许愿签
  leave: 14.4,    // 转身，游回深处
  ripple: 17,     // 水面泛起一圈大涟漪
  end: 23,
};
const PAPER_W = .24, PAPER_H = .7, STRING = .14, SINK_Y = -.9;

// ---------- 许愿签：红纸、金边，竖排写字 ----------
function paperTexture(text) {
  const W = 256, H = 742, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#9c1d18'; g.fillRect(0, 0, W, H);
  // 纸纹：细小的明暗纤维
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,210,190'},${Math.random() * .06})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 4 + Math.random() * 14);
  }
  g.strokeStyle = '#d9b25a'; g.lineWidth = 5; g.strokeRect(12, 12, W - 24, H - 24);
  g.lineWidth = 1.5; g.strokeRect(22, 22, W - 44, H - 44);
  // 顶上的小孔（挂绳的地方）
  g.fillStyle = '#3a0907'; g.beginPath(); g.arc(W / 2, 46, 9, 0, 7); g.fill();
  // 竖排：从右往左一列列写
  const chars = [...text.trim()].slice(0, 30);
  const perCol = chars.length <= 10 ? 10 : 12, cols = Math.max(1, Math.ceil(chars.length / perCol));
  const size = Math.min(58, Math.floor((H - 130) / perCol), Math.floor((W - 60) / cols));
  g.fillStyle = '#f3dc9c'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${size}px "STKaiti","KaiTi","Kaiti SC","楷体",serif`;
  const colW = (W - 60) / cols, top = 84 + size / 2;
  chars.forEach((ch, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    g.fillText(ch, W - 30 - colW * (col + .5), top + row * size * 1.04);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
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
// HS：龙头放大倍数，BS：身体粗细倍数（主视角离水面 11 米，原尺寸的龙头只有几十像素）
const RINGS = 150, SEGS = 14, LEN = 7.2, HS = 1.75, BS = 1.5;
const VPR = SEGS + 1;          // 每一圈的顶点数：多一个和第一个重合的点，贴图在接缝处才能连续
const U_REP = 2, V_TILE = 1.1; // 鳞片贴图：绕身体一圈重复 2 次，沿身体每 1.1 米重复一次（鳞片跟着身体走，不会在身上滑动）
const HEAD_TILE = .32;         // 龙头细鳞：每 0.32（头的局部单位）重复一次
function bodyRadius(s) {   // s：0 = 头的中心（埋在头骨里），1 = 尾尖
  if (s < .12) return lerp(.15, .21, smooth(s / .12));           // 颈：从头骨后面长出来
  if (s < .35) return lerp(.21, .29, smooth((s - .12) / .23));   // 身体最粗处
  return lerp(.29, .015, Math.pow((s - .35) / .65, .8));         // 一路收到尾尖
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
    normalScale: new THREE.Vector2(1.6, 1.6), roughness: set ? .75 : .38, metalness: set ? .35 : .18, emissive: new THREE.Color(), emissiveIntensity: 1,
  }), { rim: true, absorb: .45 });
  const dBackMat = scaleMat(tex?.back), bellyMat = scaleMat(tex?.belly), headMat = scaleMat(tex?.head);
  const plainMat = patch(new THREE.MeshStandardMaterial({ roughness: .45, metalness: .18, emissive: new THREE.Color(), emissiveIntensity: 1 }), { rim: true, absorb: .45 });
  const dMats = [dBackMat, bellyMat, headMat, plainMat];
  const dragon = new THREE.Mesh(dGeo, [dBackMat, bellyMat]);
  dragon.frustumCulled = false; dragon.visible = false;
  scene.add(dragon);

  // 龙头（跟着身体最前面那一节走，朝向沿着游动方向；停下来时抬头看着许愿签）
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(boxUV(makeHeadGeometry(), HEAD_TILE), headMat);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffc24a, emissiveIntensity: 0 });   // 不受水的吸收：深处也看得见一对眼睛
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

  let phase0 = 0, t = -1, land = new THREE.Vector3(), path = null, pathLen = 1, glow = 0, dread = 0, took = false, rippled = false, phase = 0;
  const fired = new Set();   // 已经触发过的声音
  const once = (k, f) => { if (!fired.has(k)) { fired.add(k); f?.(); } };
  const mouth = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), P = new THREE.Vector3(), Tn = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3();

  let takeD = 0, lurkD = 0;
  const toCam = new THREE.Vector3(0, 0, 1), awayRef = new THREE.Vector3();
  function buildPath() {
    // 从许愿签正下方的深处笔直地浮上来（正对着镜头，身体垂向黑暗里），停在签下面抬头看着它；
    // 然后向一侧转身，潜回深处。全程不浮出水面
    const p = new THREE.Vector3(land.x, SINK_Y, land.z);
    toCam.set(land.x, 0, land.z).normalize();
    if (toCam.lengthSq() < .01) toCam.set(0, 0, 1);
    const side = new THREE.Vector3(-toCam.z, 0, toCam.x);
    const at = (c, sd, y) => p.clone().addScaledVector(toCam, c).addScaledVector(side, sd).setY(y);
    const pts = [
      at(-.5, 0, -4.8),
      at(-.47, 0, -2.75),             // 潜伏：贴着池底，只看得到眼睛
      at(-.45, 0, SINK_Y - .95),      // 停在这里：头骨中心在许愿签正下方略靠后，吻端朝上、刚好到签底下
      at(-.2, .6, SINK_Y - .5),       // 转身：头向一侧低下去
      at(-.75, .9, -2.0),
      at(-1.55, .25, -2.9),
      at(-1.3, -.6, -4.1),
    ];
    // 池子是个碗：越往边上池底越浅。中间几个点要留在池底上面，只有起点、终点可以在池底以下（像从深不见底的地方浮上来）
    pts.forEach((q, i) => {
      const r = Math.hypot(q.x, q.z); if (r > 1.7) { q.x *= 1.7 / r; q.z *= 1.7 / r; }
      if (i > 0 && i < pts.length - 1) q.y = Math.max(q.y, floorH(q.x, q.z) + (i === 1 ? .12 : .5));
    });
    path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    pathLen = path.getLength();
    // 停下来的位置（第 3 个控制点）在路径上的弧长
    const arcOf = target => {
      let best = 1e9, at = 0; const q = new THREE.Vector3();
      for (let i = 0; i <= 400; i++) { path.getPointAt(i / 400, q); const dd = q.distanceToSquared(target); if (dd < best) { best = dd; at = i / 400 * pathLen; } }
      return at;
    };
    takeD = arcOf(pts[2]); lurkD = arcOf(pts[1]);
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
  function updateDragon(head, time) {
    for (let i = 0; i < RINGS; i++) {
      const s = i / (RINGS - 1);
      along(head - s * LEN);
      // 左右摆动：一道从头传到尾的波（尾巴摆得更大）
      N.crossVectors(frameRef(Tn, ref), Tn).normalize();
      const wave = Math.sin(s * 11 - time * 3.2) * (.05 + .2 * s * s);
      P.addScaledVector(N, wave);
      B.crossVectors(Tn, N).normalize();
      const r = bodyRadius(s) * BS;
      for (let j = 0; j <= SEGS; j++) {
        const th = ringAngle(j), cy = Math.cos(th), sx = Math.sin(th);
        // 背上的鳍：朝上的一侧一排锯齿（头和尾巴上没有）
        const fin = Math.pow(Math.max(cy, 0), 10) * (.5 + .5 * Math.sin(s * 160)) * .9 * smooth((s - .1) / .06) * (1 - smooth((s - .8) / .15));
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

  const hF = new THREE.Vector3(), hN = new THREE.Vector3(), hB = new THREE.Vector3(), hP = new THREE.Vector3(), toPaper = new THREE.Vector3();
  function updateHead(d, time, look, paperPos) {
    along(d);
    hF.copy(Tn);
    N.crossVectors(frameRef(Tn, ref), Tn).normalize();
    hP.copy(P).addScaledVector(N, Math.sin(-time * 3.2) * .05);   // 和身体第一节一样的左右摆
    if (look > 0) { toPaper.subVectors(paperPos, hP).normalize(); hF.lerp(toPaper, look * .75).normalize(); }   // 停下来时抬头看着许愿签
    hN.crossVectors(frameRef(hF, ref), hF).normalize(); hB.crossVectors(hF, hN);
    head.matrix.makeBasis(hN, hB, hF).scale(new THREE.Vector3(HS, HS, HS)).setPosition(hP);
    head.matrixAutoUpdate = false; head.matrixWorldNeedsUpdate = true;
    updateWhiskers(time);
  }

  return {
    get busy() { return t >= 0; },
    get glow() { return glow; },
    get dread() { return dread; },   // 0～1：四周安静、变暗的程度（main.js 用它压暗光线、停风、调低饱和度、放大轰鸣）
    // where：落点（水面上的 x, z）；opts.facing：许愿签正面朝向（朝着镜头）
    start(text, where, opts = {}) {
      if (opts.facing !== undefined) phase0 = opts.facing;
      paperMat.map?.dispose();
      paperMat.map = paperTexture(text); paperMat.emissiveMap = paperMat.map; paperMat.needsUpdate = true;
      land.set(where.x, 0, where.z);
      for (const m of dMats) m.emissive.set(0x1f8a74);   // 轮廓上的青光
      // 贴图本身已经是墨青色：只略微提亮（水会吃掉一大半光）；没贴图的部分用纯墨青色
      for (const m of [dBackMat, bellyMat, headMat]) m.map ? m.color.setRGB(1.7, 1.9, 1.85) : m.color.set(0x173f38);
      plainMat.color.set(0x173f38);
      buildPath();
      t = 0; took = false; rippled = false; fired.clear(); phase = phase0 + (Math.random() - .5) * .5;
      group.visible = true; group.scale.setScalar(1);
      dragon.visible = false; head.visible = false; motes.visible = false;
    },
    update(dt, env = {}) {
      if (t < 0) return;
      const day = env.day ?? 1;
      t += dt;
      const sway = Math.sin(t * 1.3 + phase), sway2 = Math.sin(t * .8 + phase * 2);

      // ---- 许愿签 ----
      if (t < T.fall) {                      // 从空中落下，翻转着
        const u = t / T.fall;
        group.position.set(land.x - .25 * (1 - u), lerp(1.3, 0, u * u), land.z + .15 * (1 - u));
        group.rotation.set(lerp(-1.2, -.3, u) + Math.sin(u * 9) * .25, phase, Math.sin(u * 7) * .3);
      } else if (t < T.float) {              // 落水：溅起涟漪，在水面附近晃一下
        if (!group.userData.splashed) {
          group.userData.splashed = true;
          sound.splash?.();
          ripples.add(land.x, land.z, .2, .45);
          for (let i = 0; i < 4; i++) ripples.add(land.x + (Math.random() - .5) * .3, land.z + (Math.random() - .5) * .3, .06, .15);
        }
        const u = (t - T.fall) / (T.float - T.fall);
        group.position.set(land.x, lerp(0, -.18, u), land.z);
        group.rotation.set(lerp(-.3, -.9, Math.sin(u * Math.PI)), phase + u * .3, .2 * sway);
      } else if (!took || t < T.take + .35) { // 摇摆着下沉：铜钱在下面拽着，纸在上面飘
        const u = easeOut((t - T.float) / (T.sunk - T.float));
        const depth = lerp(-.18, SINK_Y, u);
        group.position.set(land.x + sway * .07 * u, depth, land.z + sway2 * .05 * u);
        group.rotation.set(.18 * sway2, phase + .3 + t * .05, .22 * sway);
      }

      // 入水后：越深越暗、越偏青；字迹微微发光
      const dep = clamp(-group.position.y / 1.4);
      const tint = [lerp(1, .32, dep), lerp(1, .55, dep), lerp(1, .6, dep)];
      paperMat.color.setRGB(...tint); backMat.color.setRGB(.55 * tint[0], .1 * tint[1], .08 * tint[2]);
      paperMat.emissiveIntensity = smooth(dep * 2) * .12;

      // ---- 压迫感：许愿签沉下去之后，四周慢慢安静、变暗；龙走后慢慢恢复 ----
      dread = smooth((t - T.dread) / 3) * (1 - smooth((t - T.leave - 1.5) / 3.5));
      // ---- 深处的光：等待时慢慢变亮，龙走后慢慢暗下去（比之前弱：不要让人觉得亲切） ----
      glow = smooth((t - T.glowIn) / 4) * (1 - smooth((t - T.ripple) / 4.5)) * .6;
      coin.material.emissive.setRGB(.25, .2, .1).multiplyScalar(smooth((t - T.glowIn) / 3) * (1 - smooth((t - T.take) / .4)) * .6);

      // ---- 龙 ----
      if (t >= T.dragon) {
        dragon.visible = head.visible = true;
        // 头走过的路程：从最深处游到池底附近停下（只露眼睛）→ 缓缓浮上来，停在许愿签下方 → 转身后越游越快
        let d;
        if (t < T.lurk) { const u = (t - T.dragon) / (T.lurk - T.dragon); d = lurkD - 3 * (1 - u) * (1 - u); }
        else if (t < T.rise) d = lurkD + .05 * smooth((t - T.lurk) / (T.rise - T.lurk));
        else if (t < T.arrive) d = lerp(lurkD + .05, takeD, smooth((t - T.rise) / (T.arrive - T.rise)));
        else if (t < T.leave) d = takeD + .06 * smooth((t - T.arrive) / (T.leave - T.arrive));
        else { const x = t - T.leave; d = takeD + .06 + (x < 1.5 ? .55 * x * x : .55 * 2.25 + 1.65 * (x - 1.5)); }
        updateDragon(d, t);
        const look = smooth((t - T.arrive + .9) / .9) * (1 - smooth((t - T.leave) / .7));
        updateHead(d, t, look, group.position);
        if (d - LEN > pathLen + .5) dragon.visible = head.visible = false;
        // 轮廓上的青光：主视角隔着水面反光也认得出轮廓；夜里水面暗，光要弱得多
        const ei = (.8 + .25 * Math.sin(t * 1.4)) * lerp(.35, 1, day) * smooth((t - T.rise + .8) / 2);
        for (const m of dMats) m.emissiveIntensity = ei;
        // 眼睛：潜伏时在黑暗里慢慢睁开（先是一条缝），转身后慢慢暗下去
        const open = smooth((t - T.lurk) / 1.1);
        for (const e of eyes) { const k = e.userData.size ?? 1; e.scale.set(k, k * lerp(.08, 1, open), k); }
        eyeMat.emissiveIntensity = smooth((t - T.lurk + .3) / .9) * (1 - smooth((t - T.leave - 1.2) / 1.2)) * lerp(1.6, 3.5, day) * (sculpt ? .6 : 1);
        // 张嘴：衔走许愿签前慢慢张开，衔住后猛地合上
        const gape = smooth((t - T.take + .9) / .6) * (1 - smooth((t - T.take - .1) / .2));
        jaw.rotation.x = gape * .6;
        if (sculpt) sculpt.morphTargetInfluences[0] = gape;
        if (t >= T.arrive) once('thump', sound.thump);
        if (t >= T.take + .2) once('bite', sound.bite);
      }
      if (!took && t >= T.take) {            // 龙经过：许愿签被带走
        took = true;
        const mp = motes.geometry.attributes.position;
        for (let i = 0; i < 3; i++) mp.setXYZ(i, group.position.x + (Math.random() - .5) * .25, group.position.y + Math.random() * .3, group.position.z + (Math.random() - .5) * .25);
        mp.needsUpdate = true; motes.visible = true;
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

      if (t >= T.end) { t = -1; dread = 0; group.visible = false; dragon.visible = false; head.visible = false; motes.visible = false; glow = 0; group.userData.splashed = false; }
    },
  };
}
