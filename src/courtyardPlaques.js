// 古树上的长条木牌：一根短红绳系在树枝下，下面是窄长的木牌，牌下挂一枚小铜铃和一缕短红穗。
// 正面竖排写名字（毛笔楷体），背面只写许愿的日期（愿望不保存、不显示）；没有字的是树上本来就有的旧牌。
// 木牌有新有旧：新的是浅色原木，旧的颜色深、有水渍和青苔。稀疏地挂在横枝下面，大部分枝条空着。
// 全部用实例化网格画：木牌、正面、背面、绳、铃、穗各一个 InstancedMesh
import * as THREE from 'three';

const PW = .085, PH = .34, PT = .016;          // 木牌的宽、高、厚（米）
const CELL_W = 96, CELL_H = 288, COLS = 16;     // 图集里每个面的格子大小（像素）、每行几格
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const KAI = '"STKaiti", "KaiTi", "Kaiti SC", "楷体", "Songti SC", serif';
const NEW_WOOD = [205, 178, 132], OLD_WOOD = [118, 97, 70];   // 新木牌、旧木牌的底色
const woodRGB = age => NEW_WOOD.map((v, i) => Math.round(v + (OLD_WOOD[i] - v) * age));

// 在图集的格子里画一个面。kind：'front'（名字）、'back'（日期）、'blank'（没有字）；age：0 新 ～ 1 旧
function drawFace(g, x, y, kind, text, seed, age) {
  const r = rng(seed * 977 + 13), [cr, cg, cb] = woodRGB(age);
  g.save(); g.beginPath(); g.rect(x, y, CELL_W, CELL_H); g.clip(); g.translate(x, y);
  // 木色底 + 竖向的木纹
  g.fillStyle = `rgb(${cr},${cg},${cb})`; g.fillRect(0, 0, CELL_W, CELL_H);
  for (let i = 0; i < 34; i++) {
    const px = r() * CELL_W; g.strokeStyle = r() < .6 ? `rgba(60,38,20,${.05 + r() * .12})` : `rgba(240,218,180,${.05 + r() * .1})`;
    g.lineWidth = .6 + r() * 1.6; g.beginPath(); g.moveTo(px, 0); g.lineTo(px + (r() - .5) * 6, CELL_H); g.stroke();
  }
  // 四周压深一圈（边缘磨损、受潮）
  const eg = g.createLinearGradient(0, 0, CELL_W, 0); eg.addColorStop(0, 'rgba(40,25,12,.26)'); eg.addColorStop(.12, 'rgba(40,25,12,0)'); eg.addColorStop(.88, 'rgba(40,25,12,0)'); eg.addColorStop(1, 'rgba(40,25,12,.26)');
  g.fillStyle = eg; g.fillRect(0, 0, CELL_W, CELL_H);
  // 旧牌：几块水渍，下半截泛青苔
  for (let i = 0; i < Math.round(age * 7); i++) {
    const sx = r() * CELL_W, sy = r() * CELL_H, sr = 14 + r() * 34, sg = g.createRadialGradient(sx, sy, 0, sx, sy, sr);
    sg.addColorStop(0, `rgba(35,26,16,${.18 + r() * .16})`); sg.addColorStop(1, 'rgba(35,26,16,0)'); g.fillStyle = sg; g.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  }
  if (age > .55) { const mg = g.createLinearGradient(0, CELL_H * .5, 0, CELL_H); mg.addColorStop(0, 'rgba(70,84,36,0)'); mg.addColorStop(1, `rgba(70,84,36,${.3 * age})`); g.fillStyle = mg; g.fillRect(0, CELL_H * .5, CELL_W, CELL_H * .5); }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (kind === 'front' && text) {
    const chars = [...text].slice(0, 6), size = Math.min(58, (CELL_H - 56) / chars.length), top = (CELL_H - size * chars.length) / 2;
    g.font = `bold ${size}px ${KAI}`; g.fillStyle = 'rgba(30,16,8,.9)';
    chars.forEach((ch, i) => g.fillText(ch, CELL_W / 2 + (r() - .5) * 2, top + size * (i + .5)));
  } else if (kind === 'back' && text) {
    // 日期横着写、转了 90 度：沿着木牌的长边读；像是用刀刻上去的，颜色比木头深一点点
    g.translate(CELL_W / 2, CELL_H / 2); g.rotate(-Math.PI / 2);
    g.font = `600 30px ${KAI}`; g.fillStyle = 'rgba(55,34,16,.75)'; g.fillText(text, 0, 0);
  }
  g.restore();
}

