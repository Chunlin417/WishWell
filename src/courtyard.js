// 许愿之后来到的小院（第一视角，可以在院子里走动）。固定的清晨，不跟随真实时间和天气。
// 左边一棵矮而宽的古树（枝下稀疏地挂着木牌），右边一尊青铜香炉，正对面是小殿（里面是水池和青铜猫像，隔着门窗的格子看得见）；院墙外是树林、远山和晨雾。
// 材质在 courtyardMats.js，气氛（天空、远山、光柱、烟、雾）在 courtyardFx.js，古树和树叶在 courtyardTree.js，
// 木牌在 courtyardPlaques.js，小草和蕨在 courtyardPlants.js，殿里的水池和猫像在 courtyardHall.js。
// 坐标：+z 是院门（南），-z 是小殿（北）；单位是米
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { loadCourtTextures, triMat, bronzeMat, roofMat, roofGeo } from './courtyardMats.js';
import { createHallInterior, REFLECT_LAYER } from './courtyardHall.js';
import { createSky, createBackdrop, createCanopyShade, createShafts, createDust, createSmoke, createMist } from './courtyardFx.js';
import { installHeightFog, heightFog } from './heightFog.js';
import { loadTree, createLeafKit, createGrove } from './courtyardTree.js';
import { createPlaques } from './courtyardPlaques.js';
import { createIncense } from './courtyardIncense.js';
import { createBurner } from './courtyardBurner.js';
import { createPlantCards, createHangCards, createDecals } from './courtyardPlants.js';
import { ATLAS } from './qualityAtlases.js';
import { loadProps, placeProps } from './courtyardProps.js';
import { createRealm } from './hallRealm.js';
import { HALL_ACCESS, constrainHallMove } from './courtyardMovement.js';

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = t => { t = clamp(t); return t * t * (3 - 2 * t); };
const UP = new THREE.Vector3(0, 1, 0);
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---- 布局（改这里就能调整院子的大小和物件位置）----
const L = {
  halfX: 7.5,          // 院墙内侧到中线的距离（院子宽 15 米）
  south: 6.2,          // 南墙（院门所在）的 z
  north: -18.4,        // 北墙在殿的后檐外面
  wallH: 1.55, wallT: .55,
  gateHalf: 1.2,       // 院门半宽
  hallFront: HALL_ACCESS.front,
  stepsZ: HALL_ACCESS.front + HALL_ACCESS.steps * HALL_ACCESS.stepDepth,
  doorOpen: 0,         // 殿门走近会自己打开；没点香，进去是平常的殿；点了香，进去就是另一个天地（hallRealm.js）
  hallDepth: 8,        // 殿的进深（米）：只能隔着窗看，太深了里面只是一片黑，猫像也小成一个点
  pool: { halfX: 3.6, front: -8.25, back: -11.3, depth: .22, drop: .09, border: .24 },   // 浅池向供桌延伸，保留入口蒲团平台
  statue: { z: -13.15, height: 1.65 },   // 主体后退并收小，让金月和周边空间露出来
  tree: { x: -3.7, z: -1.5, scale: 6.6, yaw: 0 },   // 古树：树干中心的位置、缩放（要和 scripts/build-tree.mjs 的缩放参数一致）、绕树干转多少
  burner: { x: 3.15, z: -.75, scale: 1.24, scaleY: 1.24 },   // 香炉的位置、横向大小、竖向大小（竖向 1 = 炉口约 1.2 米高）；比原来小一圈、往右后让一点，让出进院第一眼的前景
  rocks: [[-6.1, 4.2, .8], [6.0, -3.4, .9], [6.2, 4.6, .55], [-6.2, -3.9, .65], [5.3, 5.0, .34]],   // 院子边角的苔石：x, z, 半径
  shade: { dx: .35, dz: .55, r: 5.9 },              // 树影集中在古树和西侧石板，给甬道留出晨光
  // 光柱落地的位置、宽、长：树干旁、香炉、殿前、院子中间各一道
  shafts: [[-2.7, -.4, 1.15, 8, { k: .83 }], [2.8, -.3, .78, 6.4, { k: .32 }], [.6, -4.1, 1.5, 8.6, { k: .50 }], [-.5, 1.9, .64, 6.8, { k: .35 }]],
  start: { x: .3, z: 5.4 }, stop: { x: .4, z: 4.5 },   // 进院时站的位置、镜头自己往前走到的位置
  // 院外的树林：x, z, 树冠中心的高度, 树冠半径
  grove: [
    [-10.5, 3, 3.1, 3.2], [-11.5, -3, 3.9, 3.6], [-10.2, -8.5, 3.5, 3.4], [-13.5, 0, 5.3, 4],
    [10.5, 2, 3.3, 3.2], [11.5, -4, 4.3, 3.8], [10.2, -9.5, 3.5, 3.3], [13.5, -1, 5.7, 4.2],
    [-5, -21.5, 5.8, 4], [1.5, -22.5, 6.6, 4.4], [7, -21, 5.4, 3.8], [-11.5, -16.5, 5.2, 3.6], [12, -17, 5.6, 3.8],
    [-6, 10, 3.5, 3.4], [6.5, 10.5, 3.9, 3.6], [-11.5, 8, 4.5, 3.6], [11.5, 8.5, 4.5, 3.6], [0, 14, 5.5, 4],
  ],
};
const PAVE_SCALE = 1 / 3.2, PAVE_JOINT = [.33, .4];   // 青石板贴图的尺寸（每米重复几次）和石缝的高度阈值（和 triMat 的 joint 一致）
const EYE = 1.62, BODY_R = .35, WALK = 1.6;   // 眼睛高度、人的半径、步行速度（米/秒，比一般游戏慢一些）
const FOV = 52, FOV_PORTRAIT = 68;            // 视野角（竖直方向）：横屏、竖屏

// 把一张高度图读成可以查询的函数：isJoint(u, v, 阈值) —— (u, v) 是贴图坐标（和着色器里 texture2D 的坐标一致，v 向上）
async function sampleJoints(url) {
  const img = await createImageBitmap(await (await fetch(url)).blob());
  const W = 512, c = document.createElement('canvas'); c.width = c.height = W;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, W, W);
  const d = g.getImageData(0, 0, W, W).data;
  const fr = v => v - Math.floor(v);
  return (u, v, th) => d[(Math.floor((1 - fr(v)) * W) % W * W + Math.floor(fr(u) * W) % W) * 4] / 255 < th;
}

// 一块不规则的石头：把球面按噪声推出凹凸，压扁（flat 越小越扁），底部削平
function rockGeo(r, seed, flat = .68) {
  const g = mergeVertices(new THREE.IcosahedronGeometry(r, 4).deleteAttribute('uv').deleteAttribute('normal')), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 2.3 / r + seed) * Math.sin(v.y * 2.9 / r + seed * 1.7) * Math.sin(v.z * 2.1 / r + seed * .6) * .22 + Math.sin((v.x * 5.3 + v.z * 4.1) / r + seed * 2.3) * .05;
    v.multiplyScalar(1 + n); v.y = Math.max(v.y * flat, -r * .22 * flat / .68);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}
