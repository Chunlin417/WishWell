// 殿里的陈设（隔着花格窗从门外看）：沿中轴线依次是蒲团、浅水池里的一条石板路、供桌、石台上的青铜猫像、后墙的金月壁画；
// 猫像两侧各一盏石灯笼，再往外是两幅束起来的织锦帷幔——像戏台的台口，把视线收到猫像和它身后的金月上。
// 壁画（textures/hall_mural.webp）和帷幔（textures/hall_drape.webp）是图像生成的素材，原图在 textures-src/hall/；其余都是几何体。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { triMat } from './courtyardMats.js';
import { finishMural, finishCloth, finishPoolStone } from './hallSurface.js';

const TEX = `${import.meta.env.BASE_URL}textures/`;

// 一幅束起来的帷幔：上沿平直地挂着，在 tie（离地的比例）处被绳子收到一侧（+x 那一边），下摆再散开一些；布面有竖向的褶
function drapeGeo(w, h, tie = .4) {
  const g = new THREE.PlaneGeometry(w, h, 48, 40), p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), u = x / w + .5, v = y / h + .5;
    const gather = .72 * Math.exp(-(((v - tie) / .23) ** 2)) + (v < tie ? .46 * (tie - v) / tie : 0);
    const f = 1 - gather;
    const fold = Math.sin(u * Math.PI * 12 + v * .8) * (.045 - .025 * gather) + Math.sin(u * Math.PI * 4 + v) * .018;
    p.setXYZ(i, w / 2 + (x - w / 2) * f, y - gather * .09 * (1 - u), fold);
    uv.setXY(i, u * (w / (h / 2)), v);   // 织锦原图是 1:2 的竖幅：按实际尺寸铺，不拉伸
  }
  g.computeVertexNormals();
  return g;
}