// total：树上一共大约挂几块（真正的木牌不够时用没字的旧牌补足，让树不显得空；人多了旧牌就少）
export function createPlaques({ scene, capacity = 96, total = 11 }) {
  const root = new THREE.Group(); scene.add(root);
  // ---- 图集：每块牌占两格（正面、背面）----
  const rows = Math.ceil(capacity * 2 / COLS), atlas = document.createElement('canvas'); atlas.width = COLS * CELL_W; atlas.height = rows * CELL_H;
  const ag = atlas.getContext('2d'), tex = new THREE.CanvasTexture(atlas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const cellUV = i => [(i % COLS) * CELL_W / atlas.width, 1 - (Math.floor(i / COLS) + 1) * CELL_H / atlas.height, CELL_W / atlas.width, CELL_H / atlas.height];

  // ---- 材质 ----
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: .85 });
  faceMat.customProgramCacheKey = () => 'court-plaque-face';
  faceMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aCell;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = vMapUv * aCell.zw + aCell.xy;');
  };
  const woodMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 });   // 颜色由每块牌的实例颜色决定（新旧不同）
  const redMat = new THREE.MeshStandardMaterial({ color: 0x8f231d, roughness: .75 });
  const bellMat = new THREE.MeshStandardMaterial({ color: 0xa8843e, roughness: .4, metalness: .85 });

  // ---- 网格（原点都在绳的上端）----
  const faceGeo = (back) => { const g = new THREE.PlaneGeometry(PW, PH); if (back) g.rotateY(Math.PI); g.translate(0, 0, back ? -PT / 2 - .0008 : PT / 2 + .0008); return g; };
  const geos = {
    cord: new THREE.BoxGeometry(.006, 1, .006).translate(0, -.5, 0),
    body: new THREE.BoxGeometry(PW, PH, PT),
    front: faceGeo(false), back: faceGeo(true),
    bell: new THREE.SphereGeometry(.019, 12, 8),
    tassel: new THREE.ConeGeometry(.012, .09, 8).rotateX(Math.PI).translate(0, -.045, 0),
  };
  const mats = { cord: redMat, body: woodMat, front: faceMat, back: faceMat, bell: bellMat, tassel: redMat };
  const meshes = {};
  for (const k of Object.keys(geos)) {
    const m = new THREE.InstancedMesh(geos[k], mats[k], capacity);
    m.count = 0; m.frustumCulled = false; m.castShadow = k === 'body' || k === 'tassel'; m.receiveShadow = true; root.add(m); meshes[k] = m;
    if (k === 'front' || k === 'back') { m.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4)); }
  }

  // ---- 数据 ----
  let slots = [], list = [], items = [], hub = null;   // items：{ p: 挂点, len: 绳长, yaw, phase, amp, mine, fresh, t0 }；hub：刚挂上的那块牌优先选离它最近的挂点（让人一进院就看得见）
  const col = new THREE.Color(), halos = [];
  // 自己的牌：背后有一团暖金色的柔光（贴图是一张径向渐变）
  const haloTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,214,130,1)'); gr.addColorStop(.4, 'rgba(255,190,90,.4)'); gr.addColorStop(1, 'rgba(255,170,70,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

  function layout() {
    items = [];
    for (const h of halos) { root.remove(h); h.material.dispose(); } halos.length = 0;
    // 没字的旧牌补足到 total 块（至少留 3 块）；和真正的木牌交错着占挂点（挂点的顺序本身就是分散开的）
    const blanks = Math.max(3, total - list.length), n = Math.min(list.length + blanks, slots.length, capacity);
    const freshP = list.find(p => p.fresh), others = list.filter(p => !p.fresh);
    // 刚挂上的那块牌：挑离 hub 最近的挂点；其余的牌按顺序占剩下的挂点
    let freshSlot = -1;
    if (freshP && hub) { let bd = Infinity; slots.forEach((s, i) => { const d = s.distanceTo(hub); if (d < bd) { bd = d; freshSlot = i; } }); }
    const free = []; for (let i = 0; i < slots.length; i++) if (i !== freshSlot) free.push(i);
    let fi = 0; const take = () => (fi < free.length ? free[fi++] : -1);
    const all = [];
    if (freshP) all.push({ ...freshP, slot: freshSlot >= 0 ? freshSlot : take() });
    let li = 0, bi = 0;
    for (let k = 0, target = n - all.length; k < target; k++) {
      const useBlank = bi < blanks && (li >= others.length || (k * 5 + 2) % 3 === 0), slot = take();
      if (slot < 0) break;
      all.push(useBlank ? { blank: true, slot, n: bi++ } : { ...others[li++], slot });
    }
    ag.clearRect(0, 0, atlas.width, atlas.height);
    all.slice(0, capacity).forEach((o, i) => {
      const s = slots[o.slot], r = rng(o.slot * 31 + 7);
      const center = 2.1 + r() * .55;   // 木牌中心的高度：2.1～2.65 米为主，枝条高的地方绳子长一点，但不超过 0.8 米
      const len = Math.min(.8, Math.max(.16, s.y - center - PH / 2));
      const age = o.blank ? .45 + r() * .55 : r() * .35;   // 没字的是旧牌；有名字的是新近挂上的
      items.push({ p: s, len, yaw: r() * 6.283, phase: r() * 6.283, amp: .05 / (.7 + len), mine: !!o.mine, fresh: !!o.fresh, t0: Infinity });
      const fx = (i * 2 % COLS) * CELL_W, fy = Math.floor(i * 2 / COLS) * CELL_H, bx = ((i * 2 + 1) % COLS) * CELL_W, by = Math.floor((i * 2 + 1) / COLS) * CELL_H;
      drawFace(ag, fx, fy, o.blank ? 'blank' : 'front', o.name, o.slot, age); drawFace(ag, bx, by, o.blank ? 'blank' : 'back', o.date, o.slot + 5, age);
      meshes.front.geometry.attributes.aCell.set(cellUV(i * 2), i * 4); meshes.back.geometry.attributes.aCell.set(cellUV(i * 2 + 1), i * 4);
      meshes.body.setColorAt(i, col.setRGB(...woodRGB(age).map(v => v / 255 * .82), THREE.SRGBColorSpace));
      if (o.mine) {
        const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: 0xffd08a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, fog: false }));
        h.scale.set(.42, .56, 1); h.renderOrder = 7; h.userData.i = i; root.add(h); halos.push(h);
      }
    });
    meshes.front.geometry.attributes.aCell.needsUpdate = meshes.back.geometry.attributes.aCell.needsUpdate = true;
    if (meshes.body.instanceColor) meshes.body.instanceColor.needsUpdate = true;
    tex.needsUpdate = true;
    for (const k in meshes) meshes[k].count = items.length;
  }

  const m = new THREE.Matrix4(), base = new THREE.Matrix4(), t = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), gv = new THREE.Vector3(1, 1, 1), sv = new THREE.Vector3();
  const easeOut = x => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  function update(time, wind = 1) {
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // 刚挂上的牌：进院半秒后从无到有"长"出来，同时绳子带着它大幅摇晃几下，慢慢停稳
      const u = it.fresh ? Math.min(1, Math.max(0, (time - it.t0 - .7) / 1.8)) : 1, grow = Math.max(.001, easeOut(u)), a = it.amp * wind * (1 + 4 * (1 - u));
      const sw = Math.sin(time * .9 + it.phase) * a + Math.sin(time * 2.3 + it.phase * 1.7) * a * .3, sw2 = Math.cos(time * .7 + it.phase) * a * .6;
      base.compose(it.p, q.setFromEuler(e.set(sw2, it.yaw, sw, 'YXZ')), gv.setScalar(grow));   // 绕挂点摆动
      meshes.cord.setMatrixAt(i, m.copy(base).scale(sv.set(1, it.len, 1)));
      const down = d => t.makeTranslation(0, -it.len - d, 0);
      meshes.body.setMatrixAt(i, m.copy(base).multiply(down(PH / 2)));
      meshes.front.setMatrixAt(i, m); meshes.back.setMatrixAt(i, m);
      meshes.bell.setMatrixAt(i, m.copy(base).multiply(down(PH + .03)));
      meshes.tassel.setMatrixAt(i, m.copy(base).multiply(down(PH + .046)));
    }
    for (const k in meshes) meshes[k].instanceMatrix.needsUpdate = true;
    for (const h of halos) {
      const it = items[h.userData.i]; if (!it) continue;
      const u = it.fresh ? Math.min(1, Math.max(0, (time - it.t0 - .7) / 1.8)) : 1;
      h.position.set(it.p.x, it.p.y - (it.len + PH / 2) * easeOut(u), it.p.z);
      h.material.opacity = easeOut(u) * (.22 + .06 * Math.sin(time * 1.7));
    }
  }

  return {
    root,
    setSlots(s) { slots = s; layout(); },
    // list：[{ id, name, date, mine }]
    set(l) { list = l; layout(); },
    get count() { return items.length; },
    get capacity() { return slots.length; },
    // 世界坐标里第 i 块牌的位置（以后靠近显示名字会用到）
    positionOf(i) { const it = items[i]; return it && new THREE.Vector3(it.p.x, it.p.y - it.len - PH / 2, it.p.z); },
    setHub(v) { hub = v; },
    // 刚挂上的那块牌的位置（进院时镜头慢慢转向它）；没有就是 null
    freshPosition() { const i = items.findIndex(it => it.fresh); return i < 0 ? null : this.positionOf(i); },
    // 进院了：刚挂上的牌开始长出来
    play(time) { for (const it of items) if (it.fresh) it.t0 = time; },
    update,
  };
}