// 一段院墙：不是整齐的方块——墙顶高低起伏，墙面略有凹凸。len 沿墙的长度，alongX：这段墙沿 x 还是沿 z
function wallGeo(len, h, t, seed, alongX) {
  const segs = Math.max(4, Math.round(len / .35));
  const g = new THREE.BoxGeometry(alongX ? len : t, h, alongX ? t : len, alongX ? segs : 2, 4, alongX ? 2 : segs), p = g.attributes.position;
  const wave = a => Math.sin(a * 1.1 + seed) * .5 + Math.sin(a * 2.7 + seed * 1.7) * .3 + Math.sin(a * 6.1 + seed * .3) * .2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
    const a = alongX ? x : z, yf = y / h;
    y += (wave(a) * .2 + Math.max(0, wave(a * .37 + 4.) - .55) * -.5) * yf * yf;        // 墙顶起伏，偶尔塌下去一小段
    const bulge = wave(a * 1.9 + y * 2.3) * .045 * (alongX ? Math.sign(z) : Math.sign(x));   // 墙面凹凸
    if (alongX) z += bulge; else x += bulge;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

// onLight：点香（返回 { ok, text? }）；canLight：现在能不能点香（返回 { ok, text? }）；now：当前时间（毫秒，以后是服务器时间）
export function createCourtyard({ renderer, canvas, isMobile = false, onExit = () => {}, onLight = () => ({ ok: false }), canLight = () => ({ ok: false }), now = () => Date.now() }) {
  // 画质：手机（或网址带 ?q=low）用低档——浮尘少一些、远山的雾带少画一条、胶片颗粒淡一些；?q=high 强制高档
  const qParam = new URLSearchParams(location.search).get('q');
  const low = qParam === 'low' || (isMobile && qParam !== 'high');
  const scene = new THREE.Scene();
  const haze = new THREE.Color(0xb3bfaa);
  // 高度雾：贴地浓、往上薄，远处有一层底雾；殿里不起雾（见 heightFog.js）
  installHeightFog({ halfH: 1.2, clear: 4, hall: { halfX: 6.1, front: HALL_ACCESS.doorZ - .05, back: HALL_ACCESS.doorZ - L.hallDepth - .5, top: HALL_ACCESS.baseH + 5 } });
  scene.fog = heightFog(haze, .013, .003);   // 只在远处和墙根显出来：近处的东西要清清楚楚
  const camera = new THREE.PerspectiveCamera(FOV, 1, .05, 150);
  camera.rotation.order = 'YXZ';

  // 贴图：全部下载完再揭开白幕（最多等 8 秒）
  const manager = new THREE.LoadingManager();
  const texReady = new Promise(res => { manager.onLoad = res; setTimeout(res, 8000); });
  const tex = loadCourtTextures(renderer, manager, { low });
  let ready = null;   // 贴图和古树都下载完（见古树那一段）

  // ---------- 光照：固定的清晨，暖色的阳光从右上方斜照下来，穿过古树的枝叶；略偏向院门一侧，殿的正面和树干有一层斜擦过去的光 ----------
  const sunDir = new THREE.Vector3(8, 8.5, 2.4).normalize();
  const sun = new THREE.DirectionalLight(0xffd7a4, 3.4);
  sun.position.copy(sunDir).multiplyScalar(40); sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(isMobile ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 90 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .03;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight(0xc2d0da, 0x5c6242, .85); scene.add(hemi);
  // 地面和院墙反上来的暖光：从院门一侧低低地补一点，殿的正面、树干朝着人的一面不至于一片黑（不投影）
  const fill = new THREE.DirectionalLight(0xffe2bd, .55); fill.position.set(3, 4, 10); scene.add(fill);

  const sky = createSky(haze, sunDir), backdrop = createBackdrop(haze, sunDir, { mistBands: low ? 1 : 2 });
  scene.add(sky, backdrop);
  // 殿里水面的倒影只画 REFLECT_LAYER 这一层：灯光、天空、远山也算在里面（倒影里的窗外才不是黑的）
  for (const o of [sun, hemi, fill, sky, ...backdrop.children]) o.layers.enable(REFLECT_LAYER);
  // 环境光贴图：用天空和一块地面色生成一次（青铜、湿石板的反光靠它）
  {
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(sky.geometry, sky.material));
    const floor = new THREE.Mesh(new THREE.CircleGeometry(90, 24), new THREE.MeshBasicMaterial({ color: 0x3f4433 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; envScene.add(floor);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, .03, .1, 120).texture;
    scene.environmentIntensity = .95;
    pmrem.dispose();
  }

  // ---------- 材质 ----------
  const { halfX, south, north, wallH, wallT, gateHalf } = L;
  const baseH = HALL_ACCESS.baseH;
  const M = (color, rough = .9) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const mat = {
    // 青石板：一张贴图 3.2 米见方（里面是一块块错缝的石板），石缝从高度图里找
    ground: triMat({ set: tex.paving, moss: tex.moss, scale: PAVE_SCALE, color: 0xe7e9e7, mossAmt: .86, mossAt: .6, wet: .88, roughMul: 1.05, joint: PAVE_JOINT,
      paving: { yard: [-halfX, halfX, north, south + wallT], tree: [L.tree.x, L.tree.z, 1.5], footpath: true } }),
    wall: triMat({ set: tex.wall, moss: tex.moss, scale: .4, mossAmt: .9, mossAt: .4, grime: 1, joint: [.12, .26] }),   // 干垒的石墙：一张贴图 2.5 米
    stone: triMat({ set: tex.rock, moss: tex.moss, scale: .45, mossAmt: .8, mossAt: .5, grime: .6 }),
    stoneClean: triMat({ set: tex.rock, moss: tex.moss, scale: .45, mossAmt: .6, mossAt: .7, grime: .3 }),   // 香炉的石基、柱础：苔少一些
    bark: triMat({ set: tex.bark, moss: tex.moss, scale: .42, color: 0xf2e8dc, mossAmt: .7, mossAt: .64, mossScale: .55, grime: .5, norK: 1.3 }),
    wood: triMat({ set: tex.wood, scale: .55, color: 0xcabba8, weather: .7, weatherY: baseH }),
    woodRed: triMat({ set: tex.lacquer, scale: .8, color: 0xffffff, weather: .25, weatherY: baseH }),   // 檐柱、门扇、窗框：剥落的旧红漆（露出底下的木头）
    // 殿门：整洁的深褐红木（用原来那套旧木材，只带一点水渍和磨损），比檐柱、窗框干净——参考图里门是最新的一件
    doorWood: triMat({ set: tex.wood, scale: .75, color: 0xffc9b0, weather: .15, weatherY: baseH, norK: .7 }),
    woodDark: triMat({ set: tex.wood, scale: .55, color: 0x8a7c70, weather: .4, weatherY: baseH }),
    hallWood: triMat({ set: tex.wood, scale: .7, color: 0xc2bdb0, weather: .68, weatherY: baseH, wood: true, norK: .48 }),
    hallBeam: triMat({ set: tex.wood, scale: .49, color: 0x9c978b, weather: .55, weatherY: baseH, wood: true, norK: .42 }),
    gateWood: triMat({ set: tex.wood, scale: .55, color: 0xc8b8a6, weather: .8, weatherY: 0 }),
    roof: roofMat(tex.roof), tileEnd: M(0x4a5052, .75), bronze: bronzeMat(),
    brass: new THREE.MeshStandardMaterial({ color: 0xb48a3a, metalness: .9, roughness: .34 }),   // 门环：磨亮的黄铜
    ash: M(0xb8b2a3, 1), stick: M(0x7a4630),
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.4, .35) }),
  };
  mat.stone.color.setScalar(.95); mat.stoneClean.color.setScalar(1.02);
  // 旧木材的素材偏暗（平均亮度只有 0.15 左右）：殿的正面又在屋檐的阴影里，提亮一些才看得出木纹和色差
  mat.doorWood.color.multiplyScalar(3.3); mat.doorPanel = mat.doorWood.clone(); mat.doorPanel.color.multiplyScalar(.68);   // 嵌板里面比线脚暗一档，看得出凹进去
  mat.doorPanel.customProgramCacheKey = mat.doorWood.customProgramCacheKey; mat.doorPanel.onBeforeCompile = mat.doorWood.onBeforeCompile; mat.doorPanel.defines = mat.doorWood.defines;   // 门在廊下的阴影里，木头本身要亮得多才看得出木色
  mat.wood.color.multiplyScalar(1.7); mat.woodDark.color.multiplyScalar(1.35); mat.gateWood.color.multiplyScalar(1.6);
  mat.hallWood.color.multiplyScalar(1.85); mat.hallBeam.color.multiplyScalar(1.65);
  const colliders = [];   // 圆形的障碍：{ x, z, r }
  let parent = scene;     // add() 把东西加到这里：平时是场景，搭香炉时换成香炉的组（整体缩放）
  const add = (geo, m, x, y, z, { cast = true, recv = true } = {}) => {
    const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = cast; o.receiveShadow = recv; parent.add(o); return o;
  };
  const box = (w, h, d, m, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, o);
  // 小模型（鸱吻、斗拱、石栏、石灯、门环、门钉，见 courtyardProps.js）：先留一个空组，模型下载完再换成实例
  const slots = [];
  const slot = (type, x, y, z, ry = 0, sc = 1, par = parent, attach = false) => { const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; g.scale.setScalar(sc); par.add(g); slots.push({ type, obj: g, attach }); return g; };
  // 一批同样的小方块（椽子、瓦当之类）：实例化，只画一次
  const batch = (geo, m, list) => {
    const im = new THREE.InstancedMesh(geo, m, list.length), mx = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    list.forEach(([p, q], i) => im.setMatrixAt(i, mx.compose(p, q || new THREE.Quaternion(), one)));
    im.castShadow = false; im.receiveShadow = true; parent.add(im); return im;
  };
  // 镂空的方格窗棂：w × h 的窗洞里横竖排开细木条（cell 米一格），看得穿、也投影。窗面在局部的 xy 平面，ry 把它转到墙的方向
  const barGeo = new THREE.BoxGeometry(1, 1, 1);
  const lattice = (w, h, x, y, z, ry = 0, par = parent, cell = .17, thickness = .028) => {
    const nx = Math.round(w / cell), ny = Math.round(h / cell), bars = [];
    for (let i = 1; i < nx; i++) bars.push([(i / nx - .5) * w, 0, thickness, h, .036]);
    for (let j = 1; j < ny; j++) bars.push([0, (j / ny - .5) * h, w, thickness, .03]);
    const im = new THREE.InstancedMesh(barGeo, mat.wood, bars.length), mx = new THREE.Matrix4();
    bars.forEach(([bx, by, sx, sy, sz], i) => im.setMatrixAt(i, mx.makeScale(sx, sy, sz).setPosition(bx, by, 0)));
    im.position.set(x, y, z); im.rotation.y = ry; im.castShadow = im.receiveShadow = true; par.add(im); return im;
  };
  // 一座四面坡的瓦顶：瓦面 + 檐下的望板 + 正脊 + 檐口一排瓦当（每垄筒瓦末端的圆瓦头）
  const tiledRoof = (w, d, h, x, y, z, opt) => {
    const geo = roofGeo(w, d, h, opt);
    add(geo, mat.roof, x, y, z);
    box(w - .5, .08, d - .5, mat.woodDark, x, y - .03, z);
    const rl = w * (opt.ridge ?? .45) + .3;
    box(rl, h * .14 + .08, .26, mat.roof, x, y + h + .02, z);
    for (const s of [-1, 1]) slot('chiwen', x + s * rl / 2, y + h - .02, z, s < 0 ? Math.PI / 2 : -Math.PI / 2, (h * .3 + .2) / .89);   // 正脊两头的鸱吻：张口咬住正脊
    const q = new THREE.Quaternion();
    batch(new THREE.CylinderGeometry(.052, .052, .035, 10), mat.tileEnd, geo.userData.eave.map(e =>
      [new THREE.Vector3(x + e.x + e.nx * .012, y + e.y + .03, z + e.z + e.nz * .012), q.clone().setFromUnitVectors(UP, new THREE.Vector3(e.nx, 0, e.nz))]));
  };

  // ---------- 地面：院里是湿润的青石板，石缝里是泥土和苔；墙根、树根周围长苔；院外是苔地 ----------
  const ground = add(new THREE.PlaneGeometry(90, 90), mat.ground, 0, 0, 0, { cast: false });
  ground.rotation.x = -Math.PI / 2;

  // ---------- 院墙：砌石的矮墙，墙顶高低起伏；东、西、北三面是整面，南面中间留出院门 ----------
  const zLen = south - north, zMid = (south + north) / 2, wx = halfX + wallT / 2;
  add(wallGeo(zLen + wallT * 2, wallH, wallT, 1.3, false), mat.wall, -wx, 0, zMid);
  add(wallGeo(zLen + wallT * 2, wallH, wallT, 4.1, false), mat.wall, wx, 0, zMid);
  add(wallGeo(halfX * 2, wallH, wallT, 7.7, true), mat.wall, 0, 0, north - wallT / 2);
  const pierW = .7, sideW = halfX - gateHalf - pierW;
  for (const s of [-1, 1]) add(wallGeo(sideW, wallH, wallT, 2.2 + s, true), mat.wall, s * (gateHalf + pierW + sideW / 2), 0, south + wallT / 2);

  // ---------- 院门：两个石砌的门垛，上面一道木梁、一座小瓦顶；两扇木门朝院里敞开，贴在墙上 ----------
  {
    const gz = south + wallT / 2, pierH = 2.5;
    for (const s of [-1, 1]) {
      box(pierW, pierH, .8, mat.wall, s * (gateHalf + pierW / 2), pierH / 2, gz);
      const hinge = new THREE.Group(); hinge.position.set(s * gateHalf, 0, south - .06); hinge.rotation.y = s * -2.92; scene.add(hinge);
      const leaf = new THREE.Mesh(new THREE.BoxGeometry(gateHalf, 2.3, .07), mat.gateWood); leaf.position.set(-s * gateHalf / 2, 1.2, 0); leaf.castShadow = leaf.receiveShadow = true; hinge.add(leaf);
      if (!low) for (const f of [-1, 1]) for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++)
        slot('door_stud', -s * gateHalf / 2 + (c - 1.5) * .24, .55 + r * .36, f * .035, f < 0 ? Math.PI : 0, 1, hinge);
    }
    box(gateHalf * 2 + pierW * 2 + .5, .28, .55, mat.gateWood, 0, pierH + .14, gz);    // 门梁
    box(gateHalf * 2, .1, .26, mat.gateWood, 0, .05, gz);                              // 门槛
    tiledRoof(gateHalf * 2 + pierW * 2 + 1.6, 2.1, .8, 0, pierH + .32, gz, { ridge: .62, lift: .28, tile: .22 });
  }

  // ---------- 小殿：前墙和两侧墙上是镂空的花格窗，殿门的上半截也是镂空的；里面是水池、苔石和青铜猫像（courtyardHall.js）----------
  let hall = null, hallGrp = null;
  const doorHinges = [], hallLights = {}, realmHide = [], realmOnly = [];
  {
    const W = 11.8, H = 4.9, D = L.hallDepth, front = L.hallFront, fz = HALL_ACCESS.doorZ, bz = fz - D / 2, top = baseH + H, pz = front - .45;
    const P = L.pool, pMid = (P.front + P.back) / 2, pLen = P.front - P.back, back = fz - D - .8, platformHalf = HALL_ACCESS.porchHalfX;
    const ix = W / 2 - .2, iz0 = fz - D + .2, iz1 = fz - .1, ceil = top - .14;   // 殿内的范围（x 方向的半宽、后墙和前墙内面的 z）、顶棚的高度
    const grp = new THREE.Group(); scene.add(grp); parent = grp;
    // 台基：中间留出水池的坑（前、后、左、右四块围着，坑底另垫一块）
    box(platformHalf * 2, baseH, front - P.front, mat.stone, 0, baseH / 2, (front + P.front) / 2);
    box(platformHalf * 2, baseH, P.back - back, mat.stone, 0, baseH / 2, (P.back + back) / 2);
    for (const s of [-1, 1]) box(platformHalf - P.halfX, baseH, pLen, mat.stone, s * (platformHalf + P.halfX) / 2, baseH / 2, pMid);
    box(P.halfX * 2, baseH - P.depth, pLen, mat.stone, 0, (baseH - P.depth) / 2 - .003, pMid);
    for (let i = 0; i < HALL_ACCESS.steps; i++) {
      const h = baseH - i * HALL_ACCESS.stepHeight;
      box(HALL_ACCESS.stairWidth, h, HALL_ACCESS.stepDepth, mat.stoneClean, 0, h / 2, front + (i + .5) * HALL_ACCESS.stepDepth);
    }
    // 殿里的地面：干的青石板，墙根和石缝里有一点苔
    const hallFloor = triMat({ set: tex.hallPaving, moss: tex.moss, scale: .55, color: 0xb8b3a3, mossAmt: .08, mossAt: .95, wet: .02, norK: .48, paving: { yard: [-ix, ix, iz0, iz1], tree: [0, 99, .1] } });
    hallLights.floor = hallFloor;   // setRealm 要改它的湿度
    const floorAt = (x0, x1, z0, z1) => { add(new THREE.PlaneGeometry(x1 - x0, z1 - z0), hallFloor, (x0 + x1) / 2, baseH + .004, (z0 + z1) / 2, { cast: false }).rotation.x = -Math.PI / 2; };
    floorAt(-ix, ix, P.front, iz1); floorAt(-ix, ix, iz0, P.back); floorAt(-ix, -P.halfX, P.back, P.front); floorAt(P.halfX, ix, P.back, P.front);

    // 一面墙：沿 x（alongX）或沿 z，从 a0 到 a1，c 是它在另一个方向上的位置；holes：[[洞的两端 h0, h1, 下沿 y0, 上沿 y1], …]（按位置从小到大排）
    const wall = (alongX, a0, a1, c, holes = []) => {
      const seg = (s0, s1, y0, y1) => { if (s1 - s0 > .01 && y1 - y0 > .01) box(alongX ? s1 - s0 : .2, y1 - y0, alongX ? .2 : s1 - s0, mat.wood, alongX ? (s0 + s1) / 2 : c, (y0 + y1) / 2, alongX ? c : (s0 + s1) / 2); };
      let at = a0;
      for (const [h0, h1, y0, y1] of holes) { seg(at, h0, baseH, top); seg(h0, h1, baseH, y0); seg(h0, h1, y1, top); at = h1; }
      seg(at, a1, baseH, top);
    };
    // 一扇花格窗：窗框四根木条（比墙厚一点，里外都看得见）+ 镂空的窗棂。m：窗中心沿墙的位置，w：宽，y0 / y1：下沿、上沿
    const windowAt = (alongX, m, c, w, y0, y1) => {
      const bar = (len, h, a, y) => box(alongX ? len : .28, h, alongX ? .28 : len, mat.woodRed, alongX ? a : c, y, alongX ? c : a);
      for (const y of [y0 - .03, y1 + .03]) bar(w + .22, .1, m, y);
      for (const e of [-1, 1]) bar(.1, y1 - y0 + .06, m + e * (w / 2 + .03), (y0 + y1) / 2);
      lattice(w, y1 - y0, alongX ? m : c, (y0 + y1) / 2, alongX ? c : m, alongX ? 0 : Math.PI / 2, parent, .3);
    };
    // 墙：后墙是整面；正面留出门洞和左右两扇窗；两侧各三扇大窗（清晨日光从东窗照进来）
    const winF = [baseH + 1.1, baseH + 3.65], winS = [baseH + 1, baseH + 3.6], sideZ = [fz - 6.6, fz - 4.0, fz - 1.4];
    const rowZ = [fz - 2.6, fz - 5.3];   // 殿里两排立柱和大梁的位置；后面那一排的梁下挂帷幔
    realmHide.push(box(W, H, .2, mat.wood, 0, baseH + H / 2, fz - D + .1));   // 后墙：进了"洞天"就敞开成云海
    wall(true, -W / 2, W / 2, fz, [[-4.9, -2, ...winF], [-1.3, 1.3, baseH, top - .08], [2, 4.9, ...winF]]);
    for (const s of [-1, 1]) {
      windowAt(true, s * 3.45, fz, 2.9, ...winF);
      box(3.06, .7, .06, mat.woodDark, s * 3.45, baseH + .62, fz + .11);
      wall(false, fz - D, fz, s * (W / 2 - .1), sideZ.map(z => [z - 1.05, z + 1.05, ...winS]));
      for (const z of sideZ) windowAt(false, z, s * (W / 2 - .1), 2.1, ...winS);
      box(.12, 3.3, .28, mat.woodRed, s * 1.36, baseH + 1.65, fz);
    }
    box(2.84, .12, .28, mat.woodRed, 0, baseH + 3.36, fz);
    lattice(2.6, top - .08 - (baseH + 3.42), 0, (top - .08 + baseH + 3.42) / 2, fz, 0, parent, .23);
    box(W, .14, D, mat.woodDark, 0, top - .07, bz, { cast: false });                                              // 顶棚
    // 殿里的木构：靠墙的立柱、后墙的一道横枋、抬高的三根大梁和两道檩条；后墙根一条长凳
    const columnZ = [iz1 - .1, fz - D / 3, fz - D * 2 / 3, iz0 + .1];
    for (const z of rowZ) {
      for (const side of [-1, 1]) {
        const x = side * 4.35;
        box(.36, ceil - baseH, .36, mat.woodDark, x, (ceil + baseH) / 2, z);
        box(.54, .28, .54, mat.stoneClean, x, baseH + .14, z);
        for (let tier = 0; tier < 3; tier++) box(.54 + tier * .24, .12, .4, mat.woodDark, x, ceil - .56 + tier * .13, z);
      }
      box(8.9, .32, .28, mat.woodDark, 0, ceil - .24, z);
    }
    for (const s of [-1, 1]) {
      for (const z of columnZ) box(.24, ceil - baseH, .24, mat.woodDark, s * (ix - .1), (ceil + baseH) / 2, z);
      box(.22, ceil - baseH, .18, mat.woodDark, s * 2.6, (ceil + baseH) / 2, iz0 + .06);
      box(.2, .18, iz1 - iz0, mat.woodDark, s * 2.6, ceil - .09, (iz0 + iz1) / 2, { cast: false });
    }
    realmHide.push(box(ix * 2, .18, .14, mat.woodDark, 0, baseH + 3.4, iz0 + .05, { cast: false }));
    for (const [z, t] of [[fz - D * .2, .25], [fz - D * .5, .32], [fz - D * .8, .25]]) box(ix * 2, t, t * .85, mat.woodDark, 0, ceil - .14 - t / 2, z, { cast: false });
    // Rear wall kept clear for the moon relief.

    // Interior wood: real plank joints, ceiling boards, braced beams and stone feet.
    // All repeated details are instanced; the closed doors retain their original geometry.
    grp.traverse(o => {
      if (o.material === mat.wood) o.material = mat.hallWood;
      else if (o.material === mat.woodDark) o.material = mat.hallBeam;
    });
    const boards = [], boardW = .245, boardCount = Math.floor(ix * 2 / boardW);
    for (let i = 0; i < boardCount; i++) boards.push([new THREE.Vector3((i - (boardCount - 1) / 2) * boardW, (baseH + ceil) / 2, iz0 + .016)]);
    const panels = batch(new THREE.BoxGeometry(boardW - .012, ceil - baseH - .05, .032), mat.hallWood, boards); realmHide.push(panels);
    const tint = new THREE.Color();
    for (let i = 0; i < boards.length; i++) panels.setColorAt(i, tint.setScalar(.87 + .13 * Math.sin(i * 7.13) ** 2));
    const ceilingBoards = [];
    for (let z = iz0 + .12; z < iz1; z += .25) ceilingBoards.push([new THREE.Vector3(0, ceil - .016, z)]);
    batch(new THREE.BoxGeometry(ix * 2, .032, .238), mat.hallWood, ceilingBoards);
    for (const s of [-1, 1]) {
      for (const z of columnZ) {
        box(.29, .14, .29, mat.stoneClean, s * (ix - .08), baseH + .07, z);
        for (let tier = 0; tier < 3; tier++) {
          box(.27 + tier * .18, .085, .24, mat.hallBeam, s * (ix - .2), ceil - .5 + tier * .105, z);
        }
      }
      box(.08, .12, iz1 - iz0, mat.hallBeam, s * (ix - .035), baseH + .72, (iz0 + iz1) / 2);
    }
    // 殿里的光（整体偏暗，亮处只有猫像、壁画和灯笼）：
    //   - 门里一盏很弱的暖光：木构的轮廓和水池隐约可见；
    //   - 一束晨光从东窗的花格斜照进来，落在水池和石板路上（投影，花格的影子铺在地上）；
    //   - 猫脸接到东窗的侧光；两盏石灯笼各有一点暖光（见下面 hall 建好之后）。
    const glow = new THREE.PointLight(0xffd6a6, 9, 12, 1.4);   // 门关着：里面要亮一些，隔着格子才看得清
    glow.position.set(0, baseH + 1.5, fz - 3.6); grp.add(glow);   // 放低、往里：照亮蒲团、水池和供桌，不在门后的顶棚上打出一块亮斑
    RectAreaLightUniformsLib.init();
    const statueKey = new THREE.RectAreaLight();
    grp.add(statueKey);
    function lightStatue(moonlit) {
      statueKey.color.setHex(moonlit ? 0xffe2b4 : 0xffecd0);
      statueKey.intensity = moonlit ? 4 : 12;
      statueKey.width = moonlit ? 2.4 : 3.0;
      statueKey.height = moonlit ? 1.3 : 1.8;
      if (moonlit) statueKey.position.set(0, ceil - .35, L.statue.z + 2.5);
      else statueKey.position.set(2.15, baseH + 3.0, L.statue.z + 2.3);
      statueKey.lookAt(0, baseH + 2.1, L.statue.z);
    }
    lightStatue(false);
    const windowSun = new THREE.SpotLight(0xffdfaa, 46, 18, .5, .8, 2);
    // 光源放在窗外：看到的是照进来的光，而不是窗框上一块过曝的亮斑
    windowSun.position.set(ix + 1.6, baseH + 4.1, fz - 4.0);
    windowSun.target.position.set(-1.6, baseH, fz - 3.4);
    windowSun.castShadow = true;
    windowSun.shadow.mapSize.setScalar(isMobile ? 512 : 1024);
    windowSun.shadow.camera.near = .2; windowSun.shadow.camera.far = 18;
    windowSun.shadow.bias = -.0002; windowSun.shadow.normalBias = .015;
    grp.add(windowSun, windowSun.target);
    Object.assign(hallLights, { glow, lightStatue, windowSun });
    // 檐柱（旧红漆）、柱础、柱头上的斗拱（简化成两层木块）、额枋
    for (const x of [-4.95, -1.65, 1.65, 4.95]) {
      colliders.push({ x, z: pz, r: .22 });
      add(new THREE.CylinderGeometry(.16, .18, H - .3, 14), mat.woodRed, x, baseH + (H - .3) / 2, pz);
      add(new THREE.CylinderGeometry(.24, .28, .16, 14), mat.stoneClean, x, baseH + .08, pz);
      slot('dougong', x, top - .43, pz, 0, .6);   // 柱头上的斗拱
    }
    box(W + .4, .26, .26, mat.woodRed, 0, top - .52, pz); box(W + .2, .12, .16, mat.woodDark, 0, top - .72, pz);   // 额枋：一粗一细两道横梁
    const RW = W + 3.4, RD = D + 3.4, rz = bz + .2, ry = top + .06;
    tiledRoof(RW, RD, 2.7, 0, ry, rz, { ridge: .5, lift: .7 });
    // 檐下的椽子：一根根从檐檩伸到檐口，露出方头
    const rafter = [], qy = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
    for (let x = -RW / 2 + .5; x <= RW / 2 - .5; x += .3) for (const s of [-1, 1]) rafter.push([new THREE.Vector3(x, ry - .12, rz + s * (RD / 2 - .78)), null]);
    for (let z = -RD / 2 + .5; z <= RD / 2 - .5; z += .3) for (const s of [-1, 1]) rafter.push([new THREE.Vector3(s * (RW / 2 - .78), ry - .12, rz + z), qy]);
    batch(new THREE.BoxGeometry(.075, .075, 1.4), mat.woodDark, rafter);
    // 两扇门（朝里开，开多少见 L.doorOpen）：下半截是木板，上半截是镂空的窗棂
    for (const s of [-1, 1]) {
      const hinge = new THREE.Group(); hinge.position.set(s * 1.297, baseH, fz); hinge.rotation.y = s * -L.doorOpen; grp.add(hinge); parent = hinge; doorHinges.push({ hinge, s });
      const lw = 1.292, lh = 3.3, cx = -s * lw / 2;
      for (const e of [-1, 1]) box(.065, lh, .055, mat.doorWood, cx + e * (lw / 2 - .0325), lh / 2, 0);
      // 下半截：一块嵌板（四周是凸起的线脚，里面的板略低一些），上半截是方格窗棂
      for (const y of [.05, 1.3, lh - .05]) box(lw - .13, .09, .055, mat.doorWood, cx, y, 0);
      box(lw - .13, 1.16, .03, mat.doorWood, cx, .675, 0);
      const pw = lw - .3, ph = 1.0, py = .675;
      box(pw, ph, .04, mat.doorPanel, cx, py, -.004);                                   // 嵌板的底：略暗，像凹进去
      for (const e of [-1, 1]) {
        box(.05, ph + .05, .06, mat.doorWood, cx + e * (pw / 2 + .0), py, 0);            // 左右线脚
        box(pw + .05, .05, .06, mat.doorWood, cx, py + e * (ph / 2), 0);                 // 上下线脚
      }
      box(pw - .04, .035, .055, mat.doorWood, cx, py, .002);                            // 嵌板中间一道横档
      lattice(lw - .13, lh - 1.44, cx, (lh + 1.25) / 2, 0, 0, hinge, .2, .022);
      // 兽面门环：紧挨着两扇门的中缝，在嵌板上沿
      slot('door_ring', -s * (lw - .22), .6, .05, 0, 1.3, hinge, true);   // 跟着门扇一起转
      parent = grp;
    }
    // 殿里：水池、卵石、苔石、猫像、水面的倒影和水光
    hall = createHallInterior({ parent: grp, tex, manager, camera, baseH, pool: P, statue: L.statue, room: { halfX: ix, front: iz1, back: iz0, top: ceil, curtainX: 5.45, curtainZ: rowZ[1] }, floorMat: hallFloor, isMobile, low });
    for (const p of hall.lanterns) { const l = new THREE.PointLight(0xffb45e, 2.6, 5.5, 1.6); l.position.copy(p); grp.add(l); }   // 殿里两盏石灯点着：暖黄的光从格子里透出来
    grp.traverse(o => { if (!o.userData.noReflect) o.layers.enable(REFLECT_LAYER); });   // 整座殿都画进水面的倒影里
    grp.traverse(o => { if (o.userData.realmHide) realmHide.push(o); if (o.userData.realmOnly) realmOnly.push(o); });   // 壁画、织锦帷幔 / 薄纱、飘叶（hallSanctuary.js 里打了标记）
    hallGrp = grp;
    parent = scene;
  }

  // ---------- 殿前：台基边上的石栏（台阶两侧）、甬道两侧一对石灯 ----------
  {
    const A = HALL_ACCESS, half = A.stairWidth / 2, seg = 1.4, n = Math.round((A.porchHalfX - half) / seg);
    for (const s of [-1, 1]) for (let i = 0; i < n; i++) slot('stone_railing', s * (half + seg * (i + .5)), baseH, A.front - .14);
    for (const s of [-1, 1]) { slot('lantern_outdoor', s * 2.25, 0, L.stepsZ + 1.7, 0, .9); colliders.push({ x: s * 2.25, z: L.stepsZ + 1.7, r: .38 }); }
  }

  // ---------- 古树：Tripo 模型（重塑成矮而宽的伞状，精简到 5.5 万面）+ 疏朗的阔叶 + 横枝下稀疏的木牌 ----------
  const kit = createLeafKit(sunDir, tex.leaves), plaques = createPlaques({ scene });
  // 木牌的数据由外面给（setPlaques）。没有名字的旧牌由 plaques 自己补足到十来块；网址带 ?debug 时再多挂几块有名字的示范牌，方便看效果
  const demo = new URLSearchParams(location.search).has('debug') ? [
    { name: '小满', date: '2026-11-02' }, { name: '阿青', date: '2026-11-05' }, { name: '林间', date: '2026-11-08' }, { name: '知秋', date: '2026-11-09' }, { name: '山月', date: '2026-11-12' },
  ].map((p, i) => ({ ...p, id: 'demo' + i })) : [];
  let plaqueList = demo, treeLoaded = false, plaqueSig = '';
  const applyPlaques = () => { if (treeLoaded) plaques.set(plaqueList); };
  const treeReady = loadTree({ manager, barkMat: mat.bark, kit, pos: L.tree, S: L.tree.scale, yaw: L.tree.yaw, leafCount: isMobile ? 480 : 760 }).then(t => {
    scene.add(t.group, t.leaves);
    colliders.push({ x: t.trunk.x, z: t.trunk.z, r: t.trunk.r * 1.15 });
    plaques.setSlots(t.slots);
    // 刚挂上的牌优先挂在朝着院门这一侧的枝上：进院的人一抬头就能看见
    const dx = L.stop.x - L.tree.x, dz = L.stop.z - L.tree.z, dl = Math.hypot(dx, dz) || 1;
    plaques.setHub(new THREE.Vector3(L.tree.x + dx / dl * 3.2, 3.2, L.tree.z + dz / dl * 3.2));
    treeLoaded = true; applyPlaques();
    // 树荫：一张看不见的叶影片放在树冠上方（位置按阳光方向反推），在真实叶片的影子之外再添一层细碎的光斑
    const H = 9, S = L.shade;
    scene.add(createCanopyShade(tex.canopy, { x: L.tree.x + S.dx + sunDir.x / sunDir.y * H, z: L.tree.z + S.dz + sunDir.z / sunDir.y * H }, S.r, H));
  });
  // 院外的树林：挡住院墙后面的天空和地图的边界
  scene.add(createGrove(kit, L.grove, { perTree: isMobile ? 110 : 220, barkMap: tex.bark.diff }));

  // ---------- 香炉：一块低矮的天然石头上立着三足青铜鼎（courtyardBurner.js）；炉里的香在 courtyardIncense.js ----------
  let burnerGrp = null, burnerAshY = 0, burner = null;   // 香炉的组和炉灰的高度：炉里的香（courtyardIncense.js）插在这里
  {
    const B = L.burner;
    // 石基：一块压得很扁的天然石头，顶面略有起伏，长着少量青苔
    add(rockGeo(1.15, 9.4, .22), mat.stoneClean, B.x, .01, B.z).rotation.y = 1.1;   // 压得更扁：鼎的三只脚站在石面上，不埋进去
    const grp = new THREE.Group(); grp.position.set(B.x, -.01, B.z); grp.scale.set(B.scale, B.scaleY, B.scale); scene.add(grp); parent = grp;
    burner = createBurner({ parent: grp });   // 鼎本身（炉身、浮雕、立耳、蹄足、衔环、炉灰）在 courtyardBurner.js
    const ashY = burner.ashY;
    burnerGrp = grp; burnerAshY = ashY; grp.updateMatrixWorld(true);
    parent = scene;
    colliders.push({ x: B.x, z: B.z, r: 1.15 });
  }

  // ---------- 院子边角的几块苔石 ----------
  L.rocks.forEach(([x, z, r], i) => {
    add(rockGeo(r, i * 2.7 + 1), mat.stone, x, r * .2, z).rotation.y = i * 1.3;
    colliders.push({ x, z, r: r * .95 });
  });

  // ---------- 植物：石缝里的小草、墙根的小叶草、边角的蕨和枯叶堆；墙头的蕨和垂下来的藤；地上的落叶、石头上的苔斑 ----------
  // 图集（textures/q/）里每一格的范围在 qualityAtlases.js；格子的编号见 textures-src/quality/ASSET_OVERVIEW.png（从左上角起一行一行数）
  const cell = (name, i) => { const c = ATLAS[name][i]; return [[c[0], c[1], c[2], c[3]], c[4]]; };
  const PL = { fern: [0, 1, 2, 3, 4, 5, 6], broad: [7, 8, 9], rosette: [10, 11, 12], litter: [13, 14, 15] };
  const R = rng(41), pick = a => a[Math.floor(R() * a.length)];
  const plants = [], wallTop = [], hangs = [], leafDecals = [], mossDecals = [];
  const free = (x, z, r = 0) => Math.hypot(x - L.burner.x, z - L.burner.z) > 1.5 + r && Math.hypot(x - L.tree.x, z - L.tree.z) > 1.3 + r;
  {
    // 墙根：一圈小叶草（车前草、蜂斗菜），偶尔一小堆枯叶
    for (let i = 0; i < 46; i++) {
      const side = Math.floor(R() * 3), t = R(), d = .15 + R() * .4;
      const x = side === 0 ? -halfX + d : side === 1 ? halfX - d : (t - .5) * 2 * halfX, z = side === 2 ? south - d : L.stepsZ + t * (south - L.stepsZ);
      if (side === 2 && Math.abs(x) < gateHalf + .3) continue;
      const k = R(), g = .7 + R() * .25;
      plants.push({ x, z, h: k < .15 ? .14 + R() * .06 : .16 + R() * .12, cell: cell('plants_atlas_v2', pick(k < .15 ? PL.litter : k < .55 ? PL.rosette : PL.broad)), yaw: R() * 6.28, tint: [g * .95, g, g * .9] });
    }
    // 蕨：院子里只在两个角落各一丛（靠着苔石），不堆满；树根旁一小堆枯叶
    for (const [x, z, h] of [[-6.5, 3.3, .66], [-6.75, 3.75, .52], [5.3, -3.9, .7], [5.75, -4.35, .54], [-6.4, -3.3, .5]]) plants.push({ x, z, h, cell: cell('plants_atlas_v2', pick(PL.fern)), yaw: R() * 6.28, tint: [.78, .82, .74] });
    for (const [x, z] of [[-5.2, -.4], [-2.4, -2.8], [-4.9, -2.6]]) plants.push({ x, z, h: .16, cell: cell('plants_atlas_v2', pick(PL.litter)), yaw: R() * 6.28, tint: [.8, .78, .74] });
    // 墙外：几丛蕨从墙后探出头来；墙头上零星的小蕨和野草（vines_atlas 第二行）
    for (let i = 0; i < 7; i++) {
      const s = i % 2 ? 1 : -1, z = L.stepsZ + R() * (south - L.stepsZ);
      plants.push({ x: s * (halfX + wallT + .1 + R() * .25), y: wallH - .5 + R() * .1, z, h: .65 + R() * .3, cell: cell('plants_atlas_v2', pick(PL.fern)), yaw: R() * 6.28, tint: [.72, .76, .7] });
    }
    for (let i = 0; i < 12; i++) {
      const s = i % 2 ? 1 : -1, z = L.stepsZ + R() * (south - L.stepsZ - .5);
      wallTop.push({ x: s * (halfX + wallT / 2), y: wallH - .12, z, h: .22 + R() * .18, cell: cell('vines_atlas', 4 + Math.floor(R() * 4)), yaw: R() * 6.28, tint: [.78, .82, .76] });
    }
    // 墙头垂下来的藤和苔（vines_atlas 第一行、第四行）：贴着院墙的内面往下挂
    for (let i = 0; i < 11; i++) {
      const s = i % 2 ? 1 : -1, z = L.stepsZ + .5 + R() * (south - L.stepsZ - 1.5);
      const moss = R() < .35, h = moss ? .35 + R() * .25 : .6 + R() * .45;
      hangs.push({ x: s * (halfX - .015), y: wallH + .02 - R() * .08, z, h, nx: -s, nz: 0, cell: cell('vines_atlas', moss ? 12 + Math.floor(R() * 4) : Math.floor(R() * 4)), tint: [.8, .84, .78] });
    }
    // 地上的落叶：树冠下面多（往树干越近越密），墙根、台阶边零星几片
    for (let i = 0; i < 90; i++) {
      const a = R() * 6.28, r = 1.4 + Math.pow(R(), .7) * 5.5, x = L.tree.x + Math.cos(a) * r, z = L.tree.z + Math.sin(a) * r;
      if (Math.abs(x) > halfX - .1 || z > south - .1 || z < L.stepsZ + .1) continue;
      const brown = R() < .85;   // 大多是枯褐色的旧叶，少数几片发黄的；不要红叶（院子是夏末的清晨）
      const k = .5 + R() * .2;
      leafDecals.push({ x, z, s: .08 + R() * .07, rot: R() * 6.28, cell: cell('decal_leaves_atlas', brown ? pick([2, 6, 9, 12]) : pick([4, 7, 14])), tint: brown ? [k, k * .93, k * .84] : [k * .9, k * .88, k * .7] });
    }
    // 苔斑：墙根、石阶边、树根旁的石板上一块块的苔和地衣
    for (let i = 0; i < 40; i++) {
      let x, z;
      if (i < 24) { const side = i % 2 ? 1 : -1; x = side * (halfX - .1 - Math.pow(R(), 2) * .9); z = L.stepsZ + R() * (south - L.stepsZ); }
      else if (i < 32) { x = (R() - .5) * HALL_ACCESS.stairWidth * 1.4; z = L.stepsZ + .05 + R() * .5; }
      else { const a = R() * 6.28; x = L.tree.x + Math.cos(a) * (1.6 + R()); z = L.tree.z + Math.sin(a) * (1.6 + R()); }
      const lichen = R() < .15, k = lichen ? .38 : .5 + R() * .15;   // 大多是暗绿的苔，偶尔一块灰白的地衣（压暗，不要像贴纸）
      mossDecals.push({ x, z, s: .22 + R() * .35, rot: R() * 6.28, cell: cell('decal_moss_atlas', lichen ? pick([2, 4, 9, 11, 14]) : pick([0, 1, 5, 7, 10, 12, 15])), tint: [k * .92, k, k * .82] });
    }
  }
  const plantCards = createPlantCards(tex.plants, plants, { sway: .03 }), topCards = createPlantCards(tex.vines, wallTop, { sway: .04 });
  const hangCards = createHangCards(tex.vines, hangs);
  const decals = [createDecals(tex.decalMoss, mossDecals, { y: .006 }), createDecals(tex.decalLeaves, leafDecals, { y: .011 })];
  scene.add(plantCards.mesh, topCards.mesh, hangCards.mesh, ...decals);
  // 石缝里的小草：要知道石缝在哪，先把青石板的高度图读进来（和 triMat 用的是同一张），在缝上撒草
  let grassCards = null;
  const grassReady = sampleJoints(`${import.meta.env.BASE_URL}textures/q/paving_old_height_1k.webp`).then(isJoint => {
    const G = rng(77), list = [];
    for (let tries = 0; tries < 9000 && list.length < (low ? 260 : 420); tries++) {
      const u = G(), x = (G() < .5 ? Math.sign(G() - .5) * (halfX - .1 - u * u * 3.2) : (G() - .5) * 2 * (halfX - .3)), z = L.stepsZ + .2 + G() * (south - L.stepsZ - .4);
      if (!free(x, z) || !isJoint(x * PAVE_SCALE, z * PAVE_SCALE, PAVE_JOINT[0] - .02)) continue;
      const near = Math.min(halfX - Math.abs(x), south - z);   // 越靠墙越密、越高
      if (G() > .35 + .65 * Math.exp(-near * .7)) continue;
      const g = .66 + G() * .2;
      list.push({ x, z, h: .06 + G() * .08 + Math.exp(-near) * .08, cell: cell('grass_clumps_atlas', Math.floor(G() * 16)), yaw: G() * 6.28, tint: [g * .95, g, g * .82] });
    }
    grassCards = createPlantCards(tex.grass, list, { sway: .05 });
    scene.add(grassCards.mesh);
  }).catch(e => console.warn('石缝小草没有生成：', e));

  // ---------- 殿里的"洞天"（hallRealm.js）：月亮在从门口看过去猫像的右后方，低低压在云海上 ----------
  const realmEye = new THREE.Vector3(0, baseH + EYE, HALL_ACCESS.doorZ - .6);
  const realmHead = new THREE.Vector3(0, baseH + .93 + L.statue.height * .86, L.statue.z);
  const realm = createRealm({ renderer, manager, low, eye: realmEye, head: realmHead, center: new THREE.Vector3(0, 0, (L.pool.front + L.pool.back) / 2),
    pool: { halfX: L.pool.halfX, front: L.pool.front, back: L.pool.back, waterY: baseH - L.pool.drop }, puffs: { map: tex.fogPuffs, cells: ATLAS.fog_puffs },
    // 月光光柱落地的地方 [x, z, 宽, 长, { y }]：两侧的石板地上、水池边
    // 光柱只在殿里（长 4～5 米）：伸到殿外的话，衬着天空看就成了一道划痕
    shaftBeams: [[-4.3, -9.6, 1.3, 4.6, { y: baseH, k: .9 }], [-.9, -9.0, 1.1, 4.2, { y: baseH, k: .6 }], [3.2, -10.4, 1.2, 3.6, { y: baseH, k: .8 }]],
    shaftNoise: tex.shaftNoise });
  let inRealm = false, doorAmt = 0, veilTimer = 0, lastDoorZ = 0;
  let myIncenseT = [];   // 自己点的香的点燃时间（毫秒）：有一炷还在烧，跨过门槛就进洞天
  const INCENSE_BURN_MS = 30 * 60e3;
  // 借壁画的金月起一层薄雾，跨过门槛时保留玩家自己选择的视线。
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;inset:0;opacity:0;pointer-events:none;z-index:4';
  document.body.appendChild(veil);
  const veilAnchor = new THREE.Vector3();
  function resetVeil() {
    clearTimeout(veilTimer);
    veilTimer = 0;
    veil.style.transition = 'none';
    veil.style.opacity = '0';
  }
  function setRealm(on) {
    inRealm = on;
    if (on) realm.captureEnv();   // 第一次进来：先把空的洞天（月亮、云海）拍成环境贴图，再把殿挪进来
    (on ? realm.scene : scene).add(hallGrp);
    // 洞天里殿内的地面是湿的：一片片水迹、低洼处的小水洼（triMat 的 wet），石板整体也光滑一些——反着月光和灯笼
    const fu = hallLights.floor.userData.tri; fu.uMoss.value.w = on ? .4 : .02; fu.uTri.value.z = on ? .85 : 1;   // 再湿就会把月光整块反成一片白
    for (const o of realmHide) o.visible = !on;
    for (const o of realmOnly) o.visible = on;
    // 殿里的灯：洞天里没有晨光照进窗；门口的暖光和猫像的面光收一些，让月光当主角
    hallLights.windowSun.intensity = on ? 0 : 46;
    hallLights.glow.intensity = on ? 2 : 9;
    hallLights.lightStatue(on);
    if (on) realm.setWishCount(plaqueList.length + 6);
    shadowFrames = 3;
  }
  function crossTo(on) {
    if (veilTimer) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setRealm(on);
      return;
    }
    camera.updateMatrixWorld();
    hall.muralMoon.getWorldPosition(veilAnchor).project(camera);
    const { x, y, z } = veilAnchor;
    const moonVisible = on && z >= -1 && z <= 1 && Math.abs(x) <= 1 && Math.abs(y) <= 1;
    veil.style.background = moonVisible
      ? `radial-gradient(ellipse farthest-corner at ${50 + x * 50}% ${50 - y * 50}%, #dfbe88, #ad9983 34%, #6f7479 78%, #59646a)`
      : 'linear-gradient(#777b80, #979088 62%, #726d67)';
    veil.style.transition = 'opacity .34s ease-in';
    veil.style.opacity = '1';
    veilTimer = setTimeout(() => {
      veilTimer = 0;
      const inside = player.pos.z < HALL_ACCESS.doorZ - .02;
      if (inside === on) setRealm(on);
      veil.style.transition = 'opacity .9s ease-out';
      veil.style.opacity = '0';
    }, 360);
  }
  // 殿里能站的地方：门洞（门扇折到两边墙上）、水池前面一条、两侧；不能下水池，不能走到猫像后面
  const ROW_Z = [HALL_ACCESS.doorZ - 2.6], IN_X = 5.7 - .45;
  const insideOK = (x, z) => {
    if (Math.abs(x) > IN_X || z < -11.7) return false;
    if (z > HALL_ACCESS.doorZ - .45 && Math.abs(x) > 1.0) return false;
    if (Math.abs(x) < L.pool.halfX + .12 && z < L.pool.front + .2 && z > L.pool.back - .25 && Math.abs(x) > .5) return false;   // 水池里不能下去；中间那条石板路（宽约 1 米）可以走
    if (Math.abs(x) < 1.25 && z < -11.1) return false;                                                                          // 石板路走到头就是供桌，到不了猫像那边
    for (const cz of ROW_Z) if (Math.hypot(Math.abs(x) - 4.35, z - cz) < .45) return false;
    return true;
  };

  // ---------- 气氛：几道光柱、香烟、晨雾 ----------
  // 殿里还有一道：清晨的光从东窗的花格斜照进去，落在水池前的石板上（和殿里那盏 windowSun 聚光灯同一个方向）
  const hallBeam = [-1.6, HALL_ACCESS.doorZ - 3.4, 1.1, 8.2, { dir: new THREE.Vector3(8.9, 4.1, -.6).normalize(), y: baseH, k: .7 }];
  const shafts = createShafts([...L.shafts, hallBeam], sunDir, tex.shaftNoise), smoke = createSmoke(24, 3);
  const dust = createDust([...L.shafts, hallBeam], sunDir, low ? 360 : 900);
  scene.add(dust.mesh);
  // 炉里的香：数据由外面给（setIncense）；?debug 时再多插几炷别人的，方便看效果
  const incense = createIncense({ parent: burnerGrp, ashY: burnerAshY, stickMat: mat.stick });
  const demoIncense = new URLSearchParams(location.search).has('debug') ? [3, 11, 19, 26, 8, 29].map((m, i) => ({ id: 'd' + i, slot: [4, 17, 33, 48, 62, 81][i], t: Date.now() - m * 60e3, mine: false })) : [];
  const mist = createMist(haze, [
    [-10, 1.2, -17, 22, 5, .5], [9, 1.5, -18, 24, 6, .5], [0, 1, -19, 26, 5, .45], [-16, 1.5, 2, 20, 5, .42], [16, 1.2, -2, 20, 5, .42],
    [0, 1, 16, 24, 4, .38], [-9, 1, 13, 18, 4, .32], [10, 1.2, 12, 18, 4, .32],
    [0, .5, -4.6, 11, 1.5, .13], [-4.5, .5, 1.5, 8, 1.2, .08],   // 院子里贴着地面的两缕薄雾
  ], { map: tex.fogPuffs, cells: ATLAS.fog_puffs });
  scene.add(shafts.mesh, smoke.mesh, mist.group);
  let fxT = 0;
  const bufSize = new THREE.Vector2();
  // 石灯点着：灯室是一层透光的纸——下面靠近火苗的地方亮，往上、往边上暗下去，纸上有细细的纤维
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x3a3128, emissive: 0xffa04a, emissiveIntensity: .8, roughness: .9 });
  lampMat.customProgramCacheKey = () => 'court-lamp-paper';
  lampMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLp = transformed;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vLp;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        float yk = smoothstep(1.33, 1.03, vLp.y);                                    // 模型坐标：灯室在 1.03～1.31 米、半宽 0.18 米
        float side = 1. - smoothstep(.05, .18, min(abs(vLp.x), abs(vLp.z)));          // 每一面的中间亮、两边暗
        float fibre = .85 + .15 * fract(sin(dot(floor(vLp.xy * 260. + vLp.z * 190.), vec2(12.9898, 78.233))) * 43758.5);
        totalEmissiveRadiance *= (.2 + .95 * yk) * (.3 + .7 * side) * fibre;
      }`);
  };
  const chiwenMat = triMat({ set: tex.rock, moss: tex.moss, scale: 1.4, color: 0x9a9ea0, mossAmt: .3, mossAt: .75 });              // 鸱吻：灰陶，略带苔
  const propsReady = loadProps(manager).then(models => placeProps(scene, models, slots, {
    chiwen: { default: chiwenMat }, dougong: { default: mat.woodDark }, stone_railing: { default: mat.stoneClean },
    lantern_outdoor: { default: mat.stone, lamp_glass: lampMat }, door_ring: { default: mat.brass }, door_stud: { default: mat.bronze },
  }, { layer: REFLECT_LAYER })).catch(e => console.warn('小模型没有加载：', e));
  ready = Promise.all([texReady, treeReady, hall.ready, grassReady, propsReady]).then(() => {});

  // ---------- 人：位置、朝向（yaw = 0 时面向小殿，也就是 -z）----------
  const player = { pos: new THREE.Vector3(L.start.x, 0, L.start.z), yaw: 0, pitch: 0 };
  const vel = new THREE.Vector3(), want = new THREE.Vector3(), previousPos = new THREE.Vector3();
  let eyeFloor = 0;
  let walked = 0, bobK = 0, active = false, exiting = false, shadowFrames = 0;
  // 进院时镜头自己往前走几步，停在树和香炉之间；玩家一动就交还控制
  let intro = null;

  // 院墙、柱子和门洞的碰撞；台阶与关闭殿门的边界由 constrainHallMove 处理。
  const xMax = halfX - BODY_R, zSouth = south - BODY_R, gateX = gateHalf - BODY_R;
  function collide(p) {
    p.x = clamp(p.x, -xMax, xMax);
    p.z = Math.min(p.z, south + 2);
    if (p.z > zSouth) {
      if (Math.abs(p.x) <= gateX + .05) p.x = clamp(p.x, -gateX, gateX);   // 正在穿过院门
      else p.z = zSouth;
    }
    for (const c of colliders) {
      const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz), min = c.r + BODY_R;
      if (d < min) { const k = d > 1e-4 ? min / d : 1; p.x = c.x + (d > 1e-4 ? dx * k : min); p.z = c.z + dz * k; }
    }
    constrainHallMove(p, previousPos, HALL_ACCESS, { open: doorAmt > .8, inside: insideOK });
  }

  // ---------- 输入 ----------
  // 电脑：W A S D（或方向键）走，按住鼠标拖动环顾。手机：屏幕左侧拖动是行走摇杆，右侧拖动环顾
  const keys = new Set();
  const stick = { id: null, x0: 0, y0: 0, x: 0, y: 0 };      // 行走摇杆（-1～1）
  const look = { id: null, x: 0, y: 0 };
  const stickEl = document.getElementById('stick'), knobEl = stickEl?.firstElementChild, hintEl = document.getElementById('hint');
  const STICK_R = 52;
  const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
  const typing = e => /^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '');
  addEventListener('keydown', e => {
    if (active && !typing(e) && KEYMAP[e.code]) { keys.add(KEYMAP[e.code]); e.preventDefault(); }
    if (active && !typing(e) && e.code === 'KeyE' && nearBurner) lightNow();   // 站在香炉旁边：E 点香
  });
  addEventListener('keyup', e => { if (KEYMAP[e.code]) keys.delete(KEYMAP[e.code]); });
  addEventListener('blur', () => keys.clear());
  // 鼠标：点一下画面，浏览器把鼠标"锁"在画面里（光标隐藏），之后移动鼠标就是环顾，按 Esc 放出鼠标。
  // 浏览器不支持锁定时，退回到"按住拖动环顾"
  const canLock = !!canvas.requestPointerLock;
  const locked = () => document.pointerLockElement === canvas;
  // 锁定被拒绝时（有些内嵌的浏览器窗口不允许；刚按过 Esc 的一小会儿里也会拒绝）：提示改成"按住拖动"，这一下点击照常当作拖动
  const lockRefused = () => { if (active && hintEl && !locked()) { hintEl.textContent = 'W A S D 行走 · 按住拖动环顾'; } };
  const lockMouse = () => { try { canvas.requestPointerLock()?.catch?.(lockRefused); } catch { lockRefused(); } };
  document.addEventListener('mousemove', e => {
    if (!active || !locked()) return;
    const k = .0021 * (camera.fov / 62);   // 视野越窄转得越慢，手感一致
    player.yaw -= e.movementX * k; player.pitch = clamp(player.pitch - e.movementY * k, -.95, .95);
    intro = null;
  });
  canvas.addEventListener('pointerdown', e => {
    if (!active) return;
    if (e.pointerType === 'mouse' && canLock && !locked()) lockMouse();   // 没锁上的话，下面照常开始拖动
    if (e.pointerType === 'touch' && e.clientX < innerWidth * .45 && stick.id === null) {
      Object.assign(stick, { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 });
      if (stickEl) { stickEl.style.left = e.clientX + 'px'; stickEl.style.top = e.clientY + 'px'; knobEl.style.transform = ''; stickEl.classList.add('on'); }
    } else if (look.id === null) Object.assign(look, { id: e.pointerId, x: e.clientX, y: e.clientY });
    else return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* 这个指针已经不在了：不捕获也能用 */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!active) return;
    if (e.pointerId === stick.id) {
      let dx = e.clientX - stick.x0, dy = e.clientY - stick.y0; const d = Math.hypot(dx, dy);
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      stick.x = dx / STICK_R; stick.y = dy / STICK_R;
      if (knobEl) knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (e.pointerId === look.id && !locked()) {
      // 触屏：视线跟着手指转；鼠标：像抓着画面拖（和常见的全景浏览一致）
      const k = (e.pointerType === 'touch' ? 1 : -1) * .0042 * (camera.fov / 62);
      player.yaw -= (e.clientX - look.x) * k; player.pitch = clamp(player.pitch - (e.clientY - look.y) * k, -.95, .95);
      look.x = e.clientX; look.y = e.clientY; intro = null;
    }
  });
  const release = e => {
    if (e.pointerId === stick.id) { stick.id = null; stick.x = stick.y = 0; stickEl?.classList.remove('on'); }
    if (e.pointerId === look.id) look.id = null;
  };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);

  // ---- 点香：走到香炉旁边（2.7 米以内）出现按钮，也可以按 E ----
  const lightBtn = document.getElementById('lightBtn');
  let nearBurner = false, btnT = 0;
  const burnerP = new THREE.Vector2(L.burner.x, L.burner.z);
  let lighting = false;
  async function lightNow() {
    if (lighting) return;   // 上一次点香还在等服务器回话
    lighting = true;
    try { const r = await onLight(); if (r?.ok) { btnT = 0; if (lightBtn) lightBtn.classList.remove('on'); } } finally { lighting = false; }
  }
  lightBtn?.addEventListener('click', lightNow);
  if (lightBtn) lightBtn.textContent = matchMedia('(pointer: coarse)').matches ? '点香' : '点香 · E';
  function updateLightBtn(dt) {
    nearBurner = Math.hypot(player.pos.x - burnerP.x, player.pos.z - burnerP.y) < 2.7;
    btnT -= dt;
    if (btnT > 0 || !lightBtn) return;
    btnT = .4;   // 能不能点香不用每帧问
    const c = canLight();
    lightBtn.hidden = false;
    lightBtn.classList.toggle('on', nearBurner && active && c.ok);   // 只在香炉旁边、而且现在能点香时才出现；点过香（还在烧）就消失
  }

  let hintT = 0;
  function showHint() {
    if (!hintEl) return;
    hintEl.textContent = matchMedia('(pointer: coarse)').matches ? '左侧拖动行走 · 右侧拖动环顾'
      : canLock ? '点击画面后移动鼠标环顾 · W A S D 行走 · Esc 释放鼠标' : 'W A S D 行走 · 按住拖动环顾';
    hintEl.hidden = false; hintT = 9; requestAnimationFrame(() => hintEl.classList.add('on'));
  }
  const hideHint = () => hintEl?.classList.remove('on');

  // ---------- 每帧 ----------
  function update(dt) {
    // 想往哪走：键盘和摇杆合在一起（相对于朝向），长度不超过 1
    const f = (keys.has('f') ? 1 : 0) - (keys.has('b') ? 1 : 0) - stick.y, r = (keys.has('r') ? 1 : 0) - (keys.has('l') ? 1 : 0) + stick.x;
    const moving = Math.abs(f) + Math.abs(r) > .02;
    if (moving) { intro = null; if (hintT > 1.2) hintT = 1.2; }
    if (hintT > 0 && (hintT -= dt) <= 0) hideHint();
    const p = player.pos;
    if (intro) {
      intro.t += dt;
      const u = smooth(intro.t / intro.dur), px = p.x, pz = p.z;
      p.x = intro.x0 + (intro.x1 - intro.x0) * u; p.z = intro.z0 + (intro.z1 - intro.z0) * u;
      player.yaw = intro.yaw1 * u; player.pitch = intro.pitch1 * u;
      walked += Math.hypot(p.x - px, p.z - pz); bobK += (1 - bobK) * Math.min(1, dt * 6);
      if (intro.t >= intro.dur) intro = null;
      vel.set(0, 0, 0);
    } else {
      const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
      want.set(-sy * f + cy * r, 0, -cy * f - sy * r);
      if (want.lengthSq() > 1) want.normalize();
      vel.lerp(want.multiplyScalar(WALK), 1 - Math.exp(-dt * 9));   // 起步、停步都有一点缓冲
      const px = p.x, pz = p.z;
      previousPos.copy(p); p.addScaledVector(vel, dt); collide(p);
      const d = Math.hypot(p.x - px, p.z - pz);
      walked += d; bobK += (clamp(d / Math.max(dt, 1e-4) / WALK) - bobK) * Math.min(1, dt * 6);
    }
    // 殿门：走到廊下门前就慢慢打开（门扇折到两边的墙上），走开了再关上；人在殿里时不关。
    // 进殿：没点香，里面就是平常的殿（清晨、壁画、猫像）；点了香（自己的那一炷还在烧，30 分钟），跨过门槛就进"洞天"（月夜云海）。
    // 洞天一旦进了，就一直是洞天，直到走出门槛，香烧完也不会把人赶出来
    {
      const A = HALL_ACCESS, nowT = now();
      const near = inRealm || p.z < A.doorZ + .5 || (p.z < A.front + .9 && Math.abs(p.x) < 2.4);
      const k = doorAmt; doorAmt = clamp(doorAmt + (near ? dt / 2.2 : -dt / 2));
      if (k !== doorAmt) { const e = smooth(doorAmt) * 2.9; for (const { hinge, s } of doorHinges) hinge.rotation.y = s * -e; if (doorAmt === 0 || doorAmt === 1) shadowFrames = Math.max(shadowFrames, 2); }
      // 跨过门槛（上一帧还在门槛外、这一帧过去了）：有香就进洞天；回到门槛外：洞天退出（中间留一点距离，不会在门槛上来回闪）
      const unlocked = myIncenseT.some(t => nowT - t < INCENSE_BURN_MS);
      if (!inRealm && unlocked && doorAmt > .8 && lastDoorZ >= A.doorZ - .3 && p.z < A.doorZ - .3) crossTo(true);
      else if (inRealm && p.z > A.doorZ - .02) crossTo(false);
      lastDoorZ = p.z;
    }
    // 走出院门：回到池边
    if (!exiting && p.z > south + .55) { exiting = true; onExit(); }
    // 走路时镜头轻微起伏（一步约 0.75 米）
    eyeFloor += (p.y - eyeFloor) * (1 - Math.exp(-dt * 12));
    camera.position.set(p.x, eyeFloor + EYE + Math.sin(walked / .75 * Math.PI * 2) * .02 * bobK, p.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    // 靠近殿门时轻收视角，保留走动时的广视野；入口查看主体更接近设计稿。
    const hallView = (1 - THREE.MathUtils.smoothstep(p.z, HALL_ACCESS.doorZ + .6, HALL_ACCESS.front + 1.8))
      * (1 - THREE.MathUtils.smoothstep(Math.abs(p.x), .9, 2.4));
    const targetFov = camera.aspect < 1 ? FOV_PORTRAIT : inRealm ? 56 : THREE.MathUtils.lerp(FOV, 44, hallView);   // 洞天里视野放开：看得到整轮月亮和两边的柱子
    if (Math.abs(camera.fov - targetFov) > .01) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.exp(-dt * 5));
      camera.updateProjectionMatrix();
    }
    sky.position.copy(camera.position);
    fxT += dt; kit.update(fxT); plaques.update(fxT); grassCards?.update(fxT); plantCards.update(fxT); topCards.update(fxT);
    shafts.uniforms.uTime.value = fxT; smoke.uniforms.uTime.value = fxT; mist.update(fxT); hall.update(fxT);
    dust.uniforms.uTime.value = fxT; backdrop.userData.uniforms.uTime.value = fxT;
    dust.uniforms.uPx.value = renderer.getDrawingBufferSize(bufSize).y / (2 * Math.tan(camera.fov * Math.PI / 360));   // 1 米远处 1 米有多少像素
    burner.update(fxT, incense.update(now(), smoke)); updateLightBtn(dt);
    if (inRealm) realm.update(fxT, camera, renderer);
  }

  const DAY_GRADE = { saturation: 1, vig: .16, dayWarm: .28, court: 1, grain: 0, sharp: low ? .25 : .35 };
  // 洞天：自己的调色（暗处青、亮处金，见 GradeShader 的 realm），暗角重一些；泛光门槛放低，月亮、灯笼、云边的金光往外溢
  const REALM_GRADE = { saturation: 1.06, vig: .4, dayWarm: 0, court: 0, realm: 1, grain: 0, sharp: low ? .25 : .35,
    bloom: { strength: low ? .36 : .55, radius: .6, threshold: low ? .95 : .85 } };   // 手机屏小、贴图糊一档：泛光收一些，月亮不糊成一团
  return {
    scene, camera, player, layout: L, ready, plaques,
    // list：[{ id, name, date, mine }]；freshId：刚挂上的那块（进院时会有落下来挂好的动画，镜头也会慢慢转向它）
    setPlaques(list, freshId = null) {
      const sig = list.map(p => p.id).join() + '|' + freshId;
      if (sig === plaqueSig) return;   // 没变化（定时刷新的时候最常见）：不重画，木牌也不会跳
      plaqueSig = sig; plaqueList = [...demo, ...list.map(p => ({ ...p, fresh: p.id === freshId }))]; applyPlaques();
    },
    get activeScene() { return inRealm ? realm.scene : scene; },
    get exposure() { return inRealm ? 1.05 : .98; },
    // 全画面调色（main.js 的 GradeShader）：小院的"清晨"——亮处偏暖、暗处偏青绿，绿色收一点饱和，轻微的 S 曲线和暗角；
    // 不加胶片颗粒（画面会发糊），反而轻轻锐化一下，让石缝、木纹、叶子边缘清楚
    get grade() { return inRealm ? REALM_GRADE : DAY_GRADE; },
    update,
    // 阴影是静态的：进院后画几帧就够（渲染器的阴影不是每帧自动更新）
    // 阴影画好之后，每帧先画殿里水面的倒影（阴影还没画的那几帧不画：倒影只画殿这一层，会把阴影贴图画成只有殿的影子）
    preRender(renderer) { if (shadowFrames > 0) { shadowFrames--; renderer.shadowMap.needsUpdate = true; } else hall.preRender(renderer, inRealm ? realm.scene : scene); },
    resize(aspect) { camera.aspect = aspect; camera.fov = aspect < 1 ? FOV_PORTRAIT : FOV; camera.updateProjectionMatrix(); },
    // intro = false：直接站在院门里（调试、截图用）
    enter({ withIntro = true } = {}) {
      player.pos.set(L.start.x, 0, L.start.z); player.yaw = 0; player.pitch = 0; vel.set(0, 0, 0); walked = 0; bobK = 0; eyeFloor = 0;
      plaques.play(fxT);
      intro = null;
      if (withIntro) {
        intro = { t: 0, dur: 3.5, x0: L.start.x, z0: L.start.z, x1: L.stop.x, z1: L.stop.z, yaw1: 0, pitch1: .05 };
        const fp = plaques.freshPosition();   // 刚挂上的牌：镜头一边往前走一边慢慢转过去看它
        if (fp) { const dx = fp.x - L.stop.x, dz = fp.z - L.stop.z; intro.yaw1 = Math.atan2(-dx, -dz); intro.pitch1 = Math.min(.5, Math.atan2(fp.y - EYE, Math.hypot(dx, dz))); }
      }
      resetVeil();
      if (inRealm) setRealm(false);
      doorAmt = 0; for (const { hinge } of doorHinges) hinge.rotation.y = 0;
      active = true; exiting = false; shadowFrames = 4; keys.clear();
      canvas.style.cursor = ''; showHint();
    },
    // 炉里现在燃着的香：[{ id, slot, t（点燃的时间，毫秒）, mine }]
    setIncense(list) { incense.set([...demoIncense, ...list]); myIncenseT = list.filter(i => i.mine).map(i => i.t); },
    leave() { resetVeil(); if (inRealm) setRealm(false); active = false; nearBurner = false; lightBtn?.classList.remove('on'); keys.clear(); if (locked()) document.exitPointerLock(); stick.id = look.id = null; stick.x = stick.y = 0; stickEl?.classList.remove('on'); hideHint(); },
  };
}