// 漂在水面上的落叶：一小片扇形的黄叶
function leafTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 54); g.fillStyle = '#c9a23a';
  g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-34, -14, -30, -48, -6, -46); g.lineTo(0, -34); g.lineTo(6, -46); g.bezierCurveTo(30, -48, 34, -14, 0, 0); g.fill();
  g.strokeStyle = 'rgba(120,84,20,.6)'; g.lineWidth = 1.2;
  for (let a = -1; a <= 1; a += .4) { g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.sin(a) * 40, -Math.cos(a) * 40); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createSanctuary({ parent, tex, manager, baseH, room, pool, statue }) {
  const loader = new THREE.TextureLoader(manager);
  const stone = triMat({ set: tex.paving, scale: .85, color: 0xa9afa4, roughMul: 1.2, norK: .38 });
  stone.color.multiplyScalar(1.25);
  const pedestal = triMat({ set: tex.paving, scale: .62, color: 0x858b86, roughMul: 1.1, norK: .55, blocks: true });
  const poolStone = finishPoolStone(triMat({ set: tex.paving, moss: tex.moss, scale: .8, color: 0xa8a58e, mossAmt: .24, mossAt: .63, norK: .5 }), baseH - pool.drop);
  const moss = triMat({ set: tex.rock, moss: tex.moss, scale: 1.1, color: 0xc8c1a5, mossAmt: .5, mossAt: .62, norK: .5 });
  moss.color.multiplyScalar(1.6);
  const wood = triMat({ set: tex.wood, scale: .62, color: 0xa49a88, wood: true, weather: .3, weatherY: baseH, norK: .35 });
  const dark = triMat({ set: tex.wood, scale: .78, color: 0x897c69, wood: true, weather: .25, weatherY: baseH, norK: .3 });
  const brass = new THREE.MeshStandardMaterial({ color: 0x9b8050, metalness: .65, roughness: .6 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x5d6f68, roughness: .9 });
  const unit = new THREE.BoxGeometry(1, 1, 1);
  const put = (o, x, y, z, target = parent) => { o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; target.add(o); return o; };
  const box = (w, h, d, m, x, y, z, target = parent) => { const o = put(new THREE.Mesh(unit, m), x, y, z, target); o.scale.set(w, h, d); return o; };
  const rounded = (w, h, d, x, y, z, m = stone, r = .035) => put(new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(r, h / 2 - .001)), m), x, y, z);

  // ---------- 水池：石头压顶、池壁；池中间一条石板路从门口通向供桌 ----------
  const mid = (pool.front + pool.back) / 2, length = pool.front - pool.back, waterY = baseH - pool.drop;
  for (const s of [-1, 1]) {
    rounded(.26, .14, length + .5, s * (pool.halfX + .13), baseH + .025, mid, poolStone);
    box(.08, pool.depth, length, poolStone, s * (pool.halfX + .015), baseH - pool.depth / 2, mid);
  }
  for (const z of [pool.front, pool.back]) rounded(pool.halfX * 2, .14, .26, 0, baseH + .025, z, poolStone);
  const slabs = 5;
  for (let i = 0; i < slabs; i++) {
    const z = pool.front - .33 - i * (length - .66) / (slabs - 1), k = Math.sin(i * 12.9898) * .5;   // 每块石板大小、位置略有出入
    const s = rounded(.96 + k * .1, .15, .54, k * .05, baseH + .005, z, moss); s.rotation.y = k * .05;
    box(.8, pool.depth, .3, stone, 0, baseH - pool.depth / 2 - .05, z);   // 水下的石墩
  }
  // 水面上漂着的几片黄叶（避开石板路）
  {
    const n = 14, im = new THREE.InstancedMesh(new THREE.PlaneGeometry(.12, .12).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: .5, roughness: .8, side: THREE.DoubleSide }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
    let seed = 91; const R = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, x = side * (.85 + R() * (pool.halfX - 1.1)), z = pool.back + .25 + R() * (length - .5), s = .7 + R() * .7;
      im.setMatrixAt(i, m.compose(new THREE.Vector3(x, waterY + .006, z), q.setFromEuler(e.set(0, R() * 6.28, 0)), sc.set(s, 1, s)));
    }
    im.castShadow = false; im.receiveShadow = true; im.userData.noReflect = true; parent.add(im);
  }

  // ---------- 蒲团：门里正对着猫像的地方 ----------
  const drape = loader.load(TEX + 'hall_drape.webp');
  drape.colorSpace = THREE.SRGBColorSpace; drape.wrapS = drape.wrapT = THREE.RepeatWrapping; drape.anisotropy = 4;
  const cushionMat = new THREE.MeshStandardMaterial({ map: drape, color: 0x9a8474, roughness: .95 });
  rounded(.84, .15, .6, 0, baseH + .078, pool.front + .62, cushionMat, .07);

  // ---------- 石台和猫像身后的金月壁画 ----------
  rounded(3.3, .2, 2.2, 0, baseH + .1, statue.z, pedestal);
  rounded(2.8, .5, 1.9, 0, baseH + .45, statue.z, pedestal);
  rounded(3.0, .14, 2.0, 0, baseH + .77, statue.z, pedestal);
  box(2.86, .09, 1.86, moss, 0, baseH + .885, statue.z);
  const statueY = baseH + .93;

  // 壁画：斑驳的深色墙面上一轮金箔圆月，两侧祥云，下面是层层水波。图本身带一点自发光（殿里暗，隔着窗格也看得清），
  // 同一张图当凹凸贴图用——侧光照过来，金箔的龟裂和墙皮的剥落有一点起伏，不像一张印刷的海报
  const muralMap = loader.load(TEX + 'hall_mural.webp');
  muralMap.colorSpace = THREE.SRGBColorSpace; muralMap.anisotropy = 8;
  const plaster = finishMural(new THREE.MeshStandardMaterial({ map: muralMap, bumpMap: muralMap, bumpScale: .012, emissive: 0xffffff, emissiveMap: muralMap, emissiveIntensity: .025, roughness: .92, metalness: .035 }));
  const panelW = 6.4, panelH = 3.2, py = statueY + statue.height * .88 - panelH * .14, pz = room.back + .16;
  // 壁画和后墙一起，在"洞天"里会被藏起来（后墙敞开成云海，见 hallRealm.js）：都打上 realmHide
  const hide = o => { o.userData.realmHide = true; return o; };
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), plaster);
  hide(put(panel, 0, py, pz + .058)); panel.castShadow = false;
  hide(box(panelW, panelH, .1, dark, 0, py, pz));
  for (const s of [-1, 1]) {
    hide(box(panelW + .08, .04, .08, dark, 0, py + s * (panelH / 2 + .02), pz + .02));
    hide(box(.04, panelH, .08, dark, s * (panelW / 2 + .02), py, pz + .02));
  }
  // 金月的位置（图上量出来的）：圆心比壁画中心高 0.14 个画高，半径约 0.96 米。外圈压一道细铜边，侧光下会亮起一线
  const discY = py + panelH * .14, discR = .955;
  const rim = hide(put(new THREE.Mesh(new THREE.TorusGeometry(discR, .006, 7, 96), brass), -.02, discY, pz + .066)); rim.castShadow = false;

  // ---------- 供桌：猫像前面一张深色的木桌，桌上一只小香炉、一盘橘子、一只插着枯枝的陶瓶、一对蜡烛 ----------
  {
    const az = statue.z + 1.47, top = baseH + .86, g = new THREE.Group();
    g.name = 'hall-offering-table';
    // 以地面为缩放支点，供品随桌一起收小，不悬空。
    g.scale.setScalar(.78); g.position.set(0, baseH * (1 - .78), az); parent.add(g);
    box(2.7, .07, .78, dark, 0, top, 0, g);
    box(2.5, .17, .035, wood, 0, top - .13, .34, g); box(2.5, .17, .035, wood, 0, top - .13, -.34, g);   // 牙板
    for (const x of [-1.22, 1.22]) for (const z of [-.3, .3]) box(.11, top - baseH, .11, dark, x, (top + baseH) / 2, z, g);
    for (const x of [-1.22, 1.22]) box(.07, .07, .6, dark, x, baseH + .2, 0, g);
    box(2.44, .06, .07, dark, 0, baseH + .2, 0, g);
    const t = top + .035;
    const censer = put(new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [.1, 0], [.15, .05], [.16, .12], [.13, .17], [.15, .19]].map(p => new THREE.Vector2(...p)), 20), brass), 0, t, .05, g);
    censer.castShadow = false;
    // 供桌：中间一只香炉，左右各一只一样的陶瓶（插着枯枝，左边是右边的镜像）；不放水果和蜡烛
    const vaseGeo = new THREE.LatheGeometry([[0, 0], [.07, 0], [.11, .1], [.1, .2], [.045, .29], [.055, .34]].map(p => new THREE.Vector2(...p)), 18);
    const twig = new THREE.MeshStandardMaterial({ color: 0x3c2e22, roughness: 1 }), bud = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: .8 });
    for (const sx of [-1, 1]) {
      put(new THREE.Mesh(vaseGeo, clay), sx * .82, t, .02, g);
      for (const [lean, len, turn] of [[.18, .62, 0], [-.3, .5, 2.2], [.42, .44, 4.1]]) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(.004, .008, len, 5).translate(0, len / 2, 0), twig);
        b.position.set(sx * .82, t + .32, .02); b.rotation.set(lean * Math.cos(turn), 0, sx * (lean * Math.sin(turn) + lean * .6)); g.add(b);
        for (let k = 0; k < 4; k++) { const d = new THREE.Mesh(new THREE.SphereGeometry(.014, 6, 5), bud); d.position.set((k % 2 ? .012 : -.012), len * (.4 + k * .17), 0); b.add(d); }
      }
    }
  }

  // ---------- 石灯笼：猫像两侧各一盏，灯室里透出暖光 ----------
  const glass = new THREE.MeshStandardMaterial({ color: 0x8e8064, emissive: 0xffa94e, emissiveIntensity: .9, roughness: .85 });   // 灯室是亮的
  const lanterns = [];
  for (const s of [-1, 1]) {
    const lx = s * 2.85, lz = statue.z + .3, y = baseH;
    const firstChild = parent.children.length;
    rounded(.76, .16, .76, lx, y + .08, lz, moss);
    rounded(.5, .14, .5, lx, y + .23, lz);
    box(.26, .96, .26, stone, lx, y + .78, lz);
    rounded(.68, .12, .68, lx, y + 1.32, lz);
    box(.4, .4, .4, glass, lx, y + 1.58, lz).castShadow = false;
    for (const dx of [-.22, .22]) for (const dz of [-.22, .22]) box(.07, .42, .07, stone, lx + dx, y + 1.59, lz + dz);
    rounded(.62, .07, .62, lx, y + 1.835, lz);
    const roof = put(new THREE.Mesh(new THREE.ConeGeometry(.6, .34, 4).rotateY(Math.PI / 4), moss), lx, y + 2.04, lz);
    roof.scale.set(1, 1, 1);
    put(new THREE.Mesh(new THREE.SphereGeometry(.075, 10, 8), stone), lx, y + 2.25, lz);
    const lantern = new THREE.Group(); lantern.name = `hall-stone-lantern-${s}`;
    const pieces = parent.children.slice(firstChild);
    for (const piece of pieces) {
      piece.position.sub(new THREE.Vector3(lx, y, lz)); lantern.add(piece);
    }
    lantern.position.set(lx, y, lz); lantern.scale.setScalar(.72); parent.add(lantern);
    lanterns.push(new THREE.Vector3(lx, y + 1.58 * .72, lz));
  }

  // ---------- 帷幔：两幅深红织锦挂在猫像前面那道横梁下，各自束向外侧的柱子 ----------
  const drapeMat = finishCloth(new THREE.MeshStandardMaterial({ map: drape, side: THREE.DoubleSide, roughness: 1, color: 0xb8a59b }));
  const dw = 2.05, dh = room.top - baseH - .35, dgeo = drapeGeo(dw, dh);
  for (const s of [-1, 1]) {
    const d = put(new THREE.Mesh(dgeo, drapeMat), s * (room.curtainX - dw / 2), baseH + dh / 2 + .12, room.curtainZ + .2);
    d.scale.x = s;   // 左边那幅是右边的镜像
    box(.09, .07, .09, brass, s * (room.curtainX - .16), baseH + .12 + dh * .4 - .02, room.curtainZ + .24);   // 束带上的铜扣
  }

  return { statueY, discY, lanterns };
}
